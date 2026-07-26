/**
 * One entry per advertised action: where it lives, how it is emphasised, what it
 * says, and which component renders it.
 *
 * **This is the file a twenty-eighth command touches.** The brief's requirement is
 * that adding one later "is a registry entry rather than a hunt through JSX", and
 * the shape below is what makes that true: `ActionControls` renders by looking a
 * type up here, so no host, no shell and no panel contains a `switch` over command
 * types. The only per-command knowledge outside this file is inside the control
 * component itself, which is where it belongs.
 *
 * ## Two compile-time guarantees
 *
 * 1. The registry is typed `Readonly<Record<LegalActionSummaryType, …>>`, so a
 *    missing member does not compile. `LegalActionSummaryType` is in turn proved
 *    equal to `PlayerCommandType` by contracts' own
 *    `LEGAL_ACTIONS_COVER_EVERY_PLAYER_COMMAND` — so "twenty-seven commands,
 *    twenty-seven controls" is checked by the compiler rather than by a comment.
 * 2. Each entry is built through {@link entry}, which is generic in its own type.
 *    That is what type-checks `describe` and `Control` against the *narrowed*
 *    summary at the call site: `describeClaimTile` cannot be registered under
 *    `tile.upgrade`, and `ContributeControl` cannot be handed a `loan.take`.
 *
 * The erasure to a uniform stored shape happens exactly once, inside `entry` —
 * see the note there. A single documented cast in one helper is the price of
 * dispatching a discriminated union through a record, and it buys twenty-seven
 * type-checked call sites.
 */
import type { ComponentType } from "react";

import type { LegalActionSummaryType } from "@office-ladder/contracts";

import {
  describeActivateCharacter,
  describeAdjustRoll,
  describeAttack,
  describeBallot,
  describeBlockPromotion,
  describeClaimTile,
  describeContribute,
  describeOfferAgreement,
  describePayFine,
  describePlacement,
  describePlayCard,
  describePromotionAttempt,
  describePromotionDecline,
  describePrompt,
  describeReactionPass,
  describeReactionPlay,
  describeRepayLoan,
  describeRespondAgreement,
  describeRoll,
  describeSabotage,
  describeShuffleDeck,
  describeSpendToken,
  describeStartGame,
  describeStartProject,
  describeTakeLoan,
  describeTurnAction,
  describeUpgradeTile,
} from "./action-copy";
import type {
  ActionContext,
  ActionControlProps,
  ActionDescription,
  ActionEmphasis,
  ActionOf,
  ActionSurface,
  PanelId,
} from "./action-model";
import {
  BlockPromotionControl,
  PromptControl,
  ReactionPassControl,
  ReactionPlayControl,
} from "./controls-decision";
import {
  AttackControl,
  BallotControl,
  ContributeControl,
  OfferAgreementControl,
  PlayCardControl,
  RepayLoanControl,
  RespondAgreementControl,
  SabotageControl,
  ShuffleDeckControl,
  StartProjectControl,
  TakeLoanControl,
} from "./controls-rail";
import {
  ActivateCharacterControl,
  AdjustRollControl,
  ClaimTileControl,
  PayFineControl,
  PlacementControl,
  PromotionAttemptControl,
  PromotionDeclineControl,
  RollControl,
  SpendTokenControl,
  StartGameControl,
  TurnActionControl,
  UpgradeTileControl,
} from "./controls-turn";

/** What a registry entry declares, narrowed to one action type. */
type ActionEntry<Type extends LegalActionSummaryType> = {
  readonly type: Type;
  readonly surface: ActionSurface;
  /** The panel this control is mounted inside. Non-null iff `surface === "rail"`. */
  readonly panelId: PanelId | null;
  /** Lower sorts first within a surface. Ties keep the server's own order. */
  readonly order: number;
  readonly emphasis: ActionEmphasis;
  readonly describe: (action: ActionOf<Type>, context: ActionContext) => ActionDescription;
  readonly Control: ComponentType<ActionControlProps<Type>>;
};

/** The same entry, with its type parameter erased so one record can hold all 27. */
export type StoredActionEntry = ActionEntry<LegalActionSummaryType>;

/**
 * Type-checks an entry against its own action type, then erases it.
 *
 * The cast is unavoidable and safe for the same reason: `Control` is only ever
 * invoked with the action this entry was registered for, because the only caller
 * looks the entry up BY `action.type`. TypeScript cannot express that correlation
 * across a record, so it is asserted once, here, instead of at twenty-seven call
 * sites where the assertion would be invisible.
 *
 * It routes through `unknown` because `describe`/`Control` are contravariant in
 * the action they accept: a narrowed entry is genuinely NOT assignable to the
 * widened one, and `tsc` rightly refuses the single-step assertion. The widening
 * is sound only under the by-`action.type` lookup invariant above, which is a
 * property of the caller rather than of these two types, so the compiler has to
 * be told rather than convinced.
 */
function entry<Type extends LegalActionSummaryType>(
  config: ActionEntry<Type>,
): StoredActionEntry {
  return config as unknown as StoredActionEntry;
}

/**
 * Where every control lives, and why.
 *
 * The placement decisions, stated once (spec §12.2's three tiers):
 *
 * - **`turn`** — the command lane under the board. The roll plus everything whose
 *   object is *your position and your turn*: the pips you are about to spend, the
 *   free action, the desk you are standing on, the promotion you can afford, the
 *   fine you owe. These are legal only on your own turn, so the lane is empty most
 *   of the time by design and says so rather than showing dead controls.
 * - **`decision`** — a decision addressed to you, on a clock. Never behind a tab
 *   (§12.2), and never a modal (§12.3).
 * - **`rail`** — beside the state it acts on. Contribute and sabotage next to the
 *   project, cast next to the ballot, answer next to the offer, play next to the
 *   hand, borrow next to the money, target next to the seats, shuffle next to the
 *   decks.
 *
 * Two placements worth arguing with: `agreement.respond` and `ballot.cast` are
 * decisions addressed to a player, but they are NOT blocking and their deadline is
 * counted in rounds, so they live in the rail behind a tab badge (§12.3's "tab
 * badges for everything else, with a count") rather than in the always-visible
 * band, which is reserved for what stops the match. And `loan.*` sits in the market
 * panel because the market is the economy destination; there is no lending panel
 * and inventing a thirteenth rail tab for two controls would cost every player a
 * tab to learn.
 */
export const ACTION_REGISTRY: Readonly<Record<LegalActionSummaryType, StoredActionEntry>> = {
  /* Tier 1 — the turn's spine. Order is the lane's left-to-right reading order. */
  "game.start": entry<"game.start">({
    type: "game.start",
    surface: "turn",
    panelId: null,
    order: 0,
    emphasis: "primary",
    describe: describeStartGame,
    Control: StartGameControl,
  }),
  "turn.roll": entry<"turn.roll">({
    type: "turn.roll",
    surface: "turn",
    panelId: null,
    order: 1,
    emphasis: "primary",
    describe: describeRoll,
    Control: RollControl,
  }),
  "turn.adjust-roll": entry<"turn.adjust-roll">({
    type: "turn.adjust-roll",
    surface: "turn",
    panelId: null,
    order: 2,
    emphasis: "secondary",
    describe: describeAdjustRoll,
    Control: AdjustRollControl,
  }),
  "turn.action": entry<"turn.action">({
    type: "turn.action",
    surface: "turn",
    panelId: null,
    order: 3,
    emphasis: "secondary",
    describe: describeTurnAction,
    Control: TurnActionControl,
  }),
  "tile.claim": entry<"tile.claim">({
    type: "tile.claim",
    surface: "turn",
    panelId: null,
    order: 4,
    emphasis: "secondary",
    describe: describeClaimTile,
    Control: ClaimTileControl,
  }),
  "tile.upgrade": entry<"tile.upgrade">({
    type: "tile.upgrade",
    surface: "turn",
    panelId: null,
    order: 5,
    emphasis: "secondary",
    describe: describeUpgradeTile,
    Control: UpgradeTileControl,
  }),
  "placement.place": entry<"placement.place">({
    type: "placement.place",
    surface: "turn",
    panelId: null,
    order: 6,
    emphasis: "secondary",
    describe: describePlacement,
    Control: PlacementControl,
  }),
  "turn.spend-token": entry<"turn.spend-token">({
    type: "turn.spend-token",
    surface: "turn",
    panelId: null,
    order: 7,
    emphasis: "secondary",
    describe: describeSpendToken,
    Control: SpendTokenControl,
  }),
  "turn.activate-character": entry<"turn.activate-character">({
    type: "turn.activate-character",
    surface: "turn",
    panelId: null,
    order: 8,
    emphasis: "secondary",
    describe: describeActivateCharacter,
    Control: ActivateCharacterControl,
  }),
  "promotion.attempt": entry<"promotion.attempt">({
    type: "promotion.attempt",
    surface: "turn",
    panelId: null,
    order: 9,
    emphasis: "secondary",
    describe: describePromotionAttempt,
    Control: PromotionAttemptControl,
  }),
  "promotion.decline": entry<"promotion.decline">({
    type: "promotion.decline",
    surface: "turn",
    panelId: null,
    order: 10,
    emphasis: "secondary",
    describe: describePromotionDecline,
    Control: PromotionDeclineControl,
  }),
  "audit.pay-fine": entry<"audit.pay-fine">({
    type: "audit.pay-fine",
    surface: "turn",
    panelId: null,
    order: 11,
    emphasis: "secondary",
    describe: describePayFine,
    Control: PayFineControl,
  }),

  /* Tier 1 — open decisions. Play before pass, so declining is never the first
     thing under the cursor. */
  "prompt.respond": entry<"prompt.respond">({
    type: "prompt.respond",
    surface: "decision",
    panelId: null,
    order: 0,
    emphasis: "primary",
    describe: describePrompt,
    Control: PromptControl,
  }),
  "reaction.play": entry<"reaction.play">({
    type: "reaction.play",
    surface: "decision",
    panelId: null,
    order: 1,
    emphasis: "primary",
    describe: describeReactionPlay,
    Control: ReactionPlayControl,
  }),
  "reaction.pass": entry<"reaction.pass">({
    type: "reaction.pass",
    surface: "decision",
    panelId: null,
    order: 2,
    emphasis: "secondary",
    describe: describeReactionPass,
    Control: ReactionPassControl,
  }),
  "management.block-promotion": entry<"management.block-promotion">({
    type: "management.block-promotion",
    surface: "decision",
    panelId: null,
    order: 3,
    emphasis: "critical",
    describe: describeBlockPromotion,
    Control: BlockPromotionControl,
  }),

  /* Tier 2 — beside the state each one acts on. */
  "turn.play-card": entry<"turn.play-card">({
    type: "turn.play-card",
    surface: "rail",
    panelId: "hand",
    order: 0,
    emphasis: "primary",
    describe: describePlayCard,
    Control: PlayCardControl,
  }),
  "project.start": entry<"project.start">({
    type: "project.start",
    surface: "rail",
    panelId: "projects",
    order: 0,
    emphasis: "primary",
    describe: describeStartProject,
    Control: StartProjectControl,
  }),
  "project.contribute": entry<"project.contribute">({
    type: "project.contribute",
    surface: "rail",
    panelId: "projects",
    order: 1,
    emphasis: "secondary",
    describe: describeContribute,
    Control: ContributeControl,
  }),
  "project.sabotage": entry<"project.sabotage">({
    type: "project.sabotage",
    surface: "rail",
    panelId: "projects",
    order: 2,
    emphasis: "critical",
    describe: describeSabotage,
    Control: SabotageControl,
  }),
  "agreement.offer": entry<"agreement.offer">({
    type: "agreement.offer",
    surface: "rail",
    panelId: "agreements",
    order: 0,
    emphasis: "primary",
    describe: describeOfferAgreement,
    Control: OfferAgreementControl,
  }),
  "agreement.respond": entry<"agreement.respond">({
    type: "agreement.respond",
    surface: "rail",
    panelId: "agreements",
    order: 1,
    emphasis: "secondary",
    describe: describeRespondAgreement,
    Control: RespondAgreementControl,
  }),
  "ballot.cast": entry<"ballot.cast">({
    type: "ballot.cast",
    surface: "rail",
    panelId: "ballots",
    order: 0,
    emphasis: "primary",
    describe: describeBallot,
    Control: BallotControl,
  }),
  "attack.target": entry<"attack.target">({
    type: "attack.target",
    surface: "rail",
    panelId: "seats",
    order: 0,
    emphasis: "critical",
    describe: describeAttack,
    Control: AttackControl,
  }),
  "loan.take": entry<"loan.take">({
    type: "loan.take",
    surface: "rail",
    panelId: "market",
    order: 0,
    emphasis: "secondary",
    describe: describeTakeLoan,
    Control: TakeLoanControl,
  }),
  "loan.repay": entry<"loan.repay">({
    type: "loan.repay",
    surface: "rail",
    panelId: "market",
    order: 1,
    emphasis: "secondary",
    describe: describeRepayLoan,
    Control: RepayLoanControl,
  }),
  "management.shuffle-deck": entry<"management.shuffle-deck">({
    type: "management.shuffle-deck",
    surface: "rail",
    panelId: "events",
    order: 0,
    emphasis: "secondary",
    describe: describeShuffleDeck,
    Control: ShuffleDeckControl,
  }),
};

/** Every registered type, in a stable order. */
export const ACTION_TYPES: readonly LegalActionSummaryType[] = Object.keys(
  ACTION_REGISTRY,
) as LegalActionSummaryType[];

export function actionEntry(type: LegalActionSummaryType): StoredActionEntry {
  return ACTION_REGISTRY[type];
}

export function actionSurface(type: LegalActionSummaryType): ActionSurface {
  return ACTION_REGISTRY[type].surface;
}

export function actionPanel(type: LegalActionSummaryType): PanelId | null {
  return ACTION_REGISTRY[type].panelId;
}
