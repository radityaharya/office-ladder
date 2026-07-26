import { expect } from "vitest";

import {
  createStableId,
  type BallotState,
  type GameState,
  type ModeRules,
  type PlayerId,
  type PromptState,
  type ReactionWindowState,
} from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../../src/rooms/in-memory-repository";
import { createRoomService } from "../../../src/rooms/service/create-room-service";
import type { RoomRepository, RoomService, StoredRoom } from "../../../src/rooms/service/types";

/**
 * A real started match, built through the real service, plus the pieces of state
 * the engine has no transition to produce yet.
 *
 * The reaction windows and ballots below are injected rather than opened,
 * because no shipped content path opens one today — but they are the shapes the
 * engine's own transitions build (`openReactionWindow`, `openBallot`), and the
 * scheduler under test only ever reads `deadlineAt`, `resolution` and the ids.
 * Using the real service and the real repository is what keeps the test honest
 * about the thing that actually matters: the command goes through the ordinary
 * path, takes the same lock, and is written under the same revision predicate.
 */

export const players = {
  host: createStableId("PlayerId", "user-window-host"),
  second: createStableId("PlayerId", "user-window-second"),
  third: createStableId("PlayerId", "user-window-third"),
} as const;

export const ROOM_ID = "room-window-expiry-test";
export const START_MS = Date.parse("2026-07-26T12:00:00.000Z");

/** `mode.quick`: reactionWindowSeconds 10, turnSeconds 20. */
export const QUICK_REACTION_WINDOW_MS = 10_000;
export const QUICK_TURN_CLOCK_MS = 20_000;

export function isoAt(offsetMs: number): string {
  return new Date(START_MS + offsetMs).toISOString();
}

export function createTestService(
  repository: RoomRepository,
  now: () => string,
  turnTimeoutMs = 60_000,
): RoomService {
  return createRoomService({
    repository,
    now,
    ids: {
      roomId: () => ROOM_ID,
      roomCode: () => "WIN123",
      gameId: () => createStableId("GameId", "game-window-expiry-test"),
      commandId: () => createStableId("CommandId", "command-window-expiry-test"),
    },
    gameSeed: () => "window-expiry-seed",
    turnTimeoutMs,
  });
}

export type MatchFixture = {
  readonly repository: InMemoryRoomRepository;
  readonly service: RoomService;
  readonly now: () => string;
  readonly advanceMs: (ms: number) => void;
  readonly room: () => Promise<StoredRoom>;
  readonly game: () => Promise<GameState>;
  /** Rewrites the stored game in place, bumping only the *room* revision. */
  readonly patchGame: (patch: (game: GameState) => GameState) => Promise<void>;
};

export async function startMatch(turnTimeoutMs = 60_000): Promise<MatchFixture> {
  const repository = new InMemoryRoomRepository();
  let nowMs = START_MS;
  const now = (): string => new Date(nowMs).toISOString();
  const service = createTestService(repository, now, turnTimeoutMs);

  await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
  await service.join({ roomId: ROOM_ID, actorId: players.second, playerName: "Second" });
  await service.join({ roomId: ROOM_ID, actorId: players.third, playerName: "Third" });
  const started = await service.start({
    roomId: ROOM_ID,
    actorId: players.host,
    actorKind: "human",
  });
  expect(started).toMatchObject({ ok: true });

  const readRoom = async (): Promise<StoredRoom> => {
    const room = await repository.get(ROOM_ID);
    if (room === null) throw new Error("room vanished");
    return room;
  };

  return {
    repository,
    service,
    now,
    advanceMs: (ms) => {
      nowMs += ms;
    },
    room: readRoom,
    game: async () => {
      const game = (await readRoom()).game;
      if (game === null) throw new Error("game vanished");
      return game;
    },
    async patchGame(patch) {
      const room = await readRoom();
      if (room.game === null) throw new Error("game vanished");
      const saved = await repository.save(
        { ...room, revision: room.revision + 1, game: patch(room.game) },
        room.revision,
      );
      expect(saved).toEqual({ ok: true });
    },
  };
}

export const WINDOW_ID = "decision-window-under-test";
export const BALLOT_ID = "ballot-under-test";

/**
 * A prevention window with no pending effect: the simplest thing the engine's
 * `closeReactionWindow` can resolve, and enough to prove the boundary crossing.
 */
export function reactionWindow(
  deadlineAt: string | null,
  overrides: Partial<ReactionWindowState> = {},
): ReactionWindowState {
  return {
    id: createStableId("DecisionPointId", WINDOW_ID),
    frameId: createStableId("FrameId", "frame-window-under-test"),
    kind: "prevention",
    eligiblePlayerIds: [players.second, players.third],
    priorityPlayerId: players.second,
    passedPlayerIds: [],
    playedByPlayerIds: [],
    deadlineAt,
    pendingEffectId: null,
    ...overrides,
  };
}

export function ballot(
  deadlineAt: string | null,
  overrides: Partial<BallotState> = {},
): BallotState {
  return {
    id: createStableId("BallotId", BALLOT_ID),
    kind: "vote",
    subjectId: "subject-under-test",
    subject: { options: ["yes", "no"] },
    audience: [players.host, players.second, players.third],
    castBy: {},
    deadlineAt,
    closesAtRound: 99,
    visibility: "open",
    resolution: null,
    ...overrides,
  };
}

export function promptFor(playerId: PlayerId): PromptState {
  return {
    id: createStableId("DecisionPointId", "decision-audit-release"),
    frameId: createStableId("FrameId", "frame-audit-release"),
    kind: "audit-release",
    audience: [playerId],
    legalResponses: [
      { id: createStableId("PromptOptionId", "pay-fine"), value: null },
      { id: createStableId("PromptOptionId", "attempt-roll"), value: null },
    ],
    deadlineAt: null,
    defaultResponse: {
      optionId: createStableId("PromptOptionId", "attempt-roll"),
      value: null,
    },
    visibility: "private",
    responses: {},
  };
}

/** Deep-overrides one block of a game's snapshotted ruleset. */
export function withRules(game: GameState, patch: DeepPartialRules): GameState {
  const rules = game.rules;
  return {
    ...game,
    rules: {
      ...rules,
      interaction: { ...rules.interaction, ...patch.interaction },
      timers: { ...rules.timers, ...patch.timers },
    },
  };
}

type DeepPartialRules = {
  readonly interaction?: Partial<ModeRules["interaction"]>;
  readonly timers?: Partial<ModeRules["timers"]>;
};
