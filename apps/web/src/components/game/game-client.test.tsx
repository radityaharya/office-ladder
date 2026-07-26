import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  GameBootstrap,
  PublicGameProjection,
  RoomProjection,
} from "@office-ladder/contracts";

import {
  classifyBootstrap,
  GameAbsent,
  GameError,
  GameLoading,
  GameWinner,
  outcomeValue,
  winnerHeadline,
} from "./game-client";

/**
 * The shell screens that carry a `Link` need router context but no matched
 * route, which is exactly what `RouterContextProvider` is for — a full
 * `RouterProvider` would render the route tree instead of the node under test.
 */
function renderWithRouter(node: ReactNode): string {
  const rootRoute = createRootRoute({});
  const roomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rooms/$roomId",
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([roomRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  return renderToStaticMarkup(
    <RouterContextProvider router={router}>{node}</RouterContextProvider>,
  );
}

const room = {
  id: "room-1",
  code: "Q4W8ZT",
  status: "completed",
  mode: "mode.quick",
  capacity: 6,
  revision: 12,
  members: [
    {
      id: "player-1",
      displayName: "Avery",
      seat: 0,
      isHost: true,
      isReady: true,
      isConnected: true,
      isBot: false,
      botDifficulty: null,
      avatarUrl: null,
      characterId: null,
      characterLabel: null,
    },
    {
      id: "player-2",
      displayName: "Morgan",
      seat: 1,
      isHost: false,
      isReady: true,
      isConnected: true,
      isBot: true,
      botDifficulty: "standard",
      avatarUrl: null,
      characterId: null,
      characterLabel: null,
    },
    {
      id: "player-3",
      displayName: "Ridley",
      seat: 2,
      isHost: false,
      isReady: true,
      isConnected: false,
      isBot: false,
      botDifficulty: null,
      avatarUrl: null,
      characterId: null,
      characterLabel: null,
    },
  ],
} satisfies RoomProjection;

const endedGame = {
  id: "game-1",
  revision: 91,
  status: "ended",
  activePlayerId: null,
  turnNumber: 34,
  round: 9,
  phase: "closed",
  deadlineAt: null,
  turnTimerDurationMs: null,
  players: [
    {
      id: "player-1",
      seat: 0,
      connected: true,
      position: 7,
      lapsCompleted: 2,
      rank: { id: "rank.manager", kind: "rank.manager", index: 3 },
      role: { revealed: false },
      resources: { money: 4_200, reputation: 9, energy: 5 },
      tokens: {},
      statusIds: [],
    },
    {
      id: "player-2",
      seat: 1,
      connected: true,
      position: 22,
      lapsCompleted: 3,
      rank: { id: "rank.director", kind: "rank.director", index: 5 },
      role: { revealed: false },
      resources: { money: 1_150, reputation: 14, energy: 3 },
      tokens: {},
      statusIds: [],
    },
    {
      id: "player-3",
      seat: 2,
      connected: false,
      position: 15,
      lapsCompleted: 2,
      rank: { id: "rank.associate", kind: "rank.associate", index: 1 },
      role: { revealed: false },
      resources: { money: 800, reputation: 4, energy: 2 },
      tokens: {},
      statusIds: [],
    },
  ],
  eventSummaries: [
    {
      id: "event-1",
      type: "TurnStarted",
      revision: 88,
      occurredAt: "2026-07-26T09:14:02.000Z",
      actorPlayerId: "player-2",
    },
    {
      id: "event-2",
      type: "PlayerPromoted",
      revision: 90,
      occurredAt: "2026-07-26T09:14:05.000Z",
      actorPlayerId: "player-2",
    },
    {
      id: "event-3",
      type: "MatchEnded",
      revision: 91,
      occurredAt: "2026-07-26T09:14:06.000Z",
      actorPlayerId: null,
    },
  ],
  winnerPlayerIds: ["player-2"],
} satisfies PublicGameProjection;

function bootstrapFor(selfPlayerId: string): GameBootstrap {
  return {
    room,
    publicProjection: endedGame,
    self: {
      playerId: selfPlayerId,
      role: { id: "role-1", kind: null, revealed: false },
      characterId: "character.workaholic",
      hand: [],
      privateStatusIds: [],
      abilityIds: [],
    },
    prompts: [],
    reactions: [],
    legalActions: [],
    serverTime: "2026-07-26T09:14:07.000Z",
  } satisfies GameBootstrap;
}

/** Every one of these must be absent from every shell screen (DESIGN.md §4–§7). */
function expectNoForbiddenVisuals(markup: string): void {
  expect(markup).not.toContain("rounded-full");
  expect(markup).not.toContain("animate-pulse");
  expect(markup).not.toContain("blur-");
  expect(markup).not.toContain("backdrop-blur");
  expect(markup).not.toContain("shadow-[");
  expect(markup).not.toContain("italic");
}

describe("game shell — connecting", () => {
  it("renders a legible resting state with skeleton rows, not a spinner", () => {
    // Given / When
    const markup = renderToStaticMarkup(<GameLoading />);

    // Then
    expect(markup).toContain('data-slot="game-loading"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Connecting to the floor terminal.");
    expect(markup).toContain('data-slot="game-loading-skeleton"');
    expect(markup).toContain("game-shell-skeleton-bar");
    expectNoForbiddenVisuals(markup);
  });

  it("labels its state readout with text, never with colour alone", () => {
    // Given / When
    const markup = renderToStaticMarkup(<GameLoading />);

    // Then — the LED is decorative; the value beside it carries the meaning.
    expect(markup).toContain('data-slot="game-shell-strip"');
    expect(markup).toContain('data-tone="info"');
    expect(markup).toContain("Opening");
    expect(markup).toMatch(/aria-hidden="true"[^>]*class="game-shell-led"/);
  });
});

describe("game shell — no match", () => {
  it("states the real minimum-players rule and offers the way back", () => {
    // Given / When
    const markup = renderWithRouter(<GameAbsent roomId="room-1" />);

    // Then
    expect(markup).toContain('data-slot="game-absent"');
    expect(markup).toContain("This room has not started a shift.");
    expect(markup).toContain("Three seats are the");
    expect(markup).toContain('data-slot="game-shell-back"');
    expect(markup).toContain("Back to room");
    expectNoForbiddenVisuals(markup);
  });
});

describe("game shell — feed dropped", () => {
  it("reports the failure as an alert with a retry control", () => {
    // Given
    const onRetry = vi.fn();

    // When
    const markup = renderWithRouter(
      <GameError
        message="The game server could not be reached."
        onRetry={onRetry}
        roomId="room-1"
      />,
    );

    // Then
    expect(markup).toContain('data-slot="game-error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("The game server could not be reached.");
    expect(markup).toContain('data-tone="critical"');
    expect(markup).toContain('data-slot="game-error-retry"');
    expect(markup).toContain("Retry");
    expectNoForbiddenVisuals(markup);
  });
});

describe("match report", () => {
  it("prints final standings with the Director pinned first and named in text", () => {
    // Given / When
    const markup = renderWithRouter(
      <GameWinner bootstrap={bootstrapFor("player-1")} roomId="room-1" />,
    );

    // Then
    expect(markup).toContain('data-slot="game-winner"');
    expect(markup).toContain("Match closed");
    expect(markup).toContain("Morgan reached Director.");

    const rows = markup.match(/data-outcome="(winner|closed)"/g) ?? [];
    expect(rows).toEqual([
      'data-outcome="winner"',
      'data-outcome="closed"',
      'data-outcome="closed"',
    ]);

    // The accent tag never stands alone: the word "Director" is in the cell.
    expect(markup).toContain('data-tone="accent"');
    expect(markup).toContain("Director</span>");
    expect(markup).toContain("Not promoted");
  });

  it("echoes every final resource as a mono tabular value", () => {
    // Given / When
    const markup = renderWithRouter(
      <GameWinner bootstrap={bootstrapFor("player-1")} roomId="room-1" />,
    );

    // Then
    expect(markup).toContain('data-slot="game-winner-standings"');
    expect(markup).toContain("$1,150");
    expect(markup).toContain("$4,200");
    expect(markup).toContain('data-numeric="true"');
    expect(markup).toContain("R91");
  });

  it("marks the local seat and a bot seat with explicit text", () => {
    // Given / When
    const markup = renderWithRouter(
      <GameWinner bootstrap={bootstrapFor("player-1")} roomId="room-1" />,
    );

    // Then
    expect(markup).toContain("Avery (you)");
    expect(markup).toContain("Morgan · Bot");
    expect(markup).toContain("Seat 1");
  });

  it("reads the closing log entries from the committed event stream", () => {
    // Given / When
    const markup = renderWithRouter(
      <GameWinner bootstrap={bootstrapFor("player-1")} roomId="room-1" />,
    );

    // Then
    expect(markup).toContain("Closing entries");
    const logRows = markup.match(/data-slot="turn-rail-activity"/g) ?? [];
    expect(logRows).toHaveLength(endedGame.eventSummaries.length);
    expect(markup).toContain("09:14:06");
  });

  it("addresses the winning player in the second person", () => {
    // Given / When
    const markup = renderWithRouter(
      <GameWinner bootstrap={bootstrapFor("player-2")} roomId="room-1" />,
    );

    // Then
    expect(markup).toContain("You reached Director.");
    expect(markup).toContain("Morgan (you) · Bot");
    expectNoForbiddenVisuals(markup);
  });
});

describe("bootstrap classification", () => {
  /**
   * The exact 200 body the server sends for a room that has not started:
   * `createRoomBootstrap` in apps/server/src/rooms/service/projections.ts.
   * Treating it as a GameBootstrap threw inside `createGameView` during render.
   */
  const lobbyPayload = {
    room: {
      id: "room-1",
      code: "9CEGCA",
      status: "open",
      mode: "mode.quick",
      capacity: 4,
      revision: 0,
      members: [
        {
          id: "player-1",
          displayName: "Avery",
          seat: 0,
          isHost: true,
          isReady: true,
          isConnected: true,
          isBot: false,
          botDifficulty: null,
          avatarUrl: null,
          characterId: null,
          characterLabel: null,
        },
      ],
    },
    selfMemberId: "player-1",
  };

  it("reads a started room as a game bootstrap", () => {
    // Given / When
    const shape = classifyBootstrap(bootstrapFor("player-1"));

    // Then
    expect(shape.kind).toBe("game");
    expect(shape.kind === "game" && shape.bootstrap.publicProjection.revision).toBe(91);
  });

  it("reads an unstarted room as the lobby shape, so the board can say 'no match'", () => {
    // Given / When / Then — 200 with no publicProjection is not an error.
    expect(classifyBootstrap(lobbyPayload).kind).toBe("lobby");
  });

  it("keeps a malformed projection distinct from an unstarted room", () => {
    // Given a payload that claims a projection but cannot supply one.
    const broken = { ...lobbyPayload, publicProjection: { revision: 4 } };

    // When / Then
    expect(classifyBootstrap(broken).kind).toBe("unknown");
    expect(classifyBootstrap({ room: { members: [] } }).kind).toBe("lobby");
    expect(classifyBootstrap({ room: {} }).kind).toBe("unknown");
    expect(classifyBootstrap(null).kind).toBe("unknown");
    expect(classifyBootstrap("nope").kind).toBe("unknown");
    expect(classifyBootstrap([]).kind).toBe("unknown");
  });
});

describe("match report copy", () => {
  it("names one Director, counts several, and stays truthful with none", () => {
    // Given / When / Then
    expect(winnerHeadline(true, ["Avery"])).toBe("You reached Director.");
    expect(winnerHeadline(false, ["Avery"])).toBe("Avery reached Director.");
    expect(winnerHeadline(false, ["Avery", "Morgan"])).toBe(
      "Avery and Morgan reached Director.",
    );
    expect(winnerHeadline(false, [])).toBe("The match closed without a Director.");

    expect(outcomeValue([])).toBe("No Director");
    expect(outcomeValue(["Avery"])).toBe("Avery · Director");
    expect(outcomeValue(["Avery", "Morgan"])).toBe("2 Directors");
  });
});
