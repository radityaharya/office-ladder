# Backend, Persistence, And Realtime

Status: Proposed
Owner: Backend engineering
Updated: 2026-07-18

## Outcome

Use Postgres as the only game authority, Hono route handlers as authenticated command gateways, and Supabase Realtime private Broadcast as committed-update delivery.

## Command Flow

```text
Browser POST command
  -> Better Auth session
  -> room membership/capability authorization
  -> transaction and game-row lock
  -> deterministic engine transition
  -> append events/update snapshot/projections/timers/outbox
  -> commit
  -> Realtime notification
```

Clients never write canonical game state or submit outcomes.

## Room Lifecycle

```text
open -> starting -> active -> completed
  \        \          \
   -> abandoned       -> abandoned
```

Rules:

- Room has one host and 2-6 seats; launch recommendation is 3-6.
- Joining, leaving, readying, settings, host transfer, and starting are commands.
- Starting atomically freezes setup, creates game, assigns secrets, and activates room.
- Presence loss does not remove membership.
- Internal UUIDs and human room codes are separate.

## Proposed Tables

### Core

- `rooms`
- `room_members`
- `games`
- `game_events`
- `game_snapshots`
- `room_projections`
- `player_projections`
- `command_receipts`
- `game_timers`
- `game_outbox`

### Key Fields

`games`:

- Status.
- Stream revision/sequence.
- Current snapshot JSONB.
- Engine/rules/content versions.
- Current turn and deadline.
- State hash.

`game_events`:

- Per-game sequence.
- Event/command IDs.
- Type and schema version.
- Actor.
- Canonical payload.
- Logical timestamp.

`command_receipts`:

- Command ID and request hash.
- Actor/scope/type.
- Accepted/rejected status.
- Stored response and resulting revision.

## Constraints

- Unique active room code.
- Unique active membership per room/user.
- Unique active seat per room.
- Primary/unique `(game_id, sequence)`.
- Unique `(game_id, command_id)`.
- Timer index on status/due time.
- Cleanup indexes on room status/expiry and outbox age.

## Transaction

1. Validate body and payload size.
2. Authenticate Better Auth user.
3. Verify membership and capability.
4. Check command receipt/idempotency.
5. Begin transaction.
6. Lock game row `FOR UPDATE`.
7. Process overdue deterministic timeout first.
8. Validate expected revision and current phase.
9. Execute engine.
10. Append contiguous events.
11. Update snapshot/revision/hash.
12. Update public and affected private projections.
13. Replace/cancel timers.
14. Insert sanitized outbox rows.
15. Save command receipt.
16. Commit.
17. Return authoritative receipt.

Retries use the same command ID and receive the original result.

## Event Store And Snapshots

- Events are immutable and sufficient for verification/replay.
- Current snapshot updates on every successful command.
- Historical snapshots occur every 20-50 events and at major boundaries.
- Recovery loads a compatible snapshot then replays subsequent events.
- Store state hash and version metadata.
- Raw events remain server-only because they can contain secrets.

## Projections

Build in the same transaction as canonical state.

Shared projection:

- Public room/game state.
- Positions, public resources, ranks, statuses.
- Current phase and deadline.
- Public card/event history.
- Public deck counts and visible Meeting cards.

Player projection:

- Own role/character.
- Own hand/private statuses.
- Own legal actions and prompts.

Never send full canonical state and filter in the browser.

## Better Auth To Realtime Bridge

Supabase does not automatically understand Better Auth cookies.

Recommended design:

1. Authenticate Better Auth session in a Hono endpoint.
2. Mint a short-lived asymmetric JWT accepted by Supabase.
3. Use Better Auth user ID as text `sub` claim.
4. Configure browser Supabase client with an access-token callback.
5. Authorize private topics through `realtime.messages` RLS and room membership.
6. Refresh token before expiry.

Topics:

```text
room:{opaqueRoomId}
room:{opaqueRoomId}:user:{userId}
```

Clients receive Broadcast/Presence read access only for MVP. Gameplay writes go through Hono commands.

## Realtime Messages

Broadcast small sanitized notifications:

```json
{
  "messageId": "uuid",
  "kind": "projection-updated",
  "aggregateVersion": 43,
  "projectionRevision": 18,
  "changed": ["turn", "players", "history"]
}
```

Clients deduplicate, detect gaps, and refetch on mismatch. Realtime is not durable history.

## Outbox

Insert delivery rows in the same transaction as state/events. Publish through a DB trigger or durable dispatcher. Payloads are sanitized before insertion.

Correctness cases:

- DB commit succeeds, Broadcast fails -> outbox retries and clients can refetch.
- Broadcast duplicates -> client ignores older/duplicate IDs.
- Client misses messages -> snapshot recovery.

## Timers

Persist absolute deadlines and durable timer jobs:

- Kind.
- Expected revision/generation.
- Due time.
- Pending/claimed/completed status.

Enforcement paths:

- Every incoming command checks overdue state.
- Scheduled worker scans due timers using `FOR UPDATE SKIP LOCKED`.
- Bootstrap can trigger safe reconciliation but browser is not sole authority.

Timer processing is an internal idempotent game command.

## Reconnect

Use subscribe-buffer-bootstrap:

1. Obtain Realtime JWT.
2. Subscribe shared/private channels.
3. Buffer messages.
4. Fetch authorized bootstrap.
5. Install projections and revisions.
6. Apply newer buffered messages.
7. Refetch on gaps.

Bootstrap includes server time, aggregate revision, public/private projections, and deadline.

## Serverless Constraints

- No in-memory room authority.
- No authoritative `setTimeout`.
- No persistent WebSocket hosted by the app server.
- No dependence on instance affinity.
- No essential work after response.
- No local durable disk.
- No framework-level response cache as game state.

Use Node runtime for Drizzle/`pg` handlers.

## Connections

- Use Supabase pooler for runtime.
- Explicit small pool size, approximately 1-3 per instance.
- Set connect, idle, and statement timeouts.
- Separate migration/admin connection.
- Monitor saturation and lock wait.

## Migration Order

1. Reconcile existing auth schema and duplicate migration history.
2. Add room/membership/receipt/projection tables.
3. Add game/event/snapshot/timer/outbox tables.
4. Add RLS, grants, Realtime policies, and triggers.
5. Implement lobby commands and bootstrap.
6. Implement minimal game slice.
7. Add full rules.

Never use `drizzle-kit push` against production.

## Acceptance Criteria

- Simultaneous commands serialize deterministically.
- Retry never rerolls or double-applies.
- A stale client cannot mutate current state.
- Timeout/player-action race follows persisted deadline rules.
- Replay reconstructs snapshot hash.
- Users cannot subscribe to other rooms/private topics.
- Missed/duplicate/out-of-order Broadcasts converge through snapshot recovery.
- The game remains correct across multiple app server instances.
