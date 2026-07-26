import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * packages/db used to construct the Drizzle client at module load and throw when
 * DATABASE_URL was absent. Because every route, repository and entrypoint imports
 * it transitively, that made all of them unimportable in a test process without a
 * live database — which is why the room service's guards could only ever be
 * tested through hand-rolled fakes.
 *
 * The client is now built on first use. The runtime behaviour when the variable is
 * genuinely missing is unchanged — the first query still throws the same
 * `Missing DATABASE_URL` — and boot-time detection moved to an explicit startup
 * check (src/config/environment.ts) that names every missing variable at once.
 *
 * `bun` is aliased to a stub in vitest.config.ts (Node has no such module), and
 * the stub throws if anything ever tries to open a real connection, so this test
 * also proves nothing here reaches the network.
 */
describe("db client laziness", () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("Given no DATABASE_URL, When the module is imported, Then importing it does not throw", async () => {
    const module = await import("@office-ladder/db");

    expect(module.db).toBeDefined();
  });

  it("Given no DATABASE_URL, When the client is first used, Then it throws naming the variable", async () => {
    const { db } = await import("@office-ladder/db");

    expect(() => db.select()).toThrow("Missing DATABASE_URL");
  });
});
