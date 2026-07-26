/**
 * Stand-in for Bun's built-in `bun` module under vitest, which runs on Node.
 *
 * `drizzle-orm/bun-sql/driver.js` does `import { SQL } from "bun"` at module
 * scope, so without this alias *any* module that transitively imports
 * `@office-ladder/db` — i.e. every route, every repository, and the Hono app
 * itself — cannot even be loaded in a test process. Nothing here is ever
 * called: the db client is constructed lazily (packages/db/src/index.ts) and
 * the tests relying on this alias never reach a query. Constructing it throws
 * loudly rather than pretending to be a database.
 */
export class SQL {
  constructor() {
    throw new Error(
      "bun:SQL is unavailable under vitest — no test may open a real connection",
    );
  }
}
