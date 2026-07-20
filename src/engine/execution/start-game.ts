import type { StartGameCommand } from "../commands";
import type { GameStartedEvent, TurnStartedEvent } from "../events";
import type { GameState } from "../model";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import type { TransitionContext, TransitionResult } from "./types";

export function startGame(
  state: GameState,
  command: StartGameCommand,
  context: TransitionContext,
): TransitionResult {
  if (state.status !== "setup") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Only a setup game can be started",
    });
  }

  if (state.turn.phase !== "not-started") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "The game has already left the not-started phase",
    });
  }

  if (state.startAuthorizedPlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Only the authorized starter can start the game",
    });
  }

  if (state.playerOrder.length === 0) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "A game cannot start without a player order",
    });
  }

  const revision = state.revision + 1;
  const gameStarted: GameStartedEvent = {
    ...createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + 1,
    ),
    type: "GameStarted",
    payload: { playerOrder: [...state.playerOrder] },
  };
  const turnStarted: TurnStartedEvent = {
    ...createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + 2,
    ),
    type: "TurnStarted",
    payload: {
      playerId: command.actorId,
      turnNumber: 1,
      round: 1,
      phase: "pre-roll",
      deadlineAt: null,
    },
  };

  return {
    ok: true,
    value: {
      state: {
        ...state,
        playerOrder: [...state.playerOrder],
        status: "active",
        revision,
        eventSequence: turnStarted.sequence,
        turn: {
          number: 1,
          round: 1,
          activePlayerId: command.actorId,
          phase: "pre-roll",
          startedAt: context.logicalTimestamp,
          deadlineAt: null,
        },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: [gameStarted, turnStarted],
    },
  };
}
