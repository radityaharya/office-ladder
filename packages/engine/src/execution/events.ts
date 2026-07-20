import type { GameCommand } from "../commands";
import type { EventVisibility } from "../events";
import type { EventId, FrameId, GameState, LogicalTimestamp } from "../model";

export type EventMetadata = {
  readonly eventId: EventId;
  readonly gameId: GameState["gameId"];
  readonly sequence: number;
  readonly revision: number;
  readonly causationCommandId: GameCommand["commandId"];
  readonly correlationFrameId: FrameId | null;
  readonly logicalTimestamp: LogicalTimestamp;
  readonly schemaVersion: number;
  readonly visibility: EventVisibility;
};

export function createEventMetadata(
  state: GameState,
  command: GameCommand,
  logicalTimestamp: LogicalTimestamp,
  sequence: number,
): EventMetadata {
  return {
    eventId: `${command.commandId}:event:${sequence}` as EventId,
    gameId: state.gameId,
    sequence,
    revision: state.revision + 1,
    causationCommandId: command.commandId,
    correlationFrameId: null,
    logicalTimestamp,
    schemaVersion: state.versions.replaySchemaVersion,
    visibility: { kind: "public" },
  };
}
