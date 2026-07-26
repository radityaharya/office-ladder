import { describe, expect, it } from "vitest";

import type { DeckConfig, EffectDescriptor } from "@office-ladder/content";

import type { GameState, PlayerId } from "../src";
import {
  applyEffectDescriptors,
  resolveTileEffects,
  type V2RoutingContext,
} from "../src/execution/resolve-tile-effects";
import {
  effectsRandom,
  effectsV2Ids,
  effectsV2State,
  moneyOf,
  reputationOf,
} from "./effects-v2-fixtures";

/**
 * The seam between the v1 per-player effect walk and the gameplay-v2 resolver.
 *
 * The v1 walk owns one `PlayerState`; every v2 effect is state-scoped — it
 * targets somebody else, opens a prompt, raises a window, or writes to the
 * shared board. `resolve-tile-effects.ts` does not reimplement any of that. It
 * routes, and these tests are about the routing: that a v2 effect reaches
 * `resolveEffectsV2`, that the state it returns is taken verbatim, that a v1
 * effect on the same list is unaffected, and that a caller with no game state to
 * route into is told so rather than quietly losing the effect.
 */

function routing(state: GameState, actorId: PlayerId = effectsV2Ids.actor): V2RoutingContext {
  return { state, actorId, options: { characters: [] } };
}

const noDecks: readonly DeckConfig[] = [];

/** A one-card deck, so a `drawCards` in a test draws a known effect list. */
function deckOf(effects: readonly EffectDescriptor[]): readonly DeckConfig[] {
  return [
    {
      id: "deck.work",
      kind: "management",
      nameKey: "test.deck",
      shuffleOnExhaustion: true,
      cards: [
        {
          id: "card.test.routed",
          deckId: "deck.work",
          nameKey: "test.card",
          displayName: "Test Card",
          descriptionKey: "test.card.description",
          rarity: "common",
          effects,
        },
      ],
    } as unknown as DeckConfig,
  ];
}

describe("effect routing — a tile's v2 effects reach the v2 resolver", () => {
  it("Given a tile whose effects include modifyHeat, When it resolves with a routing context, Then the heat really moves and the routed state carries it", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const outcome = resolveTileEffects(
      player,
      [{ type: "modifyHeat", amount: 3 }],
      effectsRandom(),
      "event",
      undefined,
      noDecks,
      undefined,
      routing(state),
    );

    expect(outcome.unresolvedEffects).toEqual([]);
    expect(outcome.v2).not.toBeNull();
    // Taken from `outcome.v2.state`, not rebuilt from the trace.
    expect(outcome.v2?.state.players[effectsV2Ids.actor]?.heat.value).toBe(3);
    // …and the player the v1 half reports is the same record, not a stale copy.
    expect(outcome.player.heat.value).toBe(3);
  });

  it("Given a tile mixing a v1 and a v2 effect, When it resolves, Then the v1 effect lands on the walked player and the v2 effect lands across the table", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const outcome = resolveTileEffects(
      player,
      [
        { type: "modifyResource", resource: "reputation", amount: 2 },
        {
          type: "transferResource",
          resource: "money",
          amount: 250,
          target: "poorest",
        },
      ],
      effectsRandom(),
      "networking",
      undefined,
      noDecks,
      undefined,
      routing(state),
    );

    // The v1 effect reports through the v1 channels, exactly as before.
    expect(outcome.changes).toEqual([
      { resource: "reputation", previousValue: 5, newValue: 7 },
    ]);
    expect(reputationOf(outcome.v2!.state, effectsV2Ids.actor)).toBe(7);

    // The v2 effect moved money off a player this walk never held.
    expect(moneyOf(outcome.v2!.state, effectsV2Ids.rival)).toBe(150);
    expect(moneyOf(outcome.v2!.state, effectsV2Ids.actor)).toBe(1250);

    // v2 resource changes stay in the v2 bucket: they carry a `playerId` the v1
    // shape cannot express, so a caller emitting events has to drain both.
    expect(
      outcome.v2?.changes.map((change) => [change.playerId, change.resource]),
    ).toEqual([
      [effectsV2Ids.rival, "money"],
      [effectsV2Ids.actor, "money"],
    ]);
  });

  it("Given a routed effect that opens a prompt, When the tile resolves, Then the prompt is already on the routed state", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const outcome = resolveTileEffects(
      player,
      [
        {
          type: "modifyResource",
          resource: "money",
          amount: -100,
          target: "chosen-opponent",
        },
      ],
      effectsRandom(),
      "event",
      undefined,
      noDecks,
      undefined,
      routing(state),
    );

    expect(outcome.v2?.openedPrompts).toHaveLength(1);
    // Already appended — `outcome.v2.state` is the whole answer.
    expect(outcome.v2?.state.prompts).toHaveLength(1);
    expect(outcome.v2?.parkedEffects).toHaveLength(1);
    expect(outcome.v2?.state.pendingEffects).toHaveLength(1);
    // Nobody was picked for the player.
    expect(moneyOf(outcome.v2!.state, effectsV2Ids.rival)).toBe(400);
    expect(moneyOf(outcome.v2!.state, effectsV2Ids.leader)).toBe(2000);
  });

  it("Given two routed effects in one tile, When both park, Then they do not collide on an id", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const outcome = resolveTileEffects(
      player,
      [
        { type: "modifyResource", resource: "money", amount: -100, target: "chosen-opponent" },
        { type: "modifyResource", resource: "reputation", amount: -1, target: "chosen-opponent" },
      ],
      effectsRandom(),
      "event",
      undefined,
      noDecks,
      undefined,
      routing(state),
    );

    const ids = outcome.v2?.parkedEffects.map((pending) => pending.id) ?? [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(new Set(outcome.v2?.openedPrompts.map((prompt) => prompt.id)).size).toBe(2);
  });

  it("Given a drawn card carrying a v2 effect, When the tile's drawCards resolves it, Then the card's effect is routed too", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const outcome = resolveTileEffects(
      player,
      [{ type: "drawCards", deckId: "deck.work", count: 1 }],
      effectsRandom(),
      "work",
      undefined,
      deckOf([{ type: "modifyHeat", amount: 2 }]),
      undefined,
      routing(state),
    );

    expect(outcome.trace.some((entry) => entry.type === "card-drawn")).toBe(true);
    expect(outcome.unresolvedEffects).toEqual([]);
    expect(outcome.v2?.state.players[effectsV2Ids.actor]?.heat.value).toBe(2);
  });

  it("Given a routed effect that runs after a v1 effect, When it resolves, Then it sees the in-flight player rather than the state the walk started from", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    // The actor holds 1000. Spend 900 on the v1 path, then route an effect
    // guarded by "the actor has at most 200". It fires only if the resolver is
    // reading the in-flight player; against the state the walk started from the
    // guard is false and nothing happens.
    const outcome = resolveTileEffects(
      player,
      [
        {
          type: "payResource",
          resource: "money",
          amount: 900,
          insufficientFunds: "pay-up-to-available",
        },
        {
          type: "modifyHeat",
          amount: 5,
          condition: { kind: "resourceAtMost", who: "actor", resource: "money", amount: 200 },
        },
      ],
      effectsRandom(),
      "finance",
      undefined,
      noDecks,
      undefined,
      routing(state),
    );

    expect(moneyOf(outcome.v2!.state, effectsV2Ids.actor)).toBe(100);
    expect(outcome.v2?.state.players[effectsV2Ids.actor]?.heat.value).toBe(5);

    // The mirror image: the same guard against a walk that never spent.
    const untouched = resolveTileEffects(
      player,
      [
        {
          type: "modifyHeat",
          amount: 5,
          condition: { kind: "resourceAtMost", who: "actor", resource: "money", amount: 200 },
        },
      ],
      effectsRandom(),
      "finance",
      undefined,
      noDecks,
      undefined,
      routing(state),
    );

    expect(untouched.v2?.state.players[effectsV2Ids.actor]?.heat.value).toBe(0);
  });
});

describe("effect routing — a caller with no game state is told, not silently emptied", () => {
  it("Given a tile with a v2 effect and no routing context, When it resolves, Then the effect is reported unresolved and the player is untouched", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const outcome = resolveTileEffects(
      player,
      [
        { type: "modifyResource", resource: "reputation", amount: 1 },
        { type: "modifyHeat", amount: 3 },
      ],
      effectsRandom(),
      "event",
      undefined,
      noDecks,
    );

    expect(outcome.v2).toBeNull();
    expect(outcome.unresolvedEffects).toEqual([
      { effectType: "modifyHeat", reason: "no-routing-context" },
    ]);
    // The v1 effect on the same list still resolved, and the player is a real
    // `PlayerState` rather than the corrupted value the old `satisfies never`
    // default returned once content outgrew it.
    expect(outcome.player.resources["reputation"]?.value).toBe(6);
    expect(outcome.player.heat.value).toBe(0);
  });

  it("Given `noEffect`, When it resolves without a routing context, Then it is not reported unresolved — doing nothing is the whole behaviour", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const outcome = resolveTileEffects(
      player,
      [{ type: "noEffect" }],
      effectsRandom(),
      "event",
      undefined,
      noDecks,
    );

    expect(outcome.unresolvedEffects).toEqual([]);
    expect(outcome.changes).toEqual([]);
    expect(outcome.player).toEqual(player);
  });

  it("Given a decision branch resolved through applyEffectDescriptors, When it carries a v2 effect and a routing context, Then it routes the same way", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const applied = applyEffectDescriptors(
      player,
      [{ type: "modifyHeat", amount: 4 }],
      effectsRandom(),
      noDecks,
      routing(state),
    );

    expect(applied.unresolvedEffects).toEqual([]);
    expect(applied.v2?.state.players[effectsV2Ids.actor]?.heat.value).toBe(4);
    expect(applied.player.heat.value).toBe(4);
  });
});

describe("effect routing — the routed state survives persistence", () => {
  it("Given a routed batch that wrote prompts and pending effects, When the state is JSON round-tripped, Then it comes back identical", () => {
    const state = effectsV2State();
    const player = state.players[effectsV2Ids.actor]!;

    const outcome = resolveTileEffects(
      player,
      [
        { type: "modifyHeat", amount: 2 },
        { type: "modifyResource", resource: "money", amount: -100, target: "chosen-opponent" },
      ],
      effectsRandom(),
      "event",
      undefined,
      noDecks,
      undefined,
      routing(state),
    );

    const routed = outcome.v2!.state;
    expect(JSON.parse(JSON.stringify(routed))).toEqual(routed);
  });
});
