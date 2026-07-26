import { publishProjectionUpdate } from "@/realtime/publish-projection-update";
import { roomRepository, roomService } from "@/rooms/default-service";
import { TURN_TIMEOUT_MS } from "@/rooms/turn-timer/configured-timeout";
import { createBotCommandSubmitter } from "./bot-command-submitter";
import { createBotDriver } from "./bot-driver";
import { logBotDriverEvent } from "./bot-driver-log";
import { publishBotThinking } from "./publish-bot-thinking";
import { BOT_TURN_DELAY_OVERRIDE_MS } from "./configured-delay";

/**
 * The process-wide bot driver. Its state is only the in-flight drain map, so a
 * restart loses nothing permanent: any bootstrap read of the room re-kicks a
 * stalled bot turn (see routes/rooms.ts's GET handler).
 *
 * Everything decidable lives elsewhere and is therefore testable, because nothing
 * in this module can be — it transitively loads packages/db. The pacing rules are
 * in turn-delay.ts and think-time.ts, the ladder is in bot-policy.ts, the
 * transport is in bot-command-submitter.ts, and the "is a bot thinking" beat is
 * in bot-chat.ts.
 */
export const botDriver = createBotDriver({
  repository: roomRepository,
  submit: createBotCommandSubmitter({
    roomService,
    repository: roomRepository,
    now: () => new Date().toISOString(),
    // The same constant the room service arms deadlines with. Two different
    // answers to "how long is a turn" would have a bot's command clear a clock
    // the service had just set, or set one nobody enforces.
    turnTimeoutMs: TURN_TIMEOUT_MS,
  }),
  configuredDelayMs: BOT_TURN_DELAY_OVERRIDE_MS,
  publish: publishProjectionUpdate,
  onEvent: (event) => {
    logBotDriverEvent(event);
    // Deliberately after the log, and non-blocking: a bot's thinking beat is
    // decoration on a decision that is about to commit either way, so a broadcast
    // failure must not delay or abort the command behind it.
    publishBotThinking(event);
  },
});
