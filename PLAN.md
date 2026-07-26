# Office Ladder — Working Plan

Living doc so any agent (or human) picking this up mid-stream has full context. Update it as work progresses — especially "Current state" and "Next step". For durable, less-frequently-changing context (exact commands, env vars, architecture rationale, the load-bearing lessons), see [`AGENTS.md`](AGENTS.md) — this file is the status dashboard, AGENTS.md is the reference.

Detailed second-pass plans for the complete game live in [`plans/README.md`](plans/README.md). Those plans were written against the original Next.js architecture and use Next.js-era terminology in places (Server Components, Route Handlers) that should be read as their Hono/TanStack Router equivalents — see `plans/02-repository-architecture.md`.

**Gameplay is driven by [`plans/24-gameplay-v2-spec.md`](plans/24-gameplay-v2-spec.md)**, the authoritative build contract for the v2 ruleset. Its five waves are now built; this file records what that produced and what is still wrong.

## What this is

Browser-based multiplayer board game, office theme. 2–6 players per room, real-time, turn-based, bots fill empty seats. It is no longer "roll, move, collect money": a turn is a free action plus an optional dice adjustment plus a roll, over a board with owned tiles, placements, multi-turn projects, upkeep, loans, heat, agreements, ballots and quarters. Full v2 spec: [`plans/24-gameplay-v2-spec.md`](plans/24-gameplay-v2-spec.md). `docs/GAME_DESIGN.md`'s "Technology Stack" section is historical/superseded.

## Tech stack (decided, with reasoning — don't re-litigate without new info)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | bun workspaces + Nx (package-based, no `project.json` — targets come from each package's own `package.json` scripts) | Explicit ask for a "proper monorepo... preferably NX" after the app outgrew a single package |
| Backend | Hono on Bun (`apps/server`) | Minimal, fast, no bundler/RSC machinery |
| Frontend | TanStack Router + React 19 + Vite + Tailwind 4 + shadcn/ui (`apps/web`) | File/type-safe routing without a metaframework |
| Shared packages | `@office-ladder/engine`, `@office-ladder/content`, `@office-ladder/contracts`, `@office-ladder/db` | Real package boundaries instead of a flat `src/` |
| Realtime | Native WebSockets via `hono/bun`'s `upgradeWebSocket`, **per-socket projections** | Explicit instruction to drop Supabase Realtime; hidden information makes a shared topic payload a leak by construction |
| Auth | Better Auth (username + email/password), mounted directly on Hono | No OAuth/2FA/email verification — bare minimum for a room-join party game |
| ORM/driver | Drizzle + `drizzle-orm/bun-sql` | "Use bun as much as possible" |
| DB | Postgres via Supabase project **office-ladder** (ref `vdhumwwdgwuhtyurijtp`, `ap-southeast-1`), used only as a plain Postgres host | Supabase's own SDK/Auth/Realtime are unused |
| Dev servers | Two real processes (`apps/server` on Bun, `apps/web` on Vite), Vite proxies `/api` and `/ws`. Production: one process serving built static + API. | `@hono/vite-dev-server`'s Bun adapter was tried and didn't work in-process (Node vs Bun module execution) — see AGENTS.md |

### Rejected approaches (don't re-suggest these)
- **Next.js (App Router)** — rejected 2026-07-20, "too heavy." Replaced by Hono + TanStack Router.
- **Supabase Realtime** — rejected in favour of native `hono/bun` WebSockets.
- **`@hono/vite-dev-server` for a single unified dev process** — tried, hit a Node/Bun module-execution conflict (`Bun is not defined` inside Vite's SSR module runner even with the Bun adapter).
- **Flat single-package layout** — replaced by the Nx monorepo per explicit instruction.
- **Custom `server.js` + Socket.io**, **separate `apps/realtime` Socket.io service**, **Go backend**, **Prisma**, **Railway Postgres**, **Supabase Auth** — all previously tried and abandoned.

### Environment fact (matters for anyone touching the repository layer or migrations)
**The database IS reachable from this dev environment.** `select 1` through Bun's native `SQL` client against the Supabase session pooler returns a row. `drizzle-kit push`/`migrate` and real integration tests against Postgres can and should be run here. **Any change to `apps/server/src/rooms/postgres-repository.ts`, to `packages/db`'s schema, or to command-persistence ordering must be verified against the real database, not only against `InMemoryRoomRepository`.**

This paragraph previously claimed the exact opposite. **That was false and was never tested before being written down.** It was handed to roughly thirty agent prompts as a reason not to test against Postgres, so a concurrency change was validated only against `InMemoryRoomRepository` — which has no foreign keys — and a foreign-key ordering bug shipped that made `game.start` impossible to persist. Do not reintroduce the claim. If a connection genuinely fails for you, prove it with the command and its output first. (`plans/21-risk-register-and-open-questions.md`'s RISK-020 still repeats the old claim and needs the same correction.)

A second, sharper version of the same lesson landed this round: the jsonb columns held a **JSON string, not JSON**, for the entire life of the schema, and every round-trip test passed because the double encode and double decode cancelled out. **A round-trip assertion cannot see an encoding bug — only the database can.** See AGENTS.md.

## Current state (updated 2026-07-27)

Gameplay v2's five waves are built. Verified this round: `bun run typecheck` clean across 6 projects, `bun run lint` clean, `bun run test` 3,424 tests across 5 projects with **one** failure — a load-flaky timeout in `apps/server/tests/rooms/driver-interleaving.test.ts` that passes in isolation. All four presets created, started and played in a real browser on port 3072.

**What's real and working** (each of these was exercised through the browser or measured against the live database, not just typechecked):

- **Thirty commands**, all with transitions: 27 player commands plus `window.expire`/`quarter.advance`/`turn.timeout` server-injected. The full list is in AGENTS.md.
- **242 card definitions across six decks** (254 instances with `copies`), using the v2 effect vocabulary — `modifyHeat` ×51, `transferResource` ×19, `chooseOne` ×9, `grantImmunity` ×8, `removeStatuses` ×3 alongside the v1 verbs. A `deck.board-meeting` card combining `payResource → all-opponents`, `modifyResource` and `modifyHeat` drew and resolved mid-match with no crash.
- **Four presets plus lobby-authored custom rulesets**, all reachable from the lobby and all producing genuinely different matches: Quick starts at $1,000 with ±2 pip adjust and everything social off; Marathon starts at $1,500 with ±3; Campaign at $2,000 over 8 quarters.
- **Shared contestable state, observed live**: tile ownership (8 tiles claimed in one campaign match), placements, projects started *and completed* by bots, heat accumulating to 2/3 with a threshold, upkeep, loans, quarters with a scheduled `globalEvent.bonus-season` resolving.
- **`GameState.rules` snapshotted at `game.start`**; no transition reads a per-mode value live from the pack. `packages/engine/tests/replay-guarantee.test.ts` proves a finished match replays byte-identically against a deliberately-altered content pack.
- **One command endpoint** with idempotency, revision predicate, actor entitlement and a single rejection shape. The deprecated `/roll` and `/respond` aliases are gone — both 404 live. `window.expire` refused with 403 `SERVER_INJECTED_COMMAND` live.
- **Per-socket projections**, chat with quick phrases and emote reactions (sent and persisted through the UI this round), a wall-clock expiry scheduler, and bots that play whole matches.
- **Persistence**: rooms survive restarts, and the jsonb columns now hold real JSON (migration `0004`, applied to the live database; 22/22 `room_projections` and 16/16 `games` rows converted). Game state is queryable in SQL for the first time.

**What's wrong** — the honest list, all observed this round, all detailed in AGENTS.md's "Known gaps":

1. **Decks never deplete.** Piles are materialised and sized correctly, but `drawCards` still reads the content pack, so no card ever leaves a pile — measured across all 19 stored games, every discard pile is empty. The clock-deck ending therefore has no producer at all.
2. **A promotion-block reaction window opens with no deadline and can freeze a match forever.** Reproduced from scratch in Standard, Marathon and Campaign. Three abandoned rooms produced 226 ERROR-level `bot-cannot-decide` lines in 25 minutes. The banner tells the player "this window closes on its own"; it does not.
3. **Objectives are never assigned**, in the mode whose entire win shape is objectives. The mechanic is built and unit-tested; nothing calls it.
4. **Ballots are never opened** — no authored card carries `openBallot`.
5. **`rules.timers.turnSeconds` is ignored** in favour of a process-wide env constant, so the lobby advertises 20s and the server runs 60s.
6. **`PlayerPromoted` is attributed to the command's actor**, so passing a reaction on a bot's promotion tells you *your* promotion committed.

## Next step

Work the numbered backlog at the end of [`AGENTS.md`](AGENTS.md). Items 1–3 are the ones that make a shipped mechanic real rather than decorative; item 2 is the one that loses matches.

Non-gameplay, still open:

1. Decide the RLS question deliberately before this goes anywhere a browser might talk to Supabase directly.
2. Field-level backfill for the 8 stored matches whose `rules` block predates `handLimit`/`endgame`/`promotionCostByRankIndex`.
3. Raise the per-test timeout on the DB-driving server suites, or move them off vitest's 5s default.
4. Migrate `PostgresRoomRepository` off the single-jsonb-blob approach onto the schema's normalised/event-sourced tables if room volume ever justifies it. `command_receipts` is now in use; `game_events`/`player_projections`/`game_outbox` remain empty.

## MVP scope (from PRD)

- [x] Lobby (create/join room, ready-up, mode choice, bot seats, custom rulesets)
- [x] Realtime transport (native WebSockets, per-socket projections)
- [x] Auth (username + email/password)
- [x] Dice roll + player movement, plus energy-priced dice adjustment
- [x] Board (44 spaces, every tile-effect type interpreted)
- [x] Event cards — 242 authored definitions across six decks, resolving in play
- [x] Hidden character roles — characters, passives and hidden Worker/Management assignment; Management's promotion-block power is wired to a real reaction window
- [x] Promotion system — automatic, or a real choice where `agency.promotionIsChoice` is on
- [x] Winner screen
- [x] Real player decisions, playable end to end (free actions, prompts, reactions, trades, projects, loans)
- [x] Shared game-engine module — `packages/engine`, server-authoritative
- [x] Rooms survive a server restart (Postgres-backed, verified)
- [x] Bots (were "future") — fill seats, count toward the minimum, play whole matches
- [x] Chat (was "future") — quick phrases and emote reactions, server-side, never in `GameState`
- [ ] Deck depletion and the clock-deck win condition — piles exist, nothing draws from them
- [ ] Objectives — implemented, unit-tested, never assigned

## Future (post-MVP, per PRD)
Spectator mode, replay, leaderboard, daily challenges, avatars, mobile support.
