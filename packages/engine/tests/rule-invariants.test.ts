import { describe, expect, it } from "vitest";

import type {
  BoardTile,
  CharacterAbilityDescriptor,
  TileDecisionConfig,
} from "@office-ladder/content";
import { deadlineDashBoard } from "@office-ladder/content";

import { applyCommand, createScriptedRandomSource, enumerateLegalActions } from "../src";
import type {
  CharacterId,
  CommandId,
  DecisionPointId,
  FrameId,
  GameState,
  PlayerState,
  PromptOptionId,
  PromptState,
  RespondToPromptCommand,
} from "../src";
import { resolveNextTurn } from "../src/execution/next-turn";
import { resolveTileEffects } from "../src/execution/resolve-tile-effects";
import { fixtureIds } from "./fixtures";
import {
  accepted,
  boardIndexOfKind,
  context,
  rejected,
  rollCommand,
  rollState,
  withRules,
} from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const TRAINING_INDEX = boardIndexOfKind("training");
const FINANCE_INDEX = boardIndexOfKind("finance");
const TUITION = 300;
/** rank.staff -> rank.senior-staff in the fixture's mode (falls back to mode.quick). */
const PROMOTION_COST = 600;
const PROMOTION_REPUTATION = 5;

const TECH_GENIUS_PASSIVE: CharacterAbilityDescriptor = {
  type: "ignoreNegativeEffect",
  usesPerLap: 1,
  sources: ["tile", "card"],
};

/**
 * `decision` is optional, so the `as const` board tuple does not surface it
 * without widening to the schema type — and the index is derived, so it cannot
 * be read off a single tile literal either.
 */
function requireTrainingDecision(): TileDecisionConfig {
  const spaces: readonly BoardTile[] = deadlineDashBoard.spaces;
  const decision = spaces[TRAINING_INDEX]?.decision;
  if (decision === undefined) throw new Error("the training tile carries no decision");

  return decision;
}

const trainingDecision = requireTrainingDecision();

/**
 * A pre-roll turn one space short of the training tile, with a reputation
 * resource.
 *
 * `agency.promotionIsChoice` is turned **off** explicitly. The base fixture runs
 * the Quick preset, which makes promotion a player decision (`promotion.attempt`),
 * and `roll-turn.ts` now honours that switch — so the automatic promotion these
 * cases are about only happens under a ruleset that asks for it. Stating it here
 * is what keeps them testing the deferral rule rather than the mode gate.
 */
function beforeTraining(money: number, reputationValue: number): GameState {
  const state = withRules(rollState(TRAINING_INDEX - 1), {
    agency: { promotionIsChoice: false },
  });
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
            id: brand("resource-owner-reputation"),
            kind: "resource.reputation",
            value: reputationValue,
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

function owner(state: GameState): PlayerState {
  const player = state.players[fixtureIds.owner];
  if (player === undefined) throw new Error("fixture missing owner player");
  return player;
}

function handTurnBackToOwner(state: GameState): GameState {
  return {
    ...state,
    turn: { ...state.turn, activePlayerId: fixtureIds.owner, phase: "pre-roll" },
  };
}

/** The owner as Tech Genius, `money` in the wallet and `energy` in the tank. */
function techGenius(money: number, energy: number): PlayerState {
  const player = owner(rollState(0));

  return {
    ...player,
    characterId: brand<CharacterId>("character.tech-genius"),
    statuses: [],
    negativeEffectsIgnoredThisLap: 0,
    resources: {
      ...player.resources,
      money: { ...player.resources.money, value: money },
      energy: {
        id: brand("resource-owner-energy"),
        kind: "resource.energy",
        value: energy,
        minimum: 0,
        maximum: 10,
      },
    },
  };
}

describe("an open tile decision stays payable", () => {
  /**
   * The offer's affordability is decided during tile resolution; the automatic
   * promotion spends money *after* that. Without ordering the two, a promotable
   * player is asked to pay tuition the promotion has already spent, and the
   * response command then refuses the very option the prompt advertised.
   */
  it("Given a player whose automatic promotion would leave them short of the tuition, When they land on the training tile, Then the promotion waits and the offer is still payable", () => {
    // 800 covers the promotion (600) and the tuition (300) separately, but not
    // both: promoting first would leave 200.
    const state = beforeTraining(800, PROMOTION_REPUTATION);

    // die = 1 lands on tile.board.01.training
    const { state: asked, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(asked.prompts).toHaveLength(1);
    expect(asked.prompts[0]?.kind).toBe("training-course");
    expect(events.some((event) => event.type === "PlayerPromoted")).toBe(false);
    expect(owner(asked).rank.kind).toBe("rank.staff");
    expect(owner(asked).resources.money.value).toBe(800);

    // The advertised option is genuinely legal, not rejected on arrival.
    const { state: enrolled } = accepted(
      applyCommand(asked, respondCommand(asked, "enroll", "respond-enroll-held"), context([])),
    );
    expect(enrolled.players[fixtureIds.owner]?.resources.money.value).toBe(800 - TUITION);
  });

  it("Given the promotion was held back for an offer, When the player declines and rolls again, Then the promotion is only delayed, never lost", () => {
    const state = beforeTraining(800, PROMOTION_REPUTATION);
    const { state: asked } = accepted(applyCommand(state, rollCommand(state), context([0])));
    const { state: declined } = accepted(
      applyCommand(asked, respondCommand(asked, "decline", "respond-decline-held"), context([])),
    );

    expect(owner(declined).rank.kind).toBe("rank.staff");

    const next = handTurnBackToOwner(declined);
    const { state: after, events } = accepted(
      applyCommand(next, rollCommand(next, { commandId: brand<CommandId>("roll-again") }), context([0])),
    );

    // The next tile draws a card that also moves money, so the promotion is
    // pinned through its own event rather than a wallet total.
    const promoted = events.find((event) => event.type === "PlayerPromoted");
    expect(promoted?.payload).toMatchObject({
      playerId: fixtureIds.owner,
      toRankId: "rank.senior-staff",
      cost: PROMOTION_COST,
    });
    expect(owner(after).rank.kind).toBe("rank.senior-staff");
  });

  it("Given a player who can afford both, When they land on the training tile, Then the promotion is not deferred as well", () => {
    // 1000 - 600 = 400, still clear of the 300 tuition, so nothing conflicts and
    // the promotion must go through on the landing roll as it always did.
    const state = beforeTraining(1000, PROMOTION_REPUTATION);

    const { state: asked, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(events.some((event) => event.type === "PlayerPromoted")).toBe(true);
    expect(owner(asked).rank.kind).toBe("rank.senior-staff");
    expect(owner(asked).resources.money.value).toBe(1000 - PROMOTION_COST);
    expect(asked.prompts).toHaveLength(1);
    expect(asked.turn.phase).toBe("prompt");
  });

  it("Given the authored tuition and promotion table, When they are compared, Then the deferral case is a real one and not a fixture artefact", () => {
    expect(trainingDecision.accept.cost.amount).toBe(TUITION);
    // 800 is above the tuition on its own, and above the promotion cost on its
    // own, which is exactly the collision the deferral exists for.
    expect(PROMOTION_COST).toBeGreaterThan(800 - TUITION);
    expect(800).toBeGreaterThanOrEqual(TUITION);
  });
});

describe("the ignoreNegativeEffect allowance is only spent on a real loss", () => {
  it("Given an empty wallet, When a payResource tile takes money it cannot get, Then the allowance survives for a loss that would really land", () => {
    const outcome = resolveTileEffects(
      techGenius(0, 10),
      [
        { type: "payResource", resource: "money", amount: 300, insufficientFunds: "pay-up-to-available" },
        { type: "modifyResource", resource: "energy", amount: -4, clampAtZero: true },
      ],
      createScriptedRandomSource([]),
      "finance",
      TECH_GENIUS_PASSIVE,
    );

    // The unpayable 300 took nothing, so it was never "a negative effect" to
    // prevent; the energy loss is what the one allowance per lap absorbs.
    expect(outcome.player.resources.money.value).toBe(0);
    expect(outcome.player.resources.energy?.value).toBe(10);
    expect(outcome.ignoredNegativeEffects).toBe(1);
    expect(outcome.trace).toEqual([
      {
        type: "negative-effect-ignored",
        ignored: { origin: "tile", effectType: "modifyResource", resource: "energy", amount: 4 },
      },
    ]);
  });

  it("Given a resource already at its minimum, When a clamped loss resolves, Then nothing is absorbed because nothing would have been lost", () => {
    const outcome = resolveTileEffects(
      techGenius(500, 0),
      [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
      createScriptedRandomSource([]),
      "work",
      TECH_GENIUS_PASSIVE,
    );

    expect(outcome.ignoredNegativeEffects).toBe(0);
    expect(outcome.player.negativeEffectsIgnoredThisLap).toBe(0);
    expect(outcome.trace).toEqual([]);
  });

  it("Given a partly payable loss, When the allowance absorbs it, Then the amount recorded is what was really prevented", () => {
    const outcome = resolveTileEffects(
      techGenius(100, 10),
      [{ type: "payResource", resource: "money", amount: 300, insufficientFunds: "pay-up-to-available" }],
      createScriptedRandomSource([]),
      "finance",
      TECH_GENIUS_PASSIVE,
    );

    expect(outcome.player.resources.money.value).toBe(100);
    expect(outcome.trace).toEqual([
      {
        type: "negative-effect-ignored",
        // 100, not the authored 300: clamping means only 100 was ever at stake.
        ignored: { origin: "tile", effectType: "payResource", resource: "money", amount: 100 },
      },
    ]);
  });

  it("Given a broke Tech Genius, When they land on the finance tile, Then no EffectPrevented is emitted and the lap counter is untouched", () => {
    const state = rollState(FINANCE_INDEX - 1);
    const broke: GameState = {
      ...state,
      players: { ...state.players, [fixtureIds.owner]: { ...techGenius(0, 10), position: FINANCE_INDEX - 1 } },
    };

    // die = 1 lands on tile.board.10.finance (pay 300)
    const { state: nextState, events } = accepted(
      applyCommand(broke, rollCommand(broke), context([0])),
    );

    expect(events.some((event) => event.type === "EffectPrevented")).toBe(false);
    expect(owner(nextState).negativeEffectsIgnoredThisLap).toBe(0);
    expect(owner(nextState).resources.money.value).toBe(0);
  });
});

describe("prompts do not outlive the match", () => {
  function endedWithOpenPrompt(): GameState {
    const state = rollState(0);
    const prompt: PromptState = {
      id: brand<DecisionPointId>("prompt-audit-open"),
      frameId: brand<FrameId>("frame-audit-open"),
      kind: "audit-release",
      audience: [fixtureIds.owner],
      legalResponses: [
        { id: brand<PromptOptionId>("pay-fine"), value: null },
        { id: brand<PromptOptionId>("attempt-roll"), value: null },
      ],
      deadlineAt: null,
      defaultResponse: { optionId: brand<PromptOptionId>("attempt-roll"), value: null },
      visibility: "public",
      responses: {},
    };

    return {
      ...state,
      status: "ended",
      outcome: {
        reason: "director-reached",
        winnerPlayerIds: [fixtureIds.revealedOpponent],
        winningRole: null,
        endedAt: "2026-07-18T12:00:00.000Z",
        data: {},
        scores: [],
        winPath: "promotion",
      },
      prompts: [prompt],
    };
  }

  /**
   * An audit-release prompt stays open while the turn moves on, so another
   * player can reach Director while it is pending. The audited player is then
   * both active and holding a prompt in an ended game.
   */
  it("Given a prompt still open when the match ended, When the holder asks what they may do, Then nothing is offered", () => {
    const ended = endedWithOpenPrompt();

    expect(enumerateLegalActions(ended, fixtureIds.owner)).toEqual([]);
  });

  it("Given a prompt still open when the match ended, When the holder answers it anyway, Then the command is refused", () => {
    const ended = endedWithOpenPrompt();

    rejected(
      applyCommand(ended, respondCommand(ended, "pay-fine", "respond-after-end"), context([])),
      "GAME_ALREADY_ENDED",
    );
  });
});

describe("skipped turns are charged exactly once", () => {
  it("Given every candidate is skipped, When the turn is handed on, Then the counters it decremented are kept and the player it lands on owes nothing", () => {
    const state = rollState(0);
    const actor = { ...owner(state), skipTurns: 1 };
    const twoPlayers: GameState = {
      ...state,
      playerOrder: [fixtureIds.owner, fixtureIds.revealedOpponent],
      players: {
        ...state.players,
        [fixtureIds.owner]: actor,
        [fixtureIds.revealedOpponent]: {
          ...(state.players[fixtureIds.revealedOpponent] ?? owner(state)),
          skipTurns: 1,
        },
      },
    };

    // The walk takes the actor's post-transition record; nothing changed it here,
    // so it is the same record canonical state holds.
    const resolved = resolveNextTurn(twoPlayers, 0, false, fixtureIds.owner, actor);

    // Both were passed over, so both paid for it. Discarding the decrements
    // would let the same players be skipped again on every future turn.
    expect(resolved.nextPlayerId).toBe(fixtureIds.revealedOpponent);
    expect(resolved.players[fixtureIds.owner]?.skipTurns).toBe(0);
    expect(resolved.players[fixtureIds.revealedOpponent]?.skipTurns).toBe(0);
  });

  it("Given a single-player order, When the only player owes skipped turns, Then the whole debt retires instead of sticking forever", () => {
    const state = rollState(0);
    const actor = { ...owner(state), skipTurns: 2 };
    const solo: GameState = {
      ...state,
      playerOrder: [fixtureIds.owner],
      players: { [fixtureIds.owner]: actor },
    };

    const first = resolveNextTurn(solo, 0, false, fixtureIds.owner, actor);

    // With no other seat there is no turn to pass to anybody: the debt is walked
    // out in one hand-off and the sole player comes back owing nothing, rather
    // than being handed a turn they are still supposed to be sitting out.
    expect(first.nextPlayerId).toBe(fixtureIds.owner);
    expect(first.players[fixtureIds.owner]?.skipTurns).toBe(0);
  });

  it("Given a table where one seat owes more turns than a single lap can serve, When the turn is handed on, Then the walk keeps going until it reaches a seat that can play", () => {
    const state = rollState(0);
    const actor = { ...owner(state), skipTurns: 1 };
    const debtor = {
      ...(state.players[fixtureIds.revealedOpponent] ?? owner(state)),
      skipTurns: 3,
    };
    const twoPlayers: GameState = {
      ...state,
      playerOrder: [fixtureIds.owner, fixtureIds.revealedOpponent],
      players: { ...state.players, [fixtureIds.owner]: actor, [fixtureIds.revealedOpponent]: debtor },
    };

    const resolved = resolveNextTurn(twoPlayers, 0, false, fixtureIds.owner, actor);

    // The walk is the physical table walk: opponent (3->2), owner (1->0),
    // opponent (2->1), then owner, who now owes nothing and plays. Stopping after
    // one lap instead handed the turn to the opponent still owing 2 — a 3-turn
    // debt served as 1.
    expect(resolved.nextPlayerId).toBe(fixtureIds.owner);
    expect(resolved.players[fixtureIds.owner]?.skipTurns).toBe(0);
    // Nobody else's debt is drained further than the walk needed.
    expect(resolved.players[fixtureIds.revealedOpponent]?.skipTurns).toBe(1);
  });
});
