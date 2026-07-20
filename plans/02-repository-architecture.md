# Repository Architecture

Status: Proposed
Owner: Engineering owner
Updated: 2026-07-18

## Outcome

Keep one deployable (Hono API + Vite/TanStack Router SPA, no monorepo) while enforcing strong boundaries between deterministic game rules, authored content, server orchestration, persistence, Realtime transport, and UI.

## Target Structure

```text
src/
  api/                     Hono app: route mounting, middleware, entrypoint
  routes/                  TanStack Router route files and composition
  application/             Use-case orchestration
  engine/                  Pure deterministic game domain
  content/                 Human-authored canonical content
  generated/               Generated validated artifacts
  contracts/               Client/server transport contracts
  server/                  Server-only infrastructure adapters
  db/                      Drizzle schema, repositories, transactions
  realtime/                Browser Realtime adapter
  features/                Product-facing UI modules
  components/ui/           Generic UI primitives only
  assets/                  Bundled runtime assets
  styles/                  Design tokens and game styles
  lib/                     Small neutral utilities
  test/                    Shared test builders and fakes

content/                   Source snapshots and canonical data
assets-source/             Editable asset masters
asset-registry/            Asset metadata and provenance
scripts/                   Content, asset, DB, simulation, CI tools
tests/                     Unit, integration, contract, simulation, E2E
plans/                     Planning portfolio
drizzle/                   Database migrations
```

## Core Boundaries

### Engine

Owns:

- Game state, commands, events, effects, prompts, and resolution.
- Board movement, resources, decks, cards, promotions, roles, turns, and wins.
- Deterministic RNG and state invariants.
- Public/player-private projections.
- Replay and serialization contracts.

Must not import:

- React, Hono, or TanStack Router.
- Drizzle, Postgres, Supabase, or Better Auth.
- Environment variables.
- Browser APIs.
- `Math.random()`, wall-clock calls, or timers.
- UI copy or asset paths.

### Content

Owns:

- Board layout and tile definitions.
- Card, character, rank, deck, and mode definitions.
- Localization keys and presentation metadata.
- Effect declarations that use the engine's finite effect vocabulary.

The engine defines how an effect works. Content defines where and with what values it is used.

### Application

Owns authenticated use cases:

- Create/join/leave room.
- Ready/start game.
- Execute game command.
- Expire turn.
- Load authorized snapshot.
- Recover or inspect a match.

Application code coordinates repositories and the engine but does not contain game rules. Hono routes and TanStack Router loaders call into application use cases; neither owns orchestration logic itself.

### Server And DB

`src/server/` owns authentication, authorization, rate limits, logging, Realtime publishing, and server-only adapters.

`src/db/` owns schema, repositories, queries, locks, and transactions.

### Contracts

Transport contracts are browser-safe and versioned. They include command envelopes, projection DTOs, errors, and Realtime notifications. They must not expose raw DB rows or canonical game state.

### Features

Feature folders own UI and client behavior for lobby, game, rules, profile, and admin. Generic UI primitives must remain game-agnostic.

## Import Direction

```text
content -> generated content -> engine
contracts --------------------> engine public types
engine + repositories --------> application
application ------------------> Hono routes / TanStack Router loaders
contracts -> realtime client -> feature UI -> route components
```

Forbidden examples:

- Engine importing server or UI modules.
- Route/feature UI components importing `src/server`, `src/db`, or privileged Supabase clients.
- UI importing raw DB row types.
- Realtime handlers invoking engine mutation directly.
- Generic UI components importing game features.
- Cross-feature deep imports.

## Suggested Engine Layout

```text
src/engine/
  model/
  commands/
  events/
  effects/
  resolution/
  rules/
  random/
  projections/
  serialization/
  invariants/
  test-support/
  index.ts
```

## Suggested Server Layout

```text
src/server/
  auth/
  authorization/
  games/
  rooms/
  realtime/
  security/
  observability/
  env.ts
```

Every privileged module should use `import "server-only"`.

## Generated Files

Generated artifacts may include:

- Compiled content pack and hash.
- Card/tile lookup maps.
- Asset manifest and typed asset IDs.
- Protocol discriminated unions.
- Compatibility metadata.

Policy:

- Generated files are reproducible.
- Generated files carry a do-not-edit header.
- CI regenerates and requires a clean diff.
- Generated files cannot import application, server, or UI modules.

## Lint And Boundary Enforcement

Add rules for:

- Restricted imports by folder.
- No direct `process.env` outside server environment modules and scripts.
- No unhandled promises.
- Exhaustive command/event/effect switches.
- No `console.*` outside scripts and logger adapters.
- No engine use of random, time, timers, DOM, or storage APIs.
- No server imports from client graphs.
- No production imports from test helpers.

## Route Responsibilities

Both layers should remain thin:

- TanStack Router route `loader`s fetch authorized initial projections before render.
- Route components subscribe (Realtime), render, and submit commands.
- Hono route handlers authenticate and call application use cases; this is the trusted validation/authorization boundary (mirrors the old "Server Actions or Route Handlers" role one-for-one).
- The whole app runs as a single Node process — no edge/serverless runtime split to design around.

## Migration From Current Files

Move incrementally rather than performing a broad rename before features exist:

- Keep current auth files working while introducing server boundaries.
- Add new game schema files separately from `auth-schema.ts`.
- Introduce engine/content folders before UI gameplay work.
- Move existing components only when touched by a feature.
- Keep root aliases stable and add narrower aliases as boundaries mature.

## Acceptance Criteria

- Engine tests run without Hono, TanStack Router, database, or Supabase.
- Client bundles cannot import server secrets or DB modules.
- Content compiles independently from application routes.
- Game commands have one application entry point.
- Realtime is replaceable behind an adapter.
- Generated files are reproducible and checked in CI.
- Boundary violations fail lint or build checks.
