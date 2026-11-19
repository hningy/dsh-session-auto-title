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

## 1.1.1

- Register the settings route through `ctx.inject(['webServer'], ...)` instead of reading the service once during `apply`. On a cold start `webServer` can mount after this bundle, which left the route unregistered and made the Settings page fail on load; the route now appears whenever the carrier becomes available and survives an HMR reload.
- Read the route response as text before parsing it, so an inactive plugin or a missing route reports "the plugin is not active or the route is not mounted yet" instead of `Unexpected end of JSON input`.

## 1.1.2

- Retry the settings load up to three times before reporting failure, so a page opened while the route is still mounting shows the controls instead of an error.
