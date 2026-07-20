# Game Engine

Status: Proposed
Owner: Gameplay engineering owner
Updated: 2026-07-18

## Outcome

Build a deterministic, resumable, server-authoritative engine that supports the full Deadline Dash rules, hidden information, nested effects, reactions, replays, simulations, and future content versions.

## Core API

```ts
createGame(setup, seed, ruleset): GameState

enumerateLegalActions(state, actorId): readonly LegalAction[]

applyCommand(
  state,
  command,
  context,
): TransitionResult

projectPlayerView(state, playerId): PlayerView

projectSpectatorView(state): SpectatorView
```

`context` injects:

- Logical time.
- Deterministic RNG.
- Command ID.
- Immutable rules/content pack.

## State Requirements

Canonical state must include:

- Schema, engine, rules, and content versions.
- Match revision and event sequence.
- Player order, turn number, round, phase, and deadlines.
- Public and private player state.
- Board positions and lap counters.
- Deck order, discard piles, visible cards, and hands.
- Statuses, cooldowns, skip turns, Audit, and Burnout.
- Resolution stack.
- Pending prompts and sealed responses.
- Reaction windows.
- RNG state/cursor.
- Outcome and Marathon endgame state.

State must be JSON-serializable. Avoid class instances, Maps, Sets, mutable references, and runtime functions.

## Commands

Commands express intent, not results.

Examples:

- `game.start`
- `turn.roll`
- `turn.play-card`
- `turn.activate-character`
- `turn.spend-token`
- `prompt.respond`
- `reaction.play`
- `reaction.pass`
- `audit.pay-fine`
- `promotion.attempt`
- `management.shuffle-deck`
- `management.block-promotion`
- `turn.timeout`

Do not accept client commands such as `player.moved`, `card.drawn`, or `game.won`.

Every command contains:

- `commandId`
- `gameId`
- `actorId`
- `expectedRevision`
- `decisionPointId` when responding to a prompt
- Typed payload

## Events

Events are immutable facts:

- `GameStarted`
- `TurnStarted`
- `DiceRolled`
- `PlayerMoved`
- `SalaryAwarded`
- `TileResolved`
- `CardDrawn`
- `CardStored`
- `CardPlayed`
- `EffectProposed`
- `EffectPrevented`
- `ResourceChanged`
- `StatusApplied`
- `PromptOpened`
- `ReactionWindowOpened`
- `PromotionAttempted`
- `PromotionBlocked`
- `ManagementRevealed`
- `PlayerPromoted`
- `ClockDeckExhausted`
- `MatchEnded`

Events include sequence, revision, command causation, logical timestamp, schema version, and visibility classification.

## Resolution Stack

The engine must persist a continuation stack rather than recursively resolving arbitrary card code.

Example frames:

```text
ResolveTurnStart
ResolveMovement
ResolveTile
DrawCard
ResolveCard
ApplyEffect
OpenPrompt
OpenReactionWindow
ResolvePromotion
CheckWinConditions
FinishTurn
```

Each frame records:

- Stable frame ID.
- Source card/tile/ability/status.
- Parent frame.
- Acting and affected players.
- Remaining operations.
- Captured values needed for resume.
- Visibility.

After a command, automatic processing drains until:

- A player decision is required.
- A reaction window is open.
- A durable deadline is scheduled.
- The turn completes.
- The match ends.
- A safety guard fails.

## Safety Guards

- Maximum resolution depth.
- Maximum frames processed by one command.
- Maximum chained draws.
- Cycle/source-chain diagnostics.
- No-progress detection.
- State invariants before commit.

Failure enters a recoverable engine-error/quarantine state rather than looping.

## Effect System

Use a finite discriminated effect language:

```text
modifyResource
setResource
transferResource
modifyToken
drawCards
storeCard
discardCard
applyStatus
removeStatus
cancelEffect
multiplyEffect
modifyRequirement
modifyMovement
movePlayer
skipTurns
rollCheck
choose
forEachTarget
attemptPromotion
gainSalary
custom
```

Effects define explicit:

- Target policy.
- Timing.
- Prevention eligibility.
- Stacking and expiry.
- Resource clamping.
- Insufficient-payment behavior.
- Traversal/salary behavior for movement.
- Mode compatibility.

## Custom Handlers

Use versioned custom handlers only for mechanics that do not fit cleanly into the effect vocabulary:

- Audit release loop.
- Management Shuffle secrecy.
- Promotion Block protocol.
- Position swap.
- Arbitrary teleport.
- Post-roll reroll.
- Office Bet dice duel.
- Marathon endgame scoring.

Custom handlers return effects, prompts, or events. They do not mutate state directly.

## Prompts

Prompts are persisted engine state:

```ts
type Prompt = {
  id: string;
  frameId: string;
  kind: string;
  audience: PlayerId[];
  legalResponses: PromptOption[];
  deadlineAt: string | null;
  defaultResponse: PromptResponse;
  visibility: "public" | "private" | "sealed";
};
```

The server computes legal responses. Clients submit only option IDs supplied by the current projection.

## Reactions

Use two mechanisms:

- Prevention/replacement window before a proposed effect commits.
- End-turn reaction window for cards explicitly designed for that timing.

Pending effects remain structured until prevention closes. Do not apply and later reverse resource changes.

## Randomness

- Never use `Math.random()`.
- Seed production games with cryptographically secure server randomness.
- Persist PRNG algorithm/version and current state.
- Use separate stable streams for setup, decks, dice, and policy simulation where practical.
- Rejected commands consume no game RNG.
- Random outcomes are recorded in events.
- A match can be replayed exactly from seed, content, commands, and events.

## Projections

Never serialize canonical state directly.

Public view may include:

- Board positions.
- Public resources, ranks, statuses, and deck counts.
- Current turn, phase, and deadline.
- Three visible Meeting cards.
- Revealed Management identities.
- Public event history.

Player-private view adds only:

- Own hidden identity and character.
- Own hand and private statuses.
- Own legal actions and prompts.

Server-only data includes deck order, all hidden identities, RNG state, and internal attribution for anonymous actions.

## Invariants

Validate after every accepted transition:

- One active turn in an active game.
- Positions are valid board indexes.
- Resources and tokens obey bounds.
- A card exists in exactly one legal zone.
- Clock decks never regain cards.
- Hidden roles are not accidentally revealed.
- Prompt and phase ownership are valid.
- Revision, sequence, and RNG cursor never regress.
- Terminal games accept no normal gameplay command.
- Snapshot serialization round-trips.

## Replay And Compatibility

Every match pins:

- `engineVersion`
- `rulesVersion`
- `contentReleaseId`
- `contentHash`
- `stateSchemaVersion`
- `replaySchemaVersion`

Replay records commands, resulting events, logical times, state hashes, and visibility envelopes.

Never automatically upgrade active matches to new gameplay semantics. Structural migrations are allowed only when behavior is unchanged and replay tests prove equivalence.

## Admin Repair

Do not support arbitrary state edits. Repairs are typed commands that append new events:

- Close stuck prompt using its default.
- Rebuild a derived snapshot.
- Recompute a deadline.
- Pause/resume.
- Terminate no-contest.
- Fork from a validated revision.

Information-revealing actions cannot be truly undone. Preserve history and record exposure.

## Delivery Sequence

1. IDs, state, versions, commands, events, and errors.
2. Deterministic RNG and setup.
3. Board movement, salary, resources, Work, Audit, Burnout.
4. Turn phases and prompts.
5. Effect interpreter and statuses.
6. Decks and simple cards.
7. Reactions and nested draws.
8. Promotions, characters, and Management abilities.
9. Win conditions and Marathon policy.
10. Projections, replay, invariants, and simulation hooks.

## Acceptance Criteria

- Same state, command, time, RNG, and content produce identical events and next state.
- Every legal action enumerated by the engine is accepted.
- Every game can pause and resume at any prompt or nested effect.
- Replaying events reconstructs the same state hash.
- Public and private projections pass leakage tests.
- Engine tests run without framework or infrastructure dependencies.
- Safety guards prevent infinite resolution.
