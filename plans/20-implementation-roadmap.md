# Implementation Roadmap

Status: Proposed
Owner: Engineering and product owner
Updated: 2026-07-18

## Strategy

Build from deterministic rules outward:

```text
governance/rules
-> engine and content contracts
-> simulation and tests
-> persistence/authority
-> room/realtime vertical slice
-> complete gameplay/content
-> UI polish/assets/audio
-> operations and release
```

Do not build 247 card UIs or full multiplayer plumbing before the engine, projections, and content validation contracts are proven.

## Phase 0: Reconcile Foundations

Deliverables:

- Approve product/rules identity and 44-space source of truth.
- Resolve release-blocking rules decisions.
- Reconcile anonymous auth/schema/migration history.
- Create ADR/rules decision indexes.
- Add test tooling and baseline CI.
- Mark server-only modules.

Exit:

- No core schema-changing rules ambiguity.
- Auth model and migration baseline are coherent.

## Phase 1: Engine Skeleton

Deliverables:

- IDs, versions, state, commands, events, errors.
- Deterministic RNG and clock contracts.
- Resolution stack and prompt model.
- Legal-action enumeration.
- Public/private projections.
- Invariants, serialization, and builders.

Exit:

- Empty/minimal game can create, serialize, project, and replay deterministically.

## Phase 2: Core Rules Vertical

Deliverables:

- Board and movement.
- Salary/laps/Receptionist.
- Resources, Work Counter, Energy/Burnout.
- Audit.
- Turn phases and timeout defaults.
- Basic promotion chain.
- Golden replay fixtures.

Exit:

- Deterministic local simulation can play a simplified complete turn loop.

## Phase 3: Content Foundation

Deliverables:

- Source snapshots/extractors.
- ID registry and decision ledger.
- Canonical board/ranks/modes/characters/decks.
- Effect AST and content validation.
- EN/ID catalog foundation.
- Board/content preview tools.

Exit:

- Board and setup render entirely from validated content.

## Phase 4: Room And Authority

Deliverables:

- Room/member/game/event/snapshot/receipt/timer/outbox schema.
- Authenticated room commands.
- Transactional execute-command service.
- Lobby bootstrap/projections.
- Better Auth to private Realtime JWT bridge.
- Reconnect/gap recovery.

Exit:

- Two clients create/join/ready/start and observe one authoritative deterministic turn.

## Phase 5: Minimal Playable Alpha

Deliverables:

- Game route and responsive shell.
- Board, player rails, HUD, Action Dock, timer, activity log.
- Dice and token movement presentation.
- Simple tiles/cards.
- Role assignment/reveal.
- Turn timeout and disconnect handling.

Exit:

- 3-6 players can complete a seeded simplified Quick match through winner screen.

## Phase 6: Full Card And Effect System

Deliverables:

- Stored/duration/choice/target/global cards.
- Prevention and end-turn reactions.
- Nested draws and hand overflow.
- Six deck behaviors and Meeting preview.
- All promotion benefits.
- Characters and Management abilities.
- Clock Deck and Quick win conditions.

Exit:

- All canonical effect operations and unique cards have fixtures.
- Complete Quick game works from validated content.

## Phase 7: Content Completion And Assets

Deliverables:

- Normalize all 247 cards.
- Complete EN/ID review.
- Asset registry and board-critical art.
- Six card templates/backs and motif system.
- Card gallery/contact sheets/visual tests.
- Basic audio/motion and reduced modes.

Exit:

- Every card has approved content/art assignment and renders in both locales.

## Phase 8: Quality And Operations

Deliverables:

- Full property/golden/integration/E2E suites.
- Browser/accessibility matrix.
- Load/chaos/security tests.
- Analytics/observability dashboards.
- Admin game inspector, replay, support bundles, safe repairs.
- Retention, cleanup, backups, and runbooks.
- Feature flags and kill switches.

Exit:

- Closed-beta readiness gates pass.

## Phase 9: Closed Beta

Scope:

- Quick mode.
- Private rooms.
- 3-6 players.
- Guest-friendly join.
- No public matchmaking/chat.

Activities:

- Structured playtests.
- Tutorial/rules refinement.
- Balance telemetry and patches.
- Support/moderation workflow.
- Privacy/terms/deletion readiness.

Exit:

- Duration, comprehension, completion, fairness, reconnect, and support-volume targets are acceptable.

## Phase 10: Public Launch

- Gradual flag-based rollout.
- Daily launch health review.
- Weekly balance/support review.
- Conservative retention and telemetry.
- Exact artifact promotion and rollback readiness.

## Later Workstreams

- Marathon mode.
- Disconnected-player bot replacement.
- Player-facing replay and spectator mode.
- Persistent match history/stats.
- Avatars.
- Public matchmaking/chat after moderation readiness.
- Physical edition manufacturing.

## Critical Dependency Chain

```text
rules decisions
-> engine contract
-> canonical content/effects
-> persistence/projections
-> private Realtime auth
-> playable vertical slice
-> full cards/roles
-> quality/operations
-> beta/launch
```

Asset and UX exploration can proceed in parallel, but final board/card production waits for canonical IDs, counts, and rules.

## First Engineering Milestone

Recommended first implementation milestone after planning approval:

1. Add Vitest/fast-check and scripts.
2. Add `src/engine` skeleton.
3. Implement deterministic RNG, state/version types, command/event envelopes.
4. Implement 44-space board config validation and movement.
5. Add salary/Receptionist and golden movement tests.

This proves the architecture without prematurely committing to persistence or all card semantics.

## Release Gates

Alpha:

- Deterministic complete simplified game.
- Two-client authoritative sync/reconnect.
- Core hidden-data separation.

Closed beta:

- Full Quick rules/content.
- Accessibility/browser/security/load gates.
- Admin/support/retention/runbooks.

Public:

- Legal/privacy/support readiness.
- Monitoring, backups, rollback, kill switches.
- Stable playtest and balance outcomes.

## Acceptance Criteria

- Each phase has measurable exit criteria and downstream dependencies.
- Rules/content versions are pinned before persistence contracts stabilize.
- Multiplayer starts with one complete vertical slice rather than broad incomplete features.
- Release readiness includes verification, operations, and recovery, not only implementation.
