import { describe, expect, it } from "vitest";

import type { GameBootstrap, SafeEventSummary } from "@office-ladder/contracts";

import { latestCommittedRoll } from "./use-dice-feed";

const members = [
  { id: "player-1", displayName: "Avery", seat: 0, isBot: false },
  { id: "player-2", displayName: "Contract Auditor", seat: 1, isBot: true },
] as const;

function bootstrap(events: readonly SafeEventSummary[]): GameBootstrap {
  return {
    room: {
      id: "room-1",
      code: "Q4W8ZT",
      status: "active",
      capacity: 6,
      revision: 9,
      mode: "mode.quick",
      members: members.map((member) => ({
        ...member,
        isHost: member.id === "player-1",
        isReady: true,
        isConnected: true,
        botDifficulty: member.isBot ? "standard" : null,
        avatarUrl: null,
        characterId: null,
        characterLabel: null,
      })),
    },
    publicProjection: {
      // Turn order, which is where the 1..6 seat slot comes from.
      players: [{ id: "player-1" }, { id: "player-2" }],
      eventSummaries: events,
      revision: 9,
    },
    self: { playerId: "player-1" },
    prompts: [],
    reactions: [],
    legalActions: [],
    serverTime: "2026-07-26T12:00:00.000Z",
  } as unknown as GameBootstrap;
}

function diceRolled(
  id: string,
  actorPlayerId: string | null,
  dice: readonly number[],
  purpose = "normal-movement",
): SafeEventSummary {
  return {
    id,
    type: "DiceRolled",
    revision: 4,
    occurredAt: "2026-07-26T12:00:00.000Z",
    actorPlayerId,
    dice,
    total: dice.reduce((sum, face) => sum + face, 0),
    purpose,
  };
}

function moved(id: string, actorPlayerId: string): SafeEventSummary {
  return {
    id,
    type: "PlayerMoved",
    revision: 5,
    occurredAt: "2026-07-26T12:00:00.000Z",
    actorPlayerId,
  };
}

describe("latestCommittedRoll", () => {
  it("reports the newest committed roll from the first synchronous read", () => {
    // Given — a pure derivation, not an effect. The previous ledger-based hook
    // returned null on the first render, so a server-rendered or reduced-motion
    // board showed an empty instrument until an effect had run.
    const feed = latestCommittedRoll(
      bootstrap([
        diceRolled("roll-1", "player-1", [2]),
        moved("moved-1", "player-1"),
        diceRolled("roll-2", "player-2", [5]),
        moved("moved-2", "player-2"),
      ]),
    );

    // Then
    expect(feed).toEqual({
      eventId: "roll-2",
      faces: [5],
      total: 5,
      purpose: "normal-movement",
      rollerName: "Contract Auditor",
      isSelf: false,
      isBot: true,
      seat: 2,
    });
  });

  it("renders one cell per real face and never assumes a pair", () => {
    // Given — movement is exactly one d6; only an audit-release attempt is 2d6.
    const movement = latestCommittedRoll(
      bootstrap([diceRolled("roll-1", "player-1", [3])]),
    );
    const attempt = latestCommittedRoll(
      bootstrap([diceRolled("roll-1", "player-1", [4, 4], "audit-release")]),
    );

    // Then
    expect(movement?.faces).toEqual([3]);
    expect(attempt?.faces).toEqual([4, 4]);
    expect(attempt?.total).toBe(8);
    expect(attempt?.purpose).toBe("audit-release");
  });

  it("marks the caller's own roll and gives it their turn-order seat", () => {
    // Given — `PublicPlayerProjection.seat` is the engine's ZERO-based turn
    // order, so the slot is derived from the player's index in the already
    // turn-ordered player list, exactly as the rail and the board tokens do.
    const feed = latestCommittedRoll(
      bootstrap([diceRolled("roll-1", "player-1", [6])]),
    );

    // Then
    expect(feed).toMatchObject({ isSelf: true, isBot: false, seat: 1 });
  });

  it("names a system roll without inventing a seat for it", () => {
    // Given — a server-driven roll has no actor.
    const feed = latestCommittedRoll(bootstrap([diceRolled("roll-1", null, [1])]));

    // Then
    expect(feed).toMatchObject({ rollerName: "System", seat: null, isSelf: false });
  });

  it("reports nothing when the projection records no roll", () => {
    // Then
    expect(latestCommittedRoll(bootstrap([moved("moved-1", "player-1")]))).toBeNull();
    expect(latestCommittedRoll(bootstrap([]))).toBeNull();
  });

  it("follows the pacing cursor, because it reads whatever list it is handed", () => {
    // Given — the paced bootstrap truncates `eventSummaries` to the presentation
    // cursor. That is the entire mechanism by which a bot's roll surfaces on its
    // own beat instead of five events at once.
    const events = [
      diceRolled("roll-1", "player-1", [2]),
      diceRolled("roll-2", "player-2", [5]),
    ];

    // Then
    expect(latestCommittedRoll(bootstrap(events.slice(0, 1)))?.eventId).toBe("roll-1");
    expect(latestCommittedRoll(bootstrap(events))?.eventId).toBe("roll-2");
  });
});
