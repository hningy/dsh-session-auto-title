/**
 * Conversation-wide session-title provider for DeepSeek Harness.
 *
 * Replaces the shipped first-prompt provider: every new human prompt retitles
 * the session from the whole user side of the conversation. The current title
 * is preserved while it still describes the session, long sessions are sampled
 * instead of failing, and a manual rename is never overridden (the title
 * service pins user-sourced titles).
 *
 * This package deliberately imports nothing: a profile-installed bundle is a
 * symlink to the user's workspace, so `@deepseek-ai/*` specifiers would not
 * resolve from that real path. Everything it needs arrives through the Cordis
 * context (`ctx.sessionTitle` and `ctx.llm`).
 */

export const name = 'session-auto-title'

export const inject = ['sessionTitle', 'llm']

/** Defaults for every configurable field; the patch layer may override each one. */
const DEFAULTS = {
  enabled: true,
  trigger: 'every-prompt',
  everyNPrompts: 3,
  targetWords: 6,
  targetCjkCharacters: 12,
  maxInputBytes: 8192,
  maxOutputTokens: 64,
  timeoutMs: 45000,
  maxMessages: 12,
  maxCharsPerMessage: 600,
  preserveAccurateTitle: true,
}

/** Cadences the settings page offers; anything else falls back to the first. */
const TRIGGERS = ['every-prompt', 'every-n']

const ELLIPSIS = '…'
/** Hard cap before the title service applies its own `maxTitleBytes`. */
const TITLE_BYTE_CEILING = 320

/** Read one positive integer option. */
function positiveInteger(config, field) {
  const value = config[field] ?? DEFAULTS[field]
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-auto-title: ${field} must be a positive integer`)
  }
  return value
}

/** Read one optional non-empty string option. */
function optionalString(config, field) {
  const value = config[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`session-auto-title: ${field} must be a non-empty string when present`)
  }
  return value
}

/** Validate the raw row config once, at activation. */
function resolveConfig(raw) {
  const config = raw ?? {}
  if (typeof config !== 'object') throw new Error('session-auto-title: config must be an object')
  const provider = optionalString(config, 'provider')
  const model = optionalString(config, 'model')
  if ((provider === undefined) !== (model === undefined)) {
    throw new Error('session-auto-title: provider and model must be configured together')
  }
  const preserve = config.preserveAccurateTitle ?? DEFAULTS.preserveAccurateTitle
  if (typeof preserve !== 'boolean') {
    throw new Error('session-auto-title: preserveAccurateTitle must be a boolean')
  }
  const enabled = config.enabled ?? DEFAULTS.enabled
  if (typeof enabled !== 'boolean') throw new Error('session-auto-title: enabled must be a boolean')
  const trigger = TRIGGERS.includes(config.trigger) ? config.trigger : DEFAULTS.trigger
  const everyN = positiveInteger(config, 'everyNPrompts')
  return {
    enabled,
    trigger,
    enabledCadence: trigger === 'every-n' ? everyN : 1,
    everyNPrompts: everyN,
    targetWords: positiveInteger(config, 'targetWords'),
    targetCjkCharacters: positiveInteger(config, 'targetCjkCharacters'),
    maxInputBytes: positiveInteger(config, 'maxInputBytes'),
    maxOutputTokens: positiveInteger(config, 'maxOutputTokens'),
    timeoutMs: positiveInteger(config, 'timeoutMs'),
    maxMessages: positiveInteger(config, 'maxMessages'),
    maxCharsPerMessage: positiveInteger(config, 'maxCharsPerMessage'),
    preserveAccurateTitle: preserve,
    route: provider === undefined ? undefined : { provider, model },
  }
}

/** Truncate by Unicode code points so a surrogate pair is never split. */
function clipText(text, maxChars) {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return text
  return `${chars.slice(0, maxChars).join('')}${ELLIPSIS}`
}

/** Collapse whitespace and drop control characters the client row cannot show. */
function normalizeTitle(text, maxBytes) {
  const cleaned = String(text)
    // eslint-disable-next-line no-control-regex -- control characters must not reach the client.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (Buffer.byteLength(cleaned, 'utf8') <= maxBytes) return cleaned
  let out = ''
  for (const char of cleaned) {
    if (Buffer.byteLength(out + char, 'utf8') > maxBytes) break
    out += char
  }
  return out.trim()
}

/** Frame the selection as JSON so user text cannot break structural delimiters. */
function frameInput(messages, currentTitle) {
  return JSON.stringify({
    currentTitle: currentTitle ?? null,
    userMessages: messages.map(message => ({ seq: message.seq, text: message.text })),
  })
}

/** Keep the oldest prompt as an anchor plus the newest window, bounded by count. */
function pickMessages(messages, config) {
  const clipped = messages.map(message => ({
    seq: message.seq,
    text: clipText(message.text, config.maxCharsPerMessage),
  }))
  if (clipped.length <= config.maxMessages) return clipped
  const tail = Math.max(1, config.maxMessages - 1)
  return [clipped[0], ...clipped.slice(clipped.length - tail)]
}

/**
 * Sample the conversation down to the configured byte budget. Long sessions
 * lose older middle prompts instead of failing the request outright.
 */
function selectInput(messages, currentTitle, config) {
  let picked = pickMessages(messages, config)
  let input = frameInput(picked, currentTitle)
  let guard = config.maxMessages + 8
  while (Buffer.byteLength(input, 'utf8') > config.maxInputBytes && picked.length > 1 && guard-- > 0) {
    picked = [picked[0], ...picked.slice(Math.max(2, Math.ceil(picked.length / 2)))]
    input = frameInput(picked, currentTitle)
  }
  while (Buffer.byteLength(input, 'utf8') > config.maxInputBytes && guard-- > 0) {
    const chars = Array.from(picked[0].text)
    if (chars.length <= 8) {
      throw new Error('session-auto-title: the newest prompt alone exceeds maxInputBytes')
    }
    picked = [{ ...picked[0], text: `${chars.slice(0, Math.floor(chars.length / 2)).join('')}${ELLIPSIS}` }]
    input = frameInput(picked, currentTitle)
  }
  if (Buffer.byteLength(input, 'utf8') > config.maxInputBytes) {
    throw new Error('session-auto-title: could not fit the conversation into maxInputBytes')
  }
  return { messages: picked, input }
}

/** System instruction for one whole-conversation title revision. */
function systemPrompt(config) {
  const preserve = config.preserveAccurateTitle
    ? '若 currentTitle 仍然准确描述这个会话，就原样返回它，不要改写；只有话题明显变化或扩展时才重写。'
    : '不要照抄 currentTitle，请独立给出当前最贴切的标题。'
  return [
    '你在为 AI 编程助手（DeepSeek Harness）的一个会话命名。',
    '输入是一个 JSON 对象：userMessages 按时间顺序列出用户在这个会话里说过的话，为了节省长度可能省略了较早的部分；currentTitle 是当前标题，没有则为 null。',
    '输出要求：',
    '- 只输出标题本身，一行纯文本，不要引号或书名号包裹，不要“标题：”之类的前缀，不要解释、Markdown、代码块或 emoji。',
    `- 用会话的主要语言书写；中文约 ${config.targetCjkCharacters} 个字，其他语言约 ${config.targetWords} 个词。`,
    '- 标题要具体、可辨识，点明真正在做的对象或任务；不要用“帮助”“问题”“对话”“聊天”这类空泛词。',
    `- ${preserve}`,
    '- 内容不足以命名时，给出最简短合理的标题。',
  ].join('\n')
}

/** Emphasis wrapping a whole line, such as `**Title**`. */
const EMPHASIS_WRAPPER = /^(?<marker>\*{1,3})(?<inner>\S(?:.*\S)?)\k<marker>$/u

/** Wrapping quote pairs a model may add despite the instruction. */
const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
]

/** Leading Markdown or label noise a model may prepend. */
const LEADING_LABEL = /^(?:#{1,6}\s*|>\s*|[-*]\s+|(?:标题|会话标题|title|session title)\s*[:：]\s*)/iu

/** Remove wrapping quotes and code spans so they never reach the client row. */
function stripWrapping(text) {
  if (text.length > 2 && text.startsWith('`') && text.endsWith('`')) return text.slice(1, -1).trim()
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim()
    }
  }
  return text
}

/** Take the title from model output: the first non-empty line, unwrapped. */
function titleFromOutput(text) {
  const line = text
    .split(/\r?\n/u)
    .map(item => item.trim())
    .find(item => item.length > 0) ?? ''
  const groups = EMPHASIS_WRAPPER.exec(line)?.groups
  const marker = groups?.['marker']
  const inner = groups?.['inner']
  const unwrapped = marker === undefined || inner === undefined || inner.includes(marker) ? line : inner
  return stripWrapping(unwrapped.replace(LEADING_LABEL, '')).trim()
}

/** Highest message seq already covered by the accepted title, or -1. */
function lastCoveredSeq(currentTitle) {
  const seqs = currentTitle?.messageSeqs ?? []
  return seqs.length === 0 ? -1 : Math.max(...seqs)
}

/** Route for the auxiliary title call: the configured pair, else the logged main request. */
function resolveRoute(config, request) {
  if (config.route !== undefined) return config.route
  if (request.route === undefined) {
    throw new Error('session-auto-title: no logged request route yet; configure provider and model together')
  }
  return request.route
}

/** Stream one auxiliary title request and return its text plus terminal reason. */
async function completeTitle(ctx, config, request, route, system, input) {
  const timeout = AbortSignal.timeout(config.timeoutMs)
  const signal = AbortSignal.any([request.signal, timeout])
  signal.throwIfAborted()
  const call = await ctx.llm.prepareCall(
    { provider: route.provider, model: route.model, maxTokens: config.maxOutputTokens },
    signal,
    (controls, model) => {
      const effort = model.reasoning?.efforts?.[0]?.id
      return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
    },
  )
  const options = {
    ...call.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
    system,
    sessionId: request.session.id,
    purpose: 'session-title',
    signal,
  }
  let text = ''
  let sawToolCall = false
  let finish
  for await (const chunk of call.stream(options)) {
    signal.throwIfAborted()
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'block-start' && chunk.blockType === 'tool-call') sawToolCall = true
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  signal.throwIfAborted()
  if (finish === undefined) throw new Error('session-auto-title: title stream ended without a finish reason')
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const error = new Error(finish.failure?.message ?? 'title request failed')
    error.code = finish.failure?.code
    throw error
  }
  if (sawToolCall) throw new Error('session-auto-title: title output must contain text only')
  if (finish.kind === 'max-tokens') throw new Error('session-auto-title: title output reached maxOutputTokens')
  return text
}

/** Derive the accepted title text from one model response. */
function titleFromResponse(text) {
  const title = normalizeTitle(titleFromOutput(text), TITLE_BYTE_CEILING)
  if (title.length === 0) throw new Error('session-auto-title: title model produced no text')
  return title
}

/**
 * Register the whole-conversation title provider and, when the host can
 * persist configuration, the settings route the Settings page talks to.
 * @param ctx - context exposing the session-title and LLM services.
 * @param raw - row config: switch, cadence, title length targets, sampling, and byte/token/timeout policy.
 */
export function apply(ctx, raw) {
  const config = resolveConfig(raw)
  const titleProvider = name
  /** Live settings, replaced in place when the row reloads with new values. */
  const settings = { ...config }

  // Switched off: register no provider, so titles stay exactly as they are
  // (no fallback churn, no auxiliary model call).
  if (settings.enabled) {
    ctx.sessionTitle.register({
      id: titleProvider,
      automatic: 'all-prompts',
      async generate(request) {
        const messages = request.messages
        const newest = messages[messages.length - 1]
        const current = request.currentTitle
        const fresh = messages.filter(message => message.seq > lastCoveredSeq(current))

        // Below the configured prompt threshold, restate the accepted title
        // without spending a model call; the next prompt schedules a revision.
        if (current !== undefined && fresh.length < settings.enabledCadence) {
          const covered = new Set(messages.map(message => message.seq))
          const keep = current.messageSeqs.filter(seq => covered.has(seq))
          return { title: current.title, messageSeqs: keep.length > 0 ? keep : [newest.seq] }
        }

        const selected = selectInput(messages, current?.title ?? null, settings)
        const route = resolveRoute(settings, request)
        const text = await completeTitle(
          ctx,
          settings,
          request,
          route,
          systemPrompt(settings),
          selected.input,
        )
        return {
          title: titleFromResponse(text),
          messageSeqs: selected.messages.map(message => message.seq),
          model: route,
        }
      },
    })
  }

  registerSettingsRoute(ctx)
}

/** Path the Settings page reads and writes. */
export const SETTINGS_PATH = '/plugins/dsh-session-auto-title/config.json'

/** Fields the settings page may change, with the values it should show. */
function settingsView(config) {
  return {
    enabled: config.enabled,
    trigger: config.trigger,
    everyNPrompts: config.everyNPrompts,
    preserveAccurateTitle: config.preserveAccurateTitle,
    targetCjkCharacters: config.targetCjkCharacters,
    targetWords: config.targetWords,
    maxMessages: config.maxMessages,
  }
}

/** Accept only the fields this page owns, and only with usable values. */
function sanitizePatch(body) {
  const patch = {}
  if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled
  if (TRIGGERS.includes(body?.trigger)) patch.trigger = body.trigger
  if (Number.isInteger(body?.everyNPrompts) && body.everyNPrompts > 0 && body.everyNPrompts <= 50) {
    patch.everyNPrompts = body.everyNPrompts
  }
  if (typeof body?.preserveAccurateTitle === 'boolean') patch.preserveAccurateTitle = body.preserveAccurateTitle
  if (Number.isInteger(body?.targetCjkCharacters) && body.targetCjkCharacters > 0 && body.targetCjkCharacters <= 40) {
    patch.targetCjkCharacters = body.targetCjkCharacters
  }
  if (Number.isInteger(body?.maxMessages) && body.maxMessages > 0 && body.maxMessages <= 60) {
    patch.maxMessages = body.maxMessages
  }
  return patch
}

/**
 * Register the settings route once the HTTP carrier is available.
 *
 * `webServer` is a sibling row that can mount after this bundle on a cold
 * start, so reading it once during `apply` would silently skip registration
 * and leave the Settings page fetching a 404. `ctx.inject` re-runs this child
 * whenever the service appears (and again after an HMR reload), which keeps the
 * route alive across restarts.
 */
function registerSettingsRoute(ctx) {
  const mount = child => {
    const webServer = child.get('webServer')
    if (webServer === undefined || typeof webServer.register !== 'function') return

    const reply = (res, status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      })
      res.end(body)
    }

    const handler = async (req, res) => {
      try {
        const entry = child.fiber?.entry ?? ctx.fiber?.entry
        if (entry === undefined) {
          reply(res, 503, { error: 'this profile row cannot be addressed for saving' })
          return
        }
        const current = resolveConfig(entry.options?.config ?? {})
        const editor = child.get('configEditor')
        if (req.method === 'GET' || req.method === 'HEAD') {
          reply(res, 200, { config: settingsView(current), canSave: editor !== undefined })
          return
        }
        if (req.method !== 'POST') {
          reply(res, 405, { error: 'use GET or POST' })
          return
        }
        if (editor === undefined) {
          reply(res, 503, { error: 'this profile has no config editor, so changes cannot be saved' })
          return
        }
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const patch = sanitizePatch(body)
        if (Object.keys(patch).length === 0) {
          reply(res, 400, { error: 'no usable field in this request' })
          return
        }
        await editor.edit(entry, previous => {
          // `minNewPrompts` was replaced by `trigger` + `everyNPrompts`; drop the
          // retired key so the stored row keeps only fields that still mean something.
          const { minNewPrompts: _retired, ...rest } = previous
          return { ...rest, ...patch }
        })
        const saved = resolveConfig(entry.options?.config ?? {})
        reply(res, 200, { config: settingsView(saved), canSave: true })
      } catch (error) {
        reply(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    }

    child.effect(() => webServer.register({ kind: 'exact', path: SETTINGS_PATH, handler }))
  }

  if (typeof ctx.inject !== 'function') {
    mount(ctx)
    return
  }
  const dispose = ctx.inject(['webServer'], mount)
  ctx.effect(() => dispose)
}
