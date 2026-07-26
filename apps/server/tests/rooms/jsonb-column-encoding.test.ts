import { describe, expect, it } from "vitest";

import {
  commandReceipts,
  gameEvents,
  gameOutbox,
  games,
  playerProjections,
  roomProjections,
  rooms,
} from "@office-ladder/db/schema";

/**
 * The encoding contract for every jsonb column in the schema.
 *
 * The bug this pins down: drizzle's own `jsonb()` maps a value to the driver with
 * `JSON.stringify`, and the `bun-sql` driver serialises anything bound to a jsonb
 * parameter *again*, so the column ended up holding a JSON **string**.
 * `jsonb_typeof(projection)` returned `'string'`, `jsonb_object_keys` failed with
 * 22023, and nothing about a live match could be indexed or queried in SQL. It
 * hid for as long as it did because the second encoding reverses itself on read:
 * every round-trip test passed throughout.
 *
 * That is exactly why the assertions here are about the **driver-facing** value
 * rather than about a round trip. A round trip cannot see this class of bug, and
 * the real proof lives where it has to —
 * `tests/rooms/verify-jsonb-encoding.ts`, run against Postgres, because
 * `vitest.config.ts` stubs the `bun` module and nothing in this suite can open a
 * connection.
 */

/** Every jsonb column in packages/db, named as SQL names it. */
const JSONB_COLUMNS = [
  ["rooms.custom_rules", rooms.customRules],
  ["games.canonical_state", games.canonicalState],
  ["game_events.canonical_payload", gameEvents.canonicalPayload],
  ["command_receipts.response_payload", commandReceipts.responsePayload],
  ["room_projections.projection", roomProjections.projection],
  ["player_projections.projection", playerProjections.projection],
  ["game_outbox.payload", gameOutbox.payload],
] as const;

/** A room snapshot in miniature: nesting, an empty container of each kind, and a
 * string that is itself JSON — the value most likely to be mangled by a decoder
 * that reaches past the top level. */
const SNAPSHOT = {
  id: "room-jsonb",
  revision: 7,
  status: "active",
  memberIds: ["ada", "blake"],
  memberAvatars: {},
  eventSummaries: [],
  customRules: null,
  game: {
    turn: { round: 2, activePlayerId: "ada" },
    players: { ada: { money: -50, energy: 0.5, note: '{"not":"parsed"}' } },
    rng: { cursor: 12 },
  },
} as const;

describe("jsonb columns store JSON, not a JSON string", () => {
  it.each(JSONB_COLUMNS)(
    "Given %s, When a value is written, Then the driver is handed the value itself and not stringified JSON",
    (_name, column) => {
      const driverValue = column.mapToDriverValue(SNAPSHOT);

      // The whole bug in one assertion. `JSON.stringify` here is what Postgres
      // then stored as a jsonb scalar.
      expect(typeof driverValue).not.toBe("string");
      // Identity, not just deep equality: this mapping must not copy, reorder or
      // re-serialise the snapshot on its way out either.
      expect(driverValue).toBe(SNAPSHOT);
    },
  );

  it.each(JSONB_COLUMNS)(
    "Given %s, When the schema is compared with the plain jsonb column it replaced, Then it is still the same SQL type",
    (_name, column) => {
      // Migration 0004 is pure data movement and drizzle-kit must see no diff. If
      // this ever reports anything but jsonb, the generated migrations and the
      // live database have silently parted company.
      expect(column.getSQLType()).toBe("jsonb");
    },
  );

  it.each(JSONB_COLUMNS)(
    "Given %s holding a row written after the fix, When it is read, Then the parsed object passes straight through",
    (_name, column) => {
      // Bun parses jsonb for us, so a correctly-stored object arrives as an
      // object. Nothing may touch it — least of all a second JSON.parse.
      const parsed = JSON.parse(JSON.stringify(SNAPSHOT)) as unknown;

      expect(column.mapFromDriverValue(parsed)).toBe(parsed);
    },
  );

  it.each(JSONB_COLUMNS)(
    "Given %s holding a row written before the fix, When it is read, Then the double encoding is still undone",
    (_name, column) => {
      // A pre-0004 row is a jsonb string, which arrives here as a JS string. This
      // tolerance is what stops a database the migration has not reached — a
      // replica, a restored backup, a developer's own Postgres — from losing
      // every match on it.
      expect(column.mapFromDriverValue(JSON.stringify(SNAPSHOT))).toEqual(SNAPSHOT);
    },
  );
});

describe("the read path is tolerant without being lossy", () => {
  it("Given a value that went through the write and read mappings, When it comes back, Then it is unchanged", () => {
    const column = roomProjections.projection;

    const stored = JSON.parse(JSON.stringify(column.mapToDriverValue(SNAPSHOT))) as unknown;

    expect(column.mapFromDriverValue(stored)).toEqual(SNAPSHOT);
  });

  it("Given a nested string that happens to contain JSON, When the value is read, Then only the top level is decoded", () => {
    const column = roomProjections.projection;

    const decoded = column.mapFromDriverValue(JSON.stringify(SNAPSHOT)) as typeof SNAPSHOT;

    // A decoder that walked the whole tree would turn this note into an object
    // and quietly rewrite stored content.
    expect(decoded.game.players.ada.note).toBe('{"not":"parsed"}');
  });

  it("Given a stored string that is not JSON at all, When it is read, Then it is returned as that string rather than discarded", () => {
    // No column in this schema stores a bare string, so this is about the shim
    // failing safe: an undecodable value is handed back, never dropped.
    expect(roomProjections.projection.mapFromDriverValue("not json {")).toBe("not json {");
  });

  it("Given the scalar shapes a JSON column may legitimately hold, When they are written, Then they are passed through for the driver to encode", () => {
    const column = rooms.customRules;

    // The old stringify turned each of these into text that Postgres re-parsed;
    // handing the driver the value means a number stores as a jsonb number.
    expect(column.mapToDriverValue(0)).toBe(0);
    expect(column.mapToDriverValue(false)).toBe(false);
    expect(column.mapToDriverValue("a note")).toBe("a note");
    expect(column.mapToDriverValue([])).toEqual([]);
  });
});
