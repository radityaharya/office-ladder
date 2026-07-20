# Performance, Deployment, And Operations

Status: Proposed
Owner: Engineering operations
Updated: 2026-07-18

## Targets

- Landing/game p75 LCP under 2.5 seconds.
- INP under 200 ms.
- CLS under 0.1.
- Command acknowledgement p95 under 500 ms in-region.
- Realtime delivery p95 under 750 ms after commit.
- Room join p95 under 2 seconds.
- Reconnect p95 under 3 seconds.
- Game DB transaction p95 under 100 ms excluding network.

Keep app server compute near the Singapore Supabase region where supported.

## Caching

| Data | Policy |
|---|---|
| Marketing/help/static rules | Static/prerendered |
| Versioned board/card definitions | Immutable/versioned cache |
| Session/private room/game state | Private, no shared cache |
| Commands | Never cached |
| Completed summaries | Cacheable after finalization |
| Hashed assets/fonts | Immutable CDN |

Do not use any framework-level response cache for active game authority or authorization.

## Board Rendering

- Semantic HTML/CSS/SVG.
- Static tile structure and separate token overlay.
- Transform-based movement.
- Precomputed layout coordinates per responsive mode.
- Isolated component updates for board, player panels, log, and timer.
- No intermediate coordinates over Realtime.
- Reduced-motion path.

44 spaces and six tokens do not require virtualization or WebGL.

## Bundle Budgets

- Landing: 150 KB gzip JS.
- Auth: 175 KB.
- Lobby: 200 KB.
- Main game: 250-300 KB.
- Lazy feature chunk: 75 KB.
- Route CSS: 50 KB.
- Initial mobile images: 300 KB.
- Initial desktop images: 500 KB.
- Initial transfer excluding cached fonts: 1 MB.

Review dependency additions above 20 KB gzip on a primary route.

Actions:

- Keep static shells as prerendered/static Vite output where possible; avoid client-side fetch waterfalls for first paint.
- Minimize client boundaries.
- Lazy-load confetti, advanced rules, history, admin, and results extras.
- Keep charts out of gameplay routes.
- Run Next bundle analysis in CI.

## Image Delivery

- Static imports for first-party board/tokens/backs.
- SVG for icons and repeated small art.
- WebP by default; AVIF only after measurement.
- `next/image` with correct `sizes` for responsive raster art.
- Do not ship 247 full card images to gameplay clients.
- Strict remote patterns for uploads.
- Versioned immutable URLs.

## Realtime Bandwidth

- One shared private channel plus player-private channel.
- Routine notifications below 1 KB.
- Snapshots target below approximately 15-30 KB initially.
- No timer ticks.
- No full snapshot on every action.
- Presence changes only.
- Sequence/version gap detection.
- Track bytes per event/match.

## Database Scaling

Initial single primary is sufficient.

- Explicit pool size 1-3 per serverless instance.
- Pooler for runtime.
- Short transactions.
- Index real access paths.
- Serialize only within one game.

Scale triggers:

- Connections consistently above 70%.
- Lock wait p95 above 100 ms.
- Event/outbox tables affect vacuum/query latency.
- Timer lag or overlapping worker batches.
- Realtime authorization/fanout limits.

Do not add Redis, dedicated game server, replicas, or partitioning before measured need.

## Environments

- Local: local Supabase or isolated dev project.
- Preview: isolated branch/project or controlled shared synthetic project.
- Staging: persistent production-like project.
- Production: dedicated project.

Never connect previews to production. Keep secrets, origins, email, analytics, and cookies environment-specific.

## CI/CD

Pull request:

1. Frozen install.
2. Typecheck/lint/tests/content/assets.
3. Migrations on disposable DB.
4. Production build and bundle budgets.
5. Preview E2E and two-client Realtime smoke.
6. Security/dependency scans.

Release:

1. Deploy exact reviewed artifact to staging.
2. Apply additive migrations.
3. Run auth/room/reconnect/timer/full-match smoke.
4. Approve production.
5. Apply production migrations under lock.
6. Promote exact artifact.
7. Gradual traffic if available.
8. Monitor errors/latency/Web Vitals/DB/Realtime.
9. Run post-deploy synthetic game.

Do not rebuild a different artifact during promotion.

## Migrations

First repair current migration discipline:

- Reconcile actual Supabase schema, Drizzle schema, journal, and duplicate `0000` files.
- Align anonymous-auth column/config.
- Establish canonical baseline.

Then use expand-contract:

1. Add compatible structures.
2. Deploy dual-compatible code.
3. Backfill in bounded batches.
4. Switch reads/writes.
5. Remove old structures after rollback window.

Migrations roll forward during incidents; do not rely on destructive down migrations.

## Feature Flags

Classes:

- Build/infrastructure.
- Runtime release.
- Kill switches.
- Gameplay/content/mode flags.

Gameplay decisions are evaluated and pinned at match start. They never change mid-match.

Every temporary flag has owner, expiry, audit history, and removal plan.

## Rollback And Skew

- Keep previous deployment promotable.
- Support protocol N and N-1 during normal rollout.
- Pin active matches to engine/content version.
- Previous app must read additive new schema.
- Use kill switches before full rollback where possible.
- Force refresh clients too old to communicate safely.
- Game-state correction uses repair/fork, not deleting history.

## Monitoring

Application:

- Route/auth/room/command success and latency.
- Duplicate/stale/rejected commands.
- Engine invariants and build versions.

Realtime:

- Channel join, reconnect, gaps, bytes, commit-to-receipt latency.

Database:

- Connections, locks, query latency, CPU/storage/WAL/vacuum.

Product health:

- Room join/start/completion, abandonment, duration, rematch.

## Backups And Recovery

POC:

- Nightly encrypted off-site logical dump.
- Seven daily/four weekly retention.
- RPO 24 hours, RTO 4 hours.

Production:

- Managed daily backups.
- PITR when business impact justifies cost.
- Separate Storage backup.
- Off-provider logical backup.
- Quarterly then monthly restore drills.
- Maintenance/read-only mode.

Suggested mature target: RPO approximately 2 minutes with PITR and RTO 1-4 hours depending failure scope.

## Cost Controls

- Spend alerts at 50/75/90%.
- Room/guest creation limits.
- Expire abandoned rooms.
- Compact or expire detailed histories.
- Cap payloads/uploads.
- No timer ticks/full-state Broadcasts.
- Small DB pools.
- Add paid infrastructure only after trigger thresholds.

## Acceptance Criteria

- Bundle, asset, DB, and Realtime budgets are measured in CI/staging.
- Production migrations and rollback compatibility are rehearsed.
- Previous release remains deployable during rollout.
- Synthetic games and alerts cover auth, room, command, Realtime, DB, and timer health.
- Backup restore and content-pack restoration have tested runbooks.
