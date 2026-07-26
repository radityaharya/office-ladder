import { describe, expect, it } from "vitest";

import type {
  GameBootstrap,
  PublicGameProjection,
  RoomBootstrap,
  RoomMemberProjection,
  RoomProjection,
} from "@office-ladder/contracts";
import { shouldDriveBots } from "../../src/rooms/bots/should-drive";
import { shouldEnforceTurnTimer } from "../../src/rooms/turn-timer/should-enforce";

const humanMember: RoomMemberProjection = {
  id: "user-host",
  displayName: "Host",
  seat: 0,
  isHost: true,
  isReady: true,
  isConnected: true,
  isBot: false,
  botDifficulty: null,
  avatarUrl: null,
  characterId: "character.workaholic",
  characterLabel: "Workaholic",
};

const botMember: RoomMemberProjection = {
  id: "bot:room-1:0",
  displayName: "Temp Analyst",
  seat: 1,
  isHost: false,
  isReady: true,
  isConnected: true,
  isBot: true,
  botDifficulty: "standard",
  avatarUrl: null,
  characterId: "character.social-butterfly",
  characterLabel: "Social Butterfly",
};

const room: RoomProjection = {
  id: "room-1",
  code: "BOT456",
  status: "active",
  mode: "mode.quick",
  capacity: 3,
  revision: 7,
  members: [humanMember, botMember],
};

function bootstrapWith(
  overrides: Partial<PublicGameProjection>,
): GameBootstrap {
  const publicProjection: PublicGameProjection = {
    id: "game-1",
    revision: 12,
    status: "active",
    activePlayerId: botMember.id,
    turnNumber: 4,
    round: 2,
    phase: "pre-roll",
    deadlineAt: null,
    turnTimerDurationMs: null,
    players: [],
    eventSummaries: [],
    winnerPlayerIds: [],
    ...overrides,
  };

  return {
    room,
    publicProjection,
    self: {
      playerId: humanMember.id,
      role: { id: "role-1", kind: "role.worker", revealed: false },
      characterId: "character.workaholic",
      hand: [],
      privateStatusIds: [],
      abilityIds: [],
    },
    prompts: [],
    reactions: [],
    legalActions: [],
    serverTime: "2026-07-26T12:00:00.000Z",
  };
}

describe("shouldDriveBots", () => {
  it("Given a live game with a bot on the active turn, When the read path checks, Then the drain is kicked", () => {
    expect(shouldDriveBots(bootstrapWith({}))).toBe(true);
  });

  it("Given a live game with a human on the active turn, When the read path checks, Then nothing is kicked", () => {
    expect(shouldDriveBots(bootstrapWith({ activePlayerId: humanMember.id }))).toBe(false);
  });

  it("Given a finished game that still names a bot as active, When the read path checks, Then nothing is kicked", () => {
    // rollTurn advances turn.activePlayerId even on the roll that ends the
    // match, so an ended game names the *next* seat — a bot in most bot
    // matches. Kicking here would fire on every 5s poll of the winner screen,
    // forever, for a drain that can never apply anything.
    expect(
      shouldDriveBots(
        bootstrapWith({
          status: "ended",
          activePlayerId: botMember.id,
          winnerPlayerIds: [humanMember.id],
        }),
      ),
    ).toBe(false);
  });

  it("Given a quarantined game that names a bot as active, When the read path checks, Then nothing is kicked", () => {
    expect(shouldDriveBots(bootstrapWith({ status: "paused" }))).toBe(false);
  });

  it("Given a game with no active player, When the read path checks, Then nothing is kicked", () => {
    expect(shouldDriveBots(bootstrapWith({ activePlayerId: null }))).toBe(false);
  });

  it("Given a human on turn but an open reaction window, When the read path checks, Then the drain is kicked so a bot can answer it", () => {
    // The case a turn-based predicate cannot see. A reaction window is answered
    // out of turn, and while one is open the *active* player is blocked by it —
    // so a window raised on a bot during a human's turn used to be nobody's job,
    // and the human sat unable to act until the expiry scheduler fired.
    const bootstrap = bootstrapWith({ activePlayerId: humanMember.id });
    expect(
      shouldDriveBots({
        ...bootstrap,
        reactions: [
          {
            id: "decision-1",
            kind: "prevention",
            deadlineAt: null,
            hasPriority: true,
            hasPassed: false,
            hasPlayed: false,
          },
        ],
      }),
    ).toBe(true);
  });

  it("Given an open reaction window in a room with no bots, When the read path checks, Then nothing is kicked", () => {
    const bootstrap = bootstrapWith({ activePlayerId: humanMember.id });
    expect(
      shouldDriveBots({
        ...bootstrap,
        room: { ...room, members: [humanMember] },
        reactions: [
          {
            id: "decision-1",
            kind: "prevention",
            deadlineAt: null,
            hasPriority: true,
            hasPassed: false,
            hasPlayed: false,
          },
        ],
      }),
    ).toBe(false);
  });

  it("Given a lobby bootstrap with bot seats, When the read path checks, Then nothing is kicked", () => {
    const lobby: RoomBootstrap = {
      room,
      selfMemberId: humanMember.id,
      characterOptions: [],
    };
    expect(shouldDriveBots(lobby)).toBe(false);
  });
});

describe("shouldEnforceTurnTimer", () => {
  it("Given a live game with a human on the active turn, When the read path checks, Then the clock is revived", () => {
    expect(
      shouldEnforceTurnTimer(bootstrapWith({ activePlayerId: humanMember.id })),
    ).toBe(true);
  });

  it("Given a live game with a bot on the active turn, When the read path checks, Then nothing is kicked", () => {
    // Bots are not on a clock, so this would cost a projection read to discover
    // there is nothing to enforce.
    expect(shouldEnforceTurnTimer(bootstrapWith({}))).toBe(false);
  });

  it.each([
    ["a finished game", { status: "ended" } as const],
    ["a quarantined game", { status: "paused" } as const],
  ])(
    "Given %s that still names a human as active, When the read path checks, Then nothing is kicked",
    (_label, overrides) => {
      expect(
        shouldEnforceTurnTimer(
          bootstrapWith({ ...overrides, activePlayerId: humanMember.id }),
        ),
      ).toBe(false);
    },
  );

  it("Given a game with no active player, When the read path checks, Then nothing is kicked", () => {
    expect(shouldEnforceTurnTimer(bootstrapWith({ activePlayerId: null }))).toBe(false);
  });

  it("Given a lobby bootstrap, When the read path checks, Then nothing is kicked", () => {
    const lobby: RoomBootstrap = {
      room,
      selfMemberId: humanMember.id,
      characterOptions: [],
    };
    expect(shouldEnforceTurnTimer(lobby)).toBe(false);
  });

  it("Given any live turn, When both read-path predicates run, Then exactly one of them fires", () => {
    // The two are mirror images by construction. If they ever both fire, two
    // server-side actors are aimed at the same seat; if neither does, a live turn
    // has nobody watching it.
    for (const activePlayerId of [humanMember.id, botMember.id]) {
      const bootstrap = bootstrapWith({ activePlayerId });
      expect([
        shouldDriveBots(bootstrap),
        shouldEnforceTurnTimer(bootstrap),
      ]).toContainEqual(true);
      expect(
        Number(shouldDriveBots(bootstrap)) + Number(shouldEnforceTurnTimer(bootstrap)),
      ).toBe(1);
    }
  });
});
