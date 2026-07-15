# Office Ladder — Working Plan

Living doc so any agent (or human) picking this up mid-stream has full context. Update it as work progresses — especially the "Current state" and "Next step" sections.

## What this is

Browser-based multiplayer board game (Monopoly-like), office theme. Players roll dice, move around a 28-space board, collect money/reputation/energy, climb a promotion ladder from Intern to Director. 2–6 players per room, real-time, turn-based (30s turn timer). Full gameplay spec: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — board tiles, promotion ladder requirements, hidden roles, event cards, win condition. That doc's "Technology Stack" section is historical/superseded; this file (PLAN.md) is the source of truth for tech decisions.

## Tech stack (decided, with reasoning — don't re-litigate without new info)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, TS, Tailwind 4), single app, no monorepo | Everything in one deployable — see "Rejected approaches" |
| Realtime | Socket.io, attached to a custom `server.js` | Next.js's own request routing never hands connections to another listener — the "attach via `res.socket.server` in a Pages API route" trick is broken (tested, got empty responses). A custom server (Next's own documented escape hatch) is the only way to get a persistent WS server without a separate backend. |
| Auth | Better Auth — anonymous plugin + email/password, both enabled. No OAuth, no email verification, no 2FA (bare minimum for POC) | Room-based party game — guest join by name is the primary flow; email/password exists so identity can persist/link later |
| ORM | Drizzle + `pg` (node-postgres) | Swapped from Prisma: no native binary/build-approval friction, no separate codegen step, thinner runtime, works fine self-hosted |
| DB | Postgres via Supabase project **office-ladder** (ref `vdhumwwdgwuhtyurijtp`, region `ap-southeast-1`, org `representative-green-antelope`, free tier) | Railway Postgres was tried and abandoned — see below |
| Hosting (target) | VPS or Railway — explicitly **not Vercel** | Vercel serverless functions can't hold persistent WebSocket connections; self-hosting is required for the custom server to work |
| Backend language | TypeScript only, no Go | Better Auth is TS-only (no Go port); splitting auth to a Node sidecar + Go game server was considered and rejected as unnecessary complexity for a turn-based game |

### Rejected approaches (don't re-suggest these)
- **Separate `apps/realtime` Socket.io service + monorepo split** — built once, then reverted. Not needed once you accept a custom server; adds deploy/CORS overhead for no benefit at this scale.
- **Pure Next.js API route Socket.io hack** (`res.socket.server` in `pages/api/socket.ts`) — implemented and empirically confirmed broken on Next.js 16 (handshake returns empty body). Do not retry without validating against a fresh Next.js version first.
- **Go backend** — Better Auth can't run in it; would require a separate Node auth sidecar for no real gain on a game this size.
- **Prisma** — works, but heavier than needed; team explicitly prefers Drizzle.
- **Railway Postgres** (`trolley.proxy.rlwy.net:20187`) — connection string was provided but abandoned once we realized the blocker was environmental, not provider-specific (see gotcha below). Could be revisited if hosting moves to Railway anyway, but there's no code depending on it now.

### Environment gotcha (matters for whoever runs migrations next)
**This sandboxed dev environment cannot make raw TCP connections** — only HTTPS through the pre-configured proxy works. Confirmed by: `psql`/`/dev/tcp` timing out against Railway, against Supabase's direct host (which is also IPv6-only — a separate, additional problem), and against Supabase's IPv4 session pooler. None of that is a DB provider issue — it's this environment's egress policy.

**Workaround used:** the Supabase MCP tools (`mcp__Supabase__execute_sql`, `mcp__Supabase__apply_migration`) go over the Supabase Management API (HTTPS), not raw Postgres wire protocol, so they work from here. Drizzle migrations were generated locally with `drizzle-kit generate` (no DB connection needed for `generate`, only for `push`/`migrate`), then the resulting SQL was meant to be applied via `apply_migration`.

**If running from a normal machine/CI/VPS** (not this sandbox), raw TCP will work fine and `drizzle-kit push` or a real `psql` connection is simpler — no need for the MCP-tool workaround there.

## Current state

- Repo: single flat Next.js app at root, working directly on `main` (no feature branches — explicit instruction).
- `server.js` — custom server, Next.js + Socket.io on one HTTP server/port. Verified working (`pnpm dev` → 200 on `/`, valid Socket.io handshake on `/socket.io/`).
- Better Auth wired: `src/lib/auth.ts` (server config), `src/lib/auth-client.ts` (React client), `src/app/api/auth/[...all]/route.ts` (App Router handler).
- Drizzle: `src/db/index.ts` (pg Pool + drizzle instance), `src/db/auth-schema.ts` (generated — `user`, `session`, `account`, `verification` tables), `drizzle.config.ts`.
- Migration SQL generated and committed: `drizzle/0000_quick_microchip.sql`.
- `.env.local` (gitignored, NOT committed) has `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`/`NEXT_PUBLIC_BETTER_AUTH_URL` set to `http://localhost:3000`. `DATABASE_URL` is **not yet set to a working value** — needs the real Supabase connection string (see Next step).
- `.env.example` is a generic template (provider-agnostic, no hardcoded Supabase host) — safe to commit, no secrets.
- Better Auth skills installed at `.agents/skills/` / `.claude/skills/` (via `npx skills add better-auth/skills`): `create-auth`, `better-auth-best-practices`, `better-auth-security-best-practices`, `email-and-password-best-practices`, `organization-best-practices`, `two-factor-authentication-best-practices`.
- **Not started yet:** game board/tiles/dice/cards/promotion logic, lobby/room UI, any actual gameplay UI, Socket.io event handlers beyond a bare `connection`/`disconnect` log.

## Blocked / Next step

The migration (`drizzle/0000_quick_microchip.sql`) has **not** been applied to the Supabase `office-ladder` database yet. Last attempt via `mcp__Supabase__apply_migration` was denied by the user pending a decision on how they want to review/approve it — **check with the user before retrying**, don't just re-run the same call.

Once applied:
1. Confirm tables exist: `mcp__Supabase__list_tables` on project `vdhumwwdgwuhtyurijtp`.
2. Get the real DB password from the user (Supabase dashboard → office-ladder → Project Settings → Database) or from what they already pasted earlier in chat — set `DATABASE_URL` in `.env.local`. Prefer the **session pooler** host (`aws-0-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.vdhumwwdgwuhtyurijtp`) over the direct `db.vdhumwwdgwuhtyurijtp.supabase.co` host, since the direct host is IPv6-only and may not be reachable from every environment.
3. `pnpm dev`, exercise a sign-in flow (anonymous + email/password) end-to-end to confirm Better Auth ↔ Drizzle ↔ Supabase actually works. Note: live DB connectivity can't be verified from *this* sandbox (see gotcha above) — needs testing from an environment with normal TCP egress.
4. Then move on to actual game logic — see MVP scope below.

## MVP scope (from PRD, not started)

- [ ] Lobby (create/join room, ready-up)
- [x] Realtime transport (Socket.io wired, no game events yet)
- [x] Auth (guest + email/password, pending DB verification)
- [ ] Dice roll + player movement
- [ ] Board (28 spaces, tile effects)
- [ ] Event cards
- [ ] Hidden character roles
- [ ] Promotion system (ladder, requirements)
- [ ] Winner screen
- [ ] Shared game-engine module (board/dice/cards/promotion/turn logic) — server-authoritative, called from Socket.io handlers

## Future (post-MVP, per PRD)
AI bots, chat, spectator mode, replay, leaderboard, daily challenges, avatars, mobile support.
