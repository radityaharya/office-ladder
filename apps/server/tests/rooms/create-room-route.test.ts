/**
 * `POST /api/rooms`, exercised through the real Hono router.
 *
 * The service tests next door prove that a stored ruleset is resolved and frozen
 * correctly. What only a route test can show is the half in front of that: the
 * chosen mode and an authored ruleset have to survive the *request boundary* —
 * the DTO parser, the same-origin guard and the session — and arrive at the
 * service still meaning what the host chose. A ruleset the lobby can select and
 * the route then drops is indistinguishable, from the table's point of view,
 * from no configurable ruleset at all.
 *
 * The session and the room service are the only substitutions. The service is a
 * *real* one over the in-memory repository rather than a spy, because the
 * property under test is what ends up stored, and a spy would happily record a
 * ruleset that `parseModeRules` would have refused.
 */
import type { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deadlineDashModes, deadlineDashRanks } from "@office-ladder/content";
import { DEADLINE_DASH_RANK_LADDER_LENGTH, ROOM_MODES } from "@office-ladder/contracts";
import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService } from "../../src/rooms/service/types";

const HOST = "user-route-host";
const ORIGIN = "http://localhost:3072";
const ROOM_ID = "room-create-route";
const ROOM_CODE = "RTE123";

const STANDARD_RULES = deadlineDashModes["mode.standard"].rules;

const harness = vi.hoisted(() => ({
  service: null as RoomService | null,
  authenticated: true,
}));

vi.mock("@/auth/require-session", () => ({
  requireSession: async () =>
    harness.authenticated
      ? { ok: true, value: { user: { id: HOST, image: null } } }
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
      gameId: () => createStableId("GameId", "game-create-route"),
      commandId: () => createStableId("CommandId", "command-create-route"),
    },
    gameSeed: () => "create-route-seed",
    turnTimeoutMs: 0,
  });
  harness.authenticated = true;
  ({ roomsRouter: app } = await import("../../src/routes/rooms"));
});

function createRoom(body: unknown): Request {
  return new Request(`${ORIGIN}/`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  mode: "mode.quick",
  capacity: 3,
  playerName: "Host",
} as const;

describe("POST /rooms", () => {
  // Every mode the contract admits, not a sample of two: the whole point of this
  // round is that a host can pick any of the four shipped presets, and a route
  // that happened to work for Quick and Marathon is precisely the state this
  // repository was already in.
  it.each(ROOM_MODES)(
    "Given a body naming %s, When the room is created, Then the stored room carries that mode",
    async (mode) => {
      const response = await app.request(createRoom({ ...validBody, mode }));

      expect(response.status).toBe(201);
      expect((await repository.get(ROOM_ID))?.modeId).toBe(mode);
    },
  );

  it("Given a body carrying a valid ruleset, When the room is created, Then the ruleset reaches storage", async () => {
    const response = await app.request(createRoom({ ...validBody, rules: STANDARD_RULES }));

    expect(response.status).toBe(201);
    expect((await repository.get(ROOM_ID))?.customRules).toEqual(STANDARD_RULES);
  });

  it("Given the ruleset under the old `customRules` name, When it is posted, Then the request is refused rather than quietly ignored", async () => {
    // `rules` is the field `CreateRoomRequest` declares and the field the lobby
    // posts. This route used to read a *second*, undeclared name off the raw
    // body, and while the two disagreed a custom room silently played its base
    // preset — the body parsed, the ruleset validated, and the handler dropped
    // it. One name, and anything else is a 400 rather than a silent downgrade.
    const response = await app.request(
      createRoom({ ...validBody, customRules: STANDARD_RULES }),
    );

    expect(response.status).toBe(400);
    expect(await repository.get(ROOM_ID)).toBeNull();
  });

  it("Given a body with no ruleset, When the room is created, Then it plays its mode preset", async () => {
    const response = await app.request(createRoom(validBody));

    expect(response.status).toBe(201);
    expect((await repository.get(ROOM_ID))?.customRules).toBeNull();
  });

  it("Given the contract's own rank-ladder fallback, When it is compared with the content pack, Then they agree", () => {
    // `upkeepByRankIndex` is validated against a length, and contracts cannot
    // import the content pack, so its fallback is a hand-kept number. This test
    // is the only place both values are visible at once. The route passes the
    // pack's real length so it agrees with the room service either way, but a
    // drifted fallback would still silently mis-validate for anyone who relies
    // on the default — the same class of unprovable mirror that let ROOM_MODES
    // sit two entries short of the pack for four waves.
    expect(DEADLINE_DASH_RANK_LADDER_LENGTH).toBe(deadlineDashRanks.length);
  });

  it.each(ROOM_MODES)(
    "Given a ruleset authored from %s's own preset, When it is posted back, Then it is accepted",
    async (mode) => {
      // Every shipped preset must be re-postable as a custom ruleset: the lobby
      // builder seeds its draft from a preset, so a preset the validator refuses
      // is a mode nobody can customise. This is also the check that would fail
      // if the ladder length above ever drifted.
      const response = await app.request(
        createRoom({ ...validBody, mode, rules: deadlineDashModes[mode].rules }),
      );

      expect(response.status).toBe(201);
      expect((await repository.get(ROOM_ID))?.customRules).toEqual(
        deadlineDashModes[mode].rules,
      );
    },
  );

  it("Given a body whose ruleset a client-side check would have caught, When it is posted anyway, Then the server refuses it", async () => {
    // The whole point of §8.4: the browser's own bounds are a convenience, and
    // this request never went near them.
    const rules = JSON.parse(JSON.stringify(STANDARD_RULES)) as Record<string, unknown>;
    rules["agency"] = {
      ...(rules["agency"] as Record<string, unknown>),
      maxPipAdjust: 99,
    };

    const response = await app.request(createRoom({ ...validBody, rules }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_MODE_RULES" } });
    expect(await repository.get(ROOM_ID)).toBeNull();
  });

  it("Given a body with an unknown field, When it is posted, Then it is still refused", async () => {
    // Making room for `rules` must not have made room for anything else: a
    // typo'd field is a 400, not a silently ignored preference.
    const response = await app.request(
      createRoom({ ...validBody, houseRule: "the host always wins" }),
    );

    expect(response.status).toBe(400);
    expect(await repository.get(ROOM_ID)).toBeNull();
  });

  it("Given no session, When a room is created, Then nothing is stored", async () => {
    harness.authenticated = false;

    const response = await app.request(createRoom(validBody));

    expect(response.status).toBe(401);
    expect(await repository.get(ROOM_ID)).toBeNull();
  });

  it("Given a cross-origin request, When a room is created, Then nothing is stored", async () => {
    const response = await app.request(
      new Request(`${ORIGIN}/`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ ...validBody, rules: STANDARD_RULES }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await repository.get(ROOM_ID)).toBeNull();
  });
});
