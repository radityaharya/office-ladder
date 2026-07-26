import type { ModeRules } from "@office-ladder/engine";
import { MAXIMUM_BOT_TURN_DELAY_MS } from "./turn-delay";

/**
 * How long a bot pauses before each command, and what a watcher is shown while
 * it does.
 *
 * ### The complaint this answers
 *
 * "The bots stuff is too instantaneous, I genuinely can't follow the game." The
 * previous pacing was a single process-wide `BOT_TURN_DELAY_MS` — one number for
 * every room, every mode and every kind of decision. Two things were wrong with
 * it and only one of them was the number:
 *
 * 1. **It ignored the mode.** `ModeRules.bots` carries `pacing` and
 *    `thinkMsRange` precisely so a twenty-minute quick match and a two-hour
 *    campaign can breathe differently, and nothing read them. A custom ruleset
 *    (§8.4) could set them and see no effect at all.
 * 2. **It was silent.** A pause with no signal is indistinguishable from a
 *    server that has stopped answering, which is the worse failure: a player
 *    waiting on a frozen game reloads, and a player watching a bot think does
 *    not. The delay is now paired with a "thinking" beat the room actually
 *    receives — see `bot-chat.ts` — so the pause *reads* as a decision.
 *
 * ### Determinism
 *
 * The duration is a pure function of the mode's range and a seed the caller
 * derives from state (game id, revision, seat). No `Math.random`: two servers
 * replaying the same match pace it identically, and a test can assert the exact
 * millisecond value rather than a range.
 */

/** `bots.pacing: "instant"` — no pause at all. Supported, not degraded. */
export const INSTANT_THINK_MS = 0;

export type BotThinkTimeInput = {
  readonly rules: ModeRules;
  /**
   * The process-wide `BOT_TURN_DELAY_MS`, or `null` when it was never
   * configured. An explicit `0` still means "switch pacing off", which is why
   * this is nullable rather than defaulted — see {@link botThinkMs}.
   */
  readonly configuredDelayMs: number | null;
  /**
   * Any stable string derived from the state being acted on. The driver uses the
   * command id, which is already `bot:<gameId>:<revision>:<slug>` — so the same
   * turn always thinks for the same length of time, and two different bots in
   * one chain do not.
   */
  readonly seed: string;
};

/**
 * FNV-1a. Small, dependency-free and well spread over short ASCII keys, which is
 * all this needs: the value picks a point inside a two-element range, and a
 * biased hash would only make some turns slightly more common than others.
 */
function hash(seed: string): number {
  let value = 0x81_1c_9d_c5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01_00_01_93) >>> 0;
  }

  return value >>> 0;
}

/**
 * The mode's `[min, max]`, repaired rather than trusted.
 *
 * `ModeRules` can come from a lobby-authored custom ruleset (§8.4), and although
 * contracts bounds it on the way in, this is the last place before a `setTimeout`
 * — an inverted range, a negative floor or a `NaN` here is a hung room, so the
 * range is clamped into something usable instead of being believed.
 */
function usableRange(rules: ModeRules): readonly [number, number] {
  const [rawMin, rawMax] = rules.bots.thinkMsRange;
  const min = Number.isFinite(rawMin) ? Math.max(0, Math.floor(rawMin)) : 0;
  const max = Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : 0;
  const low = Math.min(min, max);
  const high = Math.max(min, max);

  return [
    Math.min(low, MAXIMUM_BOT_TURN_DELAY_MS),
    Math.min(high, MAXIMUM_BOT_TURN_DELAY_MS),
  ];
}

/**
 * The pause before one bot command.
 *
 * Resolution order, and why:
 *
 * 1. **`bots.pacing: "instant"` wins outright.** It is the mode saying "do not
 *    pace these bots", and a deployment-wide delay must not override a rule the
 *    room is being played under.
 * 2. **An explicitly configured `BOT_TURN_DELAY_MS` wins next**, including `0`.
 *    It is the operator's override — a load test, or a local loop somebody wants
 *    fast — and an override that the mode could quietly ignore is not one.
 * 3. **Otherwise the mode's own range**, sampled deterministically from `seed`.
 *
 * The result is always clamped to {@link MAXIMUM_BOT_TURN_DELAY_MS}: the pause
 * is taken inside the driver's per-room drain slot, and the turn-timeout driver
 * awaits that slot, so an unbounded value parks two server-side actors for the
 * whole bot chain.
 */
export function botThinkMs(input: BotThinkTimeInput): number {
  if (input.rules.bots.pacing === "instant") return INSTANT_THINK_MS;
  if (input.configuredDelayMs !== null) {
    return Math.min(Math.max(0, input.configuredDelayMs), MAXIMUM_BOT_TURN_DELAY_MS);
  }

  const [low, high] = usableRange(input.rules);
  if (high <= low) return low;

  // Inclusive of both ends: the span is `high - low + 1` wide, so a range of
  // [400, 1200] can produce 400 and 1200 rather than everything strictly between.
  return low + (hash(input.seed) % (high - low + 1));
}
