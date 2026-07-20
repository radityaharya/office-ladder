# Office Ladder — Working Plan

Living doc so any agent (or human) picking this up mid-stream has full context. Update it as work progresses — especially the "Current state" and "Next step" sections.

Detailed second-pass plans for the complete game, including the engine, content pipeline, assets, card artwork, frontend, backend, security, testing, operations, and physical edition, live in [`plans/README.md`](plans/README.md). This file remains the concise working-status dashboard.

## What this is

Browser-based multiplayer board game (Monopoly-like), office theme. Players roll dice, move around a 28-space board, collect money/reputation/energy, climb a promotion ladder from Intern to Director. 2–6 players per room, real-time, turn-based (30s turn timer). Full gameplay spec: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — board tiles, promotion ladder requirements, hidden roles, event cards, win condition. That doc's "Technology Stack" section is historical/superseded; this file (PLAN.md) is the source of truth for tech decisions.

## Tech stack (decided, with reasoning — don't re-litigate without new info)

**2026-07-20: pivoted off Next.js.** Explicit call from the user — "Next is super heavy" — made before the Next.js-based work (engine/content/contracts aside) got committed. See "Rejected approaches."

| Layer | Choice | Why |
|---|---|---|
| Backend framework | Hono, mounted in a Node process | Minimal, fast, no bundler/RSC machinery; small enough to reason about the whole request path |
| Frontend framework | TanStack Router + React, built with Vite (TS, Tailwind 4) | File/type-safe routing without a metaframework; Vite build is far lighter than Next's |
| App shape | Single deployable, no monorepo — Hono serves the API under `/api/*` and serves the built Vite SPA (static assets + index.html fallback) for everything else. Dev: `@hono/vite-dev-server` (or equivalent) runs Hono inside Vite's dev server so there's one dev command, not two processes to coordinate. | Preserves the "everything in one deployable, no monorepo" decision from the Next.js era — the framework changed, that constraint didn't |
| Realtime | Supabase Realtime (broadcast / postgres_changes) — unchanged | Managed websockets — no custom Node server or Socket.io. Auth stays on Better Auth (Supabase Auth unused). |
| Auth | Better Auth — anonymous plugin + email/password, both enabled. No OAuth, no email verification, no 2FA (bare minimum for POC) — unchanged, Better Auth has a Hono handler mount (same shape as its Next.js route handler, `auth.handler` mounted on `/api/auth/*`) | Room-based party game — guest join by name is the primary flow; email/password exists so identity can persist/link later |
| ORM | Drizzle + `pg` (node-postgres) — unchanged | Swapped from Prisma: no native binary/build-approval friction, no separate codegen step, thinner runtime |
| DB | Postgres via Supabase project **office-ladder** (ref `vdhumwwdgwuhtyurijtp`, region `ap-southeast-1`) — unchanged | Railway Postgres was tried and abandoned — see below |
| Hosting (target) | Any Node host (Hono is not tied to a specific platform's edge runtime) | Realtime is offloaded to Supabase; the app is a plain long-running Node server, no serverless-specific constraints to design around |
| Backend language | TypeScript only, no Go | Better Auth is TS-only; no need for a separate game socket process |

### What carries over from the Next.js work vs. what doesn't
The engine (`src/engine/`), content pipeline (`src/content/`), and contracts (`src/contracts/`) are framework-agnostic pure TS — they carry over untouched. The room service business logic (`src/server/rooms/service/`) also carries over; only its HTTP entry points change shape. **Framework-specific and needing a rewrite:** the Next.js route handlers under `src/app/api/`, the App Router pages/layouts under `src/app/`, and any component relying on Next.js conventions (Server Components, `next/navigation`, async `params`). The room/game React components themselves (`src/components/room/`, `src/components/game/`) are largely portable since they're client-side already — they'll need their data-fetching glue swapped from Next.js patterns to TanStack Router loaders, but the JSX/logic bodies mostly survive.

### Rejected approaches (don't re-suggest these)
- **Next.js (App Router)** — rejected 2026-07-20 as too heavy for this project; replaced by Hono (API) + TanStack Router (frontend) on Vite. Do not re-propose Next.js without new instruction from the user.
- **Custom `server.js` + Socket.io** — removed; replaced by Supabase Realtime.
- **Separate `apps/realtime` Socket.io service + monorepo split** — built once, then reverted.
- **Pure Next.js API route Socket.io hack** (`res.socket.server` in `pages/api/socket.ts`) — was broken on Next.js 16; moot now that Next.js itself is gone.
- **Go backend** — Better Auth can't run in it; would require a separate Node auth sidecar for no real gain on a game this size.
- **Prisma** — works, but heavier than needed; team explicitly prefers Drizzle.
- **Railway Postgres** (`trolley.proxy.rlwy.net:20187`) — abandoned; Supabase is the DB.
- **Supabase Auth** — not used; Better Auth owns sessions/users.

### Environment gotcha (matters for whoever runs migrations next)
**This sandboxed dev environment cannot make raw TCP connections** — only HTTPS through the pre-configured proxy works. Confirmed by: `psql`/`/dev/tcp` timing out against Railway, against Supabase's direct host (which is also IPv6-only — a separate, additional problem), and against Supabase's IPv4 session pooler. None of that is a DB provider issue — it's this environment's egress policy.

**Workaround used:** the Supabase MCP tools (`mcp__Supabase__execute_sql`, `mcp__Supabase__apply_migration`) go over the Supabase Management API (HTTPS), not raw Postgres wire protocol, so they work from here. Drizzle migrations were generated locally with `drizzle-kit generate` (no DB connection needed for `generate`, only for `push`/`migrate`), then the resulting SQL was meant to be applied via `apply_migration`.

**If running from a normal machine/CI/VPS** (not this sandbox), raw TCP will work fine and `drizzle-kit push` or a real `psql` connection is simpler — no need for the MCP-tool workaround there.

## Current state (updated 2026-07-20 — mid-pivot from Next.js to Hono + TanStack Router)

Substantial engine/backend/frontend work exists as **uncommitted, untracked files** (see `git status`), built against Next.js. As of just before the pivot decision: `pnpm test` → 120/120 passing, `pnpm typecheck` clean, `pnpm lint` clean — i.e. the framework-agnostic pieces (engine, content, contracts, room service) are solid and should not be thrown away, only re-hosted.

**Framework-agnostic, carries over as-is:**
- **Game engine** (`src/engine/`) — deterministic via seeded/scripted random sources (`src/engine/random/`): setup (`src/engine/setup/`, incl. `deadline-dash.ts`), commands/execution/apply-command pipeline (roll-turn, roll-salary, roll-events, roll-random, start-game), rules (movement, salary), legal-actions, projections (public/player views), serialization. Covered by `tests/engine/*`.
- **Content pipeline** (`src/content/`) — Zod-validated schema (`src/content/schema/`) plus the "Deadline Dash" content pack (`src/content/deadline-dash/`): board, characters, ranks/promotion ladder, game modes.
- **Contracts** (`src/contracts/`) — request/response parsing + validation (`rooms.ts`, `realtime.ts`), reusable by a Hono handler exactly as it was reusable by a Next.js route handler.
- **Server layer** (`src/server/`) — `rooms/service` (create-room-service, game-setup, projections), `auth/require-session.ts`, `realtime/publish-room-update.ts`. This is plain TS with no Next.js imports — it becomes what Hono handlers call into.
  - ⚠️ **Rooms are currently backed by an in-memory repository, not Postgres** (`src/server/rooms/default-service.ts` instantiates `InMemoryRoomRepository`). The DB schema exists (`src/db/game-schema.ts` + migrations `drizzle/0001`/`0002`) but isn't wired in yet — state won't survive a restart. Worth fixing as part of the rewrite rather than porting the gap forward.
- Drizzle: `src/db/index.ts`, `src/db/auth-schema.ts`, `src/db/game-schema.ts`, `drizzle.config.ts`. Migrations `0000`–`0002` generated, **not confirmed applied to the live Supabase project**.

**Next.js-specific, needs a rewrite:**
- `src/app/api/rooms/**` (create, join, get, start, roll route handlers) → becomes Hono routes calling the same `src/server/rooms/service`.
- `src/app/api/auth/[...all]/route.ts` → becomes `auth.handler` mounted on a Hono route.
- `src/app/rooms/[roomId]/page.tsx`, `src/app/rooms/[roomId]/game/page.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/sign-in`, `src/app/sign-up` → become TanStack Router route files under a Vite app.
- `src/components/room/*` and `src/components/game/*` are mostly portable (client-side already) but their data loading needs to move from whatever Next.js pattern they used to TanStack Router loaders; `src/realtime/room-channel.ts` (`subscribeRoomUpdates`) should be unaffected since it's just a Supabase client subscription.
- `next.config.ts`, `next-env.d.ts`, Next.js-specific eslint config entries — deleted, replaced by Vite config + a Hono entrypoint.
- `.env.local` / `.env.example` — same secrets, just no more Next.js-specific env var conventions (e.g. `NEXT_PUBLIC_*` prefixes become whatever Vite's convention is, `VITE_*`).
- Fixed this session (before the pivot decision, still relevant post-pivot): root `vitest.config.ts` was missing the `@/` → `src/` path alias; fixed by adding it to the root config and deleting a stray duplicate config under `src/components/room/`.
- Not yet verified/likely missing regardless of framework: event-card resolution wired end-to-end, hidden-role reveal flow, winner screen, DB persistence for rooms/games, sign-in exercised live against Supabase.

## Next step

1. Scaffold the Hono + Vite + TanStack Router app shape (single deployable, see tech stack table above) — pick and wire the dev-server integration (e.g. `@hono/vite-dev-server`) so `pnpm dev` stays one command.
2. Port `src/app/api/**` route handlers to Hono routes, calling the existing `src/server/rooms/service` and `auth.handler` unchanged.
3. Port `src/app/**` pages to TanStack Router route files; move Server-Component-style data loading to route `loader`s.
4. Decide whether to wire the room service to Postgres now (schema + migrations already exist) or keep in-memory for longer — do this as part of the rewrite, not after.
5. Once the app boots on the new stack: commit (large uncommitted tree — split into logical commits), then audit gameplay completeness (event cards, hidden roles, winner screen) and exercise sign-in end-to-end against Supabase.

## MVP scope (from PRD)

- [x] Lobby (create/join room, ready-up) — `src/components/room/`, `src/app/api/rooms/{route,join}.ts`
- [x] Realtime transport (Supabase Realtime, wired for room + game updates)
- [x] Auth (guest + email/password)
- [x] Dice roll + player movement — engine `rules/movement.ts`, `execution/roll-turn.ts`, API `rooms/[roomId]/roll`
- [x] Board (28 spaces, tile effects) — `src/content/deadline-dash/board.ts`
- [ ] Event cards — content/schema exists (`schema/effects.ts`), end-to-end resolution not confirmed
- [ ] Hidden character roles — character content exists (`content/deadline-dash/characters.ts`), reveal/role-assignment flow not confirmed
- [x] Promotion system (ladder, requirements) — `content/deadline-dash/ranks.ts`, `engine/rules/salary.ts`
- [ ] Winner screen — not located this session, needs check
- [x] Shared game-engine module (board/dice/cards/promotion/turn logic) — `src/engine/`, server-authoritative, projections synced via Supabase Realtime

## Future (post-MVP, per PRD)
AI bots, chat, spectator mode, replay, leaderboard, daily challenges, avatars, mobile support.
