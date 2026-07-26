import { describe, expect, it } from "vitest";

import { enumerateLegalActions, createStableId } from "@office-ladder/engine";
import {
  createBotDriver,
  isBotDrainDefect,
  type BotDriver,
  type BotDriverEvent,
} from "../../src/rooms/bots/bot-driver";
import {
  botDriverEventContext,
  botDriverEventLevel,
} from "../../src/rooms/bots/bot-driver-log";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type {
  RoomRepository,
  RoomService,
  StoredRoom,
} from "../../src/rooms/service/types";

const host = createStableId("PlayerId", "user-host");
const roomId = "room-bot-driver-test";
const firstBot = `bot:${roomId}:0`;
const secondBot = `bot:${roomId}:1`;

type Harness = {
  readonly repository: InMemoryRoomRepository;
  readonly service: RoomService;
  readonly driver: BotDriver;
  /** Everything the driver reported, in order. */
  readonly events: readonly BotDriverEvent[];
  /** Only the reports that mean something is broken — see isBotDrainDefect. */
  readonly defects: readonly BotDriverEvent[];
  readonly published: readonly { readonly revision: number; readonly messageId: string }[];
  readonly timeline: readonly string[];
};

/**
 * "Somebody's bug", as opposed to "nothing to do here". Deliberately reuses the
 * production classifier rather than restating it: the whole point of the stop
 * taxonomy is that the driver, not each caller, decides which stops are defects.
 */
function isDefect(event: BotDriverEvent): boolean {
  if (event.type === "bot.drain.finished") return isBotDrainDefect(event.stop);
  return event.type === "bot.publish.failed" || event.type === "bot.drain.crashed";
}

function drainStops(events: readonly BotDriverEvent[]): readonly BotDriverEvent[] {
  return events.filter((event) => event.type === "bot.drain.finished");
}

/**
 * One human host plus two bots, started. delayMs is 0 and sleep is injected, so
 * the whole match runs synchronously with no timers.
 */
async function startSoloMatch(delayMs = 0): Promise<Harness> {
  const repository = new InMemoryRoomRepository();
  const events: BotDriverEvent[] = [];
  const defects: BotDriverEvent[] = [];
  const published: { revision: number; messageId: string }[] = [];
  const timeline: string[] = [];

  const service = createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "BOT456",
      gameId: () => createStableId("GameId", "game-bot-driver-test"),
      commandId: () => createStableId("CommandId", "command-bot-driver-test"),
    },
    gameSeed: () => "bot-driver-seed",
    // Off unless a test needs the clock: an armed deadline in an unrelated
    // test would be enforcement nobody asked for.
    turnTimeoutMs: 0,
  });

  const observed: RoomService = {
    ...service,
    async roll(input) {
      timeline.push(`roll:${input.actorId}`);
      return service.roll(input);
    },
    async respondToPrompt(input) {
      timeline.push(`respond:${input.actorId}`);
      return service.respondToPrompt(input);
    },
  };

  const driver = createBotDriver({
    roomService: observed,
    repository,
    delayMs,
    sleep: async () => {
      timeline.push("sleep");
    },
    publish: async (_roomId, revision, messageId) => {
      published.push({ revision, messageId });
    },
    onEvent: (event) => {
      events.push(event);
      if (isDefect(event)) defects.push(event);
    },
  });

  await service.create({
    hostId: host,
    playerName: "Host",
    modeId: "mode.quick",
    capacity: 3,
  });
  await service.addBot({ roomId, actorId: host, difficulty: "standard" });
  await service.addBot({ roomId, actorId: host, difficulty: "easy" });
  const started = await service.start({ roomId, actorId: host, actorKind: "human" });
  expect(started).toMatchObject({ ok: true, value: { status: "active" } });

  return { repository, service: observed, driver, events, defects, published, timeline };
}

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

/** A promise whose resolution the test controls, without nullable callbacks. */
function deferred(): Deferred {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: () => settle() };
}

async function requireRoom(repository: InMemoryRoomRepository): Promise<StoredRoom> {
  const room = await repository.get(roomId);
  if (room === null) throw new Error("room vanished");
  return room;
}

/**
 * The scripted human seat. Deliberately does NOT reuse decideBotAction: the
 * harness must not be the code under test. Rolls when a roll is legal, and
 * otherwise takes whatever first option an open prompt offers.
 */
async function takeHumanTurn(harness: Harness): Promise<"acted" | "not-my-turn"> {
  const room = await requireRoom(harness.repository);
  const game = room.game;
  if (game === null || game.status !== "active") return "not-my-turn";
  if (game.turn.activePlayerId !== host) return "not-my-turn";

  const legalActions = enumerateLegalActions(game, host);
  const prompt = legalActions.find((action) => action.type === "prompt.respond");
  if (prompt !== undefined && prompt.type === "prompt.respond") {
    const optionId = prompt.options[0];
    if (optionId === undefined) throw new Error("human prompt offered no options");
    const responded = await harness.service.respondToPrompt({
      roomId,
      actorId: host,
      actorKind: "human",
      commandId: `human:${game.revision}`,
      expectedRevision: prompt.expectedRevision,
      decisionPointId: String(prompt.decisionPointId),
      optionId: String(optionId),
    });
    expect(responded).toMatchObject({ ok: true });
    return "acted";
  }

  const roll = legalActions.find((action) => action.type === "turn.roll");
  if (roll === undefined) throw new Error("human has no legal action");
  const rolled = await harness.service.roll({
    roomId,
    actorId: host,
    actorKind: "human",
    commandId: `human:${game.revision}`,
    expectedRevision: roll.expectedRevision,
  });
  expect(rolled).toMatchObject({ ok: true });
  return "acted";
}

describe("bot driver", () => {
  it("Given one human host and two bots, When the host starts, Then a solo match reaches the engine minimum and begins on the human's turn", async () => {
    const harness = await startSoloMatch();
    const room = await requireRoom(harness.repository);

    expect(room.memberIds).toEqual([host, firstBot, secondBot]);
    expect(room.game?.turn.activePlayerId).toBe(host);
    expect(room.game?.status).toBe("active");
  });

  it("Given it is the human's turn, When the driver drains, Then nothing is applied", async () => {
    const harness = await startSoloMatch();
    const before = await requireRoom(harness.repository);

    await harness.driver.drive(roomId);

    const after = await requireRoom(harness.repository);
    expect(after.revision).toBe(before.revision);
    expect(after.game?.revision).toBe(before.game?.revision);
    expect(harness.timeline).toEqual([]);
    expect(harness.published).toEqual([]);
    expect(harness.defects).toEqual([]);
  });

  it("Given the human has rolled, When the driver drains, Then both bots take their own turns and each publishes its own update", async () => {
    const harness = await startSoloMatch();
    await takeHumanTurn(harness);
    const afterHuman = await requireRoom(harness.repository);
    expect(afterHuman.game?.turn.activePlayerId).toBe(firstBot);

    await harness.driver.drive(roomId);

    const afterBots = await requireRoom(harness.repository);
    // Back to the human, having advanced at least one command per bot.
    expect(afterBots.game?.turn.activePlayerId).toBe(host);
    expect(afterBots.game?.revision ?? 0).toBeGreaterThanOrEqual(
      (afterHuman.game?.revision ?? 0) + 2,
    );
    expect(afterBots.revision).toBeGreaterThanOrEqual(afterHuman.revision + 2);
    expect(afterBots.eventSummaries.length).toBeGreaterThan(
      afterHuman.eventSummaries.length,
    );

    // Both bot seats acted for themselves, not the human on their behalf.
    const botEntries = harness.timeline.filter((entry) => !entry.endsWith(host));
    expect(botEntries).toContain(`roll:${firstBot}`);
    expect(botEntries).toContain(`roll:${secondBot}`);

    // One publish per committed bot command, each with a distinct, deterministic
    // message id, and the delay always precedes the command.
    expect(harness.published.length).toBe(
      botEntries.filter((entry) => entry !== "sleep").length,
    );
    expect(new Set(harness.published.map((entry) => entry.messageId)).size).toBe(
      harness.published.length,
    );
    for (const { messageId } of harness.published) {
      expect(messageId).toMatch(/^bot:game-bot-driver-test:\d+:(roll|respond)$/);
    }
    for (let index = 0; index < botEntries.length; index += 2) {
      expect(botEntries[index]).toBe("sleep");
      expect(botEntries[index + 1]).not.toBe("sleep");
    }
    expect(harness.defects).toEqual([]);
  });

  it("Given a solo match, When it is played to its natural end, Then a winner is declared and the drains always terminate", async () => {
    const harness = await startSoloMatch();

    // 400 cycles is ~3x the number this deterministic seed actually needs; it
    // exists so a regression fails the test instead of hanging it.
    let cycles = 0;
    for (; cycles < 400; cycles += 1) {
      const room = await requireRoom(harness.repository);
      if (room.game === null || room.game.status !== "active") break;
      await takeHumanTurn(harness);
      await harness.driver.drive(roomId);
    }

    const final = await requireRoom(harness.repository);
    expect(cycles).toBeLessThan(400);
    expect(final.game?.status).toBe("ended");
    expect(final.game?.outcome?.reason).toBe("director-reached");
    expect(final.game?.outcome?.winnerPlayerIds.length).toBe(1);
    expect(final.eventSummaries.length).toBeGreaterThan(100);
    expect(harness.defects).toEqual([]);

    // A drain after the match has ended is a silent no-op, not an anomaly.
    const revisionAtEnd = final.revision;
    await harness.driver.drive(roomId);
    expect((await requireRoom(harness.repository)).revision).toBe(revisionAtEnd);
    expect(harness.defects).toEqual([]);
  });

  it("Given two overlapping drains for the same room, When both run, Then exactly one drain's worth of commands is applied", async () => {
    const overlapping = await startSoloMatch();
    await takeHumanTurn(overlapping);
    await Promise.all([
      overlapping.driver.drive(roomId),
      overlapping.driver.drive(roomId),
    ]);

    const single = await startSoloMatch();
    await takeHumanTurn(single);
    await single.driver.drive(roomId);

    const overlappingRoom = await requireRoom(overlapping.repository);
    const singleRoom = await requireRoom(single.repository);

    expect(overlappingRoom.game?.revision).toBe(singleRoom.game?.revision);
    expect(overlappingRoom.revision).toBe(singleRoom.revision);
    expect(overlapping.published.map((entry) => entry.messageId)).toEqual(
      single.published.map((entry) => entry.messageId),
    );
    expect(overlapping.timeline).toEqual(single.timeline);
    expect(overlapping.defects).toEqual([]);
  });

  it("Given a drain already holding a stale human-on-turn snapshot, When a human command commits and kicks the driver, Then the bot's turn is still driven", async () => {
    const harness = await startSoloMatch();

    // A repository whose read takes its snapshot immediately but only *returns*
    // it once released — the real Postgres shape, where a SELECT is on the wire
    // while another request commits.
    const atGate = deferred();
    const gate = deferred();
    let gateArmed = true;

    const gated: RoomRepository = {
      create: (room) => harness.repository.create(room),
      getByCode: (code) => harness.repository.getByCode(code),
      save: (room, expectedRevision) => harness.repository.save(room, expectedRevision),
      async get(id) {
        const snapshot = await harness.repository.get(id);
        if (gateArmed) {
          gateArmed = false;
          atGate.resolve();
          await gate.promise;
        }
        return snapshot;
      },
    };

    const defects: BotDriverEvent[] = [];
    const driver = createBotDriver({
      roomService: harness.service,
      repository: gated,
      delayMs: 0,
      sleep: async () => undefined,
      publish: async () => undefined,
      onEvent: (event) => {
        if (isDefect(event)) defects.push(event);
      },
    });

    // The drain reads the host-on-turn snapshot and parks holding it.
    const firstDrain = driver.drive(roomId);
    await atGate.promise;

    // Only now does the human's command land, putting a bot on turn, and only
    // now does the route's kick arrive — while the drain is still in flight.
    await takeHumanTurn(harness);
    expect((await requireRoom(harness.repository)).game?.turn.activePlayerId).toBe(firstBot);
    const kick = driver.drive(roomId);

    gate.resolve();
    await Promise.all([firstDrain, kick]);

    // Both bots must have played: the kick may not be answered out of the
    // snapshot the drain read before the human acted.
    const after = await requireRoom(harness.repository);
    expect(after.game?.turn.activePlayerId).toBe(host);
    expect(defects).toEqual([]);
  });

  it("Given a bot command that already committed, When it is replayed at its original revision, Then it fails as stale and changes nothing", async () => {
    const harness = await startSoloMatch();
    await takeHumanTurn(harness);
    const beforeBots = await requireRoom(harness.repository);
    const staleRevision = beforeBots.game?.revision ?? 0;

    await harness.driver.drive(roomId);
    const replayed = harness.published[0];
    expect(replayed).toBeDefined();
    if (replayed === undefined) return;

    const afterBots = await requireRoom(harness.repository);
    const replay = await harness.service.roll({
      roomId,
      actorId: firstBot,
      actorKind: "bot",
      commandId: replayed.messageId,
      expectedRevision: staleRevision,
    });

    expect(replay).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
    const afterReplay = await requireRoom(harness.repository);
    expect(afterReplay.revision).toBe(afterBots.revision);
    expect(afterReplay.game?.revision).toBe(afterBots.game?.revision);
    expect(afterReplay.eventSummaries.length).toBe(afterBots.eventSummaries.length);
  });

  it("Given a bot that is the active player with nothing legal to do, When the driver drains, Then the stall is reported instead of silently ignored", async () => {
    const harness = await startSoloMatch();
    const room = await requireRoom(harness.repository);
    const game = room.game;
    expect(game).not.toBeNull();
    if (game === null) return;

    // A bot is active but the engine is mid-resolution, so enumerateLegalActions
    // returns nothing — exactly the shape of a wedged match.
    await harness.repository.save({
      ...room,
      game: {
        ...game,
        turn: { ...game.turn, activePlayerId: createStableId("PlayerId", firstBot) },
        pendingEffects: [
          ...game.pendingEffects,
          {
            id: createStableId("EffectId", "effect-blocking-stall"),
            frameId: createStableId("FrameId", "frame-blocking-stall"),
            sourceId: "tile.board.00.reception",
            affectedPlayerIds: [createStableId("PlayerId", firstBot)],
            effect: { type: "modifyResource" },
            preventionEligible: false,
            visibility: "public",
          },
        ],
      },
    } satisfies StoredRoom, room.revision);

    await harness.driver.drive(roomId);

    // Reported as a defect, and with enough context to act on: which room, which
    // player, and where in the turn it wedged. Asserted on the event name and
    // the presence of those fields rather than on any wording.
    expect(harness.defects.length).toBe(1);
    const stall = harness.defects[0];
    expect(stall?.type).toBe("bot.drain.finished");
    if (stall?.type !== "bot.drain.finished") return;
    expect(stall.roomId).toBe(roomId);
    expect(stall.actions).toBe(0);
    expect(stall.stop.kind).toBe("bot-cannot-decide");
    if (stall.stop.kind !== "bot-cannot-decide") return;
    expect(stall.stop.playerId).toBe(firstBot);
    expect(stall.stop.phase).toBe(game.turn.phase);
    expect(stall.stop.gameRevision).toBe(game.revision);

    // The log line an operator would actually see says so, at error level.
    expect(botDriverEventLevel(stall)).toBe("error");
    expect(botDriverEventContext(stall)).toMatchObject({
      room: roomId,
      player: firstBot,
      stop: "bot-cannot-decide",
    });
    expect(harness.timeline).toEqual([]);
  });

  it("Given a normal quiet stop, When the driver drains, Then it is reported but classified as correct behaviour, not a defect", async () => {
    const harness = await startSoloMatch();

    // Nothing to do: the match starts on the human's turn.
    await harness.driver.drive(roomId);

    const stops = drainStops(harness.events);
    expect(stops.length).toBe(1);
    const stop = stops[0];
    expect(stop?.type).toBe("bot.drain.finished");
    if (stop?.type !== "bot.drain.finished") return;

    // The distinction the whole taxonomy exists for: "a human holds the turn" is
    // the driver working, and is *not* reported as a defect …
    expect(stop.stop.kind).toBe("human-turn");
    expect(isBotDrainDefect(stop.stop)).toBe(false);
    expect(harness.defects).toEqual([]);
    // … and, because this drain applied nothing, its line stays below the
    // default level. The GET bootstrap kicks one of these every ~5s per client.
    expect(botDriverEventLevel(stop)).toBe("debug");

    // A drain that did move the game reports the same benign stop at info.
    await takeHumanTurn(harness);
    await harness.driver.drive(roomId);
    const afterBots = drainStops(harness.events).at(-1);
    expect(afterBots?.type).toBe("bot.drain.finished");
    if (afterBots?.type !== "bot.drain.finished") return;
    expect(afterBots.actions).toBeGreaterThan(0);
    expect(botDriverEventLevel(afterBots)).toBe("info");
  });

  it("Given each committed bot command, When the driver drains, Then it is reported with the room, the seat and both revisions", async () => {
    const harness = await startSoloMatch();
    await takeHumanTurn(harness);
    await harness.driver.drive(roomId);

    const commands = harness.events.filter((event) => event.type === "bot.command.applied");
    expect(commands.length).toBe(harness.published.length);
    expect(commands.length).toBeGreaterThanOrEqual(2);

    for (const command of commands) {
      if (command.type !== "bot.command.applied") continue;
      expect(command.roomId).toBe(roomId);
      expect([firstBot, secondBot]).toContain(command.playerId);
      expect(command.revision).toBeGreaterThan(0);
      expect(command.gameRevision).toBeGreaterThan(0);
      expect(botDriverEventLevel(command)).toBe("info");
      expect(botDriverEventContext(command)).toMatchObject({
        room: roomId,
        player: command.playerId,
        command: command.commandId,
      });
    }
    expect(harness.defects).toEqual([]);
  });

  it("Given a broadcast that throws, When a bot turn has already committed, Then the failure is reported and the remaining turns still run", async () => {
    const harness = await startSoloMatch();
    await takeHumanTurn(harness);

    const events: BotDriverEvent[] = [];
    const driver = createBotDriver({
      roomService: harness.service,
      repository: harness.repository,
      delayMs: 0,
      sleep: async () => undefined,
      publish: async () => {
        throw new Error("socket exploded");
      },
      onEvent: (event) => events.push(event),
    });

    await driver.drive(roomId);

    // The command was already committed, so the drain must not abandon the rest
    // of the bots — but the dropped broadcast has to be visible.
    const failures = events.filter((event) => event.type === "bot.publish.failed");
    expect(failures.length).toBeGreaterThan(0);
    const failure = failures[0];
    if (failure?.type !== "bot.publish.failed") return;
    expect(botDriverEventLevel(failure)).toBe("error");
    expect(botDriverEventContext(failure)).toMatchObject({
      room: roomId,
      error: "Error: socket exploded",
    });
    expect((await requireRoom(harness.repository)).game?.turn.activePlayerId).toBe(host);
  });

  it("Given a reporting sink that throws, When a bot turn is applied, Then the committed turn is not lost", async () => {
    const harness = await startSoloMatch();
    await takeHumanTurn(harness);

    const driver = createBotDriver({
      roomService: harness.service,
      repository: harness.repository,
      delayMs: 0,
      sleep: async () => undefined,
      publish: async () => undefined,
      onEvent: () => {
        throw new Error("the logger is broken");
      },
    });

    // A broken reporter must never be able to abort work that is already
    // committed: the bots still finish their turns.
    await expect(driver.drive(roomId)).resolves.toBeUndefined();
    expect((await requireRoom(harness.repository)).game?.turn.activePlayerId).toBe(host);
  });
});
