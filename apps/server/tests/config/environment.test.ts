import { describe, expect, it } from "vitest";

import {
  assertServerEnvironment,
  checkServerEnvironment,
  type ProcessEnvironment,
} from "../../src/config/environment";

/**
 * The motivating failure: with BETTER_AUTH_URL unset, trusted-origins falls back
 * to http://localhost:3072, so in a real deployment every mutating request is
 * rejected 403 while reads keep working — a total outage that reads as a client
 * bug, with nothing in the logs saying why.
 */
const production: ProcessEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pw@db.example.com:5432/postgres",
  BETTER_AUTH_SECRET: "a-real-secret",
  BETTER_AUTH_URL: "https://app.example.com",
};

function variablesIn(
  env: ProcessEnvironment,
  severity: "fatal" | "warning",
): readonly string[] {
  return checkServerEnvironment(env)
    .filter((problem) => problem.severity === severity)
    .map((problem) => problem.variable);
}

describe("checkServerEnvironment", () => {
  it("Given a complete production environment, When it is checked, Then nothing is reported", () => {
    expect(checkServerEnvironment(production)).toEqual([]);
  });

  it("Given production without BETTER_AUTH_URL, When it is checked, Then it is fatal and says what breaks", () => {
    const problems = checkServerEnvironment({ ...production, BETTER_AUTH_URL: undefined });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.variable).toBe("BETTER_AUTH_URL");
    expect(problems[0]?.severity).toBe("fatal");
    expect(problems[0]?.detail).toContain("403");
  });

  it("Given development without BETTER_AUTH_URL or a secret, When it is checked, Then they are warnings, not fatal", () => {
    const env: ProcessEnvironment = { DATABASE_URL: production.DATABASE_URL };

    // The localhost fallback is genuinely correct in development, so refusing to
    // start would break `bun run dev` for anyone who has not copied .env.example.
    expect(variablesIn(env, "fatal")).toEqual([]);
    expect(variablesIn(env, "warning")).toEqual(["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]);
  });

  it("Given a blank value, When it is checked, Then it counts as missing", () => {
    expect(variablesIn({ ...production, DATABASE_URL: "   " }, "fatal")).toEqual([
      "DATABASE_URL",
    ]);
  });

  it("Given a malformed BETTER_AUTH_URL, When it is checked, Then it is fatal in development too", () => {
    // A value that cannot be right anywhere: it otherwise dies inside new URL()
    // while the server boots, naming no variable at all.
    for (const value of ["app.example.com", "://nope", "ftp://app.example.com"]) {
      const env: ProcessEnvironment = {
        DATABASE_URL: production.DATABASE_URL,
        BETTER_AUTH_URL: value,
      };
      expect(variablesIn(env, "fatal")).toEqual(["BETTER_AUTH_URL"]);
    }
  });

  it("Given a malformed extra origin, When it is checked, Then it is fatal", () => {
    expect(
      variablesIn(
        { ...production, BETTER_AUTH_EXTRA_ORIGINS: "https://ok.example.com,tunnel.example" },
        "fatal",
      ),
    ).toEqual(["BETTER_AUTH_EXTRA_ORIGINS"]);
    expect(
      variablesIn(
        { ...production, BETTER_AUTH_EXTRA_ORIGINS: " https://ok.example.com , https://two.example.com " },
        "fatal",
      ),
    ).toEqual([]);
  });

  it("Given a PORT that is not a port, When it is checked, Then it is fatal", () => {
    expect(variablesIn({ ...production, PORT: "not-a-port" }, "fatal")).toEqual(["PORT"]);
    expect(variablesIn({ ...production, PORT: "70000" }, "fatal")).toEqual(["PORT"]);
    expect(variablesIn({ ...production, PORT: "3072" }, "fatal")).toEqual([]);
  });

  it("Given several missing variables, When they are checked, Then all of them are reported at once", () => {
    // A fresh deployment usually has none of them; fixing them one failed boot at
    // a time is how five minutes of misconfiguration becomes an hour.
    expect(variablesIn({ NODE_ENV: "production" }, "fatal")).toEqual([
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
    ]);
  });
});

describe("assertServerEnvironment", () => {
  it("Given a complete environment, When it is asserted, Then the boot continues", () => {
    expect(() => assertServerEnvironment(production)).not.toThrow();
  });

  it("Given fatal problems, When it is asserted, Then it throws naming every variable", () => {
    let message = "";
    try {
      assertServerEnvironment({ NODE_ENV: "production" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("Refusing to start");
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).toContain("BETTER_AUTH_URL");
    expect(message).toContain(".env.example");
  });

  it("Given only warnings, When it is asserted, Then it does not throw", () => {
    expect(() =>
      assertServerEnvironment({ DATABASE_URL: production.DATABASE_URL }),
    ).not.toThrow();
  });

  it("Given no environment argument, When it is asserted, Then it reads the real process environment", () => {
    // The entrypoints call it with no argument; this pins that default.
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://user:pw@db.example.com:5432/postgres";
    try {
      expect(() => assertServerEnvironment()).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
