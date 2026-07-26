# Office Ladder — Working Plan

Living doc so any agent (or human) picking this up mid-stream has full context. Update it as work progresses — especially the "Current state" and "Next step" sections. For durable, less-frequently-changing context (exact commands, env vars, architecture rationale), see [`AGENTS.md`](AGENTS.md) — this file is the status dashboard, AGENTS.md is the reference.

Detailed second-pass plans for the complete game, including the engine, content pipeline, assets, card artwork, frontend, backend, security, testing, operations, and physical edition, live in [`plans/README.md`](plans/README.md). Note: those plans were written against the original Next.js architecture and use Next.js-era terminology in places (Server Components, Route Handlers) that should be read as their Hono/TanStack Router equivalents — see `plans/02-repository-architecture.md` for the updated mapping.

**Gameplay is now driven by [`plans/24-gameplay-v2-spec.md`](plans/24-gameplay-v2-spec.md)**, the authoritative build contract for the v2 ruleset. The "Current state" and "Next step" sections below describe the roll-and-move slice v2 builds on; for anything about what the game *should* become, that spec wins.

## What this is

Browser-based multiplayer board game (Monopoly-like), office theme. Players roll dice, move around a board, collect money/reputation, climb a promotion ladder from Intern to Director. 2–6 players per room, real-time, turn-based. Full gameplay spec: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — that doc's "Technology Stack" section is historical/superseded; this file and AGENTS.md are the source of truth for tech decisions.

## Tech stack (decided, with reasoning — don't re-litigate without new info)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | bun workspaces + Nx (package-based, no `project.json` — targets come from each package's own `package.json` scripts) | Explicit ask for a "proper monorepo... preferably NX" after the app outgrew a single package |
| Backend | Hono on Bun (`apps/server`) | Minimal, fast, no bundler/RSC machinery |
| Frontend | TanStack Router + React 19 + Vite + Tailwind 4 + shadcn/ui (`apps/web`) | File/type-safe routing without a metaframework |
| Shared packages | `@office-ladder/engine`, `@office-ladder/content`, `@office-ladder/contracts`, `@office-ladder/db` | Real package boundaries instead of a flat `src/` — see AGENTS.md for the exact dependency rules |
| Realtime | Native WebSockets via `hono/bun`'s `upgradeWebSocket`, not Supabase Realtime | Explicit instruction to drop Supabase Realtime in favor of Hono's own WS helper |
| Auth | Better Auth (username + email/password), mounted directly on Hono (`auth.handler`) | No OAuth/2FA/email verification — bare minimum for a room-join party game |
| ORM/driver | Drizzle + `drizzle-orm/bun-sql` (Bun's native Postgres driver, not `pg`) | "Use bun as much as possible" |
| DB | Postgres via Supabase project **office-ladder** (ref `vdhumwwdgwuhtyurijtp`, region `ap-southeast-1`), used only as a plain Postgres host | Supabase's own SDK/Auth/Realtime are unused |
| Dev servers | Two real processes (`apps/server` on Bun, `apps/web` on Vite), Vite proxies `/api` and `/ws` to the server. Production: one process — `apps/server` serves the built `apps/web` static output + API together. | `@hono/vite-dev-server`'s Bun adapter was tried and didn't work reliably in-process (Node vs Bun module execution conflict) — see AGENTS.md for the full story |

### Rejected approaches (don't re-suggest these)
- **Next.js (App Router)** — rejected 2026-07-20, "too heavy." Replaced by Hono + TanStack Router.
- **Supabase Realtime** — rejected in favor of native `hono/bun` WebSockets.
- **`@hono/vite-dev-server` for a single unified dev process** — tried, hit a Node/Bun module-execution conflict (`Bun is not defined` inside Vite's SSR module runner even with the Bun adapter). Replaced by two processes + Vite proxy. Don't re-attempt without checking whether that package's Bun compatibility has changed upstream first.
- **Flat single-package layout** — replaced by the Nx monorepo (apps/web, apps/server, packages/engine|content|contracts|db) per explicit instruction.
- **Custom `server.js` + Socket.io**, **separate `apps/realtime` Socket.io service**, **Go backend**, **Prisma**, **Railway Postgres**, **Supabase Auth** — all previously tried and abandoned; see AGENTS.md if the reasoning is needed again.

### Environment fact (matters for anyone touching the repository layer or migrations)
**The database IS reachable from this dev environment.** Raw TCP to `DATABASE_URL` works — verified directly, `select 1` through Bun's native `SQL` client against the Supabase session pooler returns a row. So `drizzle-kit push`/`migrate` and real integration tests against Postgres can and should be run here. **Any change to `apps/server/src/rooms/postgres-repository.ts`, to `packages/db`'s schema, or to command-persistence ordering must be verified against the real database, not only against `InMemoryRoomRepository`.**

This paragraph previously claimed the exact opposite — that the sandbox could not make raw TCP connections and had to go through the Supabase Management API. **That was false and was never tested before being written down.** It is not a harmless inaccuracy: it was handed to roughly thirty agent prompts as a reason not to test against Postgres, so a concurrency change was validated only against `InMemoryRoomRepository` — which has no foreign keys — and a foreign-key ordering bug shipped that made `game.start` impossible to persist. Do not reintroduce the claim. If a connection genuinely fails for you, prove it with the command and its output before writing anything down. (`plans/21-risk-register-and-open-questions.md`'s RISK-020 still repeats the old claim and needs the same correction.)

## Current state (updated 2026-07-20)

The Next.js → Hono/TanStack Router migration and the Nx monorepo restructuring are both **done and committed**. Verified this session: `bun run typecheck`, `bun run lint`, and `bun run test` all pass clean across every package/app via `nx run-many` (120 tests at that time, the same count as before either migration — nothing was lost; the suite has grown many times over since, so run it rather than trusting any number written in a doc). See [`AGENTS.md`](AGENTS.md) for the full architecture, commands, and env var reference — it won't be duplicated here.

**What's real and working** (verified by direct testing this session, not just typechecking):
- `apps/server` standalone: boots, Better Auth sign-up/sign-in works against the live Supabase Postgres, room creation works through the full stack (Hono route → room service → engine).
- `apps/web` standalone: Vite boots and serves the SPA shell.
- Full room lifecycle API (create/join/get/start/roll) ported to Hono, auth-gated, same-origin-checked.
- Lobby and game UI ported off Next.js (`next/navigation` → TanStack Router's `useNavigate`/`Link`, session-gated routes via `beforeLoad`).
- Realtime: WebSocket hub (`apps/server/src/realtime/ws-hub.ts`) + client (`apps/web/src/realtime/room-channel.ts`), same invalidation-only contract as before (`ProjectionUpdated`), transport swapped from Supabase to native WS.
- **Landed across this session and the prior one**: the engine's `turn.roll` transition runs a generic tile-effect interpreter (`resolve-tile-effects.ts`) covering `modifyResource`, `payResource`, `restoreResourceToMaximum`, `incrementWorkCounter` (with its milestone reward), `rollCheck` (doubles + total-range outcomes, recursive), `grantExtraRoll` (a real extra turn), `drawCards` (a synthesized flavor table standing in for unauthored deck content), `skipTurns` (a per-player counter that `resolveNextTurn` — `execution/next-turn.ts` — honors when advancing turn order), and `auditConfinement` (opens a real `PromptState`). Also auto-attempts promotion and detects the win condition. Four of six characters' automatic passives apply. **New this round**: a full prompt/decision command, `prompt.respond` (`execution/respond-to-prompt.ts`), wired through `apply-command.ts`, `legal-actions.ts`, contracts, the Hono `/respond` route, and a `PromptPanel` in the client — the audit tile's `pay-fine`/`attempt-roll` choice is playable end to end, not just modeled. Covered by engine tests (no count quoted — run `bun run --cwd packages/engine test`; see AGENTS.md for why counts are no longer written down here).

**Also landed this round**: rooms are now **Postgres-backed**, not in-memory. `PostgresRoomRepository` (`apps/server/src/rooms/postgres-repository.ts`) stores the full `StoredRoom` — including the canonical `GameState` — as a JSONB snapshot in `room_projections.projection`, using `rooms` for the code-uniqueness index. The migrations existed as SQL files since much earlier but had **never actually been applied to the live Supabase project** (confirmed via `list_tables` — only Better Auth's tables existed); applied both this round. Verified end to end: created a room, killed the server process, started a fresh one, fetched the same room by id — all fields intact, row confirmed present via direct SQL. Note: this uses only 2 of the schema's 8 tables (see AGENTS.md) — the event-sourced tables (`game_events`, `command_receipts`, `game_outbox`) are provisioned but unused, a real follow-up not attempted here.

**Security note surfaced, not acted on**: Supabase reports RLS disabled on all 12 public tables. Expected given the access pattern (server-only `DATABASE_URL` connection, no client-side Supabase SDK), but worth a deliberate decision — see AGENTS.md.

**Also landed this round: `applyStatus` is now fully implemented**, including real consumption of every status the content pack actually uses — not just tracked-but-inert bookkeeping. All 4 real usages in `board.ts` now do something and get consumed exactly once: `status.next-salary-multiplier` (multiplies the next receptionist-pass salary), `status.next-roll-extra-movement` (adds bonus spaces to the next die roll), `status.skip-next-tile-effect` (the next tile's effects are skipped entirely), and `status.ignore-next-work-energy` (filters the negative energy cost out of the next work tile, leaving other effects on that tile intact). Every effect type in the content pack's vocabulary is now interpreted except real card-deck content. 4 new tests, each proving both the effect and the consumption.

**What's not done / honestly incomplete** — see AGENTS.md's "Known gaps" section for full detail, summarized here:
- **Real event/management card content was never authored** — `drawCards` uses a small built-in synthesized effect table instead of real deck content. This is now the single biggest remaining gap in the tile-effect vocabulary.
- Only one prompt kind (`audit-release`) is wired end to end. `reaction.play`/`reaction.pass`/other decision commands aren't — but the plumbing now exists as a template to extend.
- Two character passives needing a target or a cooldown counter (Tech Genius's `ignoreNegativeEffect`, and anything requiring `swapBoardPositions`/`teleport`/`stealResource`) aren't implemented.

**Verified this round via a connected browser** (the single biggest previously-open gap): create room → lobby → start → multiple live dice rolls, with visible tile effects (money/energy/work-counter changes), turn advancement, and a populating activity log, no console errors. This caught and fixed a real bug: `/rooms/$roomId/game` was a TanStack Router child route of `/rooms/$roomId`, but the parent rendered its lobby component directly instead of an `<Outlet />` — so the game view was **completely unreachable regardless of URL** before this fix. See AGENTS.md for the full explanation and the general footgun it represents for any future nested route.

## Next step

**Gameplay: follow [`plans/24-gameplay-v2-spec.md`](plans/24-gameplay-v2-spec.md) §9's wave order.** The gameplay items that used to be listed here (author deck content, extend `prompt.respond` to `reaction.play`/`reaction.pass`) are folded into that spec. Its most load-bearing finding, worth repeating: `apply-command.ts` implements only 3 of the 13 declared commands, and reaction windows, hands, hidden roles, the token economy and fixed-length scoring are all already *modelled* and simply never populated — v2 is mostly wiring, not new architecture. See AGENTS.md's "Known gaps" banner.

Non-gameplay, still open:

1. Decide the RLS question deliberately (see above) before this goes anywhere a browser might talk to Supabase directly.
2. Repository/schema/persistence-ordering changes get verified against the real Postgres, which **is** reachable here — see "Environment fact" above. `InMemoryRoomRepository` has no foreign keys and cannot substitute for it.

## MVP scope (from PRD)

- [x] Lobby (create/join room, ready-up)
- [x] Realtime transport (native WebSockets)
- [x] Auth (username + email/password)
- [x] Dice roll + player movement
- [x] Board (44 spaces, every tile-effect type interpreted except real deck-card content)
- [ ] Event cards — tiles trigger `drawCards`, but it's a synthesized flavor table, not real authored card content
- [~] Hidden character roles — *characters* are assigned/shown and their automatic passives resolve, but targeted "active" abilities (steal/swap/teleport) aren't implemented, and the hidden worker/management **role** is cosmetic: nothing sets `role.revealed`, nothing consumes `role.management`. Its assignment was also derivable from the public `seat` until fixed this round. Make it real or delete it — see AGENTS.md and spec §7.2.
- [x] Promotion system — auto-attempted on affordability
- [x] Winner screen
- [x] A real player decision, playable end to end (audit-release: pay fine vs. attempt a release roll)
- [x] Shared game-engine module — `packages/engine`, server-authoritative, projections synced via WebSocket
- [x] Rooms survive a server restart (Postgres-backed, verified)

## Future (post-MVP, per PRD)
AI bots, chat, spectator mode, replay, leaderboard, daily challenges, avatars, mobile support.
