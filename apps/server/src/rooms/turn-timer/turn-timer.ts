import type { PlayerId } from "@office-ladder/engine";
import { isBotMember } from "@/rooms/bots/bot-seats";
import type { RoomTurnTimer, StoredRoom } from "@/rooms/service/types";

/**
 * The rules of the turn clock, as pure functions over a room and an instant.
 *
 * Nothing here reads the wall clock, the environment or the repository: the
 * caller supplies "now" (the room service's single `now()` dependency) and the
 * configured budget, so every rule below is assertable in a test even though this
 * sandbox cannot boot the server.
 */

/** One minute. Long enough to read the board, short enough to keep a table moving. */
export const DEFAULT_TURN_TIMEOUT_MS = 60_000;

/**
 * Guards against a configuration that would fire the clock faster than a human
 * can act. Below this a timer is not a timer, it is a way to lose your turn.
 */
export const MINIMUM_TURN_TIMEOUT_MS = 5_000;

export const TURN_TIMEOUT_DISABLED_MS = 0;

export type TurnTimeoutConfigResult =
  | { readonly ok: true; readonly timeoutMs: number }
  | {
      readonly ok: false;
      readonly error: { readonly code: "INVALID_TURN_TIMEOUT" };
      /** What to use anyway — a bad knob must not take the server down. */
      readonly fallbackMs: number;
    };

/**
 * Reads `TURN_TIMEOUT_SECONDS`.
 *
 * `0` disables the clock and is a first-class configuration: the person running
 * this may well not want a timer at all, and "off" must not require a code
 * change. An unset variable takes {@link DEFAULT_TURN_TIMEOUT_MS}, because the
 * feature was asked for and a silent default of "off" would look like the feature
 * simply not working.
 *
 * Anything else — a negative number, a non-number, a value under
 * {@link MINIMUM_TURN_TIMEOUT_MS} — is reported rather than quietly rounded:
 * somebody tuning a knob and getting the default back with no explanation is the
 * failure mode the sibling `BOT_TURN_DELAY_MS` check exists to avoid.
 */
export function parseTurnTimeoutSeconds(configured: string | undefined): TurnTimeoutConfigResult {
  if (configured === undefined || configured.trim().length === 0) {
    return { ok: true, timeoutMs: DEFAULT_TURN_TIMEOUT_MS };
  }

  const seconds = Number(configured.trim());
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || seconds < 0) {
    return {
      ok: false,
      error: { code: "INVALID_TURN_TIMEOUT" },
      fallbackMs: DEFAULT_TURN_TIMEOUT_MS,
    };
  }
  if (seconds === 0) return { ok: true, timeoutMs: TURN_TIMEOUT_DISABLED_MS };

  const timeoutMs = seconds * 1000;
  if (timeoutMs < MINIMUM_TURN_TIMEOUT_MS) {
    return {
      ok: false,
      error: { code: "INVALID_TURN_TIMEOUT" },
      fallbackMs: MINIMUM_TURN_TIMEOUT_MS,
    };
  }

  return { ok: true, timeoutMs };
}

/**
 * Who the clock is currently waiting on, or `null` when nobody.
 *
 * A bot on turn is deliberately *not* on a clock. The bot driver already commits
 * its turns within its own pacing delay, so a second server-side actor aimed at
 * the same seat would be two mechanisms racing for one command with nothing to
 * gain — and a countdown rendered over a bot's turn tells a human nothing they
 * can act on.
 */
export function playerOnTheClock(room: StoredRoom): PlayerId | null {
  if (room.status !== "active" || room.game === null) return null;
  if (room.game.status !== "active") return null;
  const activePlayerId = room.game.turn.activePlayerId;
  if (activePlayerId === null) return null;
  return isBotMember(room, activePlayerId) ? null : activePlayerId;
}

export type NextTurnTimerInput = {
  readonly room: StoredRoom;
  /** ISO-8601, from the room service's `now()`. */
  readonly nowIso: string;
  readonly timeoutMs: number;
};

/**
 * The timer a room *should* be carrying, computed from its current state.
 *
 * Called on every committed game mutation, so it has to be idempotent in the one
 * way that matters: a timer already armed for this exact (game revision, player)
 * pair is returned unchanged. Re-arming it would let a write that does not
 * advance the turn quietly extend somebody's deadline, which is the difference
 * between a clock and a suggestion.
 */
export function nextTurnTimer(input: NextTurnTimerInput): RoomTurnTimer | null {
  const { room, nowIso, timeoutMs } = input;
  if (timeoutMs <= TURN_TIMEOUT_DISABLED_MS) return null;

  const playerId = playerOnTheClock(room);
  const game = room.game;
  if (playerId === null || game === null) return null;

  const existing = room.turnTimer;
  if (
    existing !== null &&
    existing.gameRevision === game.revision &&
    existing.playerId === playerId &&
    existing.durationMs === timeoutMs
  ) {
    return existing;
  }

  const nowMs = Date.parse(nowIso);
  // The only caller is our own `now()`, so this is a programming error rather
  // than untrusted input; answering "no timer" keeps a committed command from
  // failing over a clock it does not depend on.
  if (Number.isNaN(nowMs)) return null;

  return {
    deadlineAt: new Date(nowMs + timeoutMs).toISOString(),
    durationMs: timeoutMs,
    gameRevision: game.revision,
    playerId,
  };
}

/** Whether a stored timer is the one this room's current state should carry. */
export function isTurnTimerCurrent(room: StoredRoom, timer: RoomTurnTimer | null): boolean {
  if (timer === null) return false;
  const playerId = playerOnTheClock(room);
  return (
    playerId !== null &&
    timer.playerId === playerId &&
    timer.gameRevision === room.game?.revision
  );
}

/**
 * Milliseconds left, floored at zero; `null` when the deadline is unreadable.
 * A timer whose deadline cannot be parsed is treated as *not* expired, so a
 * corrupt value can never cause a turn to be taken from a player.
 */
export function remainingTurnTimerMs(
  timer: RoomTurnTimer,
  nowIso: string,
): number | null {
  const deadlineMs = Date.parse(timer.deadlineAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(deadlineMs) || Number.isNaN(nowMs)) return null;
  return Math.max(0, deadlineMs - nowMs);
}

export function isTurnTimerExpired(timer: RoomTurnTimer, nowIso: string): boolean {
  const remaining = remainingTurnTimerMs(timer, nowIso);
  return remaining !== null && remaining <= 0;
}
