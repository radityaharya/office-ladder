import { describe, expect, it } from "vitest";

import type {
  WindowExpiryDriverEvent,
  WindowExpiryStop,
} from "../../../src/rooms/window-timer/window-expiry-driver";
import {
  windowExpiryEventContext,
  windowExpiryEventLevel,
} from "../../../src/rooms/window-timer/window-expiry-log";
import type { ExpiryTarget } from "../../../src/rooms/window-timer/window-deadlines";

/**
 * The severity rules decide whether a reaction window the server closed on the
 * table's behalf is visible at all, which makes them worth proving. Kept out of
 * `default-driver.ts` for the same reason `turn-timeout-log.ts` is: that module
 * transitively imports the Postgres client and cannot be unit-tested.
 */

const target: ExpiryTarget = {
  kind: "reaction-window",
  id: "decision-under-test",
  deadlineAt: "2026-07-26T12:00:10.000Z",
  deadlineMs: Date.parse("2026-07-26T12:00:10.000Z"),
  derived: false,
};

function finished(actions: number, stop: WindowExpiryStop): WindowExpiryDriverEvent {
  return { type: "window-expiry.pass.finished", roomId: "room-1", actions, stop };
}

describe("severity", () => {
  it("Given a pass that closed something, When it finishes, Then it is worth a line", () => {
    expect(windowExpiryEventLevel(finished(1, { kind: "idle", gameStatus: "active" }))).toBe(
      "info",
    );
  });

  it("Given the resting state every poll produces, When it finishes, Then it stays out of the log", () => {
    // Every route mutation and every bootstrap read can kick this driver; almost
    // all of those find nothing to do.
    expect(windowExpiryEventLevel(finished(0, { kind: "idle", gameStatus: "active" }))).toBe(
      "debug",
    );
    expect(
      windowExpiryEventLevel(finished(0, { kind: "pending", target, remainingMs: 4_000 })),
    ).toBe("debug");
    expect(windowExpiryEventLevel({ type: "window-expiry.pass.started", roomId: "r" })).toBe(
      "debug",
    );
  });

  it("Given a stop that means a resolvable can never close, When it finishes, Then it is an error", () => {
    expect(windowExpiryEventLevel(finished(0, { kind: "room-missing-game" }))).toBe("error");
    expect(windowExpiryEventLevel(finished(0, { kind: "pass-cap", cap: 8 }))).toBe("error");
    expect(
      windowExpiryEventLevel(
        finished(0, { kind: "command-rejected", target, code: "ILLEGAL_ACTION", expected: false }),
      ),
    ).toBe("error");
  });

  it("Given a refused target, When it is reported, Then only the unexpected kind raises an alarm", () => {
    const refused = (expected: boolean): WindowExpiryDriverEvent => ({
      type: "window-expiry.refused",
      roomId: "room-1",
      targetKind: "reaction-window",
      targetId: target.id,
      code: expected ? "DECISION_POINT_NOT_FOUND" : "INVARIANT_VIOLATION",
      expected,
    });

    expect(windowExpiryEventLevel(refused(true))).toBe("debug");
    expect(windowExpiryEventLevel(refused(false))).toBe("error");
    expect(windowExpiryEventContext(refused(false))).toMatchObject({
      room: "room-1",
      target: target.id,
      code: "INVARIANT_VIOLATION",
      expected: false,
    });
  });

  it("Given a race this driver expected to lose, When it finishes, Then it is not an alarm", () => {
    expect(
      windowExpiryEventLevel(
        finished(0, {
          kind: "command-rejected",
          target,
          code: "DECISION_POINT_NOT_FOUND",
          expected: true,
        }),
      ),
    ).toBe("debug");
  });

  it("Given a window closed on the table's behalf, When it is reported, Then it is always logged", () => {
    // The one thing in this system that resolves a decision no human made.
    expect(
      windowExpiryEventLevel({
        type: "window-expiry.fired",
        roomId: "room-1",
        targetKind: "reaction-window",
        targetId: target.id,
        deadlineAt: target.deadlineAt,
        lateMs: 0,
        derivedDeadline: false,
        commandId: "timeout:expiry:x",
        revision: 4,
        gameRevision: 3,
      }),
    ).toBe("info");
  });
});

describe("context", () => {
  it("Given a fired expiry, When it is flattened, Then the deadline, the lateness and the command are all on the line", () => {
    const context = windowExpiryEventContext({
      type: "window-expiry.fired",
      roomId: "room-1",
      targetKind: "turn",
      targetId: "7",
      deadlineAt: target.deadlineAt,
      lateMs: 1_500,
      derivedDeadline: true,
      commandId: "timeout:expiry:turn:g:3:7",
      revision: 9,
      gameRevision: 8,
    });

    expect(context).toMatchObject({
      room: "room-1",
      targetKind: "turn",
      target: "7",
      lateMs: 1_500,
      derivedDeadline: true,
      command: "timeout:expiry:turn:g:3:7",
    });
  });

  it("Given any stop, When it is flattened, Then every value is a scalar the log can print", () => {
    const cases: readonly WindowExpiryStop[] = [
      { kind: "room-not-found" },
      { kind: "room-not-active", roomStatus: "open" },
      { kind: "room-missing-game" },
      { kind: "idle", gameStatus: "ended" },
      { kind: "pending", target, remainingMs: 12 },
      { kind: "command-rejected", target, code: "STALE_REVISION", expected: true },
      { kind: "pass-cap", cap: 8 },
    ];

    for (const stop of cases) {
      const context = windowExpiryEventContext(finished(0, stop));
      expect(context["stop"]).toBe(stop.kind);
      for (const value of Object.values(context)) {
        expect(["string", "number", "boolean", "undefined"]).toContain(typeof value);
      }
    }
  });
});
