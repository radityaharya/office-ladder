import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  GameBootstrap,
  PublicGameProjection,
  RoomProjection,
} from "@office-ladder/contracts";

import {
  GAMEPLAY_MOTION_MS,
  GAMEPLAY_TRANSITION,
  MAX_TRAVEL_MS,
} from "@/lib/motion";

import { ActionTray } from "./action-tray";
import type { DiceRollFeedItem } from "./dice";
import { EVENT_PACING, revealedEventCount, createEventPacingState } from "./event-feedback-policy";
import { GameLayout } from "./game-layout";
import { createGameView } from "./game-view";
import { TurnRail } from "./turn-rail";

const selfRoll = {
  eventId: "event-9",
  faces: [4],
  total: 4,
  purpose: "normal-movement",
  rollerName: "Avery",
  isSelf: true,
  isBot: false,
} satisfies DiceRollFeedItem;

const botRoll = {
  eventId: "event-10",
  faces: [3, 5],
  total: 8,
  purpose: "audit-release",
  rollerName: "Morgan",
  isSelf: false,
  isBot: true,
} satisfies DiceRollFeedItem;

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
      isBot: false,
      botDifficulty: null,
      avatarUrl: null,
      characterId: null,
      characterLabel: null,
    },
    {
      id: "player-2",
      displayName: "Morgan",
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

const game = {
  id: "game-1",
  revision: 8,
  status: "active",
  activePlayerId: "player-1",
  turnNumber: 4,
  round: 2,
  phase: "awaiting-roll",
  deadlineAt: null,
  turnTimerDurationMs: null,
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
    expect(activeMarkup).toContain("Roll die");
    expect(activeMarkup).toContain('data-slot="action-tray-roll"');
  });

  it("keeps the action bar free of the forbidden pill, halo and resting shadow", () => {
    // Given
    const onRoll = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        dice={selfRoll}
        isRolling={false}
        onRoll={onRoll}
        rollError="The roll was not accepted."
      />,
    );

    // Then
    expect(markup).toContain('data-slot="action-tray"');
    expect(markup).not.toContain("rounded-full");
    expect(markup).not.toContain("animate-pulse");
    expect(markup).not.toContain("blur-");
    expect(markup).not.toContain("shadow-[");
    expect(markup).not.toContain("backdrop-blur");
  });

  it("renders a roll failure as a status-message entry the shell owns", () => {
    // Given
    const onRoll = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        isRolling={false}
        onRoll={onRoll}
        rollError="The turn changed before that roll reached the server."
      />,
    );

    // Then
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("status-message-error");
    expect(markup).toContain("The turn changed before that roll reached the server.");
  });

  it("settles the dice readout on a single committed face without echoing a total", () => {
    // Given
    const onRoll = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll={false}
        dice={selfRoll}
        isRolling={false}
        onRoll={onRoll}
        rollError={null}
      />,
    );

    // Then
    expect(markup).toContain('data-slot="dice-readout"');
    expect(markup).toContain('data-dice-state="settled"');
    expect(markup).toContain('data-dice-face="4"');
    expect(markup).toContain("Movement roll");
    expect(markup).not.toContain('data-slot="dice-readout-total"');
    expect(markup).toContain("You rolled 4.");
  });

  it("shows every face plus a separate total for a multi-die roll by a bot", () => {
    // Given
    const onRoll = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Morgan"
        canRoll={false}
        dice={botRoll}
        isRolling={false}
        onRoll={onRoll}
        rollError={null}
      />,
    );

    // Then
    const faces = markup.match(/data-dice-face="\d"/g) ?? [];
    expect(faces).toEqual(['data-dice-face="3"', 'data-dice-face="5"']);
    expect(markup).toContain('data-slot="dice-readout-total"');
    expect(markup).toContain("Morgan · Bot");
    expect(markup).toContain("Morgan rolled 3 and 5. Total 8.");
  });

  it("reports an in-flight local roll without inventing a face", () => {
    // Given
    const onRoll = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        dice={null}
        isRolling
        onRoll={onRoll}
        rollError={null}
      />,
    );

    // Then
    expect(markup).toContain('data-dice-state="rolling"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/<button[^>]* disabled=""/);
    expect(markup).toContain("Rolling");
    expect(markup).toContain('data-dice-face=""');
  });

  it("keeps a legible resting instrument before the first roll of a match", () => {
    // Given
    const onRoll = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        dice={null}
        isRolling={false}
        onRoll={onRoll}
        rollError={null}
      />,
    );

    // Then
    expect(markup).toContain('data-dice-state="empty"');
    expect(markup).toContain('data-dice-led="idle"');
    expect(markup).toContain("Idle");
    expect(markup).toContain("Rolled by");
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

/* ------------------------------------------------------------------------- */
/* Integration invariants.                                                   */
/*                                                                           */
/* Nothing animated or interactive is unit-testable here (this suite's        */
/* environment is `node`: no jsdom, no testing-library), so these assert the   */
/* things that must be true of the MARKUP and of the shared motion contract — */
/* the two places a regression would be silent otherwise.                    */
/* ------------------------------------------------------------------------- */

describe("action region composition", () => {
  /**
   * game-client.tsx passes three things through the `actionTray` slot: the
   * non-blocking card feed, the playback catch-up strip, then the action bar.
   * They must be real stacked ROWS of the shell grid in that order — the whole
   * point of moving card draws off a modal is that nothing dims or covers the
   * board and nothing sits between the player and the roll control.
   */
  it("stacks card feed, catch-up strip and action bar as rows, with no overlay", () => {
    // Given the exact composition game-client.tsx renders.
    const markup = renderToStaticMarkup(
      <GameLayout
        hud={<div>HUD</div>}
        board={<div>Board</div>}
        actionTray={
          <>
            <div data-slot="card-feed">Card</div>
            <button data-slot="dice-catchup" type="button">
              Catch up
            </button>
            <ActionTray
              activePlayerName="Avery"
              canRoll
              dice={selfRoll}
              isRolling={false}
              onRoll={vi.fn()}
              rollError={null}
            />
          </>
        }
        turnRail={<div>Rail</div>}
      />,
    );

    // When
    const region = markup.indexOf('data-slot="game-action-region"');
    const feed = markup.indexOf('data-slot="card-feed"');
    const catchUp = markup.indexOf('data-slot="dice-catchup"');
    const tray = markup.indexOf('data-slot="action-tray"');

    // Then — all three inside the action region, in that order.
    expect(region).toBeGreaterThan(-1);
    expect(region).toBeLessThan(feed);
    expect(feed).toBeLessThan(catchUp);
    expect(catchUp).toBeLessThan(tray);

    // And the roll control is still reachable: no backdrop, no dialog, no dim.
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("aria-modal");
    expect(markup).not.toContain("backdrop");
    expect(markup).toContain('data-slot="action-tray-roll"');
  });
});

describe("shared motion contract", () => {
  /**
   * DESIGN.md §7.2: "a token moving six spaces HOPS tile-to-tile (six steps), it
   * does not glide." The travel machine re-arms one hop every `hopPerTile`, so a
   * per-hop transition LONGER than that beat overlaps its successor and the token
   * never comes to rest between tiles — which reads as a glide with velocity
   * ripples. Pinning equality is what keeps the movement discrete.
   */
  it("keeps one token hop no longer than the travel beat it is re-armed on", () => {
    expect(GAMEPLAY_TRANSITION.tokenHop.duration * 1_000).toBe(
      GAMEPLAY_MOTION_MS.hopPerTile,
    );
    expect(GAMEPLAY_TRANSITION.tokenHop).not.toHaveProperty("type", "spring");
    // A whole lap must still fit the budget check rather than running forever.
    expect(MAX_TRAVEL_MS).toBeGreaterThan(GAMEPLAY_MOTION_MS.hopPerTile);
  });

  /**
   * The presentation queue's compressed beat has to fit inside the server's own
   * bot cadence or the backlog grows every turn and compression never rests.
   * `BOT_TURN_DELAY_MS` defaults to 1500ms server-side; one bot turn is ~6
   * events. This is the arithmetic that makes the queue self-stabilising, and it
   * is the first thing a tempo tweak would quietly break.
   */
  it("drains one bot turn inside the server's bot cadence when compressing", () => {
    const eventsPerBotTurn = 6;
    const serverBotDelayMs = 1_500;
    expect(eventsPerBotTurn * EVENT_PACING.compressedBeat).toBeLessThan(
      serverBotDelayMs,
    );
    expect(EVENT_PACING.sprintBeat).toBeLessThan(EVENT_PACING.compressedBeat);
    expect(EVENT_PACING.compressedBeat).toBeLessThan(EVENT_PACING.beat);
  });

  /**
   * The first synchronous render must show the REAL history, not an empty log
   * that fills in after mount. `useEventPacing` gets this by treating an
   * un-hydrated cursor as "everything already seen" — which is also what makes
   * `renderToStaticMarkup` of a wired-up board correct, and what a
   * reduced-motion player relies on.
   */
  it("reveals the whole projection on the very first render", () => {
    const events = game.eventSummaries;
    expect(revealedEventCount(createEventPacingState(), events)).toBe(events.length);
  });
});
