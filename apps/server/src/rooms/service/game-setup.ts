import { deadlineDashCharacters } from "@office-ladder/content";
import type { SafeEventSummary } from "@office-ladder/contracts";
import {
  createStableId,
  type GameEvent,
  type GameId,
  type GameSetup,
  type PlayerId,
} from "@office-ladder/engine";
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

export function eventSummaries(
  events: readonly GameEvent[],
  actorId: PlayerId,
): readonly SafeEventSummary[] {
  return events.map((event) => {
    const metadata = {
      id: event.eventId,
      revision: event.revision,
      occurredAt: event.logicalTimestamp,
    };

    switch (event.type) {
      case "CardDrawn":
        return {
          ...metadata,
          type: event.type,
          actorPlayerId: event.payload.playerId,
          card: {
            definitionId: event.payload.cardId,
            deckId: event.payload.deckId,
            nameKey: event.payload.nameKey,
          },
        };
      default:
        return {
          ...metadata,
          type: event.type,
          actorPlayerId: actorId,
        };
    }
  });
}
