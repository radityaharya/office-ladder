import { publishProjectionUpdate } from "@/realtime/publish-projection-update";
import { roomRepository, roomService } from "@/rooms/default-service";
import { createBotDriver } from "./bot-driver";
import { logBotDriverEvent } from "./bot-driver-log";
import { BOT_TURN_DELAY_MS } from "./configured-delay";

/**
 * The process-wide bot driver. Its state is only the in-flight drain map, so a
 * restart loses nothing permanent: any bootstrap read of the room re-kicks a
 * stalled bot turn (see routes/rooms.ts's GET handler).
 *
 * The pacing budget itself — how long each bot pauses, and why that number is
 * what it is — lives in turn-delay.ts, which is pure and therefore testable;
 * nothing in this module can be, because it transitively loads packages/db.
 */
export const botDriver = createBotDriver({
  roomService,
  repository: roomRepository,
  delayMs: BOT_TURN_DELAY_MS,
  publish: publishProjectionUpdate,
  onEvent: logBotDriverEvent,
});
