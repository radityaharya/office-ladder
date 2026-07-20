# Office Ladder — Working Plan

Living doc so any agent (or human) picking this up mid-stream has full context. Update it as work progresses — especially the "Current state" and "Next step" sections. For durable, less-frequently-changing context (exact commands, env vars, architecture rationale), see [`AGENTS.md`](AGENTS.md) — this file is the status dashboard, AGENTS.md is the reference.

Detailed second-pass plans for the complete game, including the engine, content pipeline, assets, card artwork, frontend, backend, security, testing, operations, and physical edition, live in [`plans/README.md`](plans/README.md). Note: those plans were written against the original Next.js architecture and use Next.js-era terminology in places (Server Components, Route Handlers) that should be read as their Hono/TanStack Router equivalents — see `plans/02-repository-architecture.md` for the updated mapping.

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

### Environment gotcha (matters for whoever runs migrations next)
**This sandboxed dev environment cannot make raw TCP connections** — only HTTPS through a pre-configured proxy works. Confirmed against Railway, Supabase's direct host, and Supabase's session pooler — this is the sandbox's egress policy, not a DB provider issue. Workaround: the Supabase MCP tools (`execute_sql`, `apply_migration`) go over the Management API (HTTPS). `drizzle-kit generate` doesn't need a DB connection, only `push`/`migrate` do. **From a normal machine/CI/VPS, raw TCP works fine** and `drizzle-kit push` is simpler — no MCP workaround needed there.

## Current state (updated 2026-07-20)

The Next.js → Hono/TanStack Router migration and the Nx monorepo restructuring are both **done and committed**. Verified this session: `bun run typecheck`, `bun run lint`, and `bun run test` all pass clean across every package/app via `nx run-many` (120 tests, same count as before either migration — nothing was lost). See [`AGENTS.md`](AGENTS.md) for the full architecture, commands, and env var reference — it won't be duplicated here.

**What's real and working** (verified by direct testing this session, not just typechecking):
- `apps/server` standalone: boots, Better Auth sign-up/sign-in works against the live Supabase Postgres, room creation works through the full stack (Hono route → room service → engine).
- `apps/web` standalone: Vite boots and serves the SPA shell.
- Full room lifecycle API (create/join/get/start/roll) ported to Hono, auth-gated, same-origin-checked.
- Lobby and game UI ported off Next.js (`next/navigation` → TanStack Router's `useNavigate`/`Link`, session-gated routes via `beforeLoad`).
- Realtime: WebSocket hub (`apps/server/src/realtime/ws-hub.ts`) + client (`apps/web/src/realtime/room-channel.ts`), same invalidation-only contract as before (`ProjectionUpdated`), transport swapped from Supabase to native WS.
- **New this session**: the engine's `turn.roll` transition now runs a generic tile-effect interpreter (`resolve-tile-effects.ts`) covering `modifyResource`, `payResource`, `restoreResourceToMaximum`, `incrementWorkCounter` (with its milestone reward), `rollCheck` (doubles + total-range outcomes, recursive), `grantExtraRoll` (a real extra turn, not just a flag), and `drawCards` (a synthesized flavor table standing in for unauthored deck content) — every tile kind on the board now does something, not just the receptionist. Also auto-attempts promotion (if a player affords the next rank) and detects the win condition (reaching Director ends the match, `GameState.outcome.winnerPlayerIds` populated). Threaded through to the client — `GameBootstrap.publicProjection.winnerPlayerIds` and a winner screen in `apps/web/src/components/game/game-client.tsx`. Covered by 4 new engine tests (87/87 total, up from 83).

**What's not done / honestly incomplete** — see AGENTS.md's "Known gaps" section for full detail, summarized here:
- Rooms are **in-memory, not Postgres-backed** (schema + migrations exist, service isn't wired to them).
- **Real event/management card content was never authored** — `drawCards` uses a small built-in synthesized effect table instead of real deck content (no `deck.work`/`deck.meeting`/`deck.event`/`deck.networking` cards exist anywhere in the content pack).
- `skipTurns`, `applyStatus`, `auditConfinement` tile effects are parsed but are documented no-ops (would need turn-order-skipping and status-duration tracking, respectively — neither is modeled yet).
- Prompts/decisions (`prompt.respond`, `reaction.play`) and hidden-role abilities beyond a salary multiplier are **not implemented** — `legal-actions.ts` only ever enumerates `game.start` and `turn.roll`, so no player choice is ever surfaced.
- Combined `bun run dev` **was** verified this session (both processes together, through the Vite proxy): sign-up, session check, room creation, and the WebSocket upgrade all confirmed working end-to-end via curl.
- No manual browser playthrough was done — no browser in this environment, only HTTP/WS-level verification. The API surface is confirmed; nobody has clicked through the actual React UI yet.

## Next step

1. Manually run `bun run dev` and click through create room → join → start → roll → promote → win, in a real browser.
2. Decide DB persistence timing: wire `packages/db`'s schema into the room service now, or explicitly defer.
3. Author real management-deck card content (or deliberately scope `drawCards` to stay a flavor table) — this is the biggest remaining gap between what the content pack implies and what's implemented.
4. Implement `skipTurns` (self-contained, only touches the current player's own next-turn logic) as the next tile-effect increment.

## MVP scope (from PRD)

- [x] Lobby (create/join room, ready-up)
- [x] Realtime transport (native WebSockets)
- [x] Auth (username + email/password)
- [x] Dice roll + player movement
- [x] Board (44 spaces, tile effects interpreted for most effect types — `skipTurns`/`applyStatus`/`auditConfinement` still no-ops, see gaps above)
- [ ] Event cards — tiles trigger `drawCards`, but it's a synthesized flavor table, not real authored card content
- [ ] Hidden character roles — characters assigned/shown, no unique ability resolution beyond a salary multiplier
- [x] Promotion system — now auto-attempted on affordability, no player-driven prompt/choice yet
- [x] Winner screen — implemented this session, tied to the new win-condition
- [x] Shared game-engine module — `packages/engine`, server-authoritative, projections synced via WebSocket

## Future (post-MVP, per PRD)
AI bots, chat, spectator mode, replay, leaderboard, daily challenges, avatars, mobile support.
