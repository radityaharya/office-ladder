import { describe, expect, it } from "vitest";

import { formatLogLine } from "../../src/observability/log";
import { startupContext } from "../../src/observability/startup";

/**
 * The startup line is the only place this server reports its own configuration,
 * and it is one careless field away from printing a database password into a log
 * aggregator. That is what these tests are actually guarding.
 */

const SECRETS = {
  DATABASE_URL: "postgresql://postgres.abc:sup3r-s3cret@db.example.com:5432/postgres",
  BETTER_AUTH_SECRET: "Zm9vYmFyYmF6cXV1eA==",
} as const;

describe("startupContext", () => {
  it("Given a fully configured environment, When building the startup line, Then no secret VALUE appears anywhere in it", () => {
    const line = formatLogLine(
      "info",
      "startup.starting",
      startupContext(
        {
          ...SECRETS,
          BETTER_AUTH_URL: "https://app.example.com",
          BETTER_AUTH_EXTRA_ORIGINS: "https://tunnel.example.com",
          NODE_ENV: "production",
        },
        3072,
      ),
    );

    expect(line).not.toContain("sup3r-s3cret");
    expect(line).not.toContain(SECRETS.DATABASE_URL);
    expect(line).not.toContain(SECRETS.BETTER_AUTH_SECRET);
    // Presence, which is the actually useful part.
    expect(line).toContain("DATABASE_URL=set");
    expect(line).toContain("BETTER_AUTH_SECRET=set");
    expect(line).toContain("missingRequired=null");
  });

  it("Given the port and environment, When building the startup line, Then it names the port and the resolved log level", () => {
    const context = startupContext({ LOG_LEVEL: "debug", NODE_ENV: "development" }, 3073);

    expect(context.port).toBe(3073);
    expect(context.logLevel).toBe("debug");
    expect(context.nodeEnv).toBe("development");
  });

  it("Given no LOG_LEVEL, When building the startup line, Then the effective default is reported rather than nothing", () => {
    // "Why am I not seeing debug lines" should be answerable from the boot line.
    expect(startupContext({}, 3072).logLevel).toBe("info");
  });

  it("Given missing required variables, When building the startup line, Then every one of them is named in a single greppable field", () => {
    const context = startupContext({ BETTER_AUTH_URL: "http://localhost:3072" }, 3072);

    expect(context.DATABASE_URL).toBe("missing");
    expect(context.BETTER_AUTH_SECRET).toBe("missing");
    expect(context.BETTER_AUTH_URL).toBe("set");
    // Fixing a fresh deployment one failed boot at a time is the failure mode
    // this field exists to prevent.
    expect(context.missingRequired).toBe("DATABASE_URL,BETTER_AUTH_SECRET");
  });

  it("Given a variable set to whitespace, When building the startup line, Then it counts as missing", () => {
    // `DATABASE_URL=` in an env file is a very common way to be "set" and useless.
    const context = startupContext({ DATABASE_URL: "   " }, 3072);

    expect(context.DATABASE_URL).toBe("missing");
    expect(String(context.missingRequired)).toContain("DATABASE_URL");
  });
});
