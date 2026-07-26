import type {
  BotDifficulty,
  GameBootstrap,
  RoomBootstrap,
  RoomCapacity,
  RoomMode,
  RoomStatus,
  SafeEventSummary,
} from "@office-ladder/contracts";
import type {
  CommandId,
  EngineErrorCode,
  GameId,
  GameState,
  PlayerId,
  SetupErrorCode,
} from "@office-ladder/engine";

/**
 * A bot seat. Bots are *ordinary* room members: their playerId is also in
 * StoredRoom.memberIds and memberNames, so seating, character assignment,
 * turn order and every projection treat them exactly like humans. This array
 * is the only authority on which members are bots — never sniff the id
 * prefix, because a human auth id could legitimately start with "bot:".
 */
export type RoomBotSeat = {
  readonly playerId: PlayerId;
  readonly difficulty: BotDifficulty;
};

/**
 * The active player's turn clock, maintained entirely by this server.
 *
 * The engine models `GameState.turn.deadlineAt` but never populates it (every
 * transition writes `null`), and the engine may not read a clock at all — so the
 * deadline cannot live in canonical state without either editing the engine or
 * hand-writing a value into state the engine owns, which the next transition
 * would drop anyway. It lives here instead, beside the game rather than inside
 * it, and is projected into the contract's existing `deadlineAt` field.
 *
 * `gameRevision` and `playerId` are what make a timer verifiable rather than
 * merely present: a timer whose pair no longer matches the room's game belongs
 * to a turn that has already been taken, so it is re-armed rather than trusted.
 */
export type RoomTurnTimer = {
  /** Absolute ISO-8601 instant the turn expires. */
  readonly deadlineAt: string;
  /** The full budget this deadline was armed with, for a proportion display. */
  readonly durationMs: number;
  /** The game revision this deadline was armed for. */
  readonly gameRevision: number;
  /** The member on the clock — always the active player, never a bot seat. */
  readonly playerId: PlayerId;
};

export type StoredRoom = {
  readonly id: string;
  readonly code: string;
  readonly hostId: PlayerId;
  readonly memberIds: readonly PlayerId[];
  readonly memberNames: Readonly<Partial<Record<PlayerId, string>>>;
  /**
   * Each member's avatar URL, captured from their own user row when they joined
   * and already validated by contracts' parseAvatarUrl.
   *
   * Captured rather than looked up per request: the bootstrap read is polled every
   * few seconds by every client, and joining a user row per member onto it would
   * put N extra queries on the hottest path in the app to serve decoration. The
   * cost is staleness — a member who changes their picture keeps the old one for
   * the life of the room — which is bounded by a match lasting minutes, and is
   * currently unobservable because nothing in this app can change `user.image`.
   */
  readonly memberAvatars: Readonly<Partial<Record<PlayerId, string>>>;
  /**
   * Each member's *claimed* character, if they picked one. First claim wins, so
   * this map is injective by construction — a second claim on a taken character
   * is dropped at the point of claiming, never stored and silently reassigned
   * later. The read boundary re-enforces that (see rooms/room-snapshot.ts) so a
   * legacy or raced snapshot cannot smuggle a duplicate into setup.
   *
   * A member with no entry is assigned deterministically from whatever is left.
   */
  readonly memberCharacters: Readonly<Partial<Record<PlayerId, string>>>;
  readonly modeId: RoomMode;
  readonly capacity: RoomCapacity;
  readonly status: RoomStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly game: GameState | null;
  readonly eventSummaries: readonly SafeEventSummary[];
  /**
   * Rooms persisted before bot seats existed have no `bots` key at all in
   * their room_projections.projection JSONB blob, so every read path must go
   * through normalizeStoredRoom() rather than trusting this type.
   */
  readonly bots: readonly RoomBotSeat[];
  /** `null` when no clock is running — see {@link RoomTurnTimer}. */
  readonly turnTimer: RoomTurnTimer | null;
};

/**
 * Why a write can fail without any caller having done something wrong:
 *
 * - STALE_REVISION — the stored room has moved on from the revision the caller
 *   read, so applying this write would silently discard whoever got there first.
 *   Retryable by reading again, and surfaced to clients as 409 exactly like the
 *   engine's own expectedRevision rejection.
 * - SERIALIZATION_FAILED — the snapshot is not representable (see
 *   `rooms/room-snapshot.ts`). Refusing is the only alternative to persisting
 *   silently-lossy data; it is a server fault, so it answers 500.
 */
export type RoomWriteErrorCode = "STALE_REVISION" | "SERIALIZATION_FAILED";

export type RoomWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: RoomWriteErrorCode } };

/**
 * getByCode is required, not optional: join-by-code and the create-time
 * collision check both depend on it, and an implementation without it would
 * silently answer "no such room" to every code a player typed.
 */
export interface RoomRepository {
  create(room: StoredRoom): Promise<RoomWriteResult>;
  get(id: string): Promise<StoredRoom | null>;
  getByCode(code: string): Promise<StoredRoom | null>;
  /**
   * Conditional write: applies `room` only while the stored room is still at
   * `expectedRevision` — the revision this caller read before deciding what to
   * write.
   *
   * Without that predicate two overlapping read-modify-writes both persist
   * revision N+1 and the loser's work vanishes behind an HTTP 200: two joins
   * within one round trip drop a player (who then gets a permanent 403 from GET
   * /:roomId), and two rolls burn a turn, because the engine's expectedRevision
   * check passes for both — they read the same stale game. A per-process lock
   * narrows the window to a single instance; only the database predicate closes
   * it.
   *
   * A room that no longer exists is reported as STALE_REVISION as well: the
   * conditional UPDATE cannot distinguish "gone" from "moved on", and either way
   * the caller must read again.
   */
  save(room: StoredRoom, expectedRevision: number): Promise<RoomWriteResult>;
}

export type ActiveStoredRoom = Omit<StoredRoom, "game" | "status"> & {
  readonly status: "active";
  readonly game: GameState;
};

export type RoomServiceErrorCode =
  | EngineErrorCode
  | SetupErrorCode
  | "ROOM_NOT_FOUND"
  | "ROOM_CODE_NOT_FOUND"
  | "ROOM_NOT_OPEN"
  | "ROOM_FULL"
  | "ACTOR_ALREADY_MEMBER"
  | "ACTOR_NOT_MEMBER"
  | "ACTOR_NOT_HOST"
  | "MINIMUM_PLAYERS_NOT_MET"
  | "GAME_NOT_ACTIVE"
  | "MEMBER_NOT_BOT"
  | "LAST_HUMAN_REQUIRED"
  | "ACTOR_IS_BOT"
  | "ACTOR_NOT_BOT"
  | "ROOM_CODE_UNAVAILABLE"
  /** The requested character does not exist in this content release. */
  | "CHARACTER_NOT_FOUND"
  /**
   * Another member already claimed it. Only re-picking in the lobby can produce
   * this — create and join treat the claim as best-effort so a taken character
   * never costs somebody their seat.
   */
  | "CHARACTER_TAKEN";

export type RoomServiceError = {
  readonly code: RoomServiceErrorCode;
};

export type RoomServiceResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: RoomServiceError };

export type RoomServiceDependencies = {
  readonly repository: RoomRepository;
  readonly now: () => string;
  readonly ids: {
    readonly roomId: () => string;
    /**
     * Required. It used to be optional, with the service falling back to an
     * FNV-1a hash of the room id — which quietly turned the join code into a
     * pure function of an id that appears in every URL, i.e. no credential at
     * all. There is no safe default for a secret, so callers must supply a real
     * random generator (see rooms/default-service.ts).
     */
    readonly roomCode: () => string;
    readonly gameId: () => GameId;
    readonly commandId: () => CommandId;
  };
  readonly gameSeed: () => string;
  /**
   * How long a player has to take their turn, in milliseconds; `0` disables the
   * clock entirely and is a supported configuration, not a degraded one — a turn
   * timer is hostile in a casual game.
   *
   * Required rather than defaulted: `0` means "no enforcement", so a forgotten
   * dependency would silently disable the feature everywhere while every test
   * still passed. See rooms/turn-timer/turn-timer.ts for the parsing of the env
   * var behind it.
   */
  readonly turnTimeoutMs: number;
};

/**
 * A member's entry details. `avatarUrl` and `characterId` are both optional and
 * both mean "not provided" when absent — a caller with no session image and a
 * player who skipped the picker are ordinary cases, not errors.
 */
type MemberEntryInput = {
  readonly playerName: string;
  readonly avatarUrl?: string | null;
  readonly characterId?: string | null;
};

export type CreateRoomInput = MemberEntryInput & {
  readonly hostId: string;
  readonly modeId?: RoomMode;
  readonly mode?: RoomMode;
  readonly capacity?: RoomCapacity;
};

export type JoinRoomInput = MemberEntryInput & {
  readonly roomId: string;
  readonly actorId: string;
};

export type JoinRoomByCodeInput = MemberEntryInput & {
  readonly roomCode: string;
  readonly actorId: string;
};

/**
 * Re-picking in the lobby. The actor may only set their *own* claim: a bot seat's
 * character is left to the deterministic fallback, so the host is not given a
 * second way to act for a member.
 */
export type SelectCharacterInput = {
  readonly roomId: string;
  readonly actorId: string;
  /** `null` clears the claim, returning the seat to the fallback assignment. */
  readonly characterId: string | null;
};

/**
 * Which authority produced the actorId.
 *
 * "human" means a Better Auth session presented it; "bot" means this server's
 * own bot driver derived it from a seat in StoredRoom.bots. The service refuses
 * to cross the two, so a human can never act as a bot seat and the driver can
 * never act for a human member. Required rather than defaulted: every call site
 * knows exactly which it is, and a silent default is how the guard would rot.
 */
export type RoomActorKind = "human" | "bot";

export type RoomActorInput = {
  readonly roomId: string;
  readonly actorId: string;
  readonly actorKind: RoomActorKind;
  readonly commandId?: string;
  readonly expectedRevision?: number;
};

export type RollRoomInput = RoomActorInput & {
  readonly expectedRevision: number;
};

export type RespondToPromptRoomInput = RoomActorInput & {
  readonly expectedRevision: number;
  readonly decisionPointId: string;
  readonly optionId: string;
};

export type BootstrapRoomInput = {
  readonly roomId: string;
  readonly viewerId: string;
};

/**
 * Membership check for a Realtime subscription. Deliberately separate from
 * bootstrap(): the WebSocket upgrade needs the membership answer and nothing
 * else, and building a whole projection to throw it away would put real cost on
 * an unauthenticated-ish edge that anyone can hammer.
 */
export type AuthorizeSubscriptionInput = {
  readonly roomId: string;
  readonly viewerId: string;
};

export type AddBotInput = {
  readonly roomId: string;
  readonly actorId: string;
  readonly difficulty: BotDifficulty;
};

export type RemoveBotInput = {
  readonly roomId: string;
  readonly actorId: string;
  readonly memberId: string;
};

export interface RoomService {
  create(input: CreateRoomInput): Promise<RoomServiceResult<StoredRoom>>;
  join(input: JoinRoomInput): Promise<RoomServiceResult<StoredRoom>>;
  joinByCode(input: JoinRoomByCodeInput): Promise<RoomServiceResult<StoredRoom>>;
  bootstrap(
    input: BootstrapRoomInput,
  ): Promise<RoomServiceResult<RoomBootstrap | GameBootstrap>>;
  /** Resolves the viewer to the room member it may subscribe as. */
  authorizeSubscription(
    input: AuthorizeSubscriptionInput,
  ): Promise<RoomServiceResult<PlayerId>>;
  addBot(input: AddBotInput): Promise<RoomServiceResult<StoredRoom>>;
  removeBot(input: RemoveBotInput): Promise<RoomServiceResult<StoredRoom>>;
  selectCharacter(input: SelectCharacterInput): Promise<RoomServiceResult<StoredRoom>>;
  start(input: RoomActorInput): Promise<RoomServiceResult<ActiveStoredRoom>>;
  roll(input: RollRoomInput): Promise<RoomServiceResult<ActiveStoredRoom>>;
  respondToPrompt(
    input: RespondToPromptRoomInput,
  ): Promise<RoomServiceResult<ActiveStoredRoom>>;
}
