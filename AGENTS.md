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
  - **Automatic character passives are now applied**: `workLandingMoneyBonus` (Workaholic, on landing a "work" tile), `meetingLandingReputationBonus` (Social Butterfly, on landing "meeting"), `doublesMoneyBonus` (Lucky Employee, on rolling doubles inside a `rollCheck`), and `modifyPromotionRequirement` (Office Politician, reduces the reputation needed for the *next* promotion — wired into `resolvePromotion` in `roll-promotion.ts`). `salaryMultiplier` (Sales Star) was already handled separately in `roll-salary.ts`.
  - **`skipTurns` and `auditConfinement` are now implemented** (previously documented as not-yet-done). `resolveTileEffects` sets `player.skipTurns += count` for `skipTurns`, and sets `player.inAudit = true` + a flag for `auditConfinement`; `roll-turn.ts`'s new `resolveNextTurn` (`packages/engine/src/execution/next-turn.ts`) walks turn order skipping over any player with a positive `skipTurns` counter (decrementing it as they're passed over), and opens a real `PromptState` (kind `"audit-release"`, options `pay-fine` / `attempt-roll`) when a player lands on the audit tile.
  - **A real prompt/decision command now exists**: `prompt.respond` (`packages/engine/src/execution/respond-to-prompt.ts`), wired into `apply-command.ts` and `legal-actions.ts` (which now returns a `prompt.respond` legal action — with `decisionPointId`/`kind`/`options` — instead of `turn.roll` whenever the active player has an open prompt addressed to them). `pay-fine` deducts 500 money and releases immediately; `attempt-roll` rolls 2d6 via its own ephemeral seeded source (keyed by the response command's id, same pattern as tile-effect randomness) — doubles release, anything else leaves the *same* prompt open so the player is asked again next time it's their turn (a failed attempt does **not** silently drop the confinement). This is the first (and currently only) prompt kind wired end to end — `reaction.play`/`reaction.pass`/other decision command types still aren't.
  - **Still not implemented**: `applyStatus` (status/duration tracking beyond `inAudit`/`skipTurns` isn't modeled), the rest of the decision commands (`reaction.play`, `reaction.pass`, `management.block-promotion`, etc.), and character passives needing machinery not built yet — Tech Genius's `ignoreNegativeEffect` (per-lap usage counter) and any *targeted* effect on another player (`swapBoardPositions`, `teleport`, `stealResource` — "active" abilities with cooldowns, which need a new player-initiated command, not just automatic resolution).
  - If picking this up next: `applyStatus` is the natural next increment — the `inAudit`/`skipTurns` precedent (a field on `PlayerState` + a check somewhere in the turn pipeline) generalizes reasonably well to arbitrary named statuses with a duration.
- **Engine tests**: `packages/engine/tests/tile-effects-and-promotion.test.ts` covers `payResource`, `restoreResourceToMaximum`, promotion-to-Director win, the "can't afford it" case, Workaholic's passive, and the full audit-confinement round trip (land on the tile → prompt opens → `pay-fine` releases + deducts money). `packages/engine/tests/legal-actions.test.ts` covers `prompt.respond` appearing/not-appearing correctly. Full engine suite: 92/92.
- **Combined dev-server boot verified working, including a real manual browser playthrough** (this was the single biggest gap from the prior round, and it caught a real bug — see below). Verified via a connected Chrome browser: create-room → lobby → start → **multiple live dice rolls with visible tile effects** (money/energy/work-counter changes, turn advancing, activity log populating with real committed events). No console errors.
  - **Bug found and fixed via that browser check**: `/rooms/$roomId/game` is a TanStack Router *child* route of `/rooms/$roomId` (dot-segment file naming — `rooms.$roomId.game.tsx` nests under `rooms.$roomId.tsx`). The parent's component was rendering `RoomLobbyClient` directly instead of an `<Outlet />`, so the child route's content (the actual game view) **could never display, regardless of URL** — visiting `/rooms/:id/game` silently showed the lobby instead. Fixed by restructuring: `rooms.$roomId.tsx` is now a pure layout (`component: Outlet`, plus the shared auth `beforeLoad` guard so it isn't duplicated in every child), the lobby moved to a new `rooms.$roomId.index.tsx`, and `rooms.$roomId.game.tsx` dropped its now-redundant duplicate auth guard. This is a instructive example of the general TanStack Router file-routing footgun: any dot-segment-nested child route file needs its parent to actually render `<Outlet />`, or the child is unreachable no matter what the URL is — worth checking for on any new nested route added later.
  - `prompt.respond` is now also reachable from the UI: a `PromptPanel` in `apps/web/src/components/game/game-client.tsx` renders buttons for the active player's open prompt (currently only ever `audit-release`'s `pay-fine`/`attempt-roll`), posting to the new `POST /api/rooms/:roomId/respond` route (`apps/server/src/routes/rooms.ts`, backed by `roomService.respondToPrompt`, mirroring `roll`'s shape exactly).

## Next steps, roughly in priority order

1. Decide whether to wire `packages/db`'s Postgres-backed room repository now (schema exists) or keep in-memory deliberately for longer.
2. Build a generic tile-effect interpreter for the remaining unimplemented effect types (`applyStatus`, real `drawCards` content), or scope down the content pack's effect vocabulary to match what's implemented.
3. Wire more decision command types (`reaction.play`/`reaction.pass`) using `prompt.respond`/`respond-to-prompt.ts` as the template — the plumbing (legal-actions, apply-command, Hono route, room service method, `PromptPanel` UI) now exists once and should mostly just need a new prompt `kind` and option set, not new infrastructure.
4. When adding any new nested route in `apps/web/src/routes/`, check whether the parent route file needs an `<Outlet />` — see the routing bug above.
