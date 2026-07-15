# Office Ladder — Working Plan

Living doc so any agent (or human) picking this up mid-stream has full context. Update it as work progresses — especially the "Current state" and "Next step" sections.

## What this is

Browser-based multiplayer board game (Monopoly-like), office theme. Players roll dice, move around a 28-space board, collect money/reputation/energy, climb a promotion ladder from Intern to Director. 2–6 players per room, real-time, turn-based (30s turn timer). Full gameplay spec: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — board tiles, promotion ladder requirements, hidden roles, event cards, win condition. That doc's "Technology Stack" section is historical/superseded; this file (PLAN.md) is the source of truth for tech decisions.

## Tech stack (decided, with reasoning — don't re-litigate without new info)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, TS, Tailwind 4), single app, no monorepo | Everything in one deployable — see "Rejected approaches" |
| Realtime | Supabase Realtime (broadcast / postgres_changes) | Managed websockets — no custom Node server or Socket.io. Auth stays on Better Auth (Supabase Auth unused). |
| Auth | Better Auth — anonymous plugin + email/password, both enabled. No OAuth, no email verification, no 2FA (bare minimum for POC) | Room-based party game — guest join by name is the primary flow; email/password exists so identity can persist/link later |
| ORM | Drizzle + `pg` (node-postgres) | Swapped from Prisma: no native binary/build-approval friction, no separate codegen step, thinner runtime |
| DB | Postgres via Supabase project **office-ladder** (ref `vdhumwwdgwuhtyurijtp`, region `ap-southeast-1`) | Railway Postgres was tried and abandoned — see below |
| Hosting (target) | Flexible (Vercel ok now that Socket.io custom server is gone) | Realtime is offloaded to Supabase; Next.js can be serverless |
| Backend language | TypeScript only, no Go | Better Auth is TS-only; no need for a separate game socket process |

### Rejected approaches (don't re-suggest these)
- **Custom `server.js` + Socket.io** — removed; replaced by Supabase Realtime.
- **Separate `apps/realtime` Socket.io service + monorepo split** — built once, then reverted.
- **Pure Next.js API route Socket.io hack** (`res.socket.server` in `pages/api/socket.ts`) — broken on Next.js 16; do not retry.
- **Go backend** — Better Auth can't run in it; would require a separate Node auth sidecar for no real gain on a game this size.
- **Prisma** — works, but heavier than needed; team explicitly prefers Drizzle.
- **Railway Postgres** (`trolley.proxy.rlwy.net:20187`) — abandoned; Supabase is the DB.
- **Supabase Auth** — not used; Better Auth owns sessions/users.

### Environment gotcha (matters for whoever runs migrations next)
**This sandboxed dev environment cannot make raw TCP connections** — only HTTPS through the pre-configured proxy works. Confirmed by: `psql`/`/dev/tcp` timing out against Railway, against Supabase's direct host (which is also IPv6-only — a separate, additional problem), and against Supabase's IPv4 session pooler. None of that is a DB provider issue — it's this environment's egress policy.

**Workaround used:** the Supabase MCP tools (`mcp__Supabase__execute_sql`, `mcp__Supabase__apply_migration`) go over the Supabase Management API (HTTPS), not raw Postgres wire protocol, so they work from here. Drizzle migrations were generated locally with `drizzle-kit generate` (no DB connection needed for `generate`, only for `push`/`migrate`), then the resulting SQL was meant to be applied via `apply_migration`.

**If running from a normal machine/CI/VPS** (not this sandbox), raw TCP will work fine and `drizzle-kit push` or a real `psql` connection is simpler — no need for the MCP-tool workaround there.

## Current state

- Repo: single flat Next.js app at root, working directly on `main` (no feature branches — explicit instruction).
- Standard Next.js scripts (`next dev -p 3072` / `next start -p 3072`) — custom `server.js` + Socket.io removed.
- Better Auth wired: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`.
- Supabase client helpers: `src/lib/supabase/client.ts` (publishable), `src/lib/supabase/server.ts` (secret) — Realtime-ready, auth disabled on the client.
- Drizzle: `src/db/index.ts`, `src/db/auth-schema.ts`, `drizzle.config.ts`. Auth tables applied on Supabase.
- `.env.local` has `DATABASE_URL` (session pooler), Supabase keys, Better Auth secrets; URLs point at `http://localhost:3072`.
- `.env.example` is a safe template (no secrets).
- **Not started yet:** game board/tiles/dice/cards/promotion logic, lobby/room UI, Supabase Realtime channel wiring for game events.

## Next step

1. Exercise sign-in (anonymous + email/password) end-to-end against Supabase Postgres.
2. Wire Supabase Realtime (broadcast channels for rooms) for lobby/game events.
3. Build game logic — see MVP scope below.

## MVP scope (from PRD, not started)

- [ ] Lobby (create/join room, ready-up)
- [ ] Realtime transport (Supabase Realtime — clients wired, no game events yet)
- [x] Auth (guest + email/password)
- [ ] Dice roll + player movement
- [ ] Board (28 spaces, tile effects)
- [ ] Event cards
- [ ] Hidden character roles
- [ ] Promotion system (ladder, requirements)
- [ ] Winner screen
- [ ] Shared game-engine module (board/dice/cards/promotion/turn logic) — server-authoritative, synced via Supabase

## Future (post-MVP, per PRD)
AI bots, chat, spectator mode, replay, leaderboard, daily challenges, avatars, mobile support.
