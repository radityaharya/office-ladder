import { deadlineDashContent } from "@office-ladder/content";
import { parseRoomCode } from "@office-ladder/contracts";
import {
  applyCommand,
  createDeadlineDashGame,
  createStableId,
} from "@office-ladder/engine";
import { eventSummaries, setupFor } from "./game-setup";
import { createBootstrap, createRoomBootstrap } from "./projections";
import type {
  ActiveStoredRoom,
  JoinRoomInput,
  RoomService,
  RoomServiceDependencies,
  RoomServiceErrorCode,
  RoomServiceResult,
  StoredRoom,
} from "./types";

const MINIMUM_PLAYERS = 3;
const DEFAULT_CAPACITY = 6;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function fail<Value>(code: RoomServiceErrorCode): RoomServiceResult<Value> {
  return { ok: false, error: { code } };
}

function derivedRoomCode(roomId: string): string {
  let hash = 2166136261;
  for (const character of roomId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return Array.from({ length: 6 }, (_, index) => {
    const position = (hash >>> (index * 5)) % ROOM_CODE_ALPHABET.length;
    return ROOM_CODE_ALPHABET[position] ?? "A";
  }).join("");
}

export function createRoomService(dependencies: RoomServiceDependencies): RoomService {
  const { repository, now, ids, gameSeed } = dependencies;

  async function joinByRoomId(
    roomId: string,
    actorId: string,
  ): Promise<RoomServiceResult<StoredRoom>> {
    const room = await repository.get(roomId);
    if (room === null) return fail("ROOM_NOT_FOUND");
    if (room.status !== "open") return fail("ROOM_NOT_OPEN");
    const playerId = createStableId("PlayerId", actorId);
    if (room.memberIds.includes(playerId)) return fail("ACTOR_ALREADY_MEMBER");
    if (room.memberIds.length >= room.capacity) return fail("ROOM_FULL");

    const updated = {
      ...room,
      memberIds: [...room.memberIds, playerId],
      revision: room.revision + 1,
    } satisfies StoredRoom;
    await repository.save(updated);
    return { ok: true, value: updated };
  }

  return {
    async create(input) {
      const id = ids.roomId();
      const code = parseRoomCode(ids.roomCode?.() ?? derivedRoomCode(id));
      const modeId = input.modeId ?? input.mode;
      if (modeId === undefined) return fail("UNSUPPORTED_MODE");
      const room: StoredRoom = {
        id,
        code,
        hostId: createStableId("PlayerId", input.hostId),
        memberIds: [createStableId("PlayerId", input.hostId)],
        modeId,
        capacity: input.capacity ?? DEFAULT_CAPACITY,
        status: "open",
        revision: 0,
        createdAt: now(),
        game: null,
        eventSummaries: [],
      };
      await repository.create(room);
      return { ok: true, value: room };
    },
    async join(input: JoinRoomInput) {
      return joinByRoomId(input.roomId, input.actorId);
    },
    async joinByCode(input) {
      const room = await repository.getByCode?.(parseRoomCode(input.roomCode));
      if (room === null || room === undefined) return fail("ROOM_CODE_NOT_FOUND");
      return joinByRoomId(room.id, input.actorId);
    },
    async bootstrap(input) {
      const room = await repository.get(input.roomId);
      if (room === null) return fail("ROOM_NOT_FOUND");
      const viewerId = createStableId("PlayerId", input.viewerId);
      if (!room.memberIds.includes(viewerId)) return fail("ACTOR_NOT_MEMBER");
      return {
        ok: true,
        value:
          room.game === null
            ? createRoomBootstrap(room, viewerId)
            : createBootstrap(room, viewerId, now()),
      };
    },
    async start(input) {
      const room = await repository.get(input.roomId);
      if (room === null) return fail("ROOM_NOT_FOUND");
      const actorId = createStableId("PlayerId", input.actorId);
      if (room.hostId !== actorId) return fail("ACTOR_NOT_HOST");
      if (room.status !== "open") return fail("ROOM_NOT_OPEN");
      if (input.expectedRevision !== undefined && input.expectedRevision !== room.revision) {
        return fail("STALE_REVISION");
      }
      if (room.memberIds.length < MINIMUM_PLAYERS) return fail("MINIMUM_PLAYERS_NOT_MET");

      const created = createDeadlineDashGame(setupFor(room, ids.gameId()), gameSeed());
      if (!created.ok) return fail(created.error.code);
      const commandId = createStableId(
        "CommandId",
        input.commandId ?? `${ids.commandId()}:start`,
      );
      const started = applyCommand(
        created.value,
        {
          commandId,
          gameId: created.value.gameId,
          actorId,
          expectedRevision: 0,
          type: "game.start",
          payload: {},
        },
        { logicalTimestamp: now(), content: deadlineDashContent },
      );
      if (!started.ok) return fail(started.error.code);

      const updated = {
        ...room,
        status: "active",
        revision: room.revision + 1,
        game: started.value.state,
        eventSummaries: eventSummaries(started.value.events, actorId),
      } satisfies ActiveStoredRoom;
      await repository.save(updated);
      return { ok: true, value: updated };
    },
    async roll(input) {
      const room = await repository.get(input.roomId);
      if (room === null) return fail("ROOM_NOT_FOUND");
      const actorId = createStableId("PlayerId", input.actorId);
      if (!room.memberIds.includes(actorId)) return fail("ACTOR_NOT_MEMBER");
      if (room.game === null || room.status !== "active") return fail("GAME_NOT_ACTIVE");

      const rolled = applyCommand(
        room.game,
        {
          commandId: createStableId("CommandId", input.commandId ?? ids.commandId()),
          gameId: room.game.gameId,
          actorId,
          expectedRevision: input.expectedRevision,
          type: "turn.roll",
          payload: {},
        },
        { logicalTimestamp: now(), content: deadlineDashContent },
      );
      if (!rolled.ok) return fail(rolled.error.code);

      const updated = {
        ...room,
        status: "active",
        revision: room.revision + 1,
        game: rolled.value.state,
        eventSummaries: [
          ...room.eventSummaries,
          ...eventSummaries(rolled.value.events, actorId),
        ],
      } satisfies ActiveStoredRoom;
      await repository.save(updated);
      return { ok: true, value: updated };
    },
    async respondToPrompt(input) {
      const room = await repository.get(input.roomId);
      if (room === null) return fail("ROOM_NOT_FOUND");
      const actorId = createStableId("PlayerId", input.actorId);
      if (!room.memberIds.includes(actorId)) return fail("ACTOR_NOT_MEMBER");
      if (room.game === null || room.status !== "active") return fail("GAME_NOT_ACTIVE");

      const responded = applyCommand(
        room.game,
        {
          commandId: createStableId("CommandId", input.commandId ?? ids.commandId()),
          gameId: room.game.gameId,
          actorId,
          expectedRevision: input.expectedRevision,
          decisionPointId: createStableId("DecisionPointId", input.decisionPointId),
          type: "prompt.respond",
          payload: {
            optionId: createStableId("PromptOptionId", input.optionId),
            value: null,
          },
        },
        { logicalTimestamp: now(), content: deadlineDashContent },
      );
      if (!responded.ok) return fail(responded.error.code);

      const updated = {
        ...room,
        status: "active",
        revision: room.revision + 1,
        game: responded.value.state,
        eventSummaries: [
          ...room.eventSummaries,
          ...eventSummaries(responded.value.events, actorId),
        ],
      } satisfies ActiveStoredRoom;
      await repository.save(updated);
      return { ok: true, value: updated };
    },
  };
}
