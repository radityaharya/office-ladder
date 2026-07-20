# Office Ladder Planning Portfolio

Status: Draft planning baseline
Updated: 2026-07-18

This folder is the implementation planning source for the Office Ladder application and the Deadline Dash v3.2 game design. Each document owns one concern so architecture, production, and operational decisions do not become mixed into one large plan.

## Planning Principles

- Postgres is the durable game authority.
- Clients submit intent; the server commits outcomes.
- Supabase Realtime distributes committed updates but does not own game state.
- The game engine is deterministic, framework-independent, and driven by versioned content.
- Public, player-private, and server-private information are separate projections.
- Artwork and localized text are presentation data, not executable game rules.
- Active matches pin their engine, rules, content, and asset versions.
- Accessibility, mobile participation, reconnects, and failure recovery are foundational requirements.
- The physical edition is a downstream consumer of the same canonical content, not a separate rules source.

## Documents

| File | Concern |
|---|---|
| `00-governance-and-source-of-truth.md` | Decision ownership, document authority, ADRs, plan maintenance |
| `01-product-scope-and-rules-decisions.md` | Canonical product scope and unresolved rules |
| `02-repository-architecture.md` | Module boundaries, directory structure, imports, generated files |
| `03-game-engine.md` | Commands, events, resolution stack, effects, RNG, replay |
| `04-content-pipeline.md` | XLSX/GDD extraction, canonical IDs, validation, releases |
| `05-asset-management.md` | Brand, board, tile, pawn, portrait, background, and shared assets |
| `06-card-image-management.md` | Card templates, motifs, backs, rendering, localization, print exports |
| `07-frontend-gameplay-ux.md` | Lobby, game shell, board, hand, prompts, reconnect, responsive UI |
| `08-accessibility-localization.md` | WCAG, keyboard, screen readers, EN/ID, RTL preparedness |
| `09-audio-motion.md` | Audio buses, music, SFX, haptics, animation sequencing |
| `10-backend-persistence-realtime.md` | Rooms, database, command transactions, snapshots, timers, Realtime |
| `11-security-privacy-abuse.md` | Auth integration, authorization, anti-cheat, room safety, moderation |
| `12-data-lifecycle.md` | Classification, retention, deletion, export, backups, uploads |
| `13-testing-quality.md` | Unit, property, integration, E2E, visual, load, chaos, CI gates |
| `14-bots-simulation-balance.md` | Legal-action APIs, bots, simulations, balancing, soak testing |
| `15-analytics-observability.md` | Product analytics, gameplay metrics, traces, logs, alerts |
| `16-performance-deployment-operations.md` | Budgets, caching, CI/CD, environments, rollback, disaster recovery |
| `17-admin-support-moderation.md` | Inspector, replay viewer, repairs, flags, support, staff RBAC |
| `18-browser-device-compatibility.md` | Browser matrix, input capabilities, suspension, PWA boundaries |
| `19-physical-edition-print.md` | Board/cards print pipeline, BOM, preflight, proofs, manufacturing |
| `20-implementation-roadmap.md` | Phases, dependencies, milestones, release gates |
| `21-risk-register-and-open-questions.md` | Current blockers, risks, and decisions requiring approval |
| `22-product-operations-playtesting.md` | Onboarding, rules reference, playtests, support, community, legal operations |
| `23-failure-recovery-runbooks.md` | Failure matrix, recovery policies, pause/terminate/fork, runbook requirements |

## Authority Order

Until the governance plan is implemented, use this temporary order:

1. Explicit approved decisions in `plans/01-product-scope-and-rules-decisions.md`.
2. `docs/DEADLINE_DASH_FULL_GDD.md` for intended v3.2 mechanics.
3. `docs/Office_Board_Game_Design_Workbook.xlsx` for concrete card and board inventory.
4. `DESIGN.md` for the digital visual system.
5. Root `PLAN.md` for existing technical stack decisions.
6. `docs/GAME_DESIGN.md` as historical reference only when it conflicts with v3.2.

## Maintenance

- Update affected plan files in the same change as a material architectural or product decision.
- Do not silently rewrite accepted decisions. Record a superseding decision and migration impact.
- Keep root `PLAN.md` concise and link to this folder rather than duplicating detailed plans.
- Mark implementation work complete only after its verification and documentation gates pass.
