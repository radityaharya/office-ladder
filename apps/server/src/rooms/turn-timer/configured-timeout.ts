import { log } from "@/observability/log";
import { parseTurnTimeoutSeconds } from "./turn-timer";

/**
 * The process-wide turn timeout, resolved once from `TURN_TIMEOUT_SECONDS`.
 *
 * Shared by the room service (which arms deadlines) and the timeout driver (which
 * enforces them), because two different answers to "how long is a turn" would arm
 * a clock nobody enforces or enforce one nobody armed. A single module-level
 * constant is also what makes the value stable for the life of the process:
 * re-reading the environment per turn could shorten a deadline that a player is
 * already counting down.
 */
function resolveTurnTimeoutMs(): number {
  const configured = parseTurnTimeoutSeconds(process.env.TURN_TIMEOUT_SECONDS);
  if (configured.ok) return configured.timeoutMs;

  // Silently falling back would make a typo'd timeout indistinguishable from an
  // unset one, and a turn timer is exactly the kind of thing somebody tunes and
  // then wonders why nothing changed. `0` is the supported way to switch it off.
  log("warn", "turn-timer.timeout-invalid", {
    configured: process.env.TURN_TIMEOUT_SECONDS ?? null,
    fallbackMs: configured.fallbackMs,
  });
  return configured.fallbackMs;
}

export const TURN_TIMEOUT_MS = resolveTurnTimeoutMs();
