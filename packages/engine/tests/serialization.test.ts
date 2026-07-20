import { describe, expect, it } from "vitest";

import { deserializeGameState, serializeGameState } from "../src";
import { createStableId } from "../src/model/ids";
import { SUPPORTED_GAME_STATE_SCHEMA_VERSION } from "../src/serialization";
import { createCanonicalGameState } from "./fixtures";

type MutableGameState = {
  versions: { stateSchemaVersion: number };
  startAuthorizedPlayerId?: string;
  playerOrder: string[];
  players: Record<string, { rank: { index: unknown }; hand: string[] }>;
  turn: { activePlayerId: string | null };
  boardSize: number;
  decks: Record<string, {
    drawPile: unknown;
    discardPile: string[];
    visibleCards: string[];
  }>;
  rng: { streams: { dice: { cursor: number } } };
  outcome: unknown;
};

function createMutableGameState(): MutableGameState {
  return JSON.parse(JSON.stringify(createCanonicalGameState())) as MutableGameState;
}

function serializeInvalidValue(value: unknown): string {
  return Reflect.apply(serializeGameState, undefined, [value]);
}

describe("game state serialization", () => {
  it("constructs stable IDs from non-empty values", () => {
    const playerId = createStableId("PlayerId", "owner");

    expect(playerId).toBe("owner");
  });

  it("rejects an empty stable ID value", () => {
    expect(() => createStableId("PlayerId", "")).toThrow(
      /value must be a non-empty string/,
    );
  });

  it("has a stable canonical roundtrip", () => {
    const state = createCanonicalGameState();
    const serialized = serializeGameState(state);
    const restored = deserializeGameState(serialized);

    expect(restored).toEqual(state);
    expect(serializeGameState(restored)).toBe(serialized);
  });

  it.each([
    ["undefined", () => ({ ...createCanonicalGameState(), stateHash: undefined })],
    ["a non-finite number", () => ({ ...createCanonicalGameState(), revision: NaN })],
    ["a class instance", () => ({ ...createCanonicalGameState(), outcome: new Date() })],
    [
      "a cycle",
      () => {
        const state = { ...createCanonicalGameState() } as Record<string, unknown>;
        state.cycle = state;
        return state;
      },
    ],
  ])("rejects a state containing %s", (_label, createValue) => {
    expect(() => serializeInvalidValue(createValue())).toThrow();
  });

  it.each(["null", "[]", "{}", "not-json"])(
    "rejects an invalid serialized value: %s",
    (value) => {
      expect(() => deserializeGameState(value)).toThrow();
    },
  );

  it("rejects a minimal envelope that omits required state", () => {
    const minimalEnvelope = {
      gameId: "game",
      modeId: "mode",
      status: "active",
      revision: 0,
      versions: { stateSchemaVersion: SUPPORTED_GAME_STATE_SCHEMA_VERSION },
    };

    expect(() => deserializeGameState(JSON.stringify(minimalEnvelope))).toThrow(
      /replaySchemaVersion/,
    );
  });

  it.each([
    ["unsupported schema version", (state: MutableGameState) => {
      state.versions.stateSchemaVersion = SUPPORTED_GAME_STATE_SCHEMA_VERSION + 1;
    }],
    ["malformed player rank", (state: MutableGameState) => {
      state.players[state.playerOrder[0]].rank.index = "first";
    }],
    ["malformed deck", (state: MutableGameState) => {
      state.decks[Object.keys(state.decks)[0]].drawPile = {};
    }],
    ["malformed RNG stream", (state: MutableGameState) => {
      state.rng.streams.dice.cursor = -1;
    }],
    ["missing active player", (state: MutableGameState) => {
      state.turn.activePlayerId = "missing-player";
    }],
    ["missing start authorization", (state: MutableGameState) => {
      delete state.startAuthorizedPlayerId;
    }],
    ["a missing authorized starter", (state: MutableGameState) => {
      state.startAuthorizedPlayerId = "missing-player";
    }],
    ["mismatched player order", (state: MutableGameState) => {
      state.playerOrder = state.playerOrder.slice(1);
    }],
    ["too many tile IDs", (state: MutableGameState) => {
      state.boardSize = 1;
    }],
    ["too few tile IDs", (state: MutableGameState) => {
      state.boardSize += 1;
    }],
    ["a dangling deck card reference", (state: MutableGameState) => {
      const drawPile = state.decks[Object.keys(state.decks)[0]].drawPile;
      if (Array.isArray(drawPile)) {
        drawPile[0] = "missing-card";
      }
    }],
    ["malformed nullable outcome", (state: MutableGameState) => {
      state.outcome = {};
    }],
  ])("rejects %s", (_label, mutate) => {
    const state = createMutableGameState();
    mutate(state);

    expect(() => deserializeGameState(JSON.stringify(state))).toThrow();
  });
});
