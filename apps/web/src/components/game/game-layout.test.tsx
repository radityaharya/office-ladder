import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  GameBootstrap,
  PublicGameProjection,
  RoomProjection,
} from "@office-ladder/contracts";

import { ActionTray } from "./action-tray";
import { GameLayout } from "./game-layout";
import { createGameView } from "./game-view";
import { TurnRail } from "./turn-rail";

const room = {
  id: "room-1",
  code: "Q4W8ZT",
  status: "active",
  mode: "mode.quick",
  capacity: 6,
  revision: 5,
  members: [
    {
      id: "player-1",
      displayName: "Avery",
      seat: 1,
      isHost: true,
      isReady: true,
      isConnected: true,
    },
    {
      id: "player-2",
      displayName: "Morgan",
      seat: 2,
      isHost: false,
      isReady: true,
      isConnected: false,
    },
  ],
} satisfies RoomProjection;

const game = {
  id: "game-1",
  revision: 8,
  status: "active",
  activePlayerId: "player-1",
  turnNumber: 4,
  round: 2,
  phase: "awaiting-roll",
  deadlineAt: null,
  players: [
    {
      id: "player-1",
      seat: 1,
      connected: true,
      position: 7,
      lapsCompleted: 0,
      rank: { id: "rank.intern", kind: "rank.intern", index: 0 },
      role: { revealed: false },
      resources: { money: 1_200, reputation: 2, energy: 4 },
      tokens: {},
      statusIds: [],
    },
    {
      id: "player-2",
      seat: 2,
      connected: false,
      position: 12,
      lapsCompleted: 0,
      rank: { id: "rank.associate", kind: "rank.associate", index: 1 },
      role: { revealed: false },
      resources: { money: 900, reputation: 3, energy: 2 },
      tokens: {},
      statusIds: [],
    },
  ],
  eventSummaries: [
    {
      id: "event-1",
      type: "TurnStarted",
      revision: 8,
      occurredAt: "2026-07-24T12:00:00.000Z",
      actorPlayerId: "player-2",
    },
  ],
  winnerPlayerIds: [],
} satisfies PublicGameProjection;

const bootstrap = {
  room,
  publicProjection: game,
  self: {
    playerId: "player-1",
    role: { id: "role-1", kind: null, revealed: false },
    characterId: "character.workaholic",
    hand: [],
    privateStatusIds: [],
    abilityIds: [],
  },
  prompts: [],
  reactions: [],
  legalActions: [{ type: "turn.roll", expectedRevision: 8 }],
  serverTime: "2026-07-24T12:00:01.000Z",
} satisfies GameBootstrap;

describe("game layout", () => {
  it("keeps board, action tray, then turn rail in landmark DOM order", () => {
    // Given
    const markup = renderToStaticMarkup(
      <GameLayout
        hud={
          <>
            <div data-slot="game-header-region">Header</div>
            <div data-slot="game-resources-region">Resources</div>
          </>
        }
        board={<div>Board</div>}
        actionTray={<div>Actions</div>}
        turnRail={<div>Rail</div>}
      />,
    );

    // When
    const headerIndex = markup.indexOf('data-slot="game-header-region"');
    const resourcesIndex = markup.indexOf('data-slot="game-resources-region"');
    const boardIndex = markup.indexOf('data-slot="game-board-region"');
    const actionIndex = markup.indexOf('data-slot="game-action-region"');
    const railIndex = markup.indexOf('data-slot="game-turn-rail-region"');

    // Then
    expect(headerIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeLessThan(resourcesIndex);
    expect(resourcesIndex).toBeLessThan(boardIndex);
    expect(boardIndex).toBeLessThan(actionIndex);
    expect(actionIndex).toBeLessThan(railIndex);
  });

  it("renders seat and activity rail from current room and game projections", () => {
    // Given
    const markup = renderToStaticMarkup(
      <TurnRail game={game} room={room} selfPlayerId="player-1" />,
    );

    // When
    const seatRows = markup.match(/data-slot="turn-rail-seat"/g) ?? [];
    const activityRows = markup.match(/data-slot="turn-rail-activity"/g) ?? [];

    // Then
    expect(seatRows).toHaveLength(2);
    expect(activityRows).toHaveLength(1);
    expect(markup).toContain("Morgan");
    expect(markup).toContain("Away");
    expect(markup).toContain("R8");
  });

  it("enables the roll action only when the current projection allows it", () => {
    // Given
    const onRoll = vi.fn();

    // When
    const waitingMarkup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Morgan"
        canRoll={false}
        isRolling={false}
        onRoll={onRoll}
        rollError={null}
      />,
    );
    const activeMarkup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        isRolling={false}
        onRoll={onRoll}
        rollError={null}
      />,
    );

    // Then
    expect(waitingMarkup).not.toContain("<button");
    expect(waitingMarkup).toContain("Waiting on");
    expect(waitingMarkup).toContain("Morgan");
    expect(activeMarkup).toMatch(/<button[^>]*>/);
    expect(activeMarkup).not.toMatch(/<button[^>]* disabled=""/);
  });

  it("derives the board focus and legal roll from the current bootstrap", () => {
    // Given
    const expectedSpaceCount = 44;

    // When
    const view = createGameView(bootstrap);

    // Then
    expect(view.activeTile).toBe(7);
    expect(view.canRoll).toBe(true);
    expect(view.spaces).toHaveLength(expectedSpaceCount);
    expect(view.players.find((player) => player.id === "player-1")?.state).toBe("current");
    expect(view.players.find((player) => player.id === "player-2")?.state).toBe("disconnected");
  });
});
