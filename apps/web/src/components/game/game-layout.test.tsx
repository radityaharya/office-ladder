import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
import { AttentionNotice, GameLayout } from "./game-layout";
import { createAttentionNotice, createGameView } from "./game-view";
import { RAIL_DESTINATIONS, RAIL_GROUPS, TurnRail } from "./turn-rail";

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

/* ------------------------------------------------------------------------- */
/* Shell geometry.                                                           */
/*                                                                           */
/* None of this is observable in a `renderToStaticMarkup` string — there is   */
/* no layout in this environment — so the invariants are pinned against the   */
/* stylesheets themselves, the same way turn-rail.test.tsx pins the log's     */
/* wrapping rules. Each one of these has been a real, reported defect.        */
/* ------------------------------------------------------------------------- */

const shellSheet = readFileSync(
  fileURLToPath(new URL("../../styles/game-shell.css", import.meta.url)),
  "utf8",
);

const hudSheet = readFileSync(
  fileURLToPath(new URL("../../styles/hud.css", import.meta.url)),
  "utf8",
);

/** The declaration block of a top-level rule, by exact selector. */
function cssRule(sheet: string, selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  expect(start, `${selector} is missing`).toBeGreaterThan(-1);
  return sheet.slice(start, sheet.indexOf("}", start));
}

/** Every at-rule block starting with `prefix`, brace-matched so nested rules
    are included rather than truncated at the first `}`. */
function atRuleBlocks(sheet: string, prefix: string): readonly string[] {
  const blocks: string[] = [];
  let index = sheet.indexOf(prefix);

  while (index > -1) {
    let depth = 0;
    let end = sheet.indexOf("{", index);
    for (; end < sheet.length; end += 1) {
      if (sheet[end] === "{") depth += 1;
      if (sheet[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(sheet.slice(index, end + 1));
    index = sheet.indexOf(prefix, end);
  }

  return blocks;
}

describe("match shell geometry", () => {
  /**
   * The rail column was `auto` once: it sized itself to its widest content, so
   * the moment a card notice moved into the rail the notice's own width sized
   * the column and starved the board. A definite track on both axes is the
   * whole fix, and it has to hold at every band.
   */
  it("gives the rail a definite track on both axes", () => {
    // Given
    const shell = cssRule(shellSheet, ".game-shell");

    // Then — stacked: the rail's ROW is a length, not `auto` under a max-height.
    expect(shell).toContain("var(--game-shell-sheet)");
    expect(shellSheet).toMatch(/--game-shell-sheet: min\(\d+vh, \d+px\)/);

    // And side by side: the rail's COLUMN is a length at every band.
    expect(shellSheet).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\) var\(--game-shell-rail\)/,
    );
    for (const measure of ["272px", "320px", "352px", "384px"]) {
      expect(shellSheet).toContain(`--game-shell-rail: ${measure}`);
    }
    expect(shell).not.toMatch(/grid-template-columns:[^;]*auto/);
  });

  /**
   * `.game-shell-rail` was `display: flex` with no `flex-direction`, so it
   * defaulted to `row` and the seat roster was laid out beside the log at 111px
   * wide. A single-column grid cannot regress that way.
   */
  it("flows rail children down one column", () => {
    // Given
    const region = cssRule(shellSheet, ".game-shell-rail");
    const rail = cssRule(hudSheet, ".hud-rail");

    // Then
    expect(region).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(region).toContain("grid-auto-flow: row");
    expect(region).not.toContain("flex-direction: row");
    // The rail itself: head, tabs, then the only flexible row.
    expect(rail).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
  });

  /**
   * "the popup event notification is causing the board to jump up and down."
   * The band holds everything time-limited, and its row is the same height
   * occupied or empty — a `min-height` here would let content grow the row and
   * hand the difference straight back to the board.
   */
  it("keeps the attention band out of the board's layout", () => {
    // Given
    const band = cssRule(shellSheet, ".game-shell-attention");

    // Then
    expect(shellSheet).toContain("--game-shell-attention: 40px");
    expect(band).toContain("height: var(--game-shell-attention)");
    expect(band).not.toContain("min-height");
    expect(band).not.toContain("position: absolute");
    // It is a row of the shell grid, so it can never overlap the board either.
    expect(cssRule(shellSheet, ".game-shell")).toContain("var(--game-shell-attention)");
  });

  it("renders the band whether or not anything is pending, and never as a modal", () => {
    // Given
    const empty = renderToStaticMarkup(
      <GameLayout
        actionTray={<div>Actions</div>}
        board={<div>Board</div>}
        hud={<div>HUD</div>}
        turnRail={<div>Rail</div>}
      />,
    );
    const occupied = renderToStaticMarkup(
      <GameLayout
        actionTray={<div>Actions</div>}
        attention={
          <AttentionNotice
            deadline="12:00:30"
            detail="Audit release is waiting on you."
            label="Decision"
            tone="caution"
          />
        }
        board={<div>Board</div>}
        hud={<div>HUD</div>}
        turnRail={<div>Rail</div>}
      />,
    );

    // Then — same region, same box, different content.
    expect(empty).toContain('class="game-shell-attention"');
    expect(occupied).toContain('class="game-shell-attention"');
    expect(empty).toContain('data-occupied="false"');
    expect(occupied).toContain('data-occupied="true"');
    expect(empty).toContain('data-slot="game-attention-rest"');
    expect(occupied).toContain('data-slot="game-attention-notice"');
    expect(occupied).toContain("12:00:30");

    // And it interrupts nothing: no dialog, no backdrop, no focus trap.
    expect(occupied).not.toContain('role="dialog"');
    expect(occupied).not.toContain("aria-modal");
    expect(occupied).not.toContain("backdrop");
  });

  /**
   * The catch-up strip used to be a flow row of the action region, appearing and
   * vanishing during playback and moving the board 32px (631px -> 599px) every
   * time. It now lives in the rail head, which is a definite grid track, so the
   * action region hosts nothing transient at all and needs no reservation.
   *
   * This asserts the ABSENCE, because the regression this guards against is
   * someone adding a conditional row back to the region — which would silently
   * reintroduce the swing rather than fail loudly.
   */
  it("keeps the action region free of anything that comes and goes", () => {
    // Given
    const action = cssRule(shellSheet, ".game-shell-action");

    // Then — no reserved lane, because nothing transient is hosted here.
    expect(action).not.toContain("padding-block-start");
    expect(shellSheet).not.toContain("--game-shell-lane");
    expect(shellSheet).not.toContain('.game-shell-action:has(> [data-slot="dice-catchup"])');

    // And the two regions that DO host transient content are still definite, so
    // the board's `1fr` row cannot be resized by either of them.
    expect(shellSheet).toContain("--game-shell-attention: 40px");
    expect(shellSheet).toContain("--game-shell-rail: 320px");
  });

  it("puts the attention band between the instruments and the board", () => {
    // Given
    const markup = renderToStaticMarkup(
      <GameLayout
        actionTray={<div>Actions</div>}
        board={<div>Board</div>}
        hud={<div>HUD</div>}
        turnRail={<div>Rail</div>}
      />,
    );

    // Then
    const hudIndex = markup.indexOf('data-slot="game-hud-region"');
    const attentionIndex = markup.indexOf('data-slot="game-attention-region"');
    const boardIndex = markup.indexOf('data-slot="game-board-region"');
    expect(hudIndex).toBeLessThan(attentionIndex);
    expect(attentionIndex).toBeLessThan(boardIndex);
  });
});

describe("rail destinations", () => {
  function rail(props: Partial<Parameters<typeof TurnRail>[0]> = {}) {
    return renderToStaticMarkup(
      <TurnRail game={game} room={room} selfPlayerId="player-1" {...props} />,
    );
  }

  /**
   * plans/24-gameplay-v2-spec.md §8.5: twelve destinations. All of them exist
   * at rest — a destination with nothing in it yet states that in words rather
   * than disappearing, so the rail's shape does not change as panels are wired.
   */
  it("renders every destination behind five tabs", () => {
    // Given
    const markup = rail();

    // When
    const tabs = markup.match(/data-slot="rail-tab"/g) ?? [];
    const panels = markup.match(/data-slot="rail-panel"/g) ?? [];

    // Then
    expect(tabs).toHaveLength(RAIL_GROUPS.length);
    expect(panels).toHaveLength(Object.keys(RAIL_DESTINATIONS).length);
    expect(panels).toHaveLength(12);
    for (const destination of Object.values(RAIL_DESTINATIONS)) {
      expect(markup).toContain(`>${destination.title}</h2>`);
    }
    for (const group of RAIL_GROUPS) {
      expect(markup).toContain(`>${group.label}</span>`);
    }

    // Exactly one group open, the rest present but not shown.
    expect(markup.match(/aria-selected="true"/g) ?? []).toHaveLength(1);
    expect(markup.match(/hidden=""/g) ?? []).toHaveLength(RAIL_GROUPS.length - 1);
  });

  /**
   * "still cant see all seats." The dossier rows live behind a tab now, so the
   * things a player needs continuously must not: whose turn it is, the turn
   * clock, every seat as a numbered chip, and their own resources all live in a
   * persistent head above the tab strip.
   */
  it("keeps turn, clock, seats and resources out of the tabs", () => {
    // Given
    const markup = rail();

    // Then
    const head = markup.indexOf('data-slot="rail-head"');
    const tabs = markup.indexOf('data-slot="rail-tabs"');
    expect(head).toBeGreaterThan(-1);
    expect(head).toBeLessThan(tabs);
    expect(markup).toContain('data-slot="turn-rail-turn-state"');
    expect(markup).toContain('data-slot="rail-turn-clock"');
    expect(markup).toContain('data-slot="rail-self"');
    // One chip per seat, always visible, carrying the seat NUMBER (§8).
    const chips = markup.match(/data-slot="rail-seat-chip"/g) ?? [];
    expect(chips).toHaveLength(game.players.length);
    expect(markup.indexOf('data-slot="rail-seat-strip"')).toBeLessThan(tabs);
  });

  it("badges the group that holds a panel wanting attention, as a number", () => {
    // Given
    const markup = rail({
      panels: [{ id: "ballots", attention: { count: 2, tone: "caution" } }],
    });

    // When — the SOCIAL tab, from its own marker to the next tab's.
    const socialTab = markup.slice(
      markup.indexOf('data-group="social"'),
      markup.indexOf('data-group="track"'),
    );

    // Then — the count is text, not colour alone (§8), and it is announced.
    expect(socialTab).toContain('data-tone="caution"');
    expect(socialTab).toContain(">2<");
    expect(socialTab).toContain("2 need attention.");
    // Every other tab keeps the same reserved, empty badge lane, so an arriving
    // badge cannot widen its tab and shove the strip sideways.
    expect(markup.match(/data-empty="true"/g) ?? []).toHaveLength(RAIL_GROUPS.length - 1);
  });

  it("hosts the playback catch-up control in the rail, not under the board", () => {
    // Given
    const markup = rail({
      catchUp: (
        <button data-slot="dice-catchup" type="button">
          Catch up
        </button>
      ),
    });

    // Then
    expect(markup).toContain('data-slot="rail-catchup"');
    expect(markup.indexOf('data-slot="rail-head"')).toBeLessThan(
      markup.indexOf('data-slot="dice-catchup"'),
    );
    expect(markup.indexOf('data-slot="dice-catchup"')).toBeLessThan(
      markup.indexOf('data-slot="rail-tabs"'),
    );
  });

  it("lets a caller fill a destination without losing the panel frame", () => {
    // Given
    const markup = rail({
      panels: [{ id: "hand", content: <p data-slot="hand-body">Two cards.</p>, summary: "2" }],
    });

    // Then
    expect(markup).toContain('data-slot="hand-body"');
    expect(markup).toContain("Two cards.");
    expect(markup).toContain('data-panel="hand"');
    // The destination it replaced no longer shows its resting line.
    expect(markup).not.toContain("Your hand is empty.");
    expect(markup).toContain("No projects on the floor yet.");
  });

  /**
   * Contributed entries merge over the shell's own, so wave 4 can badge a panel
   * the shell already fills without blanking it — the seat roster surviving a
   * `{ id: "seats", attention }` entry is the case that matters.
   */
  it("badges a built-in panel without replacing what is in it", () => {
    // Given
    const markup = rail({ panels: [{ id: "seats", attention: { count: 1 } }] });

    // Then
    const seats = markup.match(/data-slot="turn-rail-seat"/g) ?? [];
    expect(seats).toHaveLength(game.players.length);
    expect(markup).toContain('data-slot="rail-panel-flag"');
    expect(markup).toContain("2/6");
  });

  /**
   * The rail is a narrow column inside a wide window, so viewport width is the
   * wrong signal for anything inside it — a mistake this layout has made and
   * had to unmake once. Viewport queries stay in game-shell.css, where the
   * side-by-side/stacked decision actually lives.
   */
  it("adapts inside the rail with container queries only", () => {
    // Then
    expect(cssRule(hudSheet, ".hud-rail")).toContain("container-type: inline-size");
    expect(hudSheet).toContain("container-name: rail");
    expect(hudSheet).toMatch(/@container rail \(min-width: 344px\)/);
    expect(hudSheet).toMatch(/@container rail \(max-width: 300px\)/);

    const viewportBlocks = [
      ...atRuleBlocks(hudSheet, "@media (min-width"),
      ...atRuleBlocks(hudSheet, "@media (max-width"),
    ];
    expect(viewportBlocks.length).toBeGreaterThan(0);
    for (const block of viewportBlocks) {
      expect(block).not.toMatch(
        /\.hud-rail-(head|tabs|tab|self|seat-strip|viewport|group|block|empty|flag)/,
      );
    }
  });

  /**
   * A panel that can be squeezed to zero height is a panel that is not there:
   * the seat roster lost exactly that fight once and rendered "SEATS 3/6" above
   * no rows at all.
   */
  it("keeps a floor under every panel that is not its group's primary", () => {
    // Then
    expect(hudSheet).toContain('.hud-rail-block:not([data-grow="true"]) {');
    expect(cssRule(hudSheet, '.hud-rail-block:not([data-grow="true"])')).toContain(
      "min-height: 108px",
    );
    expect(cssRule(hudSheet, '.hud-rail-block[data-grow="true"],\n.hud-rail-block--log')).toContain(
      "flex: 1 1 auto",
    );
  });
});

describe("action bar status lane", () => {
  /**
   * The roll error used to be a row that existed only when there was an error,
   * so a rejected roll grew the action region and the board's row shrank under
   * it. The lane is always there and always says something.
   */
  it("holds the same lane whether the roll failed or not", () => {
    // Given
    const resting = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        isRolling={false}
        onRoll={vi.fn()}
        rollError={null}
      />,
    );
    const failed = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        isRolling={false}
        onRoll={vi.fn()}
        rollError="The turn changed before that roll reached the server."
      />,
    );

    // Then
    expect(resting).toContain('data-slot="action-tray-lane"');
    expect(failed).toContain('data-slot="action-tray-lane"');
    expect(resting).toContain('data-slot="action-tray-ready"');
    expect(failed).toContain('data-slot="action-tray-error"');
    expect(cssRule(hudSheet, ".hud-lane")).toContain("min-height: 28px");
  });
});

describe("attention notice derivation", () => {
  it("puts an open decision on the band, with the turn deadline it is on", () => {
    // Given
    const notice = createAttentionNotice({
      ...bootstrap,
      publicProjection: { ...game, deadlineAt: "2026-07-24T12:00:30.000Z" },
      legalActions: [
        {
          type: "prompt.respond",
          expectedRevision: 8,
          decisionPointId: "decision-1",
          kind: "audit-release",
          options: [{ id: "pay-fine" }, { id: "attempt-roll" }],
        },
      ],
    } as unknown as GameBootstrap);

    // Then
    expect(notice).not.toBeNull();
    expect(notice?.label).toBe("Decision");
    expect(notice?.tone).toBe("caution");
    expect(notice?.detail).toContain("Audit release");
    expect(notice?.deadline).toBe("12:00:30");
  });

  it("says nothing when nothing is on a clock", () => {
    expect(createAttentionNotice(bootstrap)).toBeNull();
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
