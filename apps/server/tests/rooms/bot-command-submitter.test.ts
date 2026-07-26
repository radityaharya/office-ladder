import { describe, expect, it } from "vitest";

import { createStableId, enumerateLegalActions, type PlayerId } from "@office-ladder/engine";
import type { BotCommandSubmitter } from "../../src/rooms/bots/bot-command-submitter";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type {
  ActiveStoredRoom,
  RoomService,
  StoredRoom,
} from "../../src/rooms/service/types";
import { botSubmitterFor } from "./bot-submitter";

/**
 * The bot driver's transport: what it carries, and what it refuses.
 *
 * The `RoomService` still exposes only `roll()` and `respondToPrompt()`, so this
 * adapter is what lets a bot send the other twenty-six commands — including
 * `promotion.attempt`, without which no shipped mode can be won. Two properties
 * matter and are asserted separately:
 *
 * - **Identity** (§6.3): the actor must be a bot seat *in this room*. This is the
 *   check the engine cannot make — the engine validates game legality, not who a
 *   server-side actor is entitled to act for.
 * - **Persistence**: the write is conditional on the revision it was derived
 *   from, and what it stores round-trips.
 */

const host = createStableId("PlayerId", "user-host");
const stranger = createStableId("PlayerId", "user-stranger");
const roomId = "room-bot-submitter-test";
const firstBot = createStableId("PlayerId", `bot:${roomId}:0`);

type Fixture = {
  readonly repository: InMemoryRoomRepository;
  readonly service: RoomService;
  readonly submit: BotCommandSubmitter;
  readonly room: ActiveStoredRoom;
};

async function startMatch(): Promise<Fixture> {
  const repository = new InMemoryRoomRepository();
  const service = createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "SUB456",
      gameId: () => createStableId("GameId", "game-bot-submitter-test"),
      commandId: () => createStableId("CommandId", "command-bot-submitter-test"),
    },
    gameSeed: () => "bot-submitter-seed",
    turnTimeoutMs: 0,
  });

  await service.create({ hostId: host, playerName: "Host", modeId: "mode.quick", capacity: 3 });
  await service.addBot({ roomId, actorId: host, difficulty: "standard" });
  await service.addBot({ roomId, actorId: host, difficulty: "easy" });
  const started = await service.start({ roomId, actorId: host, actorKind: "human" });
  if (!started.ok) throw new Error(`start failed: ${started.error.code}`);

  return {
    repository,
    service,
    submit: botSubmitterFor(service, repository),
    room: started.value,
  };
}

async function requireRoom(repository: InMemoryRoomRepository): Promise<StoredRoom> {
  const room = await repository.get(roomId);
  if (room === null) throw new Error("room vanished");
  return room;
}

/** Hands the turn to the first bot by taking the human's roll. */
async function handTurnToBot(fixture: Fixture): Promise<StoredRoom> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const room = await requireRoom(fixture.repository);
    const game = room.game;
    if (game === null || game.status !== "active") throw new Error("match is not live");
    const activePlayerId = game.turn.activePlayerId;
    if (activePlayerId !== host) return room;

    const roll = enumerateLegalActions(game, host).find(
      (action) => action.type === "turn.roll",
    );
    if (roll === undefined) throw new Error("the human has no roll");
    const rolled = await fixture.service.roll({
      roomId,
      actorId: host,
      actorKind: "human",
      commandId: `human:${game.revision}`,
      expectedRevision: roll.expectedRevision,
    });
    if (!rolled.ok) throw new Error(`human roll failed: ${rolled.error.code}`);
  }

  throw new Error("no bot ever took the turn");
}

const workAction = {
  type: "turn.action",
  payload: { action: "work", targetPlayerIds: [] as readonly PlayerId[], choice: null },
} as const;

describe("the bot command transport — the happy path", () => {
  it("Given a bot on turn, When a non-roll command is submitted, Then it commits and both revisions advance", async () => {
    const fixture = await startMatch();
    const before = await handTurnToBot(fixture);
    const game = before.game;
    if (game === null) throw new Error("game vanished");
    const activePlayerId = game.turn.activePlayerId;
    if (activePlayerId === null) throw new Error("no active player");

    const result = await fixture.submit({
      roomId,
      actorId: activePlayerId,
      commandId: `bot:${String(game.gameId)}:${game.revision}:act`,
      expectedRevision: game.revision,
      command: workAction,
    });

    expect(result.ok).toBe(true);
    const after = await requireRoom(fixture.repository);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.game?.revision).toBe(game.revision + 1);
    // The redacted feed is appended by the same helper the room service uses, so
    // a bot's command is as visible to clients as a human's.
    expect(after.eventSummaries.length).toBeGreaterThan(before.eventSummaries.length);
  });

  it("Given a committed command, When it is replayed at its original revision, Then the write is refused", async () => {
    const fixture = await startMatch();
    const before = await handTurnToBot(fixture);
    const game = before.game;
    if (game === null) throw new Error("game vanished");
    const activePlayerId = game.turn.activePlayerId;
    if (activePlayerId === null) throw new Error("no active player");

    const submission = {
      roomId,
      actorId: activePlayerId,
      commandId: `bot:${String(game.gameId)}:${game.revision}:act`,
      expectedRevision: game.revision,
      command: workAction,
    } as const;
    expect((await fixture.submit(submission)).ok).toBe(true);
    const committed = await requireRoom(fixture.repository);

    const replayed = await fixture.submit(submission);

    expect(replayed.ok).toBe(false);
    // Nothing moved: the revision predicate is what makes a duplicated drain
    // cost a refusal rather than a double-apply.
    const after = await requireRoom(fixture.repository);
    expect(after.revision).toBe(committed.revision);
    expect(after.game?.revision).toBe(committed.game?.revision);
  });
});

describe("the bot command transport — identity", () => {
  it("Given a human member as the actor, When a command is submitted, Then it is refused before the engine sees it", async () => {
    const fixture = await startMatch();
    const before = await requireRoom(fixture.repository);

    const result = await fixture.submit({
      roomId,
      actorId: host,
      commandId: "bot:hostile:human-seat",
      expectedRevision: fixture.room.game.revision,
      command: workAction,
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_BOT" } });
    expect((await requireRoom(fixture.repository)).revision).toBe(before.revision);
  });

  it("Given somebody who is not in the room, When a command is submitted, Then it is refused as a non-member", async () => {
    const fixture = await startMatch();

    const result = await fixture.submit({
      roomId,
      actorId: stranger,
      commandId: "bot:hostile:stranger",
      expectedRevision: fixture.room.game.revision,
      command: workAction,
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_MEMBER" } });
  });

  it("Given a room that does not exist, When a command is submitted, Then it is refused rather than throwing", async () => {
    const fixture = await startMatch();

    const result = await fixture.submit({
      roomId: "room-does-not-exist",
      actorId: firstBot,
      commandId: "bot:hostile:no-room",
      expectedRevision: 0,
      command: workAction,
    });

    expect(result).toEqual({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
  });

  it("Given a bot seat acting out of turn, When a command is submitted, Then the engine refuses it even though identity passed", async () => {
    // Both checks have to exist and neither substitutes for the other: this actor
    // *is* a bot in this room, and the command is still illegal.
    const fixture = await startMatch();

    const result = await fixture.submit({
      roomId,
      actorId: firstBot,
      commandId: "bot:legality:out-of-turn",
      expectedRevision: fixture.room.game.revision,
      command: workAction,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "NOT_ACTOR_TURN" } });
  });
});

describe("the bot command transport — a mechanic switched off", () => {
  it("Given mode.quick, which disables tile ownership, When a bot tries to claim a tile, Then the engine refuses it", async () => {
    // `mode.quick` sets `board.ownershipEnabled: false`. The enumerator never
    // offers the command, but the transport must not be the only thing standing
    // between a disabled mechanic and the game state.
    const fixture = await startMatch();
    const before = await handTurnToBot(fixture);
    const game = before.game;
    if (game === null) throw new Error("game vanished");
    const activePlayerId = game.turn.activePlayerId;
    if (activePlayerId === null) throw new Error("no active player");

    const tileId = game.tileIds[game.players[activePlayerId]?.position ?? 0];
    if (tileId === undefined) throw new Error("no tile under the bot");

    const result = await fixture.submit({
      roomId,
      actorId: activePlayerId,
      commandId: "bot:disabled:claim",
      expectedRevision: game.revision,
      command: { type: "tile.claim", payload: { tileId: String(tileId) } },
    });

    expect(result.ok).toBe(false);
    expect((await requireRoom(fixture.repository)).revision).toBe(before.revision);
  });

  it("Given mode.quick, which disables loans, When a bot tries to borrow, Then the engine refuses it", async () => {
    const fixture = await startMatch();
    const before = await handTurnToBot(fixture);
    const game = before.game;
    if (game === null) throw new Error("game vanished");
    const activePlayerId = game.turn.activePlayerId;
    if (activePlayerId === null) throw new Error("no active player");

    const result = await fixture.submit({
      roomId,
      actorId: activePlayerId,
      commandId: "bot:disabled:loan",
      expectedRevision: game.revision,
      command: { type: "loan.take", payload: { principal: 1_000 } },
    });

    expect(result.ok).toBe(false);
    expect((await requireRoom(fixture.repository)).revision).toBe(before.revision);
  });
});

describe("the bot command transport — hostile and malformed payloads", () => {
  it.each([
    ["an unknown free action", { action: "embezzle", targetPlayerIds: [], choice: null }],
    ["an empty action name", { action: "", targetPlayerIds: [], choice: null }],
  ])(
    "Given %s, When it is submitted for a bot on turn, Then it is refused and nothing is stored",
    async (_label, payload) => {
      const fixture = await startMatch();
      const before = await handTurnToBot(fixture);
      const game = before.game;
      if (game === null) throw new Error("game vanished");
      const activePlayerId = game.turn.activePlayerId;
      if (activePlayerId === null) throw new Error("no active player");

      const result = await fixture.submit({
        roomId,
        actorId: activePlayerId,
        commandId: "bot:hostile:free-action",
        expectedRevision: game.revision,
        command: { type: "turn.action", payload },
      });

      expect(result.ok).toBe(false);
      expect((await requireRoom(fixture.repository)).revision).toBe(before.revision);
    },
  );

  it.each([
    ["a negative principal", -5_000],
    ["a fractional principal", 12.5],
    ["an unsafe principal", Number.MAX_SAFE_INTEGER + 10],
  ])(
    "Given %s on a loan, When it is submitted, Then it is refused and nothing is stored",
    async (_label, principal) => {
      const fixture = await startMatch();
      const before = await handTurnToBot(fixture);
      const game = before.game;
      if (game === null) throw new Error("game vanished");
      const activePlayerId = game.turn.activePlayerId;
      if (activePlayerId === null) throw new Error("no active player");

      const result = await fixture.submit({
        roomId,
        actorId: activePlayerId,
        commandId: "bot:hostile:loan",
        expectedRevision: game.revision,
        command: { type: "loan.take", payload: { principal } },
      });

      expect(result.ok).toBe(false);
      expect((await requireRoom(fixture.repository)).revision).toBe(before.revision);
    },
  );

  it("Given an attack aimed at a player who is not seated, When it is submitted, Then it is refused", async () => {
    const fixture = await startMatch();
    const before = await handTurnToBot(fixture);
    const game = before.game;
    if (game === null) throw new Error("game vanished");
    const activePlayerId = game.turn.activePlayerId;
    if (activePlayerId === null) throw new Error("no active player");

    const result = await fixture.submit({
      roomId,
      actorId: activePlayerId,
      commandId: "bot:hostile:attack",
      expectedRevision: game.revision,
      command: {
        type: "attack.target",
        payload: {
          targetPlayerId: createStableId("PlayerId", "user-ghost"),
          vector: "vector.smear",
          cardId: null,
        },
      },
    });

    expect(result.ok).toBe(false);
    expect((await requireRoom(fixture.repository)).revision).toBe(before.revision);
  });

  it("Given a stale expectedRevision, When a command is submitted, Then it is refused rather than applied to newer state", async () => {
    const fixture = await startMatch();
    const before = await handTurnToBot(fixture);
    const game = before.game;
    if (game === null) throw new Error("game vanished");
    const activePlayerId = game.turn.activePlayerId;
    if (activePlayerId === null) throw new Error("no active player");

    const result = await fixture.submit({
      roomId,
      actorId: activePlayerId,
      commandId: "bot:hostile:stale",
      expectedRevision: game.revision - 1,
      command: workAction,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    expect((await requireRoom(fixture.repository)).revision).toBe(before.revision);
  });
});
