import { describe, expect, it } from "vitest";

import { SERVER_INJECTED_COMMAND_TYPES } from "@office-ladder/contracts";
import { createStableId, type GameState, type PlayerId } from "@office-ladder/engine";
import { Hono } from "hono";

import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService } from "../../src/rooms/service/types";
import {
  createCommandGateway,
  InMemoryCommandReceiptStore,
  registerCommandRoutes,
  type CommandReceipt,
  type CommandReceiptStore,
} from "../../src/routes/commands";

/**
 * The one command endpoint (spec §11.1).
 *
 * These tests drive real `Request`s through a real Hono router into the real
 * gateway, room service and engine — only the session lookup, the broadcast and
 * the receipt store are stand-ins, because the first needs an auth backend and
 * the other two need Postgres. Everything the endpoint is *for* is therefore
 * exercised end to end: the same-origin check, the session, the exact-key body
 * validation, the entitlement guard, the revision predicate, idempotency, the
 * per-room queue, and the single refusal shape.
 *
 * `POST /:roomId/roll` and `POST /:roomId/respond` are **retired** (spec §11.1's
 * wave-5 deletion, now that the client posts only to `/commands`). Three tests
 * used to assert they behaved like `/commands`; they are replaced by tests that
 * assert they are gone, because a route deleted from the source is not the same
 * claim as a route unreachable over HTTP — a re-added alias, or a `/:roomId/:x`
 * pattern that happened to swallow the path, would both pass a source-level check.
 */

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
  stranger: createStableId("PlayerId", "user-stranger"),
} as const;

const roomId = "room-command-endpoint-test";
const ORIGIN = "http://localhost:3072";

type Harness = {
  readonly app: Hono;
  readonly service: RoomService;
  readonly repository: InMemoryRoomRepository;
  readonly receipts: CommandReceiptStore;
  readonly announced: { roomId: string; revision: number; messageId: string }[];
  /** Who the next request is from. Stands in for a Better Auth session. */
  caller: string | null;
};

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "CMD123",
      gameId: () => createStableId("GameId", "game-command-endpoint-test"),
      commandId: () => createStableId("CommandId", "command-endpoint-test"),
    },
    gameSeed: () => "command-endpoint-seed",
    // Off: an armed deadline would make these assertions depend on a clock.
    turnTimeoutMs: 0,
  });
}

function createHarness(
  overrides: { readonly receipts?: CommandReceiptStore } = {},
): Harness {
  const repository = new InMemoryRoomRepository();
  const service = createService(repository);
  const receipts = overrides.receipts ?? new InMemoryCommandReceiptStore();
  const announced: Harness["announced"] = [];

  const harness: Harness = {
    app: new Hono(),
    service,
    repository,
    receipts,
    announced,
    caller: players.host,
  };

  const router = new Hono();
  registerCommandRoutes(router, {
    gateway: createCommandGateway({ roomService: service, repository, receipts }),
    session: (headers) => {
      // Mirrors requireSession's contract exactly: a caller is resolved from the
      // request's own credentials, never from anything in the body. The header is
      // only how this test injects one.
      const caller = headers.get("x-test-user") ?? harness.caller;
      return Promise.resolve(
        caller === null
          ? { ok: false as const, error: { code: "UNAUTHORIZED", status: 401 } }
          : { ok: true as const, value: { userId: caller } },
      );
    },
    announce: (room, revision, messageId) => {
      announced.push({ roomId: room, revision, messageId });
      return Promise.resolve();
    },
  });
  harness.app.route("/api/rooms", router);

  return harness;
}

type PostOptions = {
  readonly as?: string | null;
  readonly origin?: string | null;
  readonly path?: string;
};

async function post(
  harness: Harness,
  body: unknown,
  options: PostOptions = {},
): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  if (options.as !== undefined && options.as !== null) headers.set("x-test-user", options.as);

  return harness.app.fetch(
    new Request(`${ORIGIN}/api/rooms/${roomId}${options.path ?? "/commands"}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function startedMatch(
  mode: "mode.quick" | "mode.marathon" = "mode.marathon",
  overrides: { readonly receipts?: CommandReceiptStore } = {},
): Promise<Harness> {
  const harness = createHarness(overrides);
  await harness.service.create({
    hostId: players.host,
    playerName: "Host",
    modeId: mode,
    capacity: 6,
  });
  await harness.service.join({ roomId, actorId: players.second, playerName: "Second" });
  await harness.service.join({ roomId, actorId: players.third, playerName: "Third" });
  const started = await harness.service.start({
    roomId,
    actorId: players.host,
    actorKind: "human",
    commandId: "start-command",
    expectedRevision: 2,
  });
  if (!started.ok) throw new Error(`setup failed: ${started.error.code}`);
  return harness;
}

async function currentGame(harness: Harness): Promise<GameState> {
  const room = await harness.repository.get(roomId);
  if (room?.game == null) throw new Error("room has no game");
  return room.game;
}

async function activePlayer(harness: Harness): Promise<PlayerId> {
  const game = await currentGame(harness);
  if (game.turn.activePlayerId === null) throw new Error("no active player");
  return game.turn.activePlayerId;
}

async function otherSeat(harness: Harness): Promise<PlayerId> {
  const active = await activePlayer(harness);
  const other = [players.host, players.second, players.third].find((id) => id !== active);
  if (other === undefined) throw new Error("no other seat");
  return other;
}

describe("POST /api/rooms/:roomId/commands — the happy path", () => {
  it("Given the active player, When they submit turn.roll, Then the room and the game both advance", async () => {
    const harness = await startedMatch();
    const before = await currentGame(harness);

    const response = await post(
      harness,
      { type: "turn.roll", commandId: "roll-1", expectedRevision: before.revision },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      room: { id: roomId, revision: 4 },
      command: { commandId: "roll-1", type: "turn.roll", replayed: false },
    });
    expect((await currentGame(harness)).revision).toBeGreaterThan(before.revision);
  });

  it("Given a committed command, When it lands, Then exactly one broadcast names its commandId", async () => {
    const harness = await startedMatch();

    await post(
      harness,
      {
        type: "turn.roll",
        commandId: "roll-broadcast",
        expectedRevision: (await currentGame(harness)).revision,
      },
      { as: await activePlayer(harness) },
    );

    expect(harness.announced).toEqual([
      { roomId, revision: 4, messageId: "roll-broadcast" },
    ]);
  });

  it("Given a mode with lending on, When the active player borrows, Then the generic path applies it", async () => {
    const harness = await startedMatch("mode.marathon");
    const before = await currentGame(harness);

    const response = await post(
      harness,
      {
        type: "loan.take",
        commandId: "loan-1",
        expectedRevision: before.revision,
        principal: 500,
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(200);
    const after = await currentGame(harness);
    const borrower = after.players[await activePlayer(harness)];
    expect(borrower?.loans).toHaveLength(1);
    expect(after.revision).toBe(before.revision + 1);
  });
});

describe("POST /api/rooms/:roomId/commands — the lifecycle command", () => {
  it("Given a lobby with enough players, When the host sends game.start, Then the match starts through the same endpoint", async () => {
    const harness = createHarness();
    await harness.service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      capacity: 6,
    });
    await harness.service.join({ roomId, actorId: players.second, playerName: "Second" });
    await harness.service.join({ roomId, actorId: players.third, playerName: "Third" });

    // `game.start`'s expectedRevision is the *room's*, not a game's — the game
    // does not exist yet. That is the whole reason it keeps its own service entry.
    const response = await post(
      harness,
      { type: "game.start", commandId: "start-via-commands", expectedRevision: 2 },
      { as: players.host },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      command: { type: "game.start", replayed: false },
    });
    expect((await harness.repository.get(roomId))?.status).toBe("active");
  });

  it("Given a member who is not the host, When they send game.start, Then only the host may start", async () => {
    const harness = createHarness();
    await harness.service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      capacity: 6,
    });
    await harness.service.join({ roomId, actorId: players.second, playerName: "Second" });
    await harness.service.join({ roomId, actorId: players.third, playerName: "Third" });

    const response = await post(
      harness,
      { type: "game.start", commandId: "start-not-host", expectedRevision: 2 },
      { as: players.second },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "ACTOR_NOT_HOST", command: "game.start", retryable: false },
    });
    expect((await harness.repository.get(roomId))?.status).toBe("open");
  });
});

describe("POST /api/rooms/:roomId/commands — actor entitlement", () => {
  it("Given a user who is not a member, When they submit any command, Then it is refused before the engine sees it", async () => {
    const harness = await startedMatch();
    const before = await currentGame(harness);

    const response = await post(
      harness,
      { type: "turn.roll", commandId: "roll-stranger", expectedRevision: before.revision },
      { as: players.stranger },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "ACTOR_NOT_MEMBER", command: "turn.roll", retryable: false },
    });
    // The decisive assertion: nothing moved. An entitlement check that ran after
    // the engine would still have refused, but only by luck of the turn order.
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });

  it("Given a seated player who is not the active one, When they roll, Then the engine refuses them", async () => {
    const harness = await startedMatch();
    const before = await currentGame(harness);

    const response = await post(
      harness,
      { type: "turn.roll", commandId: "roll-wrong-seat", expectedRevision: before.revision },
      { as: await otherSeat(harness) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "NOT_ACTOR_TURN", command: "turn.roll", retryable: false },
    });
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });

  it("Given a session presenting a bot seat's id, When it submits, Then the two authorities are refused to be crossed", async () => {
    const harness = createHarness();
    await harness.service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.marathon",
      capacity: 6,
    });
    await harness.service.join({ roomId, actorId: players.second, playerName: "Second" });
    const added = await harness.service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "standard",
    });
    if (!added.ok) throw new Error(added.error.code);
    const botSeat = added.value.bots[0]?.playerId;
    if (botSeat === undefined) throw new Error("no bot seat");
    const started = await harness.service.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
      commandId: "start-with-bot",
      expectedRevision: added.value.revision,
    });
    if (!started.ok) throw new Error(started.error.code);
    const before = await currentGame(harness);

    const response = await post(
      harness,
      { type: "turn.roll", commandId: "roll-as-bot", expectedRevision: before.revision },
      { as: botSeat },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "ACTOR_IS_BOT", command: "turn.roll", retryable: false },
    });
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });

  it("Given no session, When a command is submitted, Then it is unauthorised and never reaches the room", async () => {
    const harness = await startedMatch();
    harness.caller = null;
    const before = await currentGame(harness);

    const response = await post(harness, {
      type: "turn.roll",
      commandId: "roll-anon",
      expectedRevision: before.revision,
    });

    expect(response.status).toBe(401);
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });

  it("Given a cross-origin submission, When it arrives, Then it is refused before the session is read", async () => {
    const harness = await startedMatch();
    const before = await currentGame(harness);

    const response = await post(
      harness,
      { type: "turn.roll", commandId: "roll-evil", expectedRevision: before.revision },
      { as: await activePlayer(harness), origin: "https://evil.example" },
    );

    expect(response.status).toBe(403);
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });
});

describe("POST /api/rooms/:roomId/commands — the mode gate", () => {
  it("Given a mode with lending off, When a player borrows, Then the ruleset refuses it and nothing changes", async () => {
    const harness = await startedMatch("mode.quick");
    const before = await currentGame(harness);

    const response = await post(
      harness,
      {
        type: "loan.take",
        commandId: "loan-quick",
        expectedRevision: before.revision,
        principal: 500,
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "ILLEGAL_ACTION", command: "loan.take", retryable: false },
    });
    const after = await currentGame(harness);
    expect(after.revision).toBe(before.revision);
    expect(after.players[await activePlayer(harness)]?.loans).toEqual([]);
  });

  it("Given the same command in a mode that allows it, When it is submitted, Then it is accepted — so the refusal above is the ruleset, not the route", async () => {
    const harness = await startedMatch("mode.marathon");

    const response = await post(
      harness,
      {
        type: "loan.take",
        commandId: "loan-marathon",
        expectedRevision: (await currentGame(harness)).revision,
        principal: 500,
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(200);
  });
});

describe("POST /api/rooms/:roomId/commands — hostile input", () => {
  it("Given window.expire, When a player submits it, Then it is refused as server-injected", async () => {
    const harness = await startedMatch();
    const before = await currentGame(harness);

    const response = await post(
      harness,
      {
        type: "window.expire",
        commandId: "expire-1",
        expectedRevision: before.revision,
        decisionPointId: "decision-1",
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "SERVER_INJECTED_COMMAND", command: null, retryable: false },
    });
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });

  /**
   * Driven off `SERVER_INJECTED_COMMAND_TYPES` rather than a hand-written list.
   *
   * These three are the server acting as the clock (spec §7.1), and the reason a
   * player must never reach them is concrete: `window.expire` resolves an open
   * reaction window, so a seat that could submit one could close the window the
   * instant it opened and deny every other seat the chance to react. Looping the
   * constant is what makes a *fourth* server-injected type covered the moment it is
   * declared — the previous hardcoded `["quarter.advance", "turn.timeout"]` would
   * have gone on passing while the new one went unchecked at this endpoint.
   */
  it("Given every server-injected command type, When a player submits it, Then each is refused the same way", async () => {
    const harness = await startedMatch();
    const revision = (await currentGame(harness)).revision;

    // Pins the constant itself: a type quietly dropped from it would otherwise
    // shrink this loop rather than fail it, and dropping one is exactly how a
    // clock-only command becomes player-submittable.
    expect([...SERVER_INJECTED_COMMAND_TYPES]).toEqual([
      "window.expire",
      "quarter.advance",
      "turn.timeout",
    ]);

    for (const type of SERVER_INJECTED_COMMAND_TYPES) {
      const response = await post(
        harness,
        { type, commandId: `injected-${type}`, expectedRevision: revision },
        { as: await activePlayer(harness) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "SERVER_INJECTED_COMMAND", command: null, retryable: false },
      });
    }
    // Not one of them moved the game, and none of them was broadcast: the refusal
    // is upstream of the gateway, so there is nothing to undo.
    expect((await currentGame(harness)).revision).toBe(revision);
    expect(harness.announced).toEqual([]);
  });

  /**
   * The same refusal from a seat that is not the active player. The 403 must be
   * about *what* was submitted, not about whose turn it is — otherwise it would
   * disappear the moment the clock's authority was claimed by a bystander, which is
   * the more likely attacker: the seat that wants a reaction window closed early is
   * usually not the one who opened it.
   */
  it("Given a bystander seat, When it submits window.expire, Then it is refused as server-injected too", async () => {
    const harness = await startedMatch();
    const revision = (await currentGame(harness)).revision;

    const response = await post(
      harness,
      {
        type: "window.expire",
        commandId: "expire-bystander",
        expectedRevision: revision,
        decisionPointId: "decision-1",
      },
      { as: await otherSeat(harness) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "SERVER_INJECTED_COMMAND", command: null, retryable: false },
    });
    expect((await currentGame(harness)).revision).toBe(revision);
  });

  it("Given a body carrying an unknown extra field, When it is submitted, Then it is refused rather than ignored", async () => {
    const harness = await startedMatch();

    const response = await post(
      harness,
      {
        type: "turn.roll",
        commandId: "roll-extra",
        expectedRevision: (await currentGame(harness)).revision,
        actorId: players.second,
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", command: null, retryable: false },
    });
  });

  it("Given a commandId in the server actors' reserved namespace, When it is submitted, Then it is refused", async () => {
    const harness = await startedMatch();

    const response = await post(
      harness,
      {
        type: "turn.roll",
        commandId: "timeout:forged",
        expectedRevision: (await currentGame(harness)).revision,
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("Given an out-of-range numeric payload, When it is submitted, Then contracts refuses it before the engine", async () => {
    const harness = await startedMatch("mode.marathon");
    const before = await currentGame(harness);

    const response = await post(
      harness,
      {
        type: "loan.take",
        commandId: "loan-huge",
        expectedRevision: before.revision,
        principal: Number.MAX_SAFE_INTEGER,
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(400);
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });

  it("Given an unknown command type, When it is submitted, Then it is refused as a malformed request", async () => {
    const harness = await startedMatch();

    const response = await post(
      harness,
      {
        type: "turn.obliterate",
        commandId: "nope",
        expectedRevision: (await currentGame(harness)).revision,
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });
});

describe("POST /api/rooms/:roomId/commands — idempotency by commandId", () => {
  it("Given a retried submit, When it arrives again, Then the original outcome is returned and nothing applies twice", async () => {
    const harness = await startedMatch();
    const actor = await activePlayer(harness);
    const expectedRevision = (await currentGame(harness)).revision;
    const body = { type: "turn.roll", commandId: "roll-retry", expectedRevision };

    const first = await post(harness, body, { as: actor });
    const afterFirst = await currentGame(harness);
    const second = await post(harness, body, { as: actor });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ command: { replayed: false } });
    expect(await second.json()).toMatchObject({
      room: { revision: 4 },
      game: { revision: afterFirst.revision },
      command: { commandId: "roll-retry", replayed: true },
    });
    // The proof that the retry did nothing: the game is exactly where the first
    // submit left it, and only the first one was broadcast.
    expect((await currentGame(harness)).revision).toBe(afterFirst.revision);
    expect(harness.announced).toHaveLength(1);
  });

  it("Given a retry that could not be caught by the engine's lastCommandId, When it arrives, Then the receipt still catches it", async () => {
    const harness = await startedMatch("mode.marathon");
    const actor = await activePlayer(harness);
    const body = {
      type: "loan.take",
      commandId: "loan-two-ago",
      expectedRevision: (await currentGame(harness)).revision,
      principal: 500,
    };

    const first = await post(harness, body, { as: actor });
    expect(first.status).toBe(200);
    const afterFirst = await currentGame(harness);
    // Another command lands in between, so the engine's single-slot
    // `lastCommandId` no longer names the retried one — which is exactly the gap
    // the receipt exists to cover.
    const between = await post(
      harness,
      {
        type: "loan.take",
        commandId: "loan-in-between",
        expectedRevision: afterFirst.revision,
        principal: 700,
      },
      { as: actor },
    );
    expect(between.status).toBe(200);
    const afterSecond = await currentGame(harness);
    expect(afterSecond.lastCommandId).not.toBe("loan-two-ago");

    const replay = await post(harness, body, { as: actor });

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ command: { replayed: true } });
    expect((await currentGame(harness)).revision).toBe(afterSecond.revision);
    expect(afterSecond.players[actor]?.loans).toHaveLength(2);
  });

  it("Given a commandId reused for a different command, When it arrives, Then it is a conflict rather than a replay", async () => {
    const harness = await startedMatch("mode.marathon");
    const actor = await activePlayer(harness);
    const expectedRevision = (await currentGame(harness)).revision;

    await post(
      harness,
      { type: "loan.take", commandId: "shared-id", expectedRevision, principal: 500 },
      { as: actor },
    );
    const afterFirst = await currentGame(harness);
    const response = await post(
      harness,
      {
        type: "loan.take",
        commandId: "shared-id",
        expectedRevision: afterFirst.revision,
        principal: 900,
      },
      { as: actor },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "COMMAND_ID_REUSED", command: "loan.take", retryable: false },
    });
    expect((await currentGame(harness)).revision).toBe(afterFirst.revision);
  });

  it("Given a rejected command, When it is retried after the state moved on, Then no receipt freezes the refusal", async () => {
    const harness = await startedMatch();
    const wrongSeat = await otherSeat(harness);
    const revision = (await currentGame(harness)).revision;

    // Refused: not their turn. A receipt written for a rejection would make this
    // id permanently answer NOT_ACTOR_TURN, even once it *is* their turn.
    const refused = await post(
      harness,
      { type: "turn.roll", commandId: "roll-later", expectedRevision: revision },
      { as: wrongSeat },
    );
    expect(refused.status).toBe(400);

    const accepted = await post(
      harness,
      { type: "turn.roll", commandId: "roll-later", expectedRevision: revision },
      { as: await activePlayer(harness) },
    );

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ command: { replayed: false } });
  });
});

describe("POST /api/rooms/:roomId/commands — the revision predicate", () => {
  it("Given a stale expectedRevision, When it is submitted, Then it conflicts and is reported as retryable", async () => {
    const harness = await startedMatch();
    const stale = (await currentGame(harness)).revision;
    await post(
      harness,
      { type: "turn.roll", commandId: "roll-winner", expectedRevision: stale },
      { as: await activePlayer(harness) },
    );
    const afterWinner = await currentGame(harness);

    const response = await post(
      harness,
      { type: "turn.roll", commandId: "roll-loser", expectedRevision: stale },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "STALE_REVISION", command: "turn.roll", retryable: true },
    });
    // Never a partial apply: the loser changed nothing at all.
    expect((await currentGame(harness)).revision).toBe(afterWinner.revision);
  });

  it("Given a burst of simultaneous submits, When they race, Then the queue serialises them instead of manufacturing conflicts", async () => {
    const harness = await startedMatch();
    const actor = await activePlayer(harness);
    const expectedRevision = (await currentGame(harness)).revision;

    // Six copies of the same command id, submitted at once — the shape a
    // double-tapped button or a retrying client produces. Exactly one applies and
    // the rest replay it; none of them may be a lost-race conflict.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        post(
          harness,
          { type: "turn.roll", commandId: "roll-burst", expectedRevision },
          { as: actor },
        ),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200, 200,
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json() as Promise<{ command: { replayed: boolean } }>),
    );
    expect(bodies.filter((body) => !body.command.replayed)).toHaveLength(1);
    expect(harness.announced).toHaveLength(1);
  });

  it("Given distinct commands from different seats at once, When they race, Then each is decided against freshly read state", async () => {
    const harness = await startedMatch();
    const actor = await activePlayer(harness);
    const bystander = await otherSeat(harness);
    const expectedRevision = (await currentGame(harness)).revision;

    const [legal, illegal] = await Promise.all([
      post(
        harness,
        { type: "turn.roll", commandId: "burst-legal", expectedRevision },
        { as: actor },
      ),
      post(
        harness,
        { type: "turn.roll", commandId: "burst-illegal", expectedRevision },
        { as: bystander },
      ),
    ]);

    expect(legal.status).toBe(200);
    // Refused on the real reason — whose turn it is, or a revision that moved —
    // rather than on a write conflict neither client could act on.
    expect([400, 409]).toContain(illegal.status);
  });
});

describe("the retired /roll and /respond aliases", () => {
  /**
   * Each alias is probed with the exact body the shipped client used to send it,
   * from the seat that used to be entitled to it, at a revision that was current.
   * Every reason to refuse it *other than the route being gone* is therefore
   * absent — so a 404 here can only mean the path no longer resolves, and the same
   * body posted to `/commands` in the tests above still applies.
   */
  it("Given the roll body the old client sent, When it posts to /roll, Then the path is gone", async () => {
    const harness = await startedMatch();
    const before = await currentGame(harness);

    const response = await post(
      harness,
      {
        type: "turn.roll",
        commandId: "alias-roll",
        expectedRevision: before.revision,
      },
      { as: await activePlayer(harness), path: "/roll" },
    );

    expect(response.status).toBe(404);
    // Nothing was applied and nothing was broadcast: the request never reached
    // the gateway, so it cannot have half-committed on its way to a 404.
    expect((await currentGame(harness)).revision).toBe(before.revision);
    expect(harness.announced).toEqual([]);
  });

  it("Given the respond body the old client sent, When it posts to /respond, Then the path is gone", async () => {
    const harness = await startedMatch();
    const before = await currentGame(harness);

    const response = await post(
      harness,
      {
        type: "prompt.respond",
        commandId: "alias-respond",
        expectedRevision: before.revision,
        decisionPointId: "decision-nope",
        optionId: "option-nope",
      },
      { as: await activePlayer(harness), path: "/respond" },
    );

    expect(response.status).toBe(404);
    expect((await currentGame(harness)).revision).toBe(before.revision);
    expect(harness.announced).toEqual([]);
  });

  /**
   * The alias's whole mechanism was a type supplied by the URL rather than by the
   * body, and the risk it carried was that `/roll` became a second, unaudited door
   * onto every other command. Retirement has to close that too: a typeless body is
   * now refused wherever it is posted, so there is no path where the URL decides.
   */
  it("Given a body with no type, When it posts to /commands, Then no URL supplies one for it", async () => {
    const harness = await startedMatch();
    const before = await currentGame(harness);

    const response = await post(
      harness,
      { commandId: "typeless", expectedRevision: before.revision },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", command: null, retryable: false },
    });
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });
});

describe("the receipt store contract", () => {
  it("Given an applied command, When the store is asked, Then it holds the outcome keyed by (gameId, commandId)", async () => {
    const receipts = new InMemoryCommandReceiptStore();
    const harness = await startedMatch("mode.marathon", { receipts });
    const gameId = (await currentGame(harness)).gameId;

    await post(
      harness,
      {
        type: "loan.take",
        commandId: "receipt-1",
        expectedRevision: (await currentGame(harness)).revision,
        principal: 500,
      },
      { as: await activePlayer(harness) },
    );

    const stored = await receipts.find(gameId, "receipt-1");
    expect(stored).toMatchObject({
      commandId: "receipt-1",
      type: "loan.take",
      roomRevision: 4,
      gameRevision: (await currentGame(harness)).revision,
    });
    expect(stored?.requestHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("Given a store that already holds the id, When a command with that id arrives, Then the engine is never reached", async () => {
    const receipts = new InMemoryCommandReceiptStore();
    const harness = await startedMatch("mode.marathon", { receipts });
    const before = await currentGame(harness);
    const planted: CommandReceipt = {
      commandId: "planted",
      type: "loan.take",
      actorId: await activePlayer(harness),
      // The hash of a body this test never sends, so the mismatch is what is
      // being asserted — a stolen id cannot be used to submit something else.
      requestHash: "0".repeat(64),
      expectedRevision: before.revision,
      roomRevision: 3,
      gameRevision: before.revision,
    };
    await receipts.record(before.gameId, planted);

    const response = await post(
      harness,
      {
        type: "loan.take",
        commandId: "planted",
        expectedRevision: before.revision,
        principal: 500,
      },
      { as: await activePlayer(harness) },
    );

    expect(response.status).toBe(409);
    expect((await currentGame(harness)).revision).toBe(before.revision);
  });
});
