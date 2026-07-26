import { customType } from "drizzle-orm/pg-core";

/**
 * The JSON value every jsonb column in this schema holds.
 *
 * Declared here rather than imported: `packages/db` must not depend on the
 * engine or the content pack, and this is the one type both this module and
 * every table definition need.
 */
export type JsonValue =
  | boolean
  | null
  | number
  | string
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

/**
 * Decodes whatever the driver hands back for a jsonb column, tolerating a row
 * that was double-encoded before {@link jsonbValue} existed.
 *
 * Bun's driver parses jsonb for us, so a correctly-stored object arrives as an
 * object and falls straight through. A row written by the old path holds a jsonb
 * *string* whose text is the JSON of the real value, and arrives here as a
 * JavaScript string — one `JSON.parse` recovers it.
 *
 * This is a compatibility shim with a deliberate lifetime, not a permanent part
 * of the contract. `drizzle/0004_jsonb_object_encoding.sql` rewrites every
 * affected row, but a migration is a thing that has been *run somewhere*, not a
 * property of the code: a replica, a branch database, a developer's own Postgres
 * or a restored backup can each still hold the old shape, and losing a match to
 * "the migration had not reached that database yet" is not an acceptable failure
 * mode. Keep it for at least one release after 0004 has demonstrably run
 * everywhere, then delete it and let a string read back as a string.
 *
 * A string that is not valid JSON is returned unchanged rather than thrown away:
 * a column genuinely holding a JSON string (`jsonb_typeof` = `'string'` because
 * someone stored `"a note"`) must still read back as that string. The ambiguity
 * this leaves — a stored JSON string whose text happens to parse as JSON is
 * indistinguishable from a double-encoded object — is inherent to a tolerant
 * read and is why the shim is temporary. No column in this schema stores a bare
 * string, so nothing here is exposed to it.
 */
export function decodeJsonbColumn(value: unknown): JsonValue {
  if (typeof value !== "string") return value as JsonValue;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

/**
 * A jsonb column that actually stores JSON.
 *
 * Use this instead of drizzle's own `jsonb()`, which is unsafe with the
 * `bun-sql` driver: its `mapToDriverValue` is `JSON.stringify`, and Bun then
 * serialises the parameter it is given *again* because Postgres has resolved
 * that parameter's type as jsonb. The two serialisations compose, so the column
 * ends up holding a JSON string — `jsonb_typeof` returns `'string'`,
 * `jsonb_object_keys` fails with 22023, and no index, `->>` path or operational
 * query can see inside the value. Round trips still worked, which is why this
 * survived: the same double step reverses itself on read.
 *
 * The fix is to hand the driver the value itself and let it do the single
 * encoding it is going to do anyway. That is also *more* faithful than the
 * stringify for every non-object JSON value: a string stores as a jsonb string,
 * a number as a jsonb number, `null` as SQL NULL (drizzle skips this mapping for
 * null entirely — see sql/sql.js), rather than all three becoming text that
 * Postgres re-parses.
 *
 * `dataType()` returns `"jsonb"`, so this is the same column type to
 * `drizzle-kit`: swapping `jsonb()` for this generates no schema diff, and
 * migration 0004 is pure data movement.
 */
export const jsonbValue = customType<{ data: JsonValue; driverData: JsonValue }>({
  dataType() {
    return "jsonb";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return decodeJsonbColumn(value);
  },
});
