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
import type { StoredRoom } from "./types";

export function roomProjection(room: StoredRoom): RoomProjection {
  return {
    id: room.id,
    code: room.code,
    status: room.status,
    mode: room.modeId,
    capacity: room.capacity,
    revision: room.revision,
    members: room.memberIds.map((memberId, seat) => ({
      id: memberId,
      displayName: memberId,
      seat,
      isHost: memberId === room.hostId,
      isReady: true,
      isConnected: true,
    })),
  };
}

export function createRoomBootstrap(
  room: StoredRoom,
  viewerId: PlayerId,
): RoomBootstrap {
  return {
    room: roomProjection(room),
    selfMemberId: viewerId,
  };
}

function publicProjection(room: StoredRoom): PublicGameProjection {
  const game = room.game;
  if (game === null) {
    throw new TypeError("Active room is missing its canonical game");
  }
  const view = projectPublicView(game);

  return {
    id: game.gameId,
    revision: view.revision,
    status: view.status === "quarantined" ? "paused" : view.status,
    activePlayerId: view.turn.activePlayerId,
    turnNumber: view.turn.number,
    round: view.turn.round,
    phase: view.turn.phase,
    deadlineAt: view.turn.deadlineAt,
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

  return {
    room: roomProjection(room),
    publicProjection: publicProjection(room),
    self: selfProjection(room, viewerId),
    prompts: playerView.prompts.map((prompt) => ({
      id: prompt.id,
      kind: prompt.kind,
      deadlineAt: prompt.deadlineAt,
      optionIds: prompt.legalResponses.map((option) => option.id),
    })),
    reactions: playerView.reactions,
    legalActions: enumerateLegalActions(game, viewerId).map((action) => ({
      type: action.type,
      expectedRevision: action.expectedRevision,
    })),
    serverTime,
  };
}
