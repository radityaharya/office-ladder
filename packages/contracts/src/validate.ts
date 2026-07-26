/**
 * The validation primitives every parser in this package is built from.
 *
 * Extracted from `rooms.ts` when gameplay v2 added twenty-four more command
 * bodies: the same six helpers were about to be copied into four files, and a
 * copy that drifts is how a bounds check silently stops being applied to one of
 * them. `rooms.ts` re-exports {@link ContractValidationError} so its own public
 * surface is unchanged.
 *
 * Two rules hold for everything here, and they are the reason this package
 * exists at all:
 *
 * 1. **Reject, never coerce.** A value the server cannot vouch for is refused
 *    with a path and a reason, not clamped into range. A clamped cheat is still a
 *    cheat that got halfway in.
 * 2. **Every numeric is bounded on both sides.** `typeof x === "number"` accepts
 *    `1e308`, `-0`, and `NaN`; every one of those has an exploit in a game with
 *    an economy. There is no unbounded number anywhere in this package.
 */

export class ContractValidationError extends Error {
  readonly name = "ContractValidationError";

  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path} ${reason}`);
  }
}

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type JsonObject = { readonly [key: string]: JsonValue };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Keys that can poison an object's prototype once the value is merged rather
 * than replaced.
 *
 * `JSON.parse` itself is safe — it creates own properties — but these values are
 * stored as jsonb, read back, and spread into engine payloads, and a single
 * `{ ...stored }` on a `__proto__` key is enough. Refused at the boundary so
 * nothing downstream has to remember.
 */
const POISONED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ContractValidationError(path, "must be an object");
  }

  return value;
}

export function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const expectedKeys = new Set(keys);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new ContractValidationError(path, "contains unknown or missing fields");
  }
}

/**
 * requireExactKeys with a declared set of *optional* keys.
 *
 * requireExactKeys compares the key count, so it cannot express "this field may
 * be omitted": adding an optional field with it would reject every client that
 * does not send the new key — including the ones already deployed. This keeps the
 * property that actually matters, that an unknown key is refused so nothing can
 * smuggle a field the server does not read, while letting a field be additive.
 *
 * Own properties only. `"toString" in value` is true for any object, so a
 * presence test with `in` would accept a body that never mentioned the field.
 */
export function requireKnownKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ContractValidationError(path, "contains an unknown field");
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new ContractValidationError(path, "is missing a required field");
    }
  }
}

export function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ContractValidationError(path, "must be a string");
  }

  return value;
}

export function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractValidationError(path, "must be a boolean");
  }

  return value;
}

export function requireRevision(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContractValidationError(path, "must be a non-negative safe integer");
  }

  return value;
}

/**
 * An integer inside an inclusive range.
 *
 * `Number.isSafeInteger` rather than `Number.isInteger`: past 2^53 integers stop
 * being distinguishable, so arithmetic on them (a money balance, a round number)
 * silently stops being exact. It also rejects `NaN`, `Infinity` and `1e308`,
 * each of which would otherwise satisfy a naive `>= min` test.
 */
export function requireBoundedInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ContractValidationError(path, "must be a safe integer");
  }
  if (value < minimum || value > maximum) {
    throw new ContractValidationError(
      path,
      `must be between ${String(minimum)} and ${String(maximum)}`,
    );
  }

  return value;
}

/**
 * A finite, possibly fractional number inside an inclusive range — for the few
 * tunables (cost and toll multipliers) where `1.5` is a legitimate value.
 */
export function requireBoundedNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractValidationError(path, "must be a finite number");
  }
  if (value < minimum || value > maximum) {
    throw new ContractValidationError(
      path,
      `must be between ${String(minimum)} and ${String(maximum)}`,
    );
  }

  return value;
}

export function requireEnum<Allowed extends string>(
  value: unknown,
  allowed: readonly Allowed[],
  path: string,
  label: string,
): Allowed {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ContractValidationError(path, `must be ${label}`);
  }

  return value as Allowed;
}

export function parseOpaqueId(value: unknown, path = "id"): string {
  const id = requireString(value, path);
  if (!ID_PATTERN.test(id)) {
    throw new ContractValidationError(path, "must be a valid opaque identifier");
  }

  return id;
}

export function parseNullableOpaqueId(value: unknown, path: string): string | null {
  if (value === null) return null;
  return parseOpaqueId(value, path);
}

/**
 * A list of opaque ids with a length ceiling and no duplicates.
 *
 * Duplicates are refused rather than de-duplicated: `targetPlayerIds: [a, a, a]`
 * against a transition that charges or damages per entry is a multiplier, and a
 * caller that meant one target and sent three has a bug the server should not
 * paper over.
 */
export function parseIdList(
  value: unknown,
  path: string,
  options: { readonly minimum: number; readonly maximum: number },
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new ContractValidationError(path, "must be an array");
  }
  if (value.length < options.minimum || value.length > options.maximum) {
    throw new ContractValidationError(
      path,
      `must contain between ${String(options.minimum)} and ${String(options.maximum)} entries`,
    );
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = parseOpaqueId(entry, path);
    if (seen.has(id)) {
      throw new ContractValidationError(path, "must not contain duplicates");
    }
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

/** Any whitespace, including the Unicode kinds not caught by a naive space check. */
const WHITESPACE_PATTERN = /\s/u;

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return false;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if (isControlCharacter(character)) return true;
  }
  return false;
}

/**
 * Free player-authored text: a chat line, a promise in a trade.
 *
 * Trimmed, non-empty, length-capped, and free of control characters. The control
 * check is not cosmetic — this text is stored, re-served to every other player,
 * and written to the activity feed, and a newline in it forges a second line in
 * anything that formats one record per line, including the log.
 *
 * Length is measured in code points, not UTF-16 units, so a cap of 280 means 280
 * characters whether they are Latin or emoji rather than 140 of one and 280 of
 * the other.
 */
export function requireBoundedText(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  const text = requireString(value, path).trim();
  if (text.length === 0) {
    throw new ContractValidationError(path, "must not be empty");
  }
  if (hasControlCharacter(text)) {
    throw new ContractValidationError(path, "must not contain control characters");
  }
  if ([...text].length > maximumLength) {
    throw new ContractValidationError(
      path,
      `must be at most ${String(maximumLength)} characters`,
    );
  }

  return text;
}

/** An absolute ISO-8601 instant, as `Date#toISOString` produces. */
export function requireIsoInstant(value: unknown, path: string): string {
  const text = requireString(value, path);
  if (WHITESPACE_PATTERN.test(text) || text.length > 32) {
    throw new ContractValidationError(path, "must be an ISO-8601 instant");
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    throw new ContractValidationError(path, "must be an ISO-8601 instant");
  }

  return text;
}

/**
 * Bounds on the free-form JSON a few command payloads carry (`choice` on a card
 * play, `value` on a ballot cast).
 *
 * These fields exist because the engine's option vocabulary is content-authored
 * and contracts cannot know it. That makes them the only untyped hole in the
 * transport surface, so they get *structural* limits instead: a body that is
 * valid JSON is not automatically a body worth parsing, and without a depth and
 * node ceiling a 3 MB nest of arrays is a free denial of service on every
 * request handler and every jsonb write behind it.
 */
export const JSON_VALUE_MAX_DEPTH = 5;
export const JSON_VALUE_MAX_NODES = 256;
export const JSON_VALUE_MAX_ENTRIES = 32;
export const JSON_VALUE_MAX_STRING_LENGTH = 512;
export const JSON_VALUE_MAX_KEY_LENGTH = 64;

export function parseBoundedJsonValue(value: unknown, path: string): JsonValue {
  let nodes = 0;

  function walk(candidate: unknown, depth: number): JsonValue {
    nodes += 1;
    if (nodes > JSON_VALUE_MAX_NODES) {
      throw new ContractValidationError(path, "must be a small JSON value");
    }
    if (depth > JSON_VALUE_MAX_DEPTH) {
      throw new ContractValidationError(path, "must not be deeply nested");
    }

    if (candidate === null || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw new ContractValidationError(path, "must not contain a non-finite number");
      }
      return candidate;
    }
    if (typeof candidate === "string") {
      if (candidate.length > JSON_VALUE_MAX_STRING_LENGTH) {
        throw new ContractValidationError(path, "must not contain a long string");
      }
      if (hasControlCharacter(candidate)) {
        throw new ContractValidationError(
          path,
          "must not contain control characters",
        );
      }
      return candidate;
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > JSON_VALUE_MAX_ENTRIES) {
        throw new ContractValidationError(path, "must not contain a long array");
      }
      return candidate.map((entry) => walk(entry, depth + 1));
    }
    if (isRecord(candidate)) {
      // A plain object only. A `Date`, `Map`, `Set` or class instance is a
      // record by `typeof`, but each one means something different after a JSON
      // round trip than it does now — a `Date` becomes a string, a `Map` becomes
      // `{}` — so accepting one would mean vouching for a value that changes when
      // it is stored. Bodies parsed from a request are always plain, so this only
      // ever fires on an in-process caller.
      const prototype: unknown = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new ContractValidationError(path, "must be a plain JSON object");
      }

      const keys = Object.keys(candidate);
      if (keys.length > JSON_VALUE_MAX_ENTRIES) {
        throw new ContractValidationError(path, "must not contain a wide object");
      }
      const result: Record<string, JsonValue> = {};
      for (const key of keys) {
        if (key.length === 0 || key.length > JSON_VALUE_MAX_KEY_LENGTH) {
          throw new ContractValidationError(path, "contains an unusable key");
        }
        if (POISONED_KEYS.has(key)) {
          throw new ContractValidationError(path, "contains a reserved key");
        }
        result[key] = walk(candidate[key], depth + 1);
      }
      return result;
    }

    // `undefined`, a function, a symbol, a bigint: none survive JSON transport,
    // so accepting one would mean accepting a value that changes shape when it
    // is stored.
    throw new ContractValidationError(path, "must be a JSON value");
  }

  return walk(value, 0);
}

export function parseBoundedJsonObject(value: unknown, path: string): JsonObject {
  const parsed = parseBoundedJsonValue(requireObject(value, path), path);
  if (!isRecord(parsed)) {
    throw new ContractValidationError(path, "must be an object");
  }

  return parsed as JsonObject;
}
