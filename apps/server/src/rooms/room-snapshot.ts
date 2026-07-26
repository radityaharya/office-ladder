import {
  BOT_DIFFICULTIES,
  ContractValidationError,
  parseAvatarUrl,
  parseModeRules,
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
  deadlineDashModes,
  deadlineDashRanks,
  type ModeConfig,
  type ModeRules,
} from "@office-ladder/content";
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
 * whatever some older build of this server happened to write. Three hazards
 * follow, and all three are handled here rather than scattered across readers:
 *
 * 1. **Fields added later are simply absent.** `StoredRoom.bots` is the known
 *    case; the DiceRolled event summary gaining required `dice`/`total`/
 *    `purpose` is the newer one. A consumer that narrows on the variant and
 *    reads `.dice` faults on a snapshot written before it existed.
 * 2. **Nothing validated what went in.** The previous implementation persisted
 *    the GameState through `JSON.parse(JSON.stringify(...))`, which silently
 *    drops `undefined`, flattens a Map/Set to `{}`, stringifies a Date and
 *    turns a non-finite number into `null` — corruption with no error.
 * 3. **The canonical GameState has its own schema version, and the engine
 *    refuses any other.** That is the same hazard as (1) but with a harder
 *    edge: `deserializeGameState` does not degrade, it throws, so a state
 *    shape the current engine no longer accepts is a room that cannot be
 *    opened at all. Gameplay v2 (plans/24-gameplay-v2-spec.md §5) adds ten
 *    required collections to `GameState` and four to every `PlayerState`, none
 *    of which exist in any row written before it. See
 *    {@link migrateStateSchema}.
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

  // Resolved before the game, because a legacy state's missing `rules` block is
  // backfilled from a mode preset and the room's own column is the fallback for
  // a state that somehow carries no `modeId` of its own.
  const modeId = normalizeMode(record["modeId"]);
  const game = normalizeGame(record["game"], modeId);
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
    modeId,
    customRules: normalizeCustomRules(record["customRules"]),
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

/**
 * Upgrades a persisted state to this build's schema, then validates it.
 *
 * Order matters and is not interchangeable: the engine accepts exactly one
 * `stateSchemaVersion`, so an older state must be brought forward *before* it is
 * offered for validation. There is deliberately no "try the stored shape too"
 * fallback — that would let a migration which produced a malformed new shape be
 * masked by an older shape that happened to parse.
 *
 * @param roomModeId the room's own mode column, used only to resolve a legacy
 * state's missing `rules` when the state itself carries no usable `modeId`.
 */
function normalizeGame(value: unknown, roomModeId: RoomMode): GameNormalization {
  if (value === null || value === undefined) return { ok: true, value: null };
  return parseGameState(migrateStateSchema(value, roomModeId));
}

function parseGameState(value: unknown): GameNormalization {
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

/* -------------------------------------------------------------------------- *
 * Canonical state schema migration
 * -------------------------------------------------------------------------- */

/**
 * The oldest `stateSchemaVersion` this reader knows how to upgrade, and the
 * version an unreadable `versions` block is assumed to be.
 *
 * Assuming the oldest is safe *only* because every upgrade step preserves any
 * value already present (see {@link upgradeStateV1ToV2}): running a step against
 * a state that had already been upgraded is a no-op, not a reset.
 */
const OLDEST_MIGRATABLE_STATE_SCHEMA_VERSION = 1;

type StateSchemaMigration = {
  /** The version this step consumes. */
  readonly fromVersion: number;
  /** The version this step produces, stamped by the ladder rather than by the step. */
  readonly toVersion: number;
  readonly upgrade: (
    game: Record<string, unknown>,
    rules: ModeRules,
  ) => Record<string, unknown>;
};

/**
 * The upgrade ladder, keyed on the version each step consumes.
 *
 * Version-keyed rather than field-sniffing on purpose: "is `placements`
 * missing?" answers a different question from "was this row written by an older
 * build", and the two diverge the moment a field is added and then removed, or
 * added with a legal empty value. The stored version is the only thing that
 * states the writer's intent.
 *
 * Steps compose, so a state two versions behind is walked through each in turn
 * and adding a v2 → v3 entry is all a later schema change needs. Two rules keep
 * that true: the numbers here are **historical facts** about a shape that once
 * shipped — `toVersion: 2` must stay 2 forever, never track the engine's current
 * version — and the final step's `toVersion` must equal the engine's
 * `GAME_STATE_SCHEMA_VERSION`, or nothing this reader produces will validate.
 * tests/rooms/state-schema-migration.test.ts asserts that last part.
 */
const STATE_SCHEMA_MIGRATIONS: readonly StateSchemaMigration[] = [
  { fromVersion: 1, toVersion: 2, upgrade: upgradeStateV1ToV2 },
];

function migrateStateSchema(value: unknown, roomModeId: RoomMode): unknown {
  const game = asRecord(value);
  if (game === null) return value;

  let current = game;
  // One pass per declared step is enough to walk the whole ladder, and bounds
  // the loop: a step whose `toVersion` pointed backwards could not spin here.
  for (let step = 0; step < STATE_SCHEMA_MIGRATIONS.length; step += 1) {
    const version = storedStateSchemaVersion(current);
    const migration = STATE_SCHEMA_MIGRATIONS.find(
      (candidate) => candidate.fromVersion === version,
    );
    if (migration === undefined) break;
    const rules = resolveModeRules(current["modeId"], roomModeId);
    // Stamping the version here rather than inside the step keeps the two from
    // drifting: a step describes a shape change and nothing else.
    current = withStateSchemaVersion(migration.upgrade(current, rules), migration.toVersion);
  }
  return current;
}

function withStateSchemaVersion(
  game: Record<string, unknown>,
  version: number,
): Record<string, unknown> {
  return {
    ...game,
    versions: { ...(asRecord(game["versions"]) ?? {}), stateSchemaVersion: version },
  };
}

function storedStateSchemaVersion(game: Record<string, unknown>): number {
  const versions = asRecord(game["versions"]);
  const version = versions === null ? null : asIndex(versions["stateSchemaVersion"]);
  return version ?? OLDEST_MIGRATABLE_STATE_SCHEMA_VERSION;
}

/**
 * The `ModeRules` a state that predates them should be read with.
 *
 * The state's own `modeId` wins over the room's column, because a running match
 * carries the mode it was actually started with. An id no content pack knows
 * falls back to the room's, then to `mode.quick` — the same choice
 * {@link normalizeMode} makes, and for the same reason: a room whose rules could
 * not be resolved would be a room nothing can ever read.
 *
 * Note this is a *backfill*, not a re-resolution. `GameState.rules` is
 * snapshotted at `game.start` and frozen for the match precisely so a content
 * edit cannot change a game in flight; a pre-v2 state has no snapshot to honour,
 * so the preset its `modeId` names is the closest thing to the ruleset it was
 * played under. Once a state carries `rules`, that value is preserved verbatim.
 */
function resolveModeRules(modeId: unknown, fallbackModeId: RoomMode): ModeRules {
  const presets: Readonly<Partial<Record<string, ModeConfig>>> = deadlineDashModes;
  const preset =
    (typeof modeId === "string" ? presets[modeId] : undefined) ?? presets[fallbackModeId];
  return (preset ?? deadlineDashModes["mode.quick"]).rules;
}

/**
 * Gameplay v2: every collection in spec §5.9, plus §5.3/§5.4 per player.
 *
 * Additive and idempotent — every field keeps a value that is already there and
 * only defaults an absent one. That is what makes it safe to run this against a
 * state whose version could not be read, and it means a partially-migrated row
 * (one written by a build that had some of these fields but not others) is
 * completed rather than flattened.
 */
function upgradeStateV1ToV2(
  game: Record<string, unknown>,
  rules: ModeRules,
): Record<string, unknown> {
  const round = asIndex(asRecord(game["turn"])?.["round"]) ?? 0;
  return {
    ...game,
    rules: asRecord(game["rules"]) ?? rules,
    tileOwnership: asRecord(game["tileOwnership"]) ?? {},
    placements: asArray(game["placements"]) ?? [],
    projects: asArray(game["projects"]) ?? [],
    agreements: asArray(game["agreements"]) ?? [],
    objectives: asArray(game["objectives"]) ?? [],
    ballots: asArray(game["ballots"]) ?? [],
    quarters: asArray(game["quarters"]) ?? [],
    // No quarter was ever opened, so the match is still inside the first one.
    // Nothing schedules a global event retroactively for the quarters a legacy
    // match already played through — `quarters` stays empty rather than being
    // back-dated with events that never resolved.
    currentQuarterIndex: asIndex(game["currentQuarterIndex"]) ?? 0,
    eliminatedPlayerIds: asArray(game["eliminatedPlayerIds"]) ?? [],
    outcome: upgradeOutcomeV1ToV2(game["outcome"]),
    players: upgradePlayersV1ToV2(game["players"], rules, round),
  };
}

/**
 * `MatchOutcome` gains `scores` and `winPath` (spec §5.6).
 *
 * A match that ended before scoring existed has no per-player breakdown to
 * reconstruct, so `scores` is empty rather than invented — a fabricated
 * breakdown would be shown to players on the winner screen as if it had been
 * computed. `winPath` is only filled in for `director-reached`, where it is a
 * rename rather than an inference: reaching Director *is* the promotion path.
 * Every other v1 end reason is left null, because which path a
 * `marathon-scored` win came down is exactly what the missing breakdown would
 * have said.
 */
function upgradeOutcomeV1ToV2(value: unknown): unknown {
  const outcome = asRecord(value);
  if (outcome === null) return value;
  return {
    ...outcome,
    scores: asArray(outcome["scores"]) ?? [],
    winPath:
      asString(outcome["winPath"]) ??
      (outcome["reason"] === "director-reached" ? "promotion" : null),
  };
}

function upgradePlayersV1ToV2(
  value: unknown,
  rules: ModeRules,
  round: number,
): unknown {
  const players = asRecord(value);
  // Handing the original back keeps the engine's own "players must be an object"
  // message, instead of replacing it with a downstream complaint about
  // playerOrder not matching an empty map.
  if (players === null) return value;
  const upgraded: Record<string, unknown> = {};
  for (const [playerId, playerValue] of Object.entries(players)) {
    const player = asRecord(playerValue);
    upgraded[playerId] =
      player === null ? playerValue : upgradePlayerV1ToV2(player, rules, round);
  }
  return upgraded;
}

function upgradePlayerV1ToV2(
  player: Record<string, unknown>,
  rules: ModeRules,
  round: number,
): Record<string, unknown> {
  return {
    ...player,
    upkeep: asRecord(player["upkeep"]) ?? {
      perRound: legacyUpkeepPerRound(player, rules),
      // Charged from where the match actually is, not from round 0. A legacy
      // game read back on round 30 must not wake up owing thirty rounds of
      // arrears it was never given the chance to pay.
      lastChargedRound: round,
      missedPayments: 0,
    },
    loans: asArray(player["loans"]) ?? [],
    incomeStreams: asArray(player["incomeStreams"]) ?? [],
    heat: asRecord(player["heat"]) ?? {
      value: 0,
      // From config, not a constant: the threshold is a mode tunable, and a mode
      // with heat switched off legitimately publishes 0.
      threshold: rules.conflict.heatThreshold,
      investigationsOpened: 0,
      lastIncrementedAtRound: null,
    },
  };
}

/**
 * Upkeep is charged by rank, so a mid-match player already at supervisor owes a
 * supervisor's rate from the moment the match is read — not an intern's.
 */
function legacyUpkeepPerRound(
  player: Record<string, unknown>,
  rules: ModeRules,
): number {
  if (!rules.economy.upkeepEnabled) return 0;
  const rankIndex = asIndex(asRecord(player["rank"])?.["index"]) ?? 0;
  return rules.economy.upkeepByRankIndex[rankIndex] ?? 0;
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
 * Re-validates a persisted lobby-authored ruleset through the same parser that
 * admitted it, for the same reason {@link normalizeMemberAvatars} does.
 *
 * This one is the sharper case: a `ModeRules` blob is the only persisted field
 * that becomes *rules the engine enforces*, and it originally arrived from a
 * browser. A row written by a build whose bounds were looser — or edited by hand
 * — would otherwise be snapshotted straight into `GameState.rules` at the next
 * `game.start`. Re-checking on read means the reader's bounds are the ones that
 * hold, so a bound tightened later takes effect for rooms that already exist.
 *
 * A ruleset that no longer validates is dropped rather than repaired: the room
 * falls back to its mode preset, which is a ruleset every player can still be
 * shown, whereas a partially-repaired one is a ruleset nobody ever agreed to.
 */
function normalizeCustomRules(value: unknown): ModeRules | null {
  if (value === null || value === undefined) return null;
  try {
    return parseModeRules(value, { rankLadderLength: deadlineDashRanks.length });
  } catch (error) {
    if (error instanceof ContractValidationError) {
      log("warn", "room.snapshot-custom-rules-rejected", { reason: error.message });
      return null;
    }
    throw error;
  }
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

/**
 * Entries are left as `unknown` on purpose: the migration only ever carries a
 * collection through untouched, and `deserializeGameState` is what decides
 * whether its contents are legal.
 */
function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
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
