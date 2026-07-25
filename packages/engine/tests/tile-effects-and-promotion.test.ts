import { describe, expect, it } from "vitest";

import type { DeckConfig } from "@office-ladder/content";

import { applyCommand, createScriptedRandomSource } from "../src";
import type { CommandId, DecisionPointId, FrameId, PromptOptionId } from "../src";
import { resolveTileEffects } from "../src/execution/resolve-tile-effects";
import { accepted, context, logicalTimestamp, rollCommand, rollState } from "./turn-loop-fixtures";
import { fixtureIds } from "./fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const authoredTestDecks = [
  {
    id: "deck.work",
    cards: [
      {
        id: "card.work.small-bonus",
        nameKey: "deadlineDash.card.workSmallBonus.name",
        effects: [{ type: "modifyResource", resource: "money", amount: 10, clampAtZero: true }],
      },
      {
        id: "card.work.large-bonus",
        nameKey: "deadlineDash.card.workLargeBonus.name",
        effects: [{ type: "modifyResource", resource: "money", amount: 100, clampAtZero: true }],
      },
    ],
  },
] as const satisfies readonly DeckConfig[];

describe("tile effects", () => {
  it("Given a player one space from the finance tile, when they roll onto it, then payResource deducts money", () => {
    const state = rollState(0);
    const before = state.players[fixtureIds.owner]?.resources.money?.value ?? 0;

    const result = applyCommand(state, rollCommand(state), context([0]));
    const { state: nextState } = accepted(result);

    const after = nextState.players[fixtureIds.owner]?.resources.money?.value ?? 0;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it("Given a player one space from the energy-restore tile, when they roll onto it, then energy is restored to its maximum", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const drainedState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          resources: {
            ...owner.resources,
            energy: {
              id: owner.resources.money.id,
              kind: "resource.energy",
              value: 0,
              minimum: 0,
              maximum: 10,
            },
          },
        },
      },
    };

    const result = applyCommand(drainedState, rollCommand(drainedState), context([0.2]));
    const { state: nextState } = accepted(result);

    const energy = nextState.players[fixtureIds.owner]?.resources.energy;
    expect(energy?.value).toBe(10);
  });
});

describe("authored card draws", () => {
  it("Given an authored deck, when drawing one card, then the selected card resolves immediately", () => {
    const owner = rollState(0).players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const random = createScriptedRandomSource([0]);

    const outcome = resolveTileEffects(
      owner,
      [{ type: "drawCards", deckId: "deck.work", count: 1 }],
      random,
      "work",
      undefined,
      authoredTestDecks,
    );

    expect(outcome.player.resources.money.value).toBe(owner.resources.money.value + 10);
    expect(random.getCursor()).toBe(1);
  });

  it("Given an authored deck, when drawing one card, then its public identity precedes its resource trace", () => {
    const owner = rollState(0).players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const outcome = resolveTileEffects(
      owner,
      [{ type: "drawCards", deckId: "deck.work", count: 1 }],
      createScriptedRandomSource([0]),
      "work",
      undefined,
      authoredTestDecks,
    );

    expect(outcome.trace).toEqual([
      {
        type: "card-drawn",
        card: {
          id: "card.work.small-bonus",
          nameKey: "deadlineDash.card.workSmallBonus.name",
          deckId: "deck.work",
        },
      },
      {
        type: "resource-changed",
        change: {
          resource: "money",
          previousValue: owner.resources.money.value,
          newValue: owner.resources.money.value + 10,
        },
      },
    ]);
    expect(outcome.changes).toEqual([
      {
        resource: "money",
        previousValue: owner.resources.money.value,
        newValue: owner.resources.money.value + 10,
      },
    ]);
  });

  it("Given an authored immediate card with two effects, when turn.roll draws it, then CardDrawn precedes both causal resource events", () => {
    const baseState = rollState(15);
    const owner = baseState.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const state: typeof baseState = {
      ...baseState,
      players: {
        ...baseState.players,
        [fixtureIds.owner]: {
          ...owner,
          resources: {
            ...owner.resources,
            reputation: {
              id: owner.resources.money.id,
              kind: "resource.reputation",
              value: 1,
              minimum: 0,
              maximum: null,
            },
          },
        },
      },
    };
    const command = rollCommand(state, { commandId: brand<CommandId>("card-order-3") });

    const transition = accepted(applyCommand(state, command, context([0])));

    expect(transition.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "PlayerMoved",
      "TileResolved",
      "CardDrawn",
      "ResourceChanged",
      "ResourceChanged",
      "TurnStarted",
    ]);
    expect(transition.events[3]?.payload).toEqual({
      playerId: fixtureIds.owner,
      cardId: "card.event.jackpot",
      deckId: "deck.event",
      nameKey: "deadlineDash.card.eventJackpot.name",
    });
    expect(transition.events[3]).toMatchObject({
      causationCommandId: command.commandId,
      logicalTimestamp: logicalTimestamp,
      visibility: { kind: "public" },
    });
    expect(transition.events.slice(3).map((event) => event.sequence)).toEqual([33, 34, 35, 36]);
    expect(transition.events.slice(3).every((event) => event.revision === state.revision + 1)).toBe(true);
    expect(transition.events[4]?.payload).toMatchObject({
      previousValue: 12,
      newValue: 812,
      reason: "tile-effect",
    });
    expect(transition.events[5]?.payload).toMatchObject({
      previousValue: 1,
      newValue: 3,
      reason: "tile-effect",
    });
    expect(transition.events.findIndex((event) => event.type === "CardDrawn")).toBeLessThan(
      transition.events.findIndex((event) => event.type === "TurnStarted"),
    );
    expect(transition.events[6]?.payload).toMatchObject({
      playerId: fixtureIds.revealedOpponent,
      turnNumber: 2,
      round: 1,
      phase: "pre-roll",
    });
  });

  it("Given a multi-card draw, when resolving it, then exactly count cards are drawn with replacement", () => {
    const owner = rollState(0).players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const random = createScriptedRandomSource([0, 0, 0]);

    const outcome = resolveTileEffects(
      owner,
      [{ type: "drawCards", deckId: "deck.work", count: 3 }],
      random,
      "work",
      undefined,
      authoredTestDecks,
    );

    expect(outcome.player.resources.money.value).toBe(owner.resources.money.value + 30);
    expect(random.getCursor()).toBe(3);
  });

  it("Given scripted randomness, when drawing multiple cards, then selections resolve sequentially in scripted order", () => {
    const owner = rollState(0).players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const random = createScriptedRandomSource([0.75, 0, 0.75]);

    const outcome = resolveTileEffects(
      owner,
      [{ type: "drawCards", deckId: "deck.work", count: 3 }],
      random,
      "work",
      undefined,
      authoredTestDecks,
    );

    expect(outcome.changes.map((change) => change.newValue - change.previousValue)).toEqual([
      100,
      10,
      100,
    ]);
  });

  it("Given a recursively self-drawing card, when resolving it, then recursion is bounded without exhausting the scripted source", () => {
    const owner = rollState(0).players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const recursiveDecks = [
      {
        id: "deck.networking",
        cards: [
          {
            id: "card.networking.loop",
            nameKey: "deadlineDash.card.networkingLoop.name",
            effects: [{ type: "drawCards", deckId: "deck.networking", count: 1 }],
          },
        ],
      },
    ] as const satisfies readonly DeckConfig[];
    const random = createScriptedRandomSource([0, 0, 0, 0, 0, 0]);

    const outcome = resolveTileEffects(
      owner,
      [{ type: "drawCards", deckId: "deck.networking", count: 1 }],
      random,
      "networking",
      undefined,
      recursiveDecks,
    );

    expect(outcome.player).toEqual(owner);
    expect(random.getCursor()).toBe(4);
  });

  it("Given an absent authored deck, when drawing from it, then no state changes and no randomness is consumed", () => {
    const owner = rollState(0).players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const random = createScriptedRandomSource([0]);

    const outcome = resolveTileEffects(
      owner,
      [{ type: "drawCards", deckId: "deck.event", count: 2 }],
      random,
      "event",
      undefined,
      authoredTestDecks,
    );

    expect(outcome.player).toEqual(owner);
    expect(outcome.changes).toEqual([]);
    expect(random.getCursor()).toBe(0);
  });

  it("Given an empty authored deck, when drawing from it, then no state changes and no randomness is consumed", () => {
    const owner = rollState(0).players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const emptyDecks = [
      { id: "deck.event", cards: [] },
    ] as const satisfies readonly DeckConfig[];
    const random = createScriptedRandomSource([0]);

    const outcome = resolveTileEffects(
      owner,
      [{ type: "drawCards", deckId: "deck.event", count: 2 }],
      random,
      "event",
      undefined,
      emptyDecks,
    );

    expect(outcome.player).toEqual(owner);
    expect(outcome.changes).toEqual([]);
    expect(random.getCursor()).toBe(0);
  });
});

describe("character passives", () => {
  it("Given the Workaholic character, when resolving an empty-effects tile of kind 'work', then the passive money bonus applies", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const workaholic = { ...owner, characterId: "character.workaholic" as typeof owner.characterId };
    const outcome = resolveTileEffects(
      workaholic,
      [],
      createScriptedRandomSource([]),
      "work",
      { type: "workLandingMoneyBonus", amount: 50 },
    );

    expect(outcome.player.resources.money.value).toBe(owner.resources.money.value + 50);
  });

  it("Given the Workaholic character, when landing on a non-work tile, then the passive does not apply", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const workaholic = { ...owner, characterId: "character.workaholic" as typeof owner.characterId };
    const outcome = resolveTileEffects(
      workaholic,
      [],
      createScriptedRandomSource([]),
      "meeting",
      { type: "workLandingMoneyBonus", amount: 50 },
    );

    expect(outcome.player.resources.money.value).toBe(owner.resources.money.value);
  });
});

describe("applyStatus tile effect and its consumers", () => {
  it("Given a tile effect that applies status.skip-next-tile-effect, when the player next lands on any tile, then that tile's effects are skipped and the status is consumed", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const moneyBefore = owner.resources.money.value;

    const skippingOutcome = resolveTileEffects(
      { ...owner, statuses: [{ id: brand("status.skip-next-tile-effect"), sourceId: null, stacks: 1, remainingTurns: null, expiresAtRound: null, visibility: "private", data: {} }] },
      [{ type: "modifyResource", resource: "money", amount: -500, clampAtZero: true }],
      createScriptedRandomSource([]),
      "finance",
      undefined,
    );

    expect(skippingOutcome.changes).toEqual([]);
    expect(skippingOutcome.player.resources.money.value).toBe(moneyBefore);
    expect(skippingOutcome.player.statuses).toEqual([]);
  });

  it("Given status.ignore-next-work-energy, when landing on a work tile, then the negative energy effect is filtered out but other work effects still apply", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const energyBefore = owner.resources.energy?.value ?? 5;

    const outcome = resolveTileEffects(
      {
        ...owner,
        resources: {
          ...owner.resources,
          energy: { id: owner.resources.money.id, kind: "resource.energy", value: energyBefore, minimum: 0, maximum: 10 },
          "work-counter": { id: owner.resources.money.id, kind: "resource.work-counter", value: 0, minimum: 0, maximum: null },
        },
        statuses: [{ id: brand("status.ignore-next-work-energy"), sourceId: null, stacks: 1, remainingTurns: null, expiresAtRound: null, visibility: "private", data: {} }],
      },
      [
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
        { type: "incrementWorkCounter", amount: 1, rewardEvery: 5, reward: { resource: "reputation", amount: 1 }, cumulative: true },
      ],
      createScriptedRandomSource([]),
      "work",
      undefined,
    );

    expect(outcome.player.resources.energy?.value).toBe(energyBefore);
    expect(outcome.player.resources["work-counter"]?.value).toBe(1);
    expect(outcome.player.statuses).toEqual([]);
  });

  it("Given status.next-roll-extra-movement (2 bonus spaces), when the player rolls, then movement is die + bonus and the status is consumed", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const boostedState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          statuses: [{ id: brand("status.next-roll-extra-movement"), sourceId: null, stacks: 1, remainingTurns: null, expiresAtRound: null, visibility: "private", data: { spaces: 2 } }],
        },
      },
    };

    const result = applyCommand(boostedState, rollCommand(boostedState), context([0]));
    const { state: nextState } = accepted(result);

    // die=1 (fraction 0) + 2 bonus spaces = position 3, not the usual position 1.
    expect(nextState.players[fixtureIds.owner]?.position).toBe(3);
    expect(nextState.players[fixtureIds.owner]?.statuses).toEqual([]);
  });

  it("Given status.next-salary-multiplier (2x), when the player passes the receptionist, then the awarded salary doubles and the status is consumed", () => {
    const state = rollState(43);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const moneyBefore = owner.resources.money.value;

    const boostedState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          statuses: [{ id: brand("status.next-salary-multiplier"), sourceId: null, stacks: 1, remainingTurns: null, expiresAtRound: null, visibility: "private", data: { multiplier: 2 } }],
        },
      },
    };

    const boostedResult = applyCommand(boostedState, rollCommand(boostedState), context([0]));
    const { state: boostedNextState } = accepted(boostedResult);

    const baselineResult = applyCommand(state, rollCommand(state), context([0]));
    const { state: baselineNextState } = accepted(baselineResult);

    const boostedGain = (boostedNextState.players[fixtureIds.owner]?.resources.money.value ?? 0) - moneyBefore;
    const baselineGain = (baselineNextState.players[fixtureIds.owner]?.resources.money.value ?? 0) - moneyBefore;

    expect(boostedGain).toBe(baselineGain * 2);
    expect(baselineGain).toBeGreaterThan(0);
    expect(boostedNextState.players[fixtureIds.owner]?.statuses).toEqual([]);
  });
});

describe("audit confinement (prompts/decisions)", () => {
  it("Given a player one roll from the audit tile, when they land on it, then a prompt opens, they're marked in-audit, and turn advances to the next player", () => {
    const state = rollState(16);

    // die = 6 lands on tile.board.22.audit
    const result = applyCommand(state, rollCommand(state), context([0.9]));
    const { state: nextState } = accepted(result);

    const owner = nextState.players[fixtureIds.owner];
    expect(owner?.inAudit).toBe(true);
    expect(nextState.prompts).toHaveLength(1);
    expect(nextState.prompts[0]).toMatchObject({
      kind: "audit-release",
      audience: [fixtureIds.owner],
    });
    expect(nextState.turn.activePlayerId).not.toBe(fixtureIds.owner);
  });

  it("Given an open audit prompt on the active player's own turn, when they choose to pay the fine, then they are released and 500 money is deducted", () => {
    const state = rollState(16);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const promptId = brand<DecisionPointId>("prompt-audit-test");
    const payFineOptionId = brand<PromptOptionId>("pay-fine");
    const attemptRollOptionId = brand<PromptOptionId>("attempt-roll");

    const confinedState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          inAudit: true,
          resources: { ...owner.resources, money: { ...owner.resources.money, value: 1000 } },
        },
      },
      prompts: [
        {
          id: promptId,
          frameId: brand<FrameId>("frame-audit-test"),
          kind: "audit-release",
          audience: [fixtureIds.owner],
          legalResponses: [
            { id: payFineOptionId, value: null },
            { id: attemptRollOptionId, value: null },
          ],
          deadlineAt: null,
          defaultResponse: { optionId: attemptRollOptionId, value: null },
          visibility: "public",
          responses: {},
        },
      ],
    };

    const command = {
      commandId: brand<CommandId>("command-respond-pay-fine"),
      gameId: confinedState.gameId,
      actorId: fixtureIds.owner,
      expectedRevision: confinedState.revision,
      decisionPointId: promptId,
      type: "prompt.respond" as const,
      payload: { optionId: payFineOptionId, value: null },
    };

    const result = applyCommand(confinedState, command, context([]));
    const { state: nextState } = accepted(result);

    expect(nextState.players[fixtureIds.owner]?.inAudit).toBe(false);
    expect(nextState.players[fixtureIds.owner]?.resources.money.value).toBe(500);
    expect(nextState.prompts).toHaveLength(0);
    expect(nextState.turn.activePlayerId).not.toBe(fixtureIds.owner);
  });
});

describe("promotion and win condition", () => {
  it("Given a player who can afford the final promotion, when they roll, then they are promoted and the match ends", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const promotableState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          rank: { ...owner.rank, kind: "rank.general-manager" },
          resources: {
            ...owner.resources,
            money: { ...owner.resources.money, value: 999_999 },
            reputation: owner.resources.reputation
              ? { ...owner.resources.reputation, value: 999 }
              : {
                  id: owner.resources.money.id,
                  kind: "resource.reputation",
                  value: 999,
                  minimum: 0,
                  maximum: null,
                },
          },
        },
      },
    };

    const result = applyCommand(promotableState, rollCommand(promotableState), context([0.2]));
    const { state: nextState } = accepted(result);

    expect(nextState.status).toBe("ended");
    expect(nextState.outcome?.reason).toBe("director-reached");
    expect(nextState.outcome?.winnerPlayerIds).toContain(fixtureIds.owner);
    expect(nextState.players[fixtureIds.owner]?.rank.kind).toBe("rank.director");
  });

  it("Given a player who cannot afford the next promotion, when they roll, then rank and status are unchanged", () => {
    const state = rollState(0);

    const result = applyCommand(state, rollCommand(state), context([0.2]));
    const { state: nextState } = accepted(result);

    expect(nextState.status).toBe("active");
    expect(nextState.outcome).toBeNull();
  });
});
