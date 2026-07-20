# Failure Recovery And Runbooks

Status: Proposed
Owner: Engineering operations
Updated: 2026-07-18

## Recovery Principle

Postgres is canonical. Every mutation is an authenticated idempotent transaction containing command receipt, events, snapshot/projection changes, timer changes, and outbox notification.

Committed gameplay RPO target is zero. Realtime delivery may fail without losing state.

## Failure Matrix

| Failure | Automatic response |
|---|---|
| Client command timeout | Query/retry same command ID |
| DB commit succeeds, Realtime fails | Outbox retry; client snapshot recovery |
| DB transaction fails | Full rollback, safe retry |
| Stale client | 409 and canonical resync |
| Duplicate command/message | Return original result/ignore duplicate |
| Engine invariant failure | Roll back attempted command and quarantine/pause |
| Snapshot corruption | Rebuild from prior valid snapshot and events |
| Content pack unavailable | Pause; restore exact immutable pack |
| Auth expires | Read-only UI, reauthenticate, verify membership, resync |
| Timer worker delayed | Lazy timeout on read/command; stale job no-op |
| Database outage | Freeze gameplay read-only, no local progression |
| Deploy skew | N/N-1 protocol or upgrade-required response |
| Irreparable match | Preserve original and terminate/fork from valid revision |

## Command Timeout

A timeout is an unknown outcome, not a failure.

1. Query receipt by command ID.
2. Return stored result when committed.
3. If absent, resend identical command ID/payload.
4. Never generate a fresh ID and risk duplicate randomness/effects.

## Partial DB/Realtime Failure

Use transactional outbox. Notification carries revision, not authority.

Clients:

- Deduplicate.
- Detect gaps.
- Retry canonical read if advertised revision is not yet visible.
- Fetch current snapshot on reconnect.

## Stale Clients

State-dependent commands include expected revision and decision-point ID. On mismatch:

- Reject without reinterpretation.
- Return current revision and safe reason.
- Client discards stale optimistic state.
- User reconfirms any action whose meaning changed.

## Engine Invariant Failure

1. Roll back attempted command.
2. Quarantine/pause in defensive transaction.
3. Record command, versions, state hashes, and diagnostics.
4. Reproduce deterministic replay.
5. Fix engine/content corruption.
6. Resume only after replay and invariants pass.
7. Add regression fixture.

Never patch fields directly or delete events.

## Snapshot Corruption

- Verify checksum/schema/invariants.
- Locate newest valid prior snapshot.
- Replay immutable events with pinned engine/content.
- Validate rebuilt state and hash.
- Write recovery snapshot with provenance.
- Resume explicitly.
- Fork or terminate if reconstruction fails.

## Content Pack Failure

Matches pin content version/hash.

- Never fall back to latest.
- Pause affected matches only.
- Restore exact artifact from durable storage/build backup.
- Verify checksum and compatibility.
- Replay representative state before resume.

## Auth Expiry

- Fail before match lock/engine execution.
- Preserve current UI read-only.
- Reauthenticate.
- Verify seat ownership/membership.
- Fetch canonical state.
- Do not auto-submit old action unless same command ID/revision and user confirms.

## Timer Delay

- Deadline uses DB/server time.
- Player action and timeout lock the same match.
- Action after deadline rejects even if worker is late.
- Stale timer generation no-ops.

For long platform outage, use `PAUSED_SYSTEM` instead of unfairly applying strict catch-up. Define outage threshold before beta.

## Database Outage

During outage:

- No local/Realtime-only progression.
- Last state remains visible read-only.
- Timers do not imply canonical advancement.
- Bounded retries/circuit breaker.

Recovery:

1. Verify write/read health and schema.
2. Gradually restore load.
3. Identify unknown command outcomes through receipts.
4. Pause materially affected deadline games.
5. Drain outbox/timer backlog under limits.
6. Validate event continuity and representative active matches.
7. Resume explicitly/gradually.

## Deploy Skew And Rollback

Pin client protocol, API version, engine, state schema, and content pack.

- Active matches keep pinned versions.
- Support N/N-1 client protocol during rollout.
- Realtime notification remains minimal/backward-compatible.
- Additive DB migrations preserve rollback.
- Application rollback does not alter committed game history.

If a committed bug needs correction:

- Pause original.
- Determine last valid revision.
- Prefer explicit compensating event or fork.
- Preserve original lineage as evidence.

## Match Lifecycle

Statuses:

- Lobby.
- Active.
- Paused player/system.
- Quarantined.
- Completed.
- Terminated.
- Forked.

Pause records reason, initiator, revision, deadline/remaining time, and resume policy. Resume creates a new deadline.

Termination is irreversible for that lineage. Fork creates a new match ID with parent match/revision/hash/reason and explicit client switch.

## Core Alerts

- Unknown command outcome.
- Invariant failure/quarantined match.
- Outbox lag.
- Revision mismatch spike.
- Timer lag.
- Snapshot validation failure.
- DB connectivity/pool exhaustion.
- Content lookup failure.
- Auth 401 spike.
- Client-version rejection spike.

## Runbook Index

Create operational runbooks for:

- Command timeout.
- Realtime outage.
- Engine invariant failure.
- Corrupted snapshot.
- Database outage.
- Bad deployment.
- Missing content pack.
- Authentication incident.
- Timer backlog.
- Secret exposure.

Each includes detection, containment, diagnostic queries/tools, safe recovery, validation, communication, and follow-up tests.

## Acceptance Criteria

- Accepted commands are recoverable by command ID after any response failure.
- Realtime loss never loses canonical game progress.
- Snapshot reconstruction and content-pack restoration are tested.
- Long outages pause matches under a documented fairness policy.
- Rollback preserves active match compatibility.
- Operators can quarantine, inspect, recover, terminate, or fork without ad hoc SQL/state edits.
