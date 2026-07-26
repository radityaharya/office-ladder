import type { ModeRules } from "@office-ladder/content";

import type { RepayLoanCommand, TakeLoanCommand } from "../commands";
import type { GameEvent, ResourceChangedEvent } from "../events";
import type { GameState, LoanId, LoanState, PlayerId, PlayerState } from "../model";
import { createStableId } from "../model";
import {
  findMoney,
  moveMoney,
  spendableMoney,
  type EconomyResourceChange,
} from "./economy";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Debt: the other half of the money sink.
 *
 * Upkeep only bites if a player can be caught short, and a player can only be
 * caught short if borrowing is a decision with a price. Both tunables come from
 * `state.rules.economy` — `maxLoanPrincipal` and `interestBasisPoints` — and both
 * commands refuse outright when `loansEnabled` is false, so the whole mechanic
 * switches off from config with no `modeId` comparison anywhere.
 *
 * Interest **capitalises** rather than being billed as cash: each round adds
 * `outstanding x interestBasisPoints / 10000` to `outstanding`. That keeps the
 * per-round cash flow a single legible line (upkeep) while still making a loan
 * left unpaid genuinely expensive, and it means a player who cannot pay their
 * upkeep is never also silently charged interest they equally cannot pay.
 */

/** Rounded up, so a debt small enough to round to zero still costs something. */
function interestOn(loan: LoanState): number {
  if (loan.outstanding <= 0) return 0;
  const basisPoints = Math.max(0, loan.interestBasisPoints);
  if (basisPoints === 0) return 0;

  return Math.ceil((loan.outstanding * basisPoints) / 10_000);
}

/** Everything this player still owes across every open loan. */
export function totalOutstandingDebt(player: PlayerState): number {
  return player.loans.reduce(
    (total, loan) => total + Math.max(0, loan.outstanding),
    0,
  );
}

/**
 * How much more this player may borrow.
 *
 * `maxLoanPrincipal` is read as a cap on *total outstanding debt*, not as a cap
 * on a single draw. Per-draw would be no cap at all — take the maximum twice and
 * the ceiling is gone — and an uncapped debt is exactly the cheat §8.4 warns
 * about for lobby-authored rules.
 */
export function loanCapacity(player: PlayerState, rules: ModeRules): number {
  if (!rules.economy.loansEnabled) return 0;

  return Math.max(
    0,
    Math.trunc(rules.economy.maxLoanPrincipal) - totalOutstandingDebt(player),
  );
}

/** What one round of accrual will add to this player's balance. */
export function interestPerRound(player: PlayerState, rules: ModeRules): number {
  if (!rules.economy.loansEnabled) return 0;

  return player.loans.reduce((total, loan) => total + interestOn(loan), 0);
}

export type InterestAccrual = {
  readonly player: PlayerState;
  readonly accrued: number;
};

/**
 * Adds one round of interest to every open loan.
 *
 * Each loan compounds at the rate **it** was written at (`LoanState.interestBasisPoints`),
 * not at whatever the ruleset currently says: the rate is snapshotted onto the
 * loan when it is taken, exactly the way `GameState.rules` is snapshotted at
 * `game.start`, so a rate that changes cannot retroactively reprice a debt.
 */
export function accrueLoanInterest(
  player: PlayerState,
  rules: ModeRules,
): InterestAccrual {
  if (!rules.economy.loansEnabled || player.loans.length === 0) {
    return { player, accrued: 0 };
  }

  let accrued = 0;
  const loans = player.loans.map((loan) => {
    const interest = interestOn(loan);
    if (interest === 0) return loan;
    accrued += interest;

    return { ...loan, outstanding: loan.outstanding + interest };
  });
  if (accrued === 0) return { player, accrued: 0 };

  return { player: { ...player, loans }, accrued };
}

/**
 * A deterministic loan id from server-owned state only.
 *
 * `revision + 1` is the revision this command produces — the game's own monotonic
 * counter — so exactly one loan id exists per accepted command and a replay of
 * the same command against the same state re-derives it. Deriving it from
 * `command.commandId` would hand the client the naming of its own rows.
 */
function nextLoanId(state: GameState, playerId: PlayerId): LoanId {
  return createStableId(
    "LoanId",
    `${state.gameId}:loan:${playerId}:${state.revision + 1}`,
  );
}

type Guarded = {
  readonly player: PlayerState;
};

/**
 * The authorisation and legality checks both loan commands share (spec §6.3),
 * run **before** anything is mutated.
 *
 * A loan moves only the actor's own money, so entitlement here is "you are a live
 * player acting on your own turn" — the same shape `rollTurn` and
 * `respondToPrompt` enforce. Turn-gating is the load-bearing part: without it a
 * player could borrow at the instant somebody else's upkeep settlement fires, and
 * the shortfall the mechanic exists to create would never be felt.
 */
function guardLoanCommand(
  state: GameState,
  command: TakeLoanCommand | RepayLoanCommand,
): TransitionResult | Guarded {
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Loans can only be moved in an active game",
    });
  }
  if (!state.rules.economy.loansEnabled) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode's ruleset has lending switched off",
    });
  }

  const player = state.players[command.actorId];
  if (player === undefined) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_FOUND",
      message: "Command actor is not a player in this game",
    });
  }
  if (state.eliminatedPlayerIds.includes(command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "An eliminated player cannot borrow or repay",
    });
  }
  if (state.turn.activePlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can move their own loans",
    });
  }
  if (state.turn.phase === "not-started" || state.turn.phase === "game-over") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "Loans cannot be moved outside a live turn",
    });
  }

  return { player };
}

function isGuarded(value: TransitionResult | Guarded): value is Guarded {
  return "player" in value;
}

/** A whole, positive, finite amount of money. Anything else is a malformed command. */
function isPositiveWholeAmount(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function moneyEvents(
  state: GameState,
  command: TakeLoanCommand | RepayLoanCommand,
  context: TransitionContext,
  changes: readonly EconomyResourceChange[],
): readonly GameEvent[] {
  return changes.map((change, index): ResourceChangedEvent => {
    return {
      ...createEventMetadata(
        state,
        command,
        context.logicalTimestamp,
        state.eventSequence + index + 1,
      ),
      type: "ResourceChanged",
      payload: {
        playerId: change.playerId,
        resourceId: change.resourceId,
        previousValue: change.previousValue,
        newValue: change.newValue,
        reason: change.reason,
      },
    };
  });
}

function commit(
  state: GameState,
  command: TakeLoanCommand | RepayLoanCommand,
  context: TransitionContext,
  player: PlayerState,
  changes: readonly EconomyResourceChange[],
): TransitionResult {
  const events = moneyEvents(state, command, context, changes);
  const lastEvent = events[events.length - 1];
  if (lastEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "A loan command must move money and did not",
    });
  }

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        players: { ...state.players, [player.id]: player },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}

/**
 * `loan.take` — draw `principal` against the ruleset's ceiling.
 *
 * Deliberately does **not** end the turn: borrowing is a financial decision taken
 * around a turn, not instead of one, and making it consume the turn would mean a
 * player short of upkeep has to choose between paying the bill and playing the
 * game. It is still turn-gated (see `guardLoanCommand`), which is what stops it
 * from being a free reaction to somebody else's move.
 */
export function takeLoan(
  state: GameState,
  command: TakeLoanCommand,
  context: TransitionContext,
): TransitionResult {
  const guarded = guardLoanCommand(state, command);
  if (!isGuarded(guarded)) return guarded;

  const { principal } = command.payload;
  if (!isPositiveWholeAmount(principal)) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "A loan principal must be a whole number above zero",
      details: { principal },
    });
  }

  const capacity = loanCapacity(guarded.player, state.rules);
  if (principal > capacity) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This loan would take the player past the mode's debt ceiling",
      details: {
        requested: principal,
        capacity,
        maxLoanPrincipal: state.rules.economy.maxLoanPrincipal,
        outstanding: totalOutstandingDebt(guarded.player),
      },
    });
  }
  if (findMoney(guarded.player) === null) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "A borrowing player has no money resource to credit",
    });
  }

  const loan: LoanState = {
    id: nextLoanId(state, guarded.player.id),
    principal,
    outstanding: principal,
    // Snapshotted from the rules the loan was written under, so it compounds at
    // the rate the player agreed to for the rest of the match.
    interestBasisPoints: Math.max(0, state.rules.economy.interestBasisPoints),
    takenAtRound: state.turn.round,
  };
  const credited = moveMoney(
    { ...guarded.player, loans: [...guarded.player.loans, loan] },
    principal,
    "loan-principal",
  );
  if (credited.change === null) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Loan principal did not reach the borrower's balance",
    });
  }

  return commit(state, command, context, credited.player, [credited.change]);
}

/**
 * `loan.repay` — pay `amount` off one of the actor's **own** loans.
 *
 * The loan is looked up on the actor's record first, so naming another player's
 * loan id cannot reach it. A loan that exists but belongs to somebody else is
 * refused as unauthorised rather than as missing, because the two are genuinely
 * different failures and a client that gets "not found" for a loan it can see in
 * the public projection will simply retry.
 */
export function repayLoan(
  state: GameState,
  command: RepayLoanCommand,
  context: TransitionContext,
): TransitionResult {
  const guarded = guardLoanCommand(state, command);
  if (!isGuarded(guarded)) return guarded;

  const { loanId, amount } = command.payload;
  if (!isPositiveWholeAmount(amount)) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "A repayment must be a whole number above zero",
      details: { amount },
    });
  }

  const loan = guarded.player.loans.find((candidate) => candidate.id === loanId);
  if (loan === undefined) {
    // Walked in playerOrder rather than over record keys: key order is not a
    // stable contract across the repository's JSON round trip.
    const ownerId = state.playerOrder.find((candidate) =>
      state.players[candidate]?.loans.some((other) => other.id === loanId),
    );

    return rejectCommand(state, command, {
      code: ownerId === undefined ? "ILLEGAL_ACTION" : "ACTOR_NOT_AUTHORIZED",
      message:
        ownerId === undefined
          ? "No such loan in this game"
          : "That loan belongs to another player",
      details: { loanId },
    });
  }
  if (amount > loan.outstanding) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "A repayment cannot exceed the loan's outstanding balance",
      details: { amount, outstanding: loan.outstanding },
    });
  }

  const money = findMoney(guarded.player);
  if (money === null) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "A repaying player has no money resource to debit",
    });
  }
  if (spendableMoney(money) < amount) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "The player cannot cover this repayment",
      details: { amount, balance: money.resource.value },
    });
  }

  const outstanding = loan.outstanding - amount;
  const loans =
    outstanding > 0
      ? guarded.player.loans.map((candidate) =>
          candidate.id === loan.id ? { ...candidate, outstanding } : candidate,
        )
      : guarded.player.loans.filter((candidate) => candidate.id !== loan.id);
  const debited = moveMoney(
    { ...guarded.player, loans },
    -amount,
    "loan-repayment",
  );
  if (debited.change === null || debited.applied !== -amount) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The repayment did not leave the borrower's balance in full",
    });
  }

  return commit(state, command, context, debited.player, [debited.change]);
}
