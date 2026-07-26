/**
 * `LegalActionSummary` — what an actor may do *right now*, as it crosses the
 * transport (spec §6, §7.2, §11.1).
 *
 * The engine's `enumerateLegalActions` answers twenty-seven action types; this
 * union is how they reach a browser. Before this file it was a three-member union
 * (`game.start` | `turn.roll` | `prompt.respond`), which meant twenty-four
 * commands existed in the engine and nowhere else: a command the UI cannot see is
 * a command that does not exist, however well implemented it is.
 *
 * Three properties hold this module together.
 *
 * 1. **One member per player command, proven at compile time.** The union's
 *    `type` values are exactly {@link PlayerCommandType} — the allow-list in
 *    `commands.ts` that decides what a player may submit at all. The proof is
 *    {@link LEGAL_ACTIONS_COVER_EVERY_PLAYER_COMMAND}: adding a command without a
 *    member here, or a member here for something a player cannot submit, is a
 *    compile error on that line. The three server-injected commands
 *    (`window.expire`, `quarter.advance`, `turn.timeout`) are therefore
 *    unrepresentable here for the same reason they are unrepresentable as request
 *    bodies — §7.1 requires that a player cannot expire their own reaction window,
 *    and advertising one would be advertising the exploit.
 *
 * 2. **This is a redaction boundary, not just a shape.** Every payload below is
 *    built so that a leak is impossible *by construction* rather than avoided by
 *    convention:
 *    - Card-bearing actions (`turn.play-card`, `reaction.play`) carry **opaque
 *      instance ids only**. There is no `definitionId`, no name key, no owner
 *      field and no per-card detail of any kind, so a list of card ids cannot
 *      describe a hand — the actor resolves their own ids against
 *      `CallerSelfProjection.hand`, which is already actor-only.
 *    - `ballot.cast` has **no `castBy`, no tally, no bid list and no vote count**.
 *      §7.2 requires that a sealed ballot does not leak in-flight votes "including
 *      via `castBy` keys"; the way to guarantee that is for the type to have
 *      nowhere to put them. It carries `sealed` so the UI knows not to promise a
 *      running total, and an unknown ballot is treated as sealed — the safe
 *      direction to be wrong in.
 *    - Nothing here carries an objective, so a secret objective cannot leak
 *      through an action; nothing here carries another player's resources, hand
 *      count, statuses or hidden placements. `attack.target` names eligible
 *      *seats* (already public) and prices the actor's own heat, never the
 *      target's balances.
 *    - Nothing here carries `actorId` or `gameId`. The engine's `LegalAction` has
 *      both and they are deliberately dropped at this boundary: a viewer's
 *      identity is resolved from the authenticated session, never from anything
 *      in a payload, and a summary that named its actor would be an invitation to
 *      do the opposite.
 *
 * 3. **Contracts may only ever tighten an advertisement, never widen one.** Every
 *    submittable ceiling below is the minimum of what the engine offered, what the
 *    mode's own `ModeRules` allow, and the transport bound the parser in
 *    `commands.ts` enforces. So an advertised maximum is always a value that
 *    parser would accept, and a mechanic a mode has switched off can never be
 *    priced *up* by this file. Legality itself stays the engine's: this module
 *    never invents an action, and the only action it drops is one whose option set
 *    is empty after clamping, which is not an action at all.
 */
import {
  MAX_AGREEMENT_RECIPIENTS,
  MAX_MONEY_AMOUNT,
  MAX_PIP_ADJUST,
  MAX_TOKEN_QUANTITY,
  MAX_TRADE_ITEMS,
  MAX_WORK_AMOUNT,
  PROMISE_TEXT_MAX_LENGTH,
  type PlayerCommandType,
} from "./commands";
import {
  TRADE_ITEM_KINDS,
  type BallotKind,
  type PlacementKind,
  type TradeItem,
  type TradeItemKind,
} from "./gameplay";
import type { ModeRules } from "./mode-rules";

/** The three kinds of reaction window the engine opens (`ReactionWindowState.kind`). */
export type ReactionWindowKind = "prevention" | "end-turn" | "promotion-block";

/**
 * A card the actor may play, as an opaque instance id.
 *
 * A bare string alias rather than an object, deliberately: the moment this
 * becomes a record it acquires somewhere to put a definition id, and a hand's
 * contents leak through the action that targets it. See the module docstring.
 */
export type PlayableCardId = string;

/** One token the actor holds, and what a single `turn.spend-token` may spend it on. */
export type SpendableTokenSummary = {
  readonly tokenId: string;
  readonly use: string;
  /** Never above {@link MAX_TOKEN_QUANTITY}, so the advertised max always parses. */
  readonly maxQuantity: number;
};

/** One placement the actor could afford, and what it costs. */
export type PlaceableSummary = {
  readonly kind: PlacementKind;
  readonly cost: number;
};

/** One outstanding loan and what is still owed on it. */
export type RepayableLoanSummary = {
  readonly loanId: string;
  readonly outstanding: number;
};

/**
 * What a ballot will accept, discriminated by kind.
 *
 * A vote carries its authored options (or `null` for a free-form subject, which
 * the engine also allows); an auction carries a bid range. Nested as a union so a
 * vote structurally cannot carry a bid ceiling and an auction structurally cannot
 * carry an option list — and neither can carry a tally.
 */
export type BallotCastOptions =
  | {
      readonly kind: "vote";
      /** `null` = any non-empty string is a legal cast for this subject. */
      readonly options: readonly string[] | null;
    }
  | {
      readonly kind: "auction";
      /** A bid of zero is always legal and always means "pass". */
      readonly minBid: number;
      /** The *actor's own* spendable money, capped at the transport ceiling. */
      readonly maxBid: number;
    };

export type LegalActionSummary =
  | {
      readonly type: "game.start";
      readonly expectedRevision: number;
    }
  | {
      readonly type: "turn.roll";
      readonly expectedRevision: number;
    }
  | {
      readonly type: "prompt.respond";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
      readonly kind: string;
      readonly options: readonly string[];
    }
  | {
      readonly type: "reaction.play";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
      readonly kind: ReactionWindowKind;
      /** The actor's own reaction-timed cards, as opaque ids. */
      readonly cardIds: readonly PlayableCardId[];
      readonly abilityIds: readonly string[];
    }
  | {
      readonly type: "reaction.pass";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
      readonly kind: ReactionWindowKind;
    }
  | {
      /**
       * Carries the decision point and nothing else *on purpose*: the audience of
       * a promotion-block window is every seat but the promotee, precisely so the
       * offer itself says nothing about who actually holds `role.management`.
       */
      readonly type: "management.block-promotion";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
    }
  | {
      readonly type: "ballot.cast";
      readonly expectedRevision: number;
      readonly ballotId: string;
      readonly subjectId: string;
      /** Sealed ballots show no running total to anybody, including the caster. */
      readonly sealed: boolean;
      readonly ballot: BallotCastOptions;
    }
  | {
      readonly type: "agreement.respond";
      readonly expectedRevision: number;
      readonly agreementId: string;
      readonly proposerId: string;
      /** What the proposer hands over. Visible because the actor is a party. */
      readonly give: readonly TradeItem[];
      /** What the proposer asks for. */
      readonly receive: readonly TradeItem[];
      readonly expiresAtRound: number;
    }
  | {
      readonly type: "agreement.offer";
      readonly expectedRevision: number;
      /** Seats that could receive an offer. Public information already. */
      readonly recipientIds: readonly string[];
      /** Item kinds this mode allows — `promise` only when promises are recorded. */
      readonly itemKinds: readonly TradeItemKind[];
      readonly maxRecipients: number;
      readonly maxItemsPerSide: number;
      readonly promiseTextMaxLength: number;
    }
  | {
      readonly type: "turn.adjust-roll";
      readonly expectedRevision: number;
      /** Negative bound of the pip range. Zero is never submittable. */
      readonly minPips: number;
      readonly maxPips: number;
      readonly energyPerPip: number;
      /** How many pips the actor's *current* energy actually buys. */
      readonly affordablePips: number;
    }
  | {
      readonly type: "turn.action";
      readonly expectedRevision: number;
      readonly actions: readonly string[];
      readonly remaining: number;
    }
  | {
      readonly type: "turn.play-card";
      readonly expectedRevision: number;
      readonly cardIds: readonly PlayableCardId[];
    }
  | {
      readonly type: "turn.spend-token";
      readonly expectedRevision: number;
      readonly tokens: readonly SpendableTokenSummary[];
    }
  | {
      readonly type: "turn.activate-character";
      readonly expectedRevision: number;
      readonly abilityId: string;
    }
  | {
      readonly type: "promotion.attempt";
      readonly expectedRevision: number;
      readonly toRankId: string;
      readonly cost: number;
      /** True once this player has declined this rank; attempting again is legal. */
      readonly declined: boolean;
    }
  | {
      readonly type: "promotion.decline";
      readonly expectedRevision: number;
    }
  | {
      readonly type: "audit.pay-fine";
      readonly expectedRevision: number;
    }
  | {
      readonly type: "management.shuffle-deck";
      readonly expectedRevision: number;
      readonly deckIds: readonly string[];
    }
  | {
      readonly type: "tile.claim";
      readonly expectedRevision: number;
      readonly tileId: string;
      readonly cost: number;
    }
  | {
      readonly type: "tile.upgrade";
      readonly expectedRevision: number;
      readonly tileId: string;
      /** The level this upgrade buys, not the level held now. */
      readonly level: number;
      readonly cost: number;
    }
  | {
      readonly type: "placement.place";
      readonly expectedRevision: number;
      readonly kinds: readonly PlaceableSummary[];
    }
  | {
      readonly type: "project.start";
      readonly expectedRevision: number;
      readonly definitionIds: readonly string[];
    }
  | {
      readonly type: "project.contribute";
      readonly expectedRevision: number;
      readonly projectIds: readonly string[];
      /** Money plus work must reach this; contributing nothing is refused. */
      readonly minTotal: number;
      /** The actor's own spendable money, capped at the transport ceiling. */
      readonly maxMoney: number;
      /** The actor's own work counter, capped at the transport ceiling. */
      readonly maxWork: number;
    }
  | {
      readonly type: "project.sabotage";
      readonly expectedRevision: number;
      readonly projectIds: readonly string[];
      /** Sabotage costs work one for one, so this is the actor's own work. */
      readonly maxAmount: number;
      /** Heat this will add to the actor. Zero when the mode has heat off. */
      readonly heatCost: number;
    }
  | {
      readonly type: "attack.target";
      readonly expectedRevision: number;
      readonly targetPlayerIds: readonly string[];
      readonly vectors: readonly string[];
      /** Heat this will add to the *actor*. Never anything about the target. */
      readonly heatCost: number;
    }
  | {
      readonly type: "loan.take";
      readonly expectedRevision: number;
      readonly maxPrincipal: number;
      readonly interestBasisPoints: number;
    }
  | {
      readonly type: "loan.repay";
      readonly expectedRevision: number;
      readonly loans: readonly RepayableLoanSummary[];
      /** The actor's own spendable money: no repayment can exceed it. */
      readonly maxAmount: number;
    };

export type LegalActionSummaryType = LegalActionSummary["type"];

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Compile-time proof that this union covers every player command and names no
 * command a player may not submit.
 *
 * If the two sets diverge the alias below resolves to `false` and this assignment
 * stops compiling. That is the whole guarantee: a new command added to
 * `PLAYER_COMMAND_TYPES` cannot ship with a parser and a route but no way for the
 * UI to learn it is legal, and `window.expire` cannot be advertised because it is
 * not a player command in the first place.
 */
export const LEGAL_ACTIONS_COVER_EVERY_PLAYER_COMMAND: Equals<
  LegalActionSummaryType,
  PlayerCommandType
> = true;

// ---------------------------------------------------------------------------
// The enumerator's own shape, declared structurally
// ---------------------------------------------------------------------------

/**
 * The shape `@office-ladder/engine`'s `enumerateLegalActions` returns.
 *
 * Declared structurally rather than imported so this package keeps its
 * zero-dependency boundary — contracts is the thing the engine, the server and the
 * browser all agree on, and it cannot depend on any of them. The engine's
 * `LegalAction` is assignable to this union; its `gameId` and `actorId` are
 * absent here deliberately, so {@link toLegalActionSummary} has no way to copy
 * them into a payload even by accident.
 *
 * If the engine grows a twenty-eighth action, the server's call site stops
 * compiling — which is the correct failure. Silent divergence is what produced a
 * three-member union in front of a twenty-seven-member enumerator.
 */
export type EnumeratedLegalAction =
  | { readonly type: "game.start"; readonly expectedRevision: number }
  | { readonly type: "turn.roll"; readonly expectedRevision: number }
  | {
      readonly type: "prompt.respond";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
      readonly kind: string;
      readonly options: readonly string[];
    }
  | {
      readonly type: "reaction.play";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
      readonly kind: ReactionWindowKind;
      readonly cardIds: readonly string[];
      readonly abilityIds: readonly string[];
    }
  | {
      readonly type: "reaction.pass";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
      readonly kind: ReactionWindowKind;
    }
  | {
      readonly type: "management.block-promotion";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
    }
  | {
      readonly type: "ballot.cast";
      readonly expectedRevision: number;
      readonly ballotId: string;
      readonly kind: BallotKind;
      readonly subjectId: string;
    }
  | {
      readonly type: "agreement.respond";
      readonly expectedRevision: number;
      readonly agreementId: string;
      readonly proposerId: string;
    }
  | { readonly type: "agreement.offer"; readonly expectedRevision: number }
  | {
      readonly type: "turn.adjust-roll";
      readonly expectedRevision: number;
      readonly maxPips: number;
      readonly energyPerPip: number;
    }
  | {
      readonly type: "turn.action";
      readonly expectedRevision: number;
      readonly actions: readonly string[];
      readonly remaining: number;
    }
  | {
      readonly type: "turn.play-card";
      readonly expectedRevision: number;
      readonly cardIds: readonly string[];
    }
  | {
      readonly type: "turn.spend-token";
      readonly expectedRevision: number;
      readonly tokens: readonly {
        readonly tokenId: string;
        readonly use: string;
        readonly maxQuantity: number;
      }[];
    }
  | {
      readonly type: "turn.activate-character";
      readonly expectedRevision: number;
      readonly abilityId: string;
    }
  | {
      readonly type: "promotion.attempt";
      readonly expectedRevision: number;
      readonly toRankId: string;
      readonly cost: number;
      readonly declined: boolean;
    }
  | { readonly type: "promotion.decline"; readonly expectedRevision: number }
  | { readonly type: "audit.pay-fine"; readonly expectedRevision: number }
  | {
      readonly type: "management.shuffle-deck";
      readonly expectedRevision: number;
      readonly deckIds: readonly string[];
    }
  | {
      readonly type: "tile.claim";
      readonly expectedRevision: number;
      readonly tileId: string;
      readonly cost: number;
    }
  | {
      readonly type: "tile.upgrade";
      readonly expectedRevision: number;
      readonly tileId: string;
      readonly level: number;
      readonly cost: number;
    }
  | {
      readonly type: "placement.place";
      readonly expectedRevision: number;
      readonly kinds: readonly { readonly kind: PlacementKind; readonly cost: number }[];
    }
  | {
      readonly type: "project.start";
      readonly expectedRevision: number;
      readonly definitionIds: readonly string[];
    }
  | {
      readonly type: "project.contribute";
      readonly expectedRevision: number;
      readonly projectIds: readonly string[];
    }
  | {
      readonly type: "project.sabotage";
      readonly expectedRevision: number;
      readonly projectIds: readonly string[];
    }
  | {
      readonly type: "attack.target";
      readonly expectedRevision: number;
      readonly targetPlayerIds: readonly string[];
      readonly vectors: readonly string[];
    }
  | { readonly type: "loan.take"; readonly expectedRevision: number; readonly capacity: number }
  | {
      readonly type: "loan.repay";
      readonly expectedRevision: number;
      readonly loans: readonly { readonly loanId: string; readonly outstanding: number }[];
    };

// ---------------------------------------------------------------------------
// Context — the actor's own facts, and the ruleset in force
// ---------------------------------------------------------------------------

/**
 * What the actor can spend right now.
 *
 * Every field is the *actor's own* balance, which is why passing it here cannot
 * leak: it is already on their `PublicPlayerProjection`, and the actions priced
 * from it are actions only they can take. There is no field for anybody else's
 * balances and there must never be one.
 */
export type LegalActionSpendable = {
  readonly money: number;
  readonly energy: number;
  /** The `resource.work-counter` value — what `project.sabotage` spends. */
  readonly work: number;
};

/**
 * What a ballot will accept, for the ballots this actor may cast in.
 *
 * Note what is *not* here: no `castBy`, no count, no resolution. A ballot's
 * in-flight state has no route into a legal action, so no amount of carelessness
 * downstream can put one there.
 */
export type LegalActionBallotTerms = {
  readonly ballotId: string;
  readonly sealed: boolean;
  /** Authored vote options, or `null` for a free-form subject. Auctions: ignored. */
  readonly options: readonly string[] | null;
  /** `subject.minBid` for an auction, or `null`. Votes: ignored. */
  readonly minBid: number | null;
};

/**
 * The terms of an offer this actor has been made.
 *
 * Only ever built for agreements the actor is a recipient of — which is exactly
 * the set the engine enumerates `agreement.respond` for — so a `parties-only`
 * deal cannot reach a non-party through this route.
 */
export type LegalActionAgreementTerms = {
  readonly agreementId: string;
  readonly give: readonly TradeItem[];
  readonly receive: readonly TradeItem[];
  readonly expiresAtRound: number;
};

/**
 * Everything {@link toLegalActionSummary} needs beyond the action itself.
 *
 * All of it is either public (the ruleset snapshot, the other seats) or the
 * actor's own (their balances, the terms of offers made *to them*, the ballots
 * they may cast in). There is deliberately no route in this type for another
 * player's hand, objectives, hidden placements, or in-flight votes.
 */
export type LegalActionContext = {
  /** The ruleset snapshotted into the match at `game.start` (§5.9). */
  readonly rules: ModeRules;
  readonly spendable: LegalActionSpendable;
  /** Ballots this actor may cast in. A missing entry is treated as sealed. */
  readonly ballots: readonly LegalActionBallotTerms[];
  /** Offers awaiting this actor. A missing entry yields empty terms, never a guess. */
  readonly agreements: readonly LegalActionAgreementTerms[];
  /** Seats other than the actor's, for addressing an offer. Public information. */
  readonly otherPlayerIds: readonly string[];
};

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

/**
 * A finite, whole, non-negative number, or `minimum` when the input is neither.
 *
 * Every number below goes through this or one of its callers. A `NaN` energy
 * balance or an `Infinity` cost is not a display bug — an advertised ceiling of
 * `Infinity` is a ceiling the client will offer to submit, and the parser in
 * `commands.ts` will then refuse the request the UI told the player was legal.
 */
function clampInteger(value: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return minimum;

  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

/** A displayed figure: normalised, but never capped — a cap would misstate a price. */
function displayAmount(value: number): number {
  return clampInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

/** A submittable money ceiling: never above what `parseMoney` would accept. */
function clampMoney(value: number): number {
  return clampInteger(value, 0, MAX_MONEY_AMOUNT);
}

/** A submittable work ceiling: never above what the work parsers would accept. */
function clampWork(value: number): number {
  return clampInteger(value, 0, MAX_WORK_AMOUNT);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function heatCostOf(rules: ModeRules): number {
  // Mirrors `raiseHeat` exactly — floor, clamped at zero, and nothing at all when
  // the mode has heat switched off. A second copy of this arithmetic that
  // disagreed with the engine's would be a UI that lies about a price.
  return rules.conflict.heatEnabled ? clampInteger(rules.conflict.heatPerAttack, 0, 100) : 0;
}

function ballotTermsFor(
  context: LegalActionContext,
  ballotId: string,
): LegalActionBallotTerms {
  const found = context.ballots.find((candidate) => candidate.ballotId === ballotId);

  // Sealed is the safe direction to be wrong in: a ballot the caller forgot to
  // describe renders without a tally rather than with somebody else's votes.
  return found ?? { ballotId, sealed: true, options: null, minBid: null };
}

function ballotOptionsFor(
  action: Extract<EnumeratedLegalAction, { readonly type: "ballot.cast" }>,
  context: LegalActionContext,
  terms: LegalActionBallotTerms,
): BallotCastOptions {
  if (action.kind === "vote") {
    const options = terms.options;

    return {
      kind: "vote",
      options: options === null || options.length === 0 ? null : [...options],
    };
  }

  return {
    kind: "auction",
    minBid: clampMoney(terms.minBid ?? 0),
    maxBid: clampMoney(context.spendable.money),
  };
}

function agreementTermsFor(
  context: LegalActionContext,
  agreementId: string,
): LegalActionAgreementTerms {
  const found = context.agreements.find(
    (candidate) => candidate.agreementId === agreementId,
  );

  // Empty terms rather than invented ones: a client that shows an offer with no
  // clauses is a client that will not have its player accept blind.
  return found ?? { agreementId, give: [], receive: [], expiresAtRound: 0 };
}

function offerableItemKinds(rules: ModeRules): readonly TradeItemKind[] {
  return TRADE_ITEM_KINDS.filter(
    (kind) => kind !== "promise" || rules.interaction.promisesRecorded,
  );
}

/**
 * Narrows one enumerated action to what may cross the transport.
 *
 * Answers `null` for an action whose option set is empty once the mode's own
 * limits are applied — an `attack.target` with no reachable seat, a
 * `turn.adjust-roll` in a mode whose `maxPipAdjust` is zero. That is not this
 * module second-guessing legality (which stays the engine's job and is re-checked
 * by every transition); it is declining to advertise a control with nothing behind
 * it, which the client would render as an enabled button that cannot be pressed.
 */
export function toLegalActionSummary(
  action: EnumeratedLegalAction,
  context: LegalActionContext,
): LegalActionSummary | null {
  const { rules, spendable } = context;
  const expectedRevision = action.expectedRevision;

  switch (action.type) {
    case "game.start":
    case "turn.roll":
    case "promotion.decline":
    case "audit.pay-fine":
      return { type: action.type, expectedRevision };

    case "prompt.respond":
      return {
        type: "prompt.respond",
        expectedRevision,
        decisionPointId: action.decisionPointId,
        kind: action.kind,
        options: [...action.options],
      };

    case "reaction.play":
      return {
        type: "reaction.play",
        expectedRevision,
        decisionPointId: action.decisionPointId,
        kind: action.kind,
        cardIds: [...action.cardIds],
        abilityIds: [...action.abilityIds],
      };

    case "reaction.pass":
      return {
        type: "reaction.pass",
        expectedRevision,
        decisionPointId: action.decisionPointId,
        kind: action.kind,
      };

    case "management.block-promotion":
      return {
        type: "management.block-promotion",
        expectedRevision,
        decisionPointId: action.decisionPointId,
      };

    case "ballot.cast": {
      const terms = ballotTermsFor(context, action.ballotId);

      return {
        type: "ballot.cast",
        expectedRevision,
        ballotId: action.ballotId,
        subjectId: action.subjectId,
        sealed: terms.sealed,
        ballot: ballotOptionsFor(action, context, terms),
      };
    }

    case "agreement.respond": {
      const terms = agreementTermsFor(context, action.agreementId);

      return {
        type: "agreement.respond",
        expectedRevision,
        agreementId: action.agreementId,
        proposerId: action.proposerId,
        give: [...terms.give],
        receive: [...terms.receive],
        expiresAtRound: displayAmount(terms.expiresAtRound),
      };
    }

    case "agreement.offer": {
      const recipientIds = [...context.otherPlayerIds];
      if (recipientIds.length === 0) return null;

      return {
        type: "agreement.offer",
        expectedRevision,
        recipientIds,
        itemKinds: offerableItemKinds(rules),
        maxRecipients: Math.min(recipientIds.length, MAX_AGREEMENT_RECIPIENTS),
        maxItemsPerSide: MAX_TRADE_ITEMS,
        promiseTextMaxLength: PROMISE_TEXT_MAX_LENGTH,
      };
    }

    case "turn.adjust-roll": {
      // Three ceilings, and the tightest wins: what the enumerator offered, what
      // this mode allows, and what the parser will accept.
      const maxPips = Math.min(
        clampInteger(action.maxPips, 0, MAX_PIP_ADJUST),
        clampInteger(rules.agency.maxPipAdjust, 0, MAX_PIP_ADJUST),
      );
      if (maxPips === 0) return null;
      const energyPerPip = clampInteger(action.energyPerPip, 0, MAX_MONEY_AMOUNT);
      const affordablePips =
        energyPerPip === 0
          ? maxPips
          : Math.min(maxPips, Math.floor(clampMoney(spendable.energy) / energyPerPip));

      return {
        type: "turn.adjust-roll",
        expectedRevision,
        minPips: -maxPips,
        maxPips,
        energyPerPip,
        affordablePips: Math.max(0, affordablePips),
      };
    }

    case "turn.action": {
      const actions = [...action.actions];
      if (actions.length === 0) return null;

      return {
        type: "turn.action",
        expectedRevision,
        actions,
        remaining: displayAmount(action.remaining),
      };
    }

    case "turn.play-card": {
      const cardIds = [...action.cardIds];
      if (cardIds.length === 0) return null;

      return { type: "turn.play-card", expectedRevision, cardIds };
    }

    case "turn.spend-token": {
      const tokens = action.tokens.map((token) => ({
        tokenId: token.tokenId,
        use: token.use,
        maxQuantity: clampInteger(token.maxQuantity, 0, MAX_TOKEN_QUANTITY),
      }));
      if (tokens.length === 0) return null;

      return { type: "turn.spend-token", expectedRevision, tokens };
    }

    case "turn.activate-character":
      return {
        type: "turn.activate-character",
        expectedRevision,
        abilityId: action.abilityId,
      };

    case "promotion.attempt":
      return {
        type: "promotion.attempt",
        expectedRevision,
        toRankId: action.toRankId,
        cost: displayAmount(action.cost),
        declined: action.declined,
      };

    case "management.shuffle-deck": {
      const deckIds = [...action.deckIds];
      if (deckIds.length === 0) return null;

      return { type: "management.shuffle-deck", expectedRevision, deckIds };
    }

    case "tile.claim":
      return {
        type: "tile.claim",
        expectedRevision,
        tileId: action.tileId,
        cost: displayAmount(action.cost),
      };

    case "tile.upgrade":
      return {
        type: "tile.upgrade",
        expectedRevision,
        tileId: action.tileId,
        level: displayAmount(action.level),
        cost: displayAmount(action.cost),
      };

    case "placement.place": {
      const kinds = action.kinds.map((entry) => ({
        kind: entry.kind,
        cost: displayAmount(entry.cost),
      }));
      if (kinds.length === 0) return null;

      return { type: "placement.place", expectedRevision, kinds };
    }

    case "project.start": {
      const definitionIds = [...action.definitionIds];
      if (definitionIds.length === 0) return null;

      return { type: "project.start", expectedRevision, definitionIds };
    }

    case "project.contribute": {
      const projectIds = [...action.projectIds];
      if (projectIds.length === 0) return null;

      return {
        type: "project.contribute",
        expectedRevision,
        projectIds,
        // Mirrors `parseContributeToProjectRequest`: money and work may each be
        // zero, but not both — a zero contribution buys a share of the payout.
        minTotal: 1,
        maxMoney: clampMoney(spendable.money),
        maxWork: clampWork(spendable.work),
      };
    }

    case "project.sabotage": {
      const projectIds = [...action.projectIds];
      if (projectIds.length === 0) return null;

      return {
        type: "project.sabotage",
        expectedRevision,
        projectIds,
        maxAmount: clampWork(spendable.work),
        heatCost: heatCostOf(rules),
      };
    }

    case "attack.target": {
      const targetPlayerIds = [...action.targetPlayerIds];
      const vectors = [...action.vectors];
      if (targetPlayerIds.length === 0 || vectors.length === 0) return null;

      return {
        type: "attack.target",
        expectedRevision,
        targetPlayerIds,
        vectors,
        heatCost: heatCostOf(rules),
      };
    }

    case "loan.take": {
      const maxPrincipal = Math.min(
        clampMoney(action.capacity),
        clampMoney(rules.economy.maxLoanPrincipal),
      );
      if (maxPrincipal === 0) return null;

      return {
        type: "loan.take",
        expectedRevision,
        maxPrincipal,
        interestBasisPoints: displayAmount(rules.economy.interestBasisPoints),
      };
    }

    case "loan.repay": {
      const loans = action.loans.map((loan) => ({
        loanId: loan.loanId,
        outstanding: clampMoney(loan.outstanding),
      }));
      if (loans.length === 0) return null;

      return {
        type: "loan.repay",
        expectedRevision,
        loans,
        maxAmount: clampMoney(spendable.money),
      };
    }

    default:
      // Unreachable for a well-typed caller: the switch is exhaustive over
      // `EnumeratedLegalAction`, so an engine that grows a new action breaks the
      // call site rather than reaching here. Answering `null` rather than throwing
      // means a build skew degrades to one missing control, not a failed bootstrap.
      return null;
  }
}

/**
 * Maps a whole enumeration, dropping the actions that have nothing behind them.
 *
 * The one call the server should make: it is the only place the per-action
 * redaction decisions above are applied, so a route that maps legal actions by
 * hand is a route that will eventually forget one.
 */
export function toLegalActionSummaries(
  actions: readonly EnumeratedLegalAction[],
  context: LegalActionContext,
): readonly LegalActionSummary[] {
  const summaries: LegalActionSummary[] = [];
  for (const action of actions) {
    const summary = toLegalActionSummary(action, context);
    if (summary !== null) summaries.push(summary);
  }

  return summaries;
}
