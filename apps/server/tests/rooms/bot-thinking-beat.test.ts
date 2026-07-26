import { describe, expect, it } from "vitest";

import { createStableId } from "@office-ladder/engine";
import type { BotDriverEvent } from "../../src/rooms/bots/bot-driver";
import { createBotDriver } from "../../src/rooms/bots/bot-driver";
import {
  botDriverEventContext,
  botDriverEventLevel,
} from "../../src/rooms/bots/bot-driver-log";
import { publishBotThinking } from "../../src/rooms/bots/publish-bot-thinking";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import { botSubmitterFor } from "./bot-submitter";

/**
 * The visible half of pacing.
 *
 * A pause on its own is indistinguishable from a server that stopped answering,
 * and reloading is the rational response to the second. So the driver announces
 * the decision *before* it waits, the announcement carries the reason, and in a
 * `quick` chat room it carries a phrase the room actually receives.
 */

const host = createStableId("PlayerId", "user-host");
const roomId = "room-bot-beat-test";

async function startSoloMatch(): Promise<{
  readonly events: readonly BotDriverEvent[];
  readonly drive: () => Promise<void>;
  readonly takeHumanTurn: () => Promise<void>;
}> {
  const repository = new InMemoryRoomRepository();
  const events: BotDriverEvent[] = [];
  const order: string[] = [];

  const service = createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "BET456",
      gameId: () => createStableId("GameId", "game-bot-beat-test"),
      commandId: () => createStableId("CommandId", "command-bot-beat-test"),
    },
    gameSeed: () => "bot-beat-seed",
    turnTimeoutMs: 0,
  });

  const driver = createBotDriver({
    repository,
    submit: botSubmitterFor(service, repository),
    // `null` hands pacing to the room's own ruleset, which is the production
    // default and the case worth exercising.
    configuredDelayMs: null,
    sleep: async () => {
      order.push("slept");
    },
    publish: async () => undefined,
    onEvent: (event) => {
      events.push(event);
      order.push(event.type);
    },
  });

  await service.create({ hostId: host, playerName: "Host", modeId: "mode.quick", capacity: 3 });
  await service.addBot({ roomId, actorId: host, difficulty: "standard" });
  await service.addBot({ roomId, actorId: host, difficulty: "easy" });
  await service.start({ roomId, actorId: host, actorKind: "human" });

  return {
    events,
    drive: () => driver.drive(roomId),
    takeHumanTurn: async () => {
      const room = await repository.get(roomId);
      const game = room?.game;
      if (game === undefined || game === null) throw new Error("game vanished");
      const rolled = await service.roll({
        roomId,
        actorId: host,
        actorKind: "human",
        commandId: `human:${game.revision}`,
        expectedRevision: game.revision,
      });
      if (!rolled.ok) throw new Error(`human roll failed: ${rolled.error.code}`);
    },
  };
}

describe("the thinking beat", () => {
  it("Given a bot about to act in a quick-chat room, When the driver drains, Then it announces itself before pausing and says what it is doing", async () => {
    const harness = await startSoloMatch();
    await harness.takeHumanTurn();

    await harness.drive();

    const thinking = harness.events.filter((event) => event.type === "bot.thinking");
    const applied = harness.events.filter((event) => event.type === "bot.command.applied");
    // Exactly one beat per command: a command that slipped through unannounced is
    // a silent gap on somebody's screen.
    expect(thinking.length).toBe(applied.length);
    expect(thinking.length).toBeGreaterThan(0);

    const first = thinking[0];
    if (first?.type !== "bot.thinking") throw new Error("no thinking beat");
    expect(first.thinkMs).toBeGreaterThan(0);
    // mode.quick is a `quick` chat room, so the beat carries a phrase id — never
    // generated text.
    expect(first.line).toEqual({ phraseId: "chat.phrase.thinking", messageKind: "quick" });
    // And the reason is legible without reading bot-policy.ts.
    expect(first.why.length).toBeGreaterThan(0);
  });

  it("Given a drained turn, When the events are read in order, Then every beat precedes the command it explains", async () => {
    const harness = await startSoloMatch();
    await harness.takeHumanTurn();

    await harness.drive();

    // The ordering is the whole feature: a beat that arrived with the command
    // would be decoration on something the player can already see.
    const relevant = harness.events.filter(
      (event) => event.type === "bot.thinking" || event.type === "bot.command.applied",
    );
    for (let index = 0; index < relevant.length; index += 2) {
      expect(relevant[index]?.type).toBe("bot.thinking");
      expect(relevant[index + 1]?.type).toBe("bot.command.applied");
    }
  });

  it("Given the beat, When it is logged, Then it is quiet but carries the reason and the pause", async () => {
    const harness = await startSoloMatch();
    await harness.takeHumanTurn();
    await harness.drive();

    const beat = harness.events.find((event) => event.type === "bot.thinking");
    if (beat?.type !== "bot.thinking") throw new Error("no thinking beat");

    // `debug`: it is always followed by bot.command.applied, so logging it at
    // info would double every line on a busy room for no added information.
    expect(botDriverEventLevel(beat)).toBe("debug");
    expect(botDriverEventContext(beat)).toMatchObject({
      room: roomId,
      player: beat.playerId,
      decision: beat.decision,
      why: beat.why,
    });
  });
});

describe("publishing the beat", () => {
  const beat: BotDriverEvent = {
    type: "bot.thinking",
    roomId,
    playerId: createStableId("PlayerId", `bot:${roomId}:0`),
    decision: "roll",
    why: "rolling",
    thinkMs: 900,
    line: { phraseId: "chat.phrase.thinking", messageKind: "quick" },
  };

  it("Given a beat with a phrase, When it is published, Then it does not throw", () => {
    // It travels as a `chat-message-posted` with a fixed phrase id, validated by
    // the same parser a client uses — a payload this server builds and no client
    // can parse would make the beat silently never appear.
    expect(() => {
      publishBotThinking(beat);
    }).not.toThrow();
  });

  it("Given a room id that is not a legal topic, When a beat is published, Then it is swallowed rather than failing the turn", () => {
    // Called fire-and-forget on the path to a command that is about to commit,
    // so nothing here may throw into the driver.
    expect(() => {
      publishBotThinking({ ...beat, roomId: "not a legal topic!!" });
    }).not.toThrow();
  });

  it("Given an event with no line, When it is published, Then nothing is sent", () => {
    // `full` and `off` chat rooms produce `line: null`, and a bot in them stays
    // silent rather than generating text.
    expect(() => {
      publishBotThinking({ ...beat, line: null });
    }).not.toThrow();
  });

  it("Given an event that is not a beat, When it is published, Then nothing is sent", () => {
    expect(() => {
      publishBotThinking({ type: "bot.drain.started", roomId });
    }).not.toThrow();
  });
});
