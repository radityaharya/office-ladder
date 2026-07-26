import type {
  BotDifficulty,
  GameplayBootstrap,
  ModeRules,
  PlayerCommandRequestByType,
  PlayerCommandType,
  RoomBootstrap,
  RoomCapacity,
  RoomMode,
  RoomStatus,
  SafeEventSummary,
  ServerInjectedCommandType,
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
  /**
   * The lobby-authored ruleset for this room, or absent/`null` when it simply
   * plays its mode preset's own rules (spec §8.4).
   *
   * Untrusted on arrival and untrusted on the way back out of storage: both
   * doors that can write it — `create` and `setModeRules` in
   * `create-room-service.ts` — go through `parseModeRules` first, and the
   * persistence boundary re-validates it on read for the same reason
   * `memberAvatars` is re-checked: the row could have been written by a build
   * whose bounds were looser.
   *
   * Optional because every snapshot written before custom modes existed has no
   * such key; absent and `null` mean the same thing.
   */
  readonly customRules?: ModeRules | null;
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
  /**
   * A ruleset authored in the create-room form, or absent when the room simply
   * plays its mode preset's own rules (spec §8.4).
   *
   * `unknown` for the same reason {@link SetModeRulesInput.rules} is: it arrives
   * from a browser, so it is untrusted until `parseModeRules` has rebuilt it
   * field by field. Typing it as `ModeRules` here would let the route hand over
   * an object that merely *claims* to be one — and the create path is the one a
   * hostile client reaches first, before any lobby control has been rendered.
   */
  readonly customRules?: unknown;
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

/**
 * Every command a *player* may submit through the room service, which is
 * {@link PlayerCommandType} minus `game.start`.
 *
 * `game.start` is excluded because it is not a command against an existing game
 * — the game does not exist until the room service builds it — so it keeps its
 * own entry point, {@link RoomService.start}, whose `expectedRevision` is the
 * *room's* revision rather than the game's. Folding it in here would mean one
 * method whose envelope means two different things.
 */
export type SubmittableCommandType = Exclude<PlayerCommandType, "game.start">;

/**
 * One player command, already parsed by `@office-ladder/contracts`.
 *
 * A discriminated union over the command type rather than a generic, so `type`
 * and `request` cannot be mismatched at a call site and the translator's switch
 * narrows the payload without a cast. The request is the contracts DTO for that
 * type, not a hand-rolled payload: the bounds in
 * `packages/contracts/src/commands.ts` are the transport ceiling, and this type
 * is what makes skipping them a compile error rather than an omission.
 */
export type PlayerCommandSelection = {
  [Type in SubmittableCommandType]: {
    readonly type: Type;
    readonly request: PlayerCommandRequestByType[Type];
  };
}[SubmittableCommandType];

/**
 * `actorId` is *not* in the request and never can be — it is a separate field
 * here, and every caller resolves it from the authenticated session (spec §11.1:
 * the route validates identity, the engine validates legality).
 */
export type SubmitCommandInput = PlayerCommandSelection & {
  readonly roomId: string;
  readonly actorId: string;
  readonly actorKind: RoomActorKind;
};

/**
 * A wall-clock boundary crossing (spec §7.1), submitted by this server's own
 * schedulers and by nothing else.
 *
 * There is deliberately **no `actorId`**. The engine's only signal that a
 * command came from the scheduler rather than a browser is that its actor is not
 * a seat at the table, so the service derives a synthetic per-room actor itself:
 * a caller that cannot name the actor cannot name a player, and `window.expire`
 * therefore cannot be submitted on anyone's behalf even by a compromised
 * scheduler. Contracts has no parser for these types either, so a request body
 * cannot reach this method at all.
 */
export type SubmitServerCommandInput = {
  readonly roomId: string;
  readonly type: ServerInjectedCommandType;
  readonly expectedRevision: number;
  /**
   * Required for `window.expire`, ignored by the other two. The decision point
   * whose deadline passed: a reaction window, a ballot or a promotion block.
   */
  readonly decisionPointId?: string;
  /**
   * Must carry one of the reserved server-actor prefixes; contracts refuses a
   * client-supplied command id that does, so an expiry can never be pre-empted
   * by a browser guessing it.
   */
  readonly commandId: string;
};

/**
 * The host authoring a custom ruleset in the lobby (spec §8.4).
 *
 * `rules` is `unknown` on purpose. It arrives from a browser, and the whole
 * point of this method is that it goes through `parseModeRules` — typing the
 * parameter as `ModeRules` would let a caller hand over an object that merely
 * *claims* to be one and skip the only thing standing between a lobby and an
 * `interestBasisPoints` of -10000.
 */
export type SetModeRulesInput = {
  readonly roomId: string;
  readonly actorId: string;
  /** `null` clears the authored ruleset, returning the room to its mode preset. */
  readonly rules: unknown;
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
  ): Promise<RoomServiceResult<RoomBootstrap | GameplayBootstrap>>;
  /** Resolves the viewer to the room member it may subscribe as. */
  authorizeSubscription(
    input: AuthorizeSubscriptionInput,
  ): Promise<RoomServiceResult<PlayerId>>;
  addBot(input: AddBotInput): Promise<RoomServiceResult<StoredRoom>>;
  removeBot(input: RemoveBotInput): Promise<RoomServiceResult<StoredRoom>>;
  selectCharacter(input: SelectCharacterInput): Promise<RoomServiceResult<StoredRoom>>;
  /** Records a lobby-authored ruleset, or clears it. Host only, lobby only. */
  setModeRules(input: SetModeRulesInput): Promise<RoomServiceResult<StoredRoom>>;
  start(input: RoomActorInput): Promise<RoomServiceResult<ActiveStoredRoom>>;
  /**
   * The one entry point for every player command against a running match.
   *
   * One method rather than twenty-six, for the reason spec §11.1 gives for one
   * route rather than twenty-eight: load, actor-kind guard, membership guard,
   * apply, event summaries, turn clock and conditional write are identical for
   * all of them, and twenty-six copies of that block is not a design — it is
   * twenty-six places for one of those steps to go missing. The per-command part
   * is the payload translation, which lives in one exhaustive switch that the
   * compiler checks against the engine's own command union.
   */
  submitCommand(input: SubmitCommandInput): Promise<RoomServiceResult<ActiveStoredRoom>>;
  /** §7.1's scheduler path: `window.expire`, `quarter.advance`, `turn.timeout`. */
  submitServerCommand(
    input: SubmitServerCommandInput,
  ): Promise<RoomServiceResult<ActiveStoredRoom>>;
  /**
   * `turn.roll`, kept as its own method because the existing `POST /:roomId/roll`
   * route and the bot driver both call it. A thin wrapper over
   * {@link RoomService.submitCommand}.
   */
  roll(input: RollRoomInput): Promise<RoomServiceResult<ActiveStoredRoom>>;
  /** `prompt.respond`, kept for the same reason as {@link RoomService.roll}. */
  respondToPrompt(
    input: RespondToPromptRoomInput,
  ): Promise<RoomServiceResult<ActiveStoredRoom>>;
}
