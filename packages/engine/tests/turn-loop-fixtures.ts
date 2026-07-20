import { expect } from "vitest";

import {
  applyCommand,
  type CommandId,
  type GameEvent,
  type GameState,
  type RollTurnCommand,
  type StartGameCommand,
  createScriptedRandomSource,
  type RandomSource,
} from "../src";
import { deadlineDashContent } from "@office-ladder/content";
import { createCanonicalGameState, fixtureIds } from "./fixtures";

export const logicalTimestamp = "2026-07-18T12:00:00.000Z";

const branded = <Id extends string>(value: string) => value as Id;

type ApplyContext = {
  readonly logicalTimestamp: string;
  readonly random: RandomSource;
  readonly content: typeof deadlineDashContent;
};

export function startState(): GameState {
  const state = createCanonicalGameState();

  return {
    ...state,
    status: "setup",
    startAuthorizedPlayerId: fixtureIds.owner,
    turn: {
      ...state.turn,
      number: 0,
      round: 0,
      activePlayerId: null,
      phase: "not-started",
      startedAt: null,
      deadlineAt: null,
    },
    prompts: [], pendingEffects: [], reactionWindows: [], resolutionStack: [],
    lastCommandId: null,
  };
}

export function rollState(position: number): GameState {
  const state = createCanonicalGameState();

  return {
    ...state,
    boardSize: deadlineDashContent.board.spaces.length,
    tileIds: deadlineDashContent.board.spaces.map((tile) =>
      branded<GameState["tileIds"][number]>(tile.id),
    ),
    turn: {
      ...state.turn,
      number: 1,
      round: 1,
      activePlayerId: fixtureIds.owner,
      phase: "pre-roll",
      startedAt: logicalTimestamp,
      deadlineAt: null,
    },
    players: {
      ...state.players,
      [fixtureIds.owner]: {
        ...state.players[fixtureIds.owner],
        position,
        lapsCompleted: 0,
      },
    },
    prompts: [], pendingEffects: [], reactionWindows: [], resolutionStack: [],
    rng: {
      streams: {
        dice: {
          ...state.rng.streams.dice,
          cursor: 0,
        },
      },
    },
    lastCommandId: null,
  };
}

export function startCommand(state: GameState, commandId = "command-start"): StartGameCommand {
  return {
    commandId: branded<CommandId>(commandId),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    type: "game.start",
    payload: {},
  };
}

export function rollCommand(state: GameState, overrides: Partial<RollTurnCommand> = {}): RollTurnCommand {
  return {
    commandId: branded<CommandId>("command-roll"),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    type: "turn.roll",
    payload: {},
    ...overrides,
  };
}

export function context(randomValues: readonly number[], timestamp = logicalTimestamp): ApplyContext {
  return {
    logicalTimestamp: timestamp,
    random: createScriptedRandomSource(randomValues),
    content: deadlineDashContent,
  };
}

export function accepted(result: ReturnType<typeof applyCommand>): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
}

export function rejected(result: ReturnType<typeof applyCommand>, code: string): void {
  expect(result).toEqual(
    expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code }),
    }),
  );
}
