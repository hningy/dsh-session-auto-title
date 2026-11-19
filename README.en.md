# dsh-session-auto-title

[简体中文](README.md) · **English**

Automatically retitle DeepSeek Harness sessions from the **whole conversation** instead of just the first message. Ships a settings page with a master switch and a retitle cadence.

## Why

DeepSeek Harness ships `@deepseek-ai/dsh-session-title-first-prompt-llm`, which titles a session once from its first human message and never revisits it. A session that starts with "help me with a plugin" and drifts into Grafana dashboards keeps calling itself "help me with a plugin".

This plugin registers an `all-prompts` title provider instead: each new user message schedules one title revision that reads the conversation so far.

## Install

```bash
# Web profile
dsh plugin --profile web add dsh-session-auto-title
```

Desktop app: **Settings → Plugins → Add plugin**, then paste `dsh-session-auto-title`.

Restart `dsh web` (or the desktop app) if the bundle does not appear immediately.

## Settings

**Settings → Session titles**:

| Control | Range | Effect |
|---|---|---|
| Automatic renaming | switch | Master switch. Off registers no provider, so no title is rewritten and no auxiliary request is made. |
| When to retitle | every message / every N messages | Retitle cadence. `N` is 1–50. |
| Keep the title while it still fits | switch | Off rewrites on every trigger even when the topic is unchanged. |
| CJK title length | 2–40 | Non-CJK titles scale with this target. |
| Messages sent to the model | 1–60 | The oldest prompt is always kept as an anchor; the rest is the newest window. |

Saving reloads the plugin row and applies from the next message. Values persist in the profile's `cordis.patch.yml` under the `session-auto-title` row.

The remaining fields (`maxInputBytes`, `maxOutputTokens`, `timeoutMs`, `maxCharsPerMessage`, `targetWords`, and an optional `provider`/`model` route) live only in that `config` block.

## Behaviour

- One small auxiliary model request per trigger, using the current main request's provider and model unless `provider`/`model` are set. It never blocks the reply and adds no tokens to the main conversation.
- The accepted title is preserved while it still describes the session, so "continue" or "thanks" never renames anything.
- A title you renamed by hand is pinned by the title service to source `user`; this plugin never overrides it.
- Long sessions are sampled, not abandoned: older middle prompts are dropped and single messages truncated to stay inside `maxInputBytes`.
- Titles are durable `session/title` events, so they survive replay, resume, and forking.

## Cost

Each trigger is one request capped at `maxOutputTokens` (64 by default) with input bounded by `maxInputBytes` (8 KiB by default). Set the cadence to "every N messages" to cut the number of calls.

## Limitations

- Only human text messages feed a title; assistant replies and tool calls are not part of the input.
- Subagent sessions are titled too, so their prompts also trigger requests.
- Titles are capped at 80 bytes by the title service (`maxTitleBytes`), about 26 CJK characters.
- This plugin does not write the `session/title-llm-request` log event that the shipped provider records; the title itself is still a durable `session/title` event carrying its source message seqs and route.
- The package deliberately imports nothing from `@deepseek-ai/*`. A profile bundle installed from a local directory is a symlink to the checkout, where those specifiers do not resolve; using only the Cordis context (`ctx.sessionTitle`, `ctx.llm`, `ctx.get('webServer')`, `ctx.get('configEditor')`) makes the same files work for local and registry installs.
- Disabling or removing this plugin leaves `session-title-llm` disabled, so sessions fall back to the built-in truncated-first-message title. Re-enable that row in `cordis.patch.yml` to restore the shipped provider.

## License

MIT
