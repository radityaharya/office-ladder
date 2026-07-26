import { log } from "@/observability/log";
import { isBotTurnDelayConfigured, parseBotTurnDelayMs } from "./turn-delay";

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

/**
 * The same number, but `null` when nothing was configured.
 *
 * This is what the driver actually passes to {@link botThinkMs}: an unset
 * variable hands pacing to the room's own `ModeRules.bots.thinkMsRange`, while a
 * set one — `0` included — overrides every mode on this deployment. Exported
 * beside {@link BOT_TURN_DELAY_MS} rather than replacing it because the flat
 * value is still the right answer for anything that just wants "how long is a
 * bot pause here" without a room in hand.
 */
export const BOT_TURN_DELAY_OVERRIDE_MS: number | null = isBotTurnDelayConfigured(
  process.env.BOT_TURN_DELAY_MS,
)
  ? BOT_TURN_DELAY_MS
  : null;
