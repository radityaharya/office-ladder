import { describeError, log, type LogContext, type LogLevel } from "@/observability/log";
import {
  isWindowExpiryDefect,
  type WindowExpiryDriverEvent,
  type WindowExpiryStop,
} from "./window-expiry-driver";

/**
 * How the window-expiry driver's events are logged.
 *
 * Kept out of the default wiring for the same reason `turn-timeout-log.ts` is:
 * `default-driver.ts` transitively imports the Postgres repository, so nothing
 * there can be unit-tested, while this module imports only types and the pure
 * formatter — which means the severity rules below, the part that decides whether
 * a reaction window closed by the server is visible at all, are provable.
 */

/**
 * Severity of a finished pass.
 *
 * Every route mutation and every bootstrap read can kick this driver, and almost
 * every one of those finds a game with no deadline at all and does nothing.
 * Those land at `debug`. A pass that closed something is `info`; anything that
 * means a resolvable can never be closed is `error`.
 */
function passFinishedLevel(actions: number, stop: WindowExpiryStop): LogLevel {
  if (isWindowExpiryDefect(stop)) return "error";
  if (stop.kind === "room-not-found") return "warn";
  return actions > 0 ? "info" : "debug";
}

export function windowExpiryEventLevel(event: WindowExpiryDriverEvent): LogLevel {
  switch (event.type) {
    // Paired with pass.finished, which carries the summary; both at info would
    // double every line on the polling path for no gain.
    case "window-expiry.pass.started":
      return "debug";
    // Closing a window on the table's behalf is always worth a line: it is the
    // one thing in this system that resolves a decision no human made.
    case "window-expiry.fired":
      return "info";
    // A refusal this driver expected to lose (somebody answered the window
    // first, another writer won the revision) is the mechanism working. One it
    // did not means a resolvable the scan read out of state cannot be closed,
    // and the room now has a deadline nothing will ever resolve.
    case "window-expiry.refused":
      return event.expected ? "debug" : "error";
    case "window-expiry.publish.failed":
    case "window-expiry.pass.crashed":
      return "error";
    case "window-expiry.pass.finished":
      return passFinishedLevel(event.actions, event.stop);
    default:
      event satisfies never;
      return "error";
  }
}

/** Flattens a stop into log fields. `stop=` is the field to group by. */
function stopContext(stop: WindowExpiryStop): LogContext {
  switch (stop.kind) {
    case "room-not-found":
    case "room-missing-game":
      return { stop: stop.kind };
    case "room-not-active":
      return { stop: stop.kind, roomStatus: stop.roomStatus };
    case "idle":
      return { stop: stop.kind, gameStatus: stop.gameStatus };
    case "pending":
      return {
        stop: stop.kind,
        targetKind: stop.target.kind,
        target: stop.target.id,
        deadlineAt: stop.target.deadlineAt,
        remainingMs: stop.remainingMs,
      };
    case "command-rejected":
      return {
        stop: stop.kind,
        targetKind: stop.target.kind,
        target: stop.target.id,
        deadlineAt: stop.target.deadlineAt,
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

export function windowExpiryEventContext(event: WindowExpiryDriverEvent): LogContext {
  switch (event.type) {
    case "window-expiry.pass.started":
      return { room: event.roomId };
    case "window-expiry.fired":
      return {
        room: event.roomId,
        targetKind: event.targetKind,
        target: event.targetId,
        deadlineAt: event.deadlineAt,
        lateMs: event.lateMs,
        derivedDeadline: event.derivedDeadline,
        command: event.commandId,
        revision: event.revision,
        gameRevision: event.gameRevision,
      };
    case "window-expiry.refused":
      return {
        room: event.roomId,
        targetKind: event.targetKind,
        target: event.targetId,
        code: event.code,
        expected: event.expected,
      };
    case "window-expiry.publish.failed":
      return {
        room: event.roomId,
        revision: event.revision,
        message: event.messageId,
        error: describeError(event.error),
      };
    case "window-expiry.pass.crashed":
      return { room: event.roomId, error: describeError(event.error) };
    case "window-expiry.pass.finished":
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

/** The production sink: `onEvent: logWindowExpiryEvent`. */
export function logWindowExpiryEvent(event: WindowExpiryDriverEvent): void {
  log(windowExpiryEventLevel(event), event.type, windowExpiryEventContext(event));
}
