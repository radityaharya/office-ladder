import { describe, expect, it } from "vitest";

import type { CharacterAbilityDescriptor, DeckConfig } from "@office-ladder/content";

import {
  applyCommand,
  createScriptedRandomSource,
  deserializeGameState,
  serializeGameState,
} from "../src";
import type { CharacterId, GameState, PlayerState, StatusId } from "../src";
import { resolveTileEffects } from "../src/execution/resolve-tile-effects";
import { createCanonicalGameState, fixtureIds } from "./fixtures";
import {
  accepted,
  boardIndexOfKind,
  context,
  rollCommand,
  rollState,
} from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const FINANCE_INDEX = boardIndexOfKind("finance");

const TECH_GENIUS_PASSIVE: CharacterAbilityDescriptor = {
  type: "ignoreNegativeEffect",
  usesPerLap: 1,
  sources: ["tile", "card"],
};

/**
 * No authored passive narrows `sources`: the content schema pins the field to
 * exactly `readonly ["tile", "card"]` (packages/content/src/schema/characters.ts),
 * matching the only value the pack authors. The engine nonetheless reads the
 * list literally (`shield.sources.includes(origin)`), so a narrower passive is
 * the only way to prove it is not silently treated as "any origin". The cast is
 * deliberate and is the whole point of the fixture; if the schema is ever
 * widened to a set, this becomes a plain typed value with no other change.
 */
const TILE_ONLY_PASSIVE = {
  type: "ignoreNegativeEffect",
  usesPerLap: 1,
  sources: ["tile"],
} as unknown as CharacterAbilityDescriptor;

const negativeCardDecks = [
  {
    id: "deck.work",
    cards: [
      {
        id: "card.work.reprimand",
        nameKey: "deadlineDash.card.workReprimand.name",
        effects: [{ type: "modifyResource", resource: "money", amount: -200, clampAtZero: true }],
      },
    ],
  },
] as const satisfies readonly DeckConfig[];

function techGenius(overrides: Partial<PlayerState> = {}): PlayerState {
  const owner = rollState(0).players[fixtureIds.owner];
  if (owner === undefined) throw new Error("fixture missing owner player");

  return {
    ...owner,
    characterId: "character.tech-genius" as CharacterId,
    statuses: [],
    resources: {
      ...owner.resources,
      money: { ...owner.resources.money, value: 1000 },
    },
    ...overrides,
  };
}

/** An active game whose owner is the Tech Genius, at `position` with `money`. */
function techGeniusState(
  position: number,
  spentThisLap = 0,
  money = 1000,
  statuses: PlayerState["statuses"] = [],
): GameState {
  const state = rollState(position);
  const owner = state.players[fixtureIds.owner];
  if (owner === undefined) throw new Error("fixture missing owner player");

  return {
    ...state,
    players: {
      ...state.players,
      [fixtureIds.owner]: {
        ...owner,
        position,
        characterId: "character.tech-genius" as CharacterId,
        statuses,
        negativeEffectsIgnoredThisLap: spentThisLap,
        resources: {
          ...owner.resources,
          money: { ...owner.resources.money, value: money },
        },
      },
    },
  };
}

/**
 * A one-shot `status.next-roll-extra-movement`, the authored Operation tile's
 * effect, with a bigger `spaces` value than the tile grants.
 *
 * Movement is 1d6 and the Finance tile is ten spaces past the Receptionist, so
 * no bare roll can both complete a lap and land on it. The status is the real
 * mechanism the engine already reads for exactly this (`roll-turn.ts` adds it to
 * the die before `moveAroundBoard`), so it is how the fixture reaches the tile
 * rather than a hand-set position that would skip the traversal entirely.
 */
function extraMovementStatus(spaces: number): PlayerState["statuses"] {
  return [
    {
      id: brand<StatusId>("status.next-roll-extra-movement"),
      sourceId: null,
      stacks: 1,
      remainingTurns: null,
      expiresAtRound: null,
      visibility: "private",
      data: { spaces, traversal: true },
    },
  ];
}

describe("Tech Genius ignoreNegativeEffect passive", () => {
  it("Given an unspent allowance, When a tile takes money away, Then the loss is cancelled and the lap allowance is spent", () => {
    const player = techGenius();

    const outcome = resolveTileEffects(
      player,
      [{ type: "modifyResource", resource: "money", amount: -500, clampAtZero: true }],
      createScriptedRandomSource([]),
      "finance",
      TECH_GENIUS_PASSIVE,
    );

    expect(outcome.player.resources.money.value).toBe(1000);
    expect(outcome.changes).toEqual([]);
    expect(outcome.ignoredNegativeEffects).toBe(1);
    expect(outcome.player.negativeEffectsIgnoredThisLap).toBe(1);
    expect(outcome.trace).toEqual([
      {
        type: "negative-effect-ignored",
        ignored: { origin: "tile", effectType: "modifyResource", resource: "money", amount: 500 },
      },
    ]);
  });

  it("Given one use per lap, When a tile carries two losses, Then only the first is cancelled", () => {
    const player = techGenius();

    const outcome = resolveTileEffects(
      player,
      [
        { type: "payResource", resource: "money", amount: 300, insufficientFunds: "pay-up-to-available" },
        { type: "payResource", resource: "money", amount: 200, insufficientFunds: "pay-up-to-available" },
      ],
      createScriptedRandomSource([]),
      "finance",
      TECH_GENIUS_PASSIVE,
    );

    expect(outcome.player.resources.money.value).toBe(800);
    expect(outcome.ignoredNegativeEffects).toBe(1);
    expect(outcome.player.negativeEffectsIgnoredThisLap).toBe(1);
  });

  it("Given the allowance was already spent this lap, When another loss lands, Then it applies in full", () => {
    const player = techGenius({ negativeEffectsIgnoredThisLap: 1 });

    const outcome = resolveTileEffects(
      player,
      [{ type: "modifyResource", resource: "money", amount: -400, clampAtZero: true }],
      createScriptedRandomSource([]),
      "finance",
      TECH_GENIUS_PASSIVE,
    );

    expect(outcome.player.resources.money.value).toBe(600);
    expect(outcome.ignoredNegativeEffects).toBe(0);
    expect(outcome.player.negativeEffectsIgnoredThisLap).toBe(1);
  });

  it("Given a gain, When it resolves, Then the allowance is left alone", () => {
    const player = techGenius();

    const outcome = resolveTileEffects(
      player,
      [{ type: "modifyResource", resource: "money", amount: 500 }],
      createScriptedRandomSource([]),
      "best-employee",
      TECH_GENIUS_PASSIVE,
    );

    expect(outcome.player.resources.money.value).toBe(1500);
    expect(outcome.ignoredNegativeEffects).toBe(0);
    expect(outcome.player.negativeEffectsIgnoredThisLap).toBe(0);
  });

  /**
   * Each case asserts the setback *actually landed* in full, not merely that the
   * player object changed: a `not.toEqual(player)` here would still pass if the
   * effect were applied with the wrong magnitude, or replaced by any other
   * mutation, which is precisely the drift this parameterisation exists to stop.
   */
  it.each([
    [
      "skipped turns",
      { type: "skipTurns", count: 2, source: "tile" },
      (outcome: ReturnType<typeof resolveTileEffects>) => {
        expect(outcome.player.skipTurns).toBe(2);
        expect(outcome.player.inAudit).toBe(false);
        expect(outcome.openAuditPrompt).toBe(false);
      },
    ],
    [
      "an audit confinement",
      {
        type: "auditConfinement",
        release: {
          roll: { count: 2, sides: 6 },
          requiresTrueDoubles: true,
          rerollEligible: false,
          alternativeFine: 500,
        },
      },
      (outcome: ReturnType<typeof resolveTileEffects>) => {
        expect(outcome.player.inAudit).toBe(true);
        expect(outcome.openAuditPrompt).toBe(true);
        expect(outcome.player.skipTurns).toBe(0);
      },
    ],
    [
      "a penalty status",
      {
        type: "applyStatus",
        statusId: "status.burnout-tile",
        duration: { kind: "turns", count: 2 },
        parameters: { movementPenalty: 1 },
      },
      (outcome: ReturnType<typeof resolveTileEffects>) => {
        expect(outcome.player.statuses).toEqual([
          expect.objectContaining({
            id: "status.burnout-tile",
            remainingTurns: 2,
            data: { movementPenalty: 1 },
          }),
        ]);
      },
    ],
  ] as const)(
    "Given a setback that is not a resource loss (%s), When it resolves, Then the passive deliberately does not cancel it and the setback lands in full",
    (_label, effect, assertLanded) => {
      const player = techGenius();

      const outcome = resolveTileEffects(
        player,
        [effect],
        createScriptedRandomSource([]),
        "burnout",
        TECH_GENIUS_PASSIVE,
      );

      expect(outcome.ignoredNegativeEffects).toBe(0);
      expect(outcome.player.negativeEffectsIgnoredThisLap).toBe(0);
      expect(outcome.trace).toEqual([]);
      // The allowance is untouched, so a later real resource loss still gets it.
      expect(outcome.player.resources.money.value).toBe(1000);
      assertLanded(outcome);
    },
  );

  it("Given a passive that shields only tile effects, When a drawn card takes money away, Then the card loss is not cancelled", () => {
    const player = techGenius();

    const outcome = resolveTileEffects(
      player,
      [{ type: "drawCards", deckId: "deck.work", count: 1 }],
      createScriptedRandomSource([0]),
      "work",
      TILE_ONLY_PASSIVE,
      negativeCardDecks,
    );

    // The authored `sources` list is honoured literally, not treated as "any".
    expect(outcome.player.resources.money.value).toBe(800);
    expect(outcome.ignoredNegativeEffects).toBe(0);
    expect(outcome.player.negativeEffectsIgnoredThisLap).toBe(0);
  });

  it("Given a tile loss followed by a card loss, When both resolve, Then the tile spends the only allowance and the card loss lands", () => {
    const player = techGenius();

    const outcome = resolveTileEffects(
      player,
      [
        { type: "payResource", resource: "money", amount: 300, insufficientFunds: "pay-up-to-available" },
        { type: "drawCards", deckId: "deck.work", count: 1 },
      ],
      createScriptedRandomSource([0]),
      "work",
      TECH_GENIUS_PASSIVE,
      negativeCardDecks,
    );

    // The tile's 300 is cancelled; the card's 200 is not, because the allowance
    // has to be shared across the whole walk rather than refreshed per origin.
    expect(outcome.player.resources.money.value).toBe(800);
    expect(outcome.ignoredNegativeEffects).toBe(1);
    expect(outcome.player.negativeEffectsIgnoredThisLap).toBe(1);
    expect(outcome.trace).toEqual([
      {
        type: "negative-effect-ignored",
        ignored: { origin: "tile", effectType: "payResource", resource: "money", amount: 300 },
      },
      expect.objectContaining({ type: "card-drawn" }),
      {
        type: "resource-changed",
        change: { resource: "money", previousValue: 1000, newValue: 800 },
      },
    ]);
  });

  it("Given a drawn card that takes money away, When it resolves, Then the passive cancels it and records the card as the source", () => {
    const player = techGenius();

    const outcome = resolveTileEffects(
      player,
      [{ type: "drawCards", deckId: "deck.work", count: 1 }],
      createScriptedRandomSource([0]),
      "work",
      TECH_GENIUS_PASSIVE,
      negativeCardDecks,
    );

    expect(outcome.player.resources.money.value).toBe(1000);
    expect(outcome.ignoredNegativeEffects).toBe(1);
    expect(outcome.trace).toEqual([
      expect.objectContaining({ type: "card-drawn" }),
      {
        type: "negative-effect-ignored",
        ignored: { origin: "card", effectType: "modifyResource", resource: "money", amount: 200 },
      },
    ]);
  });

  it("Given a Tech Genius one space from the finance tile, When they land on it, Then no money is lost and EffectPrevented is emitted", () => {
    const state = techGeniusState(FINANCE_INDEX - 1);

    // die = 1 lands on tile.board.10.finance (pay 300)
    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    expect(nextState.players[fixtureIds.owner]?.resources.money.value).toBe(1000);
    expect(nextState.players[fixtureIds.owner]?.negativeEffectsIgnoredThisLap).toBe(1);
    const prevented = events.find((event) => event.type === "EffectPrevented");
    expect(prevented?.payload).toMatchObject({
      preventedByPlayerId: fixtureIds.owner,
      sourceId: "passive:ignoreNegativeEffect:tile:payResource:money:300",
    });
    // The passive consumes no randomness of its own.
    expect(nextState.rng.streams.dice?.cursor).toBe(1);
  });

  it("Given a spent allowance, When the same roll completes a lap and lands on a loss, Then the new lap's allowance cancels it", () => {
    const state = techGeniusState(43, 1, 1000, extraMovementStatus(10));

    // die = 1 plus the status's 10 spaces: 43 crosses the receptionist (lap) and
    // lands on finance, ten spaces past it.
    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    const owner = nextState.players[fixtureIds.owner];
    expect(owner?.position).toBe(FINANCE_INDEX);
    expect(owner?.lapsCompleted).toBe(1);
    // 1000 + 500 pass-through salary (rank.staff's 400 plus its 100
    // receptionist-pass bonus), with the tile's 300 payment cancelled.
    expect(owner?.resources.money.value).toBe(1500);
    // Reset to zero by the lap, then spent once by this tile.
    expect(owner?.negativeEffectsIgnoredThisLap).toBe(1);
    expect(events.some((event) => event.type === "EffectPrevented")).toBe(true);
  });

  it("Given a character without the passive, When a loss lands, Then it applies in full", () => {
    const state = techGeniusState(FINANCE_INDEX - 1);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const withoutPassive: GameState = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: { ...owner, characterId: "character.workaholic" as CharacterId },
      },
    };

    const { state: nextState } = accepted(
      applyCommand(withoutPassive, rollCommand(withoutPassive), context([0])),
    );

    expect(nextState.players[fixtureIds.owner]?.resources.money.value).toBe(700);
    expect(nextState.players[fixtureIds.owner]?.negativeEffectsIgnoredThisLap).toBe(0);
  });

  it("Given a spent per-lap counter, When the state is serialized, Then it round-trips and is required on the way back in", () => {
    const state = createCanonicalGameState();
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    const withCounter: GameState = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: { ...owner, negativeEffectsIgnoredThisLap: 1 },
      },
    };

    const serialized = serializeGameState(withCounter);
    const restored = deserializeGameState(serialized);

    expect(restored).toEqual(withCounter);
    expect(restored.players[fixtureIds.owner]?.negativeEffectsIgnoredThisLap).toBe(1);

    const withoutField = JSON.parse(serialized) as {
      players: Record<string, { negativeEffectsIgnoredThisLap?: number }>;
    };
    delete withoutField.players[fixtureIds.owner]?.negativeEffectsIgnoredThisLap;
    expect(() => deserializeGameState(JSON.stringify(withoutField))).toThrow(
      /negativeEffectsIgnoredThisLap/,
    );
  });
});
