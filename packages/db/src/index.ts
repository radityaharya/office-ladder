import { drizzle } from "drizzle-orm/bun-sql";

import * as schema from "./schema";

type Database = ReturnType<typeof createClient>;

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }

  return drizzle(connectionString, { schema });
}

let client: Database | null = null;

function connect(): Database {
  client ??= createClient();
  return client;
}

/**
 * The Drizzle client, constructed on first use rather than at module load.
 *
 * Importing this module used to throw whenever DATABASE_URL was absent, which
 * made every module that transitively imports it — i.e. every server
 * entrypoint, route and repository — impossible to even import in a test
 * process without a live database.
 *
 * The behaviour when the variable is genuinely missing at runtime is unchanged:
 * the first query still throws `Missing DATABASE_URL`. Detecting it at *boot*
 * is now the explicit job of the server's startup environment check
 * (apps/server/src/env.ts), which reports every missing variable at once
 * instead of dying on whichever module happened to load first.
 *
 * Methods are bound to the real client instead of being invoked with the proxy
 * as `this`, so no consumer can observe the indirection.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const target = connect();
    const value: unknown = Reflect.get(target, property);
    if (typeof value === "function") {
      return (value as (this: Database, ...args: readonly unknown[]) => unknown).bind(target);
    }

    return value;
  },
  has(_target, property) {
    return Reflect.has(connect(), property);
  },
});
