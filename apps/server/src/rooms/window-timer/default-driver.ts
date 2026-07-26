import { publishProjectionUpdate } from "@/realtime/publish-projection-update";
import { botDriver } from "@/rooms/bots/default-driver";
import { roomRepository, roomService } from "@/rooms/default-service";
import { TURN_TIMEOUT_MS } from "@/rooms/turn-timer/configured-timeout";
import { turnTimeoutDriver } from "@/rooms/turn-timer/default-driver";
import { createWindowExpiryDriver } from "./window-expiry-driver";
import { logWindowExpiryEvent } from "./window-expiry-log";

/**
 * The process-wide window-expiry driver (spec §7.1).
 *
 * Depends on the bot and turn-timeout drivers and not the other way round, which
 * is what keeps the module graph acyclic. Its only state is the pending wakeup
 * per room, so a restart loses nothing permanent: any route mutation or
 * bootstrap read that kicks it re-scans, and anything already overdue resolves on
 * that first pass.
 *
 * `turnClockEnabled` is the one thing here that is not read from the mode rules,
 * and deliberately so. Every *duration* comes from `ModeRules` —
 * `interaction.reactionWindowSeconds` (which the engine has already applied by
 * the time a deadline reaches this driver) and `timers.turnSeconds` — but
 * whether a deployment runs a turn clock at all is an operator decision that
 * `TURN_TIMEOUT_SECONDS=0` already expresses, and honouring it here is what stops
 * this driver from quietly re-enabling a clock somebody switched off.
 */
export const windowExpiryDriver = createWindowExpiryDriver({
  repository: roomRepository,
  roomService,
  now: () => new Date().toISOString(),
  turnClockEnabled: TURN_TIMEOUT_MS > 0,
  publish: publishProjectionUpdate,
  setTimer: (callback, delayMs) => {
    const handle: unknown = setTimeout(callback, delayMs);
    // A pending reaction window must not be a reason the process refuses to exit.
    // Bun and Node both return a Timeout with unref(); nothing else is assumed.
    if (
      typeof handle === "object" &&
      handle !== null &&
      "unref" in handle &&
      typeof handle.unref === "function"
    ) {
      handle.unref();
    }
    return () => {
      clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
    };
  },
  // A closed window can hand the turn to a bot, and a timed-out turn can hand it
  // to a human whose own clock now needs arming. Neither driver watches this one,
  // so the hand-off is explicit.
  onCommitted: (roomId) => {
    botDriver.schedule(roomId);
    turnTimeoutDriver.schedule(roomId);
  },
  onEvent: logWindowExpiryEvent,
});
