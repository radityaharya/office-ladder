import { describe, expect, it } from "vitest";

import { applyCommand } from "../src";
import type {
  GameEvent,
  GameState,
  PlayerState,
  ResourceId,
  ResourceState,
} from "../src";
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
 * The turn-order walk has to read the player records the *current* command
 * produced, not the ones it started from.
 *
 * `resolveNextTurn` inspects two per-player counters that the very command
 * calling it can change: `skipTurns` (the Burnout tile adds 2) and energy (a Work
 * tile or a card can empty it). The walk's candidate list is
 * `actor+1 … actor+order.length`, so its **last** candidate is the actor
 * themselves — reached whenever every other seat is passed over. Handing it
 * pre-transition state therefore let the acting player skip their own brand-new
 * skip debt and their own exhaustion, and take a turn the rules forbid.
 *
 * Both cases below need only one other seat to be passed over, which one
 * outstanding `skipTurns` does.
 */
const ENERGY_MAXIMUM = 5;

function energy(ownerId: string, value: number): ResourceState {
  return {
    id: brand<ResourceId>(`${ownerId}:resource:energy`),
    kind: "resource.energy",
    value,
    minimum: 0,
    maximum: ENERGY_MAXIMUM,
  };
}

type SeatOverrides = {
  readonly energy?: ResourceState;
  readonly skipTurns?: number;
  readonly statuses?: PlayerState["statuses"];
};

/** The IT tile's one-shot "ignore the energy cost of your next Work tile". */
function itStatus(): PlayerState["statuses"] {
  return [
    {
      id: brand("status.ignore-next-work-energy"),
      sourceId: null,
      stacks: 1,
      remainingTurns: null,
      expiresAtRound: null,
      visibility: "private",
      data: {},
    },
  ];
}

/**
 * A two-seat table in `[owner, opponent]` order. The canonical fixture's third
 * seat is dropped so the walk's candidate list is exactly "the opponent, then the
 * actor".
 */
function twoSeatState(
  ownerPosition: number,
  owner: SeatOverrides = {},
  opponent: SeatOverrides = {},
): GameState {
  const state = rollState(ownerPosition);
  const ownerPlayer = state.players[fixtureIds.owner];
  const opponentPlayer = state.players[fixtureIds.revealedOpponent];
  if (ownerPlayer === undefined || opponentPlayer === undefined) {
    throw new Error("fixture missing players");
  }

  const seat = (player: PlayerState, overrides: SeatOverrides): PlayerState => ({
    ...player,
    statuses: overrides.statuses ?? [],
    skipTurns: overrides.skipTurns ?? 0,
    resources: {
      money: { ...ownerPlayer.resources.money, value: 1000 },
      "work-counter": { ...ownerPlayer.resources["work-counter"], value: 0 },
      ...(overrides.energy === undefined ? {} : { energy: overrides.energy }),
    },
  });

  return {
    ...state,
    playerOrder: [fixtureIds.owner, fixtureIds.revealedOpponent],
    players: {
      ...state.players,
      [fixtureIds.owner]: seat(ownerPlayer, owner),
      [fixtureIds.revealedOpponent]: {
        ...seat(opponentPlayer, opponent),
        position: 13,
      },
    },
  };
}

function ownerEnergy(state: GameState): number | undefined {
  return state.players[fixtureIds.owner]?.resources.energy?.value;
}

function recoveries(events: readonly GameEvent[]) {
  return events.filter(
    (event) => event.type === "ResourceChanged" && event.payload.reason === "burnout-recovery",
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
 * A dice-stream state whose Work landing really does spend the player's last
 * energy point.
 *
 * A Work tile also draws a Work card, and `card.work.free-coffee` refills energy,
 * so the landing is not always exhausting; which card is drawn follows from the
 * canonical dice-stream state (the tile-effect source is seeded from server-owned
 * state — see ephemeral-random.ts), so searching that aims the test without
 * pinning anything a client controls.
 *
 * The search runs against `probe` — the same table with nobody skipped — because
 * on the table under test the exhaustion is *repaired inside the same command*
 * once the walk reaches the actor, which is the whole point of the case. The seed
 * ignores player records (`ephemeralRandomSeed` reads ids, revision, sequence and
 * the rng streams), so a stream state found on the probe draws the same card on
 * the table under test.
 */
function exhaustingDiceStreamState(probe: GameState): string {
  for (let candidate = 1; candidate <= 400; candidate += 1) {
    const attempt = withDiceStreamState(probe, String(candidate));
    const result = applyCommand(attempt, rollCommand(attempt), context([0]));
    if (!result.ok) continue;
    if (result.value.state.players[fixtureIds.owner]?.resources.energy?.value === 0) {
      return String(candidate);
    }
  }

  throw new Error("no dice-stream state produced an exhausting work landing");
}

/**
 * The first variant of `base` whose Work landing leaves the acting player on
 * exactly `wanted` energy. Same reason as `exhaustingDiceStreamState`: the Work
 * card drawn alongside the tile's own energy cost is what varies, and it is
 * steered by the canonical dice-stream state.
 */
function diceStreamStateEndingOnEnergy(base: GameState, wanted: number): string {
  for (let candidate = 1; candidate <= 400; candidate += 1) {
    const attempt = withDiceStreamState(base, String(candidate));
    const result = applyCommand(attempt, rollCommand(attempt), context([0]));
    if (!result.ok) continue;
    if (result.value.state.players[fixtureIds.owner]?.resources.energy?.value === wanted) {
      return String(candidate);
    }
  }

  throw new Error(`no dice-stream state left the player on ${wanted} energy`);
}

/**
 * Where the IT tile's status and the burnout rule meet.
 *
 * `status.ignore-next-work-energy` is authored as "Ignore energy cost on the next
 * 'work' tile", and `resolveTileEffects` implements it by filtering the tile's own
 * negative energy `modifyResource` out of the list before anything runs. So the
 * energy point is never spent, the player is never at zero, and the burnout rule
 * has nothing to fire on — which is the whole purchase the IT tile makes. It is
 * *not* immunity to energy loss: the Work card drawn on the same landing is a
 * separate effect and still bites.
 */
describe("the IT tile's status against work-tile exhaustion", () => {
  it("Given a player on their last energy point who holds the IT status, When they land on a Work tile, Then the tile's energy cost is skipped, they are not exhausted, and the status is spent", () => {
    const workIndex = boardIndexOfKind("work");
    const owner = { energy: energy(fixtureIds.owner, 1), statuses: itStatus() };
    // Opponent skipped so the walk reaches the actor: if the landing had exhausted
    // them, this is the hand-off that would forfeit their turn and refill.
    const probe = twoSeatState(workIndex - 1, owner);
    const state = withDiceStreamState(
      twoSeatState(workIndex - 1, owner, { skipTurns: 1 }),
      diceStreamStateEndingOnEnergy(probe, 1),
    );

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.players[fixtureIds.owner]?.position).toBe(workIndex);
    expect(ownerEnergy(nextState)).toBe(1);
    // Spent exactly once, on the Work tile it was bought for.
    expect(nextState.players[fixtureIds.owner]?.statuses).toEqual([]);
    // The rest of the Work tile still happened.
    expect(nextState.players[fixtureIds.owner]?.resources["work-counter"]?.value).toBe(1);
    expect(recoveries(events)).toEqual([]);
    // Not exhausted, so the walk hands the turn straight back to them.
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.owner);
  });

  it("Given the same player, When the Work card drawn on that landing takes their last energy anyway, Then the burnout rule still fires — the status covers the tile, not the card", () => {
    const workIndex = boardIndexOfKind("work");
    const owner = { energy: energy(fixtureIds.owner, 1), statuses: itStatus() };
    const probe = twoSeatState(workIndex - 1, owner);
    const state = withDiceStreamState(
      twoSeatState(workIndex - 1, owner, { skipTurns: 1 }),
      diceStreamStateEndingOnEnergy(probe, 0),
    );

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(recoveries(events)).toHaveLength(1);
    expect(ownerEnergy(nextState)).toBe(ENERGY_MAXIMUM);
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
  });
});

describe("turn hand-off reads the acting player's post-transition state", () => {
  it("Given the walk wraps back to the actor because the only other seat is skipped, When the actor's own roll emptied their energy, Then they forfeit the turn and are refilled rather than rolling again exhausted", () => {
    const workIndex = boardIndexOfKind("work");
    const owner = { energy: energy(fixtureIds.owner, 1) };
    const streamState = exhaustingDiceStreamState(twoSeatState(workIndex - 1, owner));
    const state = withDiceStreamState(
      twoSeatState(workIndex - 1, owner, { skipTurns: 1 }),
      streamState,
    );

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.players[fixtureIds.owner]?.position).toBe(workIndex);
    // The opponent's outstanding skip is served by this hand-off...
    expect(nextState.players[fixtureIds.revealedOpponent]?.skipTurns).toBe(0);
    // ...which brings the walk round to the actor, who is now exhausted. That is
    // a turn of theirs starting on zero energy: the rules forfeit it and refill.
    expect(recoveries(events)).toHaveLength(1);
    expect(recoveries(events)[0]?.payload).toMatchObject({
      playerId: fixtureIds.owner,
      previousValue: 0,
      newValue: ENERGY_MAXIMUM,
      reason: "burnout-recovery",
    });
    expect(ownerEnergy(nextState)).toBe(ENERGY_MAXIMUM);
    // With both seats passed over the turn falls to the natural next player,
    // whose skip is now paid — never back to the exhausted actor.
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
  });

  it("Given the walk wraps back to the actor because the only other seat is skipped, When the actor's own landing put them on burnout leave, Then that leave starts immediately instead of granting them one more turn", () => {
    const burnoutIndex = boardIndexOfKind("burnout");
    const state = twoSeatState(burnoutIndex - 1, {}, { skipTurns: 1 });

    const { state: nextState } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.players[fixtureIds.owner]?.position).toBe(burnoutIndex);
    expect(nextState.players[fixtureIds.revealedOpponent]?.skipTurns).toBe(0);
    // The tile charged 2 skipped turns; the walk reaching the actor is the first
    // of them, so one is left to serve. Reading stale state showed skipTurns 0
    // here and handed the actor a free extra turn on top of the full penalty.
    expect(nextState.players[fixtureIds.owner]?.skipTurns).toBe(1);
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
  });

  it("Given the whole table is on burnout leave, When the turn is handed on, Then it goes to a seat whose leave is actually served out rather than to one still owing turns", () => {
    const burnoutIndex = boardIndexOfKind("burnout");
    // The actor lands on Burnout (2 skipped turns) while the only other seat is
    // already serving two of its own — the table has no eligible player at all.
    const state = twoSeatState(burnoutIndex - 1, {}, { skipTurns: 2 });

    const { state: nextState } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.players[fixtureIds.owner]?.position).toBe(burnoutIndex);
    // Walking a single lap and then falling back handed the turn to a player who
    // still owed one, so a two-turn penalty was served as one. Every seat's leave
    // is walked out instead, and whoever is handed the turn can actually take it.
    expect(nextState.players[fixtureIds.revealedOpponent]?.skipTurns).toBe(0);
    expect(nextState.players[fixtureIds.owner]?.skipTurns).toBe(0);
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
    expect(nextState.players[nextState.turn.activePlayerId ?? ""]?.skipTurns).toBe(0);
  });

  it("Given a landing that grants an extra roll, When the same roll also changed the actor's own record, Then the hand-off keeps those changes rather than reverting to the pre-roll record", () => {
    // Position 43 + one space is the Receptionist corner, whose grantExtraRoll
    // takes the early return out of the walk — the path that never inspects any
    // candidate and so is easiest to hand a stale player map.
    const state = twoSeatState(43, { energy: energy(fixtureIds.owner, 3) });

    const { state: nextState } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.turn.activePlayerId).toBe(fixtureIds.owner);
    expect(nextState.turn.number).toBe(state.turn.number);
    expect(nextState.players[fixtureIds.owner]?.position).toBe(0);
    expect(nextState.players[fixtureIds.owner]?.lapsCompleted).toBe(1);
    // Salary really was paid into the record the hand-off returned.
    expect(nextState.players[fixtureIds.owner]?.resources.money?.value).toBeGreaterThan(1000);
  });
});
