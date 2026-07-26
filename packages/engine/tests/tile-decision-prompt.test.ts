import { describe, expect, it } from "vitest";

import { deadlineDashBoard } from "@office-ladder/content";
import type { BoardTile, RollOutcome, TileDecisionConfig } from "@office-ladder/content";

import {
  applyCommand,
  createEphemeralRandom,
  enumerateLegalActions,
  rollDie,
} from "../src";
import type {
  CommandId,
  GameState,
  PromptOptionId,
  RespondToPromptCommand,
} from "../src";
import { fixtureIds } from "./fixtures";
import {
  accepted,
  boardIndexOfKind,
  context,
  logicalTimestamp,
  rejected,
  rollCommand,
  rollState,
} from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const TRAINING_INDEX = boardIndexOfKind("training");
const TUITION = 300;

/**
 * `decision` is optional, so the `as const` board tuple does not surface it
 * without widening to the schema type.
 */
function requireTrainingDecision(): TileDecisionConfig {
  const spaces: readonly BoardTile[] = deadlineDashBoard.spaces;
  const decision = spaces[TRAINING_INDEX]?.decision;
  if (decision === undefined) throw new Error("the training tile carries no decision");

  return decision;
}

const trainingDecision = requireTrainingDecision();

/**
 * The authored total band of an accept outcome. `RollOutcome.when` also has a
 * doubles form, which the training tile does not use — widening to the schema
 * type surfaces that union, so it has to be discriminated explicitly.
 */
function totalBand(when: RollOutcome["when"]): readonly [number, number] {
  if (!("total" in when)) throw new Error("expected a total-range accept outcome");

  return when.total;
}

const acceptBands = trainingDecision.accept.outcomes.map((outcome) => totalBand(outcome.when));

/**
 * A pre-roll turn one space short of the training tile, with a reputation
 * resource (the canonical fixture player only carries money) so both branches
 * of the decision are observable.
 */
function beforeTrainingState(money: number): GameState {
  const state = rollState(TRAINING_INDEX - 1);
  const owner = state.players[fixtureIds.owner];
  if (owner === undefined) throw new Error("fixture missing owner player");

  return {
    ...state,
    players: {
      ...state.players,
      [fixtureIds.owner]: {
        ...owner,
        statuses: [],
        resources: {
          ...owner.resources,
          money: { ...owner.resources.money, value: money },
          reputation: {
            id: owner.resources.money.id,
            kind: "resource.reputation",
            value: 4,
            minimum: 0,
            maximum: null,
          },
        },
      },
    },
  };
}

function respondCommand(
  state: GameState,
  optionId: string,
  commandId: string,
): RespondToPromptCommand {
  const prompt = state.prompts[0];
  if (prompt === undefined) throw new Error("expected an open prompt");

  return {
    commandId: brand<CommandId>(commandId),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    decisionPointId: prompt.id,
    type: "prompt.respond",
    payload: { optionId: brand<PromptOptionId>(optionId), value: null },
  };
}

function reputation(state: GameState): number {
  const value = state.players[fixtureIds.owner]?.resources.reputation?.value;
  if (value === undefined) throw new Error("expected a reputation resource");
  return value;
}

function money(state: GameState): number {
  const value = state.players[fixtureIds.owner]?.resources.money.value;
  if (value === undefined) throw new Error("expected a money resource");
  return value;
}

/**
 * The faces the enrol check will produce against `state`.
 *
 * Derived from the *state* the response is applied to, never from the response
 * command's id: a client picks its own command id, so anything it can seed is
 * an outcome it can choose (see ephemeral-random.ts).
 */
function expectedCheck(state: GameState): { readonly total: number; readonly gain: number } {
  const preview = createEphemeralRandom(state, "tile-decision");
  const total = rollDie(preview) + rollDie(preview);
  const outcome = trainingDecision.accept.outcomes.find((candidate) => {
    const [minimum, maximum] = totalBand(candidate.when);
    return total >= minimum && total <= maximum;
  });
  const effect = outcome?.effects[0];
  if (effect === undefined || effect.type !== "modifyResource") {
    throw new Error("authored accept outcomes must cover every total");
  }

  return { total, gain: effect.amount };
}

/** A copy of `state` whose canonical (server-owned) dice stream sits at `value`. */
function withDiceStreamState(state: GameState, value: string): GameState {
  const dice = state.rng.streams.dice;
  if (dice === undefined) throw new Error("fixture missing a dice stream");

  return {
    ...state,
    rng: { streams: { ...state.rng.streams, dice: { ...dice, state: value } } },
  };
}

/** A state with the training decision open, reached by really landing on it. */
function askedState(diceStreamState: string): GameState {
  const before = withDiceStreamState(beforeTrainingState(1000), diceStreamState);
  // die = 1 lands on tile.board.01.training
  const { state: asked } = accepted(applyCommand(before, rollCommand(before), context([0])));
  if (asked.prompts.length !== 1) throw new Error("expected the decision to open");

  return asked;
}

/**
 * The first canonical dice-stream state whose enrol check lands in `band`.
 *
 * Both authored bands still need covering, but the knob that steers the check is
 * now server-owned state rather than a hand-picked command id — so the test
 * searches for a state instead of asserting a client-chosen value.
 */
function askedStateInBand(band: readonly [number, number]): GameState {
  for (let candidate = 1; candidate <= 200; candidate += 1) {
    const asked = askedState(String(candidate));
    const { total } = expectedCheck(asked);
    if (total >= band[0] && total <= band[1]) return asked;
  }

  throw new Error(`no dice-stream state reached the ${band[0]}-${band[1]} band`);
}

describe("tile decision prompts", () => {
  it("Given the authored training tile, Then it offers a training-course decision with distinct enroll and decline branches", () => {
    expect(trainingDecision).toMatchObject({
      kind: "training-course",
      accept: { optionId: "enroll", cost: { resource: "money", amount: TUITION } },
      decline: { optionId: "decline" },
      whenUnaffordable: "resolve-decline",
    });
  });

  it("Given a player who can afford the tuition, When they land on the training tile, Then the decision holds their own turn open", () => {
    const state = beforeTrainingState(1000);

    // die = 1 lands on tile.board.01.training
    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.prompts).toHaveLength(1);
    expect(nextState.prompts[0]).toMatchObject({
      kind: "training-course",
      audience: [fixtureIds.owner],
      visibility: "public",
      defaultResponse: { optionId: "decline" },
    });
    expect(nextState.prompts[0]?.legalResponses.map((option) => option.id)).toEqual([
      "decline",
      "enroll",
    ]);
    // The acting player keeps the turn; nothing was charged just for being asked.
    expect(nextState.turn).toMatchObject({
      activePlayerId: fixtureIds.owner,
      phase: "prompt",
      number: state.turn.number,
      round: state.turn.round,
    });
    expect(money(nextState)).toBe(1000);
    expect(reputation(nextState)).toBe(4);

    const types = events.map((event) => event.type);
    expect(types).toEqual(["DiceRolled", "PlayerMoved", "TileResolved", "PromptOpened", "TurnStarted"]);
    expect(events[3]?.payload).toMatchObject({ prompt: nextState.prompts[0] });
    expect(events[4]?.payload).toMatchObject({ playerId: fixtureIds.owner, phase: "prompt" });
  });

  it("Given an open training decision, When the holder asks what they may do, Then only prompt.respond is legal and rolling is refused", () => {
    const state = beforeTrainingState(1000);
    const { state: asked } = accepted(applyCommand(state, rollCommand(state), context([0])));

    expect(enumerateLegalActions(asked, fixtureIds.owner)).toEqual([
      {
        gameId: asked.gameId,
        actorId: fixtureIds.owner,
        expectedRevision: asked.revision,
        type: "prompt.respond",
        decisionPointId: asked.prompts[0]?.id,
        kind: "training-course",
        options: ["decline", "enroll"],
      },
    ]);
    rejected(
      applyCommand(asked, rollCommand(asked, { commandId: brand<CommandId>("roll-again") }), context([0])),
      "INVALID_PHASE",
    );
  });

  it("Given an open training decision, When the player declines, Then they keep their money, take the free session, and the turn passes on", () => {
    const state = beforeTrainingState(1000);
    const { state: asked } = accepted(applyCommand(state, rollCommand(state), context([0])));

    const { state: answered, events } = accepted(
      applyCommand(asked, respondCommand(asked, "decline", "respond-decline"), context([])),
    );

    expect(money(answered)).toBe(1000);
    expect(reputation(answered)).toBe(5);
    expect(answered.prompts).toEqual([]);
    expect(answered.turn).toMatchObject({
      activePlayerId: fixtureIds.revealedOpponent,
      phase: "pre-roll",
      number: asked.turn.number + 1,
    });
    expect(events.map((event) => event.type)).toEqual(["ResourceChanged", "TurnStarted"]);
    expect(events[0]?.payload).toMatchObject({
      previousValue: 4,
      newValue: 5,
      reason: "tile-decision",
    });
    // Answering rolls no movement dice.
    expect(answered.rng.streams.dice?.cursor).toBe(asked.rng.streams.dice?.cursor);
  });

  // One case per authored outcome band, each reached by a canonical dice-stream
  // state found above; `expectedCheck` re-derives the faces from that same
  // server-owned state rather than restating them.
  it.each(acceptBands.map((band) => [`${band[0]}-${band[1]}`, band] as const))(
    "Given an open training decision, When the player enrolls and the check lands in the %s band, Then the tuition is charged and the authored outcome applies",
    (_label, band) => {
      const asked = askedStateInBand(band);
      const check = expectedCheck(asked);

      const { state: answered, events } = accepted(
        applyCommand(asked, respondCommand(asked, "enroll", "respond-enroll"), context([])),
      );

      expect(money(answered)).toBe(1000 - TUITION);
      expect(reputation(answered)).toBe(4 + check.gain);
      expect(answered.prompts).toEqual([]);
      expect(answered.turn).toMatchObject({
        activePlayerId: fixtureIds.revealedOpponent,
        phase: "pre-roll",
      });
      expect(events.map((event) => event.type)).toEqual([
        "ResourceChanged",
        "DiceRolled",
        "ResourceChanged",
        "TurnStarted",
      ]);
      expect(events[0]?.payload).toMatchObject({
        previousValue: 1000,
        newValue: 700,
        reason: "tile-decision-cost",
      });
      expect(events[1]?.payload).toMatchObject({
        playerId: fixtureIds.owner,
        total: check.total,
        purpose: "training-course",
        rngStream: "ephemeral:tile-decision",
        rngCursor: 2,
      });
      if (events[1]?.type === "DiceRolled") {
        expect(events[1].payload.dice).toHaveLength(2);
      }
      // The persisted movement stream is untouched by the response's own roll.
      expect(answered.rng.streams.dice?.cursor).toBe(asked.rng.streams.dice?.cursor);
      expect(events.every((event) => event.logicalTimestamp === logicalTimestamp)).toBe(true);
    },
  );

  it("Given the two authored outcome bands, When a state is found for each, Then the pair really does straddle the 6/7 boundary", () => {
    // Guards the case above from silently collapsing to two states in the same
    // band, which would leave one authored outcome untested. Exact totals are
    // deliberately not asserted: they are a property of whichever server-owned
    // dice-stream state the search happens to reach first, and pinning them is
    // what previously disguised a client-chosen seed as expected behaviour.
    const low = expectedCheck(askedStateInBand([2, 6]));
    const high = expectedCheck(askedStateInBand([7, 12]));

    expect(low.total).toBeLessThanOrEqual(6);
    expect(low.gain).toBe(2);
    expect(high.total).toBeGreaterThanOrEqual(7);
    expect(high.gain).toBe(3);
  });

  it("Given a player who cannot afford the tuition, When they land on the training tile, Then no prompt opens and the free session resolves immediately", () => {
    const state = beforeTrainingState(TUITION - 1);

    const { state: nextState } = accepted(applyCommand(state, rollCommand(state), context([0])));

    expect(nextState.prompts).toEqual([]);
    expect(money(nextState)).toBe(TUITION - 1);
    expect(reputation(nextState)).toBe(5);
    expect(nextState.turn).toMatchObject({
      activePlayerId: fixtureIds.revealedOpponent,
      phase: "pre-roll",
    });
  });

  it("Given a hand-built prompt whose kind no tile offers, When the player answers it, Then the response is refused", () => {
    const state = beforeTrainingState(1000);
    const { state: asked } = accepted(applyCommand(state, rollCommand(state), context([0])));
    const prompt = asked.prompts[0];
    if (prompt === undefined) throw new Error("expected an open prompt");
    const wrongKind: GameState = {
      ...asked,
      prompts: [{ ...prompt, kind: "made-up-decision" }],
    };

    rejected(
      applyCommand(wrongKind, respondCommand(wrongKind, "decline", "respond-wrong"), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("Given an enroll response from a player who can no longer pay, When it is applied, Then it is refused rather than charging a partial fee", () => {
    const state = beforeTrainingState(1000);
    const { state: asked } = accepted(applyCommand(state, rollCommand(state), context([0])));
    const owner = asked.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const broke: GameState = {
      ...asked,
      players: {
        ...asked.players,
        [fixtureIds.owner]: {
          ...owner,
          resources: { ...owner.resources, money: { ...owner.resources.money, value: 10 } },
        },
      },
    };

    rejected(
      applyCommand(broke, respondCommand(broke, "enroll", "respond-broke"), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a player whose landing promotes them to Director, When that landing is the training tile, Then the match ends without opening a decision nobody could answer", () => {
    const base = beforeTrainingState(999_999);
    const owner = base.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const promotable: GameState = {
      ...base,
      players: {
        ...base.players,
        [fixtureIds.owner]: {
          ...owner,
          rank: { ...owner.rank, kind: "rank.general-manager" },
          resources: {
            ...owner.resources,
            reputation: { ...owner.resources.reputation, value: 999 },
          },
        },
      },
    };

    const { state: nextState } = accepted(
      applyCommand(promotable, rollCommand(promotable), context([0])),
    );

    // The player can easily afford the tuition, so the only reason no prompt
    // exists is the match ending on the same roll.
    expect(nextState.status).toBe("ended");
    expect(nextState.outcome?.reason).toBe("director-reached");
    expect(nextState.prompts).toEqual([]);
    expect(nextState.turn.phase).not.toBe("prompt");
  });

  it("Given a player who skips the next tile's effects, When they land on the training tile, Then they are never asked", () => {
    const base = beforeTrainingState(1000);
    const owner = base.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const skipping: GameState = {
      ...base,
      players: {
        ...base.players,
        [fixtureIds.owner]: {
          ...owner,
          statuses: [
            {
              id: brand("status.skip-next-tile-effect"),
              sourceId: null,
              stacks: 1,
              remainingTurns: null,
              expiresAtRound: null,
              visibility: "private",
              data: {},
            },
          ],
        },
      },
    };

    const { state: nextState } = accepted(
      applyCommand(skipping, rollCommand(skipping), context([0])),
    );

    expect(nextState.prompts).toEqual([]);
    expect(money(nextState)).toBe(1000);
    expect(reputation(nextState)).toBe(4);
    expect(nextState.players[fixtureIds.owner]?.statuses).toEqual([]);
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
  });
});
