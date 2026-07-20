# Analytics And Observability

Status: Proposed
Owner: Product analytics and engineering operations
Updated: 2026-07-18

## Architecture

Separate three systems:

- Authoritative gameplay journal for replay/debugging.
- Privacy-conscious product and balance analytics derived asynchronously.
- Operational traces, logs, and metrics.

State mutation, game event, and analytics outbox entry commit atomically. Analytics export never blocks a turn.

## Event Envelope

Include:

- Event name/version.
- Occurred/received timestamps.
- Environment/build.
- Rules, balance, board, card-set versions.
- Match, pseudonymous room/player IDs.
- Command, turn, sequence, causation, correlation, trace IDs.
- Bot flag.
- Typed payload.

Use explicit match configuration values rather than inferring from mode labels.

## Privacy

Do not send:

- Email, username, display name.
- Raw Better Auth user ID.
- Room code.
- IP or full user agent.
- Chat/free text.
- Auth tokens.
- Hidden state from clients.

Use server-generated HMAC pseudonyms with separate environment salts and match-scoped player IDs. Hidden-role data for balance is server-derived, restricted, and preferably available only after completion.

## Product Funnel

Track:

```text
session -> auth/guest -> create/join -> room joined
-> minimum players -> ready -> match started
-> first action -> first round -> match completed
-> rematch -> return another day
```

North-star proposal: weekly completed social matches with at least three human players.

## Gameplay Events

Categories:

- Room/lobby lifecycle.
- Match start/completion/abandonment.
- Turn phases and timeout.
- Dice/movement/tile resolution.
- Card draw/store/play/counter/discard.
- Resource/status changes.
- Promotions.
- Management Shuffle/Block/reveal.
- Clock Deck progression.
- Disconnect/reconnect/resync.

Authoritative gameplay analytics are emitted server-side. Client telemetry covers UI exposure and interaction only.

## Outcome Categories

- Worker Director.
- Management Director individual win.
- Management Clock Deck collective win.
- Marathon score.
- Abandoned.
- Invalidated.

Keep these separate in reports.

## Balance Metrics

- Win rate by identity, character, seat, player count, mode, and version.
- Promotion timing and progression.
- Money/Reputation/Energy/token curves.
- Burnout/Audit burden.
- Clock depletion.
- Card effectiveness and dead-card rate.
- Tile landing/effectiveness.
- Management Shuffle/Block timing and value.
- Catch-up and pile-on mitigation.
- Match duration, completion, timeout, and rematch.

Avoid causal claims from raw correlation.

## Replay Correlation

Persist enough to reproduce:

- Immutable configuration.
- Initial seed or RNG record.
- Accepted commands/events.
- Sequence and state hash.
- Periodic snapshots.
- Build/rules/content versions.

Use command/correlation/trace IDs to jump from support incident to replay, logs, and traces.

Optional event hash chain can detect journal tampering.

## Tracing

OpenTelemetry spans for:

- Hono route handler.
- Auth/authorization.
- Game command validation.
- Engine transition.
- DB transaction.
- Outbox/Realtime publication.
- Timer processing.
- Replay reconstruction.

Do not attach hands, roles, deck order, room codes, names, or full state.

Sampling:

- 100% errors/invariant failures.
- 100% match start/end and reconnect recovery.
- 5-10% successful commands initially.
- Temporary targeted sampling by build/cohort.

## Logs

Structured fields:

- Timestamp/severity/service/build.
- Match/command/correlation/trace IDs.
- Turn/revision/sequence.
- Stable error code.
- Retry and duration.
- Sanitized outcome.

Stable error examples:

- `GAME_COMMAND_STALE_VERSION`
- `GAME_COMMAND_DUPLICATE`
- `GAME_INVALID_TURN_OWNER`
- `GAME_STATE_INVARIANT_FAILED`
- `REALTIME_PUBLISH_FAILED`
- `OUTBOX_EXPORT_FAILED`
- `REPLAY_HASH_MISMATCH`

## Metrics

Low-cardinality metrics only:

- Command count/error/latency.
- DB transaction latency/failure.
- Realtime publish latency/failure.
- Outbox backlog/oldest age.
- Active/stalled/completed matches.
- Disconnect/reconnect/resync.
- Timeout and automatic action rates.
- Replay verification failures.
- Auth failures.

Never use match/user/card IDs as metric labels.

## Dashboards

- Product funnel.
- Gameplay health.
- Balance.
- Reliability/operations.
- Release/build comparison.

## Initial SLOs

- Room join success: 99.5%.
- Accepted gameplay command success: 99.9%.
- Command processing p95: under 500 ms.
- Commit-to-notification p95: under 1 second.
- Event journal durability: 99.99%.
- Analytics outbox within 15 minutes: 99%.
- Replay verification: 99.99%.

## Alerts

- Command error rate above 2% for 10 minutes.
- Realtime publish failure above 1%.
- Outbox oldest item above 15 minutes.
- Stalled/invalidated matches above baseline.
- Replay hash mismatch greater than zero.
- Disconnect rate 2x baseline.
- Command p95 above 1 second.
- DB connection saturation.

Balance changes normally create review notifications, not pager alerts.

## Retention

- Operational logs: 14-30 days.
- Full traces: 7-14 days; error traces 30 days.
- Raw analytics: 90 days.
- Daily balance aggregates: approximately 25 months after review.
- Replay journals: follow data-lifecycle policy.

## Environment Separation

Separate analytics datasets, OTel namespaces, HMAC salts, replay storage, and alert routing for production, staging, and development. Bot/load data carries `isBot` and is excluded by default.

## Acceptance Criteria

- Analytics outages cannot affect gameplay commands.
- Every production match records exact versions/configuration.
- Product dashboards contain no direct personal or hidden client data.
- Support can correlate a match event to command, trace, logs, and replay.
- Operational alerts detect lost delivery, stuck games, invariant failures, and latency regressions.
