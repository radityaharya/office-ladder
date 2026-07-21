import type { GameCommand } from "../commands";
import type { GameState } from "../model";
import { rejectCommand } from "./errors";
import { respondToPrompt } from "./respond-to-prompt";
import { rollTurn } from "./roll-turn";
import { startGame } from "./start-game";
import type { TransitionContext, TransitionResult } from "./types";

function assertNever(value: never): never {
  throw new TypeError(`Unexpected command: ${String(value)}`);
}

export function applyCommand(
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
): TransitionResult {
  if (command.gameId !== state.gameId) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Command targets a different game",
    });
  }
  if (command.commandId === state.lastCommandId) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Command was already applied",
    });
  }
  if (command.expectedRevision !== state.revision) {
    return rejectCommand(state, command, {
      code: "STALE_REVISION",
      message: "Command revision does not match the current state",
      details: {
        expectedRevision: command.expectedRevision,
        currentRevision: state.revision,
      },
    });
  }
  if (
    command.type !== "game.start" &&
    command.type !== "turn.roll" &&
    command.type !== "prompt.respond"
  ) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Command type is not supported by this execution slice",
    });
  }
  if (state.players[command.actorId] === undefined) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_FOUND",
      message: "Command actor is not a player in this game",
    });
  }
  if (
    command.type === "game.start" &&
    state.startAuthorizedPlayerId !== command.actorId
  ) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Only the authorized starter can start the game",
    });
  }
  if (
    (command.type === "turn.roll" || command.type === "prompt.respond") &&
    state.turn.activePlayerId !== command.actorId
  ) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can act",
    });
  }
  if (state.status === "ended") {
    return rejectCommand(state, command, {
      code: "GAME_ALREADY_ENDED",
      message: "The game has already ended",
    });
  }
  if (state.status !== "setup" && state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "The game cannot currently accept commands",
    });
  }
  if (command.type === "game.start" && state.status !== "setup") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Only a setup game can be started",
    });
  }
  if (
    command.type === "game.start" &&
    state.turn.phase !== "not-started"
  ) {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "The game has already left the not-started phase",
    });
  }
  if (command.type === "turn.roll" && state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Dice can only be rolled in an active game",
    });
  }
  if (command.type === "turn.roll" && state.turn.phase !== "pre-roll") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "Dice can only be rolled during pre-roll",
    });
  }
  if (
    command.type !== "prompt.respond" &&
    (state.resolutionStack.length > 0 ||
      state.pendingEffects.length > 0 ||
      state.reactionWindows.length > 0 ||
      state.prompts.some((prompt) => prompt.audience.includes(command.actorId)))
  ) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Pending engine work blocks this command",
    });
  }
  switch (command.type) {
    case "game.start":
      return startGame(state, command, context);
    case "turn.roll":
      return rollTurn(state, command, context);
    case "prompt.respond":
      return respondToPrompt(state, command, context);
    default:
      return assertNever(command);
  }
}
