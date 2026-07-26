import type { BotDifficulty } from "@office-ladder/contracts";
import type { LegalAction, PlacementKind, PlayerId } from "@office-ladder/engine";
import {
  AUDIT_PAY_FINE_OPTION_ID,
  AUDIT_RELEASE_FINE,
  botAffordable,
  botCanAffordCommand,
  type BotTableView,
} from "./bot-view";

/**
 * Re-exported from bot-view.ts, where it now lives beside the pricing that
 * needs it. Callers (and the policy's own tests) keep importing it from here.
 */
export { AUDIT_RELEASE_FINE } from "./bot-view";

/**
 * What a bot does next, for every verb the game has.
 *
 * The game had one mutating command when the previous version of this file was
 * written and the comment at the top said so. It now has twenty-eight, most of
 * which can land on a player who is not the actor, so the shape of the problem
 * changed rather than its size: the question is no longer "roll or answer the
 * prompt" but "of the things I may legally do right now, which one".
 *
 * Three properties this file keeps, in priority order:
 *
 * 1. **It never invents an action, and it never offers more than it holds.**
 *    Everything it returns was found in the `legalActions` list it was handed,
 *    with the ids and bounds that list carried. The enumerator is conservative
 *    by design; a policy that guessed would produce commands the engine then
 *    rejects, and a rejection is not a wasted turn — it stops the whole drain,
 *    which stalls the match for every seat including the humans. The second
 *    half of that sentence is now enforced rather than trusted: {@link decide}
 *    is the only constructor of a decision and it prices the command through
 *    bot-view.ts's `priceBotCommand` before returning it, answering `null` when
 *    the bot cannot pay. See that module's header for why affordability lives
 *    in one exhaustive switch instead of one hand-written check per branch.
 * 2. **Every rung terminates.** The driver applies one command and re-reads, so
 *    a rung that stays available after it fires is an infinite drain. Each rule
 *    below either consumes the thing that offered it (a ballot, an offer, a free
 *    action, a promotion) or spends a resource that strictly decreases.
 * 3. **It is legible.** A watching human should be able to say what the bot is
 *    doing and why. That is worth more here than playing well — these are seat
 *    fillers, and a bot whose reasoning cannot be narrated is indistinguishable
 *    from a bot that is broken.
 *
 * Pure: no clock, no I/O, no `Math.random`. The same view and the same action
 * list always produce the same decision, which is what makes a bot-only match
 * reproducible.
 */

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

/**
 * The command body a decision names, minus the envelope the driver owns
 * (`commandId`, `gameId`, `actorId`, `expectedRevision`).
 *
 * Spelled out here rather than derived from the engine's `GameCommand` union so
 * that the three server-injected types (`window.expire`, `quarter.advance`,
 * `turn.timeout`) are *unrepresentable* in a bot decision. §7.1 makes those the
 * server-as-clock's alone; a bot is a seat, not the clock, and the cheapest
 * guarantee that it can never submit one is that there is no value it could
 * return that would say so. `game.start` is absent for the same kind of reason:
 * starting a match is the host's, and a bot is never the host.
 */
export type BotCommandBody =
  | { readonly type: "turn.roll"; readonly payload: Record<string, never> }
  | {
      readonly type: "prompt.respond";
      readonly decisionPointId: string;
      readonly payload: { readonly optionId: string; readonly value: null };
    }
  | {
      readonly type: "reaction.play";
      readonly decisionPointId: string;
      readonly payload: {
        readonly cardId: string | null;
        readonly abilityId: string | null;
        readonly targetPlayerIds: readonly PlayerId[];
        readonly choice: null;
      };
    }
  | {
      readonly type: "reaction.pass";
      readonly decisionPointId: string;
      readonly payload: Record<string, never>;
    }
  | {
      readonly type: "management.block-promotion";
      readonly decisionPointId: string;
      readonly payload: Record<string, never>;
    }
  | {
      readonly type: "ballot.cast";
      readonly payload: { readonly ballotId: string; readonly value: string | number };
    }
  | {
      readonly type: "agreement.respond";
      readonly payload: { readonly agreementId: string; readonly accept: boolean };
    }
  | { readonly type: "audit.pay-fine"; readonly payload: Record<string, never> }
  | { readonly type: "promotion.attempt"; readonly payload: Record<string, never> }
  | { readonly type: "promotion.decline"; readonly payload: Record<string, never> }
  | { readonly type: "loan.take"; readonly payload: { readonly principal: number } }
  | {
      readonly type: "loan.repay";
      readonly payload: { readonly loanId: string; readonly amount: number };
    }
  | {
      readonly type: "turn.action";
      readonly payload: {
        readonly action: string;
        readonly targetPlayerIds: readonly PlayerId[];
        readonly choice: null;
      };
    }
  | { readonly type: "turn.adjust-roll"; readonly payload: { readonly pips: number } }
  | {
      readonly type: "turn.play-card";
      readonly payload: {
        readonly cardId: string;
        readonly targetPlayerIds: readonly PlayerId[];
        readonly choice: null;
      };
    }
  | {
      readonly type: "turn.spend-token";
      readonly payload: {
        readonly tokenId: string;
        readonly quantity: number;
        readonly use: string;
      };
    }
  | {
      readonly type: "turn.activate-character";
      readonly payload: {
        readonly abilityId: string;
        readonly targetPlayerIds: readonly PlayerId[];
        readonly choice: null;
      };
    }
  | { readonly type: "tile.claim"; readonly payload: { readonly tileId: string } }
  | { readonly type: "tile.upgrade"; readonly payload: { readonly tileId: string } }
  | {
      readonly type: "placement.place";
      readonly payload: { readonly kind: PlacementKind; readonly tileId: string };
    }
  | {
      readonly type: "project.start";
      readonly payload: {
        readonly definitionId: string;
        readonly tileId: null;
        readonly openToJoin: boolean;
      };
    }
  | {
      readonly type: "project.contribute";
      readonly payload: {
        readonly projectId: string;
        readonly money: number;
        readonly work: number;
      };
    }
  | {
      readonly type: "project.sabotage";
      readonly payload: {
        readonly projectId: string;
        readonly amount: number;
        readonly hidden: boolean;
      };
    }
  | {
      readonly type: "attack.target";
      readonly payload: {
        readonly targetPlayerId: PlayerId;
        readonly vector: string;
        readonly cardId: null;
      };
    };

/**
 * A short, stable slug per decision, used for the deterministic command id and
 * for logs.
 *
 * `roll` and `respond` keep the exact spellings the roll-and-move driver used.
 * They are not cosmetic: the command id is `bot:<gameId>:<revision>:<slug>`, and
 * `contracts`' reserved-prefix guard, the server-actor id test and the
 * already-applied wedge it documents all quote those two strings.
 */
export const BOT_ACTION_SLUGS = {
  "turn.roll": "roll",
  "prompt.respond": "respond",
  "reaction.play": "react",
  "reaction.pass": "pass",
  "management.block-promotion": "block",
  "ballot.cast": "vote",
  "agreement.respond": "trade",
  "audit.pay-fine": "fine",
  "promotion.attempt": "promote",
  "promotion.decline": "hold",
  "loan.take": "borrow",
  "loan.repay": "repay",
  "turn.action": "act",
  "turn.adjust-roll": "adjust",
  "turn.play-card": "card",
  "turn.spend-token": "token",
  "turn.activate-character": "ability",
  "tile.claim": "claim",
  "tile.upgrade": "upgrade",
  "placement.place": "place",
  "project.start": "project",
  "project.contribute": "contribute",
  "project.sabotage": "sabotage",
  "attack.target": "attack",
} as const satisfies Readonly<Record<BotCommandBody["type"], string>>;

export type BotActionSlug = (typeof BOT_ACTION_SLUGS)[keyof typeof BOT_ACTION_SLUGS];

export type BotDecision =
  | { readonly kind: "none" }
  | {
      readonly kind: BotActionSlug;
      readonly command: BotCommandBody;
      readonly expectedRevision: number;
      /**
       * One clause, in the bot's own voice, saying why. Carried through to the
       * driver's log line, so "the bots did something and I could not tell what"
       * has an answer that does not require reading this file.
       */
      readonly why: string;
    };

export type BotDecisionInput = {
  /** Exactly what `enumerateLegalActions(game, botPlayerId)` returned. */
  readonly legalActions: readonly LegalAction[];
  readonly difficulty: BotDifficulty;
  /** The public-plus-own slice of the same state — see bot-view.ts. */
  readonly table: BotTableView;
};

/* ------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------ */

const PAY_FINE = AUDIT_PAY_FINE_OPTION_ID;
const ATTEMPT_ROLL = "attempt-roll";

/**
 * "standard" wants a 2x cushion before spending the fine; "ruthless" pays as
 * soon as it can cover it at all, treating a lost turn as worse than the cash.
 */
const COMFORT_MULTIPLIER: Readonly<Record<BotDifficulty, number>> = {
  easy: Number.POSITIVE_INFINITY,
  standard: 2,
  ruthless: 1,
};

/**
 * Rounds of upkeep a bot insists on still being able to pay *after* taking a
 * promotion.
 *
 * This is the whole reason `agency.promotionIsChoice` exists: climbing raises
 * the standing charge and makes you the biggest target on the board, so taking
 * it is a bet rather than a free upgrade. Four rounds is roughly one lap of the
 * board — long enough that the bot has to have a real income before it commits,
 * short enough that it never sits on a rung it can afford out of pure caution.
 *
 * With upkeep switched off (`economy.upkeepEnabled: false`, which every quick
 * match uses) `upkeepPerRound` is 0 and this reduces to "can I pay for it", which
 * is the correct behaviour for a mode with no standing costs.
 */
const PROMOTION_UPKEEP_RUNWAY_ROUNDS = 4;

/**
 * Money kept back from every discretionary purchase, as a multiple of the
 * purchase price.
 *
 * A bot that spends down to zero on a tile and then cannot pay a toll is not
 * playing badly, it is playing *illegibly*: from the outside it looks like the
 * game took its money. Different multiples per rung reflect how reversible the
 * spend is — a claim is an asset, a placement is a bet, sabotage is a cost.
 */
const RESERVE_MULTIPLIER = {
  claim: 2,
  upgrade: 3,
  placement: 3,
  project: 2,
  contribute: 4,
} as const;

/** Below this share of maximum energy, resting beats every other free action. */
const ENERGY_RESERVE_RATIO = 0.25;

/**
 * Energy a bot refuses to convert into dice pips or into an attack.
 *
 * Energy is the one resource that is *also* the price of acting at all: a free
 * action costs `freeActionEnergyCost`, and so does an attack vector. Spending
 * the lot on `turn.adjust-roll` is perfectly legal and completely stupid — the
 * bot moves two squares further and then cannot work, rest-and-work, or defend
 * itself for the rest of the turn.
 *
 * The reserve is the larger of two floors, because they guard different
 * failures: one whole free action (so the bot can always still *do* something)
 * and {@link ENERGY_RESERVE_RATIO} of its maximum (so a high-energy mode does
 * not let it burn 90% of the bar on pips). Whichever binds, binds.
 */
function energyReserve(table: BotTableView): number {
  return Math.max(
    table.freeActionEnergyCost,
    Math.ceil(table.self.energyMaximum * ENERGY_RESERVE_RATIO),
  );
}

/**
 * Rounds of upkeep a bot borrows to cover. Loans are a bridge, not a strategy:
 * `loanCapacity` already caps the principal, and this keeps the bot from
 * drawing the whole cap the first time it is briefly short.
 */
const LOAN_RUNWAY_ROUNDS = 3;

/** Repay only from genuine surplus — money beyond this many rounds of upkeep. */
const REPAY_SURPLUS_ROUNDS = 6;

/** The share of a sealed auction's affordable range a bot is willing to bid. */
const AUCTION_BID_RATIO = 0.25;

/**
 * How far ahead the leader has to be before a `ruthless` bot spends a turn
 * attacking them. One full rank: below that, aggression is noise that makes the
 * table worse for everybody without changing who is winning.
 */
const ATTACK_RANK_GAP = 1;

/** Heat headroom an aggressive verb insists on leaving. */
const HEAT_HEADROOM = 1;

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

type ActionOfType<Type extends LegalAction["type"]> = Extract<
  LegalAction,
  { readonly type: Type }
>;

function find<Type extends LegalAction["type"]>(
  actions: readonly LegalAction[],
  type: Type,
): ActionOfType<Type> | null {
  for (const action of actions) {
    if (action.type === type) return action as ActionOfType<Type>;
  }
  return null;
}

/**
 * The only constructor of a `BotDecision`, and therefore the only place a bot
 * can commit to spending anything.
 *
 * It answers `null` when the bot cannot pay for the command — and `null` means
 * *this candidate*, not *this turn*. Every branch below is written so that a
 * refusal falls through to the next candidate and, failing that, to the next
 * rung: a bot that skipped its whole turn because it could not afford one
 * option would be a worse bot, not a safer one, and "no decision" is the single
 * loudest thing the driver can report (`bot-cannot-decide` means the match is
 * wedged, because nobody else may act on a bot's turn).
 *
 * The pricing itself is bot-view.ts's, deliberately: one exhaustive switch over
 * the command union, cross-checked against the engine's rejection sites, rather
 * than nineteen guards mirrored by hand across thirteen branches.
 */
function decide(
  table: BotTableView,
  action: LegalAction,
  command: BotCommandBody,
  why: string,
): BotDecision | null {
  if (!botCanAffordCommand(table, action, command)) return null;

  return {
    kind: BOT_ACTION_SLUGS[command.type],
    command,
    expectedRevision: action.expectedRevision,
    why,
  };
}

/**
 * Never trust the preferred option id: the prompt is authoritative about what it
 * will accept, so intersect with it and fall back to the first offered option
 * (which the engine guarantees is legal).
 */
function offeredOption(preferred: string, options: readonly string[]): string | null {
  const match = options.find((option) => option === preferred);
  return match ?? options[0] ?? null;
}

/** Money the bot treats as spendable without going short on standing costs. */
function surplus(table: BotTableView, rounds: number): number {
  return table.self.money - table.self.upkeepPerRound * rounds;
}

function hasHeatHeadroom(table: BotTableView): boolean {
  if (!table.heatEnabled) return true;
  return table.self.heat + HEAT_HEADROOM < table.self.heatThreshold;
}

function rivalOf(table: BotTableView, playerId: PlayerId | null) {
  if (playerId === null) return null;
  return table.rivals.find((rival) => rival.playerId === playerId) ?? null;
}

/* ------------------------------------------------------------------ *
 * Rung 1 — answer what the table is waiting on
 * ------------------------------------------------------------------ */

/**
 * A promotion block, offered only to a seat that actually holds Management.
 *
 * Blocking every promotion is the obvious move and the wrong one: it stalls the
 * whole ladder and, since only Management can block, it also announces the role
 * on the first use. A bot therefore spends its block on the one promotion that
 * changes who is winning — the leader's — and lets everything else through,
 * which is both better play and a much quieter tell.
 *
 * **And it is budgeted.** `blockPromotion` in `execution/promotion-choice.ts`
 * charges `raiseHeat` on every block and takes no other resource, so nothing in
 * the rules stops the same seat blocking the same promotion forever. Two bots —
 * one climbing, one holding Management — did exactly that: `promote`, `block`,
 * `pass`, `promote`, for 9,600 commands across 80 drains without the match
 * advancing a rank. Heat is the price the engine already charges, so heat is the
 * budget: with `heatPerAttack: 1` against a threshold of 3 or 4 a bot gets two
 * or three vetoes and then has to let the ladder move. It is not a resource in
 * {@link BotSpend} — heat is a meter you fill, not a balance you spend — which
 * is why it is checked here rather than priced in `priceBotCommand`, exactly as
 * {@link attack} checks it.
 */
function blockPromotion(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const action = find(actions, "management.block-promotion");
  if (action === null) return null;

  // The window names the promotion, not the promoted player, so "is this the
  // leader" is answered from standings: a block is worth spending only while
  // somebody is at or ahead of this bot's own rank.
  const leader = rivalOf(table, table.leaderId);
  if (leader === null || leader.rankIndex < table.self.rankIndex) return null;
  if (!hasHeatHeadroom(table)) return null;

  return decide(
    table,
    action,
    {
      type: "management.block-promotion",
      decisionPointId: String(action.decisionPointId),
      payload: {},
    },
    "blocking the front-runner's promotion",
  );
}

/**
 * Reaction windows.
 *
 * The rule is *self-defence only*: a bot spends a card or an ability on a window
 * aimed at itself and passes on everybody else's fight. Two reasons. It is the
 * only reading a watching human can follow without seeing the bot's hand, and it
 * is the only one that cannot be farmed — a bot that countered every effect on
 * the table would be a free bodyguard for whoever sat next to it.
 *
 * Passing is never skipped. An unanswered window blocks the *active* player, not
 * just the bot, so a bot that stayed silent would freeze the match until the
 * expiry scheduler fired.
 */
function answerReaction(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const play = find(actions, "reaction.play");
  const pass = find(actions, "reaction.pass");

  const aimedAtSelf =
    play !== null &&
    table.reactionWindows.some(
      (window) =>
        window.decisionPointId === String(play.decisionPointId) && window.aimedAtSelf,
    );

  if (play !== null && aimedAtSelf) {
    const cardId = play.cardIds[0] ?? null;
    const abilityId = cardId === null ? (play.abilityIds[0] ?? null) : null;
    if (cardId !== null || abilityId !== null) {
      const defence = decide(
        table,
        play,
        {
          type: "reaction.play",
          decisionPointId: String(play.decisionPointId),
          payload: {
            cardId,
            abilityId,
            targetPlayerIds: [table.self.playerId],
            choice: null,
          },
        },
        "spending a card to prevent an effect on itself",
      );
      // A defence it cannot pay for still has to close the window: falling
      // through to the pass below is what stops an unanswerable window from
      // blocking the *active* player, who is usually not this bot.
      if (defence !== null) return defence;
    }
  }

  if (pass === null) return null;

  return decide(
    table,
    pass,
    { type: "reaction.pass", decisionPointId: String(pass.decisionPointId), payload: {} },
    "letting the window close",
  );
}

/** "standard" wants a 2x cushion; "ruthless" pays the moment it can cover it. */
function preferredAuditOption(difficulty: BotDifficulty, money: number): string {
  const multiplier = COMFORT_MULTIPLIER[difficulty];
  return money >= AUDIT_RELEASE_FINE * multiplier ? PAY_FINE : ATTEMPT_ROLL;
}

/**
 * The prompt.
 *
 * The preferred option is tried first and every other offered option after it,
 * in the order the prompt listed them. That ordering is the affordability rule
 * for this rung: `pay-fine` costs the authored fine and `attempt-roll` costs
 * nothing, so a bot that has just been priced out of the fine gambles instead
 * of leaving the prompt unanswered — and an unanswered prompt is a turn nobody
 * at the table can take.
 *
 * A prompt whose options are *all* unaffordable answers `null` rather than
 * `none`, so the ladder can still reach `loan.take` (the enumerator offers
 * loans alongside a prompt precisely so affording the fine is possible) and
 * try again on the next drain iteration.
 *
 * Known gap, stated rather than papered over: the tile-decision prompt kind has
 * an `accept` branch with a real cost, and neither `PromptState` nor the legal
 * action carries it, so the bot cannot price that option. It is rejected as
 * ILLEGAL_ACTION rather than INSUFFICIENT_RESOURCE, and only `audit-release` is
 * wired end to end today — but the fix is the same one `project.start` needs:
 * the enumerator should quote the price.
 */
function answerPrompt(input: BotDecisionInput): BotDecision | null {
  const action = find(input.legalActions, "prompt.respond");
  if (action === null) return null;

  const { table } = input;
  const options = action.options.map((option) => String(option));
  const preferred =
    action.kind === "audit-release"
      ? preferredAuditOption(input.difficulty, table.self.money)
      : (options[0] ?? "");
  const first = offeredOption(preferred, options);
  if (first === null) return null;

  const ordered = [first, ...options.filter((option) => option !== first)];
  for (const optionId of ordered) {
    const decision = decide(
      table,
      action,
      {
        type: "prompt.respond",
        decisionPointId: String(action.decisionPointId),
        payload: { optionId, value: null },
      },
      action.kind === "audit-release" && optionId === PAY_FINE
        ? "paying the fine to get back to work"
        : "answering the prompt",
    );
    if (decision !== null) return decision;
  }

  return null;
}

/**
 * Trades.
 *
 * Bots are explicitly not required to be good at negotiation, and pretending
 * otherwise is how a seat filler turns into an exploit: a human who works out
 * what a bot will accept can farm it every round. So the rule is narrow and
 * stated out loud — **accept only an offer that is strictly good on the money,
 * costs no goods, and rests on no promise**. Everything else is declined.
 *
 * `bots.canNegotiate: false` declines everything, which is what that flag is
 * for: `mode.quick` turns trading off for bots entirely.
 */
function answerAgreement(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const action = find(actions, "agreement.respond");
  if (action === null) return null;

  const agreementId = String(action.agreementId);
  const offer = table.agreements.find(
    (candidate) => candidate.agreementId === agreementId,
  );
  const worthTaking =
    table.canNegotiate &&
    offer !== undefined &&
    offer.givesOtherCount === 0 &&
    offer.receivesPromiseCount === 0 &&
    offer.receivesMoney > offer.givesMoney &&
    // Affordability at accept time, not offer time (§7.3): the state the offer
    // was priced against may be several commands old by now. `decide` re-checks
    // it against the same `givesMoney` — this is the taste, that is the veto.
    offer.givesMoney <= botAffordable(table, "money");

  if (worthTaking) {
    const accepted = decide(
      table,
      action,
      { type: "agreement.respond", payload: { agreementId, accept: true } },
      "taking a trade that pays",
    );
    if (accepted !== null) return accepted;
  }

  // Declining is free and always available, so this cannot fail. It must not:
  // an offer left hanging is a proposer stuck waiting on a bot.
  return decide(
    table,
    action,
    { type: "agreement.respond", payload: { agreementId, accept: false } },
    "declining the offer",
  );
}

/**
 * Ballots — votes and auction bids share one command and need two rules.
 *
 * A **vote** goes to the bot itself when it is a candidate, and otherwise to the
 * lowest-ranked candidate. Voting for the person doing worst is not altruism: a
 * ballot the leader wins is a ballot that ends the game sooner, and a table of
 * bots that all piled onto the front-runner would decide every vote before the
 * humans had a say.
 *
 * A **bid** is a quarter of what the bot can spare, rounded down and floored at
 * zero. Sealed auctions are the one place a bot could accidentally hand its
 * whole balance to the house, so the bid is bounded by surplus rather than by
 * balance, and a bot with no surplus bids 0 rather than skipping the ballot —
 * an unanswered ballot is dead time for everyone waiting on it.
 */
function castBallot(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const action = find(actions, "ballot.cast");
  if (action === null) return null;

  const ballot = table.ballots.find(
    (candidate) => candidate.ballotId === String(action.ballotId),
  );

  if (action.kind === "auction") {
    const affordable = Math.max(0, surplus(table, LOAN_RUNWAY_ROUNDS));
    // Bounded by surplus *and* by the balance itself: the engine checks a bid
    // against spendable money the moment it is cast, and `surplus` can exceed
    // the balance only if upkeep were negative — clamping is cheaper than
    // reasoning about whether it can.
    const bid = Math.min(
      Math.max(0, Math.floor(affordable * AUCTION_BID_RATIO)),
      botAffordable(table, "money"),
    );
    const decision = decide(
      table,
      action,
      { type: "ballot.cast", payload: { ballotId: String(action.ballotId), value: bid } },
      bid > 0 ? "bidding a quarter of what it can spare" : "sitting the auction out at zero",
    );
    // A zero bid is free and always legal, so the fallback below cannot itself
    // be refused — and answering at zero beats leaving the ballot open.
    return (
      decision ??
      decide(
        table,
        action,
        { type: "ballot.cast", payload: { ballotId: String(action.ballotId), value: 0 } },
        "sitting the auction out at zero",
      )
    );
  }

  const candidates = ballot?.candidateIds ?? [];
  const own = candidates.find((playerId) => playerId === table.self.playerId);
  const underdog = [...candidates]
    .filter((playerId) => playerId !== table.self.playerId)
    .map((playerId) => rivalOf(table, playerId))
    .filter((rival): rival is NonNullable<typeof rival> => rival !== null)
    .sort(
      (left, right) =>
        left.rankIndex - right.rankIndex ||
        left.money - right.money ||
        String(left.playerId).localeCompare(String(right.playerId)),
    )[0];
  const value = own ?? underdog?.playerId ?? candidates[0] ?? table.self.playerId;

  return decide(
    table,
    action,
    {
      type: "ballot.cast",
      payload: { ballotId: String(action.ballotId), value: String(value) },
    },
    own === undefined ? "voting for whoever is furthest behind" : "voting for itself",
  );
}

/* ------------------------------------------------------------------ *
 * Rung 2 — stay solvent
 * ------------------------------------------------------------------ */

function manageDebt(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const take = find(actions, "loan.take");
  if (take !== null && table.self.upkeepPerRound > 0) {
    const runway = table.self.upkeepPerRound * LOAN_RUNWAY_ROUNDS;
    if (table.self.money < runway) {
      // Borrow the shortfall, never the whole cap: a bot that maxes its credit
      // the first time it is briefly short spends the rest of the match paying
      // interest on money it did not need.
      const principal = Math.min(take.capacity, Math.max(1, runway - table.self.money));
      const borrowed = decide(
        table,
        take,
        { type: "loan.take", payload: { principal } },
        "borrowing enough to cover the next few rounds",
      );
      if (borrowed !== null) return borrowed;
    }
  }

  const repay = find(actions, "loan.repay");
  if (repay !== null) {
    // Three ceilings on a repayment, and the engine enforces two of them
    // separately: it rejects an amount above the loan's outstanding balance as
    // ILLEGAL_ACTION and an amount above spendable money as
    // INSUFFICIENT_RESOURCE. `surplus` is the third and is only taste — the bot
    // repaying itself into a position where it cannot pay a toll is legible as
    // a malfunction even though the engine would allow it.
    const spare = Math.floor(surplus(table, REPAY_SURPLUS_ROUNDS));
    const payable = Math.min(spare, botAffordable(table, "money"));
    // Every loan, not just the first: a loan whose balance the bot cannot cover
    // must not hide a smaller one it can clear.
    for (const loan of repay.loans) {
      const amount = Math.min(loan.outstanding, payable);
      if (amount <= 0) continue;
      const decision = decide(
        table,
        repay,
        { type: "loan.repay", payload: { loanId: String(loan.loanId), amount } },
        "clearing debt out of surplus",
      );
      if (decision !== null) return decision;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Rung 3 — get out of trouble
 * ------------------------------------------------------------------ */

function leaveAudit(input: BotDecisionInput): BotDecision | null {
  const action = find(input.legalActions, "audit.pay-fine");
  if (action === null) return null;

  const multiplier = COMFORT_MULTIPLIER[input.difficulty];
  if (input.table.self.money < AUDIT_RELEASE_FINE * multiplier) return null;

  return decide(
    input.table,
    action,
    { type: "audit.pay-fine", payload: {} },
    "paying the fine to get back to work",
  );
}

/* ------------------------------------------------------------------ *
 * Rung 4 — the climb
 * ------------------------------------------------------------------ */

/**
 * **The rung the whole feature turned on.**
 *
 * Every shipped preset sets `agency.promotionIsChoice`, so the engine stopped
 * promoting anybody automatically and started waiting for somebody to send
 * `promotion.attempt`. Nothing did. A bot-only match therefore had no way to
 * end at all — three server tests burned four hundred cycles with the match
 * still active, and every mode this project ships was, strictly, unwinnable.
 *
 * The fix is a rule, not a flag. Promotion-as-a-choice is a real bet: the rung
 * costs money *and* raises the standing charge for the rest of the match, and it
 * makes the bot the biggest target on the board. So a bot takes it when it can
 * still cover {@link PROMOTION_UPKEEP_RUNWAY_ROUNDS} rounds of the *new* upkeep
 * afterwards, and declines once otherwise.
 *
 * Declining is deliberate rather than a silent skip. `promotion.decline` writes
 * a status that suppresses the offer until the bot's situation changes, so the
 * next drain does not re-ask the same question and re-decline it forever —
 * which is what "every rung terminates" means here. `offer.declined` is the
 * engine telling us it has already been waved off, and the policy does not
 * touch it again.
 *
 * Difficulty tunes the nerve, not the rule: `ruthless` takes the top rung the
 * moment it is affordable, because the top rung ends the match and no upkeep is
 * ever charged after that.
 */
function climb(input: BotDecisionInput): BotDecision | null {
  const attempt = find(input.legalActions, "promotion.attempt");
  if (attempt === null) return null;

  const { table, difficulty } = input;
  const afterCost = table.self.money - attempt.cost;
  if (afterCost < 0) return null;

  // `upkeepPerRound` is the charge the bot pays *today*; the rung it is buying
  // may raise it. The offer does not carry the new figure, so the runway is
  // measured against the current one plus the same amount again — pessimistic on
  // purpose, since being wrong in the other direction bankrupts the seat.
  const projectedUpkeep = table.self.upkeepPerRound * 2;
  const runway = projectedUpkeep * PROMOTION_UPKEEP_RUNWAY_ROUNDS;
  const isFinalRungBet = difficulty === "ruthless";

  if (isFinalRungBet || afterCost >= runway) {
    const taken = decide(
      table,
      attempt,
      { type: "promotion.attempt", payload: {} },
      `taking the promotion to ${attempt.toRankId}`,
    );
    if (taken !== null) return taken;
  }

  const declineAction = find(input.legalActions, "promotion.decline");
  if (declineAction === null || attempt.declined) return null;

  return decide(
    table,
    declineAction,
    { type: "promotion.decline", payload: {} },
    "waving the rung off — the upkeep would sink it",
  );
}

/* ------------------------------------------------------------------ *
 * Rung 5 — the free action
 * ------------------------------------------------------------------ */

/**
 * `turn.action` — the verb that exists so a turn contains a decision.
 *
 * The rule that matters here is **only choose a verb whose price you can read**.
 * The enumerator advertises `turn.action` on the turn's action budget alone; it
 * does not price the four verbs. A bot that guessed and guessed wrong did not
 * merely waste a decision — the rejection ends the whole drain, so one
 * unaffordable free action cost every remaining bot in the chain its turn. That
 * was measurable: an early version of this ladder produced 112 rejected free
 * actions across a single match and the game never finished.
 *
 * So:
 *
 * - **rest** when energy is low and not already full. Cost-free, and refused
 *   only when already at maximum, which the view can see. Energy gates working,
 *   adjusting the roll and several tile effects, so a bot that runs it to zero
 *   stops being able to do anything at all.
 * - **work** when it can pay the energy. The honest default: spend energy, get
 *   paid.
 * - **rest** again as a top-up when neither of the above applies but energy is
 *   below maximum, because a spare action banked is an action wasted.
 * - **never network**, and this is a deliberate omission rather than an
 *   oversight. Its price is a *content* value — what the next rung charges per
 *   point of reputation, authored per rank and per mode — and neither the legal
 *   action nor `ModeRules` carries it. Reproducing that formula here would put a
 *   second copy of the game's pricing inside a bot, which is exactly the kind of
 *   duplication that goes quietly stale. It becomes available the moment the
 *   enumerator carries its own prices; until then a bot climbs on salary and
 *   tiles.
 * - **never scheme.** It is the aggression verb, it raises heat, and its whole
 *   value is being aimed at somebody. A bot that schemed every turn would make
 *   the table worse for everyone without changing who wins — see {@link attack}
 *   for the one place aggression is allowed, and how hard it is gated.
 */
function takeFreeAction(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const action = find(actions, "turn.action");
  if (action === null || action.remaining <= 0) return null;

  const offered = new Set(action.actions);
  const { energy, energyMaximum } = table.self;
  const canRest = offered.has("rest") && energy < energyMaximum;
  const canWork = offered.has("work") && botAffordable(table, "energy") >= table.freeActionEnergyCost;

  const take = (verb: "rest" | "work", why: string): BotDecision | null =>
    decide(
      table,
      action,
      { type: "turn.action", payload: { action: verb, targetPlayerIds: [], choice: null } },
      why,
    );

  // Each candidate falls through to the next rather than ending the rung, so a
  // verb the bot turns out not to be able to pay for costs it one option, not
  // its whole turn.
  const candidates: readonly (BotDecision | null)[] = [
    canRest && energy <= energyMaximum * ENERGY_RESERVE_RATIO
      ? take("rest", "taking a breather before it runs dry")
      : null,
    canWork ? take("work", "putting in a shift") : null,
    canRest ? take("rest", "topping up before the roll") : null,
  ];

  return candidates.find((candidate) => candidate !== null) ?? null;
}

/* ------------------------------------------------------------------ *
 * Rung 6 — board, projects, placements
 * ------------------------------------------------------------------ */

function investInBoard(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const spendable = botAffordable(table, "money");

  const claim = find(actions, "tile.claim");
  if (claim !== null && spendable >= claim.cost * RESERVE_MULTIPLIER.claim) {
    const claimed = decide(
      table,
      claim,
      { type: "tile.claim", payload: { tileId: String(claim.tileId) } },
      "claiming the tile it is standing on",
    );
    if (claimed !== null) return claimed;
  }

  const upgrade = find(actions, "tile.upgrade");
  if (upgrade !== null && spendable >= upgrade.cost * RESERVE_MULTIPLIER.upgrade) {
    const upgraded = decide(
      table,
      upgrade,
      { type: "tile.upgrade", payload: { tileId: String(upgrade.tileId) } },
      "raising the toll on a tile it already owns",
    );
    if (upgraded !== null) return upgraded;
  }

  const place = find(actions, "placement.place");
  const tileId = claim?.tileId ?? upgrade?.tileId ?? null;
  // One placement per tile, because the engine allows exactly one and the
  // enumerator does not say so: it re-offers `placement.place` while the bot is
  // merely under its per-player cap, and the bot has not moved since the last
  // one. Without this the rung does not terminate — it fires again on the very
  // next drain iteration with the same tile and is rejected as ILLEGAL_ACTION,
  // which stops the drain and stalls the table. An unknown list (a table this
  // module did not build) is treated as "already placed", so the branch is
  // skipped rather than guessed at.
  const alreadyPlacedHere =
    table.ownPlacementTileIds === undefined ||
    (tileId !== null && table.ownPlacementTileIds.includes(String(tileId)));
  if (place !== null && tileId !== null && !alreadyPlacedHere) {
    // Cheapest first: a placement is a bet on where other players will land, and
    // the cheap ones are the ones a bot can be wrong about repeatedly. Walking
    // the whole sorted list rather than taking `[0]` means a kind the reserve
    // prices out no longer hides the next one up — and `decide` re-prices each
    // against the exact `placementCost` the enumerator quoted for it.
    const byPrice = [...place.kinds].sort((left, right) => left.cost - right.cost);
    for (const candidate of byPrice) {
      if (spendable < candidate.cost * RESERVE_MULTIPLIER.placement) continue;
      const placed = decide(
        table,
        place,
        {
          type: "placement.place",
          payload: { kind: candidate.kind, tileId: String(tileId) },
        },
        "leaving something behind on this tile",
      );
      if (placed !== null) return placed;
    }
  }

  return null;
}

/**
 * Projects — start, contribute, sabotage.
 *
 * The contribute-versus-sabotage question is the one the brief singles out, and
 * the answer is a rule about *who owns it*, not about who is winning: a bot
 * contributes to a project it is already part of, and sabotages only the
 * leader's, only while it has heat to spare, and only when it is behind. A bot
 * that sabotaged whatever was closest to finishing would make every public
 * commitment on the board worthless, which is exactly the mechanic projects
 * exist to create.
 */
function workProjects(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const contribute = find(actions, "project.contribute");
  if (contribute !== null) {
    const own = contribute.projectIds
      .map((projectId) =>
        table.projects.find((project) => project.projectId === String(projectId)),
      )
      .find((project) => project !== undefined && project.isOwn);
    if (own !== undefined) {
      const spare = surplus(table, RESERVE_MULTIPLIER.contribute);
      // Both halves are sized from what the bot ACTUALLY HOLDS, not merely from
      // what the project still wants. The engine checks money and work
      // independently, so offering work the bot does not have is rejected even
      // when the money half is affordable — and that rejection is classified as
      // unexpected, which stops the drain and stalls the match for every seat.
      // This is the branch the original bug was found in; `decide` now re-checks
      // both halves against the same holdings, so getting this arithmetic wrong
      // again costs a skipped contribution instead of a stalled match.
      const money = Math.min(
        own.outstandingMoney,
        botAffordable(table, "money"),
        Math.max(0, Math.floor(spare / 2)),
      );
      const work = Math.min(own.outstandingWork, botAffordable(table, "work"), 1);
      if (money > 0 || work > 0) {
        const contributed = decide(
          table,
          contribute,
          { type: "project.contribute", payload: { projectId: own.projectId, money, work } },
          "putting resources into its own project",
        );
        if (contributed !== null) return contributed;
      }
    }
  }

  const start = find(actions, "project.start");
  if (start !== null) {
    const leadsOne = table.projects.some(
      (project) => project.leadPlayerId === table.self.playerId,
    );
    if (!leadsOne && surplus(table, RESERVE_MULTIPLIER.project) > 0) {
      // Every offered definition, not just the first. The enumerator only lists
      // definitions whose `leadStakeMoney` the bot can already cover, but it
      // does not say *what* the stake is (see priceBotCommand's note), so
      // walking the list is the only way a definition the bot turns out not to
      // be able to start does not take the whole rung down with it.
      for (const definitionId of start.definitionIds) {
        const opened = decide(
          table,
          start,
          {
            type: "project.start",
            payload: { definitionId: String(definitionId), tileId: null, openToJoin: true },
          },
          "opening a project the table can join",
        );
        if (opened !== null) return opened;
      }
    }
  }

  const sabotage = find(actions, "project.sabotage");
  if (sabotage !== null && table.leaderId !== null && hasHeatHeadroom(table)) {
    const leader = rivalOf(table, table.leaderId);
    const target = sabotage.projectIds
      .map((projectId) =>
        table.projects.find((project) => project.projectId === String(projectId)),
      )
      .find(
        (project) =>
          project !== undefined && !project.isOwn && project.leadPlayerId === table.leaderId,
      );
    // Sabotage costs work one for one — and `sabotageableProjects` does not
    // filter on it, so an advertised sabotage is *not* evidence the bot holds
    // any. A bot with an empty work counter offering one unit was the same
    // stall the contribute branch shipped, one verb over.
    const amount = Math.min(1, botAffordable(table, "work"));
    if (
      target !== undefined &&
      leader !== null &&
      leader.rankIndex >= table.self.rankIndex &&
      amount > 0
    ) {
      const sabotaged = decide(
        table,
        sabotage,
        {
          type: "project.sabotage",
          // Never hidden: hidden sabotage is the strongest version of the verb
          // and the least legible, and a bot that used it would be an
          // unaccountable saboteur at a table that cannot read it. It also
          // charges money at a rate only the engine knows, which is why
          // priceBotCommand refuses to price a concealed one at all.
          payload: { projectId: target.projectId, amount, hidden: false },
        },
        "slowing the front-runner's project down",
      );
      if (sabotaged !== null) return sabotaged;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Rung 7 — hand, tokens, abilities, dice
 * ------------------------------------------------------------------ */

function useResources(
  actions: readonly LegalAction[],
  table: BotTableView,
): BotDecision | null {
  const card = find(actions, "turn.play-card");
  const cardId = card?.cardIds[0];
  if (card !== null && cardId !== undefined) {
    const played = decide(
      table,
      card,
      {
        type: "turn.play-card",
        payload: { cardId: String(cardId), targetPlayerIds: [], choice: null },
      },
      "playing a card rather than holding it forever",
    );
    if (played !== null) return played;
  }

  const ability = find(actions, "turn.activate-character");
  if (ability !== null) {
    // Priced at the most expensive active the content pack authors, because the
    // bot cannot see which character it is: `turn.activate-character` is offered
    // on cooldown alone, and one authored active charges money the transition
    // then refuses if it is short. Skipping the ability is the cheap failure;
    // stalling the drain is not.
    const activated = decide(
      table,
      ability,
      {
        type: "turn.activate-character",
        payload: { abilityId: String(ability.abilityId), targetPlayerIds: [], choice: null },
      },
      "using the character it was dealt",
    );
    if (activated !== null) return activated;
  }

  const adjust = find(actions, "turn.adjust-roll");
  if (adjust !== null && table.self.pendingRollPips === 0) {
    // Energy at or near its ceiling is energy that will be wasted, and a pip of
    // movement is the only thing a pre-roll bot can convert it into. One
    // purchase per turn: `pendingRollPips` is non-zero afterwards, which is what
    // stops this rung from firing again inside the same drain.
    //
    // What it will *not* do is spend down to nothing. See energyReserve(): pips
    // are bought only out of energy above one free action's worth, so a bot that
    // steers its roll can still work, rest or defend itself afterwards.
    const spare = botAffordable(table, "energy", energyReserve(table));
    const affordable =
      adjust.energyPerPip <= 0 ? adjust.maxPips : Math.floor(spare / adjust.energyPerPip);
    const pips = Math.min(adjust.maxPips, affordable);
    if (pips > 0) {
      const adjusted = decide(
        table,
        adjust,
        { type: "turn.adjust-roll", payload: { pips } },
        "spending spare energy to move further",
      );
      if (adjusted !== null) return adjusted;
    }
  }

  const token = find(actions, "turn.spend-token");
  const movement = token?.tokens[0];
  if (token !== null && movement !== undefined && movement.maxQuantity >= 1) {
    // A movement token buys the same steer `turn.adjust-roll` sells, but for a
    // resource with a hard cap and no other use — so it is spent exactly when
    // energy could not have bought it. Reached only *after* the adjust rung, so
    // a bot with both never pays twice to steer one roll. The enumerator
    // already bounds `maxQuantity` by the remaining pip headroom, which is what
    // makes repeated spends terminate — and a token whose bound is below one is
    // not spendable at all, which is what the guard above says.
    const couldNotAffordEnergy =
      adjust === null ||
      botAffordable(table, "energy", energyReserve(table)) < Math.max(1, adjust.energyPerPip);
    if (couldNotAffordEnergy) {
      const spent = decide(
        table,
        token,
        {
          type: "turn.spend-token",
          payload: { tokenId: movement.tokenId, quantity: 1, use: movement.use },
        },
        "spending a movement token it has no other use for",
      );
      if (spent !== null) return spent;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Rung 8 — aggression
 * ------------------------------------------------------------------ */

/**
 * `attack.target`, gated four ways on purpose.
 *
 * "A bot that always attacks the leader makes the game worse for everyone" is
 * the exact failure this guards against, so aggression needs *all* of: a
 * `ruthless` seat, heat to spare, a leader who is genuinely ahead
 * ({@link ATTACK_RANK_GAP} of rank, not a nose), and a bot that is not itself
 * the one in front. An `easy` or `standard` bot never attacks at all.
 */
function attack(input: BotDecisionInput): BotDecision | null {
  const action = find(input.legalActions, "attack.target");
  if (action === null) return null;
  if (input.difficulty !== "ruthless") return null;

  const { table } = input;
  // Heat is the first price, and the only one of the two the bot can read
  // exactly: `raiseHeat` charges `conflict.heatPerAttack` on every attack,
  // including ones immunity absorbs, and crossing the threshold opens an
  // investigation. Leaving HEAT_HEADROOM back is what keeps a bot from
  // attacking its way into one.
  if (!hasHeatHeadroom(table)) return null;
  // Energy is the second. Every vector in the engine's table costs energy, and
  // so does every free action, so an attack that empties the bar buys one hit
  // and forfeits the rest of the turn. The exact vector price is not on the
  // legal action (see priceBotCommand), so this reserves a free action's worth
  // and requires at least a pip of attack budget beyond it.
  if (botAffordable(table, "energy", table.freeActionEnergyCost) < 1) return null;

  const leader = rivalOf(table, table.leaderId);
  if (leader === null) return null;
  if (leader.rankIndex - table.self.rankIndex < ATTACK_RANK_GAP) return null;
  if (!action.targetPlayerIds.includes(leader.playerId)) return null;

  // Every offered vector, cheapest-unknown-first: the enumerator drops the ones
  // the actor cannot pay for, so walking the list rather than taking `[0]` costs
  // nothing and survives a vector table that grows a pricier entry.
  for (const vector of action.vectors) {
    const struck = decide(
      table,
      action,
      {
        type: "attack.target",
        payload: { targetPlayerId: leader.playerId, vector: String(vector), cardId: null },
      },
      "going after the front-runner",
    );
    if (struck !== null) return struck;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * decideBotAction
 * ------------------------------------------------------------------ */

/**
 * The ladder, top to bottom.
 *
 * Order is the whole design. Obligations the rest of the table is blocked on
 * come first; then solvency, because a bankrupt seat has no decisions left; then
 * the climb, which is how a match ends; then the verbs that convert resources
 * into progress; and only then the roll, which is the one action that always
 * exists and therefore must be last or nothing below it would ever run.
 *
 * Two verbs are deliberately never chosen, and both absences are rules:
 *
 * - **`agreement.offer`.** Bots are not required to negotiate, and an offer a
 *   bot cannot value is a notification a human has to read and dismiss. It
 *   answers offers (see {@link answerAgreement}); it does not make them.
 * - **`management.shuffle-deck`.** Only Management can shuffle, so using it is
 *   a public declaration of a hidden role for a marginal deck advantage. A bot
 *   that outed itself on turn two would make hidden roles pointless in every
 *   room with a bot in it.
 */
export function decideBotAction(input: BotDecisionInput): BotDecision {
  const { legalActions, table } = input;

  const rungs: readonly (() => BotDecision | null)[] = [
    () => blockPromotion(legalActions, table),
    () => answerReaction(legalActions, table),
    () => answerPrompt(input),
    () => answerAgreement(legalActions, table),
    () => castBallot(legalActions, table),
    () => manageDebt(legalActions, table),
    () => leaveAudit(input),
    () => climb(input),
    () => takeFreeAction(legalActions, table),
    () => workProjects(legalActions, table),
    () => investInBoard(legalActions, table),
    () => useResources(legalActions, table),
    () => attack(input),
  ];

  for (const rung of rungs) {
    const decision = rung();
    if (decision !== null) return decision;
  }

  const roll = find(legalActions, "turn.roll");
  if (roll !== null) {
    // Rolling costs nothing, so this cannot be priced out — which is exactly
    // why it is the floor of the ladder. `?? { kind: "none" }` is there for the
    // type, not for a case that can happen.
    return (
      decide(table, roll, { type: "turn.roll", payload: {} }, "rolling") ?? { kind: "none" }
    );
  }

  return { kind: "none" };
}
