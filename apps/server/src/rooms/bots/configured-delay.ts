import { log } from "@/observability/log";
import { parseBotTurnDelayMs } from "./turn-delay";

/**
 * The process-wide bot pacing delay, resolved once from `BOT_TURN_DELAY_MS`.
 *
 * A single module-level constant, for the same reason
 * turn-timer/configured-timeout.ts is one: re-reading the environment per turn
 * could change the pacing halfway through a match, and one process answering "how
 * long is a bot's pause" two different ways is how a room ends up with a rhythm
 * nobody chose.
 */
function resolveBotTurnDelayMs(): number {
  const configured = parseBotTurnDelayMs(process.env.BOT_TURN_DELAY_MS);
  if (configured.ok) return configured.delayMs;

  // Silently falling back makes a typo'd delay indistinguishable from an unset
  // one, and bot pacing is exactly the kind of thing somebody tunes and then
  // wonders why nothing changed. `0` is the supported way to switch it off.
  log("warn", "bots.turn-delay-invalid", {
    configured: process.env.BOT_TURN_DELAY_MS ?? null,
    fallbackMs: configured.fallbackMs,
  });
  return configured.fallbackMs;
}

export const BOT_TURN_DELAY_MS = resolveBotTurnDelayMs();
