import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configuredLogLevel,
  describeError,
  formatLogLine,
  isLevelEnabled,
  log,
  logException,
} from "../../src/observability/log";

/**
 * These tests pin the two properties every other logging seam depends on: that a
 * line is greppable by event name with its context attached, and that no value —
 * including raw request input — can forge a second line.
 */

const originalLevel = process.env.LOG_LEVEL;

afterEach(() => {
  if (originalLevel === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = originalLevel;
  }
  vi.restoreAllMocks();
});

describe("formatLogLine", () => {
  it("Given an event and context, When formatting, Then the event name and every field are on one greppable line", () => {
    const line = formatLogLine("error", "command.rejected", {
      command: "room.roll",
      room: "0f9c1b6e",
      actor: "user-1",
      code: "STALE_REVISION",
      revision: 12,
      expected: false,
    });

    expect(line).toBe(
      "[error] command.rejected command=room.roll room=0f9c1b6e actor=user-1 " +
        "code=STALE_REVISION revision=12 expected=false",
    );
  });

  it("Given an event with no context, When formatting, Then the line is just the level and the event", () => {
    expect(formatLogLine("info", "startup.starting")).toBe("[info] startup.starting");
  });

  it("Given an undefined field, When formatting, Then it is omitted rather than printed as the word undefined", () => {
    // "Not applicable here" must not look like a value: the roll routes pass
    // gameRevision, the lobby ones do not.
    const line = formatLogLine("info", "command.applied", {
      room: "r1",
      gameRevision: undefined,
      revision: 3,
    });

    expect(line).toBe("[info] command.applied room=r1 revision=3");
    expect(line).not.toContain("undefined");
  });

  it("Given a null field, When formatting, Then null is printed, because 'we looked and there was none' is information", () => {
    expect(formatLogLine("info", "command.applied", { room: null })).toBe(
      "[info] command.applied room=null",
    );
  });

  it("Given attacker-controlled input containing newlines, When formatting, Then it cannot forge a second log line", () => {
    // The route layer logs the raw Origin header and the raw roomId path
    // parameter on purpose. Both are client-controlled.
    const line = formatLogLine("warn", "http.origin-rejected", {
      origin: "https://evil.example\n2026-01-01T00:00:00.000Z [info] command.applied room=r1",
      fetchSite: "cross site",
    });

    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("\\n");
    // A value with a space is quoted too, so field boundaries stay unambiguous.
    expect(line).toContain('fetchSite="cross site"');
  });
});

describe("describeError", () => {
  it("Given an Error, When describing it, Then the name and message are one field-safe string", () => {
    expect(describeError(new TypeError("Active room is missing its canonical game"))).toBe(
      "TypeError: Active room is missing its canonical game",
    );
  });

  it("Given something that is not an Error, When describing it, Then it still produces a string and never throws", () => {
    // A `throw {}` or a hostile Symbol.toPrimitive must not take out the logger
    // that is trying to report the failure.
    const hostile = {
      [Symbol.toPrimitive]() {
        throw new Error("nope");
      },
    };

    expect(describeError("plain string")).toBe("plain string");
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
    expect(() => describeError(hostile)).not.toThrow();
    expect(describeError(hostile)).toBe("<non-error object>");
  });
});

describe("log levels", () => {
  it("Given no LOG_LEVEL, When logging, Then info and above are emitted and debug is not", () => {
    delete process.env.LOG_LEVEL;
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(configuredLogLevel()).toBe("info");
    log("debug", "realtime.published", { recipients: 0 });
    log("info", "command.applied", { room: "r1" });
    log("warn", "http.origin-rejected", { command: "room.roll" });
    log("error", "command.failed", { command: "room.roll" });

    expect(out).toHaveBeenCalledTimes(1);
    expect(out.mock.calls[0]?.[0]).toContain("[info] command.applied");
    // warn and error go to stderr, so a log-scraping deploy sees them as errors.
    expect(err).toHaveBeenCalledTimes(2);
  });

  it("Given LOG_LEVEL=debug, When logging the polling-path line, Then it is emitted", () => {
    process.env.LOG_LEVEL = "debug";
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(isLevelEnabled("debug")).toBe(true);
    log("debug", "realtime.published", { room: "r1", recipients: 0 });

    expect(out).toHaveBeenCalledTimes(1);
    expect(out.mock.calls[0]?.[0]).toContain("recipients=0");
  });

  it("Given LOG_LEVEL=error, When logging a warning, Then it is suppressed", () => {
    process.env.LOG_LEVEL = "error";
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    log("warn", "http.origin-rejected", {});
    expect(err).not.toHaveBeenCalled();

    log("error", "command.failed", {});
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("Given an unrecognized LOG_LEVEL, When logging, Then it falls back to info instead of silencing the server", () => {
    process.env.LOG_LEVEL = "verbose";
    expect(configuredLogLevel()).toBe("info");
    expect(isLevelEnabled("info")).toBe(true);
    expect(isLevelEnabled("debug")).toBe(false);
  });
});

describe("logException", () => {
  it("Given a thrown Error, When reporting it, Then the event line carries the message and the stack follows separately", () => {
    delete process.env.LOG_LEVEL;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logException("error", "command.failed", new Error("connection refused"), {
      command: "room.roll",
      room: "r1",
    });

    const [eventLine, stackLine] = err.mock.calls.map((call) => String(call[0]));
    expect(eventLine).toContain("[error] command.failed");
    expect(eventLine).toContain("command=room.roll");
    expect(eventLine).toContain("room=r1");
    expect(eventLine).toContain('error="Error: connection refused"');
    // The stack is deliberately not squeezed into a logfmt value.
    expect(stackLine).toContain("Error: connection refused");
    expect(stackLine).toContain("at ");
  });

  it("Given a level below the configured one, When reporting an exception, Then neither the line nor the stack is written", () => {
    process.env.LOG_LEVEL = "error";
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logException("warn", "http.body-unreadable", new Error("aborted"));

    expect(err).not.toHaveBeenCalled();
  });
});
