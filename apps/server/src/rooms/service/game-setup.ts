import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";
import type { SafeEventSummary } from "@office-ladder/contracts";
import {
  createSeededRandomSource,
  createStableId,
  randomInt,
  type GameEvent,
  type GameId,
  type GameSetup,
  type ModeRules,
  type PlayerId,
  type RandomSource,
  type SetupContent,
} from "@office-ladder/engine";
import { resolveCharacterAssignments } from "@/rooms/characters";
import type { StoredRoom } from "./types";

/**
 * The ruleset a room will actually be played under.
 *
 * Resolution order is "what the host authored, else what the mode preset says",
 * and it happens exactly once — at `game.start`, where the result is handed to
 * `createGame` and frozen into `GameState.rules` (spec §5.9). Nothing after that
 * re-resolves: every transition reads `state.rules`, so editing the content pack
 * mid-match, or between a match and its replay, cannot change how it plays.
 *
 * A room whose `modeId` names a mode this content release does not provide falls
 * through to `undefined`, which `validateSetup` reports as UNSUPPORTED_MODE. It
 * is deliberately not defaulted here: silently playing a different mode than the
 * lobby advertised is worse than refusing to start.
 */
export function resolveModeRules(room: StoredRoom): ModeRules | null {
  const authored = room.customRules;
  if (authored !== null && authored !== undefined) return authored;
  return deadlineDashModes[room.modeId]?.rules ?? null;
}

/**
 * The content release `createGame` should read this room's mode from.
 *
 * A room with no authored ruleset gets the pristine pack, so its content hash is
 * the same one every other match on that release records. A room with one gets a
 * shallow override of the single mode entry it plays — which changes the content
 * hash too, and that is correct: a match played under a lobby-authored ruleset
 * genuinely was not played under the shipped one, and its replay must be able to
 * tell.
 *
 * Only the mode's `rules` are replaced. Starting resources, token caps and the
 * board are content, not ruleset, and a lobby that could rewrite them would be
 * authoring a content pack rather than choosing a mode.
 */
export function setupContentFor(room: StoredRoom, rules: ModeRules): SetupContent {
  const mode = deadlineDashContent.modes[room.modeId];
  if (mode === undefined || mode.rules === rules) return deadlineDashContent;

  return {
    ...deadlineDashContent,
    modes: { ...deadlineDashContent.modes, [room.modeId]: { ...mode, rules } },
  };
}

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
 * Two separate defects are answered here, and they are worth keeping apart.
 *
 * **The leak.** The old rule was `(order + 1) % 3 === 0`, and `order` is
 * published to every client as `member.seat` — so every player could compute
 * every other player's hidden role by counting seats, and seats 2 and 5 were
 * *always* Management. That is not a leak around the edges of a hidden-role
 * game; it is the whole hidden-role game. A partial Fisher-Yates over the seat
 * indices, drawn from a source seeded with the game seed, fixes it without
 * giving up anything the engine requires: no `Math.random`, no clock, and the
 * same (seed, seat count) always produces the same assignment, so a replay
 * reconstructs the same roles. The `:roles` suffix keeps this stream disjoint
 * from the engine's own, which are seeded from the bare seed — drawing from the
 * sequence the dice use would correlate role assignment with the first rolls.
 *
 * The secret is therefore the *seed*, which is server-side only: `gameSeed()`
 * comes from `crypto.randomUUID()` in `rooms/default-service.ts` and appears in
 * no projection. Seat number tells an observer nothing.
 *
 * **The gate.** Roles are a mode mechanic like any other (spec §4: "a mechanic
 * that cannot be switched off from config is a bug"), so a mode with
 * `hidden.rolesEnabled` false assigns none at all. That is uniform rather than
 * random, which is the point: with the mechanic off there is nothing to hide,
 * and `legal-actions.ts` already refuses the role-reveal verb under the same
 * flag, so a match cannot end up with roles nobody can ever use.
 */
function managementSeats(
  playerCount: number,
  seed: string,
  rules: ModeRules,
): ReadonlySet<number> {
  if (!rules.hidden.rolesEnabled) return new Set();

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
 * @param seed the same seed passed to createGame, so role assignment is
 * deterministic in exactly the way the rest of the match is.
 * @param rules the resolved ruleset — see {@link resolveModeRules}. Passed in
 * rather than looked up here so that setup and `createGame` cannot disagree
 * about which ruleset this match is being built under.
 */
export function setupFor(
  room: StoredRoom,
  gameId: GameId,
  seed: string,
  rules: ModeRules,
): GameSetup {
  const characters = resolveCharacterAssignments(room.memberIds, room.memberCharacters);
  const management = managementSeats(room.memberIds.length, seed, rules);

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

/**
 * @param actorId whom to attribute events that name no player of their own.
 * Nullable because a server-injected command can land when no turn is running —
 * a reaction window drained after the match ended, say — and `SafeEventSummary`
 * already models "no actor". Inventing a seat for those would put a name on
 * something nobody did.
 */
export function eventSummaries(
  events: readonly GameEvent[],
  actorId: PlayerId | null,
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
