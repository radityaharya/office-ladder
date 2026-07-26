import { describe, expect, it } from "vitest";

import { deadlineDashModes, type ModeRules } from "@office-ladder/content";
import { createStableId } from "@office-ladder/engine";
import { CHARACTER_IDS, characterLabel } from "../../src/rooms/characters";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import { setupFor } from "../../src/rooms/service/game-setup";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";

/** The shipped quick-mode ruleset: what a room with no authored one plays under. */
const QUICK_RULES = deadlineDashModes["mode.quick"].rules;
/** A shipped preset that has hidden roles switched on. */
const ROLES_ON_RULES = deadlineDashModes["mode.standard"].rules;

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
  fourth: createStableId("PlayerId", "user-fourth"),
  fifth: createStableId("PlayerId", "user-fifth"),
  sixth: createStableId("PlayerId", "user-sixth"),
} as const;

const roomId = "room-character-test";
const gameId = createStableId("GameId", "game-character-test");

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "CHR123",
      gameId: () => gameId,
      commandId: () => createStableId("CommandId", "command-character-test"),
    },
    gameSeed: () => "character-seed",
    turnTimeoutMs: 0,
  });
}

async function requireRoom(repository: InMemoryRoomRepository): Promise<StoredRoom> {
  const room = await repository.get(roomId);
  if (room === null) throw new Error("room vanished");
  return room;
}

const WORKAHOLIC = "character.workaholic";
const SOCIAL_BUTTERFLY = "character.social-butterfly";
const SALES_STAR = "character.sales-star";

describe("character selection at the door", () => {
  it("Given a host who picked a character, When the room is created, Then the pick is stored and offered as taken", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);

    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      characterId: SALES_STAR,
    });

    const room = await requireRoom(repository);
    expect(room.memberCharacters).toEqual({ [players.host]: SALES_STAR });
    const bootstrap = await service.bootstrap({ roomId, viewerId: players.host });
    expect(bootstrap).toMatchObject({
      ok: true,
      value: {
        room: {
          members: [{ id: players.host, characterId: SALES_STAR, characterLabel: "Sales Star" }],
        },
      },
    });
    if (!bootstrap.ok || "publicProjection" in bootstrap.value) throw new Error("expected a lobby");
    expect(bootstrap.value.characterOptions).toContainEqual({
      id: SALES_STAR,
      label: "Sales Star",
      nameKey: "deadlineDash.character.salesStar.name",
      takenByMemberId: players.host,
    });
  });

  it("Given a joiner who picked nothing, When they join, Then no character is claimed for them", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });

    await service.join({ roomId, actorId: players.second, playerName: "Second" });

    const room = await requireRoom(repository);
    expect(room.memberCharacters).toEqual({});
    const bootstrap = await service.bootstrap({ roomId, viewerId: players.second });
    // Not pre-filled with the fallback: an assignment nobody chose, shown as
    // though they chose it, is exactly how "your pick was ignored" looks.
    expect(bootstrap).toMatchObject({
      ok: true,
      value: { room: { members: [{}, { id: players.second, characterId: null }] } },
    });
  });

  it("Given two players who want the same character, When the second joins, Then the first keeps it and the second joins with none", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      characterId: WORKAHOLIC,
    });

    const joined = await service.join({
      roomId,
      actorId: players.second,
      playerName: "Second",
      characterId: WORKAHOLIC,
    });

    // First come, first served — but never at the cost of the seat: a cosmetic
    // preference must not be able to keep somebody out of the room.
    expect(joined).toMatchObject({ ok: true });
    const room = await requireRoom(repository);
    expect(room.memberCharacters).toEqual({ [players.host]: WORKAHOLIC });
    expect(room.memberIds).toEqual([players.host, players.second]);
  });

  it("Given a character the content pack does not have, When it is sent, Then the request is refused rather than reassigned", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);

    const created = await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      characterId: "character.chief-vibes-officer",
    });

    // Quietly substituting something else is the bug this whole change removes.
    expect(created).toEqual({ ok: false, error: { code: "CHARACTER_NOT_FOUND" } });
    expect(await repository.get(roomId)).toBeNull();
  });
});

describe("re-picking a character in the lobby", () => {
  async function lobby(): Promise<{
    readonly repository: InMemoryRoomRepository;
    readonly service: RoomService;
  }> {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      characterId: WORKAHOLIC,
    });
    await service.join({ roomId, actorId: players.second, playerName: "Second" });
    return { repository, service };
  }

  it("Given a free character, When a member picks it, Then the claim is recorded", async () => {
    const { repository, service } = await lobby();

    const result = await service.selectCharacter({
      roomId,
      actorId: players.second,
      characterId: SOCIAL_BUTTERFLY,
    });

    expect(result).toMatchObject({ ok: true });
    expect((await requireRoom(repository)).memberCharacters).toEqual({
      [players.host]: WORKAHOLIC,
      [players.second]: SOCIAL_BUTTERFLY,
    });
  });

  it("Given a character somebody else holds, When a member picks it, Then they are told rather than silently reassigned", async () => {
    const { repository, service } = await lobby();

    const result = await service.selectCharacter({
      roomId,
      actorId: players.second,
      characterId: WORKAHOLIC,
    });

    // Stricter than join on purpose: the picker is on screen, so a refusal is
    // something the player can act on immediately.
    expect(result).toEqual({ ok: false, error: { code: "CHARACTER_TAKEN" } });
    expect((await requireRoom(repository)).memberCharacters).toEqual({
      [players.host]: WORKAHOLIC,
    });
  });

  it("Given their own character, When a member re-picks it, Then it is idempotent rather than a conflict", async () => {
    const { service } = await lobby();

    const result = await service.selectCharacter({
      roomId,
      actorId: players.host,
      characterId: WORKAHOLIC,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("Given a claim, When it is cleared, Then the character is free again", async () => {
    const { repository, service } = await lobby();

    await service.selectCharacter({ roomId, actorId: players.host, characterId: null });

    expect((await requireRoom(repository)).memberCharacters).toEqual({});
    expect(
      await service.selectCharacter({
        roomId,
        actorId: players.second,
        characterId: WORKAHOLIC,
      }),
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["a non-member", players.fourth, "ACTOR_NOT_MEMBER"],
  ])(
    "Given %s, When they try to pick a character, Then the claim is refused",
    async (_label, actorId, code) => {
      const { service } = await lobby();

      expect(
        await service.selectCharacter({ roomId, actorId, characterId: SALES_STAR }),
      ).toEqual({ ok: false, error: { code } });
    },
  );

  it("Given a bot seat, When the host tries to pick for it, Then it is refused as a member it cannot speak for", async () => {
    const { service } = await lobby();
    const added = await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });
    expect(added).toMatchObject({ ok: true });
    if (!added.ok) return;
    const botMemberId = added.value.bots[0]?.playerId;
    if (botMemberId === undefined) throw new Error("expected a bot seat");

    expect(
      await service.selectCharacter({
        roomId,
        actorId: botMemberId,
        characterId: SALES_STAR,
      }),
    ).toEqual({ ok: false, error: { code: "ACTOR_IS_BOT" } });
  });

  it("Given a started match, When a member tries to re-pick, Then the assignment is left to canonical state", async () => {
    const { service } = await lobby();
    await service.join({ roomId, actorId: players.third, playerName: "Third" });
    expect(
      await service.start({ roomId, actorId: players.host, actorKind: "human" }),
    ).toMatchObject({ ok: true });

    expect(
      await service.selectCharacter({
        roomId,
        actorId: players.second,
        characterId: SALES_STAR,
      }),
    ).toEqual({ ok: false, error: { code: "ROOM_NOT_OPEN" } });
  });
});

describe("character assignment at setup", () => {
  function roomWith(
    memberIds: readonly string[],
    memberCharacters: Readonly<Record<string, string>>,
  ): StoredRoom {
    return {
      id: roomId,
      code: "CHR123",
      hostId: createStableId("PlayerId", memberIds[0] ?? players.host),
      memberIds: memberIds.map((memberId) => createStableId("PlayerId", memberId)),
      memberNames: {},
      memberAvatars: {},
      memberCharacters,
      modeId: "mode.quick",
      capacity: 6,
      status: "open",
      revision: 0,
      createdAt: "2026-07-26T12:00:00.000Z",
      game: null,
      eventSummaries: [],
      bots: [],
      turnTimer: null,
    };
  }

  it("Given every seat picked, When the setup is built, Then each player gets exactly what they asked for", () => {
    const setup = setupFor(
      roomWith([players.host, players.second, players.third], {
        [players.host]: SALES_STAR,
        [players.second]: WORKAHOLIC,
        [players.third]: SOCIAL_BUTTERFLY,
      }),
      gameId,
      "seed-1",
      QUICK_RULES,
    );

    expect(setup.players.map((player) => player.characterId)).toEqual([
      SALES_STAR,
      WORKAHOLIC,
      SOCIAL_BUTTERFLY,
    ]);
  });

  it("Given nobody picked, When the setup is built, Then the deterministic fallback assigns content order", () => {
    const setup = setupFor(
      roomWith([players.host, players.second, players.third], {}),
      gameId,
      "seed-1",
      QUICK_RULES,
    );

    expect(setup.players.map((player) => player.characterId)).toEqual(
      CHARACTER_IDS.slice(0, 3),
    );
  });

  it("Given one pick that collides with the fallback order, When the setup is built, Then nobody is assigned twice", () => {
    // The third seat asks for the character the first seat would otherwise get by
    // fallback, so the fallback has to route around the claim.
    const setup = setupFor(
      roomWith([players.host, players.second, players.third], {
        [players.third]: CHARACTER_IDS[0] ?? WORKAHOLIC,
      }),
      gameId,
      "seed-1",
      QUICK_RULES,
    );

    const assigned = setup.players.map((player) => String(player.characterId));
    expect(assigned[2]).toBe(CHARACTER_IDS[0]);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("Given a duplicate claim that reached storage anyway, When the setup is built, Then the earlier seat wins and the match still starts", () => {
    // The service refuses to store a duplicate, so this is a legacy or raced
    // snapshot. The engine rejects a setup with two identical characters outright
    // (DUPLICATE_CHARACTER_ID), so resolving it here is the difference between a
    // room that starts and a room that never can.
    const setup = setupFor(
      roomWith([players.host, players.second, players.third], {
        [players.host]: WORKAHOLIC,
        [players.second]: WORKAHOLIC,
      }),
      gameId,
      "seed-1",
      QUICK_RULES,
    );

    const assigned = setup.players.map((player) => String(player.characterId));
    expect(assigned[0]).toBe(WORKAHOLIC);
    expect(assigned[1]).not.toBe(WORKAHOLIC);
    expect(new Set(assigned).size).toBe(3);
  });

  it("Given a full table, When the setup is built, Then every available character is used exactly once", () => {
    const setup = setupFor(
      roomWith(Object.values(players), { [players.sixth]: WORKAHOLIC }),
      gameId,
      "seed-1",
      QUICK_RULES,
    );

    expect(new Set(setup.players.map((player) => String(player.characterId)))).toEqual(
      new Set(CHARACTER_IDS),
    );
  });

  it("Given a character id, When it is labelled, Then the label reads as a name", () => {
    expect(characterLabel(SOCIAL_BUTTERFLY)).toBe("Social Butterfly");
    expect(characterLabel("character.tech-genius")).toBe("Tech Genius");
    // Not a content id at all: the label must still be renderable rather than empty.
    expect(characterLabel("mystery")).toBe("Mystery");
  });
});

/**
 * The hidden-role assignment, and the leak it used to be.
 *
 * `game-setup.ts` assigned Management by `(order + 1) % 3 === 0` while `order`
 * was published to every client as `member.seat`, so seats 2 and 5 were
 * Management in every match ever played and every player could derive every
 * other player's secret role by counting. The replacement draws the seats from a
 * partial Fisher-Yates over a `:roles`-suffixed stream of the server-side game
 * seed, and is gated on `hidden.rolesEnabled` like every other mechanic.
 *
 * The tests below are the two halves of that: the assignment is *deterministic
 * given the seed* (so a match replays identically) and *undetermined given the
 * seat* (so the projection leaks nothing).
 */
describe("hidden role assignment", () => {
  function rolesFor(
    seed: string,
    memberIds: readonly string[],
    rules: ModeRules = ROLES_ON_RULES,
  ): readonly string[] {
    const setup = setupFor(
      {
        id: roomId,
        code: "CHR123",
        hostId: createStableId("PlayerId", memberIds[0] ?? players.host),
        memberIds: memberIds.map((memberId) => createStableId("PlayerId", memberId)),
        memberNames: {},
        memberAvatars: {},
        memberCharacters: {},
        modeId: "mode.quick",
        capacity: 6,
        status: "open",
        revision: 0,
        createdAt: "2026-07-26T12:00:00.000Z",
        game: null,
        eventSummaries: [],
        bots: [],
        turnTimer: null,
      },
      gameId,
      seed,
      rules,
    );
    return setup.players.map((player) => String(player.role.kind));
  }

  const sixSeats = Object.values(players);

  it("Given the same seed, When the setup is built twice, Then the roles are identical", () => {
    // Replay-safety: the roles are a pure function of (seed, seat count, rules),
    // with no clock and no Math.random anywhere near them.
    expect(rolesFor("seed-1", sixSeats)).toEqual(rolesFor("seed-1", sixSeats));
  });

  it("Given six seats, When roles are assigned, Then the management count matches the old fixed rule", () => {
    const roles = rolesFor("seed-1", sixSeats);

    // Balance is deliberately unchanged: floor(n / 3) management seats, exactly
    // what `(order + 1) % 3 === 0` produced. Only *which* seats changed.
    expect(roles.filter((role) => role === "role.management")).toHaveLength(2);
    expect(roles).toHaveLength(6);
  });

  it.each([
    [3, 1],
    [4, 1],
    [5, 1],
    [6, 2],
  ])(
    "Given %i seats, When roles are assigned, Then %i of them are management",
    (seats, expected) => {
      const roles = rolesFor("seed-1", sixSeats.slice(0, seats));

      expect(roles.filter((role) => role === "role.management")).toHaveLength(expected);
    },
  );

  it("Given a mode with roles switched off, When roles are assigned, Then no seat holds one", () => {
    // The mode gate (spec §4: a mechanic that cannot be switched off from config
    // is a bug). `mode.quick` ships with `hidden.rolesEnabled: false`, and
    // `legal-actions.ts` refuses the role-reveal verb under the same flag — so
    // assigning roles here would create a hidden team nobody could ever use, and
    // uniform is also the only assignment that cannot leak.
    expect(QUICK_RULES.hidden.rolesEnabled).toBe(false);

    const roles = rolesFor("seed-1", sixSeats, QUICK_RULES);

    expect(roles).toEqual(Array.from({ length: 6 }, () => "role.worker"));
  });

  it("Given many seeds, When roles are assigned, Then every seat holds each role sometimes", () => {
    // The audit's finding, stated as a predicate: a seat whose role is the same
    // in every seed *is* a derivable role, because seat number is public. Both
    // roles being observed at every seat is exactly the negation of "role is a
    // function of seat".
    const seeds = Array.from({ length: 200 }, (_unused, index) => `seed-${index}`);
    const managementBySeat = [0, 0, 0, 0, 0, 0];
    for (const seed of seeds) {
      rolesFor(seed, sixSeats).forEach((role, seat) => {
        if (role === "role.management") managementBySeat[seat] = (managementBySeat[seat] ?? 0) + 1;
      });
    }

    for (const count of managementBySeat) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(seeds.length);
    }
  });

  it("Given many seeds, When roles are assigned, Then no seat is management much more often than chance", () => {
    // Stronger than "not always": a seat that drew Management 90% of the time
    // would still pass the test above while being every bit as predictable. Two
    // of six seats are Management, so the expectation per seat is 1/3; the band
    // is wide enough that a fair shuffle never trips it and narrow enough that a
    // seat-dependent rule does.
    const seeds = Array.from({ length: 600 }, (_unused, index) => `predictability-${index}`);
    const managementBySeat = [0, 0, 0, 0, 0, 0];
    for (const seed of seeds) {
      rolesFor(seed, sixSeats).forEach((role, seat) => {
        if (role === "role.management") managementBySeat[seat] = (managementBySeat[seat] ?? 0) + 1;
      });
    }

    // Every seat draws it, and the six counts sum to exactly two per match.
    expect(managementBySeat.reduce((total, count) => total + count, 0)).toBe(
      seeds.length * 2,
    );
    for (const count of managementBySeat) {
      const share = count / seeds.length;
      expect(share).toBeGreaterThan(0.2);
      expect(share).toBeLessThan(0.47);
    }
  });

  it("Given a seat's own role, When the seed changes, Then the other seats' roles do not follow it", () => {
    // The remaining derivation risk: even with the seat freed, a fixed *pairing*
    // (seat 0 management implies seat 3 management, say) would still hand a
    // player every other role the moment they learned their own. Measured as: for
    // every ordered pair of seats, the second is not always management when the
    // first is, and not never.
    const seeds = Array.from({ length: 400 }, (_unused, index) => `pairing-${index}`);
    const draws = seeds.map((seed) => rolesFor(seed, sixSeats));

    for (let first = 0; first < 6; first += 1) {
      const matching = draws.filter((roles) => roles[first] === "role.management");
      expect(matching.length).toBeGreaterThan(0);
      for (let second = 0; second < 6; second += 1) {
        if (second === first) continue;
        const alsoManagement = matching.filter(
          (roles) => roles[second] === "role.management",
        ).length;
        expect(alsoManagement).toBeGreaterThan(0);
        expect(alsoManagement).toBeLessThan(matching.length);
      }
    }
  });
});
