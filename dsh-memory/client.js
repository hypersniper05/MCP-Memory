/**
 * Memory bundle — Client half.
 *
 * Registers a right-sidebar tab type ("Memory") with a guide-page entry, and a
 * session-scoped tab body that manages the memory server's facts through the
 * Host's /memory-api proxy (same origin as the GUI, admin token injected
 * server-side). "Load into this chat" re-fetches the frozen core block for
 * this session only.
 *
 * UI text uses English phrases as translation keys: a missing dictionary entry
 * degrades to readable English instead of a raw key.
 */
window.__ModuleLoader__.load({
  id: 'mcp-memory-dsh',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const TAB_ID = 'mcp-memory-dsh'
    const TOPICS = ['user', 'preferences', 'environment', 'projects', 'people', 'other']

    const DICT_EN = {}
    const DICT_ZH = {
      Memory: '记忆',
      'Long-term memory manager: view, edit and organize the facts the model remembers.': '长期记忆管理：查看、编辑和整理模型记住的事实。',
      'Memory manager': '记忆管理器',
      'memory server unreachable': '无法连接记忆服务器',
      facts: '条记忆',
      'core block': '核心区块',
      'needs review': '待复核',
      'Search facts…': '搜索记忆…',
      'Reload list': '刷新列表',
      'Load into this chat': '载入当前会话',
      'Core memory reloaded into this chat.': '已将核心记忆载入当前会话。',
      'Reload failed': '载入失败',
      'Add a fact': '新增记忆',
      'One short fact, max 300 characters…': '一条简短事实，最多 300 字…',
      topic: '主题',
      tier: '层级',
      auto: '自动',
      core: '核心',
      archive: '归档',
      'pinned facts stay in the core block': '固定的事实会保留在核心区块中',
      pinned: '已固定',
      Save: '保存',
      Cancel: '取消',
      edit: '编辑',
      delete: '删除',
      'delete?': '确认删除？',
      pin: '固定',
      unpin: '取消固定',
      'to core': '设为核心',
      'to archive': '设为归档',
      'mark reviewed': '标记已复核',
      'No saved facts yet. Ask the model to remember something, or add one above.': '还没有记忆。让模型记住些什么，或在上方新增一条。',
      'Add failed': '新增失败',
      'Update failed': '更新失败',
      'Delete failed': '删除失败',
      user: '用户',
      preferences: '偏好',
      environment: '环境',
      projects: '项目',
      people: '人物',
      other: '其他',
    }

    const STYLES = `
.dshm { display:flex; flex-direction:column; gap:10px; height:100%; min-height:0; padding:12px; box-sizing:border-box; overflow:hidden; color:var(--dsw-alias-label-primary); font-size:13px; }
.dshm * { font-family:inherit; }
.dshm-head { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.dshm-status { display:flex; align-items:center; gap:6px; min-width:0; flex-wrap:wrap; color:var(--dsw-alias-label-secondary); font-size:12px; }
.dshm-dot { width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-state-error-primary); flex:none; }
.dshm-dot.ok { background:var(--dsw-alias-state-business-primary); }
.dshm-badge { padding:1px 6px; border-radius:4px; background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-secondary); font-size:11px; }
.dshm-badge.warn { color:var(--dsw-alias-state-warn-label); background:var(--dsw-alias-state-warn-tertiary); }
.dshm-btn { appearance:none; border:0.5px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-secondary); border-radius:6px; padding:4px 9px; font-size:12px; cursor:pointer; white-space:nowrap; }
.dshm-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dshm-btn:disabled { opacity:.5; cursor:default; }
.dshm-btn.primary { color:var(--dsw-alias-label-primary); box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border); background:var(--dsw-alias-button-ghost-active-fill); }
.dshm-btn.danger { color:var(--dsw-alias-state-error-primary); }
.dshm-btn:focus-visible { outline:2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:1px; }
.dshm-banner { padding:6px 10px; border-radius:6px; font-size:12px; border:0.5px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base)); color:var(--dsw-alias-label-secondary); word-break:break-word; }
.dshm-banner.error { color:var(--dsw-alias-state-error-primary); }
.dshm-toolbar { display:flex; gap:6px; }
.dshm-input, .dshm-select, .dshm-area { width:100%; box-sizing:border-box; border:0.5px solid var(--dsw-alias-border-l1); border-radius:6px; background:transparent; color:var(--dsw-alias-label-primary); padding:5px 8px; font-size:12px; }
.dshm-input { flex:1; }
.dshm-input::placeholder { color:var(--dsw-alias-label-tertiary); }
.dshm-input:focus-visible, .dshm-select:focus-visible, .dshm-area:focus-visible { outline:2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.dshm-area { min-height:56px; resize:vertical; }
.dshm-add { display:flex; flex-direction:column; gap:6px; padding:8px; border:0.5px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base)); }
.dshm-add-row { display:flex; gap:6px; align-items:center; }
.dshm-add-row .dshm-btn { margin-left:auto; }
.dshm-check { display:flex; align-items:center; gap:4px; color:var(--dsw-alias-label-secondary); font-size:12px; }
.dshm-list { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:2px; --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }
.dshm-group { margin-top:8px; padding:2px 0 4px; font-size:11px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--dsw-alias-label-tertiary); position:sticky; top:0; background:inherit; }
.dshm-row { display:flex; flex-direction:column; gap:4px; padding:7px 8px; border-radius:8px; }
.dshm-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dshm-text { color:var(--dsw-alias-label-primary); line-height:1.45; word-break:break-word; }
.dshm-meta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; color:var(--dsw-alias-label-tertiary); font-size:11px; }
.dshm-id { font-family:ui-monospace, monospace; }
.dshm-actions { display:flex; gap:2px; margin-left:auto; flex-wrap:wrap; }
.dshm-link { appearance:none; border:0; background:none; color:var(--dsw-alias-label-tertiary); font-size:11px; cursor:pointer; padding:2px 5px; border-radius:4px; }
.dshm-link:hover:not(:disabled) { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-interactive-bg-hover); }
.dshm-link.danger:hover:not(:disabled) { color:var(--dsw-alias-state-error-primary); background:var(--dsw-alias-interactive-bg-hover-danger); }
.dshm-link:disabled { opacity:.5; cursor:default; }
.dshm-empty { padding:24px 8px; text-align:center; color:var(--dsw-alias-label-tertiary); }
`

    // ---------------------------------------------------------------- API
    async function api(path, body) {
      const res = await fetch('/memory-api' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (data && typeof data.error === 'string' && data.error !== '') throw new Error(data.error)
      if (!res.ok || data === null) throw new Error('memory API HTTP ' + res.status)
      if (data.error) throw new Error(String(data.error.message || 'memory error'))
      return data
    }

    /** One memory tool call through the proxy; returns structuredContent. */
    async function callTool(name, args) {
      const data = await api('/mcp', { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args || {} } })
      const r = data.result || {}
      const text = (Array.isArray(r.content) ? r.content : [])
        .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n')
      if (r.isError) throw new Error(text || 'memory tool failed')
      if (r.structuredContent !== undefined) return r.structuredContent
      try { return JSON.parse(text) } catch { return text }
    }

    // ---------------------------------------------------------------- body
    function MemoryBody({ t, sessionId }) {
      const [facts, setFacts] = useState(null)
      const [stats, setStats] = useState(null)
      const [error, setError] = useState('')
      const [note, setNote] = useState('')
      const [query, setQuery] = useState('')
      const [showAdd, setShowAdd] = useState(false)
      const [busy, setBusy] = useState(false)
      const [pendingDelete, setPendingDelete] = useState('')
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState({ text: '', topic: 'user', tier: '', pinned: false })
      const deleteTimer = useRef(undefined)
      useEffect(() => () => clearTimeout(deleteTimer.current), [])

      const load = useCallback(async () => {
        setError('')
        try {
          const args = { status: 'active', limit: 500 }
          if (query.trim() !== '') args.q = query.trim()
          const [list, st] = await Promise.all([callTool('memory_admin_list', args), callTool('memory_admin_stats', {})])
          setFacts(Array.isArray(list.facts) ? list.facts : [])
          setStats(st && st.ok ? st : null)
        } catch (err) {
          setFacts(null)
          setError(String(err && err.message ? err.message : err))
        }
      }, [query])

      useEffect(() => {
        const timer = setTimeout(load, query ? 300 : 0)
        return () => clearTimeout(timer)
      }, [load, query])

      useEffect(() => {
        if (note === '') return
        const timer = setTimeout(() => setNote(''), 4000)
        return () => clearTimeout(timer)
      }, [note])

      const act = useCallback(async (fn, okNote) => {
        setBusy(true)
        try {
          await fn()
          setNote(okNote || '')
          await load()
          return true
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
          return false
        } finally {
          setBusy(false)
        }
      }, [load])

      const loadIntoChat = useCallback(async () => {
        setBusy(true)
        try {
          const data = await api('/refresh', { sessionId })
          if (data && data.ok) setNote(t('Core memory reloaded into this chat.') + ' (' + data.chars + ')')
          else throw new Error((data && data.error) || 'unknown')
        } catch (err) {
          setError(t('Reload failed') + ': ' + String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }, [sessionId, t])

      const askDelete = useCallback((id) => {
        setPendingDelete(id)
        clearTimeout(deleteTimer.current)
        deleteTimer.current = setTimeout(() => setPendingDelete(''), 4000)
      }, [])

      const connected = facts !== null
      const coreTokens = stats ? stats.core_tokens : 0
      const cap = stats ? stats.cap : 800
      const reviewCount = stats ? stats.needs_review : 0

      const groups = []
      if (Array.isArray(facts) && facts.length > 0) {
        for (const topic of TOPICS) {
          const rows = facts.filter((f) => f.topic === topic)
          if (rows.length > 0) groups.push([topic, rows])
        }
      }

      const row = (f) => {
        const isEditing = editing && editing.id === f.id
        return h('div', { className: 'dshm-row', key: f.id },
          isEditing
            ? h(EditForm, {
              t,
              draft: editing,
              busy,
              setDraft: setEditing,
              onCancel: () => setEditing(null),
              onSave: () => act(() => callTool('memory_admin_edit', {
                memory_id: f.id,
                text: editing.text,
                ...(editing.topic && editing.topic !== f.topic ? { topic: editing.topic } : {}),
              }), ''),
            })
            : h('div', { className: 'dshm-text' }, f.text),
          isEditing ? null : h('div', { className: 'dshm-meta' },
            h('span', { className: 'dshm-id' }, f.id),
            h('span', { className: 'dshm-badge' }, t(f.tier === 'core' ? 'core' : 'archive')),
            f.pinned ? h('span', { className: 'dshm-badge', title: t('pinned facts stay in the core block') }, '★ ' + t('pinned')) : null,
            f.needs_review ? h('span', { className: 'dshm-badge warn' }, '⚠ ' + t('needs review')) : null,
            h('span', { className: 'dshm-actions' },
              h('button', { className: 'dshm-link', disabled: busy, onClick: () => setEditing({ id: f.id, text: f.text, topic: f.topic }) }, t('edit')),
              h('button', { className: 'dshm-link', disabled: busy, onClick: () => act(() => callTool('memory_admin_pin', { memory_id: f.id, pinned: !f.pinned })) }, f.pinned ? t('unpin') : t('pin')),
              h('button', { className: 'dshm-link', disabled: busy, onClick: () => act(() => callTool('memory_admin_set_tier', { memory_id: f.id, tier: f.tier === 'core' ? 'archive' : 'core' })) }, f.tier === 'core' ? t('to archive') : t('to core')),
              f.needs_review ? h('button', { className: 'dshm-link', disabled: busy, onClick: () => act(() => callTool('memory_admin_clear_review', { memory_id: f.id })) }, t('mark reviewed')) : null,
              h('button', {
                className: 'dshm-link danger',
                disabled: busy,
                onClick: () => (pendingDelete === f.id
                  ? act(() => callTool('memory_admin_delete', { memory_id: f.id })).then(() => setPendingDelete(''))
                  : askDelete(f.id)),
              }, pendingDelete === f.id ? t('delete?') : t('delete')),
            ),
          ),
        )
      }

      return h('div', { className: 'dshm' },
        h('style', null, STYLES),
        h('div', { className: 'dshm-head' },
          h('div', { className: 'dshm-status' },
            h('span', { className: 'dshm-dot' + (connected ? ' ok' : '') }),
            h('span', null, connected ? t('Memory manager') : t('memory server unreachable')),
            stats ? h('span', { className: 'dshm-badge' }, String(stats.counts.status.active) + ' ' + t('facts')) : null,
            stats ? h('span', { className: 'dshm-badge' }, t('core block') + ' ' + coreTokens + '/' + cap) : null,
            reviewCount > 0 ? h('span', { className: 'dshm-badge warn' }, '⚠ ' + reviewCount + ' ' + t('needs review')) : null,
          ),
          h('div', { className: 'dshm-head', style: { gap: '6px' } },
            h('button', { className: 'dshm-btn', disabled: busy, onClick: load }, t('Reload list')),
            h('button', { className: 'dshm-btn primary', disabled: busy, onClick: loadIntoChat }, t('Load into this chat')),
          ),
        ),
        error !== '' ? h('div', { className: 'dshm-banner error' }, error) : null,
        note !== '' ? h('div', { className: 'dshm-banner' }, note) : null,
        h('div', { className: 'dshm-toolbar' },
          h('input', { className: 'dshm-input', type: 'search', placeholder: t('Search facts…'), value: query, onChange: (e) => setQuery(e.target.value) }),
          h('button', { className: 'dshm-btn', disabled: busy, onClick: () => setShowAdd((v) => !v) }, t('Add a fact')),
        ),
        showAdd ? h(AddForm, {
          t, draft, setDraft, busy,
          onAdd: () => act(() => callTool('memory_admin_add', {
            text: draft.text,
            topic: draft.topic,
            ...(draft.tier !== '' ? { tier: draft.tier } : {}),
            ...(draft.pinned ? { pinned: true } : {}),
          }).then((r) => {
            if (r && r.ok === false) throw new Error('rejected')
            setDraft({ text: '', topic: 'user', tier: '', pinned: false })
            setShowAdd(false)
          }), ''),
        }) : null,
        facts === null
          ? (error !== '' ? null : h('div', { className: 'dshm-empty' }, '…'))
          : facts.length === 0
            ? h('div', { className: 'dshm-empty' }, t('No saved facts yet. Ask the model to remember something, or add one above.'))
            : h('div', { className: 'dshm-list' }, groups.map(([topic, rows]) =>
              h(React.Fragment, { key: topic },
                h('div', { className: 'dshm-group' }, t(topic) + ' · ' + rows.length),
                rows.map(row),
              ))),
      )
    }

    function AddForm({ t, draft, setDraft, busy, onAdd }) {
      return h('div', { className: 'dshm-add' },
        h('textarea', {
          className: 'dshm-area',
          placeholder: t('One short fact, max 300 characters…'),
          maxLength: 300,
          value: draft.text,
          onChange: (e) => setDraft({ ...draft, text: e.target.value }),
        }),
        h('div', { className: 'dshm-add-row' },
          h('label', null, t('topic'), ' ', topicSelect(t, draft.topic, (v) => setDraft({ ...draft, topic: v }))),
          h('label', null, t('tier'), ' ', tierSelect(t, draft.tier, (v) => setDraft({ ...draft, tier: v }))),
          h('label', { className: 'dshm-check' },
            h('input', { type: 'checkbox', checked: draft.pinned, disabled: draft.tier === 'archive', onChange: (e) => setDraft({ ...draft, pinned: e.target.checked }) }),
            t('pin')),
          h('button', { className: 'dshm-btn primary', disabled: busy || draft.text.trim() === '', onClick: onAdd }, t('Save')),
        ),
      )
    }

    function EditForm({ t, draft, setDraft, busy, onCancel, onSave }) {
      return h('div', { className: 'dshm-add' },
        h('textarea', { className: 'dshm-area', maxLength: 300, value: draft.text, onChange: (e) => setDraft({ ...draft, text: e.target.value }) }),
        h('div', { className: 'dshm-add-row' },
          topicSelect(t, draft.topic, (v) => setDraft({ ...draft, topic: v })),
          h('button', { className: 'dshm-btn', disabled: busy, onClick: onCancel }, t('Cancel')),
          h('button', { className: 'dshm-btn primary', disabled: busy || draft.text.trim() === '', onClick: onSave }, t('Save')),
        ),
      )
    }

    function topicSelect(t, value, onChange) {
      return h('select', { className: 'dshm-select', value, onChange: (e) => onChange(e.target.value) },
        TOPICS.map((topic) => h('option', { key: topic, value: topic }, t(topic))))
    }

    function tierSelect(t, value, onChange) {
      return h('select', { className: 'dshm-select', value, onChange: (e) => onChange(e.target.value) },
        h('option', { value: '' }, t('auto')),
        h('option', { value: 'core' }, t('core')),
        h('option', { value: 'archive' }, t('archive')))
    }

    // ---------------------------------------------------------------- mount
    return {
      inject: ['sidebarRightTabs', 'slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('memory', { en: DICT_EN, zh: DICT_ZH }), 'memory locale')
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: 'memory',
          title: { en: 'Memory', zh: '记忆' },
          guide: {
            order: 60,
            title: { en: 'Memory', zh: '记忆' },
            description: { en: 'Long-term memory manager: view, edit and organize the facts the model remembers.', zh: '长期记忆管理：查看、编辑和整理模型记住的事实。' },
          },
        }), 'memory tab type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: 'memory',
        }, MemoryBody)), 'memory tab body')
      },
    }
  },
})
