import type {
  CallerSelfProjection,
  GameBootstrap,
  PublicGameProjection,
  RoomProjection,
  RoomBootstrap,
} from "@office-ladder/contracts";
import {
  enumerateLegalActions,
  projectPlayerView,
  projectPublicView,
  type PlayerId,
} from "@office-ladder/engine";
import { botSeatFor } from "@/rooms/bots/bot-seats";
import {
  characterLabel,
  characterOptions,
  claimedCharacters,
} from "@/rooms/characters";
import { isTurnTimerCurrent } from "@/rooms/turn-timer/turn-timer";
import type { StoredRoom } from "./types";

/**
 * Which character each member should be shown as playing.
 *
 * Before the match starts this is what they actually *claimed* — never the
 * fallback the setup would eventually give them, because a picker pre-filled with
 * an assignment nobody chose is indistinguishable from the choice being ignored.
 * Once a game exists, the canonical state is the only truthful answer: it is what
 * the engine assigned, fallbacks included, and it cannot be changed any more.
 */
function memberCharacterIds(room: StoredRoom): ReadonlyMap<PlayerId, string> {
  const game = room.game;
  if (game === null) return claimedCharacters(room.memberIds, room.memberCharacters);
  const assigned = new Map<PlayerId, string>();
  for (const memberId of room.memberIds) {
    const characterId = game.players[memberId]?.characterId;
    if (characterId !== undefined) assigned.set(memberId, characterId);
  }
  return assigned;
}

export function roomProjection(room: StoredRoom): RoomProjection {
  const characters = memberCharacterIds(room);

  return {
    id: room.id,
    code: room.code,
    status: room.status,
    mode: room.modeId,
    capacity: room.capacity,
    revision: room.revision,
    // Bots are ordinary members: they occupy a real seat in memberIds. The
    // StoredRoom.bots array is the only authority on which of them are bots —
    // never the id shape.
    members: room.memberIds.map((memberId, seat) => {
      const botSeat = botSeatFor(room, memberId);
      const characterId = characters.get(memberId) ?? null;
      return {
        id: memberId,
        displayName: room.memberNames[memberId] ?? memberId,
        seat,
        isHost: memberId === room.hostId,
        isReady: true,
        isConnected: true,
        isBot: botSeat !== null,
        botDifficulty: botSeat?.difficulty ?? null,
        // A bot seat has no user row, so it has no avatar to show; the map is
        // keyed by member id and simply never contains one.
        avatarUrl: room.memberAvatars[memberId] ?? null,
        characterId,
        characterLabel: characterId === null ? null : characterLabel(characterId),
      };
    }),
  };
}

export function createRoomBootstrap(
  room: StoredRoom,
  viewerId: PlayerId,
): RoomBootstrap {
  return {
    room: roomProjection(room),
    selfMemberId: viewerId,
    characterOptions: characterOptions(room.memberIds, room.memberCharacters),
  };
}

/**
 * The turn clock, if the stored one still belongs to this room's current turn.
 *
 * A timer is only reported while its (game revision, player) pair still matches,
 * so a snapshot that somehow kept a timer for a turn already taken shows no
 * countdown rather than a wrong one — and the driver re-arms it on its next pass.
 */
function turnTimerProjection(room: StoredRoom): {
  readonly deadlineAt: string | null;
  readonly turnTimerDurationMs: number | null;
} {
  const timer = room.turnTimer;
  if (!isTurnTimerCurrent(room, timer) || timer === null) {
    return { deadlineAt: null, turnTimerDurationMs: null };
  }
  return { deadlineAt: timer.deadlineAt, turnTimerDurationMs: timer.durationMs };
}

function publicProjection(room: StoredRoom): PublicGameProjection {
  const game = room.game;
  if (game === null) {
    throw new TypeError("Active room is missing its canonical game");
  }
  const view = projectPublicView(game);
  const timer = turnTimerProjection(room);

  return {
    id: game.gameId,
    revision: view.revision,
    status: view.status === "quarantined" ? "paused" : view.status,
    activePlayerId: view.turn.activePlayerId,
    turnNumber: view.turn.number,
    round: view.turn.round,
    phase: view.turn.phase,
    // The engine models turn.deadlineAt but never populates it, so this field
    // would be permanently null if it were read from the projection. Filling the
    // *existing* field from the server-side clock, rather than adding a second
    // one beside it, keeps a single source of truth for "when does this turn
    // expire" — two fields where one is always null is an invitation to read the
    // wrong one. If the engine ever starts maintaining its own deadline, this is
    // the one line that has to reconcile them.
    deadlineAt: timer.deadlineAt,
    turnTimerDurationMs: timer.turnTimerDurationMs,
    players: view.players.map((player) => ({
      id: player.id,
      seat: player.order,
      connected: player.connected,
      position: player.position,
      lapsCompleted: player.lapsCompleted,
      rank: player.rank,
      role: player.role,
      resources: Object.fromEntries(
        Object.entries(player.resources).map(([key, resource]) => [key, resource.value]),
      ),
      tokens: Object.fromEntries(
        Object.entries(player.tokens).map(([key, token]) => [key, token.count]),
      ),
      statusIds: player.statuses.map((status) => status.id),
    })),
    eventSummaries: room.eventSummaries,
    winnerPlayerIds: view.outcome?.winnerPlayerIds ?? [],
  };
}

function selfProjection(room: StoredRoom, viewerId: PlayerId): CallerSelfProjection {
  const game = room.game;
  if (game === null) {
    throw new TypeError("Active room is missing its canonical game");
  }
  const view = projectPlayerView(game, viewerId);

  return {
    playerId: viewerId,
    role: view.self.role,
    characterId: view.self.characterId,
    hand: view.self.hand.map((card) => ({ id: card.id, definitionId: card.definitionId })),
    privateStatusIds: view.self.privateStatuses.map((status) => status.id),
    abilityIds: view.self.abilities.map((ability) => ability.id),
  };
}

export function createBootstrap(
  room: StoredRoom,
  viewerId: PlayerId,
  serverTime: string,
): GameBootstrap {
  const game = room.game;
  if (game === null) {
    throw new TypeError("Active room is missing its canonical game");
  }
  const playerView = projectPlayerView(game, viewerId);
  const timer = turnTimerProjection(room);
  // projectPlayerView already returns only prompts addressed to this viewer, so
  // "the clock is waiting on one of these prompts" reduces to "the clock is this
  // viewer's". A player can hold an open audit prompt while somebody else is
  // active, and that prompt is correctly reported with no deadline: nothing will
  // auto-resolve it until the turn comes back to them.
  const viewerIsOnTheClock = timer.deadlineAt !== null && room.turnTimer?.playerId === viewerId;

  return {
    room: roomProjection(room),
    publicProjection: publicProjection(room),
    self: selfProjection(room, viewerId),
    prompts: playerView.prompts.map((prompt) => ({
      id: prompt.id,
      kind: prompt.kind,
      // The engine leaves every prompt deadline null too. A prompt held by the
      // player whose clock is running *is* what that clock is waiting on —
      // responding is their only legal action — so it carries the same instant.
      deadlineAt: viewerIsOnTheClock ? timer.deadlineAt : prompt.deadlineAt,
      optionIds: prompt.legalResponses.map((option) => option.id),
    })),
    reactions: playerView.reactions,
    legalActions: enumerateLegalActions(game, viewerId).map((action) =>
      action.type === "prompt.respond"
        ? {
            type: action.type,
            expectedRevision: action.expectedRevision,
            decisionPointId: action.decisionPointId,
            kind: action.kind,
            options: action.options,
          }
        : {
            type: action.type,
            expectedRevision: action.expectedRevision,
          },
    ),
    serverTime,
  };
}
