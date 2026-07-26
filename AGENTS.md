# Office Ladder — Agent Context

Durable context for any agent (or human) picking up this repo. See also [`PLAN.md`](PLAN.md) (working-status dashboard) and [`plans/`](plans/README.md) (deep per-domain plans).

**Gameplay is governed by [`plans/24-gameplay-v2-spec.md`](plans/24-gameplay-v2-spec.md)** — the authoritative build contract for the v2 ruleset. That spec describes what was *built*; this file describes what the game *is* today and where it is still lying to you. Where they disagree about intent, the spec wins. Read its "Standing instructions for every agent" before touching engine, contracts, or game-UI code.

Everything below was re-verified on 2026-07-27 against a running stack and the live Postgres. Numbers in this file are the numbers a command printed, not the numbers a previous doc claimed.

## What this is

Browser-based multiplayer office-themed board game ("Deadline Dash"). 2–6 players, room-based, real-time, turn-based, bots fill empty seats.

## Stack

- **Monorepo**: bun workspaces + Nx (package-based — no `project.json` files; Nx discovers targets from each `package.json`'s own `scripts`).
- **apps/web**: Vite + TanStack Router (file-based routing) + React 19 + Tailwind 4 + shadcn/ui.
- **apps/server**: Hono on Bun. REST API (`/api/rooms/*`), Better Auth mount (`/api/auth/*`), native WebSocket realtime (`/ws/rooms/:roomTopic`, via `hono/bun`'s `upgradeWebSocket`). Rooms are Postgres-backed (`PostgresRoomRepository`).
- **packages/engine**: pure deterministic game engine (`@office-ladder/engine`). No I/O, no framework deps.
- **packages/content**: authored game content — board, characters, ranks, modes, six card decks (`@office-ladder/content`), the "Deadline Dash" pack.
- **packages/contracts**: shared client/server transport DTOs + validation (`@office-ladder/contracts`).
- **packages/db**: Drizzle schema + client (`@office-ladder/db`), using `drizzle-orm/bun-sql` (Bun's native Postgres driver, not `pg`/node-postgres).
- **DB**: Postgres via a Supabase project, used purely as a Postgres host — Supabase's SDK/Auth/Realtime are **not** used anywhere.
- **Auth**: Better Auth (username + email/password plugin). Mounted directly on Hono (`auth.handler(c.req.raw)`), no framework-specific auth glue.

## How this repo got here (important history — don't re-litigate)

1. Originally built on **Next.js 16 (App Router)**. Explicitly rejected 2026-07-20 — "Next is super heavy" — before that work was ever committed.
2. Rebuilt as a **single-package Hono + TanStack Router + Vite** app (still using Supabase Realtime at first).
3. Realtime swapped from Supabase Realtime to **native Hono WebSockets** (`hono/bun`) per explicit instruction, along with a push to "use bun as much as possible."
4. Restructured into the **current Nx monorepo** (apps/web, apps/server, packages/engine|content|contracts|db) per explicit instruction, to get real package boundaries and Nx caching/run-many.
5. A minimal roll-and-move slice: dice, movement, tile effects, automatic promotion, a Director win, one prompt kind, and a Postgres-backed room repository.
6. **Gameplay v2** (the current shape, spec §9's five waves): modes became data-driven rulesets, the engine grew shared contestable state, the command set went from three implemented verbs to thirty, the transport collapsed onto one endpoint, and the client grew a panel shell that can reach all of it.

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

Per-package equivalents: `bun run --cwd apps/web <script>`, `bun run --cwd packages/engine test`, etc.

**In dev, use port 3072, never 3073.** `serve.ts` mounts the built `apps/web/dist/client` with no dev guard, so hitting the API port directly serves whatever stale bundle happens to be on disk. Two "bugs" in this project's history were a stale client on :3073. A third was a stale `bun --watch` module graph: if something looks broken, restart the stack cleanly before believing it.

## Dev server architecture (important, non-obvious)

**`@hono/vite-dev-server` was tried and abandoned.** The intent was one Vite process running the Hono app in dev via its Bun adapter (`@hono/vite-dev-server/bun`), matching the "single deployable" production shape. In practice this hit real breakage in this environment:
- `@vitejs/plugin-react@6.x` requires Vite 8 (not 7) — the `./internal` export it needs doesn't exist on Vite 7.x. Fixed by bumping `apps/web`'s `vite` devDependency to `^8.0.0`.
- Even after that, Vite's SSR module runner evaluates the Hono entry through Node's ESM loader, not Bun — `hono/bun`'s code that reads the global `Bun` object throws `Bun is not defined`. The Bun adapter doesn't prevent this; the underlying module execution is still Node in this dev-server integration.

**Current approach instead**: two real dev processes, orchestrated by [`scripts/dev.ts`](scripts/dev.ts) (a plain `Bun.spawn` script, no extra deps):
- `apps/server` runs as an actual Bun process (`bun --watch run src/serve.ts`) on `API_PORT` (default 3073).
- `apps/web` runs Vite normally (no dev-server plugin) on port 3072, with `server.proxy` forwarding `/api/*` to `http://localhost:$API_PORT` and `/ws/*` to `ws://localhost:$API_PORT` (`ws: true`).
- The browser only ever talks to :3072, so this is transparent — same-origin checks (`requireSameOriginMutation` in `apps/server/src/http/json.ts`) still see `Origin: http://localhost:3072`.

In **production**, there's no proxy: `apps/server/src/serve.ts` serves the built `apps/web/dist/client` (static + SPA-fallback via `hono/bun`'s `serveStatic`) *and* the API from the same Bun process on one port.

## Environment variables

See [`.env.example`](.env.example). Root `.env.local` is the single source of truth for local dev — both `bun run dev` and each app's own `dev`/`start` script load it explicitly via `bun --env-file=` (Bun only auto-loads `.env*` from the process's own cwd, and these scripts run with cwd inside `apps/*`).

- `DATABASE_URL` — Postgres connection string (Supabase session pooler recommended for IPv4).
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` — server-side Better Auth config.
- `VITE_BETTER_AUTH_URL` — same URL, `VITE_`-prefixed so Vite exposes it to the browser bundle. Vite's `envDir` is the repo root (`apps/web/vite.config.ts`).
- `PORT` — production port for the combined API+static server (default 3072).
- `API_PORT` — dev-only, the port `apps/server` binds to and that Vite proxies to (default 3073).
- `TURN_TIMEOUT_SECONDS` — process-wide turn timeout. **This currently overrides the per-mode `rules.timers.turnSeconds`** — see "Known gaps".
- `BOT_TURN_DELAY_MS` — overrides the mode's bot think-time range.

## Architecture boundaries (see [`plans/02-repository-architecture.md`](plans/02-repository-architecture.md))

- `packages/engine` must not import React, Hono, TanStack Router, Drizzle, Postgres, Supabase, Better Auth, env vars, browser APIs, `Math.random()`, wall-clock calls, or timers. It **does** import `@office-ladder/content` for `execution/types.ts`'s `TransitionContent` and `setup/deadline-dash.ts` — pre-existing, acknowledged coupling.
- Route handlers (Hono) and route loaders (TanStack Router) are the only things allowed to import `@office-ladder/db` / privileged clients. UI components never import DB or server-only modules.
- Cross-package imports always use the workspace package specifier (`@office-ladder/engine`, not `../../../engine`). Intra-app imports use that app's own `@/*` → `./src/*` alias — `apps/web` and `apps/server` each have their own, unrelated `@/*` roots.

---

## The load-bearing lessons

These cost real debugging time. They generalise; the feature list below does not.

### 1. Every serious bug in this build was a seam bug

Not one of them was a layer being wrong about itself. Every one was a layer that verified itself thoroughly while nobody verified the layer above it:

- **Content grew a vocabulary the engine could not consume.** `effects.ts` gained targeting, timing and a dozen new effect types; the resolver still only understood immediate self-effects, so authored cards silently did nothing.
- **The engine grew thirty commands while the transport carried three.** `apply-command.ts` handled the union; `routes/rooms.ts` had a hand-written route for `roll` and one for `respond`. Twenty-eight verbs existed and were unreachable.
- **The transport reached twenty-seven while the UI branched on two.** `POST /commands` accepted the whole union; `game-client.tsx` rendered a Roll button and a prompt panel.
- **Four presets shipped behind a hardcoded literal.** `mode.standard`, `mode.marathon` and `mode.campaign` were authored, validated and tested, and the lobby posted `mode.quick` unconditionally.

Every one of these passed its own layer's tests. The rule that falls out: **a mechanic is not done when its own package is green — it is done when something at the outermost layer that a user touches exercises it.** For gameplay, that means a browser playthrough. Two separate rounds of manual browser play in this repo each caught a defect no suite could see (a router `<Outlet />` that made the game view unreachable, and the promotion reaction window described below).

### 2. Hand-kept allow-lists drift, three times over

`packages/engine/src/serialization/index.ts` guards an untrusted persisted snapshot, so its allow-lists cannot be derived from the type at runtime — the whole point is to reject a string the model does not name. But a hand-kept list drifts the *other* way too: a variant added to the model and forgotten in the list makes the engine refuse to serialize its own legal state. That happened three separate times; the worst was `MatchEndReason` gaining `quarters-elapsed`, `objectives-complete` and `last-standing` while the list kept the original four, so **every match that ended for a new reason failed to persist.**

The lists now carry compile-time coverage proofs (`Missing<Union, Tuple>` plus a `_ALLOW_LISTS_COVER_EVERY_VARIANT` assignment): adding a variant to the model without adding it to the list is a type error naming the missing member. Copy that pattern for any new hand-kept list over a model union — a bare `as const` array is only protected in one direction.

A second instance of the same class: `stateSchemaVersion` was bumped without a matching migration entry, which made `game.start` unstorable. And `negativeEffectsIgnoredThisLap` was added to `PlayerState` *without* bumping the version, so "v1" covers several real shapes and two live rooms became unopenable until `upgradePlayerV1ToV2` learned to default it.

### 3. A bot that offers more than it holds stalls the whole table

Bots run in a drain loop that stops when the policy has no decision. If a bot proposes a trade or a contribution it cannot fund, the command is rejected, the drain makes no progress, and **nobody else can act, because it is the bot's turn.** One under-funded bot freezes every seat. That is why affordability is a single exhaustive switch over the command union in the bot policy rather than a per-command guard: a new command added without an affordability answer is a compile error, not a silent match-killer discovered by a player.

The related failure mode is still live — see the reaction-window gap below.

### 4. The database is reachable. Test against it.

`select 1` over `DATABASE_URL` works from this environment. A doc once claimed the opposite, was never tested, and was handed to roughly thirty agent prompts as a reason not to test persistence — which is how a foreign-key ordering bug shipped that made `game.start` impossible to persist. `InMemoryRoomRepository` has no foreign keys, so a green in-memory test says nothing.

The same lesson recurred: `room_projections.projection` and `games.canonical_state` held a **JSON string, not JSON**, for the entire life of the schema. Drizzle's `jsonb()` stringifies, then Bun's driver JSON-encodes anything bound to a jsonb parameter, and the two cancel out on read — so every round-trip test passed while `jsonb_typeof` returned `'string'` and `jsonb_object_keys` errored 22023. **A round-trip assertion cannot see an encoding bug.** Only the database can. Fixed by `packages/db/src/json-column.ts` (`jsonbValue`, an identity `toDriver`) plus data-only migration `0004`.

---

## What the game actually is today

Verified by playing all four presets in a browser on 2026-07-27 and by querying the resulting rows.

- **Thirty commands.** 27 player commands in `PLAYER_COMMAND_TYPES` (`game.start`, `turn.roll`, `turn.adjust-roll`, `turn.action`, `turn.play-card`, `turn.spend-token`, `turn.activate-character`, `prompt.respond`, `reaction.play`, `reaction.pass`, `audit.pay-fine`, `promotion.attempt`, `promotion.decline`, `management.shuffle-deck`, `management.block-promotion`, `tile.claim`, `tile.upgrade`, `placement.place`, `project.start`, `project.contribute`, `project.sabotage`, `agreement.offer`, `agreement.respond`, `attack.target`, `ballot.cast`, `loan.take`, `loan.repay`) plus 3 server-injected (`window.expire`, `quarter.advance`, `turn.timeout`). All thirty have a transition in `apply-command.ts`.
- **242 card definitions across six decks** (`deck.work` 47, `deck.meeting` 48, `deck.event` 51, `deck.networking` 49, `deck.board-meeting` 23, `deck.annual-event` 24), 254 instances once `copies` expands. Cards use the v2 vocabulary for real: 272 `modifyResource`, 51 `modifyHeat`, 19 `transferResource`, 18 `applyStatus`, 17 `payResource`, 11 `incrementWorkCounter`, 10 `drawCards`, 9 `chooseOne`, 8 `grantImmunity`, plus `removeStatuses`, `rollCheck`, `opposedRoll`, `grantExtraRoll`, `skipTurns`, `auditConfinement`, `gainSalary`.
- **Four presets plus custom rulesets.** `mode.quick` (race), `mode.standard` (fixed-length, the default), `mode.marathon` (fixed-length, elimination), `mode.campaign` (objectives). `mode.custom` is a lobby-authored `ModeRules` object validated by contracts and stored on the room. No mechanic is gated on a `modeId` comparison; every one reads `ModeConfig.rules`.
- **Shared, contestable state**: tile ownership and upgrades, placements, projects (start/join/contribute/sabotage), upkeep, loans and interest, heat with a threshold, agreements, ballots, objectives, quarters with scheduled global events, elimination. All of it is in `GameState`, snapshotted, and round-trips through the repository.
- **`GameState.rules` is snapshotted at `game.start`** and no transition reads a per-mode value live from the content pack (spec §5.9). `packages/engine/tests/replay-guarantee.test.ts` plays a match to a scored ending, replays the identical commands against a *rescored, repriced, rehanded, de-clocked* pack, and asserts byte-identical state.
- **One command endpoint.** `POST /api/rooms/:roomId/commands` does auth, same-origin, actor entitlement, idempotency by `commandId` against `command_receipts`, the revision predicate, submit, rejection mapping and publish exactly once. The deprecated `/roll` and `/respond` aliases are **gone** — verified live, both return 404. `window.expire` is refused there with 403 `SERVER_INJECTED_COMMAND`, also verified live.
- **Per-socket projections.** Each connected socket gets `projectPlayerView(state, thatViewersPlayerId)`; spectators and unseated members get the public view. Never one shared payload with private fields attached.
- **Chat** (`GET`/`POST /api/rooms/:roomId/messages`, plus emote reactions) is server-side only and never touches `GameState`. Quick-phrase mode verified end to end in the browser.
- **The game UI reaches all of it.** The panel shell exposes Roll, Adjust the roll (±`maxPipAdjust`, priced in energy), the four free actions plus Reveal, Claim, Place, Start/Contribute/Sabotage a project, Take a loan, Offer a deal, Go after someone, Spend a token, Use character ability, Pass a reaction, and quick-phrase chat.
- **Bots** fill seats, count toward the three-member minimum, and play whole matches. Difficulty is a per-seat setting.

### Older facts that are still true

- The engine's `turn.roll` transition still does roll → move → receptionist-pass salary → tile-effect resolution → promotion → win check; the v2 work extended that spine rather than replacing it.
- **In-command randomness uses an ephemeral source seeded from server-owned canonical state.** `createEphemeralRandom(state, purpose)` derives its seed from `state.gameId`, `state.revision`, `state.eventSequence` and the persisted stream fields, plus an `EphemeralRandomPurpose` domain separator. It is never written back, so the dice stream's cursor still advances exactly once per die roll, and every draw is replay-identical.
  - **This replaced a security bug — do not reintroduce it.** The seed used to be `createSeededRandomSource(command.commandId)`, and the command id is *client-supplied*: a client could enumerate candidate ids offline against a 32-bit PRNG and submit the one producing the outcome it wanted. Determinism was never the problem; client control over the seed was. Three rules, pinned by tests: (1) nothing client-supplied may appear in a seed; (2) exactly one source per purpose per command — a second source with the same purpose replays the first; (3) a new randomness-consuming resolution adds a new `EphemeralRandomPurpose` member rather than borrowing one.
- **`/rooms/$roomId/game` is a TanStack Router child of `/rooms/$roomId`.** The parent once rendered the lobby component directly instead of an `<Outlet />`, so the game view was unreachable regardless of URL. `rooms.$roomId.tsx` is now a pure layout (`component: Outlet` plus the shared auth `beforeLoad`), the lobby lives in `rooms.$roomId.index.tsx`. **Any dot-segment-nested child route needs its parent to render `<Outlet />`, or it is unreachable no matter what the URL is.** Check this on every new nested route.
- **No test count is quoted in this file, on purpose.** A count here once read as verification and was stale by a factor of several. Run `bun run test`. If a count needs to *gate* something, it belongs in the plan that gates on it.

---

## Known gaps / honest state (as of 2026-07-27)

Each of these was observed directly this round, not inferred.

### Gameplay defects

- **Decks are materialised but never deplete, so the clock-deck ending has no producer.** `create-game.ts` now builds real piles into `GameState.decks` (105 cards in a 3-player Quick match, 156 in Standard, 227 in Campaign), and `deck-depletion.ts` implements draw/discard/recycle/exhaustion. But `resolve-tile-effects.ts`'s `case "drawCards"` still picks `deck.cards[randomInt(...)]` from the **content pack**, so draws are with replacement and no card ever leaves a pile. Measured on the live database across all 19 stored games: **every discard pile is empty, in every match, in every preset**, including a Quick match at round 20 with real `CardDrawn` events in its log. Consequences: `MatchEndReason: "clock-deck-exhausted"` can never fire, `management.shuffle-deck` has nothing to shuffle, and the `copies` rarity curve is decorative. The fix is one call site.
- **A `promotion-block` reaction window is opened with `deadlineAt: null`, and it can freeze a match permanently.** `reaction-window.ts`'s generic opener correctly derives a deadline from `rules.interaction.reactionWindowSeconds`, but `promotion-choice.ts` opens the promotion-block window with no deadline, and the server's expiry scheduler deliberately skips a resolvable that has none. `apply-command.ts` documents this as a known gap. In practice: a bot attempts a promotion, a window opens on the human, and if the human never answers, **the match is dead** — the active seat is a bot whose only legal action is `agreement.offer`, the bot policy has no answer for that, and the drain reports `bot-cannot-decide` at ERROR level roughly every 4.5 seconds forever. Reproduced from scratch in Standard, Marathon and Campaign this round (Quick has roles off, so it is immune). Three abandoned rooms produced **226 error-level log lines in 25 minutes**. The all-eligible-passed path does drain the window correctly when a human is present — passing in the UI resumed a match that had been frozen for over an hour.
- **The reaction banner promises an auto-close that does not exist.** It reads "A promotion is on the table — this window closes on its own." It does not. Fix the deadline or fix the copy; shipping both is worse than either.
- **`PlayerPromoted` is attributed to the command's actor, not the promoted player**, and the client's `scope: "local"` notice policy trusts `actorPlayerId` to mean "who this happened to". Observed: passing a reaction window on a *bot's* promotion showed me a "Promotion committed — You met the next rank's cost" overlay while my own rank was unchanged. The event summary carries no promoted-player field, so the UI cannot currently tell.
- **Objectives are never created.** `mode.campaign`'s `winShape` is `"objectives"`, the lobby card says "resolves on objectives" and shows a SECRET OBJECTIVES chip, and `execution/objectives.ts` implements `assignObjectives`/`advanceObjectives`/`objectivePointsFor` with a full unit suite. Nothing calls them outside that suite. `GameState.objectives` is `[]` in **all 19 stored games**, including every campaign match. This is the decks bug again, one layer over: a mechanic built and tested but never wired to a producer.
- **Ballots are never opened.** `ballot.cast` is a real command with a real transition, `votesEnabled`/`auctionsEnabled` are on in three presets, and no authored card carries an `openBallot` effect. `GameState.ballots` is `[]` in all 19 stored games.
- **`rules.timers.turnSeconds` is authored, displayed, and ignored.** The presets declare 20/25/30/45 seconds and the lobby prints "20s per turn" on the card the host picks. The runtime turn timeout is `TURN_TIMEOUT_MS`, a process-wide constant resolved once from `TURN_TIMEOUT_SECONDS`, defaulting to 60s — the HUD correctly renders 60s in a room whose ruleset says 20. This violates spec §4's binding rule that no mechanic may be gated on a hardcoded constant.
- **`bot-cannot-decide` is logged at ERROR on a repeating timer.** Whatever the underlying cause, an unbounded error-log loop per stalled room drowns real failures. The condition is worth reporting once per revision, not once per drain cycle.

### Persistence

- **The jsonb columns hold real JSON as of migration `0004`.** All seven jsonb columns were double-encoded; `0004_jsonb_object_encoding.sql` is a data-only, idempotent, value-preserving repair and has been applied to the live database. Verified 2026-07-27: `room_projections.projection` 22 rows `'object'` / 0 `'string'`, `games.canonical_state` 16/0, `command_receipts.response_payload` 7/0, and `jsonb_object_keys` returns real keys where it used to raise 22023. Game state is now queryable in SQL (`projection #>> '{game,turn,activePlayerId}'` and friends), which is how several findings in this section were measured.
  - `decodeJsonbColumn` still tolerantly parses a JSON string on read so a database the migration has not reached does not lose a match. That shim has an intended end date and nothing enforces it.
- **Only 2 of the schema's 8 tables carry the room.** `rooms` (code-uniqueness index + coarse `lifecycle`) and `room_projections` (the entire `StoredRoom`, including the full canonical `GameState`, as one jsonb snapshot). `command_receipts` is now used for idempotency. `game_events`, `player_projections` and `game_outbox` are provisioned and empty — a real event-sourced read model is still a follow-up.
  - Materialising decks grew the snapshot roughly 3×, and the repository rewrites the whole blob per command. That cost is now on the write path of every roll.
- **A pre-existing stored ruleset is rejected on read.** One room logs `room.snapshot-custom-rules-rejected` because `ModeRules` gained required fields (`agency.handLimit`, `endgame`, `economy.promotionCostByRankIndex`); it silently falls back to its mode preset. 8 stored matches carry a `rules` block written before those fields existed — scoring and promotion pricing are unaffected (their fallbacks reproduce the shipped numbers), but those matches resolve `handLimit` to 0 and have the clock-deck ending switched off. Needs a field-level backfill in the snapshot normaliser.
- **RLS is disabled on all public tables.** Expected for the current access pattern (server-only `DATABASE_URL`, no client-side Supabase SDK) but still an undecided question, and it must be decided before any browser ever talks to Supabase directly. Enabling RLS with no policies would lock the server out too.

### Test-suite health

- `bun run test` is green except for one load-flaky file. `apps/server/tests/rooms/driver-interleaving.test.ts` and `bot-driver.test.ts` play whole matches against remote Postgres inside vitest's 5s default per-test budget; they pass in isolation (the interleaving file takes ~33s for 9 tests) and intermittently time out under full-workspace parallelism. The budget, not the code, is what is wrong.

---

## Next steps

**Gameplay next-steps live in [`plans/24-gameplay-v2-spec.md`](plans/24-gameplay-v2-spec.md) §9.** The defects above are the honest backlog, roughly in order of how much they cost a player:

1. Point `drawCards` at `state.decks` so decks deplete and the clock-deck ending has a producer.
2. Give the promotion-block window a deadline (or make the expiry scheduler synthesise one from `reactionWindowSeconds`), so an absent human cannot freeze a match. Stop the ERROR log loop while you are there.
3. Wire `assignObjectives` at `game.start` and `advanceObjectives` per round, so `mode.campaign` resolves on the thing it says it resolves on.
4. Make the turn timer read `rules.timers.turnSeconds`, with the env var as an override rather than the source.
5. Correct the reaction banner copy, and give `PlayerPromoted` a promoted-player field so the client can attribute it.
6. Field-level backfill for pre-v2 `rules` blocks in the snapshot normaliser.
7. Decide the RLS question deliberately.
8. Raise the per-test timeout on the DB-driving server suites, or move them off the default budget.
9. When adding any new nested route in `apps/web/src/routes/`, check whether the parent needs an `<Outlet />`.
