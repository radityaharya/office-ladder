import { drizzle } from "drizzle-orm/bun-sql";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL");
}

export const db = drizzle(connectionString, { schema });
