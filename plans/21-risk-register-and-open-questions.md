# Risk Register And Open Questions

Status: Active
Owner: Project owner
Updated: 2026-07-18

## Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RISK-001 | Implementation begins against conflicting 28/44-space rules | High | Critical | Approve canonical rules baseline before engine content |
| RISK-002 | Full 247-card scope delays first playable build | High | High | Deliver minimal vertical slice before full content normalization |
| RISK-003 | Better Auth users cannot securely authorize Supabase Realtime | High | Critical | Implement short-lived JWT bridge and private-channel RLS first |
| RISK-004 | Auth schema/migration drift damages production data | Medium | Critical | Reconcile live schema, journal, anonymous column, and migration baseline |
| RISK-005 | Client leaks hidden roles, hands, deck order, or Shuffle actor | Medium | Critical | Separate projections, allowlist serialization, leakage tests |
| RISK-006 | Nested effects/reactions create stuck or infinite resolution | Medium | Critical | Persist resolution stack, guards, invariants, replay fixtures |
| RISK-007 | Serverless timers fail to advance idle games reliably | Medium | High | Durable timer table, idempotent worker, lazy expiry checks |
| RISK-008 | Realtime delivery loss causes client divergence | Medium | High | DB authority, revisions, outbox, snapshot gap recovery |
| RISK-009 | Card free-text mapping encodes incorrect mechanics | High | High | Reviewed semantic mapping, source provenance, effect previews |
| RISK-010 | Art is commissioned before IDs/counts/rules stabilize | Medium | High | Pilot templates/motifs only; gate final production on canonical content |
| RISK-011 | Dark board/card style harms readability and print output | Medium | Medium | Contrast tests, physical swatches, low-ink/high-contrast variants |
| RISK-012 | Mobile requirements are treated as late polish | Medium | High | Include mobile shell/input/reconnect in alpha acceptance |
| RISK-013 | Long sessions leak memory or accumulate subscriptions/audio | Medium | High | Bounded stores, cleanup contracts, two-hour soak tests |
| RISK-014 | Active matches break during deploy/content update | Medium | Critical | Pin versions, support N/N-1 protocol, immutable content packs |
| RISK-015 | Manual admin repair corrupts replay/history | Medium | Critical | Typed repair commands only, dry-run, audit, fork instead of rewrite |
| RISK-016 | Analytics or logs collect hidden/personal data | Medium | High | Data allowlists, pseudonyms, redaction, separate systems |
| RISK-017 | Public rooms/chat create unsupported moderation load | Medium | High | Keep private-room/no-chat MVP; gate expansion on trust/safety readiness |
| RISK-018 | Physical edition diverges from digital rules/content | Medium | High | Generate both from canonical release and validate manifests |
| RISK-019 | Licensing/provenance blocks shipping art/audio/fonts | Medium | High | Asset ledger and legal approval before release build |
| RISK-020 | No reliable local DB connectivity in current sandbox | High | Medium | Keep pure tests local; run DB integration in CI/normal machine; use management API for migrations |

## Release-Blocking Open Questions

| ID | Question | Owner | Needed before |
|---|---|---|---|
| Q-001 | Is the public name Office Ladder or Deadline Dash? | Product | Final branding/assets |
| Q-002 | Confirm 44-space v3.2 as canonical and mark 28-space rules historical? | Game design | Engine/content implementation |
| Q-003 | Exact Quick Meeting/Event counts? | Game design | Deck setup and simulations |
| Q-004 | Exact Marathon counts and whether it ships initially? | Product/game design | Mode configuration |
| Q-005 | Support 2-player mode or hide it? | Game design | Lobby constraints |
| Q-006 | Final reaction priority, limits, and prevention timing? | Game design | Effect/resolution engine |
| Q-007 | Skip-turn stacking behavior for Burnout Status/Tile/cards? | Game design | Status model |
| Q-008 | Does Senior Manager double only positive Annual Event rewards? | Game design | Rank benefits |
| Q-009 | How does ignore-negative handle multi-effect/global cards? | Game design | Prevention semantics |
| Q-010 | Are characters publicly visible during play? | Product/game design | Projection/UI policy |
| Q-011 | Are token inventories public? | Product/game design | Projection/UI policy |
| Q-012 | Do completed replays reveal all hidden identities and hands? | Product/privacy | Replay policy |
| Q-013 | Is fictional `$` game money or USD presentation? | Product/localization | Formatting/print |
| Q-014 | Is guest play required to create rooms, join only, or both? | Product | Auth/room UX |
| Q-015 | Which staff roles and people approve production rules/content/releases? | Project owner | Governance/admin |

## Implementation Questions

| ID | Question | Recommended direction |
|---|---|---|
| Q-101 | ~~Server Actions or Route Handlers for gameplay commands?~~ Resolved by the Hono pivot: all gameplay commands go through Hono route handlers (explicit API, retryable, no Server Action equivalent in this stack). |
| Q-102 | Event sourcing depth? | Append all authoritative events plus current snapshot; do not rebuild every command from full history |
| Q-103 | Runtime content format? | Compiled immutable JSON/TS bundle with schema/hash and server/public variants |
| Q-104 | Runtime schema library? | Add Zod or equivalent for content and transport boundaries |
| Q-105 | Realtime outbox publisher? | DB trigger to `realtime.send()` plus repair job, or durable bounded dispatcher |
| Q-106 | Timer worker host? | Supabase Cron/internal protected endpoint initially; dedicated worker if lag requires it |
| Q-107 | Client state library? | Start with reducer + `useSyncExternalStore`; add library only for concrete pressure |
| Q-108 | Asset CDN? | Application static assets initially; Supabase Storage only for uploads |
| Q-109 | Card artwork granularity? | 48 reusable motifs plus templates, not 247 unique full images |
| Q-110 | Bot replacement in alpha? | Timeout policy first; replacement bot later behind flag |

## Rules/Data Inconsistencies To Resolve

- Clock Deck 50/100 versus 30/60.
- Setup/Shuffle references five decks despite six decks.
- Character/Management card dealing contradiction.
- Social Butterfly stale CEO Office teleport reference versus position-swap ability.
- Buy Coffee energy amount mismatch.
- Training lower range mismatch.
- Token cap table versus mode-level cap table.
- GDD category totals do not match deck totals.
- Work draw omitted from some tile rows despite general rule.
- GDD v3.2 header versus v3.1 locked footer.
- Undefined hand overflow and several reaction tags.

## Operational Decisions Needed Before Beta

- Data retention values and replay availability.
- Outage duration before system pauses matches instead of strict timeout catch-up.
- Who may pause/resume/terminate/fork.
- Support/moderation response ownership.
- Production regions and vendors.
- Privacy jurisdictions/minimum age.
- Backup/PITR budget and targets.
- Launch load target and spend budget.

## Review Process

- Review this file whenever a plan moves to implementation.
- Move resolved questions into a rules decision or ADR and link it.
- Convert realized risks into issues/blockers in the owning plan.
- Every open critical risk/question has one named owner before external beta.
