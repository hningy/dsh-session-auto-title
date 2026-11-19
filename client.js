/**
 * Settings page for session-auto-title.
 *
 * Registers one page under Settings → 会话标题 with a master switch and the
 * retitle cadence. Values live in the row's own config and are saved through
 * the Host route registered by `index.js`; saving reloads that row, so the page
 * re-reads the effective values after each save.
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-auto-title',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const URL = '/plugins/dsh-session-auto-title/config.json'
    const NS = 'session-auto-title'

    const TEXT = {
      zh: {
        nav: '会话标题',
        title: '会话标题自动更新',
        intro: '根据整段对话自动重命名会话，而不是只看第一条消息。',
        enabled: '启用自动命名',
        enabledHint: '关闭后不再改写任何标题，已有标题保持不变。',
        cadence: '触发时机',
        everyPrompt: '每条新消息',
        everyN: '每 N 条消息',
        everyNHint: '攒够这么多条新消息才重新命名一次，能省掉大部分辅助请求。',
        preserve: '标题仍准确时保持不变',
        preserveHint: '关闭后每次触发都会重写标题，哪怕话题没变。',
        length: '中文标题目标字数',
        lengthHint: '英文等非中文标题按比例换算。',
        window: '参与命名的消息条数',
        windowHint: '最早的发言永远保留作为锚点，其余取最近的若干条。',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        reset: '恢复默认',
        loading: '读取中…',
        failed: '读取失败',
        noEditor: '这个 profile 不支持保存配置，只能改 cordis.patch.yml。',
        saveFailed: '保存失败',
        note: '保存会重载插件行，之后从下一条消息开始生效。手动改过名的会话不会被覆盖。',
      },
      en: {
        nav: 'Session titles',
        title: 'Automatic session titles',
        intro: 'Retitles a session from the whole conversation, not just its first message.',
        enabled: 'Automatic renaming',
        enabledHint: 'When off, no title is rewritten and existing titles stay as they are.',
        cadence: 'When to retitle',
        everyPrompt: 'Every new message',
        everyN: 'Every N messages',
        everyNHint: 'Wait for this many new messages before retitling, which saves most auxiliary requests.',
        preserve: 'Keep the title while it still fits',
        preserveHint: 'Turn off to rewrite on every trigger even when the topic is unchanged.',
        length: 'CJK title length',
        lengthHint: 'Non-CJK titles scale with this target.',
        window: 'Messages sent to the model',
        windowHint: 'The oldest prompt is always kept as an anchor; the rest is the newest window.',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        reset: 'Restore defaults',
        loading: 'Loading…',
        failed: 'Could not load',
        noEditor: 'This profile cannot save configuration; edit cordis.patch.yml instead.',
        saveFailed: 'Save failed',
        note: 'Saving reloads the plugin row and applies from the next message. Sessions you renamed by hand are never overwritten.',
      },
    }

    const DEFAULTS = {
      enabled: true,
      trigger: 'every-prompt',
      everyNPrompts: 3,
      preserveAccurateTitle: true,
      targetCjkCharacters: 12,
      maxMessages: 12,
    }

    function styles(dark) {
      return {
        page: {
          display: 'flex', flexDirection: 'column', gap: 20,
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 13, lineHeight: 1.55,
        },
        card: {
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
          borderRadius: 10, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
        },
        heading: { fontSize: 14, fontWeight: 600, margin: 0 },
        intro: { color: 'var(--dsw-alias-label-secondary)', margin: 0 },
        row: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
        rowText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
        label: { fontWeight: 500 },
        hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
        switch: (on) => ({
          appearance: 'none', border: 'none', cursor: 'pointer', flex: 'none',
          width: 40, height: 22, borderRadius: 11, padding: 2, marginTop: 2,
          background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-idle-primary)',
          transition: 'background 120ms ease',
          display: 'flex', alignItems: 'center',
        }),
        knob: (on) => ({
          width: 18, height: 18, borderRadius: 9, background: '#fff',
          transform: on ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform 120ms ease',
        }),
        select: {
          minWidth: 180, padding: '6px 8px', fontSize: 13, borderRadius: 8,
          color: 'var(--dsw-alias-label-primary)',
          background: 'var(--dsw-alias-bg-layer-2)',
          border: '1px solid var(--dsw-alias-border-l2)',
        },
        number: {
          width: 72, padding: '6px 8px', fontSize: 13, borderRadius: 8, textAlign: 'right',
          color: 'var(--dsw-alias-label-primary)',
          background: 'var(--dsw-alias-bg-layer-2)',
          border: '1px solid var(--dsw-alias-border-l2)',
        },
        actions: { display: 'flex', alignItems: 'center', gap: 10 },
        primary: {
          padding: '7px 16px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
          color: '#fff', background: 'var(--dsw-alias-brand-primary)', border: 'none',
        },
        secondary: {
          padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
          color: 'var(--dsw-alias-label-primary)', background: 'transparent',
          border: '1px solid var(--dsw-alias-border-l2)',
        },
        status: (kind) => ({
          fontSize: 12,
          color: kind === 'error'
            ? 'var(--dsw-alias-state-error-primary)'
            : kind === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)',
        }),
        note: {
          fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
          borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 10,
        },
      }
    }

    function Switch({ checked, onChange, label }) {
      const s = styles()
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
        style: s.switch(checked), onClick: () => onChange(!checked),
      }, h('span', { style: s.knob(checked) }))
    }

    function Row({ label, hint, children }) {
      const s = styles()
      return h('div', { style: s.row },
        h('div', { style: s.rowText },
          h('span', { style: s.label }, label),
          hint ? h('span', { style: s.hint }, hint) : null),
        children)
    }

    function SettingsPage(props) {
      const locale = props?.locale ?? 'zh'
      const t = TEXT[locale] ?? TEXT.zh
      const s = styles()
      const [doc, setDoc] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [status, setStatus] = React.useState({ kind: 'idle', text: t.loading })
      const [canSave, setCanSave] = React.useState(true)

      React.useEffect(() => {
        let alive = true
        fetch(URL, { cache: 'no-store' })
          .then(async response => {
            const payload = await response.json()
            if (!alive) return
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
            setDoc(payload.config)
            setDraft(payload.config)
            setCanSave(payload.canSave !== false)
            setStatus({ kind: 'idle', text: '' })
          })
          .catch(error => {
            if (alive) setStatus({ kind: 'error', text: `${t.failed}: ${error.message}` })
          })
        return () => { alive = false }
      }, [])

      const patch = next => setDraft(current => ({ ...current, ...next }))

      const save = async () => {
        if (draft === null) return
        setStatus({ kind: 'idle', text: t.saving })
        try {
          const response = await fetch(URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(draft),
          })
          const payload = await response.json()
          if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
          setDoc(payload.config)
          setDraft(payload.config)
          setStatus({ kind: 'ok', text: t.saved })
        } catch (error) {
          setStatus({ kind: 'error', text: `${t.saveFailed}: ${error.message}` })
        }
      }

      if (draft === null) {
        return h('div', { style: s.page },
          h('p', { style: s.status(status.kind) }, status.text))
      }

      const dirty = JSON.stringify(draft) !== JSON.stringify(doc)

      return h('div', { style: s.page },
        h('div', { style: s.card },
          h('h2', { style: s.heading }, t.title),
          h('p', { style: s.intro }, t.intro),
          h('div', { style: s.row },
            h('div', { style: s.rowText },
              h('span', { style: s.label }, t.enabled),
              h('span', { style: s.hint }, t.enabledHint)),
            h(Switch, {
              checked: draft.enabled, label: t.enabled,
              onChange: value => patch({ enabled: value }),
            }))),

        h('div', { style: s.card },
          h(Row, { label: t.cadence, hint: draft.trigger === 'every-n' ? t.everyNHint : null },
            h('select', {
              style: s.select, value: draft.trigger,
              'aria-label': t.cadence,
              disabled: !draft.enabled,
              onChange: event => patch({ trigger: event.target.value }),
            },
              h('option', { value: 'every-prompt' }, t.everyPrompt),
              h('option', { value: 'every-n' }, t.everyN))),
          draft.trigger === 'every-n'
            ? h(Row, { label: t.everyN, hint: t.everyNHint },
              h('input', {
                type: 'number', min: 1, max: 50, style: s.number,
                value: draft.everyNPrompts, 'aria-label': t.everyN,
                disabled: !draft.enabled,
                onChange: event => patch({ everyNPrompts: Number(event.target.value) }),
              }))
            : null,
          h('div', { style: s.row },
            h('div', { style: s.rowText },
              h('span', { style: s.label }, t.preserve),
              h('span', { style: s.hint }, t.preserveHint)),
            h(Switch, {
              checked: draft.preserveAccurateTitle, label: t.preserve,
              onChange: value => patch({ preserveAccurateTitle: value }),
            }))),

        h('div', { style: s.card },
          h(Row, { label: t.length, hint: t.lengthHint },
            h('input', {
              type: 'number', min: 2, max: 40, style: s.number,
              value: draft.targetCjkCharacters, 'aria-label': t.length,
              onChange: event => patch({ targetCjkCharacters: Number(event.target.value) }),
            })),
          h(Row, { label: t.window, hint: t.windowHint },
            h('input', {
              type: 'number', min: 1, max: 60, style: s.number,
              value: draft.maxMessages, 'aria-label': t.window,
              onChange: event => patch({ maxMessages: Number(event.target.value) }),
            }))),

        h('div', { style: s.actions },
          h('button', {
            type: 'button', style: s.primary,
            disabled: !canSave || !dirty || status.text === t.saving,
            onClick: save,
          }, status.text === t.saving ? t.saving : t.save),
          h('button', {
            type: 'button', style: s.secondary,
            onClick: () => patch(DEFAULTS),
          }, t.reset),
          h('span', { style: s.status(status.kind) }, status.text)),

        !canSave ? h('p', { style: s.status('error') }, t.noEditor) : null,
        h('p', { style: s.note }, t.note))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: NS,
          order: 55,
          label: () => TEXT.zh.nav,
        }, SettingsPage))
      },
    }
  },
})
