import { describe, expect, it } from "vitest";

import { deserializeGameState, serializeGameState, stableStringify } from "../src";
import type {
  CommandId,
  GameState,
  LoanId,
  PlayerId,
  RepayLoanCommand,
  TakeLoanCommand,
  TransitionResult,
} from "../src";
import { findMoney } from "../src/execution/economy";
import {
  accrueLoanInterest,
  interestPerRound,
  loanCapacity,
  repayLoan,
  takeLoan,
  totalOutstandingDebt,
} from "../src/execution/loans";
import {
  deepFreeze,
  economyContent,
  economyIds,
  economyRules,
  economyState,
  loan,
} from "./economy-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const { owner, hiddenOpponent } = economyIds;

const context = {
  logicalTimestamp: "2026-07-26T09:00:00.000Z",
  content: economyContent,
};

function takeCommand(
  state: GameState,
  overrides: Partial<TakeLoanCommand> & { readonly principal?: number } = {},
): TakeLoanCommand {
  const { principal, ...rest } = overrides;

  return {
    commandId: brand<CommandId>("command-loan-take"),
    gameId: state.gameId,
    actorId: owner,
    expectedRevision: state.revision,
    type: "loan.take",
    payload: { principal: principal ?? 1000 },
    ...rest,
  };
}

function repayCommand(
  state: GameState,
  overrides: Partial<RepayLoanCommand> & {
    readonly loanId?: string;
    readonly amount?: number;
  } = {},
): RepayLoanCommand {
  const { loanId, amount, ...rest } = overrides;

  return {
    commandId: brand<CommandId>("command-loan-repay"),
    gameId: state.gameId,
    actorId: owner,
    expectedRevision: state.revision,
    type: "loan.repay",
    payload: { loanId: brand<LoanId>(loanId ?? "loan-owner"), amount: amount ?? 250 },
    ...rest,
  };
}

function accepted(result: TransitionResult): GameState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value.state;
}

function rejectedWith(result: TransitionResult, code: string): void {
  expect(result).toEqual(
    expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) }),
  );
}

describe("loan.take", () => {
  it("Given a player on their own turn with headroom, When they borrow, Then the principal lands in their balance and the debt is recorded", () => {
    const state = economyState({ round: 2, players: { [owner]: { money: 100 } } });

    const next = accepted(takeLoan(state, takeCommand(state, { principal: 1500 }), context));
    const borrower = next.players[owner];

    expect(findMoney(borrower!)?.resource.value).toBe(1600);
    expect(borrower?.loans).toHaveLength(1);
    expect(borrower?.loans[0]).toEqual(
      expect.objectContaining({
        principal: 1500,
        outstanding: 1500,
        interestBasisPoints: economyRules.economy.interestBasisPoints,
        takenAtRound: 2,
      }),
    );
    expect(next.revision).toBe(state.revision + 1);
  });

  it("Given a loan is taken, When the events are read, Then the drawdown is reported as a resource change the log can fold", () => {
    const state = economyState({ players: { [owner]: { money: 0 } } });

    const result = takeLoan(state, takeCommand(state, { principal: 800 }), context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.events).toHaveLength(1);
    expect(result.value.events[0]).toEqual(
      expect.objectContaining({
        type: "ResourceChanged",
        payload: expect.objectContaining({
          playerId: owner,
          previousValue: 0,
          newValue: 800,
          reason: "loan-principal",
        }),
      }),
    );
  });

  it("Given it is another player's turn, When a player tries to borrow, Then the command is rejected", () => {
    const state = economyState({ activePlayerId: hiddenOpponent, players: { [owner]: { money: 0 } } });

    rejectedWith(takeLoan(state, takeCommand(state), context), "NOT_ACTOR_TURN");
  });

  it("Given an actor who is not in the game, When they try to borrow, Then the command is rejected — even if the turn somehow names them", () => {
    const state = economyState();
    const intruder = brand<PlayerId>("player-intruder");

    rejectedWith(
      takeLoan(state, takeCommand(state, { actorId: intruder }), context),
      "ACTOR_NOT_FOUND",
    );
    rejectedWith(
      takeLoan(
        { ...state, turn: { ...state.turn, activePlayerId: intruder } },
        takeCommand(state, { actorId: intruder }),
        context,
      ),
      "ACTOR_NOT_FOUND",
    );
  });

  it("Given an eliminated player, When they try to borrow, Then the command is rejected", () => {
    const state = economyState({ eliminatedPlayerIds: [owner] });

    rejectedWith(takeLoan(state, takeCommand(state), context), "ACTOR_NOT_AUTHORIZED");
  });

  it("Given a mode with lending switched off, When a player tries to borrow, Then the command is rejected", () => {
    const state = economyState({ rules: { economy: { loansEnabled: false } } });

    rejectedWith(takeLoan(state, takeCommand(state), context), "ILLEGAL_ACTION");
  });

  it("Given a game that is not active, When a player tries to borrow, Then the command is rejected", () => {
    const state = economyState();

    rejectedWith(
      takeLoan({ ...state, status: "ended" }, takeCommand(state), context),
      "GAME_NOT_ACTIVE",
    );
  });

  it("Given a request past the mode's debt ceiling, When a player tries to borrow, Then the command is rejected and no partial loan is written", () => {
    const ceiling = economyRules.economy.maxLoanPrincipal;
    const state = economyState({ players: { [owner]: { money: 0 } } });

    rejectedWith(
      takeLoan(state, takeCommand(state, { principal: ceiling + 1 }), context),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a debt ceiling, When it is approached in several draws, Then the ceiling caps total outstanding rather than each draw", () => {
    const ceiling = economyRules.economy.maxLoanPrincipal;
    const state = economyState({ players: { [owner]: { money: 0 } } });

    const first = accepted(takeLoan(state, takeCommand(state, { principal: ceiling }), context));
    const second = takeLoan(
      first,
      takeCommand(first, {
        commandId: brand<CommandId>("command-loan-take-2"),
        principal: 1,
      }),
      context,
    );

    expect(loanCapacity(first.players[owner]!, first.rules)).toBe(0);
    rejectedWith(second, "ILLEGAL_ACTION");
  });

  it.each([0, -100, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "Given a principal of %p, When a player tries to borrow, Then the command is rejected as malformed",
    (principal) => {
      const state = economyState();

      rejectedWith(takeLoan(state, takeCommand(state, { principal }), context), "INVALID_COMMAND");
    },
  );

  it("Given the same state and two different command ids, When each borrows, Then the loan id is identical — it is never derived from the client's command id", () => {
    const state = economyState({ players: { [owner]: { money: 0 } } });

    const first = accepted(takeLoan(state, takeCommand(state, { commandId: brand<CommandId>("a") }), context));
    const second = accepted(takeLoan(state, takeCommand(state, { commandId: brand<CommandId>("b") }), context));

    expect(second.players[owner]?.loans[0]?.id).toBe(first.players[owner]?.loans[0]?.id);
  });

  it("Given a deeply frozen state, When the same borrow is applied twice, Then the input is untouched and both results are byte-identical", () => {
    const source = economyState({ players: { [owner]: { money: 250 } } });
    const frozen = deepFreeze(structuredClone(source));

    const first = takeLoan(frozen, takeCommand(frozen, { principal: 700 }), context);
    const second = takeLoan(frozen, takeCommand(frozen, { principal: 700 }), context);

    expect(stableStringify(second)).toBe(stableStringify(first));
    expect(stableStringify(frozen)).toBe(stableStringify(source));
  });

  it("Given a borrowed loan, When the state is serialized, Then it round-trips unchanged", () => {
    const state = economyState({ players: { [owner]: { money: 250 } } });

    const next = accepted(takeLoan(state, takeCommand(state, { principal: 700 }), context));

    const serialized = serializeGameState(next);
    expect(deserializeGameState(serialized)).toEqual(next);
    expect(serializeGameState(deserializeGameState(serialized))).toBe(serialized);
  });
});

describe("loan.repay", () => {
  it("Given money and an open loan, When part of it is repaid, Then the balance and the debt both fall", () => {
    const state = economyState({
      players: { [owner]: { money: 900, loans: [loan("loan-owner", { outstanding: 1000 })] } },
    });

    const next = accepted(repayLoan(state, repayCommand(state, { amount: 250 }), context));

    expect(next.players[owner]?.resources.money?.value).toBe(650);
    expect(next.players[owner]?.loans[0]?.outstanding).toBe(750);
    expect(next.players[owner]?.loans[0]?.principal).toBe(1000);
  });

  it("Given a loan repaid in full, When it settles, Then the loan leaves the record entirely", () => {
    const state = economyState({
      players: { [owner]: { money: 900, loans: [loan("loan-owner", { outstanding: 400 })] } },
    });

    const next = accepted(repayLoan(state, repayCommand(state, { amount: 400 }), context));

    expect(next.players[owner]?.loans).toEqual([]);
    expect(totalOutstandingDebt(next.players[owner]!)).toBe(0);
  });

  it("Given another player's loan, When a player names its id, Then the command is refused as unauthorised and that loan is untouched", () => {
    const state = economyState({
      players: {
        [owner]: { money: 5000 },
        [hiddenOpponent]: { money: 0, loans: [loan("loan-hidden", { outstanding: 1000 })] },
      },
    });

    const result = repayLoan(state, repayCommand(state, { loanId: "loan-hidden", amount: 100 }), context);

    rejectedWith(result, "ACTOR_NOT_AUTHORIZED");
    // A rejection returns no state at all, so the victim's debt cannot have moved.
    expect(result.ok).toBe(false);
    expect(state.players[hiddenOpponent]?.loans[0]?.outstanding).toBe(1000);
  });

  it("Given a loan id nobody holds, When it is repaid, Then the command is refused", () => {
    const state = economyState({ players: { [owner]: { money: 900 } } });

    rejectedWith(
      repayLoan(state, repayCommand(state, { loanId: "loan-nowhere" }), context),
      "ILLEGAL_ACTION",
    );
  });

  it("Given it is another player's turn, When a player tries to repay their own loan, Then the command is rejected", () => {
    const state = economyState({
      activePlayerId: hiddenOpponent,
      players: { [owner]: { money: 900, loans: [loan("loan-owner")] } },
    });

    rejectedWith(repayLoan(state, repayCommand(state), context), "NOT_ACTOR_TURN");
  });

  it("Given a mode with lending switched off, When a player tries to repay, Then the command is rejected", () => {
    const state = economyState({
      rules: { economy: { loansEnabled: false } },
      players: { [owner]: { money: 900, loans: [loan("loan-owner")] } },
    });

    rejectedWith(repayLoan(state, repayCommand(state), context), "ILLEGAL_ACTION");
  });

  it("Given less money than the repayment, When a player tries to repay, Then the command is rejected for insufficient funds", () => {
    const state = economyState({
      players: { [owner]: { money: 100, loans: [loan("loan-owner", { outstanding: 1000 })] } },
    });

    rejectedWith(repayLoan(state, repayCommand(state, { amount: 250 }), context), "INSUFFICIENT_RESOURCE");
  });

  it("Given a repayment larger than the balance owed, When a player tries to overpay, Then the command is rejected", () => {
    const state = economyState({
      players: { [owner]: { money: 5000, loans: [loan("loan-owner", { outstanding: 300 })] } },
    });

    rejectedWith(repayLoan(state, repayCommand(state, { amount: 301 }), context), "ILLEGAL_ACTION");
  });

  it.each([0, -50, 33.3, Number.NaN])(
    "Given a repayment of %p, When a player tries to repay, Then the command is rejected as malformed",
    (amount) => {
      const state = economyState({
        players: { [owner]: { money: 5000, loans: [loan("loan-owner")] } },
      });

      rejectedWith(repayLoan(state, repayCommand(state, { amount }), context), "INVALID_COMMAND");
    },
  );

  it("Given a repayment, When the state is serialized, Then it round-trips unchanged", () => {
    const state = economyState({
      players: { [owner]: { money: 900, loans: [loan("loan-owner", { outstanding: 1000 })] } },
    });

    const next = accepted(repayLoan(state, repayCommand(state, { amount: 250 }), context));

    const serialized = serializeGameState(next);
    expect(deserializeGameState(serialized)).toEqual(next);
    expect(serializeGameState(deserializeGameState(serialized))).toBe(serialized);
  });
});

describe("interest", () => {
  it("Given an open loan, When a round accrues, Then the outstanding balance compounds at the loan's own rate", () => {
    const state = economyState({
      players: { [owner]: { loans: [loan("loan-owner", { outstanding: 1000, interestBasisPoints: 1000 })] } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const once = accrueLoanInterest(player, state.rules);
    const twice = accrueLoanInterest(once.player, state.rules);

    expect(once.accrued).toBe(100);
    expect(once.player.loans[0]?.outstanding).toBe(1100);
    expect(twice.player.loans[0]?.outstanding).toBe(1210);
    // The principal is the historical record of what was drawn, not a balance.
    expect(twice.player.loans[0]?.principal).toBe(1000);
  });

  it("Given a rate written onto the loan, When the ruleset's rate differs, Then the loan compounds at the rate it was written at", () => {
    const state = economyState({
      rules: { economy: { interestBasisPoints: 9000 } },
      players: { [owner]: { loans: [loan("loan-owner", { outstanding: 1000, interestBasisPoints: 500 })] } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    expect(accrueLoanInterest(player, state.rules).accrued).toBe(50);
  });

  it("Given a debt small enough to round to nothing, When interest accrues, Then it still costs a unit rather than being free", () => {
    const state = economyState({
      players: { [owner]: { loans: [loan("loan-owner", { outstanding: 1, interestBasisPoints: 1 })] } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    expect(accrueLoanInterest(player, state.rules).accrued).toBe(1);
  });

  it("Given a mode with lending switched off, When interest would accrue, Then nothing compounds", () => {
    const state = economyState({
      rules: { economy: { loansEnabled: false } },
      players: { [owner]: { loans: [loan("loan-owner", { outstanding: 1000 })] } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    expect(accrueLoanInterest(player, state.rules).accrued).toBe(0);
    expect(interestPerRound(player, state.rules)).toBe(0);
    expect(loanCapacity(player, state.rules)).toBe(0);
  });

  it("Given a zero-rate ruleset, When interest would accrue, Then the debt stays exactly where it was", () => {
    const state = economyState({
      players: { [owner]: { loans: [loan("loan-owner", { outstanding: 1000, interestBasisPoints: 0 })] } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const accrual = accrueLoanInterest(player, state.rules);

    expect(accrual.accrued).toBe(0);
    expect(accrual.player).toBe(player);
  });
});
