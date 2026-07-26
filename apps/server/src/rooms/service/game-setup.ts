import type { SafeEventSummary } from "@office-ladder/contracts";
import {
  createSeededRandomSource,
  createStableId,
  randomInt,
  type GameEvent,
  type GameId,
  type GameSetup,
  type PlayerId,
  type RandomSource,
} from "@office-ladder/engine";
import { resolveCharacterAssignments } from "@/rooms/characters";
import type { StoredRoom } from "./types";

/**
 * How many seats hold the hidden Management role, as a function of the table
 * size. This is exactly what the previous `(order + 1) % 3 === 0` produced —
 * `floor(n / 3)` — kept deliberately so the balance does not change while the
 * *choice of which seats* does.
 */
function managementCount(playerCount: number): number {
  return Math.floor(playerCount / 3);
}

/**
 * Which seats are Management, drawn from the game seed.
 *
 * The old rule was `(order + 1) % 3 === 0`, and `order` is published to every
 * client as `member.seat` — so every player could compute every other player's
 * hidden role by counting seats, and seats 2 and 5 were *always* Management.
 * That is not a leak around the edges of a hidden-role game; it is the whole
 * hidden-role game.
 *
 * A partial Fisher-Yates over the seat indices, drawn from a source seeded with
 * the game seed, fixes it without giving up anything the engine requires: no
 * `Math.random`, no clock, and the same (seed, seat count) always produces the
 * same assignment, so a replay of a match reconstructs the same roles. The
 * `:roles` suffix keeps this stream disjoint from the engine's own streams, which
 * are seeded from the bare seed — drawing from the same sequence the dice use
 * would make role assignment and the first rolls correlated.
 */
function managementSeats(playerCount: number, seed: string): ReadonlySet<number> {
  const random: RandomSource = createSeededRandomSource(`${seed}:roles`);
  const seats = Array.from({ length: playerCount }, (_unused, index) => index);
  const wanted = managementCount(playerCount);

  for (let index = 0; index < wanted; index += 1) {
    const swapWith = randomInt(random, index, seats.length - 1);
    const held = seats[index];
    const drawn = seats[swapWith];
    if (held === undefined || drawn === undefined) continue;
    seats[index] = drawn;
    seats[swapWith] = held;
  }

  return new Set(seats.slice(0, wanted));
}

/**
 * Builds the engine setup for a room.
 *
 * @param seed the same seed passed to createDeadlineDashGame, so role assignment
 * is deterministic in exactly the way the rest of the match is.
 */
export function setupFor(room: StoredRoom, gameId: GameId, seed: string): GameSetup {
  const characters = resolveCharacterAssignments(room.memberIds, room.memberCharacters);
  const management = managementSeats(room.memberIds.length, seed);

  return {
    gameId,
    modeId: createStableId("ModeId", room.modeId),
    authorizedStarterId: room.hostId,
    players: room.memberIds.map((playerId, order) => {
      const character = characters.get(playerId);
      if (character === undefined || character === null) {
        // Unreachable with the shipped content pack: six characters against a
        // capacity of at most six, and a claim is validated against the pack
        // before it is ever stored, so a claim cannot consume a slot that does
        // not exist. It stays a throw because reaching it means the seat count
        // and the character count have diverged, and starting a match with two
        // players sharing a character would be rejected by the engine anyway.
        throw new TypeError("Room member has no available character assignment");
      }
      return {
        id: playerId,
        order,
        characterId: createStableId("CharacterId", character),
        role: {
          id: createStableId("RoleId", `${playerId}:role`),
          kind: management.has(order) ? "role.management" : "role.worker",
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
      // rngStream/rngCursor stay server-side: they are RNG bookkeeping, not
      // player-visible outcomes.
      case "DiceRolled":
        return {
          ...metadata,
          type: event.type,
          actorPlayerId: event.payload.playerId,
          dice: event.payload.dice,
          total: event.payload.total,
          purpose: event.payload.purpose,
        };
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
