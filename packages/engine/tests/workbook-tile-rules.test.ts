import { describe, expect, it } from "vitest";

import type { BoardTile } from "@office-ladder/content";
import { deadlineDashContent } from "@office-ladder/content";

import { applyCommand, createScriptedRandomSource } from "../src";
import type { CommandId, GameEvent, GameState, PlayerState, ResourceId } from "../src";
import { resolveTileEffects } from "../src/execution/resolve-tile-effects";
import {
  accepted,
  boardIndexOfKind,
  context,
  rollCommand,
  rollState,
} from "./turn-loop-fixtures";
import { fixtureIds } from "./fixtures";

const brand = <Id extends string>(value: string) => value as Id;

/**
 * A derived index cannot narrow the authored `as const` tuple, so the board is
 * read through the schema type — which is also what the engine itself sees.
 */
const spaces: readonly BoardTile[] = deadlineDashContent.board.spaces;

function tileOfKind(kind: BoardTile["kind"]): BoardTile {
  const tile = spaces[boardIndexOfKind(kind)];
  if (tile === undefined) throw new Error(`no authored tile of kind ${kind}`);
  return tile;
}

function ownerFixture(): PlayerState {
  const owner = rollState(0).players[fixtureIds.owner];
  if (owner === undefined) throw new Error("fixture missing owner player");
  return owner;
}

/** The canonical fixture owner holds money only; reputation is added per test. */
function withReputation(player: PlayerState, value: number): PlayerState {
  return {
    ...player,
    resources: {
      ...player.resources,
      reputation: {
        id: brand<ResourceId>("resource-owner-reputation"),
        kind: "resource.reputation",
        value,
        minimum: 0,
        maximum: null,
      },
    },
  };
}

function reputation(player: PlayerState): number | undefined {
  return player.resources.reputation?.value;
}

function handTurnBackToOwner(state: GameState): GameState {
  return {
    ...state,
    turn: { ...state.turn, activePlayerId: fixtureIds.owner, phase: "pre-roll" },
  };
}

/**
 * The canonical fixture also hands the owner two unrelated statuses, so this
 * looks the one under test up by id rather than counting the list.
 */
function multiplierStatus(state: GameState) {
  return (
    state.players[fixtureIds.owner]?.statuses.find(
      (candidate) => candidate.id === "status.next-salary-multiplier",
    ) ?? null
  );
}

function withDiceStreamState(state: GameState, value: string): GameState {
  const dice = state.rng.streams.dice;
  if (dice === undefined) throw new Error("fixture missing a dice stream");

  return {
    ...state,
    rng: { streams: { ...state.rng.streams, dice: { ...dice, state: value } } },
  };
}

/**
 * The first variant of `base` whose Sales landing produces `multiplier`.
 *
 * Which authored band the tile's 2d6 lands in is decided by the ephemeral
 * tile-effect source, which is seeded from server-owned canonical state — so the
 * dice stream's state is the only knob a test may legitimately turn to reach a
 * chosen band (see ephemeral-random.ts: a client-supplied value must never steer
 * an outcome, and pinning one here would re-encode that).
 */
function stateApplyingSalesMultiplier(base: GameState, multiplier: number): GameState {
  for (let candidate = 1; candidate <= 400; candidate += 1) {
    const attempt = withDiceStreamState(base, String(candidate));
    const result = applyCommand(attempt, rollCommand(attempt), context([0]));
    if (!result.ok) continue;
    if (multiplierStatus(result.value.state)?.data["multiplier"] === multiplier) {
      return attempt;
    }
  }

  throw new Error(`no dice-stream state produced a ${multiplier}x Sales bonus`);
}

function salaryAwarded(events: readonly GameEvent[]): number {
  const event = events.find((candidate) => candidate.type === "SalaryAwarded");
  if (event === undefined || event.type !== "SalaryAwarded") {
    throw new Error("expected a SalaryAwarded event");
  }
  return event.payload.amount;
}

/**
 * The HR tile's authored rule, straight from the workbook's Special Rule column:
 * *"1. Double Dices : no effect (safe performance) | 2. Other Number : -1 Rep
 * (bad performance)"* — the rulebooks agree ("HR → Roll 2d6: Doubles = safe,
 * anything else = -1 Rep").
 *
 * Driven through the *authored* effect list with a scripted source rather than a
 * hand-copied literal, so re-authoring the tile is what these cases test.
 */
describe("HR tile — performance feedback", () => {
  it("Given the authored HR tile, When the check rolls true doubles, Then nothing happens and exactly two dice were spent", () => {
    const player = withReputation(ownerFixture(), 3);
    const random = createScriptedRandomSource([0, 0]);

    const outcome = resolveTileEffects(player, tileOfKind("hr").effects, random, "hr", undefined);

    // 1 and 1: doubles, so the safe-performance branch, which is authored empty.
    expect(reputation(outcome.player)).toBe(3);
    expect(outcome.changes).toEqual([]);
    expect(random.getCursor()).toBe(2);
  });

  it("Given the authored HR tile, When the check rolls anything else, Then one reputation is lost", () => {
    const player = withReputation(ownerFixture(), 3);
    const random = createScriptedRandomSource([0, 0.9]);

    const outcome = resolveTileEffects(player, tileOfKind("hr").effects, random, "hr", undefined);

    // 1 and 6: not doubles, and not a doubles-shaped total either — the tile
    // matches on the dice being equal, never on their sum.
    expect(reputation(outcome.player)).toBe(2);
    expect(outcome.changes).toEqual([
      { resource: "reputation", previousValue: 3, newValue: 2 },
    ]);
    expect(random.getCursor()).toBe(2);
  });

  it("Given a player already on zero reputation, When the HR check fails, Then reputation is clamped rather than going negative", () => {
    const player = withReputation(ownerFixture(), 0);

    const outcome = resolveTileEffects(
      player,
      tileOfKind("hr").effects,
      createScriptedRandomSource([0, 0.9]),
      "hr",
      undefined,
    );

    expect(reputation(outcome.player)).toBe(0);
    expect(outcome.changes).toEqual([]);
  });

  it.each([
    ["a matching pair of sixes", [0.9, 0.9], 3],
    ["a pair of threes", [0.4, 0.4], 3],
    ["six then five", [0.9, 0.7], 2],
    ["two then one", [0.2, 0], 2],
  ] as const)(
    "Given %s, When the HR check resolves, Then reputation reflects only whether the dice matched",
    (_label, faces, expected) => {
      const outcome = resolveTileEffects(
        withReputation(ownerFixture(), 3),
        tileOfKind("hr").effects,
        createScriptedRandomSource(faces),
        "hr",
        undefined,
      );

      expect(reputation(outcome.player)).toBe(expected);
    },
  );
});

/**
 * The Work tile's other authored rule: *"5x stops in 'work tiles' = + 1 rep
 * (Accumulate)"*, which GDD:216-219 spells out as never resetting — "ke-5 landing
 * = +1 Rep, ke-10 landing = +1 Rep lagi, ke-15 = +1 Rep lagi".
 */
describe("Work tile — the accumulating work counter", () => {
  function worker(counter: number, reputationValue: number): PlayerState {
    const player = withReputation(ownerFixture(), reputationValue);
    return {
      ...player,
      statuses: [],
      resources: {
        ...player.resources,
        energy: {
          id: brand<ResourceId>("resource-owner-energy"),
          kind: "resource.energy",
          value: 5,
          minimum: 0,
          maximum: 5,
        },
        "work-counter": {
          id: brand<ResourceId>("resource-owner-work-counter"),
          kind: "resource.work-counter",
          value: counter,
          minimum: 0,
          maximum: null,
        },
      },
    };
  }

  /** Resolves the authored Work tile with no deck, so only the tile is under test. */
  function landOnWork(player: PlayerState) {
    return resolveTileEffects(
      player,
      tileOfKind("work").effects,
      createScriptedRandomSource([]),
      "work",
      undefined,
      [],
    );
  }

  it.each([
    ["the fourth landing", 3, 4, 0],
    ["the fifth landing", 4, 5, 1],
    ["the tenth landing", 9, 10, 1],
    ["the fifteenth landing", 14, 15, 1],
    ["the sixteenth landing", 15, 16, 0],
  ] as const)(
    "Given %s, When the player lands on a Work tile, Then the counter advances and the milestone pays only on multiples of five",
    (_label, before, after, gained) => {
      const outcome = landOnWork(worker(before, 2));

      expect(outcome.player.resources["work-counter"]?.value).toBe(after);
      expect(reputation(outcome.player)).toBe(2 + gained);
      // Each landing also spends the workbook's one energy, every time.
      expect(outcome.player.resources.energy?.value).toBe(4);
    },
  );
});

/**
 * The Sales tile's authored rule: *"Roll the dice again to decide bonus: 1 - 9 :
 * 1.5x salary on the next payday | 10 - 12 : 2x salary on the next payday"*
 * (workbook; GDD:163 states the reachable 2-9 form the content encodes).
 *
 * The chain has three independent links — the tile applies a status, the status
 * survives intervening turns, and the salary award reads it — and a typo in the
 * status id would break it silently, with the tile appearing to work and payday
 * quietly unchanged. So this walks the whole thing on the real board.
 */
describe("Sales tile — next-payday multiplier", () => {
  // Both authored bands, because the two are separate authored outcomes and a
  // single run only ever exercises whichever one the seed happens to reach:
  // breaking the 1.5x branch alone is otherwise invisible. The numbers
  // themselves are pinned against the workbook in packages/content's own tests.
  it.each([1.5, 2] as const)(
    "Given a player who lands on Sales for the %sx bonus, When they later reach payday, Then that payday is multiplied and the status is spent",
    (multiplier) => {
    const salesIndex = boardIndexOfKind("sales");
    const state = stateApplyingSalesMultiplier(rollState(salesIndex - 1), multiplier);

    // die = 1 lands on Sales, whose rollCheck comes from the ephemeral
    // per-command source (never the persisted dice stream).
    const landed = accepted(applyCommand(state, rollCommand(state), context([0])));
    expect(landed.state.players[fixtureIds.owner]?.position).toBe(salesIndex);
    // Exactly one die came off the persisted stream: the tile's own 2d6 did not.
    expect(landed.state.rng.streams.dice?.cursor).toBe(1);

    expect(multiplierStatus(landed.state)?.data["multiplier"]).toBe(multiplier);

    // One quiet turn in between, to prove the bonus is held for *payday* and not
    // burned on the next roll: Sales sits ten spaces short of the Receptionist,
    // so it never pays out on the landing turn.
    const quiet = handTurnBackToOwner(landed.state);
    const stepped = accepted(
      applyCommand(
        quiet,
        rollCommand(quiet, { commandId: brand<CommandId>("roll-step") }),
        context([0]),
      ),
    );
    expect(multiplierStatus(stepped.state)).not.toBeNull();

    const payday = handTurnBackToOwner(stepped.state);
    const paid = accepted(
      applyCommand(
        payday,
        rollCommand(payday, { commandId: brand<CommandId>("roll-payday") }),
        context([0.9]),
      ),
    );

    // rank.staff's 400 salary, landing exactly on the Receptionist so no
    // pass bonus is involved, times the authored Sales multiplier.
    expect(paid.state.players[fixtureIds.owner]?.position).toBe(0);
    expect(salaryAwarded(paid.events)).toBe(400 * multiplier);
    // Spent exactly once, on the payday it was promised for.
    expect(multiplierStatus(paid.state)).toBeNull();
    },
  );
});

/**
 * The Receptionist corner, whose workbook row is *"Receive Salary when passing"*
 * with the note *"Another roll (Free energy) if stop in this tile"* — two
 * distinct rules that the rulebooks restate as "Stop = salary + free roll; Pass =
 * salary".
 */
describe("Receptionist corner — payday and the free roll", () => {
  it("Given a player who stops exactly on the Receptionist, When the turn resolves, Then they are paid and keep the turn for another roll", () => {
    const state = rollState(deadlineDashContent.board.spaces.length - 1);

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.players[fixtureIds.owner]?.position).toBe(0);
    // Landing is one salary award, at the rank's own rate.
    expect(salaryAwarded(events)).toBe(400);
    // The free roll: same player, same turn number and round, still pre-roll.
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.owner);
    expect(nextState.turn.number).toBe(state.turn.number);
    expect(nextState.turn.round).toBe(state.turn.round);
    expect(nextState.turn.phase).toBe("pre-roll");
    expect(
      events.filter((event) => event.type === "TurnStarted").map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ playerId: fixtureIds.owner, turnNumber: state.turn.number }),
    ]);
  });

  it("Given a player who passes through the Receptionist without stopping, When the turn resolves, Then they are paid with their rank's pass bonus and the turn moves on", () => {
    const state = rollState(deadlineDashContent.board.spaces.length - 1);

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0.4])),
    );

    // die = 3: through index 0 and on to 2, so this is a pass, not a stop.
    // (Index 1 is the Training tile, whose decision would hold the turn open
    // and make the hand-off assertion below untestable.)
    expect(nextState.players[fixtureIds.owner]?.position).toBe(2);
    // rank.staff's authored benefit is +100 whenever they pass Reception.
    expect(salaryAwarded(events)).toBe(500);
    // No free roll on a pass — that is the landing half of the rule only.
    expect(nextState.turn.activePlayerId).not.toBe(fixtureIds.owner);
    expect(nextState.turn.number).toBe(state.turn.number + 1);
  });
});
