import { deadlineDashCharacters } from "../../../content/deadline-dash";
import {
  createStableId,
  type GameEvent,
  type GameId,
  type GameSetup,
  type PlayerId,
} from "../../../engine";
import type { StoredRoom } from "./types";

export function setupFor(room: StoredRoom, gameId: GameId): GameSetup {
  const characters = Object.values(deadlineDashCharacters);
  return {
    gameId,
    modeId: createStableId("ModeId", room.modeId),
    authorizedStarterId: room.hostId,
    players: room.memberIds.map((playerId, order) => {
      const character = characters[order];
      if (character === undefined) {
        throw new TypeError("Room member has no canonical character assignment");
      }
      const management = (order + 1) % 3 === 0;
      return {
        id: playerId,
        order,
        characterId: createStableId("CharacterId", character.id),
        role: {
          id: createStableId("RoleId", `${playerId}:role`),
          kind: management ? "role.management" : "role.worker",
        },
      };
    }),
  };
}

export function eventSummaries(events: readonly GameEvent[], actorId: PlayerId) {
  return events.map((event) => ({
    id: event.eventId,
    type: event.type,
    revision: event.revision,
    occurredAt: event.logicalTimestamp,
    actorPlayerId: actorId,
  }));
}
