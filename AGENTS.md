# Office Ladder — Agent Context

Durable context for any agent (or human) picking up this repo. See also [`PLAN.md`](PLAN.md) (working-status dashboard) and [`plans/`](plans/README.md) (deep per-domain plans).

## What this is

Browser-based multiplayer office-themed board game ("Deadline Dash"). 2–6 players, room-based, real-time, turn-based.

## Stack

- **Monorepo**: bun workspaces + Nx (package-based — no `project.json` files; Nx discovers targets from each `package.json`'s own `scripts`).
- **apps/web**: Vite + TanStack Router (file-based routing) + React 19 + Tailwind 4 + shadcn/ui.
- **apps/server**: Hono on Bun. REST API (`/api/rooms/*`), Better Auth mount (`/api/auth/*`), native WebSocket realtime (`/ws/rooms/:roomTopic`, via `hono/bun`'s `upgradeWebSocket`).
- **packages/engine**: pure deterministic game engine (`@office-ladder/engine`). No I/O, no framework deps.
- **packages/content**: authored game content — board, characters, ranks, modes (`@office-ladder/content`), the "Deadline Dash" pack.
- **packages/contracts**: shared client/server transport DTOs + validation (`@office-ladder/contracts`).
- **packages/db**: Drizzle schema + client (`@office-ladder/db`), using `drizzle-orm/bun-sql` (Bun's native Postgres driver, not `pg`/node-postgres).
- **DB**: Postgres via a Supabase project, used purely as a Postgres host — Supabase's SDK/Auth/Realtime are **not** used anywhere.
- **Auth**: Better Auth (username + email/password plugin). Mounted directly on Hono (`auth.handler(c.req.raw)`), no framework-specific auth glue.

## How this repo got here (important history — don't re-litigate)

1. Originally built on **Next.js 16 (App Router)**. Explicitly rejected 2026-07-20 — "Next is super heavy" — before that work was ever committed.
2. Rebuilt as a **single-package Hono + TanStack Router + Vite** app (still using Supabase Realtime at first).
3. Realtime swapped from Supabase Realtime to **native Hono WebSockets** (`hono/bun`) per explicit instruction, along with a push to "use bun as much as possible."
4. Restructured into the **current Nx monorepo** (apps/web, apps/server, packages/engine|content|contracts|db) per explicit instruction, to get real package boundaries and Nx caching/run-many.
5. Minimal **promotion + win-condition** logic added to the engine's `turn.roll` transition (see below) so a room can actually be won, plus a winner screen in the client.

Do not re-propose Next.js, Supabase Realtime, or a flat single-package layout without new instruction — all three were deliberate, already-tried-and-reverted choices.

## Commands

```sh
bun install                  # installs the whole workspace
bun run dev                  # both apps/server (Bun, port 3073) and apps/web (Vite, port 3072) via scripts/dev.ts
bun run typecheck            # nx run-many -t typecheck, across every package/app
bun run test                 # nx run-many -t test
bun run lint                 # eslint, workspace-wide (flat config, single root eslint.config.mjs)
bun run build                # nx run-many -t build (currently only apps/web has a real build target)
bun run start                # production: apps/server serves the built apps/web/dist/client + API on one port
bun run db:generate          # drizzle-kit generate, from packages/db
bun run db:push              # drizzle-kit push, from packages/db
```

Per-package equivalents: `bun run --cwd apps/web <script>`, `bun run --cwd packages/engine test`, etc. — every package/app's own `package.json` has `typecheck`/`test` (and `dev`/`build` where relevant); Nx just fans these out with caching.

## Dev server architecture (important, non-obvious)

**`@hono/vite-dev-server` was tried and abandoned.** The intent was one Vite process running the Hono app in dev via its Bun adapter (`@hono/vite-dev-server/bun`), matching the "single deployable" production shape. In practice this hit real breakage in this environment:
- `@vitejs/plugin-react@6.x` requires Vite 8 (not 7) — the `./internal` export it needs doesn't exist on Vite 7.x. Fixed by bumping `apps/web`'s `vite` devDependency to `^8.0.0`.
- Even after that, Vite's SSR module runner evaluates the Hono entry through Node's ESM loader, not Bun — `hono/bun`'s code that reads the global `Bun` object throws `Bun is not defined`. The Bun adapter doesn't prevent this; the underlying module execution is still Node in this dev-server integration.

**Current approach instead**: two real dev processes, orchestrated by [`scripts/dev.ts`](scripts/dev.ts) (a plain `Bun.spawn` script, no extra deps):
- `apps/server` runs as an actual Bun process (`bun --watch run src/serve.ts`) on `API_PORT` (default 3073).
- `apps/web` runs Vite normally (no dev-server plugin) on port 3072, with `server.proxy` forwarding `/api/*` to `http://localhost:$API_PORT` and `/ws/*` to `ws://localhost:$API_PORT` (`ws: true`).
- The browser only ever talks to :3072, so this is transparent — same-origin checks (`requireSameOriginMutation` in `apps/server/src/http/json.ts`) still see `Origin: http://localhost:3072`.

In **production**, there's no proxy: `apps/server/src/serve.ts` serves the built `apps/web/dist/client` (static + SPA-fallback via `hono/bun`'s `serveStatic`) *and* the API from the same Bun process on one port — the "single deployable, no monorepo-shaped runtime" goal is preserved even though the source is split into packages.

## Environment variables

See [`.env.example`](.env.example). Root `.env.local` is the single source of truth for local dev — both `bun run dev` and each app's own `dev`/`start` script load it explicitly via `bun --env-file=` (Bun only auto-loads `.env*` from the process's own cwd, and these scripts run with cwd inside `apps/*`, so the root file needs to be loaded explicitly rather than relying on Bun's default `.env` discovery).

- `DATABASE_URL` — Postgres connection string (Supabase session pooler recommended for IPv4).
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` — server-side Better Auth config.
- `VITE_BETTER_AUTH_URL` — same URL, but `VITE_`-prefixed so Vite exposes it to the browser bundle (`import.meta.env.VITE_BETTER_AUTH_URL`). Vite's `envDir` is set to the repo root in `apps/web/vite.config.ts` so it reads the root `.env.local`/`.env.example`, not a per-app one.
- `PORT` — production port for `apps/server`'s combined API+static server (default 3072).
- `API_PORT` — dev-only, used by `scripts/dev.ts` to pick the port `apps/server` binds to and that `apps/web`'s Vite proxy targets (default 3073).

## Architecture boundaries (see [`plans/02-repository-architecture.md`](plans/02-repository-architecture.md) for the full rationale)

- `packages/engine` must not import React, Hono, TanStack Router, Drizzle, Postgres, Supabase, Better Auth, env vars, browser APIs, `Math.random()`, wall-clock calls, or timers. It **does** import `@office-ladder/content` for two things (`execution/types.ts`'s `TransitionContent = typeof deadlineDashContent`, and `setup/deadline-dash.ts`) — this is pre-existing, acknowledged coupling, not something to "fix" without discussion; it means engine tests need `@office-ladder/content` as a real dependency (already wired in `packages/engine/package.json`).
- Route handlers (Hono) and route loaders (TanStack Router) are the only things allowed to import `@/server`-equivalents / `@office-ladder/db` / privileged clients. UI components never import DB or server-only modules.
- Cross-package imports always use the workspace package specifier (`@office-ladder/engine`, not `../../../engine`). Intra-app imports use that app's own `@/*` → `./src/*` alias — `apps/web` and `apps/server` each have their own, unrelated `@/*` roots.

## Known gaps / honest state (as of 2026-07-20)

- **Rooms are in-memory, not Postgres-backed.** `apps/server/src/rooms/default-service.ts` wires `InMemoryRoomRepository`. The DB schema (`packages/db/src/game-schema.ts`) and migrations (`packages/db/drizzle/0001`, `0002`) exist but nothing writes through them yet — room/game state does not survive a server restart and won't work across multiple server instances. This was true before the Nx restructuring too; it wasn't introduced by it.
- **Gameplay is a real, meaningfully-featured slice, not the full designed ruleset.** The engine's `turn.roll` transition does: roll → move → receptionist-pass salary → **generic tile-effect resolution** (`packages/engine/src/execution/resolve-tile-effects.ts` interprets `BoardTile.effects` — `modifyResource`, `payResource`, `restoreResourceToMaximum`, `incrementWorkCounter` with its every-5th-landing reputation reward, `rollCheck` with doubles/total-range outcome matching and recursive nested effects, `grantExtraRoll` which genuinely keeps the same player active for another roll instead of advancing turn order, and `drawCards`) → **auto-attempt promotion** (if the player's money/reputation meet the next rank's cost from `packages/content/src/deadline-dash/ranks.ts`, silently promote, no player choice) → **win check** (reaching `rank.director`, i.e. `MatchEndReason: "director-reached"`, ends the match and sets `GameState.outcome.winnerPlayerIds`). This makes a room genuinely completable and winnable end-to-end, and every tile kind on the board now does *something* instead of only the receptionist tile mattering.
  - **`drawCards` is a synthesized flavor table, not real card content.** No management-deck cards (`deck.work`/`deck.meeting`/`deck.event`/`deck.networking`) have ever been authored — `DECK_FLAVOR_EFFECTS` in `resolve-tile-effects.ts` is a small built-in table of plausible `modifyResource` deltas picked deterministically, standing in for the real thing. Authoring real deck content (see `packages/content/src/schema/effects.ts`'s `DeckId` references) and having `drawCards` pull from it is the natural next step, not a code change.
  - **Tile-effect randomness uses its own ephemeral seeded source** (`createSeededRandomSource(command.commandId)` in `roll-turn.ts`), deliberately *not* the persisted "dice" stream — this keeps the dice stream's cursor advancing exactly once per die roll (existing tests assert exact cursor values) while still being fully deterministic and replay-safe, since the same `commandId` always re-derives the same seed.
  - **Still not implemented**: `skipTurns` (would need turn-order-skipping logic — the effect is parsed but is a documented no-op), `applyStatus`/`auditConfinement` (status-duration tracking and the audit release mechanic aren't modeled), prompts/decisions (`prompt.respond`, `reaction.play`, etc. — defined as command types in `commands/index.ts` but `legal-actions.ts` only ever enumerates `game.start` and `turn.roll`, so nothing ever surfaces a player choice), hidden character roles/abilities beyond a salary multiplier.
  - If picking this up next: `skipTurns` is the natural next increment (self-contained — it only needs the current player's own next-turn logic, not other players' state) — see the `case "skipTurns"` comment in `resolve-tile-effects.ts`.
- **Engine tests added for the new logic**: `packages/engine/tests/tile-effects-and-promotion.test.ts` (4 tests) covers a `payResource` deduction, a `restoreResourceToMaximum` energy refill, a full promotion-to-Director win, and the "can't afford it, nothing happens" case. Full suite: 87/87.
- **Combined dev-server boot was verified working**: both `apps/server` (Bun, port 3073) and `apps/web` (Vite, port 3072) running together, confirmed via curl through the Vite proxy — sign-up (`POST /api/auth/sign-up/email` → 200), session check (`GET /api/auth/get-session` → `null` body, correct for signed-out), room creation (`POST /api/rooms` → 201 with a real room id), and the WebSocket upgrade itself (`GET /ws/rooms/:topic` with upgrade headers → `101 Switching Protocols`) all round-tripped through :3072 to the real Bun server at :3073. `bun run dev` (via `scripts/dev.ts`) should work as-is.
- **No manual browser playthrough** (create room → join → start → roll → promote → win) was done this session — no browser available in this environment, only curl against the HTTP/WS surface. The API-level plumbing is confirmed; the actual React UI rendering/interaction was not clicked through. Do this before considering the game "done."

## Next steps, roughly in priority order

1. Manually smoke-test `bun run dev` end-to-end in a real terminal/browser (create room, join with a second account, start, roll to a win).
2. Decide whether to wire `packages/db`'s Postgres-backed room repository now (schema exists) or keep in-memory deliberately for longer.
3. Build the generic tile-effect interpreter described above, or scope down the content pack's effect vocabulary to match what's actually implemented (either is a legitimate call — right now the content and the engine disagree about how rich the game is).
4. Add engine tests for promotion/win-condition.
