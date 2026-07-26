import { describe, expect, it } from "vitest";

import { deadlineDashModes } from "@office-ladder/content";
import {
  createStableId,
  type CardDrawnEvent,
  type DiceRolledEvent,
  type GameStartedEvent,
  type ModeRules,
} from "@office-ladder/engine";
import { eventSummaries, setupFor } from "../../src/rooms/service/game-setup";
import type { StoredRoom } from "../../src/rooms/service/types";

const actorId = createStableId("PlayerId", "command-actor");
const drawnByPlayerId = createStableId("PlayerId", "card-recipient");

describe("eventSummaries", () => {
  it("Given CardDrawn and non-card events, When creating summaries, Then only CardDrawn retains its safe card metadata and payload actor", () => {
    const cardDrawn = {
      eventId: createStableId("EventId", "event-card-drawn"),
      gameId: createStableId("GameId", "game-event-summary"),
      sequence: 4,
      revision: 2,
      causationCommandId: createStableId("CommandId", "command-event-summary"),
      correlationFrameId: null,
      logicalTimestamp: "2026-07-24T12:00:00.000Z",
      schemaVersion: 1,
      visibility: { kind: "public" },
      type: "CardDrawn",
      payload: {
        playerId: drawnByPlayerId,
        cardId: createStableId("CardDefinitionId", "card.event.jackpot"),
        deckId: createStableId("DeckId", "deck.event"),
        nameKey: "deadlineDash.card.eventJackpot.name",
      },
    } satisfies CardDrawnEvent;
    const gameStarted = {
      ...cardDrawn,
      eventId: createStableId("EventId", "event-game-started"),
      type: "GameStarted",
      payload: { playerOrder: [actorId] },
    } satisfies GameStartedEvent;

    const summaries = eventSummaries([cardDrawn, gameStarted], actorId);

    expect(summaries).toEqual([
      {
        id: "event-card-drawn",
        type: "CardDrawn",
        revision: 2,
        occurredAt: "2026-07-24T12:00:00.000Z",
        actorPlayerId: "card-recipient",
        card: {
          definitionId: "card.event.jackpot",
          deckId: "deck.event",
          nameKey: "deadlineDash.card.eventJackpot.name",
        },
      },
      {
        id: "event-game-started",
        type: "GameStarted",
        revision: 2,
        occurredAt: "2026-07-24T12:00:00.000Z",
        actorPlayerId: "command-actor",
      },
    ]);
  });

  it("Given a DiceRolled event, When creating summaries, Then the faces are exposed and the RNG bookkeeping is not", () => {
    const diceRolled = {
      eventId: createStableId("EventId", "event-dice-rolled"),
      gameId: createStableId("GameId", "game-event-summary"),
      sequence: 2,
      revision: 3,
      causationCommandId: createStableId("CommandId", "command-event-summary"),
      correlationFrameId: null,
      logicalTimestamp: "2026-07-24T12:00:00.000Z",
      schemaVersion: 1,
      visibility: { kind: "public" },
      type: "DiceRolled",
      payload: {
        playerId: drawnByPlayerId,
        dice: [4],
        total: 4,
        purpose: "movement",
        rngStream: "dice",
        rngCursor: 7,
      },
    } satisfies DiceRolledEvent;

    const summaries = eventSummaries([diceRolled], actorId);

    expect(summaries).toEqual([
      {
        id: "event-dice-rolled",
        type: "DiceRolled",
        revision: 3,
        occurredAt: "2026-07-24T12:00:00.000Z",
        actorPlayerId: "card-recipient",
        dice: [4],
        total: 4,
        purpose: "movement",
      },
    ]);
    expect(JSON.stringify(summaries)).not.toContain("rng");
  });
});

/**
 * Hidden roles must not be readable off the public projection.
 *
 * The rule this replaced was `(order + 1) % 3 === 0`, and `order` is published to
 * every client as `member.seat`. That is not a leak at the edges of a hidden-role
 * game — it *is* the hidden-role game: seats 2 and 5 were Management in every
 * match ever played, so any player who could count could name them before the
 * first roll.
 *
 * The tests below are therefore statistical rather than a fixture comparison. A
 * fixture would only prove the assignment changed; what has to hold is that seat
 * number carries no information about role, and that is a property of the
 * *distribution* over seeds. The seed is server-side only — a
 * `crypto.randomUUID()` in rooms/default-service.ts that appears in no
 * projection — so a distribution an observer cannot condition on is exactly what
 * the secret is made of.
 */
const SEED_COUNT = 300;
const TABLE_SIZE = 6;
/** floor(6 / 3) — kept identical to the old rule, so the balance did not change. */
const EXPECTED_MANAGEMENT = 2;
/** What the old, leaking rule named at a table of six. */
const OLD_RULE_SEATS = [2, 5] as const;

const ROLES_ON: ModeRules = deadlineDashModes["mode.standard"].rules;
const ROLES_OFF: ModeRules = deadlineDashModes["mode.quick"].rules;

function tableOf(size: number): StoredRoom {
  const memberIds = Array.from({ length: size }, (_unused, index) =>
    createStableId("PlayerId", `seat-${index}`),
  );
  const hostId = memberIds[0];
  if (hostId === undefined) throw new TypeError("A table needs at least one seat");

  return {
    id: "room-hidden-roles",
    code: "HID123",
    hostId,
    memberIds,
    memberNames: {},
    memberAvatars: {},
    memberCharacters: {},
    modeId: "mode.quick",
    capacity: 6,
    status: "open",
    revision: 0,
    createdAt: "2026-07-27T12:00:00.000Z",
    game: null,
    eventSummaries: [],
    bots: [],
    turnTimer: null,
  } satisfies StoredRoom;
}

/** The seat indices holding `role.management` for one seed. */
function managementSeatsFor(room: StoredRoom, seed: string, rules: ModeRules): number[] {
  const setup = setupFor(room, createStableId("GameId", "game-hidden-roles"), seed, rules);
  return setup.players
    .filter((player) => player.role.kind === "role.management")
    .map((player) => player.order)
    .sort((left, right) => left - right);
}

describe("hidden role assignment", () => {
  const room = tableOf(TABLE_SIZE);
  const seeds = Array.from({ length: SEED_COUNT }, (_unused, index) => `seed-${index}`);
  const draws = seeds.map((seed) => managementSeatsFor(room, seed, ROLES_ON));

  it("Given many seeds, When roles are assigned, Then every seat is sometimes Management and sometimes not", () => {
    for (let seat = 0; seat < TABLE_SIZE; seat += 1) {
      const asManagement = draws.filter((seats) => seats.includes(seat)).length;
      // Two opposite failures, both fatal: a seat that is never Management is a
      // seat every player can trust, and one that always is is a seat every
      // player can accuse.
      expect(asManagement, `seat ${seat} was never Management`).toBeGreaterThan(0);
      expect(asManagement, `seat ${seat} was always Management`).toBeLessThan(SEED_COUNT);
    }
  });

  it("Given many seeds, When roles are assigned, Then no seat is Management far more often than any other", () => {
    // Two of six seats, so the honest rate is 1/3. The band is wide enough that
    // 300 draws will not trip it by chance, and narrow enough that a rule which
    // favours a seat — the whole failure mode here — cannot sit inside it.
    const expected = (SEED_COUNT * EXPECTED_MANAGEMENT) / TABLE_SIZE;
    for (let seat = 0; seat < TABLE_SIZE; seat += 1) {
      const asManagement = draws.filter((seats) => seats.includes(seat)).length;
      expect(asManagement, `seat ${seat} rate`).toBeGreaterThan(expected * 0.5);
      expect(asManagement, `seat ${seat} rate`).toBeLessThan(expected * 1.5);
    }
  });

  it("Given the seats the old rule named, When they are used as a prediction, Then they are no better than a guess", () => {
    const predicted = draws.filter(
      (seats) => seats.join(",") === OLD_RULE_SEATS.join(","),
    ).length;

    // One of the fifteen two-seat combinations at a table of six, so ~6.7% is
    // chance level. The old rule scored 100%.
    expect(predicted / SEED_COUNT).toBeLessThan(0.25);
  });

  it("Given many seeds, When roles are assigned, Then the number of Management seats never varies", () => {
    // Unpredictability must not have cost the balance: floor(n / 3), always, and
    // never the same seat twice.
    expect(new Set(draws.map((seats) => seats.length))).toEqual(
      new Set([EXPECTED_MANAGEMENT]),
    );
    expect(draws.every((seats) => new Set(seats).size === seats.length)).toBe(true);
  });

  it("Given one seed, When setup runs twice, Then the same seats are Management", () => {
    // Replay depends on this: roles are re-derived from the seed, never stored
    // alongside the events.
    expect(managementSeatsFor(room, "seed-replay", ROLES_ON)).toEqual(
      managementSeatsFor(room, "seed-replay", ROLES_ON),
    );
    expect(managementSeatsFor(room, "seed-a", ROLES_ON)).not.toEqual(
      managementSeatsFor(room, "seed-b", ROLES_ON),
    );
  });

  it("Given a ruleset with hidden roles off, When roles are assigned, Then no seat holds one", () => {
    // Spec §4: a mechanic that cannot be switched off from config is a bug. With
    // the mechanic off there is nothing to hide, so this is uniform rather than
    // random on purpose.
    expect(ROLES_OFF.hidden.rolesEnabled).toBe(false);
    for (const seed of seeds.slice(0, 20)) {
      expect(managementSeatsFor(room, seed, ROLES_OFF)).toEqual([]);
    }
  });

  it.each([3, 4, 5, 6])(
    "Given a table of %i, When roles are assigned, Then the Management count is a third of the table",
    (size) => {
      const seats = managementSeatsFor(tableOf(size), "seed-table-size", ROLES_ON);
      expect(seats).toHaveLength(Math.floor(size / 3));
      expect(seats.every((seat) => seat >= 0 && seat < size)).toBe(true);
    },
  );
});
