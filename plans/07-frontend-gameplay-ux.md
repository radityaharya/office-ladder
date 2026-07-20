# Frontend Gameplay UX

Status: Proposed
Owner: Frontend and product design
Updated: 2026-07-18

## Outcome

Build a responsive board-game table that clearly communicates the current phase, legal action, consequences, private information, and connection state without resembling a corporate dashboard.

## Experience Hierarchy

1. What is happening now?
2. Who must act?
3. What can the local player do?
4. What changed?
5. How is every player progressing?
6. What can be inspected while waiting?

## Route Model

Use one stable room URL across lobby, role reveal, play, reconnect, and results where practical:

```text
/[lang]/rooms/[roomCode]
```

The route `loader` validates access and loads a sanitized bootstrap. The route component owns Realtime, timers, input, and animations.

## Room State Machine

```text
bootstrapping -> lobby -> role-reveal -> playing -> results -> rematch-lobby
bootstrapping -> not-found | access-denied
any connected state <-> reconnecting/resynchronizing
playing -> spectator when allowed
```

Gameplay phases are explicit:

```text
turn-start
awaiting-roll
rolling
moving
resolving-space
awaiting-prompt
reaction-window
resolving-effect
turn-summary
game-over
```

Avoid combinations of unrelated booleans such as `isRolling && showPrompt && reactionOpen`.

## Desktop Shell

```text
top HUD: room, round, phase, timer, settings
left rail: players
center: board and shared event focus
right rail: activity, reactions, optional chat
bottom: private hand and action dock
```

The board gets layout priority. Side rails collapse before the board becomes unreadable.

## Mobile Shell

- Persistent turn/phase/timer header.
- Horizontal player strip.
- Readable board viewport with Follow and Inspect modes.
- Prompt summary above controls.
- Horizontal scroll-snap hand.
- Primary action above safe-area inset.
- Secondary panels in drawers.

Never require precise tapping on a tiny board tile for a core action.

## Lobby

Required:

- Room code and invite-copy confirmation.
- Roster, host, ready state, and connection state.
- Mode/player-count disclosure.
- Personal Ready control.
- Host Start control with explicit disabled reason.
- Host transfer, remove player, leave, and settings flows.

Keep chat secondary or omit it from MVP.

## Board

Use semantic HTML/CSS/SVG, not an inaccessible canvas-only surface.

Each space exposes:

- Position number and localized name.
- Tile type and short effect.
- Occupants.
- Origin/destination/current selection state.
- Accessible label such as “Space 18 of 44.”

The visual board center displays one shared focus at a time: dice, current card, consequence, promotion, or result.

## Tokens

Identify players through shape, color, seat number/monogram, and accessible name. Handle multiple occupants with offsets or a stack that opens an occupant inspector.

## HUD And Action Dock

The HUD answers:

- Whose turn?
- Which phase?
- How much time remains?

The Action Dock owns the current decision and contains:

- Primary action.
- Secondary legal actions.
- Explanation and consequences.
- Deadline.
- Pending/rejected command feedback.
- Keyboard/gamepad hints.

When waiting, it remains useful for React, Inspect, or Rules actions.

## Player Panels

Show public information only:

- Name/token.
- Rank.
- Public resources and statuses.
- Hand count.
- Connection/AFK state.
- Active-player marker.

Keep player order stable rather than reordering every turn by score.

## Hand And Cards

Desktop: bottom rail with selected-card preview.

Mobile: scroll-snap strip with one focused card and a readable details panel.

Card states:

- Legal.
- Focused/selected.
- Illegal with visible reason.
- Pending.
- Played/discarded.
- Newly drawn.

Targeted cards use: select card -> choose valid target -> confirm. `Escape` cancels and restores focus.

## Prompts And Reactions

Prompts come from authoritative state and include ID, actor, options, deadline, and timeout policy.

Desktop places narrative context in the board center and controls in the Action Dock. Mobile keeps immediate options reachable and details in a drawer.

Gameplay reactions:

- Everyone sees a window is open.
- Only eligible players see enabled controls.
- Eligibility and hand contents remain private.
- Explicit Pass is available.
- Resolution order comes from the server.

Social reactions are separate, nonblocking, lossy, and rate-limited.

## Timers

Render from server `deadlineAt` plus estimated clock offset. Never treat a client interval as authority.

- Safe: neutral with restrained progress.
- Under 10 seconds: increased contrast.
- Under 5 seconds: penalty treatment, optional local sound/haptic.
- Local expiry: show `Resolving...` until server result arrives.

## Hidden Role Reveal

Use a private, deliberate reveal flow:

1. Privacy warning.
2. Hold/click to reveal.
3. Read objective and ability.
4. Acknowledge.
5. Re-hide automatically when appropriate.

Never auto-speak or auto-display the role on load. Keep role data out of public DOM, analytics, logs, and event feeds.

## Reconnect

Short interruptions keep the board visible with a compact status strip and disabled commands.

On reconnect:

1. Fetch current authorized snapshot.
2. Reconcile sequence/revision.
3. Restore prompt and timer.
4. Skip obsolete animations.
5. Announce current orientation, such as “Reconnected. Maya is choosing a card.”

## Client State

Keep separate:

- Authoritative public projection.
- Local private projection.
- Connection state.
- Ephemeral UI state.
- Presentation/animation queue.

Start with a pure reducer plus `useSyncExternalStore` and narrow selector hooks. Do not put all live game state in one broad React context.

## Transport Boundary

UI consumes a provider-neutral adapter:

```ts
interface GameTransport {
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(listener): () => void;
  send(command): Promise<CommandReceipt>;
  requestSnapshot(): Promise<GameBootstrap>;
}
```

Game components do not import Supabase channel APIs directly.

## Animation Queue

Map authoritative events to cues with priorities:

- Blocking: private reveal or required transition.
- Orienting: dice, movement, card play, promotion.
- Ambient: minor counters and social reactions.

State remains authoritative immediately; presentation may catch up, compress, or skip.

## Results

- Let the final move resolve before replacing the board.
- Show winner, standings, notable moments, duration, and rematch controls.
- Preserve the room for a rematch-ready lobby.
- Clear all old private role/hand data before a new match initializes.

## Acceptance Criteria

- Every phase has one obvious primary action.
- Desktop and mobile can complete all core actions.
- Keyboard focus remains stable through prompts and reconnects.
- Private information never appears in public UI state.
- Missing/duplicate events do not corrupt local view state.
- Reduced motion preserves chronology and understanding.
- The board remains the shared visual focus rather than becoming a dashboard.
