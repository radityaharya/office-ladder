/**
 * `PUT /api/rooms/:roomId/rules` and `DELETE /api/rooms/:roomId/rules`, exercised
 * through the real Hono router.
 *
 * `roomService.setModeRules` and contracts' `parseSetModeRulesRequest` both
 * shipped rounds before anything connected them, so a ruleset was settable only
 * at create time: a host could not adjust the terms in the lobby at all, however
 * complete the two halves either side of the gap were. These tests are the gap
 * closed — and, more usefully, the guards held *at the request boundary*, where a
 * hostile client actually arrives:
 *
 * - a member who is not the host cannot rewrite the terms everyone else sat down
 *   under,
 * - nobody can rewrite them once the match is running, because the ruleset is
 *   frozen into `GameState.rules` at `game.start` and a room-level edit would be a
 *   rule change no replay of the stored snapshot could reproduce,
 * - a ruleset the server's own bounds refuse is a 400 that names the *ruleset*,
 *   not a bare "bad request" a host who authored 26 fields cannot act on.
 *
 * The service is a real one over the in-memory repository rather than a spy, for
 * the reason `create-room-route.test.ts` gives: the property under test is what
 * ends up stored, and a spy would happily record a ruleset `parseModeRules` would
 * have refused.
 */
import type { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deadlineDashModes, deadlineDashRanks } from "@office-ladder/content";
import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import { resolveModeRules } from "../../src/rooms/service/game-setup";
import type { RoomService } from "../../src/rooms/service/types";

const HOST = "user-rules-host";
const SECOND = "user-rules-second";
const THIRD = "user-rules-third";
const ORIGIN = "http://localhost:3072";
const ROOM_ID = "room-rules-route";
const ROOM_CODE = "RUL123";

const QUICK_RULES = deadlineDashModes["mode.quick"].rules;
const STANDARD_RULES = deadlineDashModes["mode.standard"].rules;

const harness = vi.hoisted(() => ({
  service: null as RoomService | null,
  authenticated: true,
  /** Whose session the request arrives on. Every actor guard reads this. */
  userId: "user-rules-host",
}));

vi.mock("@/auth/require-session", () => ({
  requireSession: async () =>
    harness.authenticated
      ? { ok: true, value: { user: { id: harness.userId, image: null } } }
      : { ok: false, error: { code: "UNAUTHORIZED", status: 401 } },
}));

vi.mock("@/rooms/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/rooms/service")>()),
  get roomService() {
    if (harness.service === null) throw new Error("The test forgot to build a service");
    return harness.service;
  },
}));

let repository: InMemoryRoomRepository;
let app: Hono;

beforeEach(async () => {
  repository = new InMemoryRoomRepository();
  harness.service = createRoomService({
    repository,
    now: () => "2026-07-27T12:00:00.000Z",
    ids: {
      roomId: () => ROOM_ID,
      roomCode: () => ROOM_CODE,
      gameId: () => createStableId("GameId", "game-rules-route"),
      commandId: () => createStableId("CommandId", "command-rules-route"),
    },
    gameSeed: () => "rules-route-seed",
    turnTimeoutMs: 0,
  });
  harness.authenticated = true;
  harness.userId = HOST;
  ({ roomsRouter: app } = await import("../../src/routes/rooms"));
});

/** A lobby of three on `mode.quick`, playing its preset. */
async function lobbyOfThree(): Promise<void> {
  const service = harness.service;
  if (service === null) throw new Error("no service");
  await service.create({ hostId: HOST, playerName: "Host", modeId: "mode.quick" });
  await service.join({ roomId: ROOM_ID, actorId: SECOND, playerName: "Second" });
  await service.join({ roomId: ROOM_ID, actorId: THIRD, playerName: "Third" });
}

function setRules(body: unknown, roomId = ROOM_ID): Request {
  return new Request(`${ORIGIN}/${roomId}/rules`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function clearRules(roomId = ROOM_ID): Request {
  return new Request(`${ORIGIN}/${roomId}/rules`, {
    method: "DELETE",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin" },
  });
}

/** A structural clone, so a test can bend one field without touching the pack. */
function bend(section: string, patch: Record<string, unknown>): Record<string, unknown> {
  const rules = JSON.parse(JSON.stringify(STANDARD_RULES)) as Record<string, unknown>;
  rules[section] = { ...(rules[section] as Record<string, unknown>), ...patch };
  return rules;
}

describe("PUT /rooms/:roomId/rules", () => {
  it("Given the host in the lobby, When a ruleset is put, Then it reaches storage and the room resolves to it", async () => {
    await lobbyOfThree();
    const before = await repository.get(ROOM_ID);

    const response = await app.request(setRules({ rules: STANDARD_RULES }));

    expect(response.status).toBe(200);
    const stored = await repository.get(ROOM_ID);
    expect(stored?.customRules).toEqual(STANDARD_RULES);
    // Not merely stored: this is the value `start` will freeze into the match.
    expect(resolveModeRules(stored!)).toEqual(STANDARD_RULES);
    // A ruleset change is a room mutation like any other, so the revision moves —
    // which is what makes every other client's next read see the new terms.
    expect(stored?.revision).toBe((before?.revision ?? 0) + 1);
    expect(await response.json()).toEqual({
      room: { id: ROOM_ID, revision: stored?.revision },
    });
  });

  it.each(Object.keys(deadlineDashModes))(
    "Given %s's own preset authored back as a ruleset, When it is put, Then it is accepted",
    async (mode) => {
      // The lobby builder seeds its draft from a preset, so a preset the
      // validator refuses is a mode nobody can customise. Same property the
      // create route asserts, checked on the other door.
      await lobbyOfThree();

      const response = await app.request(
        setRules({ rules: deadlineDashModes[mode as keyof typeof deadlineDashModes].rules }),
      );

      expect(response.status).toBe(200);
      expect((await repository.get(ROOM_ID))?.customRules).toEqual(
        deadlineDashModes[mode as keyof typeof deadlineDashModes].rules,
      );
    },
  );

  it("Given a member who is not the host, When they put a ruleset, Then it is refused and nothing is stored", async () => {
    await lobbyOfThree();
    harness.userId = SECOND;

    const response = await app.request(setRules({ rules: STANDARD_RULES }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "ACTOR_NOT_HOST" } });
    expect((await repository.get(ROOM_ID))?.customRules).toBeNull();
  });

  it("Given somebody who is not in the room at all, When they put a ruleset, Then it is refused", async () => {
    await lobbyOfThree();
    harness.userId = "user-rules-stranger";

    const response = await app.request(setRules({ rules: STANDARD_RULES }));

    expect(response.status).toBe(403);
    expect((await repository.get(ROOM_ID))?.customRules).toBeNull();
  });

  it("Given a match already running, When the host puts a ruleset, Then it is refused and the frozen rules stand", async () => {
    await lobbyOfThree();
    const service = harness.service!;
    const started = await service.start({ roomId: ROOM_ID, actorId: HOST, actorKind: "human" });
    expect(started.ok).toBe(true);

    const response = await app.request(setRules({ rules: STANDARD_RULES }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "ROOM_NOT_OPEN" } });
    // The running match is still playing what it started under, in canonical
    // state — the thing every replay of this room depends on.
    const stored = await repository.get(ROOM_ID);
    expect(stored?.customRules).toBeNull();
    expect(stored?.game?.rules).toEqual(QUICK_RULES);
  });

  it.each([
    ["an unbounded pip adjustment", bend("agency", { maxPipAdjust: 99 })],
    ["a negative interest rate", bend("economy", { interestBasisPoints: -500 })],
    [
      "an upkeep ladder one entry short of the rank ladder",
      bend("economy", {
        upkeepByRankIndex: Array.from({ length: deadlineDashRanks.length - 1 }, () => 10),
      }),
    ],
  ])(
    "Given %s, When it is put, Then the server refuses it as a bad ruleset",
    async (_label, rules) => {
      await lobbyOfThree();

      const response = await app.request(setRules({ rules }));

      // Named as a ruleset rejection rather than collapsed into the generic
      // INVALID_REQUEST every other malformed field gets: the host authored 26
      // fields and has to be told which layer objected.
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "INVALID_MODE_RULES" } });
      expect((await repository.get(ROOM_ID))?.customRules).toBeNull();
    },
  );

  it("Given a body with no ruleset at all, When it is put, Then it is refused rather than read as a clear", async () => {
    await lobbyOfThree();
    const service = harness.service!;
    await service.setModeRules({ roomId: ROOM_ID, actorId: HOST, rules: STANDARD_RULES });

    const response = await app.request(setRules({}));

    // Clearing is DELETE. An empty PUT must not quietly mean "return this room to
    // its preset" — that is a rule change nobody at the table asked for.
    expect(response.status).toBe(400);
    expect((await repository.get(ROOM_ID))?.customRules).toEqual(STANDARD_RULES);
  });

  it("Given a body carrying an unknown field beside the ruleset, When it is put, Then it is refused", async () => {
    await lobbyOfThree();

    const response = await app.request(
      setRules({ rules: STANDARD_RULES, houseRule: "the host always wins" }),
    );

    expect(response.status).toBe(400);
    expect((await repository.get(ROOM_ID))?.customRules).toBeNull();
  });

  it("Given no session, When a ruleset is put, Then nothing is stored", async () => {
    await lobbyOfThree();
    harness.authenticated = false;

    const response = await app.request(setRules({ rules: STANDARD_RULES }));

    expect(response.status).toBe(401);
    expect((await repository.get(ROOM_ID))?.customRules).toBeNull();
  });

  it("Given a cross-origin request, When a ruleset is put, Then nothing is stored", async () => {
    await lobbyOfThree();

    const response = await app.request(
      new Request(`${ORIGIN}/${ROOM_ID}/rules`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ rules: STANDARD_RULES }),
      }),
    );

    expect(response.status).toBe(403);
    expect((await repository.get(ROOM_ID))?.customRules).toBeNull();
  });

  it("Given a room that does not exist, When a ruleset is put, Then it answers not-found", async () => {
    const response = await app.request(setRules({ rules: STANDARD_RULES }, "room-absent"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "ROOM_NOT_FOUND" } });
  });
});

describe("DELETE /rooms/:roomId/rules", () => {
  it("Given an authored ruleset, When it is cleared, Then the room returns to its mode preset", async () => {
    await lobbyOfThree();
    const service = harness.service!;
    await service.setModeRules({ roomId: ROOM_ID, actorId: HOST, rules: STANDARD_RULES });

    const response = await app.request(clearRules());

    expect(response.status).toBe(200);
    const stored = await repository.get(ROOM_ID);
    expect(stored?.customRules).toBeNull();
    expect(resolveModeRules(stored!)).toEqual(QUICK_RULES);
  });

  it("Given a room with no authored ruleset, When it is cleared again, Then it is still accepted", async () => {
    await lobbyOfThree();

    const first = await app.request(clearRules());
    const second = await app.request(clearRules());

    // Idempotent: a cleared room and a never-authored one are the same room, so a
    // retried DELETE reports the current revision rather than failing.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await repository.get(ROOM_ID))?.customRules).toBeNull();
  });

  it("Given a member who is not the host, When they clear the ruleset, Then it is refused", async () => {
    await lobbyOfThree();
    const service = harness.service!;
    await service.setModeRules({ roomId: ROOM_ID, actorId: HOST, rules: STANDARD_RULES });
    harness.userId = SECOND;

    const response = await app.request(clearRules());

    expect(response.status).toBe(403);
    expect((await repository.get(ROOM_ID))?.customRules).toEqual(STANDARD_RULES);
  });

  it("Given a match already running, When the host clears the ruleset, Then it is refused", async () => {
    await lobbyOfThree();
    const service = harness.service!;
    await service.setModeRules({ roomId: ROOM_ID, actorId: HOST, rules: STANDARD_RULES });
    const started = await service.start({ roomId: ROOM_ID, actorId: HOST, actorKind: "human" });
    expect(started.ok).toBe(true);

    const response = await app.request(clearRules());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "ROOM_NOT_OPEN" } });
    expect((await repository.get(ROOM_ID))?.game?.rules).toEqual(STANDARD_RULES);
  });

  it("Given a cross-origin request, When the ruleset is cleared, Then it is refused", async () => {
    await lobbyOfThree();
    const service = harness.service!;
    await service.setModeRules({ roomId: ROOM_ID, actorId: HOST, rules: STANDARD_RULES });

    const response = await app.request(
      new Request(`${ORIGIN}/${ROOM_ID}/rules`, {
        method: "DELETE",
        headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      }),
    );

    expect(response.status).toBe(403);
    expect((await repository.get(ROOM_ID))?.customRules).toEqual(STANDARD_RULES);
  });
});
