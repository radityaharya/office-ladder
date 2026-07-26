import { deadlineDashContent } from "@office-ladder/content";
import { parseRoomCode } from "@office-ladder/contracts";
import {
  applyCommand,
  createDeadlineDashGame,
  createStableId,
  type PlayerId,
} from "@office-ladder/engine";
import {
  botDisplayName,
  botPlayerId,
  botSeats,
  humanMemberIds,
  isBotMember,
  nextBotSlot,
  normalizeStoredRoom,
} from "@/rooms/bots/bot-seats";
import { claimedCharacters, isKnownCharacterId } from "@/rooms/characters";
import { appendEventSummaries } from "@/rooms/room-snapshot";
import { nextTurnTimer } from "@/rooms/turn-timer/turn-timer";
import { eventSummaries, setupFor } from "./game-setup";
import { createBootstrap, createRoomBootstrap } from "./projections";
import type {
  ActiveStoredRoom,
  JoinRoomInput,
  RoomActorKind,
  RoomService,
  RoomServiceDependencies,
  RoomServiceError,
  RoomServiceErrorCode,
  RoomServiceResult,
  StoredRoom,
} from "./types";

const MINIMUM_PLAYERS = 3;
const DEFAULT_CAPACITY = 6;

/**
 * Room codes are 6 characters from a 32-symbol alphabet (30 bits) and are never
 * reclaimed, so collisions are a matter of when, not if — and rooms.code is
 * UNIQUE, so an unhandled one used to surface as an opaque database error at
 * insert time. Five draws is plenty: it only ever reaches the last one if the
 * generator is broken, which is worth reporting as its own error rather than
 * looping.
 */
const ROOM_CODE_ATTEMPTS = 5;

function fail<Value>(code: RoomServiceErrorCode): RoomServiceResult<Value> {
  return { ok: false, error: { code } };
}

/**
 * A bot seat is never a session identity — bots exist only inside this server's
 * own driver — so the two authorities must never be crossed. Nothing today lets
 * a human present a bot's playerId (every route derives the actor from the
 * session), and this is what keeps that true as new callers appear, in both
 * directions: the driver may not act for a human member either.
 */
function actorKindMismatch(
  room: StoredRoom,
  actorId: PlayerId,
  actorKind: RoomActorKind,
): RoomServiceError | null {
  const seatIsBot = isBotMember(room, actorId);
  if (actorKind === "human" && seatIsBot) return { code: "ACTOR_IS_BOT" };
  if (actorKind === "bot" && !seatIsBot) return { code: "ACTOR_NOT_BOT" };
  return null;
}

/**
 * Records a member's character preference.
 *
 * Two failure modes, deliberately answered differently:
 *
 * - **Unknown character.** No well-behaved client can produce it (the picker is
 *   populated from this same content pack), so it is a bug, and refusing it is
 *   the only way the bug is ever seen. Quietly assigning something else is the
 *   exact behaviour this whole change exists to remove.
 * - **Already claimed.** A race between two players picking at once, which is
 *   ordinary. On create/join the claim is simply dropped (`taken` is `"drop"`) so
 *   a cosmetic preference can never cost somebody their seat; the lobby then shows
 *   their seat with no character and every taken option marked, which is visible
 *   rather than silent. When they re-pick in the lobby the picker is on screen, so
 *   the refusal is actionable and `"refuse"` is used instead.
 */
/**
 * Stores a member's avatar, or leaves the map without an entry for them.
 *
 * The value is already validated by contracts' parseAvatarUrl at the route
 * boundary, and re-validated on the way out of storage; an absent entry is the
 * normal case, since nothing in this app can set `user.image` yet.
 */
function withMemberAvatar(
  avatars: Readonly<Partial<Record<PlayerId, string>>>,
  playerId: PlayerId,
  avatarUrl: string | null | undefined,
): Readonly<Partial<Record<PlayerId, string>>> {
  if (avatarUrl === null || avatarUrl === undefined) return avatars;
  return { ...avatars, [playerId]: avatarUrl };
}

function withCharacterClaim(
  room: StoredRoom,
  playerId: PlayerId,
  characterId: string | null,
  taken: "drop" | "refuse",
): RoomServiceResult<Readonly<Partial<Record<PlayerId, string>>>> {
  const claims = { ...room.memberCharacters };
  delete claims[playerId];
  if (characterId === null) return { ok: true, value: claims };
  if (!isKnownCharacterId(characterId)) return fail("CHARACTER_NOT_FOUND");

  const heldByOthers = claimedCharacters(
    room.memberIds.filter((memberId) => memberId !== playerId),
    claims,
  );
  for (const held of heldByOthers.values()) {
    if (held !== characterId) continue;
    return taken === "refuse" ? fail("CHARACTER_TAKEN") : { ok: true, value: claims };
  }

  return { ok: true, value: { ...claims, [playerId]: characterId } };
}

export function createRoomService(dependencies: RoomServiceDependencies): RoomService {
  const { repository, now, ids, gameSeed, turnTimeoutMs } = dependencies;

  /**
   * Per-room serialization of every read-modify-write on the room snapshot.
   *
   * The repository stores the whole StoredRoom as a single value, so two
   * overlapping mutations that both read revision N both try to write revision
   * N+1. That is not hypothetical: a POST /:roomId/bots overlapping a POST
   * /:roomId/start reads the pre-start snapshot and writes it back, discarding
   * the game that start() just created and returning the room to the lobby —
   * after start() has already answered 200 and the host's client has navigated
   * to the game view. The same shape applies to join-vs-start and to a
   * double-submitted roll.
   *
   * This queue makes the *common* case (one instance, overlapping requests) not
   * even reach the conflict: the second operation re-reads after the first
   * commits and re-runs its own guards, so it fails on the real reason
   * (ROOM_NOT_OPEN, ACTOR_ALREADY_MEMBER, STALE_REVISION from the engine) rather
   * than on a write conflict. It is not a substitute for the repository's
   * revision predicate, which is what actually prevents a lost update once a
   * second server instance exists — see RoomRepository.save. Read-only
   * bootstrap() deliberately does not take the lock.
   */
  const roomLocks = new Map<string, Promise<void>>();

  async function withRoomLock<Value>(
    roomId: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const previous = roomLocks.get(roomId);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Registered before the first await, so callers queue in call order.
    roomLocks.set(roomId, held);
    if (previous !== undefined) await previous;
    try {
      return await operation();
    } finally {
      release();
      if (roomLocks.get(roomId) === held) roomLocks.delete(roomId);
    }
  }

  /**
   * Single read boundary for the service. The repository already rebuilds every
   * field of a persisted snapshot (rooms/room-snapshot.ts), so this is defence
   * in depth for repositories a test might hand in: it only re-applies the
   * cheap, idempotent `bots === undefined` normalization.
   */
  async function loadRoom(roomId: string): Promise<StoredRoom | null> {
    const room = await repository.get(roomId);
    return room === null ? null : normalizeStoredRoom(room);
  }

  /**
   * A pre-check, not a reservation: two server instances can still draw the same
   * unused code at the same instant and the loser will fail its INSERT on the
   * unique index. That residual race is why the column stays UNIQUE — this loop
   * exists so the ordinary collision is a clear, retryable service error instead
   * of a raw driver exception.
   */
  async function allocateRoomCode(): Promise<RoomServiceResult<string>> {
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt += 1) {
      const code = parseRoomCode(ids.roomCode());
      if ((await repository.getByCode(code)) === null) {
        return { ok: true, value: code };
      }
    }

    return fail("ROOM_CODE_UNAVAILABLE");
  }

  /**
   * Persists one mutation, conditional on the revision it was derived from.
   *
   * Every mutation here is a read-modify-write, so the revision the operation
   * read is exactly the predicate its write must carry. A rejected write is
   * surfaced, never swallowed: losing the race answers STALE_REVISION, which is
   * honest and retryable (the client already re-bootstraps on 409), whereas
   * reporting success would hand the caller a room state that was never stored.
   */
  async function commit<Value extends StoredRoom>(
    updated: Value,
    fromRevision: number,
  ): Promise<RoomServiceResult<Value>> {
    const saved = await repository.save(updated, fromRevision);
    return saved.ok ? { ok: true, value: updated } : fail(saved.error.code);
  }

  /**
   * Re-derives the turn clock from the state a game command just produced.
   *
   * Applied on every committed game mutation and nowhere else, which is what makes
   * the deadline a property of the turn rather than of whoever last read the room:
   * the same write that advances the turn arms the next player's clock, in the same
   * revision, so no extra write and no extra client invalidation is involved. It
   * also clears the clock for free at the end of a match and on a bot's turn, both
   * of which nextTurnTimer() answers `null` for.
   */
  function withTurnTimer<Value extends StoredRoom>(updated: Value): Value {
    return {
      ...updated,
      turnTimer: nextTurnTimer({ room: updated, nowIso: now(), timeoutMs: turnTimeoutMs }),
    };
  }

  async function joinByRoomId(
    roomId: string,
    input: { readonly actorId: string; readonly playerName: string } & Pick<
      JoinRoomInput,
      "avatarUrl" | "characterId"
    >,
  ): Promise<RoomServiceResult<StoredRoom>> {
    return withRoomLock(roomId, async () => {
      const room = await loadRoom(roomId);
      if (room === null) return fail("ROOM_NOT_FOUND");
      if (room.status !== "open") return fail("ROOM_NOT_OPEN");
      const playerId = createStableId("PlayerId", input.actorId);
      if (room.memberIds.includes(playerId)) return fail("ACTOR_ALREADY_MEMBER");
      if (room.memberIds.length >= room.capacity) return fail("ROOM_FULL");

      const claims = withCharacterClaim(room, playerId, input.characterId ?? null, "drop");
      if (!claims.ok) return claims;

      const updated = {
        ...room,
        memberIds: [...room.memberIds, playerId],
        memberNames: { ...room.memberNames, [playerId]: input.playerName },
        memberAvatars: withMemberAvatar(room.memberAvatars, playerId, input.avatarUrl),
        memberCharacters: claims.value,
        revision: room.revision + 1,
      } satisfies StoredRoom;
      return commit(updated, room.revision);
    });
  }

  return {
    async create(input) {
      const modeId = input.modeId ?? input.mode;
      if (modeId === undefined) return fail("UNSUPPORTED_MODE");
      const code = await allocateRoomCode();
      if (!code.ok) return code;
      const id = ids.roomId();
      const hostId = createStableId("PlayerId", input.hostId);
      const characterId = input.characterId ?? null;
      // The room is empty, so nothing can be taken yet — but the id is still
      // checked against the content pack, so a bad one is reported here rather
      // than surviving to fail the match at start time.
      if (characterId !== null && !isKnownCharacterId(characterId)) {
        return fail("CHARACTER_NOT_FOUND");
      }
      const room: StoredRoom = {
        id,
        code: code.value,
        hostId,
        memberIds: [hostId],
        memberNames: { [hostId]: input.playerName },
        memberAvatars: withMemberAvatar({}, hostId, input.avatarUrl),
        memberCharacters: characterId === null ? {} : { [hostId]: characterId },
        modeId,
        capacity: input.capacity ?? DEFAULT_CAPACITY,
        status: "open",
        revision: 0,
        createdAt: now(),
        game: null,
        eventSummaries: [],
        bots: [],
        turnTimer: null,
      };
      const created = await repository.create(room);
      if (!created.ok) return fail(created.error.code);
      return { ok: true, value: room };
    },
    async join(input: JoinRoomInput) {
      return joinByRoomId(input.roomId, input);
    },
    async joinByCode(input) {
      const room = await repository.getByCode(parseRoomCode(input.roomCode));
      if (room === null) return fail("ROOM_CODE_NOT_FOUND");
      return joinByRoomId(room.id, input);
    },
    async selectCharacter(input) {
      return withRoomLock(input.roomId, async () => {
        const room = await loadRoom(input.roomId);
        if (room === null) return fail("ROOM_NOT_FOUND");
        const actorId = createStableId("PlayerId", input.actorId);
        if (!room.memberIds.includes(actorId)) return fail("ACTOR_NOT_MEMBER");
        // A claim only ever comes from a session, so a bot seat can never make one.
        if (isBotMember(room, actorId)) return fail("ACTOR_IS_BOT");
        // Once the match has started the assignment lives in canonical game
        // state, where this service has no business rewriting it.
        if (room.status !== "open") return fail("ROOM_NOT_OPEN");

        const claims = withCharacterClaim(room, actorId, input.characterId, "refuse");
        if (!claims.ok) return claims;

        const updated = {
          ...room,
          memberCharacters: claims.value,
          revision: room.revision + 1,
        } satisfies StoredRoom;
        return commit(updated, room.revision);
      });
    },
    async addBot(input) {
      return withRoomLock(input.roomId, async () => {
        const room = await loadRoom(input.roomId);
        if (room === null) return fail("ROOM_NOT_FOUND");
        const actorId = createStableId("PlayerId", input.actorId);
        if (room.hostId !== actorId) return fail("ACTOR_NOT_HOST");
        if (room.status !== "open") return fail("ROOM_NOT_OPEN");
        if (room.memberIds.length >= room.capacity) return fail("ROOM_FULL");
        // Defence in depth: the host is always a human member and cannot be
        // removed, so this cannot currently trip — but a room whose humans have
        // all gone must never be padded out with more bots.
        if (humanMemberIds(room).length === 0) return fail("LAST_HUMAN_REQUIRED");

        const slot = nextBotSlot(room);
        const playerId = botPlayerId(room.id, slot);
        if (room.memberIds.includes(playerId)) return fail("ACTOR_ALREADY_MEMBER");

        const updated = {
          ...room,
          memberIds: [...room.memberIds, playerId],
          memberNames: { ...room.memberNames, [playerId]: botDisplayName(room, slot) },
          bots: [...botSeats(room), { playerId, difficulty: input.difficulty }],
          revision: room.revision + 1,
        } satisfies StoredRoom;
        return commit(updated, room.revision);
      });
    },
    async removeBot(input) {
      return withRoomLock(input.roomId, async () => {
        const room = await loadRoom(input.roomId);
        if (room === null) return fail("ROOM_NOT_FOUND");
        const actorId = createStableId("PlayerId", input.actorId);
        if (room.hostId !== actorId) return fail("ACTOR_NOT_HOST");
        if (room.status !== "open") return fail("ROOM_NOT_OPEN");

        const memberId = createStableId("PlayerId", input.memberId);
        const seats = botSeats(room);
        if (!seats.some((seat) => seat.playerId === memberId)) return fail("MEMBER_NOT_BOT");

        const memberIds = room.memberIds.filter((candidate) => candidate !== memberId);
        const memberNames = Object.fromEntries(
          Object.entries(room.memberNames).filter(([candidate]) => candidate !== memberId),
        );
        const updated = {
          ...room,
          memberIds,
          memberNames,
          bots: seats.filter((seat) => seat.playerId !== memberId),
          revision: room.revision + 1,
        } satisfies StoredRoom;
        if (humanMemberIds(updated).length === 0) return fail("LAST_HUMAN_REQUIRED");

        return commit(updated, room.revision);
      });
    },
    async bootstrap(input) {
      const room = await loadRoom(input.roomId);
      if (room === null) return fail("ROOM_NOT_FOUND");
      const viewerId = createStableId("PlayerId", input.viewerId);
      if (!room.memberIds.includes(viewerId)) return fail("ACTOR_NOT_MEMBER");
      // A viewer always arrives from a session, so a bot seat can never be one.
      if (isBotMember(room, viewerId)) return fail("ACTOR_IS_BOT");
      return {
        ok: true,
        value:
          room.game === null
            ? createRoomBootstrap(room, viewerId)
            : createBootstrap(room, viewerId, now()),
      };
    },
    async authorizeSubscription(input) {
      const room = await loadRoom(input.roomId);
      if (room === null) return fail("ROOM_NOT_FOUND");
      const viewerId = createStableId("PlayerId", input.viewerId);
      if (!room.memberIds.includes(viewerId)) return fail("ACTOR_NOT_MEMBER");
      if (isBotMember(room, viewerId)) return fail("ACTOR_IS_BOT");
      return { ok: true, value: viewerId };
    },
    async start(input) {
      return withRoomLock(input.roomId, async () => {
        const room = await loadRoom(input.roomId);
        if (room === null) return fail("ROOM_NOT_FOUND");
        const actorId = createStableId("PlayerId", input.actorId);
        const mismatch = actorKindMismatch(room, actorId, input.actorKind);
        if (mismatch !== null) return { ok: false, error: mismatch };
        if (room.hostId !== actorId) return fail("ACTOR_NOT_HOST");
        if (room.status !== "open") return fail("ROOM_NOT_OPEN");
        if (input.expectedRevision !== undefined && input.expectedRevision !== room.revision) {
          return fail("STALE_REVISION");
        }
        if (room.memberIds.length < MINIMUM_PLAYERS) return fail("MINIMUM_PLAYERS_NOT_MET");

        // One seed for the whole match: the engine seeds its own streams from it,
        // and setupFor derives the hidden-role assignment from a `:roles`-suffixed
        // stream of its own, so both are reproducible from this single value.
        const seed = gameSeed();
        const created = createDeadlineDashGame(setupFor(room, ids.gameId(), seed), seed);
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

        const updated = withTurnTimer({
          ...room,
          status: "active",
          revision: room.revision + 1,
          game: started.value.state,
          eventSummaries: appendEventSummaries(
            [],
            eventSummaries(started.value.events, actorId),
          ),
        } satisfies ActiveStoredRoom);
        return commit(updated, room.revision);
      });
    },
    async roll(input) {
      return withRoomLock(input.roomId, async () => {
        const room = await loadRoom(input.roomId);
        if (room === null) return fail("ROOM_NOT_FOUND");
        const actorId = createStableId("PlayerId", input.actorId);
        if (!room.memberIds.includes(actorId)) return fail("ACTOR_NOT_MEMBER");
        const mismatch = actorKindMismatch(room, actorId, input.actorKind);
        if (mismatch !== null) return { ok: false, error: mismatch };
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

        const updated = withTurnTimer({
          ...room,
          status: "active",
          revision: room.revision + 1,
          game: rolled.value.state,
          eventSummaries: appendEventSummaries(
            room.eventSummaries,
            eventSummaries(rolled.value.events, actorId),
          ),
        } satisfies ActiveStoredRoom);
        return commit(updated, room.revision);
      });
    },
    async respondToPrompt(input) {
      return withRoomLock(input.roomId, async () => {
        const room = await loadRoom(input.roomId);
        if (room === null) return fail("ROOM_NOT_FOUND");
        const actorId = createStableId("PlayerId", input.actorId);
        if (!room.memberIds.includes(actorId)) return fail("ACTOR_NOT_MEMBER");
        const mismatch = actorKindMismatch(room, actorId, input.actorKind);
        if (mismatch !== null) return { ok: false, error: mismatch };
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

        const updated = withTurnTimer({
          ...room,
          status: "active",
          revision: room.revision + 1,
          game: responded.value.state,
          eventSummaries: appendEventSummaries(
            room.eventSummaries,
            eventSummaries(responded.value.events, actorId),
          ),
        } satisfies ActiveStoredRoom);
        return commit(updated, room.revision);
      });
    },
  };
}
