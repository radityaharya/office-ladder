import { describeError, log, type LogContext, type LogLevel } from "@/observability/log";
import {
  isTurnTimeoutDefect,
  type TurnTimeoutDriverEvent,
  type TurnTimeoutStop,
} from "./turn-timeout-driver";

/**
 * How the turn-timeout driver's events are logged.
 *
 * Kept out of the default wiring for the same reason bot-driver-log.ts is:
 * default-drivers.ts transitively imports the Postgres repository, so nothing
 * there can be unit-tested, while this module imports only types and the pure
 * formatter — which means the severity rules below, the part that decides whether
 * a turn taken from a player is visible, are provable.
 */

/**
 * Severity of a finished pass.
 *
 * The GET bootstrap path revives this driver on every poll, and almost every one
 * of those finds a deadline that has not arrived yet and does nothing. Those land
 * at `debug`, exactly like the bot driver's benign stops; a pass that actually did
 * something is `info`, and anything that means the match cannot proceed is
 * `error`.
 */
function passFinishedLevel(actions: number, stop: TurnTimeoutStop): LogLevel {
  if (isTurnTimeoutDefect(stop)) return "error";
  if (stop.kind === "room-not-found") return "warn";
  if (stop.kind === "timer-write-rejected") return "info";
  if (stop.kind === "timer-armed" || stop.kind === "timer-cleared") return "info";
  return actions > 0 ? "info" : "debug";
}

export function turnTimeoutEventLevel(event: TurnTimeoutDriverEvent): LogLevel {
  switch (event.type) {
    // Paired with pass.finished, which carries the summary; both at info would
    // double every line on the polling path for no gain.
    case "turn-timeout.pass.started":
      return "debug";
    // Taking somebody's turn for them is always worth a line. An unclassified
    // prompt answer is worth an alarm: a consequential decision was made for an
    // absent human by a fallback rather than by a rule anybody wrote down.
    case "turn-timeout.applied":
      return event.unclassified ? "error" : "info";
    case "turn-timeout.publish.failed":
    case "turn-timeout.pass.crashed":
      return "error";
    case "turn-timeout.pass.finished":
      return passFinishedLevel(event.actions, event.stop);
    default:
      event satisfies never;
      return "error";
  }
}

/** Flattens a stop into log fields. `stop=` is the field to group by. */
function stopContext(stop: TurnTimeoutStop): LogContext {
  switch (stop.kind) {
    case "room-not-found":
    case "room-missing-game":
    case "no-active-player":
    case "no-clock":
    case "timer-cleared":
      return { stop: stop.kind };
    case "room-not-active":
      return { stop: stop.kind, roomStatus: stop.roomStatus };
    case "match-not-active":
      return { stop: stop.kind, gameStatus: stop.gameStatus };
    case "bot-turn":
      return { stop: stop.kind, player: stop.playerId };
    case "timer-armed":
      return {
        stop: stop.kind,
        player: stop.playerId,
        deadlineAt: stop.deadlineAt,
        gameRevision: stop.gameRevision,
      };
    case "timer-write-rejected":
      return { stop: stop.kind, code: stop.code, expected: stop.expected };
    case "timer-pending":
      return {
        stop: stop.kind,
        player: stop.playerId,
        deadlineAt: stop.deadlineAt,
        remainingMs: stop.remainingMs,
      };
    case "cannot-act":
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
    case "pass-cap":
      return { stop: stop.kind, cap: stop.cap };
    default:
      stop satisfies never;
      return { stop: "unknown" };
  }
}

export function turnTimeoutEventContext(event: TurnTimeoutDriverEvent): LogContext {
  switch (event.type) {
    case "turn-timeout.pass.started":
      return { room: event.roomId };
    case "turn-timeout.applied":
      return {
        room: event.roomId,
        player: event.playerId,
        decision: event.decision,
        command: event.commandId,
        revision: event.revision,
        gameRevision: event.gameRevision,
        promptKind: event.promptKind,
        unclassified: event.unclassified,
      };
    case "turn-timeout.publish.failed":
      return {
        room: event.roomId,
        revision: event.revision,
        message: event.messageId,
        error: describeError(event.error),
      };
    case "turn-timeout.pass.crashed":
      return { room: event.roomId, error: describeError(event.error) };
    case "turn-timeout.pass.finished":
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

/** The production sink: `onEvent: logTurnTimeoutEvent`. */
export function logTurnTimeoutEvent(event: TurnTimeoutDriverEvent): void {
  log(turnTimeoutEventLevel(event), event.type, turnTimeoutEventContext(event));
}
