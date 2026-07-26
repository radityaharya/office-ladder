import { describe, expect, it } from "vitest";

import { deadlineDashModes, deadlineDashRanks } from "@office-ladder/content";
import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import { resolveModeRules } from "../../src/rooms/service/game-setup";
import type { RoomService } from "../../src/rooms/service/types";

/**
 * The lobby-authored ruleset (spec §4, §8.4) and the guarantee that the ruleset a
 * match is played under is *frozen into the match* rather than read live from the
 * content pack (§5.9).
 *
 * The hostile cases are the point of the file. A `ModeRules` object arrives from
 * a browser and becomes rules the engine enforces on every player at the table,
 * so "an unbounded `maxPipAdjust` or a negative `interestBasisPoints` is an
 * exploit, not a typo" — a player who can author a 12-pip adjustment is choosing
 * their roll outright, and one who can author a negative interest rate has turned
 * every loan into a grant.
 */

const roomId = "room-mode-rules";

const players = {
  host: "user-host",
  second: "user-second",
  third: "user-third",
} as const;

const QUICK_RULES = deadlineDashModes["mode.quick"].rules;
const STANDARD_RULES = deadlineDashModes["mode.standard"].rules;

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-27T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "MOD123",
      gameId: () => createStableId("GameId", "game-mode-rules"),
      commandId: () => createStableId("CommandId", "command-mode-rules"),
    },
    gameSeed: () => "mode-rules-seed",
    turnTimeoutMs: 0,
  });
}

async function lobbyOfThree(
  repository: InMemoryRoomRepository,
  create: { readonly customRules?: unknown } = {},
): Promise<RoomService> {
  const service = createService(repository);
  await service.create({
    hostId: players.host,
    playerName: "Host",
    modeId: "mode.quick",
    ...create,
  });
  await service.join({ roomId, actorId: players.second, playerName: "Second" });
  await service.join({ roomId, actorId: players.third, playerName: "Third" });
  return service;
}

/** A structural clone, so a test can bend one field without touching the pack. */
function cloneRules(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(STANDARD_RULES)) as Record<string, unknown>;
}

function withSection(
  section: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const rules = cloneRules();
  rules[section] = { ...(rules[section] as Record<string, unknown>), ...patch };
  return rules;
}

describe("mode resolution", () => {
  it("Given every preset this content release ships, When a room names one, Then its own rules are resolved", async () => {
    const repository = new InMemoryRoomRepository();
    await lobbyOfThree(repository);
    const room = await repository.get(roomId);
    expect(room).not.toBeNull();
    if (room === null) return;

    // Iterated over the pack rather than over a list written here, so adding a
    // fifth preset is covered the day it lands. Nothing in this layer branches
    // on a mode id: resolution is a lookup, so every preset the pack ships is
    // playable the moment the transport vocabulary admits its id.
    const presets = Object.keys(deadlineDashModes);
    expect(presets.length).toBeGreaterThanOrEqual(4);
    for (const modeId of presets) {
      const resolved = resolveModeRules({
        ...room,
        modeId: modeId as (typeof room)["modeId"],
      });
      expect(resolved, modeId).toEqual(
        deadlineDashModes[modeId as keyof typeof deadlineDashModes].rules,
      );
    }
  });

  it("Given a mode id this content release does not provide, When the room would start, Then it is refused rather than defaulted", async () => {
    const repository = new InMemoryRoomRepository();
    await lobbyOfThree(repository);
    const room = await repository.get(roomId);
    expect(room).not.toBeNull();
    if (room === null) return;

    // Silently playing a different mode than the lobby advertised is worse than
    // refusing to start, so this answers null and `start` turns it into
    // UNSUPPORTED_MODE.
    expect(
      resolveModeRules({
        ...room,
        modeId: "mode.retired" as (typeof room)["modeId"],
      }),
    ).toBeNull();
  });
});

describe("the create-room request", () => {
  it.each(["mode.quick", "mode.marathon"] as const)(
    "Given a host who chose %s, When the room is created, Then the room is stored under that mode and starts under its rules",
    async (modeId) => {
      const repository = new InMemoryRoomRepository();
      const service = createService(repository);

      await service.create({ hostId: players.host, playerName: "Host", modeId });
      await service.join({ roomId, actorId: players.second, playerName: "Second" });
      await service.join({ roomId, actorId: players.third, playerName: "Third" });

      // Read back through the persistence boundary: a mode that only lives in the
      // object create() returned is a mode the match will never be played under.
      expect((await repository.get(roomId))?.modeId).toBe(modeId);
      const started = await service.start({
        roomId,
        actorId: players.host,
        actorKind: "human",
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      expect(started.value.game.rules).toEqual(deadlineDashModes[modeId].rules);
    },
  );

  it("Given a create request carrying a valid ruleset, When the room is created, Then it is stored and resolved for the match", async () => {
    const repository = new InMemoryRoomRepository();
    await lobbyOfThree(repository, { customRules: STANDARD_RULES });

    const stored = await repository.get(roomId);
    expect(stored?.customRules).toEqual(STANDARD_RULES);
    // The mode id is untouched: a custom ruleset is a ruleset, not a new mode.
    expect(stored?.modeId).toBe("mode.quick");
    expect(resolveModeRules(stored!)).toEqual(STANDARD_RULES);
  });

  it("Given a create request with no ruleset, When the room is created, Then it plays its mode preset", async () => {
    const repository = new InMemoryRoomRepository();
    await lobbyOfThree(repository);

    const stored = await repository.get(roomId);
    expect(stored?.customRules).toBeNull();
    expect(resolveModeRules(stored!)).toEqual(QUICK_RULES);
  });

  it.each([
    ["an unbounded pip adjustment", withSection("agency", { maxPipAdjust: 99 })],
    ["a negative interest rate", withSection("economy", { interestBasisPoints: -500 })],
    ["an unknown field", { ...cloneRules(), houseRule: "the host always wins" }],
    ["a bare string", "mode.standard"],
  ])(
    "Given a create request carrying %s, When the room is created, Then no room exists at all",
    async (_label, rules) => {
      const repository = new InMemoryRoomRepository();
      const service = createService(repository);

      const result = await service.create({
        hostId: players.host,
        playerName: "Host",
        modeId: "mode.quick",
        customRules: rules,
      });

      // The create path is the first door a hostile client reaches — before any
      // lobby control has rendered — so it has to be the same validator, not a
      // laxer one. And the refusal is total: a room whose ruleset was rejected
      // must not exist holding a code and a seat.
      expect(result).toEqual({ ok: false, error: { code: "INVALID_MODE_RULES" } });
      expect(await repository.get(roomId)).toBeNull();
      expect(await repository.getByCode("MOD123")).toBeNull();
    },
  );

  it("Given a create request whose ruleset would be a cheat, When the match would have started, Then the engine never sees it", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    // maxPipAdjust past a whole die's worth is not shading a roll, it is
    // selecting a destination — the exact §8.4 example.
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      customRules: withSection("agency", { maxPipAdjust: 12 }),
    });

    const started = await service.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });

    expect(started).toEqual({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
  });
});

describe("lobby-authored rulesets", () => {
  it("Given the host in the lobby, When a valid ruleset is authored, Then it is stored and survives the repository", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);

    const result = await service.setModeRules({
      roomId,
      actorId: players.host,
      rules: STANDARD_RULES,
    });

    expect(result.ok).toBe(true);
    // Read back through the same snapshot boundary Postgres uses, because a
    // ruleset that only exists in the object the writer happened to return is a
    // ruleset the match will never actually be played under.
    const stored = await repository.get(roomId);
    expect(stored?.customRules).toEqual(STANDARD_RULES);
    expect(resolveModeRules(stored!)).toEqual(STANDARD_RULES);
  });

  it("Given a stored ruleset, When it is cleared, Then the room returns to its mode preset", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);
    await service.setModeRules({ roomId, actorId: players.host, rules: STANDARD_RULES });

    const cleared = await service.setModeRules({
      roomId,
      actorId: players.host,
      rules: null,
    });

    expect(cleared.ok).toBe(true);
    const stored = await repository.get(roomId);
    expect(stored?.customRules).toBeNull();
    expect(resolveModeRules(stored!)).toEqual(QUICK_RULES);
  });

  it("Given a member who is not the host, When they author a ruleset, Then it is refused", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);

    const result = await service.setModeRules({
      roomId,
      actorId: players.second,
      rules: STANDARD_RULES,
    });

    // The ruleset is the terms every other player agrees to by taking a seat, so
    // it is not a per-member preference.
    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_HOST" } });
    expect((await repository.get(roomId))?.customRules).toBeNull();
  });

  it("Given a match already running, When the host rewrites the ruleset, Then it is refused", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);
    const started = await service.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });
    expect(started.ok).toBe(true);

    const result = await service.setModeRules({
      roomId,
      actorId: players.host,
      rules: STANDARD_RULES,
    });

    // After `game.start` the ruleset lives in canonical state and is frozen for
    // the match; a room-level edit would be a rule change no replay could
    // reproduce.
    expect(result).toEqual({ ok: false, error: { code: "ROOM_NOT_OPEN" } });
  });

  it.each([
    [
      "an unbounded pip adjustment",
      withSection("agency", { maxPipAdjust: 99 }),
    ],
    [
      "a negative interest rate",
      withSection("economy", { interestBasisPoints: -500 }),
    ],
    [
      "an unwinnable match",
      withSection("winPaths", {
        promotion: false,
        wealth: false,
        influence: false,
        survival: false,
      }),
    ],
    [
      "an upkeep ladder that is one entry short",
      withSection("economy", {
        upkeepByRankIndex: Array.from({ length: deadlineDashRanks.length - 1 }, () => 10),
      }),
    ],
    [
      "a turn clock of a tenth of a second",
      withSection("timers", { turnSeconds: 0.1 }),
    ],
    ["a heat threshold of zero", withSection("conflict", { heatThreshold: 0 })],
    ["a win shape nobody implements", { ...cloneRules(), winShape: "battle-royale" }],
  ])(
    "Given %s, When the host authors it, Then the whole ruleset is refused",
    async (_label, rules) => {
      const repository = new InMemoryRoomRepository();
      const service = await lobbyOfThree(repository);

      const result = await service.setModeRules({
        roomId,
        actorId: players.host,
        rules,
      });

      expect(result).toEqual({ ok: false, error: { code: "INVALID_MODE_RULES" } });
      // Wholesale: not clamped, not partially applied. A half-accepted ruleset is
      // one nobody at the table ever agreed to.
      expect((await repository.get(roomId))?.customRules).toBeNull();
    },
  );

  it.each([
    ["a missing section", (() => {
      const rules = cloneRules();
      delete rules["bots"];
      return rules;
    })()],
    ["an unknown field", { ...cloneRules(), houseRule: "the host always wins" }],
    ["a string where an object belongs", "mode.standard"],
    ["an array", []],
  ])(
    "Given %s, When the host authors it, Then it is refused rather than defaulted",
    async (_label, rules) => {
      const repository = new InMemoryRoomRepository();
      const service = await lobbyOfThree(repository);

      const result = await service.setModeRules({
        roomId,
        actorId: players.host,
        rules,
      });

      expect(result).toEqual({ ok: false, error: { code: "INVALID_MODE_RULES" } });
    },
  );

  it("Given an authored ruleset carrying an extra nested key, When it is stored, Then only parsed fields survive", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);
    // Rejected outright by requireExactKeys, which is the stronger answer: there
    // is no path by which an unread field reaches storage and waits for a later
    // build to start reading it.
    const smuggled = withSection("agency", { secretBackdoor: true });

    const result = await service.setModeRules({
      roomId,
      actorId: players.host,
      rules: smuggled,
    });

    expect(result).toEqual({ ok: false, error: { code: "INVALID_MODE_RULES" } });
  });
});

describe("the ruleset a match is played under", () => {
  it("Given no authored ruleset, When the match starts, Then the mode preset is snapshotted into the state", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);

    const started = await service.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.game.rules).toEqual(QUICK_RULES);
    // A *copy*, not the content pack's own object: nothing outside canonical
    // state can reach in and change a live match's rules.
    expect(started.value.game.rules).not.toBe(QUICK_RULES);
  });

  it("Given an authored ruleset, When the match starts, Then the state carries it rather than the preset", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);
    await service.setModeRules({ roomId, actorId: players.host, rules: STANDARD_RULES });

    const started = await service.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.game.rules).toEqual(STANDARD_RULES);
    expect(started.value.game.rules).not.toEqual(QUICK_RULES);
    // The room still says `mode.quick`, because a custom ruleset is a ruleset,
    // not a new mode id — `RankCostByMode` and every persisted game are keyed by
    // the id, so it must not drift.
    expect(started.value.modeId).toBe("mode.quick");
  });

  it("Given a running match, When the content pack's own ruleset is consulted, Then the state does not follow it", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);
    await service.setModeRules({ roomId, actorId: players.host, rules: STANDARD_RULES });
    const started = await service.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // Read back from storage, which is what a replay or a second process does.
    const reloaded = await repository.get(roomId);

    expect(reloaded?.game?.rules).toEqual(STANDARD_RULES);
    // The one property that makes replay honest: what the state says is what the
    // match was played under, whatever the pack says today.
    expect(reloaded?.game?.rules).not.toEqual(deadlineDashModes["mode.quick"].rules);
  });

  it("Given two rooms differing only in their ruleset, When both start, Then the two matches are shaped differently", async () => {
    // The measure of a configurable ruleset is not that the field round-trips —
    // it is that the match the engine builds is a different match. These three
    // are read straight out of `GameState` by `createGame`, so a ruleset that
    // was stored but never consulted fails here even though every equality
    // assertion above would still pass.
    const preset = new InMemoryRoomRepository();
    await lobbyOfThree(preset);
    const authored = new InMemoryRoomRepository();
    await lobbyOfThree(authored, { customRules: STANDARD_RULES });

    const under = async (repository: InMemoryRoomRepository) => {
      const started = await createService(repository).start({
        roomId,
        actorId: players.host,
        actorKind: "human",
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.code}`);
      return started.value.game;
    };
    const quick = await under(preset);
    const standard = await under(authored);
    const heatThreshold = (game: typeof quick): number | undefined =>
      Object.values(game.players)[0]?.heat.threshold;

    expect(quick.quarters).toHaveLength(0);
    expect(standard.quarters).toHaveLength(STANDARD_RULES.quarters.count);
    expect(heatThreshold(quick)).toBe(QUICK_RULES.conflict.heatThreshold);
    expect(heatThreshold(standard)).toBe(STANDARD_RULES.conflict.heatThreshold);
    expect(quick.rules.winShape).toBe("race");
    expect(standard.rules.winShape).toBe("fixed-length");
  });

  it("Given an authored ruleset with hidden roles on, When the match starts, Then roles are assigned", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);
    await service.setModeRules({ roomId, actorId: players.host, rules: STANDARD_RULES });

    const started = await service.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const roles = Object.values(started.value.game.players).map((player) =>
      String(player.role.kind),
    );
    // floor(3 / 3) = one Management seat, and which seat it is comes from the
    // server-side seed rather than from the seat number.
    expect(roles.filter((role) => role === "role.management")).toHaveLength(1);
  });

  it("Given the shipped quick preset, When the match starts, Then no seat holds a hidden role", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await lobbyOfThree(repository);

    const started = await service.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(QUICK_RULES.hidden.rolesEnabled).toBe(false);
    expect(
      Object.values(started.value.game.players).map((player) => String(player.role.kind)),
    ).toEqual(["role.worker", "role.worker", "role.worker"]);
  });
});
