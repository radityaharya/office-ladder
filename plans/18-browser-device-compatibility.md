# Browser And Device Compatibility

Status: Proposed
Owner: Frontend engineering and quality
Updated: 2026-07-18

## Supported Browsers

Full support:

- Chrome and Edge latest two major versions on Windows.
- Firefox latest two on Windows/macOS.
- Safari current and previous major, minimum 16.4.
- Chrome latest two on Android 10+.
- Safari current/previous iOS and iPadOS, minimum 16.4.

Best effort:

- Samsung Internet.
- Firefox Android.
- ChromeOS and desktop Linux.
- Foldables and uncommon tablets.
- Compatible embedded webviews.

Unsupported browsers receive a clear message before room entry.

## Device Classes

### Desktop

- Minimum usable 1024x600.
- Recommended 1280x720+.
- Complete mouse, trackpad, and keyboard support.

### Tablet

- Fully playable portrait/landscape.
- Touch targets at least 44x44 CSS pixels.
- Collapsible rails and readable board.

### Mobile

- Minimum target 320x568, normal baseline 360x640.
- Core create/join/ready/roll/choose/end/reconnect/result flows work.
- Layout restructures rather than shrinking desktop.
- Advanced polish can follow MVP, but participation is required.

## Rendering

Prefer DOM/SVG over canvas/WebGL for core board and controls. Canvas may be decorative only.

- State and presentation separated.
- Transform/opacity animation.
- Final state available immediately.
- Reduced/minimal quality modes.
- No game rule depends on animation completion.

## Input Layer

Map pointer, touch, keyboard, and gamepad to semantic actions. Game logic never receives raw key codes or pointer coordinates.

### Pointer/Touch

- Use Pointer Events.
- Commit activation on completed click/tap, not pointerdown.
- Drag is never required for a core action.
- Handle pointer cancel/orientation interruption.
- Avoid duplicate synthetic activation.
- Preserve native scrolling outside explicit drag surfaces.

### Keyboard

- Full core operation.
- No global shortcut while typing.
- Ignore key repeat for one-shot actions.
- Roving focus for board/hand.
- Browser-reserved shortcuts untouched.
- Works at 200% zoom.

### Gamepad

Progressive enhancement after primary inputs stabilize.

- D-pad/stick navigation.
- A/Cross confirm, B/Circle cancel.
- Poll only after connection and while visible.
- Dead zones and edge-triggered buttons.
- Keyboard/pointer remain available.

## Viewport And Orientation

- Do not lock orientation.
- Use layout modes rather than device detection.
- Prefer container/media queries.
- Use `100dvh` and safe-area insets.
- Recompute board with `ResizeObserver`.
- Preserve focus and authoritative state through reflow.
- Handle virtual keyboard and split-screen.

## Background Tabs And Suspension

- Server owns deadlines.
- Client derives remaining time from absolute deadline.
- Pause cosmetic animation/gamepad/audio when hidden.
- On visible/pageshow, verify channel and fetch current snapshot.
- Never rely on unload to mark disconnect.
- Do not replay missed animation history after suspension.

## Audio Autoplay

- Audio optional and user-unlocked.
- Silent fallback always playable.
- Persist mute preference.
- Stop duplicate sounds after reconnect.
- Audio never uniquely communicates state.

## Realtime Behavior

Connection states:

- Connecting.
- Connected.
- Reconnecting.
- Resynchronizing.
- Offline.
- Session expired.
- Room closed.
- Incompatible client.

Disable authoritative submissions until synchronized. Retry only with the same command ID. Fetch snapshot after reconnect and detect sequence gaps.

`navigator.onLine` is only a hint.

## PWA/Offline Boundary

MVP does not support offline turns.

- Active matches require network.
- Offline state is read-only with reconnect controls.
- Do not queue gameplay commands offline.
- Installable manifest may ship without offline gameplay.
- Delay service-worker caching until protocol/version strategy is stable.
- Never serve cached game state as current authority.
- No background sync for commands.

## Resource Budgets

- Gameplay JS under approximately 300 KB compressed.
- Essential initial visual assets under 1.5 MB.
- Initial audio under 1 MB.
- Event history DOM bounded to roughly 50-100 entries.
- Deduplication sets bounded/pruned.
- Flat memory trend over 2-hour sessions.

Clean subscriptions, timers, observers, animation frames, object URLs, and audio resources on leave/unmount.

## Quality Ladder

### Standard

Full movement, dice, card transitions, modest particles, normal sound.

### Reduced

Shorter movement, no background effects, lower particle/audio concurrency.

### Minimal

Immediate transitions, static dice, no particles, essential/muted sound, simplified visuals.

Choose through explicit setting, reduced-motion, measured performance, and capability hints. Never block based on device hints.

## Capability Detection

Feature detect Pointer Events, coarse pointer, hover, touch points, gamepad, Web Audio, reduced motion, standalone, service worker, ResizeObserver, and WebSocket.

Touch support does not mean mobile. Input mode can change during a session.

## Test Matrix

PR:

- Chromium, Firefox, WebKit desktop.
- Chromium and WebKit mobile emulation.
- Keyboard-only.
- Reduced motion.
- Offline/reconnect smoke.

Release physical devices:

- Windows Chrome/Edge/Firefox.
- macOS Safari/Chrome.
- Recent and oldest supported iPhone.
- Recent and lower-end Android.
- iPad touch and keyboard/trackpad.
- Android tablet/foldable.
- Xbox-style gamepad on desktop.

Network tests include latency, packet loss, Wi-Fi/cellular transition, background 1/10 minutes, process kill/reopen, duplicate commands, event gaps, session expiry, and deploy mismatch.

## Acceptance Criteria

- Touch and keyboard can complete every core action.
- Backgrounding cannot extend authoritative timers.
- Returning from suspension shows current server state.
- Audio-blocked and optional-capability-missing browsers remain playable.
- Orientation/split-screen/virtual keyboard never hide required controls.
- Two-hour simulation has no unbounded memory growth.
- Unsupported browsers fail clearly rather than partially.
