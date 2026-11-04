# mcp-memory-dsh — DeepSeek Harness plugin for the Memory MCP server

A DSH plugin bundle that connects [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
to the local memory MCP server in this repository (`memory_server.py`, Streamable HTTP on
`http://127.0.0.1:8960`). It gives the model long-term memory, injects the core memory
block **once per session**, and adds a **right-sidebar memory manager** to the DSH web GUI.

## What it does

| Surface | Behavior |
|---|---|
| Model tools | `memory_search`, `memory_save` (with `topic` categorization), `memory_forget` — thin proxies over the server's model tools. The `memory_core_block` and `memory_admin_*` tools stay hidden from the model, as the server recommends. |
| System prompt | A short static note teaching save restraint — important, durable facts only, never routine task details (disable with `saveGuidance: false`). Plus: when a session starts, the plugin fetches the rendered `<user_memory>` core block **once** and contributes it as a system-prompt section that stays **frozen for that session** (the server's prompt-cache guidance). It is not re-fetched or re-injected on every turn. A "Load into this chat" button in the sidebar reloads it on demand. |
| Right sidebar | A "Memory" tab type with a guide-page entry: list/search facts grouped by topic, add, edit, delete, pin/unpin, move core⇄archive, clear the needs-review flag, and see core-block usage (x/800 tokens). |
| HTTP routes | Same-origin `/memory-api/*` routes on the DSH web server proxy the JSON-RPC calls (`/memory-api/mcp`), health (`/memory-api/health`), and per-session reload (`POST /memory-api/refresh`). The browser never talks to the memory server directly, so any device that can open the GUI can use the manager. |

The admin token (if the server runs with `MEMORY_ADMIN_TOKEN`) is configured once in the
plugin row and injected server-side into admin calls — it never reaches the browser or the model.

## Install

1. Start the memory server: `docker compose up -d --build` (this repository).
2. Installing a bundle runs `pnpm` from the DSH host process — pnpm must be on its PATH
   (`npm install -g pnpm` once, if it is missing).
3. Add the plugin in DSH, then reload the browser page to load the sidebar UI:
   - **From the web UI (recommended):** open the plugin page, add this plugin index under
     *plugin indexes*, then install **Memory** from Discover:
     `https://raw.githubusercontent.com/hypersniper05/MCP-Memory/main/dsh-market.json`
   - **From a chat:** ask the agent to run `plugin_manager` → `install_bundle` with the
     install spec the index entry names — `git+https://github.com/hypersniper05/MCP-Memory.git#<commit>&path:/dsh-memory`
     (the pinned `<commit>` is in `dsh-market.json`) — or with a local checkout path.
4. Start a **new** session — the core block is read once at session start.

## Configuration

Edit the `dsh-memory` row in the profile's `cordis.patch.yml` (or the plugin config UI):

| Field | Default | Meaning |
|---|---|---|
| `url` | `http://127.0.0.1:8960` | Memory MCP server base URL (the `/mcp` endpoint is derived from it) |
| `adminToken` | *(unset)* | Sent as `admin_token` on `memory_admin_*` calls; set if the server has `MEMORY_ADMIN_TOKEN` |
| `injectCoreBlock` | `true` | Inject the core block once at session start; `false` keeps the tools + sidebar only |
| `saveGuidance` | `true` | Include the short "save only important facts" note in the system prompt |
| `fetchTimeoutMs` | `8000` | Timeout for the core-block fetch |
| `toolTimeoutMs` | `30000` | Timeout for model tool calls |

## Turning it off is clean

Everything the plugin contributes is an owned effect: disabling or removing the bundle
unregisters the three tools, drops the per-session prompt sections (the system prompt is
re-rendered without the block on the next step), removes the `/memory-api` routes, and
removes the sidebar tab and guide entry. The plugin persists nothing inside DSH — the
facts live only in the memory server's own Docker volume, which is yours to keep or wipe.

## Development

Plain JavaScript, no build step, no dependencies. `index.js` is the Host half, `client.js`
the browser half (loaded through DSH's client module table), `cordis.patch.yml` inserts the
plugin row. After editing, re-install the bundle; replacing an installed package needs a
DSH restart to load a fresh module generation, and a browser reload for the client half.
