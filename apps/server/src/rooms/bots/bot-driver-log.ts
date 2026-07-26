import { describeError, log, type LogContext, type LogLevel } from "@/observability/log";
import {
  isBotDrainDefect,
  type BotDrainStop,
  type BotDriverEvent,
} from "./bot-driver";

/**
 * How the bot driver's events are logged.
 *
 * Kept out of default-driver.ts on purpose: default-driver.ts transitively
 * imports the Postgres repository (and therefore packages/db, which throws at
 * module load without DATABASE_URL), so nothing there can be unit-tested. This
 * module imports only types and the pure log formatter, so the severity rules
 * below — the part that actually decides whether a wedged match is visible — are
 * provable.
 */

/**
 * Severity of a finished drain.
 *
 * The distinction the audit asked for: a bot that *cannot decide* is a defect
 * (nobody's turn will ever come again, and no amount of polling fixes it), while
 * a drain that stopped because it is now a human's turn is the driver working
 * correctly. Both used to be the same silent `return`.
 *
 * `actions` is what keeps this quiet: the GET bootstrap path re-kicks a drain
 * every ~5s per connected client, and almost all of those find a human on turn
 * and do nothing. Those land at `debug`. The same benign stop *after* the drain
 * actually moved the game is a state change worth a line, so it is `info`.
 */
function drainFinishedLevel(actions: number, stop: BotDrainStop): LogLevel {
  if (isBotDrainDefect(stop)) return "error";
  if (stop.kind === "command-rejected") return "info";
  if (stop.kind === "room-not-found") return "warn";
  return actions > 0 ? "info" : "debug";
}

export function botDriverEventLevel(event: BotDriverEvent): LogLevel {
  switch (event.type) {
    // Paired with bot.drain.finished, which carries the whole summary — logging
    // both at info would double every line on the polling path for no gain.
    case "bot.drain.started":
      return "debug";
    // A committed bot turn is a real state change, at most ~1/second per room.
    case "bot.command.applied":
      return "info";
    case "bot.publish.failed":
    case "bot.drain.crashed":
      return "error";
    case "bot.drain.finished":
      return drainFinishedLevel(event.actions, event.stop);
    default:
      event satisfies never;
      return "error";
  }
}

/** Flattens a stop into log fields. `stop=` is the field to group by. */
function stopContext(stop: BotDrainStop): LogContext {
  switch (stop.kind) {
    case "room-not-found":
    case "room-missing-game":
    case "no-active-player":
      return { stop: stop.kind };
    case "room-not-active":
      return { stop: stop.kind, roomStatus: stop.roomStatus };
    case "match-not-active":
      return { stop: stop.kind, gameStatus: stop.gameStatus };
    case "human-turn":
      return { stop: stop.kind, player: stop.playerId };
    case "bot-cannot-decide":
      return {
        stop: stop.kind,
        player: stop.playerId,
        phase: stop.phase,
        gameRevision: stop.gameRevision,
      };
    case "legal-action-missing":
      return {
        stop: stop.kind,
        player: stop.playerId,
        wanted: stop.wanted,
        gameRevision: stop.gameRevision,
      };
    case "command-rejected":
      return {
        stop: stop.kind,
        player: stop.playerId,
        decision: stop.decision,
        code: stop.code,
        expected: stop.expected,
      };
    case "action-cap":
      return { stop: stop.kind, cap: stop.cap };
    default:
      stop satisfies never;
      return { stop: "unknown" };
  }
}

export function botDriverEventContext(event: BotDriverEvent): LogContext {
  switch (event.type) {
    case "bot.drain.started":
      return { room: event.roomId };
    case "bot.command.applied":
      return {
        room: event.roomId,
        player: event.playerId,
        decision: event.decision,
        command: event.commandId,
        revision: event.revision,
        gameRevision: event.gameRevision,
      };
    case "bot.publish.failed":
      return {
        room: event.roomId,
        revision: event.revision,
        message: event.messageId,
        error: describeError(event.error),
      };
    case "bot.drain.crashed":
      return { room: event.roomId, error: describeError(event.error) };
    case "bot.drain.finished":
      return {
        room: event.roomId,
        actions: event.actions,
        ...stopContext(event.stop),
      };
    default:
      event satisfies never;
      return {};
  }
}

/** The production sink: `onEvent: logBotDriverEvent`. */
export function logBotDriverEvent(event: BotDriverEvent): void {
  log(botDriverEventLevel(event), event.type, botDriverEventContext(event));
}
