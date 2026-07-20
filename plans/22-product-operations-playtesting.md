# Product Operations And Playtesting

Status: Proposed
Owner: Product and game design
Updated: 2026-07-18

## Launch Scope Recommendation

- Quick mode.
- Private rooms.
- 3-6 players.
- Guest-friendly join.
- No public matchmaking or chat.
- One canonical rules/content release.

## Onboarding

### Entry

- Join from room link/code with minimal friction.
- Ask guests only for display name and required acknowledgements.
- Explain account creation after play as a way to preserve history/preferences.
- Host checklist: invite, choose mode, start when ready.
- Disclose expected duration and player-count suitability.

### First Match

- Progressive contextual teaching instead of one long rules modal.
- Private role explanation before start.
- First-turn phase guidance.
- Highlight only legal actions.
- Explain a tile/card when first encountered.
- Preview consequences for token spend, promotion, Block, and reveal.
- “Why did this happen?” details for resource/status changes.
- Tutorial progress keyed to rules version.

### Group Primer

Provide a 60-90 second lobby primer covering objective, Clock Deck, hidden Management, turn structure, and victory paths.

## Rules Reference

Versioned rules center containing:

- Quick start.
- Turn sequence.
- Win conditions and mode differences.
- Board/tile reference.
- Card types and reactions.
- Promotions and benefits.
- Characters and Management.
- Audit/Burnout distinction.
- Tokens.
- Timeout/reconnect/AFK/surrender rules.
- Searchable glossary.
- Rules/content version and changelog.

Matches link to the exact rules version they use.

## Playtest Instrumentation

Each facilitated session records:

- Cohort/hypothesis.
- Rules/content/build versions.
- Player count and experience level.
- Deterministic match trace.
- Observer notes correlated to match time.
- Post-match clarity, pace, fairness, agency, social fun, rematch intent, and confusion.

Do not record voice/video without explicit consent.

## Proposed Playtest Gates

- 80% of groups start without facilitator help.
- 80% of players can explain both win paths after one match.
- Quick median duration fits target range.
- Most turns finish without timeout.
- No obvious dominant character/identity/seat configuration.
- Players can name a decision that materially affected the result.
- Strong rematch intent.

Adjust thresholds after early sessions, but keep decision rationale.

## Balance Process

- Segment metrics by player count, mode, identity, character, seat, and version.
- Combine quantitative data with observed player behavior.
- Change one major dimension at a time where practical.
- Simulate economy/decks before human validation.
- Publish exact player-facing balance notes.
- Retain previous content releases for replay/debugging.

## Room And AFK Policy

Room states:

- Open.
- Ready check.
- Starting.
- Active.
- Paused when supported.
- Completed.
- Abandoned/cancelled/expired.

AFK baseline:

- First missed decision uses deterministic timeout action.
- Repeated misses mark AFK.
- Disconnect retains seat for grace period.
- Bot replacement only after policy is implemented and disclosed.
- If reduced player count invalidates hidden-role balance, end as abandoned/no-contest.
- Abandoned matches are excluded from normal win-rate metrics.

## Support

Player-facing:

- In-game rules/help.
- Report a problem with match ID.
- Copyable sanitized diagnostics.
- Status/known-issues page.
- Account deletion/privacy request path.

Internal:

- Issue taxonomy and severity.
- Escalation owner.
- Incident template containing versions and match IDs.
- Weekly top-contact review.
- Feed recurring confusion back into product/rules.

## Feature Flags

Operational flags for:

- Room creation.
- Modes/player counts.
- Cards/characters.
- Management system.
- Tutorials/timers/reconnect.
- Bots, spectators, public rooms, and chat.

Gameplay flags are pinned when a match starts. Every temporary flag has owner and expiry.

## Changelog

Maintain:

- Internal deployment log.
- Player-facing product/balance changelog.
- Canonical rules-version history.

Player-facing notes state what changed, why, affected matches, version, effective date, and limitations.

## Community Feedback

Start with structured channels:

- Post-match rating/reason.
- Match-linked beta form.
- Facilitated sessions.
- Small invite-only community only with moderation coverage.
- Known-issues board for public defects.

Tag feedback by version, player count, experience, and match completion. Separate bugs, comprehension, balance, feature requests, and abuse concerns.

## Legal And IP Operations

Before public launch:

- Privacy policy and terms.
- Community/acceptable-use rules.
- Trademark clearance for product name.
- Asset/font/audio/card-copy provenance.
- No marketing using another board game's trademark/trade dress.
- Review satire for real names/logos/likeness/confidential anecdotes.
- Contributor agreements for external/community content.

## Roadmap After Core Launch

Prioritize from observed drop-off:

1. Rematch and persistent group flow.
2. Mobile improvements.
3. Guest-to-account linking.
4. Match history/stats.
5. New cards/content.
6. Accessibility improvements.
7. Marathon.
8. Bots, spectator, replay.
9. Public matchmaking/chat only after moderation readiness.

## Acceptance Criteria

- Tutorial and rules derive from canonical versioned content.
- Playtests produce deterministic traces and structured feedback.
- Balance changes are versioned, reviewed, and communicated.
- Room abandonment and support policies are documented before beta.
- Public launch has named support, moderation, privacy, and release owners.
