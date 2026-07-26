# 24 — Gameplay v2: canonical spec

Status: **authoritative build contract.** Every agent working on gameplay v2 implements
against the type signatures in this document. Where this file and an agent's judgement
disagree, this file wins; where this file is silent, the agent decides and records the
decision in its return value.

Supersedes the roll-and-move slice described in [`AGENTS.md`](../AGENTS.md) "Known gaps".
Rules decisions land in [`01-product-scope-and-rules-decisions.md`](01-product-scope-and-rules-decisions.md).

---

## 1. Why the current game is flat

Two structural causes, not a missing-feature list:

1. **Every resource is a private counter.** Money, reputation, energy, rank, position all
   live inside a `PlayerState`. Nothing exists in shared space, so there is nothing to
   contest, occupy, or destroy. Sabotage has no object; money has no rival use.
2. **The only verb is `roll`.** Movement is dice, tile outcome is authored by the tile,
   promotion is automatic, cards resolve on draw. No turn contains a decision. And for
   five turns out of six a player is a spectator by design.

Everything else on the feedback list — no economy, can't ruin each other, can't place
anything, not enough prompts — is a symptom of those two.

## 2. What already exists and was never wired

This is the important discovery, and it sets the build order. The engine's type model was
designed for a much richer game than the one implemented.

| Already modelled | Where | State |
| --- | --- | --- |
| `ReactionWindowState` (eligible/priority/passed/played/deadline/pendingEffect) | `model/game.ts` | never populated |
| `PendingEffectState.preventionEligible` | `model/game.ts` | never populated |
| `PlayerState.hand`, `CardState.zone:"hand"`, `CardState.faceUp` | `model/game.ts` | never used |
| `PromptState.audience` + `responses: Record<playerId, …>` | `model/game.ts` | single-audience only |
| `PromptState.visibility: "sealed"`, `defaultResponse`, `deadlineAt` | `model/game.ts` | unused |
| `RoleState.revealed`, `PublicRoleProjection` | `model/game.ts`, `projections/types.ts` | roles are cosmetic |
| `projectPlayerView` / `SelfProjection` (per-viewer redaction) | `projections/player.ts` | **already called by the server** |
| `MarathonEndgameState` + `endgame.scoring` (rank tiers, money ×0.1, reputation ×50) | `model/game.ts`, `content/…/modes.ts` | unimplemented |
| `TokenState` / `tokenCaps` / `startingTokens` (a whole token economy) | `model/game.ts`, `content/…/modes.ts` | unused |
| `AbilityState.usesRemaining` / `cooldownLapsRemaining` | `model/game.ts` | passives only |
| `FrameKind: "open-reaction-window"`, `"resolve-card"` | `model/game.ts` | never pushed |
| `ModeConfig.handLimit` / `turnTimerSeconds` / `deckQuantities` | `content/schema/modes.ts` | partly honoured |

**Ten of thirteen declared commands have no transition.** `apply-command.ts` handles only
`game.start`, `turn.roll`, `prompt.respond`. Unimplemented but already in the union:
`turn.play-card`, `turn.activate-character`, `turn.spend-token`, `reaction.play`,
`reaction.pass`, `audit.pay-fine`, `promotion.attempt`, `management.shuffle-deck`,
`management.block-promotion`, `turn.timeout`.

Consequence for planning: reaction windows, hidden hands, hidden roles, and fixed-length
scoring are **wiring**, not new architecture. Price them accordingly.

## 3. What is genuinely missing

No shared, mutable, contestable state of any kind. Specifically absent from `GameState`:

- per-tile mutable state (ownership, upgrades, placed objects)
- projects — public multi-turn commitments with a stake
- recurring economic obligation (upkeep) or any money sink beyond promotion
- debt, income streams
- an aggression cost (heat / HR suspicion)
- multi-party agreements (trades, contracts, recorded promises)
- objectives and non-promotion win paths
- quarters and scheduled global events
- ballots (votes, auction bids) as a first-class resolvable
- a wall-clock boundary the engine can react to without reading a clock

Chat, emote reactions and presence are deliberately **not** game state and must not enter
`GameState`. They live on the server plus DB plus WS.

---

## 4. The spine: a mode is a data-driven ruleset

"Implement all, configurable modes" resolves every either/or in the design. Race *vs*
fixed-length, solo *vs* social, short *vs* campaign stop being exclusive the moment a mode
is a config object rather than a branch in code.

**Binding rule for every agent: no mechanic may be gated on a hardcoded constant or on
`modeId` string comparison.** Every mechanic reads its own enablement and tunables from
`ModeConfig.rules`. A mechanic that cannot be switched off from config is a bug.

### 4.1 `ModeConfig.rules` — add to `packages/content/src/schema/modes.ts`

```ts
export type WinShape = "race" | "fixed-length" | "objectives" | "survival";
export type BankruptcyRule = "none" | "demote" | "eliminate";
export type LeaderProtection = "none" | "soft" | "hard";
export type TimeoutBehaviour = "auto-roll" | "auto-pass" | "best-move";
export type ChatMode = "off" | "quick" | "full";
export type BotPacing = "instant" | "paced";

export type ModeRules = {
  readonly winShape: WinShape;

  readonly quarters: {
    readonly enabled: boolean;
    readonly count: number;
    readonly roundsEach: number;
    readonly globalEvents: boolean;
  };

  /** Which win paths score. At least one must be true. */
  readonly winPaths: {
    readonly promotion: boolean;
    readonly wealth: boolean;
    readonly influence: boolean;
    readonly survival: boolean;
  };

  readonly economy: {
    readonly upkeepEnabled: boolean;
    /** Charge per round, indexed by rank index. Length must equal the rank ladder. */
    readonly upkeepByRankIndex: readonly number[];
    readonly loansEnabled: boolean;
    readonly maxLoanPrincipal: number;
    readonly interestBasisPoints: number;
    readonly bankruptcy: BankruptcyRule;
    readonly incomeStreamsEnabled: boolean;
  };

  readonly board: {
    readonly ownershipEnabled: boolean;
    readonly claimCostMultiplier: number;
    readonly tollMultiplier: number;
    readonly upgradesEnabled: boolean;
    readonly placementsEnabled: boolean;
    readonly maxPlacementsPerPlayer: number;
  };

  readonly projects: {
    readonly enabled: boolean;
    readonly maxConcurrentPerPlayer: number;
    readonly joinable: boolean;
    readonly sabotageable: boolean;
    readonly deadlineRounds: number;
  };

  readonly conflict: {
    readonly targetedAttacks: boolean;
    readonly heatEnabled: boolean;
    readonly heatPerAttack: number;
    readonly heatThreshold: number;
    readonly defenceEnabled: boolean;
    readonly leaderProtection: LeaderProtection;
    readonly elimination: boolean;
  };

  readonly agency: {
    readonly promotionIsChoice: boolean;
    readonly promotionRaisesUpkeep: boolean;
    readonly diceAdjustEnabled: boolean;
    readonly energyPerPip: number;
    readonly maxPipAdjust: number;
    readonly freeActionsPerTurn: number;
    readonly handEnabled: boolean;
  };

  readonly interaction: {
    readonly reactionWindows: boolean;
    readonly reactionWindowSeconds: number;
    readonly votesEnabled: boolean;
    readonly auctionsEnabled: boolean;
    readonly tradesEnabled: boolean;
    /** Unenforceable promises are recorded in the agreement log for social pressure. */
    readonly promisesRecorded: boolean;
  };

  readonly hidden: {
    readonly rolesEnabled: boolean;
    readonly roleWinConditions: boolean;
    readonly secretObjectives: boolean;
    readonly hiddenHands: boolean;
  };

  readonly social: {
    readonly chat: ChatMode;
    readonly emoteReactions: boolean;
    readonly directMessages: boolean;
  };

  readonly timers: {
    readonly turnSeconds: number;
    readonly onTimeout: TimeoutBehaviour;
    readonly chessClockSeconds: number | null;
  };

  readonly bots: {
    readonly pacing: BotPacing;
    readonly thinkMsRange: readonly [number, number];
    readonly canNegotiate: boolean;
  };
};
```

`ModeConfig` gains `readonly rules: ModeRules;`.

### 4.2 Shipped presets

`mode.quick` and `mode.marathon` **keep their ids** — they are referenced by
`RankCostByMode` and by persisted games. They each gain a `rules` block matching their
current behaviour plus the cheap wins. Two new presets are added:

| Mode | Win shape | Character |
| --- | --- | --- |
| `mode.quick` | race | 20–30 min. Hand + reactions + promotion-as-choice on; ownership, projects, loans, roles off. |
| `mode.standard` | fixed-length | **The default.** 4 quarters × 4 rounds. Everything on except elimination, DMs, role win conditions. |
| `mode.marathon` | fixed-length | 60–120 min, existing scoring, everything on. |
| `mode.campaign` | objectives | Longest. Secret objectives + role win conditions + hidden hands + auctions. |

`mode.custom` is **not** a content preset. It is a lobby-authored `ModeRules` object,
validated by contracts and stored on the room; see §8.4.

### 4.3 Rank costs

`RankCostByMode = Readonly<Record<ModeId, number>>` forces every rank to declare a cost per
mode. Adding two `ModeId`s means `packages/content/src/deadline-dash/ranks.ts` must gain
two entries per rank. Derive `mode.standard` from `mode.marathon` and `mode.campaign` from
`mode.marathon` × 1.25, then leave a `sourceNotes` entry saying they are unplaytested.

---

## 5. New engine state

All additions to `packages/engine/src/model/game.ts`. New branded ids go in
`packages/engine/src/model/ids.ts`: `PlacementId`, `ProjectId`, `AgreementId`,
`ObjectiveId`, `BallotId`, `IncomeStreamId`, `LoanId`.

**Invariants for every shape below**: `readonly` throughout, JSON-serialisable (no `Date`,
no `Map`, no `undefined` — use `null`), and reachable from `GameState` so it round-trips
through the repository's `JSON.parse(JSON.stringify(…))` boundary unchanged.

### 5.1 Shared board state

```ts
export interface TileOwnershipState {
  readonly tileId: TileId;
  readonly ownerId: PlayerId;
  readonly level: number;              // 0 = claimed, >0 = upgraded
  readonly claimedAtRound: number;
  readonly tollPaidCount: number;
}

export type PlacementKind =
  | "placement.meeting-invite"   // next lander loses their next turn
  | "placement.sabotage"         // next lander pays the owner
  | "placement.surveillance"     // owner learns the lander's hidden info
  | "placement.rumour"           // next lander loses reputation
  | "placement.favour";          // next lander gains; owner paid to place it

export interface PlacementState {
  readonly id: PlacementId;
  readonly kind: PlacementKind;
  readonly tileId: TileId;
  readonly ownerId: PlayerId;
  readonly charges: number;
  readonly visibility: "public" | "owner-only";
  readonly placedAtRound: number;
  readonly data: JsonObject;
}
```

### 5.2 Projects — the centrepiece

The single mechanic that answers four complaints at once: a money sink, something placed
in shared space, a reason to co-operate, and something worth ruining.

```ts
export type ProjectStatus = "open" | "funded" | "completed" | "failed";

export interface ProjectContribution {
  readonly playerId: PlayerId;
  readonly money: number;
  readonly work: number;
  readonly atRound: number;
}

export interface ProjectSabotage {
  readonly playerId: PlayerId;
  readonly amount: number;
  /** Hidden sabotage is revealed only on resolution — see §7.3. */
  readonly hidden: boolean;
  readonly atRound: number;
}

export interface ProjectPayout {
  readonly money: number;
  readonly reputation: number;
  readonly objectiveProgress: number;
}

export interface ProjectState {
  readonly id: ProjectId;
  readonly definitionId: string;
  readonly leadPlayerId: PlayerId;
  readonly tileId: TileId | null;
  readonly status: ProjectStatus;
  readonly requiredMoney: number;
  readonly requiredWork: number;
  readonly contributions: readonly ProjectContribution[];
  readonly sabotage: readonly ProjectSabotage[];
  readonly deadlineRound: number;
  readonly payout: ProjectPayout;
  readonly openToJoin: boolean;
  /** Contributors share the payout pro rata; the lead takes `leadBonusBasisPoints`. */
  readonly leadBonusBasisPoints: number;
}
```

### 5.3 Economy

```ts
export interface UpkeepState {
  readonly perRound: number;
  readonly lastChargedRound: number;
  readonly missedPayments: number;
}

export interface LoanState {
  readonly id: LoanId;
  readonly principal: number;
  readonly outstanding: number;
  readonly interestBasisPoints: number;
  readonly takenAtRound: number;
}

export interface IncomeStreamState {
  readonly id: IncomeStreamId;
  readonly kind: "asset" | "rent" | "project" | "side-gig";
  readonly perRound: number;
  readonly remainingRounds: number | null;
  readonly sourceId: string | null;
}
```

On `PlayerState`: `upkeep: UpkeepState`, `loans: readonly LoanState[]`,
`incomeStreams: readonly IncomeStreamState[]`.

### 5.4 Conflict

```ts
export interface HeatState {
  readonly value: number;
  readonly threshold: number;
  readonly investigationsOpened: number;
  readonly lastIncrementedAtRound: number | null;
}
```

On `PlayerState`: `heat: HeatState`.

Aggression must cost the aggressor or the game degenerates into every table alpha-striking
the leader every match. Attacking raises heat; crossing `threshold` opens an investigation
prompt against the *attacker*.

### 5.5 Agreements

```ts
export type TradeItem =
  | { readonly kind: "money"; readonly amount: number }
  | { readonly kind: "card"; readonly cardId: CardInstanceId }
  | { readonly kind: "token"; readonly tokenId: TokenId; readonly quantity: number }
  | { readonly kind: "tile"; readonly tileId: TileId }
  | { readonly kind: "immunity"; readonly rounds: number }
  /** Unenforceable. Recorded so the table can see who broke what. */
  | { readonly kind: "promise"; readonly text: string };

export type AgreementStatus =
  | "offered" | "accepted" | "declined" | "expired" | "settled" | "broken";

export interface AgreementState {
  readonly id: AgreementId;
  readonly proposerId: PlayerId;
  readonly recipientIds: readonly PlayerId[];
  readonly give: readonly TradeItem[];
  readonly receive: readonly TradeItem[];
  readonly status: AgreementStatus;
  readonly offeredAtRound: number;
  readonly expiresAtRound: number;
  readonly acceptedBy: readonly PlayerId[];
  readonly visibility: "public" | "parties-only";
}
```

Enforce **transfers**; do not enforce **promises**. Betrayal is the fun part — engineering
it away removes the only reason table talk matters.

### 5.6 Objectives and win paths

```ts
export type WinPath = "promotion" | "wealth" | "influence" | "survival";

export interface ObjectiveState {
  readonly id: ObjectiveId;
  readonly definitionId: string;
  readonly ownerId: PlayerId | null;   // null = table-wide
  readonly progress: number;
  readonly target: number;
  readonly completedAtRound: number | null;
  readonly visibility: "public" | "secret";
  readonly rewardPoints: number;
  readonly rewardMoney: number;
}

export interface ScoreBreakdown {
  readonly playerId: PlayerId;
  readonly rankPoints: number;
  readonly moneyPoints: number;
  readonly reputationPoints: number;
  readonly objectivePoints: number;
  readonly ownershipPoints: number;
  readonly projectPoints: number;
  readonly penaltyPoints: number;
  readonly total: number;
}
```

`MatchEndReason` gains `"quarters-elapsed"`, `"objectives-complete"`, `"last-standing"`.
`MatchOutcome` gains `readonly scores: readonly ScoreBreakdown[]` and
`readonly winPath: WinPath | null`.

### 5.7 Quarters and global events

```ts
export interface QuarterState {
  readonly index: number;
  readonly startedAtRound: number;
  readonly endsAtRound: number;
  /** Announced when the quarter opens so players can position for it. */
  readonly scheduledEventId: string | null;
  readonly resolvedEventIds: readonly string[];
}
```

On `GameState`: `quarters: readonly QuarterState[]`, `currentQuarterIndex: number`.

Global events are authored content (`packages/content/src/deadline-dash/global-events.ts`):
audit season, layoffs, budget freeze, reorg, merger rumour, bonus season. **Announce them
one quarter ahead** — a known-in-advance shock that players can prepare for is a decision;
an unannounced one is just variance.

### 5.8 Ballots

```ts
export interface BallotState {
  readonly id: BallotId;
  readonly kind: "vote" | "auction";
  readonly subjectId: string;
  readonly subject: JsonObject;
  readonly audience: readonly PlayerId[];
  readonly castBy: Readonly<Record<string, JsonValue>>;
  readonly deadlineAt: LogicalTimestamp | null;
  readonly closesAtRound: number;
  /** Sealed until close: nobody sees votes or bids in flight. */
  readonly visibility: "open" | "sealed";
  readonly resolution: JsonObject | null;
}
```

### 5.9 `GameState` additions

```ts
readonly rules: ModeRules;                                   // resolved at game.start, frozen for the match
readonly tileOwnership: Readonly<Record<string, TileOwnershipState>>;
readonly placements: readonly PlacementState[];
readonly projects: readonly ProjectState[];
readonly agreements: readonly AgreementState[];
readonly objectives: readonly ObjectiveState[];
readonly ballots: readonly BallotState[];
readonly quarters: readonly QuarterState[];
readonly currentQuarterIndex: number;
readonly eliminatedPlayerIds: readonly PlayerId[];
```

`rules` is **snapshotted into the state at `game.start`**, not read live from content. A
match must replay identically after the content pack changes.

### 5.10 Migration

`VersionState.stateSchemaVersion` must be bumped. `room-snapshot.ts` already normalises
legacy snapshots — extend that normaliser so a pre-v2 stored game loads with every new
collection defaulted empty and `rules` backfilled from its `modeId`. **A stored game from
before this change must still open.** Cover it with a test that loads a v1 fixture.

---

## 6. Commands

`turn.action` and the free-action economy are the fix for "the only verb is roll".

### 6.1 Already declared — implement the transition

`turn.play-card`, `turn.activate-character`, `turn.spend-token`, `reaction.play`,
`reaction.pass`, `audit.pay-fine`, `promotion.attempt`, `management.shuffle-deck`,
`management.block-promotion`, `turn.timeout`.

### 6.2 New

| Command | Payload | Notes |
| --- | --- | --- |
| `turn.adjust-roll` | `{ pips: number }` | Spend energy to shift the roll. Bounded by `agency.maxPipAdjust`. |
| `turn.action` | `{ action: string; targetPlayerIds; choice }` | The free action: work / network / scheme / rest. |
| `promotion.decline` | `{}` | Only legal when `agency.promotionIsChoice`. |
| `tile.claim` | `{ tileId }` | |
| `tile.upgrade` | `{ tileId }` | |
| `placement.place` | `{ kind; tileId }` | |
| `project.start` | `{ definitionId; tileId \| null; openToJoin }` | |
| `project.contribute` | `{ projectId; money; work }` | |
| `project.sabotage` | `{ projectId; amount; hidden }` | Raises heat. |
| `agreement.offer` | `{ recipientIds; give; receive; expiresAtRound; visibility }` | |
| `agreement.respond` | `{ agreementId; accept: boolean }` | |
| `attack.target` | `{ targetPlayerId; vector: string; cardId \| null }` | Raises heat. |
| `ballot.cast` | `{ ballotId; value }` | Votes and auction bids share this. |
| `loan.take` / `loan.repay` | `{ principal }` / `{ loanId; amount }` | |
| `window.expire` | `{ decisionPointId }` | **Server-injected only.** §7.1. |
| `quarter.advance` | `{}` | Engine-internal or server-injected. |

### 6.3 Authorisation — non-negotiable

Every transition must verify that `command.actorId` is entitled to the effect **before**
mutating. A trade must not let me spend your money; a ballot must not let me cast your
vote; `window.expire` must be rejected if it arrives from a player. Add a test per command
that asserts the unauthorised case is rejected. This is the largest new attack surface in
the codebase — the current game has exactly one mutating verb, and after this it has
twenty-eight.

---

## 7. The three real architectural changes

### 7.1 Wall-clock boundaries

The engine is pure and must never read a clock. Reaction windows, ballots and turn timers
all need an expiry.

Pattern: the engine writes `deadlineAt` (a `LogicalTimestamp`) onto the
`ReactionWindowState` / `BallotState` / `TurnState` and takes no further interest. The
**server** owns a scheduler that fires at that wall-clock instant and submits a
`window.expire` command through the ordinary command path — same revision check, same
receipt, same event log. `apps/server/src/rooms/turn-timer/` is the working template; it
already does exactly this for `turn.timeout`.

Rules: `window.expire` is only ever accepted from the server; it must be **idempotent**
(firing twice cannot double-resolve); and a missed fire must be recoverable — on load, any
window whose `deadlineAt` has already passed resolves immediately. Do not put a timer in
the engine and do not let the client be the clock.

### 7.2 Per-viewer projections

Already exists (`projectPlayerView`) and is already called. What is missing:

- `PublicPlayerProjection` must **omit** hidden state, not include-and-hope. Hidden hands
  project as a count. Secret objectives project as existence-only. `owner-only` placements
  are absent from other players' views entirely.
- Sealed ballots must not leak in-flight votes to anyone, including via `castBy` keys.
- The WS fan-out currently publishes one payload to a topic. With hidden information that
  becomes a **per-socket** payload. `publish-projection-update.ts` must project per
  recipient.
- Add a test that asserts a viewer's payload cannot contain another player's hand, secret
  objective, hidden sabotage, or `owner-only` placement.

Hidden roles are currently **cosmetic and leaky** — `game-setup.ts` assigns Management by
`(order + 1) % 3 === 0` with `order` published as `seat`, so anyone can derive every role
from the public projection. Either make roles real or delete them; do not ship the fake.

### 7.3 Multi-party commands

Trades, ballots and targeted attacks are the first commands whose effects land on a player
who is not the actor. That needs an explicit authorisation model (§6.3) and an
offer/accept handshake with expiry, so a stale offer cannot be accepted after the state it
referenced has changed. Validate affordability at **accept** time, not offer time.

---

## 8. Outside the engine

### 8.1 Chat

Not game state. `packages/db` gains `room_messages` (id, roomId, authorId, kind, body,
createdAt) and `room_message_reactions`. Server owns rate limiting, length caps, and a
`ChatMode` gate. `quick` mode = a fixed phrase/emote set, which is also the only mode bots
can meaningfully use.

No DMs in v1. Private channels are a large abuse surface and a moderation obligation;
`social.directMessages` exists in the config as an off switch, not as a v1 feature.

### 8.2 Emote reactions

Reactions on feed events. Distinct from `reaction.play` — same word, unrelated feature.
Ephemeral, capped per player per event, never in `GameState`.

### 8.3 Bots

Every mechanic here makes bots harder. Bots are a **seat-filler, not a mode**: they must
produce a legal action for every new command type, but they are not required to be good at
negotiation. `bot-policy.ts` extends with a priority ladder per mechanic. Pacing is
`bots.pacing` — the current instant behaviour is unfollowable and was already reported.

### 8.4 Custom modes

Lobby authors a `ModeRules` object. Contracts validates it (every field present, every
numeric bounded, `winPaths` not all-false, `upkeepByRankIndex` length equal to the ladder).
Stored on the room, snapshotted into `GameState.rules` at start. Never trust a
client-supplied rules object — an unbounded `maxPipAdjust` or a negative
`interestBasisPoints` is a cheat.

### 8.5 Panels

The current game view is a board plus a rail with three blocks, and the rail is already
crowded. v2 needs: hand, projects, market/auction, agreements, ballots, objectives, heat,
chat, quarter/event track. That does not fit the existing shell — the layout needs a
tabbed or dockable rail, not nine more stacked blocks.

Constraints that still bind: `DESIGN.md` §7.1 for chrome motion, §7.2 for the gameplay
motion layer, container queries rather than viewport media queries inside the rail, and
`renderToStaticMarkup` for tests — nothing interactive is unit-testable in this repo.

---

## 9. Build order

Waves are sequential; agents inside a wave are parallel and own disjoint files.

1. **Foundations** — `ModeRules` + presets + rank costs; `GameState`/ids/command-union
   extensions; contracts DTOs and validators; db schema. Nothing works yet; everything
   typechecks.
2. **Engine mechanics** — one agent per mechanic, plus a single owner for the hot shared
   files (`apply-command.ts`, `legal-actions.ts`).
3. **Server** — routes per command, the expiry scheduler, per-socket projections, chat,
   bot extension.
4. **Web** — the panel set and the shell that can hold it.
5. **Integration** — full suite, migration test, browser playthrough, doc correction.

## 10. Effect vocabulary v2

`packages/content/src/schema/effects.ts` currently expresses **immediate self-effects only**.
That is why `decks.ts` holds 29 of the ~247 designed cards and says so in its own docstring:
the remaining ones need target-player mechanics, `[REACTION]`/stored play, and deck
depletion. All three arrive with v2, so the vocabulary has to grow to match — and it must
grow *before* cards are authored against it, or the authoring is wasted.

### 10.1 Targeting

Every effect gains an optional `target` (default `"self"`, which preserves every existing
card unchanged):

```ts
export type EffectTarget =
  | "self"
  | "active-player"
  | "chosen-opponent"      // actor picks; needs a prompt
  | "all-opponents"
  | "all-players"
  | "left-neighbour"
  | "right-neighbour"
  | "highest-rank"         // ties broken by turn order, deterministically
  | "lowest-rank"
  | "richest"
  | "poorest";
```

Derived targets (`highest-rank`, `richest`, …) must break ties by `playerOrder`, never by
object key iteration — key order is not a stable contract across a JSON round trip.

`chosen-opponent` requires a decision, so an effect carrying it **must** open a
`PromptState` rather than silently picking. An effect that resolves a choice on the
player's behalf is a bug.

### 10.2 Timing

```ts
export type EffectTiming =
  | "immediate"   // resolves on draw or on play — today's only behaviour
  | "stored"      // enters the hand, played later on your own turn
  | "reaction";   // playable out of turn into an open ReactionWindowState
```

`stored` requires `agency.handEnabled`; `reaction` requires
`interaction.reactionWindows`. A card whose timing is disabled by the active mode must not
enter its deck at setup — filter at deck construction, do not draw-then-discard.

### 10.3 New effect types

Beyond the existing `modifyResource` / `payResource` / `restoreResourceToMaximum` /
`incrementWorkCounter` / `rollCheck` / `grantExtraRoll` / `drawCards` / `applyStatus` /
`skipTurns` / `auditConfinement`:

| Type | Purpose |
| --- | --- |
| `transferResource` | Move resource from target to actor. The steal primitive. |
| `modifyHeat` | Raise or lower suspicion. Every aggressive effect must carry one. |
| `placeObject` | Put a `PlacementState` on a tile. |
| `claimTile` / `releaseTile` | Ownership. |
| `startProject` / `contributeToProject` / `sabotageProject` | Project verbs as card effects. |
| `openBallot` | Raise a vote or auction. |
| `grantImmunity` | Blocks the next N preventable effects targeting this player. |
| `forceDiscard` | Target discards from hand. Needs `hiddenHands` handling. |
| `swapBoardPositions` / `teleport` | Board manipulation. Unblocks the character actives that were never built. |
| `modifyUpkeep` | Temporary relief or penalty. |
| `openReactionWindow` | Explicitly raise a window; pairs with `preventable`. |
| `grantIncomeStream` | Adds an `IncomeStreamState`. |

Every effect also gains:

```ts
readonly preventable?: boolean;   // may a reaction cancel this? default false
readonly condition?: JsonObject;  // guard evaluated before applying
```

`preventable: true` is what makes an effect eligible to raise a `ReactionWindowState` with
a `pendingEffectId` — the exact shape already modelled in `PendingEffectState` and never
populated.

### 10.4 Authoring rules

- Every aggressive effect (`transferResource` from a non-self target, `sabotageProject`,
  `forceDiscard`, hostile `applyStatus`) **must** carry a `modifyHeat` on the actor. Spec
  §5.4: free aggression collapses the game into alpha-striking the leader.
- Display copy stays in the register `DESIGN.md` mandates — a line an office system would
  have logged, procedural and unbothered, never a punchline. Copy must never restate
  numbers, because the UI renders mechanics from `effects` directly; copy that implies an
  unimplemented mechanic is simply a lie, and there is already a docstring in `decks.ts`
  promising exactly this discipline.
- The corner decks (`deck.board-meeting`, `deck.annual-event`) are ~50 cards and are
  **all-player effects by design**. They are the natural home for `all-players` targeting
  and for global-event interaction.
- The Clock Deck win condition (§5.6, `clock-deck-exhausted`) has no producer today because
  `drawCards` draws with replacement. Deck depletion must actually deplete.

## 11. API surface

Today `apps/server/src/routes/rooms.ts` has eight hand-written routes, two of which
(`/roll`, `/respond`) are per-command and duplicate each other almost exactly: parse, auth,
same-origin check, actor guard, revision check, submit, map rejection, publish. v2 adds
**twenty-eight** commands. Twenty-eight more copies of that block is not a design.

### 11.1 One command endpoint

```
POST /api/rooms/:roomId/commands
```

Body is a discriminated union on `type`, validated by `packages/contracts`. The route does
auth, same-origin, actor entitlement, revision check, submit, rejection mapping and
publish **exactly once**, and the engine's own `GameCommand` union does the discriminating —
which it was already shaped for.

Keep `POST /:roomId/roll` and `POST /:roomId/respond` as thin deprecated aliases that
forward into the same handler, so the current client keeps working while wave 4 migrates.
Delete them in wave 5, not before.

Non-negotiable properties of that single handler:

- **Idempotency by `commandId`.** `command_receipts` exists in the schema and is unused. A
  retried submit must return the original outcome, not apply twice. With reaction windows
  and auto-retrying clients this stops being theoretical.
- **Revision predicate on write**, as the repository already does — a lost race returns a
  conflict, never a partial apply.
- **`window.expire` is rejected at this endpoint, always.** §7.1. It is server-injected
  only. Contracts is instructed to make it unrepresentable in a request body; the route
  must also refuse it if one ever appears.
- **Actor entitlement is checked before the engine sees the command.** The engine validates
  game legality; the route validates *identity* — that this session owns this seat. Those
  are different checks and both must exist.
- One rejection shape for every command, mapped from the engine's existing rejection
  reasons. The client must be able to render a refusal without knowing which command it was.

### 11.2 Chat

Not a command; never touches `GameState`.

```
GET  /api/rooms/:roomId/messages?before=<cursor>&limit=<n>   # history, paginated
POST /api/rooms/:roomId/messages                             # send
POST /api/rooms/:roomId/messages/:messageId/reactions        # emote
```

Server-enforced: `ChatMode` gate (`off` rejects outright; `quick` accepts only ids from the
fixed phrase set), length cap, per-player rate limit, and membership — a non-member of the
room cannot read or post. Messages are persisted and pushed over WS.

### 11.3 Realtime

The current fan-out publishes **one payload to a topic**. With hidden information that is a
leak by construction, so it becomes **per-socket**: each connected socket receives
`projectPlayerView(state, thatViewersPlayerId)`, never a shared public payload with private
fields attached.

Push message kinds: `projection` (per-viewer state), `event` (committed game events, already
paced client-side), `chat`, `reaction`, `presence`, `window-opened` / `window-closed` (so a
reaction window surfaces instantly rather than on the next poll).

Spectators and not-yet-seated members get the public projection. Never derive a viewer's
identity from anything the client sent in the socket message — resolve it from the
authenticated session at upgrade time.

### 11.4 Load shape

A reaction window opening means every seated player's client reacts at once. Ballots mean
N simultaneous writes against one game. Design for the burst: the drain scheduler
(`apps/server/src/rooms/drain-scheduler.ts`) already serialises writes per room, so route
bursts through it rather than letting N handlers race the revision predicate and generate
N-1 conflicts.

---

## 12. Look and feel for the panel system

`DESIGN.md` governs chrome (§7.1) and the gameplay motion layer (§7.2) and both still bind.
What it does not cover is a twelve-destination interface, which is a different problem from
a three-block rail. This section is the missing half.

### 12.1 The governing problem

The repo owner's actual complaint is **"i genuinely cant follow the game."** Every decision
below serves legibility over density. A panel that is beautiful and unreadable at a glance
has failed. Two specific consequences:

- **Own versus opponent must be visually distinct at a glance**, everywhere — feed, log,
  chat, board, panels. This was raised explicitly ("notif kebanyakan, dipisah yang sendiri
  atau lawan") and is not satisfied by a name label. It needs a structural difference:
  alignment, or a persistent accent, or indentation — something readable in peripheral
  vision without parsing text.
- **Nothing that appears or disappears may move the board.** Raised twice. Reserve the space
  or take the element out of flow. This is a hard layout rule, not a preference.

### 12.2 Hierarchy

Three tiers, and a thing may only live in one:

1. **Always visible** — whose turn it is, the turn timer, your own resources, and any open
   decision addressed to you. These never go behind a tab. If a player must act, they must
   be able to see that without navigating.
2. **One interaction away** — the tab set. Everything you consult but do not need
   continuously: projects, market, agreements, ballots, objectives, heat, chat, log.
3. **On demand** — card detail, another player's dossier, rules reference. Overlay or
   inspector, dismissible, never blocking the board.

### 12.3 Attention without modals

Modals are banned for anything the game raises at you ("notif gak modal yang nutupin"). The
replacement is a two-part system:

- A **persistent attention region** in the shell, permanently sized so its contents can
  change without reflow, holding the highest-priority open decision.
- **Tab badges** for everything else, with a count. A badge appearing must not resize its
  tab — reserve the space.

Time pressure is shown as a **depleting bar or ring, not a ticking number**. A number
demands you read and subtract; a bar is peripherally legible, which is the entire point
when a reaction window is eight seconds long. The bar's motion is the one sanctioned
continuous animation in the system — everything else stays one-shot per §7.2 — and it must
still be honest under `prefers-reduced-motion`, degrading to discrete steps rather than
vanishing.

### 12.4 Semantic language for the new state

v2 introduces state with no visual vocabulary yet. Assign it deliberately rather than
letting twelve panels each invent one:

| Concept | Reads as | Never |
| --- | --- | --- |
| Heat / suspicion | accumulating pressure, warning register | a score to maximise |
| Upkeep | a recurring obligation, visible *before* it bites | a surprise deduction |
| Debt | owed, distinct from negative money | red text alone |
| Ownership | a persistent mark on the tile itself, readable on the board | rail-only |
| Placements | present on the board, `owner-only` ones visible only to their owner | leaked by layout |
| Project progress | a filling commitment with a visible deadline | a bare percentage |
| Sealed ballot | visibly sealed — the state is "nobody knows yet" | an empty result |

The board is shared space now. Ownership and placements must be legible **on the board**,
not only in a panel — a territory game you can only read in a sidebar is not a board game.

### 12.5 Empty states

Twelve panels means most are empty most of the time, especially in the first ten minutes.
An empty panel is the first thing a new player reads, so each one says what it is for and
what will appear there. "No projects yet" is a failure; "Projects you start or join appear
here. Starting one costs money and takes several turns to pay out" teaches the game.

This is the cheapest onboarding available and the game currently has none.

### 12.6 Motion budget

Per `DESIGN.md` §7.2 and `apps/web/src/lib/motion.ts` — import the vocabulary, never invent
spring configs. Panel-specific:

- Tab switches are chrome: §7.1, no springs, no overshoot.
- A panel gaining a row (a new agreement, a new message) uses `gameplay-reveal`, one-shot.
- Resource changes use `gameplay-tick`. A resource that changes because *someone did
  something to you* must be distinguishable from one that changed because you acted — this
  is the own-versus-opponent rule applied to numbers.
- Nothing ambient. No looping, no pulsing, no attention-seeking idle motion. The only
  continuous animation in the system is the timer bar in §12.3.

### 12.7 Density and width

The layout has only ever been tuned at ~1528px. Wave 4 must define and implement the full
range: side-by-side at wide, a narrower rail at medium, and a stacked or sheet layout at
narrow where the board and rail cannot share the width. Inside the rail, use container
queries — the rail is a narrow column in a wide viewport and viewport queries are the wrong
signal, a mistake already made and fixed once in this codebase.

### Standing instructions for every agent

- Work on `main`. Do not branch.
- Run shell commands under **bash**, not the default zsh.
- **Never add a `Co-Authored-By` trailer** to any commit.
- The sandbox **can** reach Postgres. An earlier claim that it could not was false and is
  the direct cause of a foreign-key ordering bug that shipped — the concurrency work was
  validated only against `InMemoryRoomRepository`, which has no foreign keys. Test against
  the real database.
- Keep the whole workspace green: `bun run typecheck`, `bun run test`, `bun run lint`.
  Baseline at the start of this work is **1,118 tests passing across 5 projects**.
- Engine purity holds: no React, Hono, Drizzle, env vars, browser APIs, `Math.random()`,
  `Date.now()`, or timers in `packages/engine`.
- Do not re-propose Next.js, Supabase Realtime, or a flat single-package layout. All three
  were tried and deliberately reverted.
