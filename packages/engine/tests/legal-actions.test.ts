import { describe, expect, it } from "vitest";

import { enumerateLegalActions } from "../src";
import type { GameState, PlayerId } from "../src";
import { createCanonicalGameState, fixtureIds } from "./fixtures";

const unknownPlayerId = "player-unknown" as PlayerId;

const expectedAction = (
  state: GameState,
  actorId: PlayerId,
  type: "game.start" | "turn.roll",
) => ({
  gameId: state.gameId,
  actorId,
  expectedRevision: state.revision,
  type,
  payload: {},
});

const setupState = (revision = 17) => {
  const state = createCanonicalGameState();

  return {
    ...state,
    status: "setup" as const,
    revision,
    startAuthorizedPlayerId: fixtureIds.owner,
    turn: {
      ...state.turn,
      activePlayerId: null,
      phase: "not-started" as const,
    },
    resolutionStack: [],
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
  };
};

const preRollState = (revision = 17) => {
  const state = createCanonicalGameState();

  return {
    ...state,
    status: "active" as const,
    revision,
    turn: {
      ...state.turn,
      activePlayerId: fixtureIds.owner,
      phase: "pre-roll" as const,
    },
    resolutionStack: [],
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
  };
};

describe("enumerateLegalActions", () => {
  it("returns only game.start to the authorized starter during setup", () => {
    // Given: a setup game whose start authority belongs to the owner.
    const state = setupState(23);

    // When: the owner asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: only the start command is legal, with the current revision.
    expect(actions).toEqual([
      expectedAction(state, fixtureIds.owner, "game.start"),
    ]);
  });

  it.each([
    ["another player", fixtureIds.hiddenOpponent],
    ["an unknown player", unknownPlayerId],
  ] as const)("returns no setup action to %s", (_actorDescription, actorId) => {
    // Given: a setup game whose start authority belongs to the owner.
    const state = setupState();

    // When: a non-authorized actor asks for legal actions.
    const actions = enumerateLegalActions(state, actorId);

    // Then: setup exposes no action to that actor.
    expect(actions).toEqual([]);
  });

  it("returns only turn.roll to the active player before rolling", () => {
    // Given: an active game in the pre-roll phase with no blocking work.
    const state = preRollState(31);

    // When: the active player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: only the roll command is legal, with the current revision.
    expect(actions).toEqual([
      expectedAction(state, fixtureIds.owner, "turn.roll"),
    ]);
  });

  it("returns no roll action to the wrong player", () => {
    // Given: an active pre-roll turn owned by the owner.
    const state = preRollState();

    // When: another player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.hiddenOpponent);

    // Then: the wrong player has no legal action.
    expect(actions).toEqual([]);
  });

  it.each([
    ["a reaction window", { reactionWindows: createCanonicalGameState().reactionWindows }],
    ["a resolution frame", { resolutionStack: createCanonicalGameState().resolutionStack }],
    ["a pending effect", { pendingEffects: createCanonicalGameState().pendingEffects }],
  ] as const)("blocks rolling while %s is pending", (_blockerDescription, blocker) => {
    // Given: an active pre-roll turn with one unresolved blocker.
    const state = { ...preRollState(), ...blocker };

    // When: the active player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: rolling is not legal until the blocker resolves.
    expect(actions).toEqual([]);
  });

  it("offers prompt.respond instead of turn.roll while a prompt addressed to the active player is pending", () => {
    // Given: an active pre-roll turn with the canonical fixture's open prompt.
    const state = { ...preRollState(), prompts: createCanonicalGameState().prompts };
    const openPrompt = state.prompts[0];
    if (openPrompt === undefined) throw new Error("fixture missing an open prompt");

    // When: the active player (who the prompt addresses) asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: prompt.respond replaces turn.roll, carrying the prompt's own options.
    expect(actions).toEqual([
      {
        gameId: state.gameId,
        actorId: fixtureIds.owner,
        expectedRevision: state.revision,
        type: "prompt.respond",
        decisionPointId: openPrompt.id,
        kind: openPrompt.kind,
        options: openPrompt.legalResponses.map((option) => option.id),
      },
    ]);
  });

  it("does not offer prompt.respond to a player the prompt isn't addressed to, and still blocks their roll", () => {
    // Given: an open prompt addressed only to the owner.
    const state = { ...preRollState(), prompts: createCanonicalGameState().prompts };

    // When/Then: a different active-turn scenario isn't relevant here since
    // turn.activePlayerId still points at the owner — the other player has
    // no legal action at all (it's not their turn either way).
    const actions = enumerateLegalActions(state, fixtureIds.hiddenOpponent);
    expect(actions).toEqual([]);
  });

  it("blocks starting while engine work is pending", () => {
    const state = {
      ...setupState(),
      prompts: createCanonicalGameState().prompts,
    };

    expect(enumerateLegalActions(state, fixtureIds.owner)).toEqual([]);
  });

  it.each([
    ["paused", { status: "paused" as const }],
    ["ended", { status: "ended" as const }],
    ["in the wrong phase", { turn: { ...preRollState().turn, phase: "post-roll" as const } }],
  ] as const)("returns no action when the game is %s", (_stateDescription, change) => {
    // Given: a state that cannot accept a pre-roll command.
    const state = { ...preRollState(), ...change };

    // When: the active player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: no action is exposed.
    expect(actions).toEqual([]);
  });

  it("copies the state revision into every enumerated action", () => {
    // Given: setup and pre-roll states at different revisions.
    const setup = setupState(41);
    const preRoll = preRollState(59);

    // When: the authorized actors ask for legal actions.
    const setupActions = enumerateLegalActions(setup, fixtureIds.owner);
    const preRollActions = enumerateLegalActions(preRoll, fixtureIds.owner);

    // Then: each DTO carries the revision from its source state.
    expect(setupActions).toEqual([
      expectedAction(setup, fixtureIds.owner, "game.start"),
    ]);
    expect(preRollActions).toEqual([
      expectedAction(preRoll, fixtureIds.owner, "turn.roll"),
    ]);
  });
});
