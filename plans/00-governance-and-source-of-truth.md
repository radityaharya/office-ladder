# Governance And Source Of Truth

Status: Proposed
Owner: Project owner
Updated: 2026-07-18

## Outcome

Establish one maintainable decision system for product scope, gameplay rules, architecture, execution plans, risks, and released behavior.

## Current Problem

The repository contains overlapping authorities:

- `docs/GAME_DESIGN.md` describes the older 28-space Office Ladder game.
- `docs/DEADLINE_DASH_FULL_GDD.md` describes the larger 44-space Deadline Dash v3.2 game.
- The workbook contains the concrete 247-card inventory.
- Root `PLAN.md` contains valid technical decisions but stale gameplay scope.
- `PRODUCT.md`, `DESIGN.md`, and current application copy use Office Ladder naming.

Implementation must not blend these sources implicitly.

## Document Authority

| Subject | Canonical location |
|---|---|
| Product purpose and audience | `PRODUCT.md` |
| Digital visual system | `DESIGN.md` |
| Gameplay rules | A reconciled canonical rules document plus rules decisions |
| Concrete game content | Versioned canonical content generated from reviewed source data |
| Architecture decisions | `plans/` initially, later `docs/decisions/adr/` |
| Gameplay rulings | `plans/01-product-scope-and-rules-decisions.md`, later `docs/decisions/rules/` |
| Active portfolio status | Root `PLAN.md` |
| Detailed implementation plans | `plans/` |
| Released behavior | Code, migrations, tests, and release manifest |
| Historical material | Explicitly marked historical documents |

Lower-level documents may reference higher-level authorities but must not redefine them.

## Decision Records

Create two permanent series before implementation broadens:

```text
docs/decisions/adr/ADR-NNNN-title.md
docs/decisions/rules/RULE-NNNN-title.md
```

### ADR Statuses

- `proposed`
- `accepted`
- `rejected`
- `superseded`
- `deprecated`

### Rules Decision Statuses

- `proposed`
- `playtest`
- `accepted`
- `rejected`
- `superseded`

Accepted records are not rewritten to change their meaning. A replacement record must identify what it supersedes.

## Required Initial Decisions

Backfill ADRs for:

- Single Hono + TanStack Router application rather than a monorepo.
- Better Auth as identity authority.
- Drizzle and Postgres persistence.
- Supabase Realtime as delivery, not authority.
- Server-authoritative commands.
- Event journal plus snapshots.
- Versioned content packs.

Backfill rules decisions for:

- Product name and ruleset identity.
- 44-space board.
- Movement and check dice.
- Clock Deck composition.
- Quick and Marathon endgame behavior.
- Hidden identity assignment.
- Reaction timing.
- Resource floors and payment behavior.

## Plan Metadata

Every active plan should eventually contain:

```yaml
id: PLAN-NNNN
title: Example plan
owner: named-owner
status: proposed
health: not-assessed
created: 2026-07-18
updated: 2026-07-18
target_release: alpha
depends_on: []
blocked_by: []
related_adrs: []
related_rules: []
```

Plan statuses:

- `draft`
- `proposed`
- `approved`
- `in-progress`
- `blocked`
- `verification`
- `done`
- `cancelled`
- `superseded`

## Scope Control

Each release uses these commitment levels:

- `must`: release cannot ship without it.
- `should`: expected but removable through approved scope change.
- `could`: opportunistic.
- `later`: explicitly excluded.

Recommended first playable release:

- Must: Quick mode, private rooms, 3-6 players, guest-friendly joining, deterministic core game loop, reconnect support.
- Should: EN and ID content, basic audio, complete card catalog.
- Could: Marathon mode behind a flag.
- Later: public matchmaking, chat, spectator mode, persistent rankings, advanced bots.

## Change Control

| Change | Required record |
|---|---|
| Editorial text or formatting | Direct edit |
| Plan sequencing within approved scope | Plan update |
| Release scope or acceptance criteria | Approved plan change |
| Gameplay behavior | Rules decision and rules-version impact |
| Architecture or trust boundary | ADR |
| Protocol, database, or saved-state compatibility | ADR plus migration plan |
| Release gate exception | Explicit release-owner approval |

## Synchronization Rules

- Root `PLAN.md` is a dashboard and links to detailed plans.
- Detailed scope and reasoning live in `plans/`, not duplicated in root `PLAN.md`.
- A plan status change and root dashboard update occur together.
- A canonical rules change updates decisions, content version, tests, and player rules together.
- A completed plan includes verification evidence.
- Generated documentation identifies its source and version.

## Release Governance

A release is `go` only when:

- All `must` scope is verified.
- No release-blocking rules question remains.
- Database migrations are reproducible.
- Server authority, private projections, reconnect, and timers are tested.
- Accessibility and supported-browser gates pass.
- Rollback and kill-switch paths exist.
- Monitoring and incident ownership are assigned.

Possible decisions:

- `go`
- `conditional-go` with explicit non-critical exceptions and expiry
- `no-go`

## Deliverables

1. Canonical rules baseline.
2. ADR and rules decision indexes.
3. Root `PLAN.md` converted into a concise portfolio dashboard.
4. Central risk and open-question register.
5. Release-readiness checklist per target release.

## Acceptance Criteria

- No two documents claim canonical authority for the same behavior.
- Every active plan has one owner, status, and dependency list.
- Every release-blocking question has an owner and resolution target.
- Architecture and rules changes leave a durable decision trail.
- Released behavior can be traced to plan, decision, implementation, and test evidence.
