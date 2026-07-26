export const ROOM_CAPACITIES = [3, 4, 5, 6] as const;

export const ROOM_MODES = ["mode.quick", "mode.marathon"] as const;

export const BOT_DIFFICULTIES = ["easy", "standard", "ruthless"] as const;

/**
 * Enumerated at runtime, like the other room vocabularies: the server has to
 * validate the status inside an untrusted persisted snapshot, and a hand-written
 * union would force it to keep a duplicate copy of this list.
 */
export const ROOM_STATUSES = [
  "open",
  "starting",
  "active",
  "completed",
  "abandoned",
] as const;

export type RoomCapacity = (typeof ROOM_CAPACITIES)[number];
export type RoomMode = (typeof ROOM_MODES)[number];
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];
export type RoomStatus = (typeof ROOM_STATUSES)[number];

/**
 * `characterId` is a *preference*, not a reservation: it is `null` when the
 * client did not send one (older clients, and any client that lets a player skip
 * the picker), and the server falls back to a deterministic assignment. A
 * character already claimed by another member is dropped rather than refused —
 * see the room service's character resolution — so a cosmetic preference can
 * never cost somebody their seat.
 */
export type CreateRoomRequest = {
  readonly mode: RoomMode;
  readonly capacity: RoomCapacity;
  readonly playerName: string;
  readonly characterId: string | null;
};

export type JoinRoomRequest = {
  readonly roomCode: string;
  readonly playerName: string;
  readonly characterId: string | null;
};

/**
 * Re-picking in the lobby. `null` clears the claim, which is why the field is
 * required here while it is optional on create/join: an omitted key means "I did
 * not choose", but this request exists only to *state* a choice.
 */
export type SelectCharacterRequest = {
  readonly characterId: string | null;
};

type RevisionCommandRequest = {
  readonly commandId: string;
  readonly expectedRevision: number;
};

export type StartGameRequest = RevisionCommandRequest;
export type RollRequest = RevisionCommandRequest;

export type RespondToPromptRequest = RevisionCommandRequest & {
  readonly decisionPointId: string;
  readonly optionId: string;
};

export type AddBotRequest = {
  readonly difficulty: BotDifficulty;
};

export type RemoveBotRequest = {
  readonly memberId: string;
};

export type RoomMemberProjection = {
  readonly id: string;
  readonly displayName: string;
  readonly seat: number;
  readonly isHost: boolean;
  readonly isReady: boolean;
  readonly isConnected: boolean;
  readonly isBot: boolean;
  readonly botDifficulty: BotDifficulty | null;
  /**
   * The member's profile picture, or `null` — which is the common case, because
   * nothing in this app can set one yet. Renderers must have a non-image
   * fallback (initials, the seat glyph); an avatar is decoration on top of the
   * seat colour and number, never the only way to tell two seats apart.
   *
   * **What the server guarantees** (see {@link parseAvatarUrl}): an absolute
   * `https:` URL with no embedded credentials, or a root-relative same-origin
   * path, at most {@link AVATAR_URL_MAX_LENGTH} characters, with no control
   * characters, whitespace, or attribute-terminating characters (`"`, `'`, `<`,
   * `>`, a backtick, a backslash). `javascript:`, `data:`, `blob:`, `file:`, plain
   * `http:` and protocol-relative `//host/…` are all reported as `null`, so this
   * value is safe to place in an `img src`. It is *not* safe anywhere that
   * executes — never put it in `href`, `srcdoc`, `style`, or a CSS `url()`.
   *
   * Bot seats are always `null`: a bot has no user row, so there is nothing to
   * show but the UI's own marker.
   */
  readonly avatarUrl: string | null;
  /**
   * While the room is open: the character this member has claimed, or `null` if
   * they have not picked one. Once the match has started: the character the
   * canonical game actually assigned them, which is authoritative and may differ
   * from an unclaimed member's earlier `null`.
   *
   * Characters are public information — unlike a player's role, which stays
   * hidden until the game reveals it.
   */
  readonly characterId: string | null;
  /** Display text for {@link characterId}, or `null` when there is no character. */
  readonly characterLabel: string | null;
};

export type RoomProjection = {
  readonly id: string;
  readonly code: string;
  readonly status: RoomStatus;
  readonly mode: RoomMode;
  readonly capacity: RoomCapacity;
  readonly revision: number;
  readonly members: readonly RoomMemberProjection[];
};

/**
 * One selectable character, as offered to the lobby's picker.
 *
 * `label` is plain display text and `nameKey` is the content pack's translation
 * key for the same name, so a client can start with `label` and move to real
 * i18n without a server change.
 */
export type CharacterOptionProjection = {
  readonly id: string;
  readonly label: string;
  readonly nameKey: string;
  /**
   * The member holding this character, or `null` when it is free. First claim
   * wins, so a taken option should be shown as unavailable rather than offered
   * and then silently reassigned.
   */
  readonly takenByMemberId: string | null;
};

export type RoomBootstrap = {
  readonly room: RoomProjection;
  readonly selfMemberId: string;
  /**
   * Every character the content pack offers, in a stable order, with whoever has
   * claimed it. Present on the lobby bootstrap only — once a match is running the
   * assignment is fixed and lives on each member projection.
   */
  readonly characterOptions: readonly CharacterOptionProjection[];
};

export type PublicRoleProjection =
  | { readonly revealed: false }
  | { readonly revealed: true; readonly kind: "role.worker" | "role.management" | null };

export type PublicPlayerProjection = {
  readonly id: string;
  readonly seat: number;
  readonly connected: boolean;
  readonly position: number;
  readonly lapsCompleted: number;
  readonly rank: {
    readonly id: string;
    readonly kind: string | null;
    readonly index: number;
  };
  readonly role: PublicRoleProjection;
  readonly resources: Readonly<Record<string, number>>;
  readonly tokens: Readonly<Record<string, number>>;
  readonly statusIds: readonly string[];
};

export type PublicGameProjection = {
  readonly id: string;
  readonly revision: number;
  readonly status: "setup" | "active" | "paused" | "ended";
  readonly activePlayerId: string | null;
  readonly turnNumber: number;
  readonly round: number;
  readonly phase: string;
  /**
   * When the active player's turn expires, as an absolute ISO-8601 instant, or
   * `null` when no clock is running (the timer is switched off, the match is
   * over, or a bot holds the turn — bots have their own pacing).
   *
   * Count down locally from this instant; never poll for the remaining time. The
   * client's own clock can be minutes off, so correct for skew with
   * {@link GameBootstrap.serverTime}: take `skew = Date.now() - Date.parse(serverTime)`
   * once per bootstrap and render `Date.parse(deadlineAt) + skew - Date.now()`.
   *
   * The deadline is advisory to the client and authoritative on the server: when
   * it passes, the server commits the turn on the player's behalf whether or not
   * any client noticed. A countdown that reaches zero should therefore stop at
   * zero and wait for the next update rather than take any action of its own.
   */
  readonly deadlineAt: string | null;
  /**
   * The full budget `deadlineAt` was armed with, for rendering a proportion.
   * `null` exactly when `deadlineAt` is `null`.
   */
  readonly turnTimerDurationMs: number | null;
  readonly players: readonly PublicPlayerProjection[];
  readonly eventSummaries: readonly SafeEventSummary[];
  readonly winnerPlayerIds: readonly string[];
};

export type CallerSelfProjection = {
  readonly playerId: string;
  readonly role: {
    readonly id: string;
    readonly kind: "role.worker" | "role.management" | null;
    readonly revealed: boolean;
  };
  readonly characterId: string;
  readonly hand: readonly {
    readonly id: string;
    readonly definitionId: string;
  }[];
  readonly privateStatusIds: readonly string[];
  readonly abilityIds: readonly string[];
};

export type PromptProjection = {
  readonly id: string;
  readonly kind: string;
  /**
   * The same instant as {@link PublicGameProjection.deadlineAt} while this prompt
   * is the thing the active player's clock is waiting on; `null` otherwise. On
   * expiry the server answers the prompt with its least-harmful option rather
   * than letting the match stall — see the report for which option that is.
   */
  readonly deadlineAt: string | null;
  readonly optionIds: readonly string[];
};

export type ReactionProjection = {
  readonly id: string;
  readonly kind: "prevention" | "end-turn" | "promotion-block";
  readonly deadlineAt: string | null;
  readonly hasPriority: boolean;
  readonly hasPassed: boolean;
  readonly hasPlayed: boolean;
};

export type LegalActionSummary =
  | {
      readonly type: "game.start";
      readonly expectedRevision: number;
    }
  | {
      readonly type: "turn.roll";
      readonly expectedRevision: number;
    }
  | {
      readonly type: "prompt.respond";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
      readonly kind: string;
      readonly options: readonly string[];
    };

type SafeEventSummaryMetadata = {
  readonly id: string;
  readonly type: string;
  readonly revision: number;
  readonly occurredAt: string;
  readonly actorPlayerId: string | null;
};

export type SafeEventSummary =
  | (SafeEventSummaryMetadata & {
      readonly type: "CardDrawn";
      readonly card: {
        readonly definitionId: string;
        readonly deckId: string;
        readonly nameKey: string;
      };
    })
  | (SafeEventSummaryMetadata & {
      readonly type: "DiceRolled";
      readonly dice: readonly number[];
      readonly total: number;
      readonly purpose: string;
    })
  | (SafeEventSummaryMetadata & {
      readonly type:
        | "GameStarted"
        | "TurnStarted"
        | "PlayerMoved"
        | "SalaryAwarded"
        | "TileResolved"
        | "CardStored"
        | "CardPlayed"
        | "EffectProposed"
        | "EffectPrevented"
        | "ResourceChanged"
        | "StatusApplied"
        | "PromptOpened"
        | "ReactionWindowOpened"
        | "PromotionAttempted"
        | "PromotionBlocked"
        | "ManagementRevealed"
        | "PlayerPromoted"
        | "ClockDeckExhausted"
        | "MatchEnded";
    });

export type GameBootstrap = {
  readonly room: RoomProjection;
  readonly publicProjection: PublicGameProjection;
  readonly self: CallerSelfProjection;
  readonly prompts: readonly PromptProjection[];
  readonly reactions: readonly ReactionProjection[];
  readonly legalActions: readonly LegalActionSummary[];
  readonly serverTime: string;
};

export class ContractValidationError extends Error {
  readonly name = "ContractValidationError";

  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path} ${reason}`);
  }
}

const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ContractValidationError(path, "must be an object");
  }

  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const expectedKeys = new Set(keys);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new ContractValidationError(path, "contains unknown or missing fields");
  }
}

/**
 * requireExactKeys with a declared set of *optional* keys.
 *
 * requireExactKeys compares the key count, so it cannot express "this field may
 * be omitted": adding an optional field with it would reject every client that
 * does not send the new key — including the ones already deployed. This keeps the
 * property that actually matters, that an unknown key is refused so nothing can
 * smuggle a field the server does not read, while letting a field be additive.
 *
 * Own properties only. `"toString" in value` is true for any object, so a
 * presence test with `in` would accept a body that never mentioned the field.
 */
function requireKnownKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ContractValidationError(path, "contains an unknown field");
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new ContractValidationError(path, "is missing a required field");
    }
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ContractValidationError(path, "must be a string");
  }

  return value;
}

function requirePlayerName(value: unknown, path: string): string {
  const name = requireString(value, path).trim();
  if (name.length < 1 || name.length > 40) {
    throw new ContractValidationError(path, "must be between 1 and 40 characters");
  }

  return name;
}

function requireRevision(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContractValidationError(path, "must be a non-negative safe integer");
  }

  return value;
}

function requireRoomMode(value: unknown, path: string): RoomMode {
  if (value !== "mode.quick" && value !== "mode.marathon") {
    throw new ContractValidationError(path, "must be a supported room mode");
  }

  return value;
}

function requireBotDifficulty(value: unknown, path: string): BotDifficulty {
  if (value !== "easy" && value !== "standard" && value !== "ruthless") {
    throw new ContractValidationError(path, "must be a supported bot difficulty");
  }

  return value;
}

function requireRoomCapacity(value: unknown, path: string): RoomCapacity {
  if (value !== 3 && value !== 4 && value !== 5 && value !== 6) {
    throw new ContractValidationError(path, "must be between 3 and 6");
  }

  return value;
}

export function parseRoomCode(value: unknown): string {
  const normalized = requireString(value, "roomCode").trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(normalized)) {
    throw new ContractValidationError(
      "roomCode",
      "must be a six-character alphanumeric room code",
    );
  }

  return normalized;
}

export function parseOpaqueId(value: unknown, path = "id"): string {
  const id = requireString(value, path);
  if (!ID_PATTERN.test(id)) {
    throw new ContractValidationError(path, "must be a valid opaque identifier");
  }

  return id;
}

/**
 * Command-id prefixes this server's own background actors own, and which a client
 * therefore may not use.
 *
 * Both server-side actors mint deterministic command ids from state a client can
 * see — `bot:<gameId>:<gameRevision>:<kind>` and
 * `timeout:<gameId>:<gameRevision>:<kind>` — so before this namespace was
 * reserved a player could *pre-claim* one. The engine's idempotency check is
 * `command.commandId === state.lastCommandId`, and it answers INVALID_COMMAND,
 * which both drivers classify as an expected "the world moved on" stop. So a
 * player rolling with `bot:<gameId>:<revision + 1>:roll` — the id the bot driver
 * will derive for the very next command — makes the bot's turn be refused as
 * already-applied, silently and permanently: nobody else can act on a bot's turn,
 * and every later kick re-derives the identical refused id. One request from any
 * member freezes the whole match. The same trick against `timeout:` defeats
 * turn-clock enforcement for a turn, which is the entire point of that feature.
 *
 * Reserved here, at the boundary that knows a value came from an untrusted
 * client, rather than in the room service — the service cannot tell the timeout
 * driver (which legitimately acts as a human) from the human it is acting for.
 * The drivers build their ids from these same constants so the two cannot drift.
 */
export const BOT_COMMAND_ID_PREFIX = "bot:";
export const TURN_TIMEOUT_COMMAND_ID_PREFIX = "timeout:";

export const SERVER_ACTOR_COMMAND_ID_PREFIXES = [
  BOT_COMMAND_ID_PREFIX,
  TURN_TIMEOUT_COMMAND_ID_PREFIX,
] as const;

/**
 * Case-insensitive, although the collision itself is not: `lastCommandId` is
 * compared byte for byte, so only an exact match can poison it today. Matching
 * loosely costs a client nothing real (no generator produces these prefixes —
 * apps/web uses `crypto.randomUUID()`) and keeps the guard correct if a driver's
 * id scheme is ever re-cased.
 */
export function isServerActorCommandId(value: string): boolean {
  const normalized = value.toLowerCase();
  return SERVER_ACTOR_COMMAND_ID_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function parseCommandId(value: unknown): string {
  const commandId = parseOpaqueId(value, "commandId");
  if (isServerActorCommandId(commandId)) {
    throw new ContractValidationError(
      "commandId",
      "must not start with a prefix reserved for the server's own actors",
    );
  }

  return commandId;
}

/**
 * Upper bound on a stored avatar URL. Long enough for any real CDN URL with a
 * signature query string, short enough that a hostile row cannot bloat every
 * bootstrap payload (the room projection carries one per member, on a path
 * clients poll every few seconds).
 */
export const AVATAR_URL_MAX_LENGTH = 2048;

/** Any whitespace, including the Unicode kinds not caught by a naive space check. */
const WHITESPACE_PATTERN = /\s/u;

/**
 * Characters that can end an HTML attribute value early.
 *
 * The absolute-URL branch below returns WHATWG-canonical form, which
 * percent-encodes `"`, `<`, `>` and a backtick — but the root-relative branch
 * returns the caller's string verbatim, so without this it could carry them. That
 * matters because `<img src="/a"onerror=alert(1)>` executes: browsers recover from
 * a missing space between attributes by reconsuming as a new attribute name, so a
 * closing quote alone is enough in any renderer that does not escape (this repo's
 * client is React, which does — this is the guarantee holding rather than luck).
 * A backslash is refused with them: WHATWG treats it as a slash in a special
 * scheme, so it is a second spelling of the same authority tricks refused below.
 */
const HTML_UNSAFE_URL_CHARACTERS = new Set(['"', "'", "<", ">", "`", "\\"]);

/**
 * Whitespace, a C0/C1 control character, or a character that could break out of
 * an HTML attribute — none of which belong in a URL.
 *
 * A code-point scan rather than the obvious character class, because embedding
 * literal control characters in a regex is exactly what `no-control-regex`
 * exists to catch — and suppressing that rule here would mean suppressing it on
 * the one value in this file that reaches an `img src`.
 *
 * A newline matters beyond URL validity: nothing logs an avatar today, but this
 * value is stored and re-served, and the log formatter's escaping is the *only*
 * thing that would stop a line break forging a second log line if anything ever
 * did. Refusing it here means that never has to be remembered.
 */
function hasUnsafeUrlCharacter(value: string): boolean {
  if (WHITESPACE_PATTERN.test(value)) return true;
  for (const character of value) {
    if (HTML_UNSAFE_URL_CHARACTERS.has(character)) return true;
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

/**
 * Validates a member avatar URL, answering `null` for anything it will not
 * vouch for.
 *
 * Deliberately non-throwing, unlike every other parser here: this value does not
 * arrive in a request body, it comes out of the user's own `user.image` column
 * (written by an OAuth provider today, by an upload pipeline eventually). A
 * profile picture the server cannot vouch for must degrade to "no picture" — it
 * must never be able to fail a join.
 *
 * What is accepted:
 * - an absolute `https:` URL with an empty username and password, returned in
 *   WHATWG-canonical form so what is stored is unambiguous;
 * - a root-relative same-origin path (`/avatars/x.png`), for a future upload
 *   pipeline that serves images from this app's own origin.
 *
 * What is refused, and why:
 * - `javascript:`, `data:`, `blob:`, `file:`, `vbscript:` and every other scheme
 *   — a scheme allow-list is the only form of this check that stays correct as
 *   new schemes appear;
 * - plain `http:` — it would be blocked as mixed content on any https page
 *   anyway, so accepting it only produces broken images and a downgrade;
 * - protocol-relative `//host/x.png` and `/\host/x.png` — both load from another
 *   host while *looking* same-origin, which is the classic way an allow-list of
 *   "starts with /" gets bypassed;
 * - embedded credentials (`https://user:pass@host/…`) — they leak on every
 *   request and are a phishing primitive;
 * - anything over {@link AVATAR_URL_MAX_LENGTH}, and anything containing
 *   whitespace or control characters. Over-length is refused rather than
 *   truncated: a truncated URL is a broken URL wearing a valid one's clothes.
 */
export function parseAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > AVATAR_URL_MAX_LENGTH) return null;
  if (hasUnsafeUrlCharacter(candidate)) return null;

  if (candidate.startsWith("/")) {
    // "//host" and "/\host" are both other-origin loads that pass a naive
    // "starts with a slash" test.
    const second = candidate[1];
    return second === "/" || second === "\\" ? null : candidate;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username.length > 0 || url.password.length > 0) return null;

  const normalized = url.toString();
  return normalized.length > AVATAR_URL_MAX_LENGTH ? null : normalized;
}

/**
 * An absent key, an explicit `null`, and an empty string all mean "no character
 * chosen", because a picker with a "no preference" state, a client that omits the
 * field entirely, and an unselected `<select>` are the same fact about the
 * request.
 *
 * The empty string is included deliberately rather than refused. A placeholder
 * `<option value="">` is *the* HTML way to say "nothing picked", and
 * `String(formData.get("characterId") ?? "")` is the idiomatic read — so refusing
 * it would turn the ordinary "player skipped the picker" case into a 400 on the
 * create/join path, which is exactly the case this field exists to tolerate. It
 * gives up nothing: an empty string cannot name a character, so there is no
 * ambiguity to resolve and nothing a caller could smuggle through it. A
 * *non-empty* id is still validated strictly, so a typo'd or hostile id is still
 * refused rather than silently reassigned.
 */
function parseOptionalCharacterId(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  return parseOpaqueId(value, path);
}

export function parseCreateRoomRequest(value: unknown): CreateRoomRequest {
  const input = requireObject(value, "createRoom");
  requireKnownKeys(
    input,
    ["mode", "capacity", "playerName"],
    ["characterId"],
    "createRoom",
  );

  return {
    mode: requireRoomMode(input["mode"], "mode"),
    capacity: requireRoomCapacity(input["capacity"], "capacity"),
    playerName: requirePlayerName(input["playerName"], "playerName"),
    characterId: parseOptionalCharacterId(input["characterId"], "characterId"),
  };
}

export function parseJoinRoomRequest(value: unknown): JoinRoomRequest {
  const input = requireObject(value, "joinRoom");
  requireKnownKeys(input, ["roomCode", "playerName"], ["characterId"], "joinRoom");

  return {
    roomCode: parseRoomCode(input["roomCode"]),
    playerName: requirePlayerName(input["playerName"], "playerName"),
    characterId: parseOptionalCharacterId(input["characterId"], "characterId"),
  };
}

export function parseSelectCharacterRequest(value: unknown): SelectCharacterRequest {
  const input = requireObject(value, "selectCharacter");
  requireExactKeys(input, ["characterId"], "selectCharacter");

  return {
    characterId: parseOptionalCharacterId(input["characterId"], "characterId"),
  };
}

export function parseAddBotRequest(value: unknown): AddBotRequest {
  const input = requireObject(value, "addBot");
  requireExactKeys(input, ["difficulty"], "addBot");

  return {
    difficulty: requireBotDifficulty(input["difficulty"], "difficulty"),
  };
}

export function parseRemoveBotRequest(value: unknown): RemoveBotRequest {
  const input = requireObject(value, "removeBot");
  requireExactKeys(input, ["memberId"], "removeBot");

  return {
    memberId: parseOpaqueId(input["memberId"], "memberId"),
  };
}

function parseRevisionCommandRequest(
  value: unknown,
  path: string,
): RevisionCommandRequest {
  const input = requireObject(value, path);
  requireExactKeys(input, ["commandId", "expectedRevision"], path);

  return {
    commandId: parseCommandId(input["commandId"]),
    expectedRevision: requireRevision(input["expectedRevision"], "expectedRevision"),
  };
}

export function parseStartGameRequest(value: unknown): StartGameRequest {
  return parseRevisionCommandRequest(value, "startGame");
}

export function parseRollRequest(value: unknown): RollRequest {
  return parseRevisionCommandRequest(value, "roll");
}

export function parseRespondToPromptRequest(value: unknown): RespondToPromptRequest {
  const input = requireObject(value, "respondToPrompt");
  requireExactKeys(
    input,
    ["commandId", "expectedRevision", "decisionPointId", "optionId"],
    "respondToPrompt",
  );

  return {
    commandId: parseCommandId(input["commandId"]),
    expectedRevision: requireRevision(input["expectedRevision"], "expectedRevision"),
    decisionPointId: parseOpaqueId(input["decisionPointId"], "decisionPointId"),
    optionId: parseOpaqueId(input["optionId"], "optionId"),
  };
}
