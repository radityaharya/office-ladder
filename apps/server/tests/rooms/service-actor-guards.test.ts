import { describe, expect, it } from "vitest";

import { createStableId, type PlayerId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService } from "../../src/rooms/service/types";

const host = createStableId("PlayerId", "user-host");
const second = createStableId("PlayerId", "user-second");
const roomId = "room-actor-guards";

type Fixture = {
  readonly service: RoomService;
  readonly botId: PlayerId;
};

function serviceWith(
  repository: InMemoryRoomRepository,
  roomCode: () => string = () => "GRD123",
  nextRoomId: () => string = () => roomId,
): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: nextRoomId,
      roomCode,
      gameId: () => createStableId("GameId", "game-actor-guards"),
      commandId: () => createStableId("CommandId", "command-actor-guards"),
    },
    gameSeed: () => "actor-guards-seed",
    // Off unless a test needs the clock: an armed deadline in an unrelated
    // test would be enforcement nobody asked for.
    turnTimeoutMs: 0,
  });
}

/** Host + one more human + one bot: the engine minimum, with a bot seat in it. */
async function openRoomWithBot(): Promise<Fixture> {
  const service = serviceWith(new InMemoryRoomRepository());
  await service.create({ hostId: host, playerName: "Host", modeId: "mode.quick" });
  await service.join({ roomId, actorId: second, playerName: "Second" });
  const added = await service.addBot({ roomId, actorId: host, difficulty: "standard" });
  if (!added.ok) throw new Error(`bot seat could not be added: ${added.error.code}`);
  const seat = added.value.bots[0];
  if (seat === undefined) throw new Error("bot seat missing");
  return { service, botId: seat.playerId };
}

async function startedRoomWithBot(): Promise<Fixture> {
  const fixture = await openRoomWithBot();
  const started = await fixture.service.start({
    roomId,
    actorId: host,
    actorKind: "human",
  });
  if (!started.ok) throw new Error(`start failed: ${started.error.code}`);
  return fixture;
}

/**
 * A bot seat is not an identity anyone can present. Nothing today lets a human
 * act as one — every route derives the actor from the session — but nothing
 * *asserted* it either, so the guarantee rested entirely on every current and
 * future call site being careful. These prove the service refuses on its own.
 */
describe("room service actor guards", () => {
  it("Given a bot's member id, When a human session rolls as it, Then the roll is refused", async () => {
    const { service, botId } = await startedRoomWithBot();

    const result = await service.roll({
      roomId,
      actorId: botId,
      actorKind: "human",
      expectedRevision: 1,
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_IS_BOT" } });
  });

  it("Given a bot's member id, When a human session answers a prompt as it, Then the response is refused", async () => {
    const { service, botId } = await startedRoomWithBot();

    const result = await service.respondToPrompt({
      roomId,
      actorId: botId,
      actorKind: "human",
      expectedRevision: 1,
      decisionPointId: "decision-anything",
      optionId: "pay-fine",
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_IS_BOT" } });
  });

  it("Given a bot's member id, When a human session starts the match as it, Then the guard answers before the host check", async () => {
    const { service, botId } = await openRoomWithBot();

    const result = await service.start({ roomId, actorId: botId, actorKind: "human" });

    // Not ACTOR_NOT_HOST: refusing to *be* the bot comes first, so the reason
    // never depends on who happens to be host.
    expect(result).toEqual({ ok: false, error: { code: "ACTOR_IS_BOT" } });
  });

  it("Given a human member, When the bot driver acts as it, Then the command is refused", async () => {
    const { service } = await startedRoomWithBot();

    const result = await service.roll({
      roomId,
      actorId: host,
      actorKind: "bot",
      expectedRevision: 1,
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_BOT" } });
  });

  it("Given a bot seat, When the bot driver acts as it, Then the guard lets the command through to the engine", async () => {
    const { service, botId } = await startedRoomWithBot();

    const result = await service.roll({
      roomId,
      actorId: botId,
      actorKind: "bot",
      expectedRevision: 1,
    });

    // The host holds the first turn, so the engine rejects it — the point is
    // that it got *to* the engine rather than being stopped by the guard.
    expect(result).toEqual({ ok: false, error: { code: "NOT_ACTOR_TURN" } });
  });

  it("Given a bot's member id, When it is used as a viewer, Then neither the bootstrap nor a subscription is authorized", async () => {
    const { service, botId } = await startedRoomWithBot();

    expect(await service.bootstrap({ roomId, viewerId: botId })).toEqual({
      ok: false,
      error: { code: "ACTOR_IS_BOT" },
    });
    expect(await service.authorizeSubscription({ roomId, viewerId: botId })).toEqual({
      ok: false,
      error: { code: "ACTOR_IS_BOT" },
    });
  });

  it("Given a room member, When it subscribes, Then it is authorized as itself", async () => {
    const { service } = await startedRoomWithBot();

    expect(await service.authorizeSubscription({ roomId, viewerId: second })).toEqual({
      ok: true,
      value: second,
    });
  });
});

/**
 * The join code is a credential (plans/11: "at least 50 bits entropy",
 * "rotatable", "never used as a Realtime topic"). It is 30 bits from a generator
 * the caller supplies, and it used to have a fallback that derived it from the
 * room id with FNV-1a — i.e. from a value printed in every player's URL bar.
 * That fallback is gone and the generator is now a required dependency, which
 * the type system enforces; what still needs proving is that a collision is
 * handled rather than left to the unique index.
 */
describe("room code allocation", () => {
  it("Given a code already taken, When a room is created, Then it draws again instead of colliding", async () => {
    const repository = new InMemoryRoomRepository();
    const codes = ["AAA111", "AAA111", "BBB222"];
    let draw = 0;
    let created = 0;
    const service = serviceWith(
      repository,
      () => codes[draw++] ?? "ZZZ999",
      () => `room-${created++}`,
    );

    const first = await service.create({
      hostId: host,
      playerName: "Host",
      modeId: "mode.quick",
    });
    const secondRoom = await service.create({
      hostId: second,
      playerName: "Second",
      modeId: "mode.quick",
    });

    expect(first).toMatchObject({ ok: true, value: { code: "AAA111" } });
    expect(secondRoom).toMatchObject({ ok: true, value: { code: "BBB222" } });
  });

  it("Given a generator that only ever returns a taken code, When a room is created, Then it fails with a clear code after a bounded number of draws", async () => {
    const repository = new InMemoryRoomRepository();
    let draws = 0;
    let created = 0;
    const service = serviceWith(
      repository,
      () => {
        draws += 1;
        return "AAA111";
      },
      () => `room-${created++}`,
    );

    await service.create({ hostId: host, playerName: "Host", modeId: "mode.quick" });
    const drawsAfterFirst = draws;
    const result = await service.create({
      hostId: second,
      playerName: "Second",
      modeId: "mode.quick",
    });

    expect(result).toEqual({ ok: false, error: { code: "ROOM_CODE_UNAVAILABLE" } });
    // Bounded: it gives up rather than looping forever on a broken generator.
    expect(draws - drawsAfterFirst).toBe(5);
  });

  it("Given two rooms with different ids, When each is created, Then the code comes from the generator and not from the id", async () => {
    const repository = new InMemoryRoomRepository();
    const codes = ["CCC333", "DDD444"];
    let draw = 0;
    let created = 0;
    const service = serviceWith(
      repository,
      () => codes[draw++] ?? "ZZZ999",
      () => `room-${created++}`,
    );

    const first = await service.create({
      hostId: host,
      playerName: "Host",
      modeId: "mode.quick",
    });
    const secondRoom = await service.create({
      hostId: second,
      playerName: "Second",
      modeId: "mode.quick",
    });

    expect(first).toMatchObject({ ok: true, value: { id: "room-0", code: "CCC333" } });
    expect(secondRoom).toMatchObject({ ok: true, value: { id: "room-1", code: "DDD444" } });
  });
});
