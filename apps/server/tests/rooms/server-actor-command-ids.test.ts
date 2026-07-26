import { describe, expect, it } from "vitest";

import { isServerActorCommandId, parseRollRequest } from "@office-ladder/contracts";
import {
  createStableId,
  enumerateLegalActions,
  type GameState,
} from "@office-ladder/engine";
import {
  botCommandId,
  createBotDriver,
  type BotDriverEvent,
} from "../../src/rooms/bots/bot-driver";
import { decideBotAction } from "../../src/rooms/bots/bot-policy";
import { botSeatFor } from "../../src/rooms/bots/bot-seats";
import { readBotTable } from "../../src/rooms/bots/bot-view";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { botSubmitterFor } from "./bot-submitter";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";
import {
  createTurnTimeoutDriver,
  type TurnTimeoutDriverEvent,
} from "../../src/rooms/turn-timer/turn-timeout-driver";

/**
 * The two halves of the reserved-command-id guard, tied together.
 *
 * `packages/contracts` proves the boundary refuses ids under the reserved
 * prefixes; that is only worth anything if the ids the drivers *actually mint*
 * fall inside the set being refused. Neither package can assert that alone, and a
 * driver changing its id format is exactly the silent way the guard stops
 * covering it — the contract would keep refusing a namespace nobody uses any more
 * while the real ids became claimable again.
 *
 * The failure being prevented: both drivers derive their command id from
 * `(gameId, gameRevision, kind)`, all of which a client can read from its own
 * bootstrap. The engine's idempotency check answers INVALID_COMMAND for a
 * re-used id, which both drivers treat as an expected "the world moved on" stop.
 * So one roll carrying the id the bot driver is about to derive makes the bot's
 * turn be refused as already-applied — silently, and permanently, because nobody
 * else may act on a bot's turn and every later kick re-derives the same id.
 */

const host = createStableId("PlayerId", "user-host");
const second = createStableId("PlayerId", "user-second");
const third = createStableId("PlayerId", "user-third");
const roomId = "room-actor-command-id-test";
const START_MS = Date.parse("2026-07-26T12:00:00.000Z");
const TIMEOUT_MS = 30_000;

function createService(
  repository: InMemoryRoomRepository,
  now: () => string,
  turnTimeoutMs: number,
): RoomService {
  return createRoomService({
    repository,
    now,
    ids: {
      roomId: () => roomId,
      roomCode: () => "ACT456",
      gameId: () => createStableId("GameId", "game-actor-command-id-test"),
      commandId: () => createStableId("CommandId", "command-actor-command-id-test"),
    },
    gameSeed: () => "actor-command-id-seed",
    turnTimeoutMs,
  });
}

async function requireRoom(repository: InMemoryRoomRepository): Promise<StoredRoom> {
  const room: StoredRoom | null = await repository.get(roomId);
  if (room === null) throw new Error("room vanished");
  return room;
}

async function requireGame(repository: InMemoryRoomRepository): Promise<GameState> {
  const game = (await requireRoom(repository)).game;
  if (game === null) throw new Error("game vanished");
  return game;
}

/**
 * Plays the human's turns until a bot holds the turn.
 *
 * Deliberately not "roll once": how many human turns pass before a bot is active
 * depends on the dice, a tile granting an extra roll keeps the human on turn, and
 * an audit tile replaces the roll with a prompt. A test that assumed a single roll
 * would silently stop exercising the bot driver the moment the seed, the board or
 * the tile effects changed — which is exactly what happened while writing this.
 *
 * `mintCommandId` receives the revision the command will produce, so a caller can
 * pre-claim exactly the id the bot driver would derive at that revision.
 */
async function rollUntilBotTurn(
  service: RoomService,
  repository: InMemoryRoomRepository,
  mintCommandId: (nextRevision: number, game: GameState) => string,
): Promise<GameState> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const room = await requireRoom(repository);
    const game = room.game;
    if (game === null) throw new Error("game vanished");
    if (game.status !== "active") throw new Error("match ended before a bot's turn");
    const activePlayerId = game.turn.activePlayerId;
    if (activePlayerId === null) throw new Error("no active player");
    if (botSeatFor(room, activePlayerId) !== null) return game;

    const commandId = mintCommandId(game.revision + 1, game);
    const legalActions = enumerateLegalActions(game, activePlayerId);
    const prompt = legalActions.find((action) => action.type === "prompt.respond");
    if (prompt !== undefined && prompt.type === "prompt.respond") {
      const optionId = prompt.options[0];
      if (optionId === undefined) throw new Error("prompt offered no options");
      expect(
        await service.respondToPrompt({
          roomId,
          actorId: activePlayerId,
          actorKind: "human",
          commandId,
          expectedRevision: prompt.expectedRevision,
          decisionPointId: String(prompt.decisionPointId),
          optionId: String(optionId),
        }),
      ).toMatchObject({ ok: true });
      continue;
    }

    const roll = legalActions.find((action) => action.type === "turn.roll");
    if (roll === undefined) throw new Error("the human has no legal action");
    expect(
      await service.roll({
        roomId,
        actorId: activePlayerId,
        actorKind: "human",
        commandId,
        expectedRevision: roll.expectedRevision,
      }),
    ).toMatchObject({ ok: true });
  }

  throw new Error("no bot ever took the turn");
}

describe("server-actor command id namespace", () => {
  it("Given a real bot turn, When the driver mints its command id, Then no client could have sent that id", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository, () => "2026-07-26T12:00:00.000Z", 0);
    const events: BotDriverEvent[] = [];
    const driver = createBotDriver({
      submit: botSubmitterFor(service, repository),
      repository,
      configuredDelayMs: 0,
      sleep: async () => undefined,
      publish: async () => undefined,
      onEvent: (event) => events.push(event),
    });

    await service.create({
      hostId: host,
      playerName: "Host",
      modeId: "mode.quick",
      capacity: 3,
    });
    await service.addBot({ roomId, actorId: host, difficulty: "standard" });
    await service.addBot({ roomId, actorId: host, difficulty: "easy" });
    expect(await service.start({ roomId, actorId: host, actorKind: "human" })).toMatchObject({
      ok: true,
    });
    // The human plays until a bot holds the turn, with ordinary client ids.
    await rollUntilBotTurn(
      service,
      repository,
      (nextRevision) => `client-${nextRevision}`,
    );

    await driver.drive(roomId);

    const minted = events
      .filter((event) => event.type === "bot.command.applied")
      .map((event) => event.commandId);
    // A positive control first: if the drain applied nothing, everything below
    // would vacuously pass.
    expect(minted.length).toBeGreaterThan(0);
    for (const commandId of minted) {
      expect(isServerActorCommandId(commandId)).toBe(true);
      // The assertion that actually matters: this exact string cannot cross the
      // API boundary, so no member can pre-claim it.
      expect(() => parseRollRequest({ commandId, expectedRevision: 0 })).toThrow();
    }
  });

  it("Given a real turn-clock expiry, When the driver mints its command id, Then no client could have sent that id either", async () => {
    const repository = new InMemoryRoomRepository();
    let nowMs = START_MS;
    const now = (): string => new Date(nowMs).toISOString();
    const service = createService(repository, now, TIMEOUT_MS);
    const events: TurnTimeoutDriverEvent[] = [];
    const driver = createTurnTimeoutDriver({
      roomService: service,
      repository,
      now,
      timeoutMs: TIMEOUT_MS,
      publish: async () => undefined,
      driveBots: async () => undefined,
      setTimer: () => () => undefined,
      onEvent: (event) => events.push(event),
    });

    await service.create({ hostId: host, playerName: "Host", modeId: "mode.quick" });
    await service.join({ roomId, actorId: second, playerName: "Second" });
    await service.join({ roomId, actorId: third, playerName: "Third" });
    expect(await service.start({ roomId, actorId: host, actorKind: "human" })).toMatchObject({
      ok: true,
    });
    nowMs += TIMEOUT_MS;

    await driver.drive(roomId);

    const minted = events
      .filter((event) => event.type === "turn-timeout.applied")
      .map((event) => event.commandId);
    expect(minted.length).toBeGreaterThan(0);
    for (const commandId of minted) {
      expect(isServerActorCommandId(commandId)).toBe(true);
      expect(() => parseRollRequest({ commandId, expectedRevision: 0 })).toThrow();
    }
  });

  it("Given an id from the reserved namespace reaching the service anyway, When a driver later derives it, Then the refusal is the wedge the boundary exists to prevent", async () => {
    // The service is deliberately *not* the layer that enforces this — it cannot
    // tell the timeout driver (which legitimately acts as a human) from the human
    // it acts for. So this documents the consequence of the guard being bypassed,
    // and is what makes the boundary test above load-bearing rather than
    // decorative: the id below is refused at the route, and this is why.
    const repository = new InMemoryRoomRepository();
    const service = createService(repository, () => "2026-07-26T12:00:00.000Z", 0);
    const events: BotDriverEvent[] = [];
    const driver = createBotDriver({
      submit: botSubmitterFor(service, repository),
      repository,
      configuredDelayMs: 0,
      sleep: async () => undefined,
      publish: async () => undefined,
      onEvent: (event) => events.push(event),
    });

    await service.create({
      hostId: host,
      playerName: "Host",
      modeId: "mode.quick",
      capacity: 3,
    });
    await service.addBot({ roomId, actorId: host, difficulty: "standard" });
    await service.addBot({ roomId, actorId: host, difficulty: "easy" });
    await service.start({ roomId, actorId: host, actorKind: "human" });
    const handover = await rollUntilBotTurn(
      service,
      repository,
      (nextRevision) => `human:${nextRevision}`,
    );

    // The id the driver will actually mint for this bot's next command, derived
    // through the driver's own helper and the policy's own decision rather than
    // by assuming a spelling.
    //
    // The previous version of this test pre-claimed
    // `bot:<gameId>:<revision>:roll` from every human roll, which worked only
    // while `roll` was one of two things a bot could ever do. A bot now opens
    // its turn with whichever rung of the ladder fires first, so a hard-coded
    // slug would have quietly stopped colliding — and a wedge test that no
    // longer wedges anything passes for the wrong reason.
    const room = await requireRoom(repository);
    const activePlayerId = handover.turn.activePlayerId;
    if (activePlayerId === null) throw new Error("no active player");
    const table = readBotTable(handover, activePlayerId);
    if (table === null) throw new Error("the bot is not seated");
    const decision = decideBotAction({
      legalActions: enumerateLegalActions(handover, activePlayerId),
      difficulty: botSeatFor(room, activePlayerId)?.difficulty ?? "standard",
      table,
    });
    const claimed = botCommandId(handover, decision);
    expect(isServerActorCommandId(claimed)).toBe(true);

    // Written straight to the repository, which is what a *client* command
    // carrying that id would have left behind: `lastCommandId` is the engine's
    // whole idempotency check. It cannot be produced by an actual request here,
    // because by this point the turn belongs to a bot and no human may act on it
    // — which is precisely why pre-claiming is the attack and why the namespace
    // is reserved at the route instead.
    expect(
      await repository.save(
        {
          ...room,
          revision: room.revision + 1,
          game: { ...handover, lastCommandId: createStableId("CommandId", claimed) },
        },
        room.revision,
      ),
    ).toEqual({ ok: true });

    await driver.drive(roomId);

    // The bot never gets to move, and — the reason this was worth reserving a
    // namespace over — the match cannot recover: no human may act on a bot's
    // turn, and every later kick re-derives the identical refused id.
    expect(events.filter((event) => event.type === "bot.command.applied")).toHaveLength(0);
    const stops = events.filter((event) => event.type === "bot.drain.finished");
    expect(stops.at(-1)).toMatchObject({
      stop: { kind: "command-rejected", code: "INVALID_COMMAND" },
    });
    const wedged = await requireGame(repository);
    await driver.drive(roomId);
    expect((await requireGame(repository)).revision).toBe(wedged.revision);
  });
});
