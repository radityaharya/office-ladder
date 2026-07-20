import type { GameCommand } from "../commands";
import type {
  EngineError,
  EngineErrorCode,
  GameState,
  JsonObject,
} from "../model";
import type { TransitionResult } from "./types";

type Rejection = {
  readonly code: EngineErrorCode;
  readonly message: string;
  readonly details?: JsonObject;
};

export function rejectCommand(
  state: GameState,
  command: GameCommand,
  rejection: Rejection,
): TransitionResult {
  const error: EngineError = {
    name: "EngineError",
    code: rejection.code,
    message: rejection.message,
    recoverable: true,
    gameId: state.gameId,
    commandId: command.commandId,
    actorId: command.actorId,
    decisionPointId: "decisionPointId" in command ? command.decisionPointId : null,
    frameId: null,
    details: rejection.details ?? {},
  };

  return { ok: false, error };
}
