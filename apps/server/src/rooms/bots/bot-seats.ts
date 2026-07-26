import type { BotDifficulty } from "@office-ladder/contracts";
import { createStableId, type PlayerId } from "@office-ladder/engine";
import type { RoomBotSeat, StoredRoom } from "@/rooms/service/types";

/**
 * Dry contractor/temp job titles rather than robot names: a bot seat should
 * read as another line item on the org chart, matching DESIGN.md's "in-game
 * corporate management terminal" tone. Indexed by bot slot, so the same slot
 * always gets the same title.
 */
const BOT_DISPLAY_NAMES = [
  "Temp Analyst",
  "Contract Auditor",
  "Agency Consultant",
  "Interim Coordinator",
  "Seconded Associate",
  "Relief Administrator",
] as const;

/**
 * Rooms created before a field existed round-trip out of
 * room_projections.projection with no key for it at all, so the declared
 * StoredRoom type lies about them. Every read boundary (both repositories and
 * the room service) funnels through here, which is cheap and idempotent.
 *
 * Covers every field added to StoredRoom without a migration, not just `bots`:
 * three more have been added since (`memberAvatars`, `memberCharacters`,
 * `turnTimer`) and their consumers dereference without a guard —
 * `projections.ts` reads `room.memberAvatars[memberId]`, and both
 * `nextTurnTimer` and `isTurnTimerCurrent` test `!== null` and then read a
 * property, which `undefined` passes. `nextTurnTimer` runs inside *every*
 * committed game mutation, so an unnormalized room does not degrade — it throws
 * on every roll.
 *
 * rooms/room-snapshot.ts rebuilds all of these properly on the way out of
 * storage, and it validates rather than merely defaulting, so it stays the real
 * boundary. This is the cheap idempotent backstop for a StoredRoom that reached
 * the service some other way, which is exactly what the doc above promises.
 */
export function normalizeStoredRoom(room: StoredRoom): StoredRoom {
  const bots: readonly RoomBotSeat[] | undefined = room.bots;
  const avatars: StoredRoom["memberAvatars"] | undefined = room.memberAvatars;
  const characters: StoredRoom["memberCharacters"] | undefined = room.memberCharacters;
  const turnTimer: StoredRoom["turnTimer"] | undefined = room.turnTimer;
  if (
    Array.isArray(bots) &&
    avatars !== undefined &&
    characters !== undefined &&
    turnTimer !== undefined
  ) {
    return room;
  }

  return {
    ...room,
    bots: Array.isArray(bots) ? bots : [],
    memberAvatars: avatars ?? {},
    memberCharacters: characters ?? {},
    // `null` and a missing key mean the same thing — no deadline — and the
    // timeout driver arms a fresh one on its next pass.
    turnTimer: turnTimer ?? null,
  };
}

export function botSeats(room: StoredRoom): readonly RoomBotSeat[] {
  const bots: readonly RoomBotSeat[] | undefined = room.bots;
  return Array.isArray(bots) ? bots : [];
}

/** The bot seat for a member, or null when that member is a human. */
export function botSeatFor(room: StoredRoom, playerId: PlayerId): RoomBotSeat | null {
  return botSeats(room).find((seat) => seat.playerId === playerId) ?? null;
}

export function isBotMember(room: StoredRoom, playerId: PlayerId): boolean {
  return botSeatFor(room, playerId) !== null;
}

export function humanMemberIds(room: StoredRoom): readonly PlayerId[] {
  return room.memberIds.filter((memberId) => !isBotMember(room, memberId));
}

/**
 * `bot:${roomId}:${slot}` — every character is inside contracts' ID_PATTERN
 * (`:` and `-` are both allowed), and because createStableId is an identity
 * passthrough this string is simultaneously the raw actorId callers pass to
 * RoomService and the PlayerId the engine stores.
 */
export function botPlayerId(roomId: string, slot: number): PlayerId {
  return createStableId("PlayerId", `bot:${roomId}:${slot}`);
}

/** The smallest non-negative slot not already taken by a bot in this room. */
export function nextBotSlot(room: StoredRoom): number {
  const taken = new Set(botSeats(room).map((seat) => seat.playerId));
  for (let slot = 0; slot < room.memberIds.length + 1; slot += 1) {
    if (!taken.has(botPlayerId(room.id, slot))) return slot;
  }
  return room.memberIds.length + 1;
}

/** A dry job title for the slot, suffixed only if a member already uses it. */
export function botDisplayName(room: StoredRoom, slot: number): string {
  const taken = new Set(Object.values(room.memberNames));
  const base = BOT_DISPLAY_NAMES[slot % BOT_DISPLAY_NAMES.length] ?? "Temp Analyst";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= taken.size + 2; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${slot + 1}`;
}

export function botDifficultyFor(
  room: StoredRoom,
  playerId: PlayerId,
): BotDifficulty | null {
  return botSeatFor(room, playerId)?.difficulty ?? null;
}
