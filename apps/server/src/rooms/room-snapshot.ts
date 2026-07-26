import {
  BOT_DIFFICULTIES,
  parseAvatarUrl,
  ROOM_CAPACITIES,
  ROOM_MODES,
  ROOM_STATUSES,
  type BotDifficulty,
  type RoomCapacity,
  type RoomMode,
  type RoomStatus,
  type SafeEventSummary,
} from "@office-ladder/contracts";
import {
  assertJsonCompatible,
  createStableId,
  deserializeGameState,
  serializeGameState,
  type GameState,
  type JsonValue,
  type PlayerId,
} from "@office-ladder/engine";
import { log, logException } from "@/observability/log";
import type { RoomBotSeat, RoomTurnTimer, StoredRoom } from "./service/types";

/**
 * The single persistence boundary for a room snapshot.
 *
 * `room_projections.projection` holds an entire StoredRoom — including the
 * canonical GameState — as one jsonb blob, so every field read back out is
 * whatever some older build of this server happened to write. Two hazards
 * follow, and both are handled here rather than scattered across readers:
 *
 * 1. **Fields added later are simply absent.** `StoredRoom.bots` is the known
 *    case; the DiceRolled event summary gaining required `dice`/`total`/
 *    `purpose` this round is the newer one. A consumer that narrows on the
 *    variant and reads `.dice` faults on a snapshot written before it existed.
 * 2. **Nothing validated what went in.** The previous implementation persisted
 *    the GameState through `JSON.parse(JSON.stringify(...))`, which silently
 *    drops `undefined`, flattens a Map/Set to `{}`, stringifies a Date and
 *    turns a non-finite number into `null` — corruption with no error.
 *
 * So: every write goes through {@link toRoomSnapshot}, every read through
 * {@link fromRoomSnapshot}, and the GameState half of both uses the engine's
 * own serialization contract (`serializeGameState`/`deserializeGameState`)
 * instead of raw JSON. A state the engine would refuse can therefore neither be
 * written nor served.
 */

/**
 * Upper bound on the event summaries a persisted room may carry.
 *
 * Every committed command appends to `StoredRoom.eventSummaries` and rewrites
 * the whole snapshot, and the entire array is shipped to every client on every
 * bootstrap and every 5s poll — O(N^2) write bytes over a match plus a growing
 * payload. Keeping only the newest entries is the conservative trim: the
 * client's seen-event set (apps/web's reduceEventFeedback) only ever grows and
 * treats "not in the array" as nothing to announce, so dropping the *oldest*
 * entries can neither hide a new event nor replay an old one. The only loss is
 * activity-log depth beyond this many events. A single command emits well under
 * 20 summaries, so the newest command's events always survive intact.
 */
export const MAX_PERSISTED_EVENT_SUMMARIES = 200;

/** Marks a `createdAt` that was missing from the snapshot, rather than inventing one. */
const UNKNOWN_CREATED_AT = "1970-01-01T00:00:00.000Z";

export type RoomSnapshot = {
  /** The whole StoredRoom, as it goes into `room_projections.projection`. */
  readonly room: JsonValue;
  /** The canonical game only, as it goes into `games.canonical_state`. */
  readonly game: JsonValue | null;
};

export type RoomSnapshotResult =
  | { readonly ok: true; readonly value: RoomSnapshot }
  | { readonly ok: false; readonly error: { readonly code: "SERIALIZATION_FAILED" } };

/**
 * Appends newly committed summaries, keeping the array bounded. Callers use this
 * instead of spreading so the trim happens in exactly one place.
 */
export function appendEventSummaries(
  existing: readonly SafeEventSummary[],
  appended: readonly SafeEventSummary[],
): readonly SafeEventSummary[] {
  const combined = [...existing, ...appended];
  return combined.length <= MAX_PERSISTED_EVENT_SUMMARIES
    ? combined
    : combined.slice(combined.length - MAX_PERSISTED_EVENT_SUMMARIES);
}

/**
 * Validates a room on its way to storage and returns the plain JSON to persist.
 *
 * Fails instead of corrupting: `serializeGameState` runs the engine's own
 * `assertGameState` plus a JSON-compatibility walk, and the rest of the room is
 * walked by `assertJsonCompatible`, so an unrepresentable value (a Map, a Date,
 * NaN, an `undefined` property) is a rejected write rather than a snapshot that
 * silently lost data.
 */
export function toRoomSnapshot(room: StoredRoom): RoomSnapshotResult {
  try {
    const game: JsonValue | null =
      room.game === null ? null : (JSON.parse(serializeGameState(room.game)) as JsonValue);
    const candidate: unknown = {
      ...room,
      game,
      eventSummaries: appendEventSummaries([], room.eventSummaries),
    };
    assertJsonCompatible(candidate);
    return { ok: true, value: { room: candidate, game } };
  } catch (error) {
    logException("error", "room.snapshot-unserializable", error, { room: room.id });
    return { ok: false, error: { code: "SERIALIZATION_FAILED" } };
  }
}

/**
 * Rebuilds a StoredRoom from an untrusted persisted snapshot.
 *
 * Every field is reconstructed from a validated value, so unknown extra keys
 * written by an older build cannot leak into a projection, and no consumer has
 * to defend against a missing one. Returns `null` — which callers surface as
 * ROOM_NOT_FOUND — when the snapshot cannot be served at all: no id/code/host,
 * or a canonical game this engine refuses. That is deliberately fail-closed and
 * non-destructive: nothing writes on read, so the row survives untouched for a
 * migration to repair. (Serving such a room as `abandoned` with `game: null`
 * would be friendlier, but apps/web's GameClient casts the bootstrap to
 * GameBootstrap and would fault on the missing `publicProjection`, whereas both
 * clients already handle a 404.)
 *
 * @param storedRevision the row's own `revision` column, which wins over the
 * revision inside the blob because it is the value the conditional UPDATE in
 * `save()` compares against. Pass `null` when there is no separate column.
 */
export function fromRoomSnapshot(
  value: unknown,
  storedRevision: number | null,
): StoredRoom | null {
  const record = asRecord(value);
  if (record === null) return unreadable(null, "the persisted projection is not an object");

  const id = asString(record["id"]);
  if (id === null) return unreadable(null, "it carries no room id");
  const code = asString(record["code"]);
  if (code === null) return unreadable(id, "it carries no room code");
  const hostId = asString(record["hostId"]);
  if (hostId === null) return unreadable(id, "it carries no host id");

  const game = normalizeGame(record["game"]);
  if (!game.ok) {
    return unreadable(id, `this engine cannot read its canonical game (${game.reason})`);
  }

  const memberIds = normalizeMemberIds(record["memberIds"]);
  return {
    id,
    code,
    hostId: createStableId("PlayerId", hostId),
    memberIds,
    memberNames: normalizeMemberNames(record["memberNames"]),
    memberAvatars: normalizeMemberAvatars(record["memberAvatars"], memberIds),
    memberCharacters: normalizeMemberCharacters(record["memberCharacters"], memberIds),
    modeId: normalizeMode(record["modeId"]),
    capacity: normalizeCapacity(record["capacity"], memberIds.length),
    status: normalizeStatus(record["status"], game.value),
    revision: storedRevision ?? asIndex(record["revision"]) ?? 0,
    createdAt: asString(record["createdAt"]) ?? UNKNOWN_CREATED_AT,
    game: game.value,
    eventSummaries: normalizeEventSummaries(record["eventSummaries"]),
    bots: normalizeBots(record["bots"], memberIds),
    turnTimer: normalizeTurnTimer(record["turnTimer"], memberIds),
  } satisfies StoredRoom;
}

function unreadable(id: string | null, reason: string): null {
  // Discarding a persisted room is as destructive as this layer gets: to every
  // caller it is indistinguishable from "no such room", so the reason has to
  // live somewhere.
  log("error", "room.snapshot-unreadable", { room: id, reason });
  return null;
}

type GameNormalization =
  | { readonly ok: true; readonly value: GameState | null }
  | { readonly ok: false; readonly reason: string };

function normalizeGame(value: unknown): GameNormalization {
  if (value === null || value === undefined) return { ok: true, value: null };
  try {
    // deserializeGameState is the read half of the engine's contract: it
    // re-checks every invariant assertGameState knows about, so a snapshot the
    // engine would refuse never reaches projectPublicView. The stringify is
    // only because the engine exports a string-taking parser and not a
    // value-taking one (see the report note).
    return { ok: true, value: deserializeGameState(JSON.stringify(value)) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeMemberIds(value: unknown): readonly PlayerId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const memberIds: PlayerId[] = [];
  for (const entry of value) {
    const memberId = asString(entry);
    if (memberId === null || seen.has(memberId)) continue;
    seen.add(memberId);
    memberIds.push(createStableId("PlayerId", memberId));
  }
  return memberIds;
}

function normalizeMemberNames(value: unknown): Readonly<Partial<Record<PlayerId, string>>> {
  const record = asRecord(value);
  if (record === null) return {};
  const names: Partial<Record<PlayerId, string>> = {};
  for (const [memberId, displayName] of Object.entries(record)) {
    const name = asString(displayName);
    if (name === null) continue;
    names[createStableId("PlayerId", memberId)] = name;
  }
  return names;
}

/**
 * Re-validates every persisted avatar through the same parser that admitted it.
 *
 * Belt and braces on purpose: this is the only field in the snapshot that ends up
 * in an `img src`, and the row could have been written by a build whose rules were
 * looser (or by hand). Re-checking on read means the *reader's* rules are the ones
 * that hold, so tightening the allow-list later takes effect for rooms that
 * already exist. Entries for non-members are dropped like ghost bot seats.
 */
function normalizeMemberAvatars(
  value: unknown,
  memberIds: readonly PlayerId[],
): Readonly<Partial<Record<PlayerId, string>>> {
  const record = asRecord(value);
  if (record === null) return {};
  const members = new Set<string>(memberIds);
  const avatars: Partial<Record<PlayerId, string>> = {};
  for (const [memberId, candidate] of Object.entries(record)) {
    if (!members.has(memberId)) continue;
    const avatarUrl = parseAvatarUrl(candidate);
    if (avatarUrl === null) continue;
    avatars[createStableId("PlayerId", memberId)] = avatarUrl;
  }
  return avatars;
}

/**
 * Keeps at most one claim per character, earliest seat first.
 *
 * The service already refuses to store a duplicate, so this is what makes that
 * true of *stored* data rather than only of the code path that writes it: two
 * instances racing two claims through the revision predicate, or a row written
 * before claims existed, must not be able to hand setupFor two players with the
 * same character (which the engine rejects outright as DUPLICATE_CHARACTER_ID,
 * turning one bad claim into a room that can never start).
 */
function normalizeMemberCharacters(
  value: unknown,
  memberIds: readonly PlayerId[],
): Readonly<Partial<Record<PlayerId, string>>> {
  const record = asRecord(value);
  if (record === null) return {};
  const claims: Partial<Record<PlayerId, string>> = {};
  const taken = new Set<string>();
  for (const memberId of memberIds) {
    const characterId = asString(record[memberId]);
    if (characterId === null || taken.has(characterId)) continue;
    taken.add(characterId);
    claims[memberId] = characterId;
  }
  return claims;
}

/**
 * A timer is kept only if it is still self-consistent: a real deadline, a positive
 * duration, and a player who is still a member. Anything else reads as "no timer",
 * which the turn-timeout driver re-arms on its next pass — the fail-safe direction,
 * since a bogus deadline in the past would otherwise take a turn from a player the
 * instant the room was next read.
 */
function normalizeTurnTimer(
  value: unknown,
  memberIds: readonly PlayerId[],
): RoomTurnTimer | null {
  const record = asRecord(value);
  if (record === null) return null;
  const deadlineAt = asString(record["deadlineAt"]);
  const durationMs = asIndex(record["durationMs"]);
  const gameRevision = asIndex(record["gameRevision"]);
  const playerId = asString(record["playerId"]);
  if (deadlineAt === null || durationMs === null || durationMs <= 0) return null;
  if (gameRevision === null || playerId === null) return null;
  if (Number.isNaN(Date.parse(deadlineAt))) return null;
  if (!memberIds.includes(createStableId("PlayerId", playerId))) return null;

  return {
    deadlineAt,
    durationMs,
    gameRevision,
    playerId: createStableId("PlayerId", playerId),
  };
}

function normalizeBots(
  value: unknown,
  memberIds: readonly PlayerId[],
): readonly RoomBotSeat[] {
  if (!Array.isArray(value)) return [];
  const members = new Set<string>(memberIds);
  const seats: RoomBotSeat[] = [];
  for (const entry of value) {
    const seat = asRecord(entry);
    if (seat === null) continue;
    const playerId = asString(seat["playerId"]);
    // A seat for a non-member is a ghost: it would make nextBotSlot skip a slot
    // and isBot disagree with the member list.
    if (playerId === null || !members.has(playerId)) continue;
    const difficulty = seat["difficulty"];
    seats.push({
      playerId: createStableId("PlayerId", playerId),
      // An unrecognized difficulty must not silently demote a bot seat to an
      // undriven "human" one — that wedges the match on the bot's turn.
      difficulty: isBotDifficulty(difficulty) ? difficulty : "standard",
    });
  }
  return seats;
}

/**
 * An unrecognized mode is treated as the default quick mode: the alternative is
 * a room nothing can ever start (the engine answers UNSUPPORTED_MODE), and a
 * game that is already running carries its own modeId in the canonical state.
 */
function normalizeMode(value: unknown): RoomMode {
  return typeof value === "string" && (ROOM_MODES as readonly string[]).includes(value)
    ? (value as RoomMode)
    : "mode.quick";
}

/**
 * An unrecognized capacity becomes the smallest legal capacity that still seats
 * everyone already in the room, so normalization can never evict a member.
 */
function normalizeCapacity(value: unknown, memberCount: number): RoomCapacity {
  if (isRoomCapacity(value)) return value;
  return ROOM_CAPACITIES.find((capacity) => capacity >= memberCount) ?? 6;
}

function normalizeStatus(value: unknown, game: GameState | null): RoomStatus {
  const status =
    typeof value === "string" && (ROOM_STATUSES as readonly string[]).includes(value)
      ? (value as RoomStatus)
      : game === null
        ? "open"
        : "active";
  // A match whose canonical state is gone cannot be resumed, and leaving it
  // "active" would offer rolls that can only answer GAME_NOT_ACTIVE.
  return status === "active" && game === null ? "abandoned" : status;
}

function normalizeEventSummaries(value: unknown): readonly SafeEventSummary[] {
  if (!Array.isArray(value)) return [];
  const summaries: SafeEventSummary[] = [];
  for (const entry of value) {
    const summary = normalizeEventSummary(entry);
    if (summary !== null) summaries.push(summary);
  }
  return appendEventSummaries([], summaries);
}

/**
 * Rebuilds one summary from validated fields, or drops it.
 *
 * Dropping — rather than backfilling — is the honest answer for a DiceRolled
 * summary persisted before `dice`/`total`/`purpose` existed: those faces were
 * never recorded, so any value here would be a fabricated roll shown to players
 * as if it had happened. An empty `dice: []` is no better, because apps/web's
 * dice instrument reads the faces. The event is therefore absent from the
 * activity log instead of lying about it, which the client tolerates: its
 * seen-event set only grows, so an id that never appears is simply never
 * announced.
 *
 * Unknown `type` values are kept as generic summaries on purpose — the client
 * treats "not CardDrawn, not DiceRolled" generically and has no exhaustive
 * switch — so a summary written by a newer build survives a rollback.
 */
function normalizeEventSummary(value: unknown): SafeEventSummary | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record["id"]);
  const type = asString(record["type"]);
  const revision = asIndex(record["revision"]);
  const occurredAt = asString(record["occurredAt"]);
  if (id === null || type === null || revision === null || occurredAt === null) return null;
  const metadata = { id, revision, occurredAt, actorPlayerId: asString(record["actorPlayerId"]) };

  if (type === "DiceRolled") {
    const dice = asFiniteNumbers(record["dice"]);
    const total = asFiniteNumber(record["total"]);
    const purpose = asString(record["purpose"]);
    if (dice === null || dice.length === 0 || total === null || purpose === null) return null;
    return { ...metadata, type, dice, total, purpose };
  }

  if (type === "CardDrawn") {
    const card = asRecord(record["card"]);
    const definitionId = card === null ? null : asString(card["definitionId"]);
    const deckId = card === null ? null : asString(card["deckId"]);
    const nameKey = card === null ? null : asString(card["nameKey"]);
    if (definitionId === null || deckId === null || nameKey === null) return null;
    return { ...metadata, type, card: { definitionId, deckId, nameKey } };
  }

  // The generic variant carries nothing but metadata, so any other type string
  // is structurally one of these; the cast is the only way to say so without
  // duplicating the contract's list of event names here.
  return { ...metadata, type } as SafeEventSummary;
}

function isBotDifficulty(value: unknown): value is BotDifficulty {
  return typeof value === "string" && (BOT_DIFFICULTIES as readonly string[]).includes(value);
}

function isRoomCapacity(value: unknown): value is RoomCapacity {
  return (
    typeof value === "number" && (ROOM_CAPACITIES as readonly number[]).includes(value)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asIndex(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asFiniteNumbers(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
  );
  return numbers.length === value.length ? numbers : null;
}
