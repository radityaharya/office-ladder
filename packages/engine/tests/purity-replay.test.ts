import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";
import type { BoardTile } from "@office-ladder/content";

import {
  applyCommand,
  deserializeGameState,
  serializeGameState,
  stableStringify,
} from "../src";
import type {
  CommandId,
  GameState,
  PromptOptionId,
  RespondToPromptCommand,
  RollTurnCommand,
} from "../src";
import { fixtureIds } from "./fixtures";
import { logicalTimestamp, rollCommand, rollState } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

/**
 * A context with no injected `random`, which is the production path: the die
 * comes from the persisted "dice" stream restored out of canonical state. This
 * is the only shape whose determinism actually matters for replay, so every
 * assertion below uses it rather than a scripted source.
 */
function productionContext(timestamp = logicalTimestamp) {
  return { logicalTimestamp: timestamp, content: deadlineDashContent };
}

/**
 * `rollState` carries a `test-prng` dice stream that the production path
 * refuses, and a player holding only money. This gives the acting player a
 * real seeded stream, every resource the board's effects touch, and a
 * character whose passive is actually implemented.
 */
function productionRollState(
  position: number,
  overrides: {
    readonly money?: number;
    readonly characterId?: string;
    readonly seed?: string;
  } = {},
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
        statuses: [],
        characterId: brand(overrides.characterId ?? "character.tech-genius"),
        resources: {
          money: { ...owner.resources.money, value: overrides.money ?? 800 },
          reputation: {
            id: brand("resource-owner-reputation"),
            kind: "resource.reputation",
            value: 2,
            minimum: 0,
            maximum: null,
          },
          energy: {
            id: brand("resource-owner-energy"),
            kind: "resource.energy",
            value: 6,
            minimum: 0,
            maximum: 10,
          },
          "work-counter": {
            id: brand("resource-owner-work-counter"),
            kind: "resource.work-counter",
            value: 4,
            minimum: 0,
            maximum: null,
          },
        },
      },
    },
    rng: {
      streams: {
        dice: {
          algorithm: "xorshift32",
          version: "1",
          state: overrides.seed ?? "305419896",
          cursor: 0,
        },
      },
    },
  };
}

/**
 * Recursively freezes a value. Because every engine module is an ES module and
 * therefore strict-mode code, any write to a frozen object throws instead of
 * failing silently — which turns "the engine must not mutate its inputs" into
 * something a test can actually observe.
 */
function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner, seen);
  }

  return Object.freeze(value);
}

function applyTwice(
  state: GameState,
  command: RollTurnCommand | RespondToPromptCommand,
): { readonly state: GameState; readonly events: readonly unknown[] } {
  const frozen = deepFreeze(structuredClone(state));
  const first = applyCommand(frozen, command, productionContext());
  const second = applyCommand(frozen, command, productionContext());

  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  if (!first.ok || !second.ok) throw new Error("command was rejected");

  // Identical events (ids, sequences, payloads) and identical next state.
  expect(stableStringify(second.value.events)).toBe(stableStringify(first.value.events));
  expect(stableStringify(second.value.state)).toBe(stableStringify(first.value.state));
  // The input was not mutated on the way through.
  expect(stableStringify(frozen)).toBe(stableStringify(state));

  return { state: first.value.state, events: first.value.events };
}

const everyPosition = Array.from({ length: deadlineDashContent.board.spaces.length }, (_, index) => index);

describe("engine purity and replay determinism", () => {
  it.each(everyPosition)(
    "Given a frozen pre-roll state at position %i, When the same roll is applied twice, Then the events and next state are byte-identical",
    (position) => {
      const state = productionRollState(position);

      const { state: next } = applyTwice(state, rollCommand(state));

      // Exactly one die per roll, so the persisted stream advanced exactly once.
      expect(next.rng.streams.dice?.cursor).toBe(1);
    },
  );

  it.each(everyPosition)(
    "Given the state produced by landing on the tile reached from position %i, When it is serialized, Then it round-trips unchanged",
    (position) => {
      const state = productionRollState(position);
      const first = applyCommand(state, rollCommand(state), productionContext());
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);

      const serialized = serializeGameState(first.value.state);
      expect(deserializeGameState(serialized)).toEqual(first.value.state);
      expect(serializeGameState(deserializeGameState(serialized))).toBe(serialized);
    },
  );

  it.each(everyPosition)(
    "Given a pre-roll state at position %i that has been through the jsonb snapshot boundary, When the same roll is applied, Then it yields the same events and state as the in-memory original",
    (position) => {
      const state = productionRollState(position);
      // Round-tripping canonicalises record key order (stringifyCompatible
      // sorts keys, JSON.parse preserves the sorted order), so this is the one
      // check that a resumed room replays identically to a live one.
      const restored = deserializeGameState(serializeGameState(state));

      const live = applyCommand(state, rollCommand(state), productionContext());
      const resumed = applyCommand(restored, rollCommand(restored), productionContext());
      expect(live.ok).toBe(true);
      expect(resumed.ok).toBe(true);
      if (!live.ok || !resumed.ok) throw new Error("command was rejected");

      expect(stableStringify(resumed.value.events)).toBe(stableStringify(live.value.events));
      expect(stableStringify(resumed.value.state)).toBe(stableStringify(live.value.state));
    },
  );

  it("Given every board position, When Tech Genius rolls, Then at least one tile really does exercise the negative-effect shield", () => {
    const prevented = everyPosition.flatMap((position) => {
      const state = productionRollState(position, { seed: "1" });
      const result = applyCommand(state, rollCommand(state), productionContext());
      if (!result.ok) return [];
      return result.value.events.filter((event) => event.type === "EffectPrevented");
    });

    expect(prevented.length).toBeGreaterThan(0);
  });

  it("Given the shared content pack, When every board position is rolled, Then the pack is never mutated", () => {
    // deadlineDashContent is a module singleton shared by every game in the
    // process; mutating it would contaminate unrelated rooms and break replay.
    const before = stableStringify(deadlineDashContent);

    for (const position of everyPosition) {
      const state = productionRollState(position);
      applyCommand(state, rollCommand(state), productionContext());
    }

    expect(stableStringify(deadlineDashContent)).toBe(before);
  });

  it.each(everyPosition)(
    "Given the same roll at position %i under two different logical timestamps, Then only the timestamps differ",
    (position) => {
      const state = productionRollState(position);

      const early = applyCommand(state, rollCommand(state), productionContext("2020-01-01T00:00:00.000Z"));
      const late = applyCommand(state, rollCommand(state), productionContext("2099-12-31T23:59:59.000Z"));
      expect(early.ok).toBe(true);
      expect(late.ok).toBe(true);
      if (!early.ok || !late.ok) throw new Error("command was rejected");

      // Time must never reach the dice, the effects, or the turn machinery.
      const strip = (value: string) =>
        value.replaceAll("2020-01-01T00:00:00.000Z", "T").replaceAll("2099-12-31T23:59:59.000Z", "T");
      expect(strip(stableStringify(late.value.events))).toBe(strip(stableStringify(early.value.events)));
      expect(strip(stableStringify(late.value.state))).toBe(strip(stableStringify(early.value.state)));
    },
  );

  it("Given several distinct seeds, When each is rolled, Then the die is a function of the seed alone and never of call order", () => {
    const seeds = ["305419896", "2654435769", "99194853", "7", "4294967291"];
    const firstPass = seeds.map((seed) => {
      const state = productionRollState(20, { seed });
      const result = applyCommand(state, rollCommand(state), productionContext());
      if (!result.ok) throw new Error(result.error.message);
      return stableStringify(result.value.events);
    });
    // Same seeds, opposite order: a shared or ambient source would show up here.
    const secondPass = [...seeds].reverse().map((seed) => {
      const state = productionRollState(20, { seed });
      const result = applyCommand(state, rollCommand(state), productionContext());
      if (!result.ok) throw new Error(result.error.message);
      return stableStringify(result.value.events);
    });

    expect(secondPass).toEqual([...firstPass].reverse());
  });

  it("Given a Tech Genius who absorbs a loss, When the roll is replayed, Then the per-lap counter and EffectPrevented event are identical and the state round-trips", () => {
    // The finance tile charges money; one space short of it, any die reaches it.
    const financeIndex = deadlineDashContent.board.spaces.findIndex(
      (tile) => tile.kind === "finance",
    );
    expect(financeIndex).toBeGreaterThan(0);
    const state = productionRollState(financeIndex - 1, { seed: "1" });

    const { state: next, events } = applyTwice(state, rollCommand(state));

    const prevented = events.filter(
      (event) => (event as { readonly type: string }).type === "EffectPrevented",
    );
    if (prevented.length > 0) {
      expect(next.players[fixtureIds.owner]?.negativeEffectsIgnoredThisLap).toBe(
        prevented.length,
      );
    }
    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
  });

  it("Given a held training decision, When the state is serialized, Then the prompt phase and prompt round-trip, and answering it twice is deterministic", () => {
    // `decision` is optional, so the `as const` board tuple does not surface it
    // without widening to the schema type.
    const decisionTiles = (deadlineDashContent.board.spaces as readonly BoardTile[]).filter(
      (tile) => tile.decision !== undefined,
    );
    expect(decisionTiles.length).toBeGreaterThan(0);
    // Find the position that actually lands on a decision tile rather than
    // assuming which die this seed produces.
    const asked = everyPosition
      .map((position) => {
        const state = productionRollState(position, { seed: "1", money: 1000 });
        const result = applyCommand(state, rollCommand(state), productionContext());
        return result.ok ? result.value.state : null;
      })
      .find((candidate) => candidate?.turn.phase === "prompt");
    if (asked === undefined || asked === null) {
      throw new Error("no position landed on the decision tile");
    }

    expect(asked.prompts).toHaveLength(1);
    expect(deserializeGameState(serializeGameState(asked))).toEqual(asked);

    const promptId = asked.prompts[0]?.id;
    if (promptId === undefined) throw new Error("expected an open prompt");
    const respond: RespondToPromptCommand = {
      commandId: brand<CommandId>("respond-determinism"),
      gameId: asked.gameId,
      actorId: fixtureIds.owner,
      expectedRevision: asked.revision,
      decisionPointId: promptId,
      type: "prompt.respond",
      payload: { optionId: brand<PromptOptionId>("enroll"), value: null },
    };

    const { state: answered } = applyTwice(asked, respond);

    // Answering consumed no movement dice.
    expect(answered.rng.streams.dice?.cursor).toBe(asked.rng.streams.dice?.cursor);
    expect(deserializeGameState(serializeGameState(answered))).toEqual(answered);
  });

  it("Given the burnout tile's turns-duration status, When the holder's later rolls are replayed, Then every step is deterministic and serializable", () => {
    const burnoutIndex = deadlineDashContent.board.spaces.findIndex(
      (tile) => tile.kind === "burnout",
    );
    expect(burnoutIndex).toBeGreaterThan(0);

    let state: GameState | null = null;
    for (const position of everyPosition) {
      const candidate = productionRollState(position, { seed: "1" });
      const result = applyCommand(candidate, rollCommand(candidate), productionContext());
      if (!result.ok) continue;
      if (result.value.state.players[fixtureIds.owner]?.position === burnoutIndex) {
        state = result.value.state;
        break;
      }
    }
    if (state === null) throw new Error("no position landed on the burnout tile");

    const burnt = state.players[fixtureIds.owner];
    expect(burnt?.statuses.map((status) => status.id)).toContain("status.burnout-tile");
    expect(burnt?.statuses.find((status) => status.id === "status.burnout-tile")?.remainingTurns).toBe(2);
    expect(deserializeGameState(serializeGameState(state))).toEqual(state);

    // Walk the holder's next three own turns, replaying each command twice.
    let current: GameState = state;
    for (let turnIndex = 0; turnIndex < 3; turnIndex += 1) {
      const ready: GameState = {
        ...current,
        prompts: [],
        turn: { ...current.turn, activePlayerId: fixtureIds.owner, phase: "pre-roll" },
      };
      const command = rollCommand(ready, {
        commandId: brand<CommandId>(`burnout-roll-${turnIndex}`),
      });
      current = applyTwice(ready, command).state;
      expect(deserializeGameState(serializeGameState(current))).toEqual(current);
    }

    expect(
      current.players[fixtureIds.owner]?.statuses.some(
        (status) => status.id === "status.burnout-tile",
      ),
    ).toBe(false);
  });
});
