# Product Scope And Rules Decisions

Status: Proposed baseline
Owner: Product and game design owner
Updated: 2026-07-18

## Product Identity

Temporary convention until branding is approved:

- Application/repository name: **Office Ladder**
- Game rules/content family: **Deadline Dash**
- Internal engine namespace: `game`
- Initial rules identifier: `deadline-dash-v3.2-normalized.1`

Run trademark, domain, and licensing checks before commissioning final brand assets.

## Canonical Gameplay Direction

Use the 44-space, six-deck, nine-rank Deadline Dash design as the intended implementation target. Treat the 28-space `docs/GAME_DESIGN.md` rules as historical when they conflict.

Concrete inventory:

- 44 board spaces: 4 corners and 40 regular tiles.
- 9 ranks: Intern through Director.
- 6 characters.
- Worker/Management hidden identity assigned separately from character.
- 6 decks and 247 gameplay card instances.
- Quick and Marathon modes represented as separate mode policies.

## Recommended First Release Scope

### Must

- Private room creation and joining.
- 3-6 players.
- Guest-friendly identity plus registered accounts.
- Quick mode.
- Full 44-space board.
- Server-authoritative turns, dice, decks, cards, promotion, and wins.
- Worker and Management identities.
- Six characters.
- Reconnect, timeout, and state recovery.
- English and Indonesian content architecture.
- Keyboard and mobile-capable gameplay.

### Should

- All 247 cards after semantic review.
- Basic sound effects and motion.
- Rules reference and contextual tutorial.
- Match event journal and internal replay verification.

### Could

- Marathon mode behind a feature flag.
- Basic deterministic bots for disconnected players.
- Player-facing match replay.

### Later

- Public matchmaking.
- Chat.
- Spectator mode.
- Leaderboards and daily challenges.
- User-uploaded avatars.
- Advanced AI opponents.

## Proposed Rule Decisions

These defaults should become accepted rules records before engine implementation.

### Dice

- Normal movement uses `1d6`.
- Training, HR, Sales, Audit escape, Office Bet, and any explicitly defined check use `2d6`.
- Lucky Employee reroll applies only to operations whose definition explicitly permits it.
- Audit true doubles means both dice show the same value.

### Training

- `2-6`: gain 1 Reputation.
- `7-12`: gain 2 Reputation.

### Identity Assignment

- Every player receives one character.
- Worker/Management identity is assigned independently.
- Management players do not know other Management players.
- Character visibility is controlled by a presentation policy and does not change faction secrecy.

### Board Movement

- Normal forward movement can pass Receptionist and award salary.
- Stopping exactly on Receptionist awards salary and a free roll.
- Teleports and position swaps do not award salary or count as laps unless the effect explicitly says they use normal traversal.
- Backward movement does not award salary.
- Extra movement appended to a normal roll uses normal traversal.

### Resources

- Money, Reputation, and Energy clamp at zero by default.
- Energy clamps at current maximum.
- A player cannot pay a mandatory optional cost they cannot afford.
- Transfers take up to the available amount unless a card explicitly requires all-or-nothing payment.
- Reputation is a requirement and is not spent on promotion.

### Work And Burnout

- Every Work landing costs 1 Energy and draws one Work card.
- Work Counter is cumulative and grants Reputation at 5, 10, 15, and later multiples of 5.
- Energy reaching zero schedules Burnout Status for the player's next turn.
- Burnout Status skips one turn and refills Energy to full.
- Burnout Tile skips two turns and is tracked separately.
- Skip effects require an explicit stacking policy in the canonical rules.

### Decks

- Meeting and Event remain separate physical decks.
- Their combined remaining draw piles form the Clock Deck total.
- Meeting and Event do not reshuffle when empty.
- Work, Networking, Board Meeting, and Annual Event reshuffle discard piles when empty.
- Management Shuffle can target any deck marked `managementShuffleEligible` in config.
- The top three Meeting cards are public.
- All deck remaining counts are public.

### Clock Deck

Mode configuration must specify exact Meeting and Event quantities. Do not infer these from contradictory prose.

Proposed alpha defaults:

- Quick: 15 Meeting and 15 Event cards, 30 total.
- Marathon: 30 Meeting and 30 Event cards, 60 total.

These are provisional and require playtesting approval.

### Hand Overflow

When a stored card is drawn with a full hand:

1. Open a private prompt.
2. Player chooses one card to discard, including the newly drawn card.
3. Timeout discards the newly drawn card.

### Reactions

Split reactions into:

- Prevention windows before a pending negative effect commits.
- End-turn reactions that intentionally occur after normal resolution.

Proposed baseline:

- One reaction card per affected player per root effect.
- No reactions to reactions.
- Character prevention uses the same window but is not automatically a card play.
- Promotion Block uses a dedicated private response window.
- Passing must not reveal whether a player held an eligible card.

### Promotion Block

- Eligible hidden Management players receive a private block prompt.
- First accepted valid block wins under server ordering.
- Other attempts become stale and reveal nothing.
- The blocker is revealed publicly.
- Promotion cost is deducted only after the block window closes without a block.

### Win Precedence

For one root action:

1. Resolve the current effect and mandatory nested effects.
2. Resolve an eligible promotion and its block window.
3. Check Director outcome.
4. If no Director outcome applies, check Clock Deck exhaustion.

Quick mode ends immediately on Director or Management Clock Deck victory.

Marathon mode proposal:

- First Director starts a three-round endgame instead of ending immediately.
- Clock Deck exhaustion can still end the match during those rounds unless playtesting decides otherwise.
- Final winner uses the documented scoring formula after the additional rounds.

### Timeouts

Each prompt defines a deterministic default. General defaults:

- Decline optional cards and abilities.
- Spend no optional tokens.
- Roll when rolling is mandatory.
- Audit chooses roll, not payment.
- Promotion Block passes.
- Hand overflow discards the newly drawn card.
- Required target selection uses a content-defined deterministic target rule.

## Release-Blocking Questions

- Final public product name.
- Exact Clock Deck quantities per mode.
- Whether two-player mode is supported or hidden.
- Whether Marathon ships in the first release.
- Exact reaction priority and timing details.
- Skip-turn stacking policy.
- Senior Manager behavior for negative Annual Event effects.
- Exact treatment of multi-part negative effects under prevention.
- Player visibility of token inventories and character identities.
- Whether completed replays reveal all hidden identities.

## Acceptance Criteria

- Every engine-affecting ambiguity is resolved in a rules decision.
- The canonical rules can be expressed without consulting historical documents.
- Quick mode has exact board, deck, timer, promotion, token, and win configuration.
- Every timeout path has a deterministic response.
- Every player-visible rule has matching EN and ID terminology.
- Examples cover simultaneous wins, nested draws, reactions, Audit, Burnout, salary, and promotion blocking.
