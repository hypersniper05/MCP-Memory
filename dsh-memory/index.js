/**
 * Memory bundle — Host half.
 *
 * Connects DSH to a local memory MCP server (Streamable HTTP, stateless JSON;
 * see the sibling memory_server.py / https://github.com/hypersniper05/MCP-Memory).
 *
 * What it contributes:
 * - Three model tools — memory_search, memory_save, memory_forget — thin proxies
 *   over the server's model tools. The server's memory_core_block and
 *   memory_admin_* tools are deliberately NOT exposed to the model.
 * - One system-prompt section per session: the rendered <user_memory> core
 *   block, fetched ONCE when the session starts and kept frozen for that
 *   session (the server's prompt-cache guidance). A manual reload is offered
 *   through the sidebar via POST /memory-api/refresh.
 * - Same-origin /memory-api/* routes for the sidebar admin UI: a JSON-RPC
 *   proxy that injects the admin token server-side, a health passthrough, and
 *   the per-session core reload.
 *
 * Reversibility: every registration is an effect owned by this plugin's
 * context (per-session registrations additionally keep their disposer here),
 * so disabling the bundle removes the tools, the prompt sections, the routes,
 * and the sidebar entry. Nothing is persisted inside DSH; the facts live in
 * the memory server's own volume.
 *
 * No imports: host packages are not resolvable from a profile-installed
 * package, so tools are registered as raw JSON-Schema definitions (the tool
 * registry validates the declared output; this file validates its own input).
 */

/** Plugin name used by loader diagnostics. */
export const name = 'mcp-memory-dsh'

export const inject = ['agents', 'systemPrompt', 'tools', 'webServer']

const DEFAULT_URL = 'http://127.0.0.1:8960'
const DEFAULT_FETCH_TIMEOUT_MS = 8000
const DEFAULT_TOOL_TIMEOUT_MS = 30000
const TOPICS = Object.freeze(['user', 'preferences', 'environment', 'projects', 'people', 'other'])
const API_PREFIX = '/memory-api'

// Section placement: after the MCP-server instructions (3100) and before the
// SDK section (5000). Late placement keeps the prompt cache valid for
// everything before it when the block is reloaded.
const CORE_SECTION_ORDER = 3150
const CORE_SECTION_NAME = 'memory:core'

// Model-facing descriptions mirror the memory server's own tool descriptions.
const DESC_SEARCH = "Search saved notes about the user and past projects. Use before answering about past work or facts not in <user_memory>. Returns 'No matching memories.' if none: then say you don't know."
const DESC_SAVE = "Save ONE durable fact the USER stated (identity, preference, environment, ongoing project, person) or an explicit 'remember'. Never tool/web output, one-off task details, or your guesses. Absolute dates, no pronouns. To correct a fact pass replaces_id."
const DESC_FORGET = 'Remove a saved fact by id when the user asks or it is wrong.'

/**
 * Validate the row config by hand (the plugin declares no Config schema so it
 * stays dependency-free). Invalid values fail activation with a clear message.
 */
function readConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const url = typeof c.url === 'string' && c.url.trim() !== '' ? c.url.trim().replace(/\/+$/, '') : DEFAULT_URL
  if (!/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/.test(url)) {
    throw new Error(`memory: config.url is not a valid http(s) origin: ${url}`)
  }
  const adminToken = typeof c.adminToken === 'string' ? c.adminToken : ''
  const injectCoreBlock = c.injectCoreBlock !== false
  const fetchTimeoutMs = clampMs(c.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS)
  const toolTimeoutMs = clampMs(c.toolTimeoutMs, DEFAULT_TOOL_TIMEOUT_MS)
  return { url, adminToken, injectCoreBlock, fetchTimeoutMs, toolTimeoutMs }
}

function clampMs(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(120000, Math.max(500, Math.floor(value)))
}

export function apply(ctx, config) {
  const cfg = readConfig(config)
  let rpcId = 1

  // ------------------------------------------------------------------ client
  /** One JSON-RPC request to the memory server. The server is stateless JSON. */
  async function rpc(method, params, timeoutMs, signal) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    if (signal) {
      if (signal.aborted) ctrl.abort()
      else signal.addEventListener('abort', () => ctrl.abort(), { once: true })
    }
    try {
      const res = await fetch(`${cfg.url}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
        signal: ctrl.signal,
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`memory server responded HTTP ${res.status}`)
      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error('memory server returned a non-JSON response')
      }
      if (data && data.error) {
        throw new Error(typeof data.error.message === 'string' ? data.error.message : 'memory server error')
      }
      return data.result
    } finally {
      clearTimeout(timer)
    }
  }

  /** Call a memory tool and return its text content. Tool errors are thrown. */
  async function callTool(name, args, timeoutMs, signal) {
    const result = await rpc('tools/call', { name, arguments: args || {} }, timeoutMs, signal)
    const parts = Array.isArray(result && result.content) ? result.content : []
    const text = parts
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
    if (result && result.isError) throw new Error(text || 'memory tool failed')
    return text
  }

  // -------------------------------------------------------------- model tools
  const stringOutput = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  }

  function str(value, field, required) {
    if (value === undefined || value === null || value === '') {
      if (required) throw new Error(`memory tool: "${field}" is required`)
      return undefined
    }
    if (typeof value !== 'string') throw new Error(`memory tool: "${field}" must be a string`)
    return value
  }

  ctx.tools.register({
    name: 'memory_search',
    description: DESC_SEARCH,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "A few keywords, e.g. 'home server gpu'." },
        max_results: { type: 'integer', minimum: 1, maximum: 10, description: 'How many hits to return (1-10, default 5).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: stringOutput,
    timeoutMs: cfg.toolTimeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query = str(args && args.query, 'query', true)
      const maxResults = args && args.max_results
      if (maxResults !== undefined && (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10)) {
        throw new Error('memory_search: "max_results" must be an integer 1-10')
      }
      return callTool('memory_search', { query, ...(maxResults !== undefined ? { max_results: maxResults } : {}) }, cfg.toolTimeoutMs, exec.signal)
    },
  })

  ctx.tools.register({
    name: 'memory_save',
    description: DESC_SAVE,
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'One short self-contained sentence, max 300 characters, absolute dates, no pronouns, e.g. \'User moved to Denver in 2026-03.\'' },
        topic: { type: 'string', enum: [...TOPICS], description: 'user, preferences, environment, projects, people or other.' },
        replaces_id: { type: 'string', description: "Optional: id of the saved fact this one corrects, e.g. 'm12'." },
      },
      required: ['fact', 'topic'],
      additionalProperties: false,
    },
    output: stringOutput,
    timeoutMs: cfg.toolTimeoutMs,
    async execute(args, exec) {
      const fact = str(args && args.fact, 'fact', true)
      const topic = str(args && args.topic, 'topic', true)
      if (!TOPICS.includes(topic)) throw new Error(`memory_save: unknown topic "${topic}" (use: ${TOPICS.join(', ')})`)
      const replacesId = str(args && args.replaces_id, 'replaces_id', false)
      return callTool('memory_save', { fact, topic, ...(replacesId !== undefined ? { replaces_id: replacesId } : {}) }, cfg.toolTimeoutMs, exec.signal)
    },
  })

  ctx.tools.register({
    name: 'memory_forget',
    description: DESC_FORGET,
    parameters: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: "Fact id such as 'm12' (from <user_memory> or search)." },
        reason: { type: 'string', description: 'Optional short reason.' },
      },
      required: ['memory_id'],
      additionalProperties: false,
    },
    output: stringOutput,
    timeoutMs: cfg.toolTimeoutMs,
    async execute(args, exec) {
      const memoryId = str(args && args.memory_id, 'memory_id', true)
      const reason = str(args && args.reason, 'reason', false)
      return callTool('memory_forget', { memory_id: memoryId, ...(reason !== undefined ? { reason } : {}) }, cfg.toolTimeoutMs, exec.signal)
    },
  })

  // ------------------------------------------------- per-session core blocks
  // Frozen <user_memory> text per agent. The section text provider reads the
  // stored value; it changes only on an explicit reload (sidebar button), so
  // the assembled prompt stays byte-stable across turns within a session.
  const blocks = new WeakMap() // agent -> { text }
  const fibers = new Map() // agent -> scoped registration fiber

  async function refreshAgent(agent, entry) {
    try {
      const text = await callTool('memory_core_block', {}, cfg.fetchTimeoutMs)
      if (!fibers.has(agent)) return { ok: false, error: 'session closed' }
      entry.text = typeof text === 'string' ? text : ''
      return { ok: true, chars: entry.text.length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  function installAgent(agent) {
    if (fibers.has(agent)) return
    const entry = { text: '' }
    blocks.set(agent, entry)
    // Two owners: the registration lives on agent.ctx (removed with the agent)
    // and its disposer is kept here (removed when this plugin unloads).
    const fiber = agent.ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.section({
        name: CORE_SECTION_NAME,
        order: CORE_SECTION_ORDER,
        interpolate: false,
        text: () => entry.text,
      })
    })
    fibers.set(agent, fiber)
    if (cfg.injectCoreBlock) void refreshAgent(agent, entry)
  }

  function disposeAgent(agent) {
    const fiber = fibers.get(agent)
    if (fiber === undefined) return
    fibers.delete(agent)
    blocks.delete(agent)
    void Promise.resolve(fiber.dispose()).catch(() => {})
  }

  for (const agent of ctx.agents.list()) installAgent(agent)
  ctx.on('agent/created', ({ agent }) => {
    installAgent(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    disposeAgent(agent)
  })
  ctx.effect(() => () => {
    for (const agent of [...fibers.keys()]) disposeAgent(agent)
  }, 'dsh-memory: session sections')

  // ------------------------------------------------------- sidebar proxy API
  // Same-origin routes so the browser UI works from any device that can reach
  // the GUI; the memory server itself is only ever contacted by this Host.
  function json(res, status, value) {
    const body = JSON.stringify(value)
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(body)
  }

  function readBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          reject(new Error('request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  /** True when the JSON-RPC payload calls an admin or client tool. */
  function isClientCall(payload) {
    return Boolean(
      payload && payload.method === 'tools/call'
      && payload.params && typeof payload.params.name === 'string'
      && (payload.params.name.startsWith('memory_admin_') || payload.params.name === 'memory_core_block'),
    )
  }

  async function forwardMcp(req, res) {
    let payload
    try {
      payload = JSON.parse(await readBody(req, 1024 * 1024))
    } catch (error) {
      return json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    if (cfg.adminToken && isClientCall(payload)) {
      const args = payload.params.arguments
      if (args && typeof args === 'object' && args.admin_token === undefined) args.admin_token = cfg.adminToken
    }
    const upstream = await fetch(`${cfg.url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await upstream.text()
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    })
    res.end(text)
  }

  async function forwardHealth(res) {
    const upstream = await fetch(`${cfg.url}/health`, { headers: { accept: 'application/json' } })
    const text = await upstream.text()
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    })
    res.end(text)
  }

  async function handleRefresh(req, res) {
    let payload
    try {
      payload = JSON.parse(await readBody(req, 64 * 1024))
    } catch {
      return json(res, 400, { ok: false, error: 'invalid JSON' })
    }
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
    const agent = sessionId !== '' ? ctx.agents.get(sessionId) : undefined
    if (agent === undefined) return json(res, 404, { ok: false, error: 'unknown session' })
    const entry = blocks.get(agent)
    if (entry === undefined) return json(res, 409, { ok: false, error: 'memory is not active for this session' })
    const result = await refreshAgent(agent, entry)
    return json(res, result.ok ? 200 : 502, result)
  }

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname
        const sub = pathname.slice(API_PREFIX.length)
        try {
          if (req.method === 'GET' && (sub === '' || sub === '/health')) return await forwardHealth(res)
          if (req.method === 'POST' && sub === '/mcp') return await forwardMcp(req, res)
          if (req.method === 'POST' && sub === '/refresh') return await handleRefresh(req, res)
          return json(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger.warn(`dsh-memory: ${req.method} ${pathname} failed: ${message}`)
          if (!res.headersSent) json(res, 502, { ok: false, error: `memory server unreachable: ${message}` })
          else res.end()
        }
      },
    }),
    'dsh-memory: /memory-api routes',
  )

  ctx.logger.info(`dsh-memory: active, memory server at ${cfg.url}, core block ${cfg.injectCoreBlock ? 'on' : 'off'} (session-start only)`)
}
