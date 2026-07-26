import { publishProjectionUpdate } from "@/realtime/publish-projection-update";
import { botDriver } from "@/rooms/bots/default-driver";
import { roomRepository, roomService } from "@/rooms/default-service";
import { TURN_TIMEOUT_MS } from "./configured-timeout";
import { createTurnTimeoutDriver } from "./turn-timeout-driver";
import { logTurnTimeoutEvent } from "./turn-timeout-log";

/**
 * The process-wide turn-timeout driver.
 *
 * Depends on the bot driver and not the other way round, which is what keeps the
 * module graph acyclic: a timeout that hands the turn to a bot awaits the bot
 * drain here, while a bot turn that hands back to a human is picked up by the
 * next kick from the routes or the bootstrap read. Its only state is the pending
 * wakeup per room, so a restart loses nothing permanent — any bootstrap read of
 * the room re-arms it (see routes/rooms.ts's GET handler).
 */
export const turnTimeoutDriver = createTurnTimeoutDriver({
  roomService,
  repository: roomRepository,
  now: () => new Date().toISOString(),
  timeoutMs: TURN_TIMEOUT_MS,
  publish: publishProjectionUpdate,
  driveBots: (roomId) => botDriver.drive(roomId),
  setTimer: (callback, delayMs) => {
    const handle: unknown = setTimeout(callback, delayMs);
    // A pending turn clock must not be a reason the process refuses to exit.
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
  onEvent: logTurnTimeoutEvent,
});
