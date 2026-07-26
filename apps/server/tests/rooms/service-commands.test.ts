import { describe, expect, it } from "vitest";

import { deadlineDashModes } from "@office-ladder/content";
import {
  isPlayerCommandType,
  SERVER_INJECTED_COMMAND_TYPES,
  TURN_TIMEOUT_COMMAND_ID_PREFIX,
} from "@office-ladder/contracts";
import { createStableId, type PlayerId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import { serverActorId } from "../../src/rooms/service/commands";
import type { ActiveStoredRoom, RoomService } from "../../src/rooms/service/types";

/**
 * `submitCommand` — the single player-command path — and `submitServerCommand`,
 * the wall-clock one (spec §7.1, §11.1).
 *
 * Four things are being asserted, and only the first is about the happy path:
 *
 * 1. A legal command from the right seat commits, once, with the revision it was
 *    submitted against.
 * 2. An actor who does not own the seat is refused *before* the engine sees the
 *    command. The route validates identity and the engine validates legality;
 *    both must exist and neither substitutes for the other (§6.3).
 * 3. A command a mode has switched off is refused from the ruleset **snapshotted
 *    into the match**, not from the content pack — which is what makes a mode a
 *    ruleset rather than a label.
 * 4. `window.expire`, `quarter.advance` and `turn.timeout` are unreachable from
 *    the player path by construction, and the scheduler path never lets a caller
 *    name the actor.
 */

const roomId = "room-commands";

const players = {
  host: "user-host",
  second: "user-second",
  third: "user-third",
} as const;

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-27T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "CMD123",
      gameId: () => createStableId("GameId", "game-commands"),
      commandId: () => createStableId("CommandId", "command-commands"),
    },
    gameSeed: () => "commands-seed",
    turnTimeoutMs: 0,
  });
}

type StartedRoom = {
  readonly service: RoomService;
  readonly repository: InMemoryRoomRepository;
  readonly room: ActiveStoredRoom;
};

async function startedMatch(options?: {
  readonly rules?: unknown;
  readonly withBot?: boolean;
}): Promise<StartedRoom> {
  const repository = new InMemoryRoomRepository();
  const service = createService(repository);
  await service.create({
    hostId: players.host,
    playerName: "Host",
    modeId: "mode.quick",
  });
  await service.join({ roomId, actorId: players.second, playerName: "Second" });
  if (options?.withBot === true) {
    await service.addBot({ roomId, actorId: players.host, difficulty: "standard" });
  } else {
    await service.join({ roomId, actorId: players.third, playerName: "Third" });
  }
  if (options?.rules !== undefined) {
    const set = await service.setModeRules({
      roomId,
      actorId: players.host,
      rules: options.rules,
    });
    expect(set.ok).toBe(true);
  }
  const started = await service.start({
    roomId,
    actorId: players.host,
    actorKind: "human",
  });
  if (!started.ok) throw new Error(`start failed: ${started.error.code}`);
  return { service, repository, room: started.value };
}

/** A ruleset differing from the shipped quick preset in exactly one switch. */
function quickRulesWith(patch: Record<string, unknown>): unknown {
  const rules = JSON.parse(
    JSON.stringify(deadlineDashModes["mode.quick"].rules),
  ) as Record<string, unknown>;
  rules["agency"] = { ...(rules["agency"] as Record<string, unknown>), ...patch };
  return rules;
}

describe("submitCommand", () => {
  it("Given the active player, When a legal command is submitted, Then it commits once at the revision it named", async () => {
    const { service, repository, room } = await startedMatch();

    const result = await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "human",
      type: "turn.action",
      request: {
        commandId: "client-turn-action-1",
        expectedRevision: room.game.revision,
        action: "work",
        targetPlayerIds: [],
        choice: null,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.game.revision).toBe(room.game.revision + 1);
    expect(result.value.revision).toBe(room.revision + 1);
    expect((await repository.get(roomId))?.game?.revision).toBe(room.game.revision + 1);
  });

  it("Given a committed command, When the identical body is replayed, Then it is refused as already applied", async () => {
    const { service, repository, room } = await startedMatch();
    const request = {
      commandId: "client-turn-action-1",
      expectedRevision: room.game.revision,
      action: "work",
      targetPlayerIds: [],
      choice: null,
    } as const;
    const first = await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "human",
      type: "turn.action",
      request,
    });
    expect(first.ok).toBe(true);

    const replayed = await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "human",
      type: "turn.action",
      request,
    });

    // The engine's `lastCommandId` guard fires before the revision check, so a
    // retried submit is refused rather than applied twice. It is not yet the
    // receipt-backed idempotency §11.1 asks for — that returns the *original*
    // outcome — but it does mean the double-apply cannot happen.
    expect(replayed).toEqual({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect((await repository.get(roomId))?.game?.revision).toBe(room.game.revision + 1);
  });

  it("Given a fresh command id at a revision that has moved on, When it is submitted, Then it is refused as stale", async () => {
    const { service, room } = await startedMatch();
    await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "human",
      type: "turn.action",
      request: {
        commandId: "client-turn-action-1",
        expectedRevision: room.game.revision,
        action: "work",
        targetPlayerIds: [],
        choice: null,
      },
    });

    const stale = await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "human",
      type: "turn.roll",
      request: {
        commandId: "client-roll-late",
        expectedRevision: room.game.revision,
      },
    });

    expect(stale).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
  });

  it("Given somebody who is not in the room, When they submit a command, Then it is refused before the engine sees it", async () => {
    const { service, repository, room } = await startedMatch();

    const result = await service.submitCommand({
      roomId,
      actorId: "user-stranger",
      actorKind: "human",
      type: "turn.action",
      request: {
        commandId: "client-intruder-1",
        expectedRevision: room.game.revision,
        action: "work",
        targetPlayerIds: [],
        choice: null,
      },
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_MEMBER" } });
    // Nothing was written: identity failed, so the engine was never consulted.
    expect((await repository.get(roomId))?.game?.revision).toBe(room.game.revision);
  });

  it("Given a member who does not hold the turn, When they submit a turn command, Then the engine refuses it", async () => {
    const { service, repository, room } = await startedMatch();
    expect(room.game.turn.activePlayerId).not.toBe(
      createStableId("PlayerId", players.second),
    );

    const result = await service.submitCommand({
      roomId,
      actorId: players.second,
      actorKind: "human",
      type: "turn.action",
      request: {
        commandId: "client-out-of-turn-1",
        expectedRevision: room.game.revision,
        action: "work",
        targetPlayerIds: [],
        choice: null,
      },
    });

    // Membership passed and legality did not: the two checks are genuinely
    // separate, and this is the one the engine owns.
    expect(result.ok).toBe(false);
    expect((await repository.get(roomId))?.game?.revision).toBe(room.game.revision);
  });

  it("Given a session presenting a bot's seat, When it submits a command, Then it is refused", async () => {
    const { service, room } = await startedMatch({ withBot: true });
    const botSeat = room.bots[0]?.playerId;
    expect(botSeat).toBeDefined();

    const result = await service.submitCommand({
      roomId,
      actorId: String(botSeat),
      actorKind: "human",
      type: "turn.action",
      request: {
        commandId: "client-as-bot-1",
        expectedRevision: room.game.revision,
        action: "work",
        targetPlayerIds: [],
        choice: null,
      },
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_IS_BOT" } });
  });

  it("Given the bot driver naming a human member, When it submits a command, Then it is refused", async () => {
    const { service, room } = await startedMatch({ withBot: true });

    const result = await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "bot",
      type: "turn.action",
      request: {
        commandId: "bot-as-human-1",
        expectedRevision: room.game.revision,
        action: "work",
        targetPlayerIds: [],
        choice: null,
      },
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_BOT" } });
  });

  it("Given a mode with dice adjustment on, When the active player adjusts their roll, Then it commits", async () => {
    const { service, room } = await startedMatch();
    expect(room.game.rules.agency.diceAdjustEnabled).toBe(true);

    const result = await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "human",
      type: "turn.adjust-roll",
      request: {
        commandId: "client-adjust-1",
        expectedRevision: room.game.revision,
        pips: 1,
      },
    });

    expect(result.ok).toBe(true);
  });

  it("Given a mode with dice adjustment off, When the active player adjusts their roll, Then the snapshotted ruleset refuses it", async () => {
    const { service, repository, room } = await startedMatch({
      rules: quickRulesWith({ diceAdjustEnabled: false }),
    });
    // The gate is the ruleset frozen into the match, not the content pack: the
    // pack still ships `diceAdjustEnabled: true` for this mode id.
    expect(room.game.rules.agency.diceAdjustEnabled).toBe(false);
    expect(deadlineDashModes["mode.quick"].rules.agency.diceAdjustEnabled).toBe(true);

    const result = await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "human",
      type: "turn.adjust-roll",
      request: {
        commandId: "client-adjust-1",
        expectedRevision: room.game.revision,
        pips: 1,
      },
    });

    expect(result.ok).toBe(false);
    expect((await repository.get(roomId))?.game?.revision).toBe(room.game.revision);
  });

  it("Given a room still in the lobby, When a command is submitted, Then there is no game to apply it to", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });

    const result = await service.submitCommand({
      roomId,
      actorId: players.host,
      actorKind: "human",
      type: "turn.action",
      request: {
        commandId: "client-early-1",
        expectedRevision: 0,
        action: "work",
        targetPlayerIds: [],
        choice: null,
      },
    });

    expect(result).toEqual({ ok: false, error: { code: "GAME_NOT_ACTIVE" } });
  });

  it("Given the legacy roll and respond methods, When they are called, Then they go through the same path", async () => {
    const { service, room } = await startedMatch();

    const rolled = await service.roll({
      roomId,
      actorId: players.host,
      actorKind: "human",
      commandId: "client-roll-1",
      expectedRevision: room.game.revision,
    });

    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.value.game.revision).toBe(room.game.revision + 1);
  });
});

describe("server-injected commands", () => {
  it("Given the three scheduler command types, When they are checked against the player surface, Then none of them is submittable", () => {
    // The absence *is* the guarantee: `SubmittableCommandType` is derived from
    // this same list, contracts exports no parser that produces one of these, and
    // the translator's switch has no case for them. A player cannot name one.
    for (const type of SERVER_INJECTED_COMMAND_TYPES) {
      expect(isPlayerCommandType(type)).toBe(false);
    }
  });

  it("Given a command id a client could have sent, When it is used for an expiry, Then the expiry is refused", async () => {
    const { service, repository, room } = await startedMatch();

    const result = await service.submitServerCommand({
      roomId,
      type: "turn.timeout",
      expectedRevision: room.game.revision,
      commandId: "looks-like-a-browser-uuid",
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_AUTHORIZED" } });
    expect((await repository.get(roomId))?.game?.revision).toBe(room.game.revision);
  });

  it("Given the turn clock running out, When the scheduler submits a timeout, Then the turn is taken and no seat is added", async () => {
    const { service, repository, room } = await startedMatch();
    const activePlayerId = room.game.turn.activePlayerId;

    const result = await service.submitServerCommand({
      roomId,
      type: "turn.timeout",
      expectedRevision: room.game.revision,
      commandId: `${TURN_TIMEOUT_COMMAND_ID_PREFIX}${room.game.gameId}:${room.game.revision}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.game.revision).toBe(room.game.revision + 1);
    // The scheduler acts *for* the player on the clock. Its synthetic actor is
    // never a seat, so nothing about the table can change.
    expect(result.value.memberIds).toEqual(room.memberIds);
    expect(Object.keys(result.value.game.players)).toEqual(
      Object.keys(room.game.players),
    );
    expect(serverActorId(roomId)).not.toBe(activePlayerId);
    expect(result.value.memberIds).not.toContain(serverActorId(roomId));
    expect((await repository.get(roomId))?.game?.revision).toBe(room.game.revision + 1);
  });

  it("Given the scheduler's synthetic actor, When it is compared to every seat, Then it belongs to none of them", async () => {
    const { room } = await startedMatch();
    const synthetic: PlayerId = serverActorId(roomId);

    // The engine's only signal that a command came from the scheduler is that its
    // actor is not seated, so this is the property the whole §7.1 boundary rests
    // on. It is derived from the room id, not supplied by the caller.
    expect(room.memberIds).not.toContain(synthetic);
    expect(room.game.players[synthetic]).toBeUndefined();
  });

  it("Given an expiry that names no decision point, When it is submitted, Then it is refused rather than guessing", async () => {
    const { service, room } = await startedMatch();

    const result = await service.submitServerCommand({
      roomId,
      type: "window.expire",
      expectedRevision: room.game.revision,
      commandId: `${TURN_TIMEOUT_COMMAND_ID_PREFIX}${room.game.gameId}:orphan`,
    });

    expect(result).toEqual({ ok: false, error: { code: "INVALID_COMMAND" } });
  });

  it("Given a room with no running match, When the scheduler fires, Then there is nothing to expire", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });

    const result = await service.submitServerCommand({
      roomId,
      type: "turn.timeout",
      expectedRevision: 0,
      commandId: `${TURN_TIMEOUT_COMMAND_ID_PREFIX}orphan`,
    });

    expect(result).toEqual({ ok: false, error: { code: "GAME_NOT_ACTIVE" } });
  });
});
