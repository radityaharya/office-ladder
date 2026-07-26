import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";
import type { BoardTile, DeckConfig } from "@office-ladder/content";

import { applyCommand, createScriptedRandomSource } from "../src";
import type {
  CommandId,
  DecisionPointId,
  FrameId,
  GameState,
  PromptOptionId,
} from "../src";
import { resolveTileEffects } from "../src/execution/resolve-tile-effects";
import {
  accepted,
  boardIndexOfKind,
  context,
  logicalTimestamp,
  rollCommand,
  rollState,
  withRules,
} from "./turn-loop-fixtures";
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

/** A copy of `state` whose canonical (server-owned) dice stream sits at `value`. */
function withDiceStreamState(state: GameState, value: string): GameState {
  const dice = state.rng.streams.dice;
  if (dice === undefined) throw new Error("fixture missing a dice stream");

  return {
    ...state,
    rng: { streams: { ...state.rng.streams, dice: { ...dice, state: value } } },
  };
}

/**
 * The first variant of `state` whose roll draws `cardId`.
 *
 * The tile-effect RNG is seeded from server-owned canonical state, so the dice
 * stream's state is the knob that steers a draw. Searching for it keeps this
 * test aimed at a specific authored card without pinning any client-supplied
 * value, which is what the command id used to be.
 */
function stateDrawing(state: GameState, cardId: string): GameState {
  for (let candidate = 1; candidate <= 200; candidate += 1) {
    const attempt = withDiceStreamState(state, String(candidate));
    const result = applyCommand(attempt, rollCommand(attempt), context([0]));
    if (!result.ok) continue;
    const drew = result.value.events.some(
      (event) => event.type === "CardDrawn" && event.payload.cardId === cardId,
    );
    if (drew) return attempt;
  }

  throw new Error(`no dice-stream state drew ${cardId}`);
}

/**
 * The amount the authored finance tile takes, read off the tile rather than
 * restated, so a change to the content is what moves this test.
 */
function financePaymentAmount(): number {
  const spaces: readonly BoardTile[] = deadlineDashContent.board.spaces;
  const effect = spaces[boardIndexOfKind("finance")]?.effects[0];
  if (effect === undefined || effect.type !== "payResource") {
    throw new Error("the finance tile no longer leads with a payResource effect");
  }

  return effect.amount;
}

const FINANCE_PAYMENT = financePaymentAmount();

/** A copy of `state` whose owner holds `value` money. */
function withOwnerMoney(state: GameState, value: number): GameState {
  const owner = state.players[fixtureIds.owner];
  if (owner === undefined) throw new Error("fixture missing owner player");

  return {
    ...state,
    players: {
      ...state.players,
      [fixtureIds.owner]: {
        ...owner,
        resources: { ...owner.resources, money: { ...owner.resources.money, value } },
      },
    },
  };
}

describe("tile effects", () => {
  it("Given a player who can cover it, when they roll onto the finance tile, then exactly the authored amount is deducted and reported", () => {
    // The canonical fixture holds 12 money — less than the authored payment — so
    // `pay-up-to-available` clamps and the amount becomes unobservable: every
    // authored value of 12 or more empties the wallet identically. Funding it is
    // what makes the authored number the thing this assertion reads.
    const state = withOwnerMoney(rollState(boardIndexOfKind("finance") - 1), 1000);

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    // Landing on the finance tile is half the claim. Without it the deduction
    // could come from whatever tile the board order happens to put here, which
    // is exactly how this test survived the amount being changed to 30.
    expect(nextState.players[fixtureIds.owner]?.position).toBe(boardIndexOfKind("finance"));
    expect(nextState.players[fixtureIds.owner]?.resources.money.value).toBe(1000 - FINANCE_PAYMENT);
    // Reported too, so a client replaying events agrees with canonical state.
    const changed = events.find((event) => event.type === "ResourceChanged");
    expect(changed?.payload).toMatchObject({
      playerId: fixtureIds.owner,
      previousValue: 1000,
      newValue: 1000 - FINANCE_PAYMENT,
      reason: "tile-effect",
    });
  });

  it("Given a player who cannot cover it, when they roll onto the finance tile, then pay-up-to-available takes what there is and stops at zero", () => {
    const state = rollState(boardIndexOfKind("finance") - 1);
    const before = state.players[fixtureIds.owner]?.resources.money.value ?? 0;
    // The authored `insufficientFunds: "pay-up-to-available"` mode is the whole
    // subject here, so the fixture has to actually be short of the payment.
    expect(before).toBeLessThan(FINANCE_PAYMENT);
    expect(before).toBeGreaterThan(0);

    const { state: nextState } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.players[fixtureIds.owner]?.position).toBe(boardIndexOfKind("finance"));
    expect(nextState.players[fixtureIds.owner]?.resources.money.value).toBe(0);
  });

  it("Given a player one space from the energy-restore tile, when they roll onto it, then energy is restored to its maximum", () => {
    const state = rollState(boardIndexOfKind("energy-restore") - 1);
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

    // die = 1, so the restore comes from the tile itself. Rolling further would
    // risk crossing a Work tile, whose authored deck contains a card that also
    // restores energy — the assertion would then pass without the tile working.
    const result = applyCommand(drainedState, rollCommand(drainedState), context([0]));
    const { state: nextState } = accepted(result);

    expect(nextState.players[fixtureIds.owner]?.position).toBe(
      boardIndexOfKind("energy-restore"),
    );
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
    const withReputation: typeof baseState = {
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
    // Which card a draw lands on is steered by the canonical dice-stream state,
    // because the tile-effect RNG is seeded from server-owned state — a client
    // picks its own command id, so that must not reach any outcome (see
    // ephemeral-random.ts). Search for a stream state that draws the two-effect
    // jackpot card rather than pinning a hand-picked command id.
    const state = stateDrawing(withReputation, "card.event.jackpot");
    const command = rollCommand(state);

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
    // PlayerMoved must report the three spaces actually traversed, while
    // DiceRolled still reports the raw face — a client animating the token off
    // `distance` would otherwise stop two spaces short of the real position.
    const { events } = accepted(result);
    expect(events.find((event) => event.type === "PlayerMoved")?.payload).toMatchObject({
      from: 0,
      to: 3,
      distance: 3,
    });
    expect(events.find((event) => event.type === "DiceRolled")?.payload).toMatchObject({
      dice: [1],
      total: 1,
    });
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
  /**
   * The automatic promotion is now gated on `agency.promotionIsChoice` being
   * off, and the base fixture runs the Quick preset, which turns it *on* —
   * climbing there is the player's own `promotion.attempt`. These cases are
   * about what happens when the ladder is climbed automatically, so they state
   * the ruleset that does that rather than inheriting whichever one the fixture
   * happens to carry.
   */
  const automaticPromotion = (state: GameState): GameState =>
    withRules(state, { agency: { promotionIsChoice: false } });

  it("Given a player who can afford the final promotion, when they roll, then they are promoted and the match ends", () => {
    const state = automaticPromotion(rollState(0));
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

  it("Given a landing that both confines the player and promotes them to Director, when they roll, then the match ends and no audit prompt is left open", () => {
    const state = automaticPromotion(rollState(16));
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

    // die = 6 lands on tile.board.22.audit, which normally opens a prompt.
    const result = applyCommand(promotableState, rollCommand(promotableState), context([0.9]));
    const { state: nextState, events } = accepted(result);

    expect(nextState.status).toBe("ended");
    expect(nextState.outcome?.reason).toBe("director-reached");
    // An ended match must not carry an unanswerable prompt: rolling is refused
    // once the game is over, so the confinement could never be resolved.
    expect(nextState.prompts).toEqual([]);
    expect(events.some((event) => event.type === "PromptOpened")).toBe(false);
  });

  it("Given a player who cannot afford the next promotion, when they roll, then rank and status are unchanged", () => {
    const state = rollState(0);

    const result = applyCommand(state, rollCommand(state), context([0.2]));
    const { state: nextState } = accepted(result);

    expect(nextState.status).toBe("active");
    expect(nextState.outcome).toBeNull();
  });

  /**
   * The reputation gate is a real gate at the top of the ladder.
   *
   * Director's `reputationRequired` used to be 17 against a 10,000-money cost —
   * linear reputation against geometric money, which made reputation slack from
   * `rank.supervisor` upward and left money the only thing that ever bound. It
   * is 58 now. This is the case that would silently pass under the old ladder,
   * so it is the one that pins the change.
   */
  it("Given a General Manager with unlimited money but the old ladder's reputation, when they roll, then Director is refused", () => {
    const state = automaticPromotion(rollState(0));
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const richButUnknownState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          rank: { ...owner.rank, kind: "rank.general-manager" },
          resources: {
            ...owner.resources,
            money: { ...owner.resources.money, value: 999_999 },
            reputation: {
              id: owner.resources.money.id,
              kind: "resource.reputation",
              value: 17,
              minimum: 0,
              maximum: null,
            },
          },
        },
      },
    };

    // die = 1 lands on tile.board.01.training, which has no effects, so nothing
    // between the roll and the promotion check can move reputation.
    const result = applyCommand(
      richButUnknownState,
      rollCommand(richButUnknownState),
      context([0]),
    );
    const { state: nextState } = accepted(result);

    expect(nextState.status).toBe("active");
    expect(nextState.outcome).toBeNull();
    expect(nextState.players[fixtureIds.owner]?.rank.kind).toBe("rank.general-manager");
  });

  /**
   * `rank.supervisor`'s `increaseMaximumEnergy: +2` benefit sat in the schema,
   * the content pack and the validator with no engine consumer at all. This is
   * the test for the consumer, and the assertion that matters is the pair: the
   * ceiling moves 8 -> 10 and the *value* does not budge. A promotion widens the
   * tank; it does not fill it.
   */
  it("Given a Senior Staff who can afford Supervisor, when they roll, then the energy ceiling widens by 2 and the value is left alone", () => {
    const state = automaticPromotion(rollState(0));
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const promotableState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          rank: { ...owner.rank, kind: "rank.senior-staff", index: 2 },
          resources: {
            ...owner.resources,
            money: { ...owner.resources.money, value: 999_999 },
            reputation: {
              id: owner.resources.money.id,
              kind: "resource.reputation",
              value: 999,
              minimum: 0,
              maximum: null,
            },
            energy: {
              id: owner.resources.money.id,
              kind: "resource.energy",
              value: 3,
              minimum: 0,
              maximum: 8,
            },
          },
        },
      },
    };

    // die = 1 lands on tile.board.01.training, which has no effects — so the
    // only thing that can touch energy on this turn is the promotion.
    const result = applyCommand(promotableState, rollCommand(promotableState), context([0]));
    const { state: nextState } = accepted(result);

    const promoted = nextState.players[fixtureIds.owner];
    expect(promoted?.rank.kind).toBe("rank.supervisor");
    expect(promoted?.resources.energy?.maximum).toBe(10);
    expect(promoted?.resources.energy?.value).toBe(3);
  });

  it("Given a rank whose benefits do not include increaseMaximumEnergy, when a player climbs to it, then the energy ceiling is untouched", () => {
    const state = automaticPromotion(rollState(0));
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    // The fixture owner sits one rung below `rank.senior-staff`, whose only
    // benefit is an extra work-milestone reward.
    const promotableState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          resources: {
            ...owner.resources,
            money: { ...owner.resources.money, value: 999_999 },
            reputation: {
              id: owner.resources.money.id,
              kind: "resource.reputation",
              value: 999,
              minimum: 0,
              maximum: null,
            },
            energy: {
              id: owner.resources.money.id,
              kind: "resource.energy",
              value: 3,
              minimum: 0,
              maximum: 8,
            },
          },
        },
      },
    };

    const result = applyCommand(promotableState, rollCommand(promotableState), context([0]));
    const { state: nextState } = accepted(result);

    const promoted = nextState.players[fixtureIds.owner];
    expect(promoted?.rank.kind).toBe("rank.senior-staff");
    expect(promoted?.resources.energy?.maximum).toBe(8);
    expect(promoted?.resources.energy?.value).toBe(3);
  });
});
