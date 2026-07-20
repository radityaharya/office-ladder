# Testing And Quality

Status: Proposed
Owner: Engineering quality owner
Updated: 2026-07-18

## Quality Architecture

The pure engine boundary is the foundation:

```ts
transition(state, command, context) -> nextState + events
```

Inject RNG, clock, IDs, and content. Keep DB, Realtime, auth, and animation outside.

## Tooling

- Vitest for engine, service, contract, and component tests.
- fast-check for property tests.
- React Testing Library for focused UI behavior.
- Playwright for E2E, visual, accessibility, and browser tests.
- axe-core integration.
- Real disposable Postgres for migration/concurrency tests.
- Local Supabase or dedicated staging contracts where feasible.
- Fake clock, seeded/scripted RNG, fake transport, and typed builders.

## Test Layers

### Unit

- State machine and command legality.
- Board movement, salary, laps, and traversal variants.
- Resources, Work Counter, Burnout, Audit, tokens.
- Promotions and rank benefits.
- Every effect operator and custom handler.
- Deck draw/discard/reshuffle/visibility.
- Reactions, prompts, nested draws, and win precedence.
- Character and Management abilities.
- Public/private projections.
- Serialization and invariants.

### Property

- Same seed/commands produce identical events/state.
- Rejected commands do not mutate state or RNG.
- Positions remain valid.
- One active turn exists.
- Resources/tokens obey bounds.
- Card multiset is conserved.
- Clock decks never regain cards.
- Every legal action applies.
- Event replay reconstructs snapshot.
- Public projections do not leak private fields.
- Automatic resolution terminates.

### Integration

- Auth flows and sessions.
- Room membership and authorization.
- Database migrations and constraints.
- Concurrent command serialization.
- Command idempotency.
- Event/snapshot/outbox atomicity.
- Timer races and worker idempotency.
- Realtime private-channel authorization.
- Reconnect and projection recovery.

### E2E

PR smoke:

1. Sign-up/sign-in/guest flow.
2. Two users create/join room.
3. Ready/start.
4. One deterministic turn.
5. Out-of-turn rejection.
6. Reload/reconnect.
7. Near-win deterministic result.

Nightly/release:

- 3-6 players.
- Quick and flagged Marathon.
- Disconnect during each phase.
- Timeout for each prompt type.
- Worker and Management wins.
- Promotion Block and Shuffle secrecy.
- Reactions and chained draws.
- Host departure.
- Multiple tabs according to policy.

## Golden Replays

Store versioned fixtures containing rules/content version, seed, initial state, accepted commands, expected events, and final/public/private state hashes.

Required scenarios:

- Receptionist pass versus exact stop.
- Work Counter 5/10.
- Burnout Status and Burnout Tile.
- Audit doubles and fine.
- Final Clock card.
- Shuffle before/after reveal.
- Promotion Block.
- Simultaneous Director/Clock boundary.
- Resource prevention reactions.
- All characters and rank benefits.
- Six-player two-Management game.
- Reconnect at every phase.

Golden updates require explicit command, readable diff, rationale, and version impact.

## Content Validation

Treat content as code:

- IDs and counts.
- Board/rank/deck invariants.
- Effect schema and references.
- Timing/targets/reactions.
- Locale coverage and placeholder parity.
- Asset references and case.
- Text-length budgets.
- No unsafe markup.

## Card Render Tests

- Representative PR baselines.
- All 247 cards in EN/ID for release.
- Front/back, selected, disabled, stored, reaction, target, mobile/desktop/print.
- DOM assertions for complete text and no clipping.

## Asset Tests

- File existence/case.
- Image decode and dimensions.
- SVG sanitization.
- Byte/resolution budgets.
- Font licenses/glyph coverage.
- Audio decode/loudness.
- No metadata/secrets.
- No production 404s.

## Accessibility Tests

- Keyboard-only auth/lobby/game.
- Focus restoration.
- Board explorer.
- Timer announcements.
- Private role reveal.
- Target/reaction/promotion dialogs.
- Reduced motion and forced colors.
- Hidden state absent from accessible public DOM.

Manual release coverage includes NVDA, VoiceOver, Narrator, and TalkBack.

## Visual Tests

Viewports:

- 390x844.
- 768x1024.
- 1280x720.
- 1440x900.
- 1920x1080.

States include auth, lobbies, two/six-player boards, every phase, cards, Audit, Burnout, promotion, reveal, reconnect, results, long names, max values, and 200% zoom.

## Load Tests

Initial target scenario:

- 100 simultaneous six-player rooms.
- 600 connected players.
- Join ramp and reconnect storm.
- 30-minute Quick soak and 120-minute long soak.

Measure command latency, persistence, Broadcast delivery, reconnect, DB connections, locks, Supabase limits, and server cold starts.

Initial targets:

- Command p95 under 500 ms.
- p99 under 1.5 seconds.
- Reconnect p95 under 3 seconds.
- Unexpected command failures under 0.1%.
- Zero lost accepted commands or cross-room delivery.

## Chaos Tests

- Drop/duplicate/reorder/delay Realtime messages.
- Disconnect after commit but before response.
- Suspend tab past deadline.
- Fail Broadcast after DB commit.
- Fail DB before commit.
- Restart the app server instance.
- Expire session during play.
- Delay timer worker.
- Deploy while games are active.

System must converge through canonical persistence and idempotent recovery.

## Security Tests

- Cross-room access.
- Actor impersonation.
- Forged outcomes.
- Stale/replayed commands.
- Hidden data in APIs/RSC/Realtime/logs/analytics.
- CSRF/origin/cookie policies.
- Rate limits.
- Secret/client bundle scans.
- RLS deny-by-default.

## Builders And Fakes

Typed builders produce valid defaults and named presets:

- Promotion-ready.
- Audit trapped.
- Clock one card left.
- Hidden/revealed Management.
- Pending prompt/reaction.
- Long-name/max-resource states.

Unsafe invalid-state builders are explicit and only for rejection tests.

## CI Gates

PR required:

1. Frozen dependency install.
2. Typecheck and lint.
3. Content/generated validation.
4. Unit and bounded property tests.
5. Component accessibility.
6. Production build.
7. Migration/integration tests.
8. Chromium E2E smoke.
9. Visual/card snapshots.
10. Secret, dependency, and static security scans.
11. Asset and bundle budgets.

Nightly:

- Large property runs.
- Full browser matrix.
- Full E2E games.
- Golden replays.
- Load/chaos smoke.
- Remote Supabase contracts.

## Coverage

- Engine branch coverage target: 95%+.
- Explicit table/effect registration coverage: 100%.
- Authorization/private projection: 90%+ branches.
- Mutation testing periodically for critical engine rules.

## Release Acceptance

- Canonical rules/content version identified.
- No critical/high security issue.
- Golden changes reviewed.
- Content/assets/locales valid.
- Accessibility automation and manual flows pass.
- Browser/load/chaos targets pass.
- Two-player policy and 3-6 player supported flows behave as documented.
- Both main victory paths complete.
- Migrations and restore/rollback are rehearsed.

## Acceptance Criteria

- Every engine failure is reproducible from seed and command trace.
- Every accepted command is durable and idempotent under failure tests.
- Reconnect and hidden-information tests are release-blocking.
- Content and card rendering cannot ship with missing/unreviewed records.
