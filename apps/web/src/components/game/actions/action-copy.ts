/**
 * One `describe` per advertised action: the label, the price, the sentence, and
 * the reason it is inert.
 *
 * This is the whole point of the action layer, so it is a separate module from
 * the components: **a button that does not say what it spends is why nobody will
 * press it.** Every number below is read off the summary the server sent or off
 * the actor's own balances — `tile.claim` carries its tile and its cost,
 * `project.contribute` carries `minTotal`/`maxMoney`/`maxWork`,
 * `turn.adjust-roll` carries the pip range AND `affordablePips`, `attack.target`
 * carries the heat it costs the *actor*, and `ballot.cast` carries a nested union
 * so a vote's options and an auction's bid range can never be confused. Nothing
 * here derives a rule; where the summary prices nothing (`audit.pay-fine` does
 * not carry the fine), the copy says what happens and states no figure rather
 * than inventing one.
 *
 * Pure functions of `(action, context)`. No JSX, no hooks — so the copy for all
 * twenty-seven controls is unit-testable without rendering anything.
 */
import type { BallotCastOptions, TradeItem } from "@office-ladder/contracts";

import {
  cannotAfford,
  formatActionMoney,
  formatBasisPoints,
  formatEnergy,
  formatWork,
  humaniseId,
  labelFor,
  moneyShortfall,
  nameFor,
  REACTION_WINDOW_COPY,
  type ActionContext,
  type ActionDescription,
  type ActionOf,
} from "./action-model";
import { formatPanelNumber, pluralise } from "../panels/panel-format";

/* -------------------------------------------------------------------------- */
/* Shared phrasing                                                            */
/* -------------------------------------------------------------------------- */

/** One clause of a deal, as a player reads it. */
export function tradeItemText(item: TradeItem, context: ActionContext): string {
  switch (item.kind) {
    case "money":
      return formatActionMoney(item.amount);
    case "card":
      return labelFor(context.labels?.cards, item.cardId);
    case "token":
      return `${formatPanelNumber(item.quantity)} × ${labelFor(context.labels?.tokens, item.tokenId)}`;
    case "tile":
      return labelFor(context.labels?.tiles, item.tileId);
    case "immunity":
      return `${pluralise(item.rounds, "round")} of immunity`;
    case "promise":
      return `a promise: “${truncate(item.text, 48)}”`;
  }
}

export function tradeSideText(
  items: readonly TradeItem[],
  context: ActionContext,
): string {
  if (items.length === 0) return "nothing";

  return items.map((item) => tradeItemText(item, context)).join(" and ");
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** The cheapest entry in a priced list, or null for an empty one. */
function cheapest(costs: readonly number[]): number | null {
  return costs.length === 0 ? null : Math.min(...costs);
}

/* -------------------------------------------------------------------------- */
/* Tier 1 — the turn's spine                                                  */
/* -------------------------------------------------------------------------- */

export function describeStartGame(): ActionDescription {
  return {
    label: "Start the shift",
    price: null,
    detail:
      "Deals the board, seats everyone and opens the first turn. Nobody can act until this is pressed.",
    blocked: null,
  };
}

export function describeRoll(): ActionDescription {
  return {
    label: "Roll die",
    price: null,
    detail: "Rolls, moves you, and resolves whatever you land on.",
    blocked: null,
  };
}

export function describeAdjustRoll(
  action: ActionOf<"turn.adjust-roll">,
  context: ActionContext,
): ActionDescription {
  const energy = context.spendable.energy;
  const buys = Math.min(action.affordablePips, action.maxPips);

  return {
    label: "Adjust the roll",
    price: `${formatEnergy(action.energyPerPip)} / pip`,
    detail: `Shifts your roll by up to ${formatPanelNumber(action.maxPips)} pips either way at ${formatEnergy(
      action.energyPerPip,
    )} each. Your energy buys ${formatPanelNumber(buys)}.`,
    // The one action whose ceiling is energy rather than money, so it gets its
    // own shortfall clause instead of `moneyShortfall`.
    blocked:
      action.affordablePips <= 0
        ? `A pip costs ${formatEnergy(action.energyPerPip)}, you hold ${formatEnergy(energy)}.`
        : null,
  };
}

export function describeTurnAction(
  action: ActionOf<"turn.action">,
): ActionDescription {
  return {
    label: "Free action",
    price: null,
    detail: `${pluralise(action.remaining, "free action")} left this turn: ${action.actions
      .map((entry) => humaniseId(entry).toLowerCase())
      .join(", ")}.`,
    blocked:
      action.remaining <= 0 ? "You have used every free action this turn." : null,
  };
}

export function describePlayCard(
  action: ActionOf<"turn.play-card">,
): ActionDescription {
  return {
    label: "Play a card",
    price: null,
    detail: `${pluralise(action.cardIds.length, "card")} in your hand can be played right now.`,
    blocked: null,
  };
}

export function describeSpendToken(
  action: ActionOf<"turn.spend-token">,
  context: ActionContext,
): ActionDescription {
  const first = action.tokens[0];

  return {
    label: "Spend a token",
    price: null,
    detail:
      action.tokens.length === 1 && first !== undefined
        ? `Spends up to ${formatPanelNumber(first.maxQuantity)} × ${labelFor(
            context.labels?.tokens,
            first.tokenId,
          )} on ${humaniseId(first.use).toLowerCase()}.`
        : `${pluralise(action.tokens.length, "token")} you hold can be spent this turn.`,
    blocked: null,
  };
}

export function describeActivateCharacter(
  action: ActionOf<"turn.activate-character">,
  context: ActionContext,
): ActionDescription {
  const ability = labelFor(context.labels?.abilities, action.abilityId);

  return {
    label: `Use ${ability}`,
    price: null,
    detail: `Activates ${ability}. An ability with a cooldown will not be back next turn.`,
    blocked: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Tier 1 — open decisions                                                    */
/* -------------------------------------------------------------------------- */

export function describePrompt(
  action: ActionOf<"prompt.respond">,
  context: ActionContext,
): ActionDescription {
  const subject = labelFor(context.labels?.prompts, action.kind);

  return {
    label: subject,
    price: null,
    detail: "The match is waiting on your answer. Nothing advances until you give one.",
    blocked:
      action.options.length === 0
        ? "This decision arrived with no options the board can offer."
        : null,
  };
}

export function describeReactionPlay(
  action: ActionOf<"reaction.play">,
): ActionDescription {
  const copy = REACTION_WINDOW_COPY[action.kind];
  const holdings = action.cardIds.length + action.abilityIds.length;

  return {
    label: copy?.label ?? "Play a reaction",
    price: null,
    detail:
      copy?.detail ??
      "A reaction window is open and closes on its own deadline whether or not you act.",
    blocked:
      holdings === 0 ? "You hold nothing that reacts in this window." : null,
  };
}

export function describeReactionPass(
  action: ActionOf<"reaction.pass">,
): ActionDescription {
  return {
    label: "Pass",
    price: null,
    detail:
      action.kind === "prevention"
        ? "Declines to prevent it. The effect resolves as proposed."
        : "Declines to react. The window closes for you.",
    blocked: null,
  };
}

/**
 * Says nothing about who holds `role.management`.
 *
 * The window's audience is every seat but the promotee, precisely so the offer
 * itself does not identify the role-holder — so the copy must not either. Using
 * the control is what reveals it.
 */
export function describeBlockPromotion(): ActionDescription {
  return {
    label: "Block the promotion",
    price: null,
    detail:
      "Refuses the promotion on the table. Using this is what tells the table you hold the role.",
    blocked: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Tier 1 — the ladder and the auditor                                        */
/* -------------------------------------------------------------------------- */

export function describePromotionAttempt(
  action: ActionOf<"promotion.attempt">,
  context: ActionContext,
): ActionDescription {
  const rank = labelFor(context.labels?.ranks, action.toRankId);
  const held = context.spendable.money;

  return {
    label: `Take ${rank}`,
    price: formatActionMoney(action.cost),
    detail: action.declined
      ? `${rank} costs ${formatActionMoney(action.cost)}. You declined it once; attempting again is legal.`
      : `Buys ${rank} for ${formatActionMoney(action.cost)}.`,
    blocked: cannotAfford(action.cost, held) ? moneyShortfall(action.cost, held) : null,
  };
}

export function describePromotionDecline(): ActionDescription {
  return {
    label: "Decline it",
    price: null,
    detail: "Stays at your rank and keeps the money. You may take it later.",
    blocked: null,
  };
}

export function describePayFine(): ActionDescription {
  return {
    label: "Pay the fine",
    price: null,
    // The summary carries no amount, so this states no figure. A price printed
    // from a constant this layer guessed would be a lie the first time the
    // content pack retuned it.
    detail: "Pays the audit fine and releases you from confinement immediately.",
    blocked: null,
  };
}

export function describeShuffleDeck(
  action: ActionOf<"management.shuffle-deck">,
  context: ActionContext,
): ActionDescription {
  const first = action.deckIds[0];

  return {
    label: "Shuffle a deck",
    price: null,
    detail:
      action.deckIds.length === 1 && first !== undefined
        ? `Reorders ${labelFor(context.labels?.decks, first)}. Nobody is told the new order.`
        : `${pluralise(action.deckIds.length, "deck")} you may reorder. Nobody is told the new order.`,
    blocked: null,
  };
}

/* -------------------------------------------------------------------------- */
/* The board — ownership and placements                                       */
/* -------------------------------------------------------------------------- */

export function describeClaimTile(
  action: ActionOf<"tile.claim">,
  context: ActionContext,
): ActionDescription {
  const tile = labelFor(context.labels?.tiles, action.tileId);
  const held = context.spendable.money;

  return {
    label: `Claim ${tile}`,
    price: formatActionMoney(action.cost),
    detail: `Puts your name on ${tile} for ${formatActionMoney(action.cost)}. Everyone who lands there afterwards pays you.`,
    blocked: cannotAfford(action.cost, held) ? moneyShortfall(action.cost, held) : null,
  };
}

export function describeUpgradeTile(
  action: ActionOf<"tile.upgrade">,
  context: ActionContext,
): ActionDescription {
  const tile = labelFor(context.labels?.tiles, action.tileId);
  const held = context.spendable.money;

  return {
    label: `Upgrade ${tile}`,
    price: formatActionMoney(action.cost),
    detail: `Takes ${tile} to level ${formatPanelNumber(action.level)} for ${formatActionMoney(
      action.cost,
    )}, which raises what it charges.`,
    blocked: cannotAfford(action.cost, held) ? moneyShortfall(action.cost, held) : null,
  };
}

export function describePlacement(
  action: ActionOf<"placement.place">,
  context: ActionContext,
): ActionDescription {
  const held = context.spendable.money;
  const floor = cheapest(action.kinds.map((entry) => entry.cost));
  const tile = context.tileId === null || context.tileId === undefined
    ? null
    : labelFor(context.labels?.tiles, context.tileId);

  return {
    label: "Leave something behind",
    price: floor === null ? null : `from ${formatActionMoney(floor)}`,
    detail:
      tile === null
        ? `${pluralise(action.kinds.length, "object")} you may place for the next player who lands there.`
        : `Places an object on ${tile} for the next player who lands on it.`,
    blocked:
      tile === null
        ? "This terminal has not been told which tile you are on."
        : floor !== null && cannotAfford(floor, held)
          ? moneyShortfall(floor, held)
          : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export function describeStartProject(
  action: ActionOf<"project.start">,
): ActionDescription {
  return {
    label: "Start a project",
    price: null,
    // The summary carries brief ids and no cost, so the price stays null and the
    // sentence says the cost exists without naming a figure.
    detail: `${pluralise(action.definitionIds.length, "brief")} you may open. Starting one commits money and pays out over several turns.`,
    blocked: null,
  };
}

export function describeContribute(
  action: ActionOf<"project.contribute">,
): ActionDescription {
  const ceiling = action.maxMoney + action.maxWork;

  return {
    label: "Contribute",
    price: `up to ${formatActionMoney(action.maxMoney)} + ${formatWork(action.maxWork)}`,
    detail: `Money and work together must reach ${formatPanelNumber(
      action.minTotal,
    )}. You can commit ${formatActionMoney(action.maxMoney)} and ${formatWork(action.maxWork)}, and contributors share the payout pro rata.`,
    blocked:
      ceiling < action.minTotal
        ? "You have no money and no work left to commit."
        : null,
  };
}

export function describeSabotage(
  action: ActionOf<"project.sabotage">,
): ActionDescription {
  const heat = action.heatCost;

  return {
    label: "Sabotage",
    price: heat === 0 ? `up to ${formatWork(action.maxAmount)}` : `+${formatPanelNumber(heat)} heat`,
    detail: `Spends your work one for one against the project${
      heat === 0 ? "" : ` and adds ${formatPanelNumber(heat)} heat to you`
    }. Hidden sabotage stays hidden until the project resolves.`,
    blocked:
      action.maxAmount < 1
        ? "Sabotage spends work one for one and you hold none."
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Conflict, deals and ballots                                                */
/* -------------------------------------------------------------------------- */

export function describeAttack(
  action: ActionOf<"attack.target">,
): ActionDescription {
  const heat = action.heatCost;

  return {
    label: "Go after someone",
    price: heat === 0 ? null : `+${formatPanelNumber(heat)} heat`,
    detail: `${pluralise(action.targetPlayerIds.length, "seat")} in reach, ${pluralise(
      action.vectors.length,
      "way",
    )} to do it.${heat === 0 ? "" : ` This adds ${formatPanelNumber(heat)} heat to YOU, not to them.`}`,
    blocked: null,
  };
}

export function describeOfferAgreement(
  action: ActionOf<"agreement.offer">,
): ActionDescription {
  const promises = action.itemKinds.includes("promise");

  return {
    label: "Offer a deal",
    price: null,
    detail: `Name what you hand over and what you want back, to as many as ${pluralise(
      action.maxRecipients,
      "seat",
    )}.${promises ? " A promise is recorded but never enforced — the table just gets to see who broke it." : ""}`,
    blocked: null,
  };
}

export function describeRespondAgreement(
  action: ActionOf<"agreement.respond">,
  context: ActionContext,
): ActionDescription {
  return {
    label: `Answer ${nameFor(context, action.proposerId)}`,
    price: null,
    detail: `They give ${tradeSideText(action.give, context)} for ${tradeSideText(
      action.receive,
      context,
    )}. Expires at round ${formatPanelNumber(action.expiresAtRound)}.`,
    blocked: null,
  };
}

export function describeBallot(
  action: ActionOf<"ballot.cast">,
  context: ActionContext,
): ActionDescription {
  const subject = labelFor(context.labels?.ballotSubjects, action.subjectId);
  const sealed = action.sealed
    ? "Sealed: nobody sees anything until it closes, including you."
    : "Open: the table can see how it stands.";

  if (action.ballot.kind === "auction") {
    return {
      label: `Bid on ${subject}`,
      price: `${formatActionMoney(action.ballot.minBid)} floor`,
      detail: `${sealed} A bid of zero always passes; ${formatActionMoney(
        action.ballot.maxBid,
      )} is everything you could put up.`,
      // Never blocked: passing is legal at any balance, so disabling the control
      // would remove a legal move. The bid FIELD states the shortfall instead.
      blocked: null,
    };
  }

  return {
    label: `Vote on ${subject}`,
    price: null,
    detail: `${sealed}${
      action.ballot.options === null
        ? " This subject takes any answer."
        : ` ${pluralise(action.ballot.options.length, "option")} on the paper.`
    }`,
    blocked: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Debt                                                                       */
/* -------------------------------------------------------------------------- */

export function describeTakeLoan(
  action: ActionOf<"loan.take">,
): ActionDescription {
  return {
    label: "Take a loan",
    price: formatBasisPoints(action.interestBasisPoints),
    detail: `Borrow up to ${formatActionMoney(action.maxPrincipal)} at ${formatBasisPoints(
      action.interestBasisPoints,
    )} interest. Debt is owed on top of your balance, not the same thing as being short.`,
    blocked: null,
  };
}

export function describeRepayLoan(
  action: ActionOf<"loan.repay">,
): ActionDescription {
  const owed = action.loans.reduce((total, loan) => total + loan.outstanding, 0);

  return {
    label: "Repay a loan",
    price: `${formatActionMoney(owed)} owed`,
    detail: `${pluralise(action.loans.length, "loan")} outstanding, ${formatActionMoney(
      owed,
    )} in total. You can put ${formatActionMoney(action.maxAmount)} against it.`,
    blocked:
      action.maxAmount <= 0 ? "You hold no money to repay with." : null,
  };
}

export function describeBallotOptionsLabel(ballot: BallotCastOptions): string {
  return ballot.kind === "auction" ? "Your bid" : "Your vote";
}
