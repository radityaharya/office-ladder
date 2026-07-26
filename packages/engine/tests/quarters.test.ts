import { describe, expect, it } from "vitest";

import { stableStringify } from "../src";
import type { AdvanceQuarterCommand, CommandId, GameState, PlayerId } from "../src";
import {
  activeQuarterModifiers,
  advanceQuarter,
  advanceQuarterForRound,
  announcedQuarterEventId,
  initialiseQuarterSchedule,
  NEUTRAL_QUARTER_MODIFIERS,
  pendingQuarterIndex,
  quartersElapsed,
  resolveGlobalEventScope,
  scheduledEventForQuarter,
  standingOrder,
} from "../src/execution/quarters";
import { fixtureIds } from "./fixtures";
import {
  campaignRules,
  content,
  deepFreeze,
  jsonRoundTrip,
  quickRules,
  standardRules,
  tableState,
} from "./quarter-objective-fixtures";
import { logicalTimestamp, withRules } from "./turn-loop-fixtures";

const branded = <Id extends string>(value: string) => value as Id;

/** Not a seat: the only signal a pure engine has for "the server sent this". */
const SERVER_ACTOR: PlayerId = branded("actor.server");

function advanceCommand(
  state: GameState,
  overrides: Partial<AdvanceQuarterCommand> = {},
): AdvanceQuarterCommand {
  return {
    commandId: branded<CommandId>("command-quarter-advance"),
    gameId: state.gameId,
    actorId: SERVER_ACTOR,
    expectedRevision: state.revision,
    type: "quarter.advance",
    payload: {},
    ...overrides,
  };
}

/** A state sitting in quarter 0 with the schedule initialised, ready to turn over. */
function scheduled(state: GameState = tableState(standardRules)): GameState {
  return { ...state, quarters: initialiseQuarterSchedule(state, content) };
}

/** Puts a specific announced event on the quarter the track is about to enter. */
function announcing(state: GameState, eventId: string): GameState {
  return {
    ...state,
    quarters: state.quarters.map((quarter) =>
      quarter.index === state.currentQuarterIndex + 1
        ? { ...quarter, scheduledEventId: eventId }
        : quarter,
    ),
  };
}

function context(timestamp = logicalTimestamp) {
  return { logicalTimestamp: timestamp, content };
}

describe("quarters — schedule and announcement", () => {
  it("Given a fresh match, When the schedule is initialised, Then exactly the next quarter's event is announced", () => {
    const state = tableState(standardRules);

    const quarters = initialiseQuarterSchedule(state, content);

    expect(quarters[0]?.scheduledEventId).toBeNull();
    expect(quarters[1]?.scheduledEventId).toBe("globalEvent.bonus-season");
    // A quarter ahead means *one* quarter ahead: the rest of the rotation is not
    // visible yet.
    expect(quarters[2]?.scheduledEventId).toBeNull();
    expect(quarters[3]?.scheduledEventId).toBeNull();
  });

  it("Given the authored rotation, When a quarter index is asked for its event, Then the first quarter has none and later ones wrap", () => {
    expect(scheduledEventForQuarter(content, 0)).toBeNull();
    expect(scheduledEventForQuarter(content, 1)).toBe("globalEvent.bonus-season");
    expect(scheduledEventForQuarter(content, 6)).toBe("globalEvent.audit-season");
    // mode.campaign runs eight quarters against a six-event rotation.
    expect(scheduledEventForQuarter(content, 7)).toBe("globalEvent.bonus-season");
  });

  it("Given global events switched off, When the schedule is initialised, Then nothing is ever announced", () => {
    const state = withRules(tableState(standardRules), {
      quarters: { ...standardRules.quarters, globalEvents: false },
    });

    const quarters = initialiseQuarterSchedule(state, content);

    expect(quarters.every((quarter) => quarter.scheduledEventId === null)).toBe(true);
  });

  it("Given quarters switched off, When the schedule is initialised, Then there is no schedule at all", () => {
    const state = tableState(quickRules);

    expect(state.quarters).toEqual([]);
    expect(initialiseQuarterSchedule(state, content)).toEqual([]);
    expect(pendingQuarterIndex(state, 99)).toBeNull();
    expect(quartersElapsed(state, 99)).toBe(false);
    expect(activeQuarterModifiers(state, content)).toEqual(NEUTRAL_QUARTER_MODIFIERS);
  });

  it("Given an announced but unresolved event, When the table asks what is in force, Then nothing is — a warning is not a shock", () => {
    const state = scheduled();

    expect(announcedQuarterEventId(state)).toBe("globalEvent.bonus-season");
    expect(activeQuarterModifiers(state, content)).toEqual(NEUTRAL_QUARTER_MODIFIERS);
  });
});

describe("quarters — advancing", () => {
  it("Given a round inside the current quarter, When an advance is attempted, Then nothing is due", () => {
    const state = scheduled();

    expect(pendingQuarterIndex(state, 4)).toBeNull();
    expect(advanceQuarterForRound(state, content, 4)).toBeNull();
  });

  it("Given a round past the current quarter, When the track advances, Then the announced event resolves and the next one is announced", () => {
    const state = scheduled();

    const advance = advanceQuarterForRound(state, content, 5);

    expect(advance).not.toBeNull();
    expect(advance?.currentQuarterIndex).toBe(1);
    expect(advance?.resolvedEventId).toBe("globalEvent.bonus-season");
    expect(advance?.quarters[1]?.resolvedEventIds).toEqual(["globalEvent.bonus-season"]);
    expect(advance?.announcedEventId).toBe("globalEvent.budget-freeze");
    expect(advance?.announcedForQuarterIndex).toBe(2);
    expect(advance?.quarters[2]?.scheduledEventId).toBe("globalEvent.budget-freeze");
    expect(advance?.quarters[3]?.scheduledEventId).toBeNull();
  });

  it("Given the track has already advanced, When the same round advances it again, Then nothing is due and no event resolves twice", () => {
    const state = scheduled();
    const first = advanceQuarterForRound(state, content, 5);
    if (first === null) throw new Error("expected the first advance to be due");
    const advanced: GameState = {
      ...state,
      quarters: first.quarters,
      currentQuarterIndex: first.currentQuarterIndex,
      players: first.players,
    };

    expect(advanceQuarterForRound(advanced, content, 5)).toBeNull();
    expect(advanced.quarters[1]?.resolvedEventIds).toEqual(["globalEvent.bonus-season"]);
  });

  it("Given an event already listed as resolved, When its quarter is entered again, Then it is not applied a second time", () => {
    const base = scheduled();
    const state: GameState = {
      ...base,
      quarters: base.quarters.map((quarter) =>
        quarter.index === 1
          ? { ...quarter, resolvedEventIds: ["globalEvent.bonus-season"] }
          : quarter,
      ),
    };

    const advance = advanceQuarterForRound(state, content, 5);

    expect(advance?.resolvedEventId).toBeNull();
    expect(advance?.changes).toEqual([]);
    expect(advance?.quarters[1]?.resolvedEventIds).toEqual(["globalEvent.bonus-season"]);
  });

  it("Given global events off but quarters on, When the track advances, Then the clock moves and no event lands", () => {
    const state = withRules(tableState(standardRules), {
      quarters: { ...standardRules.quarters, globalEvents: false },
    });

    const advance = advanceQuarterForRound(state, content, 5);

    expect(advance?.currentQuarterIndex).toBe(1);
    expect(advance?.resolvedEventId).toBeNull();
    expect(advance?.announcedEventId).toBeNull();
    expect(advance?.changes).toEqual([]);
  });

  it("Given the last quarter, When its final round passes, Then the schedule has elapsed and there is nothing to advance into", () => {
    const state = { ...scheduled(), currentQuarterIndex: 3 };

    expect(quartersElapsed(state, 16)).toBe(false);
    expect(quartersElapsed(state, 17)).toBe(true);
    expect(pendingQuarterIndex(state, 17)).toBeNull();
    expect(advanceQuarterForRound(state, content, 17)).toBeNull();
  });

  it("Given a campaign's eight quarters, When the track runs to the end, Then the rotation wraps and every quarter resolves exactly one event", () => {
    let state = scheduled(tableState(campaignRules));
    const resolved: string[] = [];

    for (let quarter = 1; quarter < campaignRules.quarters.count; quarter += 1) {
      const round = quarter * campaignRules.quarters.roundsEach + 1;
      const advance = advanceQuarterForRound(state, content, round);
      if (advance === null) throw new Error(`quarter ${quarter} was not due at round ${round}`);
      resolved.push(String(advance.resolvedEventId));
      state = {
        ...state,
        quarters: advance.quarters,
        currentQuarterIndex: advance.currentQuarterIndex,
        players: advance.players,
        turn: { ...state.turn, round },
      };
    }

    expect(resolved).toEqual([
      "globalEvent.bonus-season",
      "globalEvent.budget-freeze",
      "globalEvent.reorg",
      "globalEvent.layoffs",
      "globalEvent.merger-rumour",
      "globalEvent.audit-season",
      "globalEvent.bonus-season",
    ]);
    expect(
      state.quarters.every((quarter) => quarter.resolvedEventIds.length <= 1),
    ).toBe(true);
  });
});

describe("quarters — global event effects", () => {
  it("Given bonus season, When it resolves, Then every seat is paid its rank salary at the event's own multiplier and upkeep is suspended", () => {
    const state = scheduled(
      tableState(standardRules, {
        [fixtureIds.owner]: { rankIndex: 1, rankKind: "rank.staff", wallet: { money: 100 } },
      }),
    );

    const advance = advanceQuarterForRound(state, content, 5);
    if (advance === null) throw new Error("expected bonus season to be due");
    const after: GameState = {
      ...state,
      quarters: advance.quarters,
      currentQuarterIndex: advance.currentQuarterIndex,
      players: advance.players,
    };

    // rank.staff salary 400 x the event's own multiplySalary 1.5.
    expect(advance.players[fixtureIds.owner]?.resources.money?.value).toBe(700);
    // Every seat is in scope, and the reputation bump lands too.
    expect(advance.players[fixtureIds.hiddenOpponent]?.resources.reputation?.value).toBe(1);
    expect(activeQuarterModifiers(after, content)).toMatchObject({
      upkeepSuspended: true,
      salaryMultiplier: 1.5,
      promotionsBlocked: false,
    });
  });

  it("Given a budget freeze and a player who cannot cover the sweep, When it resolves, Then they pay what they have and never go negative", () => {
    const state = announcing(
      scheduled(
        tableState(standardRules, {
          [fixtureIds.owner]: { wallet: { money: 100 } },
          [fixtureIds.hiddenOpponent]: { wallet: { money: 0 } },
        }),
      ),
      "globalEvent.budget-freeze",
    );

    const advance = advanceQuarterForRound(state, content, 5);
    if (advance === null) throw new Error("expected the budget freeze to be due");
    const after: GameState = {
      ...state,
      quarters: advance.quarters,
      currentQuarterIndex: advance.currentQuarterIndex,
      players: advance.players,
    };

    expect(advance.players[fixtureIds.owner]?.resources.money?.value).toBe(0);
    expect(advance.players[fixtureIds.hiddenOpponent]?.resources.money?.value).toBe(0);
    // The seat that had nothing to take produces no change event at all.
    expect(advance.changes.map((change) => change.playerId)).toEqual([
      fixtureIds.owner,
      fixtureIds.revealedOpponent,
    ]);
    expect(activeQuarterModifiers(after, content)).toMatchObject({
      promotionsBlocked: true,
      loansBlocked: true,
      salaryMultiplier: 0.5,
    });
  });

  it("Given layoffs, When they resolve, Then the lowest-reputation seat is demoted rather than removed, and its upkeep follows", () => {
    const state = announcing(
      scheduled(
        tableState(standardRules, {
          [fixtureIds.owner]: { rankIndex: 3, rankKind: "rank.supervisor", wallet: { reputation: 9 } },
          [fixtureIds.hiddenOpponent]: {
            rankIndex: 2,
            rankKind: "rank.senior-staff",
            wallet: { reputation: 1 },
          },
          [fixtureIds.revealedOpponent]: {
            rankIndex: 4,
            rankKind: "rank.assistant-manager",
            wallet: { reputation: 12 },
          },
        }),
      ),
      "globalEvent.layoffs",
    );

    const advance = advanceQuarterForRound(state, content, 5);

    expect(advance?.demotion).toMatchObject({
      playerId: fixtureIds.hiddenOpponent,
      fromRankIndex: 2,
      toRankIndex: 1,
    });
    expect(advance?.players[fixtureIds.hiddenOpponent]?.rank.kind).toBe("rank.staff");
    expect(advance?.players[fixtureIds.hiddenOpponent]?.upkeep.perRound).toBe(
      standardRules.economy.upkeepByRankIndex[1],
    );
    expect(state.eliminatedPlayerIds).toEqual([]);
  });

  it("Given an audit season, When it resolves, Then only the seats carrying heat are touched", () => {
    const state = announcing(
      scheduled(
        tableState(standardRules, {
          [fixtureIds.owner]: { wallet: { money: 2000 }, heat: 2 },
          [fixtureIds.hiddenOpponent]: { wallet: { money: 2000 }, heat: 0 },
          [fixtureIds.revealedOpponent]: { wallet: { money: 2000 }, heat: 1 },
        }),
      ),
      "globalEvent.audit-season",
    );

    const advance = advanceQuarterForRound(state, content, 5);

    expect(advance?.changes.map((change) => change.playerId)).toEqual([
      fixtureIds.owner,
      fixtureIds.revealedOpponent,
    ]);
    expect(advance?.players[fixtureIds.hiddenOpponent]?.resources.money?.value).toBe(2000);
    expect(advance?.players[fixtureIds.owner]?.resources.money?.value).toBe(1500);
  });

  it("Given a reorg, When it resolves, Then its per-player dice draw is a function of state alone", () => {
    const state = announcing(scheduled(), "globalEvent.reorg");

    const live = advanceQuarterForRound(state, content, 5);
    const again = advanceQuarterForRound(state, content, 5);
    const restored = advanceQuarterForRound(jsonRoundTrip(state), content, 5);

    expect(stableStringify(again)).toBe(stableStringify(live));
    expect(stableStringify(restored)).toBe(stableStringify(live));
  });

  it("Given a state that is frozen, When a quarter advances, Then the input is not mutated", () => {
    const state = deepFreeze(structuredClone(scheduled()));

    const advance = advanceQuarterForRound(state, content, 5);

    expect(advance).not.toBeNull();
    expect(state.currentQuarterIndex).toBe(0);
    expect(state.quarters[1]?.resolvedEventIds).toEqual([]);
  });
});

describe("quarters — scope resolution", () => {
  const table = tableState(standardRules, {
    [fixtureIds.owner]: { rankIndex: 1, wallet: { money: 500 }, heat: 1 },
    [fixtureIds.hiddenOpponent]: { rankIndex: 3, wallet: { money: 100 } },
    [fixtureIds.revealedOpponent]: { rankIndex: 0, wallet: { money: 9000 } },
  });

  it("Given a table, When standing is resolved, Then rank leads, then money, then seat order", () => {
    expect(standingOrder(table)).toEqual([
      fixtureIds.hiddenOpponent,
      fixtureIds.owner,
      fixtureIds.revealedOpponent,
    ]);
  });

  it("Given identical players, When standing is resolved, Then seat order decides and survives the persistence boundary", () => {
    const level = tableState(standardRules);

    expect(standingOrder(level)).toEqual([...level.playerOrder]);
    expect(standingOrder(jsonRoundTrip(level))).toEqual(standingOrder(level));
  });

  it("Given each authored scope, When it is resolved, Then the right seats come back in seat order", () => {
    expect(resolveGlobalEventScope(table, "all-players")).toEqual([...table.playerOrder]);
    expect(resolveGlobalEventScope(table, "leader")).toEqual([fixtureIds.hiddenOpponent]);
    expect(resolveGlobalEventScope(table, "trailing-players")).toEqual([
      fixtureIds.revealedOpponent,
    ]);
    expect(resolveGlobalEventScope(table, "players-with-heat")).toEqual([fixtureIds.owner]);
    expect(resolveGlobalEventScope(table, "players-in-debt")).toEqual([]);
  });

  it("Given an eliminated seat, When any scope is resolved, Then it is never in it", () => {
    const state: GameState = { ...table, eliminatedPlayerIds: [fixtureIds.hiddenOpponent] };

    expect(resolveGlobalEventScope(state, "all-players")).toEqual([
      fixtureIds.owner,
      fixtureIds.revealedOpponent,
    ]);
    expect(resolveGlobalEventScope(state, "leader")).toEqual([fixtureIds.owner]);
  });

  it("Given a player carrying a loan, When the in-debt scope is resolved, Then they are in it", () => {
    const state: GameState = {
      ...table,
      players: {
        ...table.players,
        [fixtureIds.owner]: {
          ...table.players[fixtureIds.owner],
          loans: [
            {
              id: branded("loan-1"),
              principal: 500,
              outstanding: 500,
              interestBasisPoints: 1000,
              takenAtRound: 1,
            },
          ],
        },
      },
    };

    expect(resolveGlobalEventScope(state, "players-in-debt")).toEqual([fixtureIds.owner]);
  });
});

describe("quarters — the quarter.advance command", () => {
  it("Given a seated player, When they submit quarter.advance, Then it is rejected before anything is read", () => {
    const state = { ...scheduled(), turn: { ...scheduled().turn, round: 5 } };

    const result = advanceQuarter(
      state,
      advanceCommand(state, { actorId: fixtureIds.owner }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("a seated player must not advance the quarter track");
    expect(result.error.code).toBe("ACTOR_NOT_AUTHORIZED");
  });

  it("Given every seat in turn, When each submits quarter.advance, Then none of them can move the track", () => {
    const state = { ...scheduled(), turn: { ...scheduled().turn, round: 5 } };

    for (const actorId of state.playerOrder) {
      const result = advanceQuarter(state, advanceCommand(state, { actorId }), context());
      expect(result.ok).toBe(false);
    }
  });

  it("Given the server, When it submits quarter.advance at a due round, Then the track moves and the changes are reported as events", () => {
    const base = scheduled();
    const state: GameState = { ...base, turn: { ...base.turn, round: 5 } };

    const result = advanceQuarter(state, advanceCommand(state), context());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.state.currentQuarterIndex).toBe(1);
    expect(result.value.state.revision).toBe(state.revision + 1);
    expect(result.value.state.lastCommandId).toBe("command-quarter-advance");
    expect(result.value.events.length).toBeGreaterThan(0);
    expect(result.value.events.every((event) => event.type === "ResourceChanged")).toBe(true);
    expect(result.value.events[0]).toMatchObject({
      payload: { reason: "global-event:globalEvent.bonus-season" },
    });
  });

  it("Given no quarter is due, When the server submits quarter.advance, Then it is refused rather than applied", () => {
    const state = scheduled();

    const result = advanceQuarter(state, advanceCommand(state), context());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("an undue advance must be refused");
    expect(result.error.code).toBe("ILLEGAL_ACTION");
  });

  it("Given a ruleset without quarters, When the server submits quarter.advance, Then it is refused", () => {
    const state = tableState(quickRules);

    const result = advanceQuarter(state, advanceCommand(state), context());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("a quarterless ruleset must refuse the command");
    expect(result.error.code).toBe("ILLEGAL_ACTION");
  });

  it("Given a match that is not active, When the server submits quarter.advance, Then it is refused", () => {
    const base = scheduled();
    const state: GameState = { ...base, status: "ended", turn: { ...base.turn, round: 5 } };

    const result = advanceQuarter(state, advanceCommand(state), context());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("an ended match must refuse the command");
    expect(result.error.code).toBe("GAME_NOT_ACTIVE");
  });

  it("Given the same command twice, When it is applied to the state it produced, Then the second is refused and nothing double-resolves", () => {
    const base = scheduled();
    const state: GameState = { ...base, turn: { ...base.turn, round: 5 } };

    const first = advanceQuarter(state, advanceCommand(state), context());
    if (!first.ok) throw new Error(first.error.message);
    const second = advanceQuarter(
      first.value.state,
      advanceCommand(first.value.state, { commandId: branded<CommandId>("command-again") }),
      context(),
    );

    expect(second.ok).toBe(false);
    expect(first.value.state.quarters[1]?.resolvedEventIds).toEqual([
      "globalEvent.bonus-season",
    ]);
  });

  it("Given the produced state, When it goes through the persistence boundary, Then it round-trips unchanged", () => {
    const base = scheduled();
    const state: GameState = { ...base, turn: { ...base.turn, round: 5 } };

    const result = advanceQuarter(state, advanceCommand(state), context());
    if (!result.ok) throw new Error(result.error.message);

    expect(jsonRoundTrip(result.value.state)).toEqual(result.value.state);
  });

  it("Given two different logical timestamps, When the same advance is applied, Then only the timestamps differ", () => {
    const base = scheduled();
    const state: GameState = { ...base, turn: { ...base.turn, round: 5 } };

    const early = advanceQuarter(state, advanceCommand(state), context("2020-01-01T00:00:00.000Z"));
    const late = advanceQuarter(state, advanceCommand(state), context("2099-12-31T23:59:59.000Z"));
    if (!early.ok || !late.ok) throw new Error("the advance was rejected");

    const strip = (value: string) =>
      value.replaceAll("2020-01-01T00:00:00.000Z", "T").replaceAll("2099-12-31T23:59:59.000Z", "T");
    expect(strip(stableStringify(late.value.state))).toBe(
      strip(stableStringify(early.value.state)),
    );
    expect(strip(stableStringify(late.value.events))).toBe(
      strip(stableStringify(early.value.events)),
    );
  });
});
