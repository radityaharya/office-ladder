import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { deadlineDashModes } from "@office-ladder/content";
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
import {
  buildRailPanels,
  commandIntentKey,
  refusalMessage,
  reserveCommandId,
} from "./game-client";
import { AttentionNotice, GameLayout } from "./game-layout";
import {
  asGameplayBootstrap,
  createActionContext,
  createAttentionNotice,
  createGameView,
  createOwnershipViews,
  createPlacementViews,
  hasTerritory,
} from "./game-view";
import { derivePanelData } from "./panels";
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

const actionsSheet = readFileSync(
  fileURLToPath(new URL("../../styles/actions.css", import.meta.url)),
  "utf8",
);

const globalsSheet = readFileSync(
  fileURLToPath(new URL("../../styles/globals.css", import.meta.url)),
  "utf8",
);

const toasterSource = readFileSync(
  fileURLToPath(new URL("../ui/sonner.tsx", import.meta.url)),
  "utf8",
);

/** The declaration block of a top-level rule, by exact selector. */
function cssRule(sheet: string, selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  expect(start, `${selector} is missing`).toBeGreaterThan(-1);
  return sheet.slice(start, sheet.indexOf("}", start));
}

describe("the toast stack keeps clear of the action bar", () => {
  /**
   * Measured during a live match before this was fixed: a 356x85 toast at y=760
   * sat on the action region, overlapping the roll control by 25,948px². The
   * toaster's own comment asserted the opposite — that bottom-right "sits over
   * the tail of the activity log rather than over the board or the action tray"
   * — which was wrong because the stack is wider than the rail (356 vs 352) and
   * anchors to the viewport rather than to the rail's floor.
   *
   * Covering the primary control is the one thing a notice in this game may
   * never do, so it is asserted rather than commented.
   */
  it("offsets the stack by the shell's clearance token", () => {
    // Given the shell publishes a clearance for anything floating at the bottom
    expect(shellSheet).toContain("--game-shell-action-clearance:");

    // Then the toaster reads it rather than restating a number that would drift
    expect(toasterSource).toContain("offset={{");
    expect(toasterSource).toContain("var(--game-shell-action-clearance");

    // And the narrow layout gets the same treatment: the rail becomes a bottom
    // sheet there, but the action bar is still the last row.
    expect(toasterSource).toContain("mobileOffset={{");
  });

  it("clears the action bar's real height with margin to spare", () => {
    // Given the clearance the shell publishes
    const root = cssRule(shellSheet, ":root");
    const clearance = /--game-shell-action-clearance:\s*(\d+)px/.exec(root)?.[1];

    // Then it exceeds the action bar measured in a live match (97px), because a
    // value that tracked the bar exactly would be wrong the moment a wrapped
    // roll refusal added a line — the region is deliberately `auto`.
    expect(clearance).toBeDefined();
    expect(Number(clearance)).toBeGreaterThan(97);
  });
});

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
   * The band's row is reserved, and the reservation is what stopped the board
   * moving — so the resting state is not allowed to buy that back by being empty.
   * It used to render "Attention" and an em dash: a whole instrument row spent
   * saying nothing, in a UI whose governing complaint is "i genuinely cant follow
   * the game".
   *
   * A live match never reaches this fallback — `createAttentionNotice` always
   * returns a notice once a projection exists — so what it must do is name the
   * lane and say what will appear in it (§12.5), not print a placeholder glyph.
   */
  it("never renders a dead lane at rest", () => {
    // Given the band with nothing passed at all: the pre-projection frame.
    const markup = renderToStaticMarkup(
      <GameLayout
        actionTray={<div>Actions</div>}
        board={<div>Board</div>}
        hud={<div>HUD</div>}
        turnRail={<div>Rail</div>}
      />,
    );

    // Then
    expect(markup).toContain("Standing by");
    expect(markup).toContain("Nothing is on a clock yet.");
    // And the placeholder is gone: no bare em dash standing in for a readout.
    expect(markup).not.toContain(">Attention<");
    expect(markup).not.toContain(">—<");
  });

  /**
   * "The row height must not change between resting and occupied. Verify that,
   * do not assume it."
   *
   * `renderToStaticMarkup` cannot measure a box, so this verifies the two things
   * that DECIDE the box instead, which is stronger than a single measurement:
   *
   *  1. The region element is identical in both states apart from `data-occupied`
   *     and its tab stop — same class, no inline style, nothing that could carry a
   *     different height.
   *  2. Its height is stated once, as a definite `height` with `overflow-y:
   *     hidden`, and NEITHER child declares anything on the block axis. A child
   *     with block padding or its own height is the only way content could push
   *     the row, and both are absent by assertion rather than by luck.
   */
  it("gives the band the same box resting and occupied", () => {
    // Given both states of the same region.
    const region = (markup: string): string => {
      const match = /<div class="game-shell-attention"[^>]*>/.exec(markup);
      expect(match, "the attention region is missing").not.toBeNull();
      return match?.[0] ?? "";
    };
    const resting = region(
      renderToStaticMarkup(
        <GameLayout
          actionTray={<div>Actions</div>}
          board={<div>Board</div>}
          hud={<div>HUD</div>}
          turnRail={<div>Rail</div>}
        />,
      ),
    );
    const occupied = region(
      renderToStaticMarkup(
        <GameLayout
          actionTray={<div>Actions</div>}
          attention={
            <AttentionNotice
              actions={<div data-slot="action-controls">Pay fine</div>}
              deadline={<div data-slot="game-turn-clock">Bar</div>}
              detail="Audit release is waiting on you."
              label="Decision"
              tone="caution"
            />
          }
          board={<div>Board</div>}
          hud={<div>HUD</div>}
          turnRail={<div>Rail</div>}
        />,
      ),
    );

    // Then the element itself is the same box in both states.
    const normalise = (tag: string): string =>
      tag.replace(/ data-occupied="(?:true|false)"/, "").replace(' tabindex="0"', "");
    expect(normalise(resting)).toBe(normalise(occupied));
    expect(resting).not.toContain("style=");
    expect(occupied).not.toContain("style=");

    // And nothing in the CSS lets its contents resize it.
    const band = cssRule(shellSheet, ".game-shell-attention");
    expect(band).toContain("height: var(--game-shell-attention)");
    expect(band).toContain("overflow-y: hidden");
    expect(band).not.toContain("min-height");
    expect(band).not.toContain("max-height");

    for (const selector of [".game-shell-attention-rest", ".game-shell-attention-notice"]) {
      const rule = cssRule(shellSheet, selector);
      expect(rule, selector).not.toMatch(/[\s;]height:/);
      expect(rule, selector).not.toContain("min-height");
      expect(rule, selector).not.toContain("padding-block");
      expect(rule, selector).not.toContain("padding-top");
      expect(rule, selector).not.toContain("padding-bottom");
    }
  });

  /**
   * The band already carries a decision's controls inline — PAY FINE / ATTEMPT
   * ROLL were observed there in a live match — so a player can answer without
   * opening the modal. Filling the resting state must not cost that.
   */
  it("keeps the decision's controls inline in the band", () => {
    // Given a notice with controls and a clock, in the shape the live band uses.
    const markup = renderToStaticMarkup(
      <GameLayout
        actionTray={<div>Actions</div>}
        attention={
          <AttentionNotice
            actions={
              <div data-slot="action-controls">
                <button type="button">Pay fine</button>
                <button type="button">Attempt roll</button>
              </div>
            }
            deadline={<div data-slot="game-turn-clock">Bar</div>}
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

    // Then both controls are in the band itself, after the clock, and nothing
    // about them is a dialog.
    const bandIndex = markup.indexOf('data-slot="game-attention-notice"');
    const clockIndex = markup.indexOf('data-slot="game-attention-deadline"');
    const controlsIndex = markup.indexOf('data-slot="action-controls"');
    expect(bandIndex).toBeGreaterThan(-1);
    expect(bandIndex).toBeLessThan(clockIndex);
    expect(clockIndex).toBeLessThan(controlsIndex);
    expect(markup).toContain("Pay fine");
    expect(markup).toContain("Attempt roll");
    expect(markup).not.toContain('role="dialog"');
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
  /**
   * `deadline` used to be a pre-formatted `"12:00:30"` — the output of a
   * `/T(\d{2}:\d{2}:\d{2})/` regex over `deadlineAt`, which is a TIMESTAMP and not
   * a countdown: it told a player the wall-clock instant their window closes and
   * left them to subtract, which is exactly what §12.3 says a bar exists to avoid.
   *
   * So this now pins the RAW pair leaving the derivation, which is strictly more
   * than the string was: the band cannot render §12.3's depleting bar without both
   * an instant and a budget, and a formatted string can carry neither honestly.
   */
  it("hands the band the raw deadline pair, never a formatted wall clock", () => {
    // Given
    const notice = createAttentionNotice({
      ...bootstrap,
      publicProjection: {
        ...game,
        deadlineAt: "2026-07-24T12:00:30.000Z",
        turnTimerDurationMs: 30_000,
      },
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
    expect(notice?.deadline).toEqual({
      deadlineAt: "2026-07-24T12:00:30.000Z",
      durationMs: 30_000,
      // A prompt in the band is by definition addressed to this viewer, so the
      // clock is theirs and the meter is toned for it.
      owner: "self",
      subject: "you",
      expiryNote: "At zero the server answers for you and the match continues.",
    });
    // And it is the pair, not a rendered clock face: a string here could carry
    // neither the budget the bar needs for its scale nor the instant it needs for
    // its end, which is why the regex went.
    expect(typeof notice?.deadline).toBe("object");
  });

  /**
   * A reaction window is the shortest clock in the game — seconds, not the turn's
   * minutes — and losing it is SILENT: the server closes it and the effect lands.
   * An unanswered prompt merely stalls the turn and keeps asking. So the window
   * outranks the prompt for the one always-visible slot.
   */
  it("puts an open reaction window ahead of a prompt, at its own budget", () => {
    // Given both are open at once, on a real gameplay bootstrap: the window's
    // budget lives in the frozen ruleset, so a payload without one has no scale.
    const full = gameplayBootstrap() as unknown as {
      readonly gameplay: { readonly rules: Record<string, unknown> };
    };
    const notice = createAttentionNotice({
      ...bootstrap,
      gameplay: {
        ...full.gameplay,
        rules: {
          ...full.gameplay.rules,
          interaction: {
            ...(full.gameplay.rules["interaction"] as Record<string, unknown>),
            reactionWindowSeconds: 8,
          },
        },
      },
      publicProjection: { ...game, deadlineAt: "2026-07-24T12:02:00.000Z" },
      reactions: [
        {
          id: "window-1",
          kind: "prevention",
          deadlineAt: "2026-07-24T12:00:09.000Z",
          hasPriority: true,
          hasPassed: false,
          hasPlayed: false,
        },
      ],
      legalActions: [
        {
          type: "prompt.respond",
          expectedRevision: 8,
          decisionPointId: "decision-1",
          kind: "audit-release",
          options: [{ id: "pay-fine" }],
        },
      ],
    } as unknown as GameBootstrap);

    // Then
    expect(notice?.label).toBe("Reaction");
    expect(notice?.tone).toBe("critical");
    expect(notice?.detail).toContain("closes on its own");
    // The budget is the FROZEN ruleset's window, not the turn timer's minutes:
    // ReactionProjection carries an instant and no duration, so without this the
    // bar would have an end and no scale.
    expect(notice?.deadline).toEqual({
      deadlineAt: "2026-07-24T12:00:09.000Z",
      durationMs: 8_000,
      owner: "self",
      subject: "you",
      expiryNote: "At zero the server answers for you and the match continues.",
    });
  });

  it("stops shouting about a window this viewer has already answered", () => {
    // Given a window the viewer passed on. It stays open for the other seats.
    const notice = createAttentionNotice({
      ...bootstrap,
      reactions: [
        {
          id: "window-1",
          kind: "prevention",
          deadlineAt: "2026-07-24T12:00:09.000Z",
          hasPriority: false,
          hasPassed: true,
          hasPlayed: false,
        },
      ],
    } as unknown as GameBootstrap);

    // Then — the window is no longer what the band is about. It drops back to
    // the resting line rather than to nothing, but the reaction's own critical
    // register and its 12:00:09 instant are gone from the row.
    expect(notice.label).not.toBe("Reaction");
    expect(notice.tone).not.toBe("critical");
    expect(notice.detail).not.toContain("closes on its own");
    expect(notice.deadline?.deadlineAt).not.toBe("2026-07-24T12:00:09.000Z");
  });

  /**
   * The defect this replaces: the derivation returned `null` whenever nothing was
   * being asked of anybody — which is most of a match — and the band then spent a
   * reserved 40px instrument row rendering the literal string "ATTENTION —".
   *
   * A watching player's actual question at rest is "what is the table waiting
   * for", and the answer is whose turn it is plus their clock. That was only
   * available in the rail head. The reservation is unchanged; what fills it is
   * the point of this test.
   */
  it("answers whose turn it is when nothing is being asked of anybody", () => {
    // Given the fixture's resting match: player-1 is both the viewer and the
    // active seat, with a real turn clock armed.
    const notice = createAttentionNotice({
      ...bootstrap,
      publicProjection: {
        ...game,
        deadlineAt: "2026-07-24T12:01:30.000Z",
        turnTimerDurationMs: 90_000,
      },
    } as unknown as GameBootstrap);

    // Then the band is never dead: one line, one answer.
    expect(notice).not.toBeNull();
    expect(notice.label).toBe("Your turn");
    expect(notice.detail).toBe("The table is waiting on you.");
    // Caution, not info: the table IS waiting on this viewer. It still ranks
    // below a real decision — see the priority test below.
    expect(notice.tone).toBe("caution");
    // And the clock is the turn's own canonical pair, so the band shows the same
    // deadline the rail head does rather than inventing a second one.
    expect(notice.deadline).toEqual({
      deadlineAt: "2026-07-24T12:01:30.000Z",
      durationMs: 90_000,
      owner: "self",
      subject: "you",
      expiryNote: "At zero the server rolls for you, so the table is never blocked.",
    });
  });

  /**
   * Own versus opponent is not satisfied by a name label (§12.1). Three
   * structural carriers change together here: the label word, the tone, and the
   * deadline's `owner` — which is what tones the bar itself. A self-toned (amber,
   * "this needs you") bar on a bot's turn would be precisely the noise the band
   * is supposed to remove.
   */
  it("names the opponent whose turn it is, in the opponent register", () => {
    // Given the other seat is active.
    const notice = createAttentionNotice({
      ...bootstrap,
      publicProjection: {
        ...game,
        activePlayerId: "player-2",
        deadlineAt: "2026-07-24T12:01:30.000Z",
        turnTimerDurationMs: 90_000,
      },
    } as unknown as GameBootstrap);

    // Then
    expect(notice.label).toBe("Turn");
    expect(notice.detail).toBe("Morgan is taking their turn.");
    expect(notice.tone).toBe("info");
    expect(notice.deadline).toEqual({
      deadlineAt: "2026-07-24T12:01:30.000Z",
      durationMs: 90_000,
      owner: "opponent",
      subject: "seat 2",
      expiryNote: "At zero the server rolls on their behalf, so the table is never blocked.",
    });
  });

  /**
   * The resting line is the LEAST urgent thing the band can say. It fills the row
   * when nothing is being asked; it never displaces something that is.
   */
  it("keeps a decision addressed to the viewer ahead of the resting turn line", () => {
    // Given it is this viewer's turn AND they have an open decision.
    const notice = createAttentionNotice({
      ...bootstrap,
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

    // Then the decision wins, and the resting copy is nowhere in the row.
    expect(notice.label).toBe("Decision");
    expect(notice.detail).toContain("waiting on you");
    expect(notice.detail).not.toContain("The table is waiting on you.");
  });

  /**
   * One line, one answer — not a second activity feed. The rail's Activity panel
   * is the feed; a band that started listing what just happened would be both a
   * duplicate and, in a 40px nowrap row, an ellipsised one.
   */
  it("gives the resting band one sentence, not a digest", () => {
    // Given a projection carrying committed events.
    const notice = createAttentionNotice(bootstrap as unknown as GameBootstrap);

    // Then the detail is a single sentence and mentions no event at all.
    expect(notice.detail.split(". ")).toHaveLength(1);
    expect(notice.detail.trim()).toBe(notice.detail);
    expect(notice.detail).not.toContain("\n");
    expect(notice.detail).not.toContain("TurnStarted");
  });

  /**
   * A clock nobody is on is not a proportion of anything, so these states report
   * the match's own state and arm no bar — rather than showing an empty lane that
   * looks like a stalled countdown.
   */
  it("reports the match's own state instead of a turn when no seat is on the clock", () => {
    // Given
    const paused = createAttentionNotice({
      ...bootstrap,
      publicProjection: { ...game, status: "paused" },
    } as unknown as GameBootstrap);
    const between = createAttentionNotice({
      ...bootstrap,
      publicProjection: { ...game, activePlayerId: null },
    } as unknown as GameBootstrap);
    const ended = createAttentionNotice({
      ...bootstrap,
      publicProjection: { ...game, status: "ended", winnerPlayerIds: ["player-2"] },
    } as unknown as GameBootstrap);

    // Then
    expect(paused.label).toBe("Paused");
    expect(paused.deadline).toBeNull();
    expect(between.label).toBe("Standing by");
    expect(between.deadline).toBeNull();
    expect(ended.label).toBe("Result");
    expect(ended.detail).toBe("Morgan took the match.");
    expect(ended.deadline).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */
/* The hub wiring.                                                           */
/*                                                                           */
/* Four waves built a game and none of it was reachable: the rail received    */
/* ONE panel entry, the client posted to the deprecated per-command aliases,  */
/* and the UI branched on two of the engine's thirty commands. These pin the  */
/* seams that closed that gap, because every one of them is invisible in the  */
/* markup of any single component and only shows up in the composition.       */
/* ------------------------------------------------------------------------- */

/**
 * A full-shaped `GameplayBootstrap`, built from the SHIPPED `mode.quick` ruleset
 * rather than a hand-written rules literal — a fixture ruleset would drift from
 * the one the match actually freezes, and every panel below reads `rules`.
 */
function gameplayBootstrap(overrides: Record<string, unknown> = {}): GameBootstrap {
  const rules = deadlineDashModes["mode.quick"].rules;

  return {
    ...bootstrap,
    gameplay: {
      rules,
      tileOwnership: [
        {
          tileId: "deadlineDash.board.tile.work1",
          ownerId: "player-1",
          level: 1,
          claimedAtRound: 1,
          tollPaidCount: 2,
        },
        {
          tileId: "deadlineDash.board.tile.hr",
          ownerId: "player-2",
          level: 0,
          claimedAtRound: 2,
          tollPaidCount: 0,
        },
      ],
      placements: [
        {
          id: "placement-public",
          kind: "placement.rumour",
          tileId: "deadlineDash.board.tile.hr",
          ownerId: "player-2",
          charges: 1,
          visibility: "public",
          placedAtRound: 2,
        },
      ],
      projects: [],
      agreements: [],
      objectives: [],
      ballots: [],
      quarters: [
        {
          index: 0,
          startedAtRound: 1,
          endsAtRound: 4,
          scheduledEventId: null,
          resolvedEventIds: [],
        },
      ],
      currentQuarterIndex: 0,
      eliminatedPlayerIds: [],
      players: [
        {
          playerId: "player-1",
          handCount: 0,
          heat: { value: 1, threshold: 5, investigationsOpened: 0, lastIncrementedAtRound: 2 },
          upkeep: { perRound: 100, lastChargedRound: 2, missedPayments: 0 },
          loans: [],
          incomeStreams: [],
        },
        {
          playerId: "player-2",
          handCount: 2,
          heat: { value: 0, threshold: 5, investigationsOpened: 0, lastIncrementedAtRound: null },
          upkeep: { perRound: 100, lastChargedRound: 2, missedPayments: 0 },
          loans: [],
          incomeStreams: [],
        },
      ],
      self: {
        ownPlacements: [
          {
            id: "placement-mine",
            kind: "placement.surveillance",
            tileId: "deadlineDash.board.tile.work1",
            ownerId: "player-1",
            charges: 1,
            visibility: "owner-only",
            placedAtRound: 2,
            data: {},
          },
        ],
        agreements: [],
        objectives: [],
        sabotage: [],
        ballotCasts: {},
        freeActionsRemaining: 1,
      },
      scores: [],
      winPath: null,
      endReason: null,
    },
    ...overrides,
  } as unknown as GameBootstrap;
}

describe("rail composition", () => {
  /**
   * The measured failure this wave exists to fix: the rail hosts twelve
   * destinations and `game-client.tsx` passed exactly one (`feed`). Eleven
   * surfaces the panel kit had already built rendered their empty state forever
   * while a fully populated `gameplay` block sat unread on the bootstrap.
   */
  it("fills all twelve destinations, not one", () => {
    // Given
    const ready = asGameplayBootstrap(gameplayBootstrap());
    expect(ready).not.toBeNull();
    if (ready === null) return;

    // When
    const panels = buildRailPanels({
      actions: ready.legalActions,
      cardFeed: <div data-slot="card-feed">Card</div>,
      chat: <div data-slot="chat-body">Chat</div>,
      context: createActionContext(ready),
      data: derivePanelData({ bootstrap: ready }),
      failure: null,
      onSubmit: vi.fn(),
      pending: null,
    });

    // Then — one entry per rail destination, and every id is a real one.
    expect(panels).toHaveLength(Object.keys(RAIL_DESTINATIONS).length);
    expect(panels).toHaveLength(12);
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(12);
    for (const id of Object.keys(RAIL_DESTINATIONS)) {
      expect(panels.some((panel) => panel.id === id)).toBe(true);
    }
  });

  /**
   * A destination with no data must still teach rather than lie. The rail's own
   * resting copy is the fallback, and it is reached by CONTRIBUTING nothing for
   * that destination rather than by contributing an empty body.
   */
  it("keeps every destination resting when the server ships no gameplay block", () => {
    // Given a v1 bootstrap — no `gameplay` key at all.
    expect(asGameplayBootstrap(bootstrap)).toBeNull();

    // When
    const panels = buildRailPanels({
      actions: [],
      cardFeed: <div data-slot="card-feed">Card</div>,
      chat: <div data-slot="chat-body">Chat</div>,
      context: createActionContext(bootstrap),
      data: null,
      failure: null,
      onSubmit: vi.fn(),
      pending: null,
    });

    // Then — only the two destinations that do not need it.
    expect(panels.map((panel) => panel.id)).toEqual(["feed", "chat"]);

    // And the rail still renders all twelve frames with their teaching copy.
    const markup = renderToStaticMarkup(
      <TurnRail game={game} panels={panels} room={room} selfPlayerId="player-1" />,
    );
    expect(markup.match(/data-slot="rail-panel"/g) ?? []).toHaveLength(12);
    expect(markup).toContain("No projects on the floor yet.");
    expect(markup).toContain('data-slot="chat-body"');
  });

  /**
   * `RailPanel` already draws a 28px header, so each kit panel is mounted
   * `chrome="none"`. Two headers in one region is a visible defect, and two
   * `<h2>`s in one labelled section breaks the one-heading rule (§2.2).
   */
  it("mounts panels chromeless so the rail's own header is the only one", () => {
    // Given
    const ready = asGameplayBootstrap(gameplayBootstrap());
    if (ready === null) throw new Error("fixture is not a gameplay bootstrap");

    // When
    const markup = renderToStaticMarkup(
      <TurnRail
        game={game}
        panels={buildRailPanels({
          actions: ready.legalActions,
          cardFeed: null,
          chat: null,
          context: createActionContext(ready),
          data: derivePanelData({ bootstrap: ready }),
          failure: null,
          onSubmit: vi.fn(),
          pending: null,
        })}
        room={room}
        selfPlayerId="player-1"
      />,
    );

    // Then — the kit's own panel chrome never appears inside the rail.
    expect(markup).not.toContain('data-slot="panel-head"');
    expect(markup).not.toContain('data-slot="panel"');
    // One heading per rail panel, and they are the RAIL's.
    expect(markup.match(/<h2 /g) ?? []).toHaveLength(12);
    // And real derived rows arrived: the roster carries both seats' economy.
    expect(markup).toContain("Morgan");
  });

  /**
   * A defect a browser found and no unit test could: mounting kit panels
   * `chrome="none"` drops the kit's own `.panel-body`, which is the element that
   * made a panel's content scroll inside itself. Exactly one block per group is
   * `flex: 1 1 auto` with `min-height: 0`, so at a 240px stacked rail the Hand
   * block measured **0px tall while 162px of its content painted over the Projects
   * panel underneath** — both panels' prose overlapping, neither readable.
   *
   * Two rules fixed it and both are pinned here, because the regression is
   * silent: content that escapes its panel still renders, it just renders on top
   * of the next one.
   */
  it("gives every contributed destination its own scroll box and a floor", () => {
    // Given
    const ready = asGameplayBootstrap(gameplayBootstrap());
    if (ready === null) throw new Error("fixture is not a gameplay bootstrap");
    const markup = renderToStaticMarkup(
      <TurnRail
        game={game}
        panels={buildRailPanels({
          actions: ready.legalActions,
          cardFeed: null,
          chat: null,
          context: createActionContext(ready),
          data: derivePanelData({ bootstrap: ready }),
          failure: null,
          onSubmit: vi.fn(),
          pending: null,
        })}
        room={room}
        selfPlayerId="player-1"
      />,
    );

    // Then — one scroll box per filled destination.
    expect((markup.match(/data-slot="rail-panel-body"/g) ?? []).length).toBeGreaterThan(0);

    // And it really clips: `overflow-y` plus a zero `min-height` so it yields the
    // header's space rather than pushing the panel taller.
    const body = cssRule(shellSheet, '.game-shell-rail [data-slot="rail-panel-body"]');
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("min-height: 0");
    expect(body).toContain("flex: 1 1 auto");

    // And the growing block keeps a floor, so it cannot reach zero at all. The
    // group is the thing that scrolls (hud.css calls it the safety valve).
    const grow = cssRule(shellSheet, '.game-shell-rail [data-slot="rail-panel"][data-grow="true"]');
    expect(grow).toContain("min-height: 84px");
    expect(grow).toContain("overflow: hidden");
    expect(cssRule(hudSheet, ".hud-rail-group")).toContain("overflow-y: auto");
  });

  /**
   * §12.3: "tab badges for everything else, with a count." A zero is never
   * synthesised — an attention affordance that is always present stops meaning
   * anything — so a destination with nothing waiting contributes no badge.
   */
  it("badges only destinations that are genuinely waiting on the viewer", () => {
    // Given a table with nothing open.
    const ready = asGameplayBootstrap(gameplayBootstrap());
    if (ready === null) throw new Error("fixture is not a gameplay bootstrap");

    // When
    const panels = buildRailPanels({
      actions: ready.legalActions,
      cardFeed: null,
      chat: null,
      context: createActionContext(ready),
      data: derivePanelData({ bootstrap: ready }),
      failure: null,
      onSubmit: vi.fn(),
      pending: null,
    });

    // Then
    for (const panel of panels) {
      expect(panel.attention?.count ?? 1).toBeGreaterThan(0);
    }
  });

  /**
   * A legal rail command is itself a reason to open a tab, so the registry's own
   * per-panel count is the fallback badge where the derivation has nothing to say.
   */
  it("badges a panel holding a legal command the derivation did not flag", () => {
    // Given a legal `project.start`, which the registry places in `projects`.
    const ready = asGameplayBootstrap(
      gameplayBootstrap({
        legalActions: [
          { type: "turn.roll", expectedRevision: 8 },
          {
            type: "project.start",
            expectedRevision: 8,
            definitions: [],
            maxConcurrent: 2,
            openSlots: 2,
          },
        ],
      }),
    );
    if (ready === null) throw new Error("fixture is not a gameplay bootstrap");

    // When
    const panels = buildRailPanels({
      actions: ready.legalActions,
      cardFeed: null,
      chat: null,
      context: createActionContext(ready),
      data: derivePanelData({ bootstrap: ready }),
      failure: null,
      onSubmit: vi.fn(),
      pending: null,
    });

    // Then
    const projects = panels.find((panel) => panel.id === "projects");
    expect(projects?.attention).toEqual({ count: 1, tone: "info" });
  });
});

describe("command transport", () => {
  /**
   * §11.1 keys idempotency on `commandId`, and that is only reachable if a RETRY
   * re-sends the same id. The two routes this replaced minted a fresh
   * `crypto.randomUUID()` at each call site, which is the same as having no key at
   * all — every retry was a second apply.
   */
  it("reuses one command id for one intent, so a retry is deduplicated", () => {
    // Given
    const ledger = new Map<string, string>();
    const draft = { type: "turn.roll", expectedRevision: 8 } as const;

    // When the same intent is submitted twice.
    const first = reserveCommandId(ledger, draft);
    const second = reserveCommandId(ledger, { ...draft });

    // Then
    expect(second).toBe(first);
    expect(ledger.size).toBe(1);
  });

  it("mints a new id for a different amount, a different target or a new revision", () => {
    // Given
    const ledger = new Map<string, string>();
    const base = {
      type: "project.contribute",
      expectedRevision: 8,
      projectId: "project-1",
      money: 100,
      work: 0,
    } as const;

    // When
    const original = reserveCommandId(ledger, base);
    const biggerAmount = reserveCommandId(ledger, { ...base, money: 200 });
    const otherProject = reserveCommandId(ledger, { ...base, projectId: "project-2" });
    const nextRevision = reserveCommandId(ledger, { ...base, expectedRevision: 9 });

    // Then — four distinct intents, four ids.
    expect(new Set([original, biggerAmount, otherProject, nextRevision]).size).toBe(4);
  });

  /**
   * `JSON.stringify` preserves insertion order, so two controls building the same
   * payload with their fields in a different order would look like two intents and
   * defeat the whole mechanism.
   */
  it("keys the intent on field VALUES, not on field order", () => {
    expect(
      commandIntentKey({
        type: "ballot.cast",
        expectedRevision: 8,
        ballotId: "ballot-1",
        value: 5,
      } as never),
    ).toBe(
      commandIntentKey({
        value: 5,
        ballotId: "ballot-1",
        expectedRevision: 8,
        type: "ballot.cast",
      } as never),
    );
  });

  /**
   * §11.1: "the client must be able to render a refusal without knowing which
   * command it was." The status carries the meaning; WHERE the message appears
   * carries which command it was.
   */
  it("states a refusal per status, and names no command", () => {
    // Given / When / Then
    expect(refusalMessage(409)).toContain("Somebody committed first");
    expect(refusalMessage(403)).toContain("not yours to do");
    expect(refusalMessage(401)).toContain("session expired");
    expect(refusalMessage(503)).toContain("accept a retry");
    for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
      expect(refusalMessage(status).length).toBeGreaterThan(0);
      expect(refusalMessage(status)).not.toMatch(/turn\.|ballot\.|project\./);
    }
  });
});

describe("board territory and identity", () => {
  /**
   * "Player photos on tokens were explicitly requested. `avatarUrl` shipped in
   * contracts. There are zero references to it anywhere under board/." This is the
   * one field that closes that: the token already looks the member up for its
   * display name.
   */
  it("carries each seat's photo onto its token", () => {
    // Given a member with a photo the server vouched for.
    const withPhoto = {
      ...bootstrap,
      room: {
        ...room,
        members: [
          { ...room.members[0], avatarUrl: "https://example.test/avery.png" },
          room.members[1],
        ],
      },
    } as unknown as GameBootstrap;

    // When
    const view = createGameView(withPhoto);

    // Then
    expect(view.players.find((player) => player.id === "player-1")?.avatarUrl).toBe(
      "https://example.test/avery.png",
    );
    // A member with none resolves to null, not undefined: the token draws its
    // initial fallback rather than an empty face cell.
    expect(view.players.find((player) => player.id === "player-2")?.avatarUrl).toBeNull();
  });

  /**
   * §12.4: ownership and placements must be legible ON THE BOARD — "a territory
   * game you can only read in a sidebar is not a board game."
   */
  it("resolves ownership to the 1..6 turn slot, never the zero-based seat", () => {
    // Given
    const ready = asGameplayBootstrap(gameplayBootstrap());
    if (ready === null) throw new Error("fixture is not a gameplay bootstrap");

    // When
    const owned = createOwnershipViews(ready);

    // Then — `PublicPlayerProjection.seat` is the engine's zero-based `order`;
    // reading it directly is what dropped the seat-0 player off the board once.
    expect(owned).toHaveLength(2);
    expect(owned[0]).toEqual({
      tileId: "deadlineDash.board.tile.work1",
      ownerSeat: 1,
      ownerName: "Avery",
      level: 1,
      isSelf: true,
    });
    expect(owned[1]?.ownerSeat).toBe(2);
    expect(owned[1]?.isSelf).toBe(false);
  });

  /**
   * The two placement lists are concatenated and NOTHING is filtered: another
   * player's `owner-only` placement is absent from this viewer's payload already,
   * so reconstructing the full set here in order to hide half of it would put the
   * hidden half back into the DOM.
   */
  it("merges public and own placements without re-deriving anybody else's", () => {
    // Given
    const ready = asGameplayBootstrap(gameplayBootstrap());
    if (ready === null) throw new Error("fixture is not a gameplay bootstrap");

    // When
    const placements = createPlacementViews(ready);

    // Then
    expect(placements.map((placement) => placement.id)).toEqual([
      "placement-public",
      "placement-mine",
    ]);
    expect(placements[1]?.visibility).toBe("owner-only");
    expect(placements[1]?.isSelf).toBe(true);
    // And no `data` field rode along: a surveillance placement's findings are the
    // one thing on a placement that must never reach a shared surface.
    expect(JSON.stringify(placements)).not.toContain("data");
  });

  /**
   * The gutter is reserved for the whole match from the RULESET, not from whether
   * anything is claimed yet — derived from the state of play, the first claim of a
   * game would reflow the room name on all 44 tiles.
   */
  it("reads the territory gutter off the frozen ruleset, not the state of play", () => {
    // Given a match with an empty board but ownership switched on.
    const ready = asGameplayBootstrap(
      gameplayBootstrap({
        gameplay: {
          ...(gameplayBootstrap() as unknown as { gameplay: Record<string, unknown> })
            .gameplay,
          tileOwnership: [],
          placements: [],
        },
      }),
    );
    if (ready === null) throw new Error("fixture is not a gameplay bootstrap");

    // Then
    expect(createOwnershipViews(ready)).toHaveLength(0);
    expect(hasTerritory(ready)).toBe(
      deadlineDashModes["mode.quick"].rules.board.ownershipEnabled ||
        deadlineDashModes["mode.quick"].rules.board.placementsEnabled,
    );
  });

  /**
   * `ActionContext.spendable.work` is the `work-counter` key, not `work`. Reading
   * `work` would silently give every sabotage and contribution ceiling a zero, so
   * the UI would disable controls the engine would have accepted with nothing
   * anywhere reporting why.
   */
  it("prices controls from the viewer's own balances, under the real keys", () => {
    // Given
    const withWork = {
      ...bootstrap,
      publicProjection: {
        ...game,
        players: [
          {
            ...game.players[0],
            resources: { money: 1_200, reputation: 2, energy: 4, "work-counter": 6 },
          },
          game.players[1],
        ],
      },
    } as unknown as GameBootstrap;

    // When
    const context = createActionContext(withWork);

    // Then
    expect(context.spendable).toEqual({ money: 1_200, energy: 4, work: 6 });
    // Public identity only: a name and a slot, and no seat's balances but the
    // viewer's own — `ActionContext` has nowhere to put another player's money.
    expect(context.seats).toEqual([
      { playerId: "player-1", name: "Avery", seat: 1 },
      { playerId: "player-2", name: "Morgan", seat: 2 },
    ]);
    expect(JSON.stringify(context.seats)).not.toContain("900");
  });
});

describe("action surfaces", () => {
  /**
   * The turn lane replaces the legacy roll button rather than sitting beside it:
   * two Roll controls in one bar would submit two different command ids for one
   * intent, which is precisely what idempotency by `commandId` exists to prevent.
   */
  it("hands the turn lane the roll, and never renders two of them", () => {
    // Given
    const markup = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        commands={<div data-slot="action-controls">Lane</div>}
        isRolling={false}
        onRoll={vi.fn()}
        rollError={null}
      />,
    );

    // Then
    expect(markup).toContain('data-slot="action-controls"');
    expect(markup).not.toContain('data-slot="action-tray-roll"');
    // The status lane is untouched: it still says whose move it is, in words.
    expect(markup).toContain('data-slot="action-tray-ready"');
  });

  /**
   * The board must not move when a command becomes legal. The lane is a
   * fixed-height track with a resting readout, so the tray's structure is the same
   * whether or not anything is legal — the regression this guards against is a
   * conditional row coming back to the action region.
   */
  it("keeps the tray's structure identical whether the lane is empty or full", () => {
    // Given
    const empty = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Morgan"
        canRoll={false}
        commands={<div data-slot="action-controls" data-empty="true" />}
        isRolling={false}
        onRoll={vi.fn()}
        rollError={null}
      />,
    );
    const full = renderToStaticMarkup(
      <ActionTray
        activePlayerName="Avery"
        canRoll
        commands={<div data-slot="action-controls" data-empty="false" />}
        isRolling={false}
        onRoll={vi.fn()}
        rollError={null}
      />,
    );

    // Then — same regions, same order, in both.
    for (const markup of [empty, full]) {
      expect(markup).toContain('data-slot="action-tray-lane"');
      expect(markup).toContain('data-slot="action-controls"');
      expect(markup).toContain('data-slot="dice-readout"');
    }
    // And the lane declares a definite height rather than growing with content.
    const bar = cssRule(actionsSheet, ".actions-bar");
    expect(bar).toContain("height: var(--actions-bar-height)");
    expect(bar).not.toContain("min-height");
    expect(cssRule(actionsSheet, ".actions-lane")).toContain("overflow-x: auto");
  });

  /**
   * The band is a single 40px instrument row. A decision cluster arriving in it
   * must not wrap, because wrapping grows the row and the board moves — the exact
   * defect the band's definite height exists to prevent.
   */
  it("keeps the decision cluster on one non-wrapping row inside the band", () => {
    // Given
    const cluster = cssRule(actionsSheet, ".game-shell-attention .actions-group");

    // Then
    expect(cluster).toContain("flex-wrap: nowrap");
    expect(cluster).toContain("padding-block: 0");
    // And the band's own row is still fixed at 40px, occupied or not.
    expect(shellSheet).toContain("--game-shell-attention: 40px");
  });

  /**
   * §12.3's one sanctioned continuous animation, hosted where the shortest clock
   * in the game actually is. It must degrade to discrete steps under reduced
   * motion rather than vanishing — a window with no visible clock is worse than
   * one that steps.
   */
  it("hosts a depleting bar in the band, not a number, and steps it under reduced motion", () => {
    // Given the band with an instrument in its deadline slot.
    const markup = renderToStaticMarkup(
      <GameLayout
        actionTray={<div>Actions</div>}
        attention={
          <AttentionNotice
            actions={<div data-slot="action-controls">Play</div>}
            deadline={<div data-slot="game-turn-clock">Bar</div>}
            detail="An effect is about to land."
            label="Reaction"
            tone="critical"
          />
        }
        board={<div>Board</div>}
        hud={<div>HUD</div>}
        turnRail={<div>Rail</div>}
      />,
    );

    // Then — the band hosts both, and interrupts nothing.
    expect(markup).toContain('data-slot="game-attention-deadline"');
    expect(markup).toContain('data-slot="game-turn-clock"');
    expect(markup).toContain('data-slot="action-controls"');
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("aria-modal");

    // And the meter's motion is a real animation with a reduced-motion fallback
    // that STEPS rather than removing it (hud.css owns the instrument).
    expect(hudSheet).toContain("animation-name: hud-clock-deplete");
    expect(hudSheet).toMatch(/prefers-reduced-motion[\s\S]*?steps\(\d+, end\)/);
  });

  /**
   * The rail no longer prints a wall-clock instant in its own head. That string
   * was a `/T(\d{2}:\d{2}:\d{2})/` slice of `deadlineAt` — a timestamp, not a
   * countdown — and the HUD header above already carries the real bar. The LANE
   * stays reserved so an instrument arriving in it cannot shove the state text.
   */
  it("keeps the rail's clock lane reserved without printing a wall clock in it", () => {
    // Given
    const markup = renderToStaticMarkup(
      <TurnRail
        game={{ ...game, deadlineAt: "2026-07-24T12:00:30.000Z", turnTimerDurationMs: 30_000 }}
        room={room}
        selfPlayerId="player-1"
      />,
    );

    // Then
    expect(markup).toContain('data-slot="rail-turn-clock"');
    expect(markup).not.toContain("12:00:30");
    // It states where the match is instead, in the unit every rail panel's
    // deadlines are counted in (§12.4 — panels state deadlines in ROUNDS).
    expect(markup).toContain("R2 · T4");
    expect(cssRule(hudSheet, ".hud-wait-clock")).toContain("min-width: 60px");
  });

  /**
   * Two stylesheets the wired-up rail depends on were never imported, so the
   * whole panel kit and the whole action layer would have rendered unstyled — the
   * failure mode is not "slightly plain", it is a rail with no definite panel
   * floors and a command lane with no definite height, which is a board that
   * moves.
   */
  it("imports the panel and action stylesheets, or none of this has geometry", () => {
    expect(globalsSheet).toContain('@import "./panels.css"');
    expect(globalsSheet).toContain('@import "./actions.css"');
    // They must stay in the leading @import block: CSS `@import` is only legal
    // before other rules.
    const firstRule = globalsSheet.indexOf("@custom-variant");
    expect(globalsSheet.indexOf('@import "./actions.css"')).toBeLessThan(firstRule);
    expect(globalsSheet.indexOf('@import "./panels.css"')).toBeLessThan(firstRule);
  });

  it("lets a host put a real instrument in that lane", () => {
    // Given
    const markup = renderToStaticMarkup(
      <TurnRail
        clock={<span data-slot="rail-meter">Meter</span>}
        game={game}
        room={room}
        selfPlayerId="player-1"
      />,
    );

    // Then
    expect(markup).toContain('data-slot="rail-turn-clock"');
    expect(markup).toContain('data-slot="rail-meter"');
    expect(markup).not.toContain("R2 · T4");
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
