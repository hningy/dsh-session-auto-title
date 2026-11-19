# Changelog

## 1.1.0

- Add a settings page (**Settings → Session titles**) with a master switch, retitle cadence (every message or every N messages), title length, and conversation window size.
- Persist settings through the profile config editor; saving reloads the row and applies from the next message.
- Retire `minNewPrompts` in favour of `trigger` + `everyNPrompts`; the retired key is dropped on save.
- Share one validated settings object between the provider and the settings route.

## 1.0.0

- First release: a conversation-wide session-title provider that replaces the shipped first-prompt provider.
- Samples the conversation (oldest prompt as an anchor plus the newest window), bounds the auxiliary request by bytes, tokens, and time, and never overrides a manual rename.
- Package imports nothing, so it activates identically from a `link:` development install and from a registry install.
