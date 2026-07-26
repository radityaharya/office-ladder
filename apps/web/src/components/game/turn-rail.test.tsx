import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  PublicGameProjection,
  PublicPlayerProjection,
  RoomMemberProjection,
  RoomProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";

import {
  ActivityLog,
  buildActivityLog,
  formatDelta,
  playerName,
  rankLabel,
  resolveTurnState,
  seatSlot,
  TurnRail,
} from "./turn-rail";

function member(overrides: Partial<RoomMemberProjection> = {}): RoomMemberProjection {
  return {
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
    ...overrides,
  };
}

function player(overrides: Partial<PublicPlayerProjection> = {}): PublicPlayerProjection {
  return {
    id: "player-1",
    seat: 0,
    connected: true,
    position: 6,
    lapsCompleted: 0,
    rank: { id: "rank.intern", kind: "rank.intern", index: 0 },
    role: { revealed: false },
    resources: { money: 1_200, reputation: 2, energy: 4, "work-counter": 3 },
    tokens: {},
    statusIds: [],
    ...overrides,
  };
}

const room = {
  id: "room-1",
  code: "Q4W8ZT",
  status: "active",
  mode: "mode.quick",
  capacity: 4,
  revision: 5,
  members: [
    member(),
    member({
      id: "player-2",
      displayName: "Ada",
      seat: 1,
      isHost: false,
      isBot: true,
      botDifficulty: "ruthless",
      avatarUrl: null,
      characterId: null,
      characterLabel: null,
    }),
    member({ id: "player-3", displayName: "Morgan", seat: 2, isHost: false, isConnected: false }),
  ],
} satisfies RoomProjection;

const diceEvent = {
  id: "event-dice",
  type: "DiceRolled",
  revision: 9,
  occurredAt: "2026-07-24T12:00:05.000Z",
  actorPlayerId: "player-1",
  dice: [4],
  total: 4,
  purpose: "normal-movement",
} satisfies SafeEventSummary;

const game = {
  id: "game-1",
  revision: 9,
  status: "active",
  activePlayerId: "player-1",
  turnNumber: 4,
  round: 2,
  phase: "awaiting-roll",
  deadlineAt: null,
  turnTimerDurationMs: null,
  players: [
    player(),
    player({ id: "player-2", position: 12, resources: { money: 900 } }),
    player({ id: "player-3", connected: false, position: 3, resources: { money: 700 } }),
  ],
  eventSummaries: [
    {
      id: "event-turn",
      type: "TurnStarted",
      revision: 8,
      occurredAt: "2026-07-24T12:00:00.000Z",
      actorPlayerId: "player-1",
    },
    diceEvent,
  ],
  winnerPlayerIds: [],
} satisfies PublicGameProjection;

function rail(overrides: Partial<Parameters<typeof TurnRail>[0]> = {}): string {
  return renderToStaticMarkup(
    <TurnRail game={game} room={room} selfPlayerId="player-1" {...overrides} />,
  );
}

describe("turn rail dossier", () => {
  it("renders one row per player with hairline separation and no floating card chrome", () => {
    // Given
    const markup = rail();

    // When
    const rows = markup.match(/data-slot="turn-rail-seat"/g) ?? [];

    // Then
    expect(rows).toHaveLength(3);
    expect(markup).toContain('class="hud-rail"');
    expect(markup).not.toContain("rounded-2xl");
    expect(markup).not.toContain("shadow-");
    expect(markup).not.toContain("backdrop-blur");
  });

  it("marks the active player with an ACTIVE tag on that row only", () => {
    // Given
    const markup = rail();

    // When
    const tags = markup.match(/data-slot="turn-rail-active-tag"/g) ?? [];
    const activeRowIndex = markup.indexOf("hud-seat-row--active");
    const tagIndex = markup.indexOf('data-slot="turn-rail-active-tag"');

    // Then
    expect(tags).toHaveLength(1);
    expect(markup).toContain(">Active</span>");
    expect(activeRowIndex).toBeGreaterThan(-1);
    expect(activeRowIndex).toBeLessThan(tagIndex);
    // The accent rule and tag carry the state — never a glow or pulse-loop.
    expect(markup).not.toContain("animate-pulse");
    expect(markup).not.toContain("blur");
  });

  it("marks bot seats with a dry uppercase tag carrying their difficulty", () => {
    // Given
    const markup = rail();

    // Then
    expect(markup).toContain('data-slot="turn-rail-bot-tag"');
    expect(markup).toContain("Bot · Ruthless");
  });

  it("keeps human connection state as a text label beside its LED", () => {
    // Given
    const markup = rail();

    // Then
    expect(markup).toContain("Online");
    expect(markup).toContain("Away");
    expect(markup).toContain("hud-led--away");
  });

  it("states plainly who the game is waiting on so a bot turn never looks frozen", () => {
    // Given
    const botTurn = { ...game, activePlayerId: "player-2" } satisfies PublicGameProjection;

    // When
    const markup = rail({ game: botTurn });

    // Then
    expect(markup).toContain('data-slot="turn-rail-turn-state"');
    expect(markup).toContain("Waiting on Ada · Bot Ruthless");
    expect(markup).toContain('data-tone="remote"');
  });

  it("identifies seats by colour plus a numeric glyph, never colour alone", () => {
    // Given
    const markup = rail();

    // Then
    expect(markup).toContain("hud-seat-1");
    expect(markup).toContain("hud-seat-2");
    expect(markup).toContain("hud-seat-3");
    expect(markup).toContain("Avery (you)");
  });

  it("exposes each seat number to assistive tech, not only as a hidden glyph", () => {
    // Given — the glyph itself is aria-hidden, so colour would be the only
    // remaining identity carrier if the number were not also read out (§8).
    const markup = rail();

    // Then
    expect(markup).toContain('<span class="sr-only">Seat 1.</span>');
    expect(markup).toContain('<span class="sr-only">Seat 2.</span>');
    expect(markup).toContain('<span class="sr-only">Seat 3.</span>');
  });
});

describe("activity log", () => {
  it("logs a real die face from the DiceRolled event rather than 'rolled the dice'", () => {
    // Given
    const markup = rail();

    // Then
    expect(markup).toContain("Avery rolled 4.");
    expect(markup).not.toContain("rolled the dice");
  });

  it("renders however many faces the event actually carries", () => {
    // Given — only the audit-release response rolls 2d6.
    const auditRoll = {
      ...diceEvent,
      id: "event-audit",
      dice: [3, 3],
      total: 6,
      purpose: "audit-release",
    } satisfies SafeEventSummary;

    // When
    const entries = buildActivityLog({ ...game, eventSummaries: [auditRoll] }, room);

    // Then
    expect(entries[0]?.text).toBe("Avery rolled 3 + 3 for 6 to leave audit review.");
  });

  it("puts the newest entry first and stamps each row with a mono UTC timestamp", () => {
    // Given
    const markup = rail();

    // When
    const rows = markup.match(/data-slot="turn-rail-activity"/g) ?? [];
    const diceIndex = markup.indexOf("Avery rolled 4.");
    const turnIndex = markup.indexOf("Avery started their turn.");

    // Then
    expect(rows).toHaveLength(2);
    expect(diceIndex).toBeLessThan(turnIndex);
    expect(markup).toContain(">12:00:05</time>");
    expect(markup).toContain('dateTime="2026-07-24T12:00:05.000Z"');
  });

  it("renders a supplied resource delta in mono with an explicit sign", () => {
    // Given
    const gains = rail({ deltas: [{ eventId: "event-dice", amount: 120 }] });
    const losses = rail({ deltas: [{ eventId: "event-dice", amount: -40, unit: "energy" }] });

    // Then
    expect(gains).toContain('data-slot="turn-rail-activity-delta"');
    expect(gains).toContain(">+120</span>");
    expect(gains).toContain("hud-log-delta--gain");
    expect(losses).toContain(">-40 energy</span>");
    expect(losses).toContain("hud-log-delta--loss");
  });

  it("lets the feedback layer replace the derived sentence for an event", () => {
    // Given
    const markup = rail({
      deltas: [{ eventId: "event-dice", amount: 50, text: "Avery banked a work bonus." }],
    });

    // Then
    expect(markup).toContain("Avery banked a work bonus.");
    expect(markup).toContain(">+50</span>");
  });

  it("degrades an unknown event type to a readable line instead of a blank row", () => {
    // Given
    const mystery = {
      id: "event-mystery",
      type: "QuarterlyReviewScheduled",
      revision: 11,
      occurredAt: "2026-07-24T12:01:00.000Z",
      actorPlayerId: "player-3",
    } as unknown as SafeEventSummary;

    // When
    const entries = buildActivityLog({ ...game, eventSummaries: [mystery] }, room);

    // Then
    expect(entries[0]?.text).toBe("Morgan triggered quarterly review scheduled.");
  });

  it("attributes an actorless event to the office rather than an empty name", () => {
    // Given
    const systemEvent = {
      id: "event-system",
      type: "MatchEnded",
      revision: 12,
      occurredAt: "2026-07-24T12:02:00.000Z",
      actorPlayerId: null,
    } satisfies SafeEventSummary;

    // When
    const entries = buildActivityLog({ ...game, eventSummaries: [systemEvent] }, room);

    // Then
    expect(entries[0]?.text).toBe("The office closed out the match.");
  });

  it("shows an explicit resting state when nothing has been committed yet", () => {
    // Given
    const markup = renderToStaticMarkup(<ActivityLog entries={[]} />);

    // Then
    expect(markup).toContain("No entries committed yet.");
    expect(markup).toContain('role="log"');
  });

  it("falls back to a placeholder clock when the timestamp is unparseable", () => {
    // Given
    const markup = renderToStaticMarkup(
      <ActivityLog
        entries={[
          { id: "e1", revision: 1, occurredAt: "not-a-date", text: "Something happened.", delta: null },
        ]}
      />,
    );

    // Then
    expect(markup).toContain("--:--:--");
  });
});

describe("activity log readability (P4)", () => {
  /*
   * The log is how a player follows the match, and in a 320px rail every line
   * used to end in an ellipsis ("Contract Auditor had resource…"). Nothing about
   * wrapping is observable in a `renderToStaticMarkup` string, so the two halves
   * are pinned separately: the markup test proves the prose is a wrapping inline
   * run inside `.hud-log-body` (not a nowrap grid cell), and the stylesheet test
   * proves the clipping declarations have not come back.
   */
  const stylesheet = readFileSync(
    fileURLToPath(new URL("../../styles/hud.css", import.meta.url)),
    "utf8",
  );

  function cssRule(selector: string): string {
    const start = stylesheet.indexOf(`${selector} {`);
    expect(start, `${selector} is missing from hud.css`).toBeGreaterThan(-1);
    return stylesheet.slice(start, stylesheet.indexOf("}", start));
  }

  it("puts the sentence in a wrapping body run rather than a fixed cell", () => {
    // Given
    const markup = rail();

    // Then
    expect(markup).toContain('<span class="hud-log-body">');
    // A `title` would be a hover-only affordance (§8); it existed only to
    // recover text the row had clipped, and there is nothing left to recover.
    expect(markup).not.toContain('data-slot="turn-rail-activity" title=');
  });

  it("keeps the log row free of the declarations that truncated it", () => {
    // Given
    const text = cssRule(".hud-log-text");

    // Then
    expect(text).toContain("overflow-wrap");
    expect(text).not.toContain("white-space: nowrap");
    expect(text).not.toContain("text-overflow");
  });

  it("still holds §6.3's compact 28px density as the row floor", () => {
    // Given — wrapping is allowed to grow a row; it must not inflate every row.
    const row = cssRule(".hud-log-row");

    // Then
    expect(row).toContain("min-height: 28px");
    expect(row).not.toMatch(/[^-]height: 28px;/);
  });

  it("wraps the turn-state notice instead of clipping the bot it names", () => {
    // Given
    const text = cssRule(".hud-wait-text");

    // Then
    expect(text).toContain("overflow-wrap");
    expect(text).not.toContain("text-overflow");
  });
});

describe("activity log mine-vs-theirs split", () => {
  it("stamps the viewer's own rows with a text marker, not colour alone", () => {
    // Given
    const markup = rail();

    // When
    const row = markup.slice(markup.indexOf('data-origin="local"'));

    // Then — carrier 1: the `You` stamp. Carrier 2: the tonal step keyed off
    // `data-origin`. Carrier 3: the seat-coloured rule keyed off `hud-seat-1`.
    expect(markup).toContain('data-origin="local"');
    expect(row).toContain(">You</span>");
    expect(row).toContain('<span class="sr-only">Your action.</span>');
    expect(markup).toContain('class="hud-log-row hud-seat-1"');
  });

  it("stamps an opponent's rows with their seat number instead", () => {
    // Given — Ada holds seat 2, so her rows read `S2`, matching her board token
    // and her dossier glyph rather than asking the player to learn a colour.
    const markup = rail({
      game: {
        ...game,
        eventSummaries: [{ ...diceEvent, id: "event-ada", actorPlayerId: "player-2" }],
      },
    });

    // Then
    expect(markup).toContain('data-origin="remote"');
    expect(markup).toContain(">S2</span>");
    expect(markup).toContain('class="hud-log-row hud-seat-2"');
    // No "Your action." on someone else's row.
    expect(markup).not.toContain("Your action.");
  });

  it("distinguishes the viewer, an opponent and the office in one stream", () => {
    // Given
    const mixed = {
      ...game,
      eventSummaries: [
        { ...diceEvent, id: "mine", actorPlayerId: "player-1" },
        { ...diceEvent, id: "theirs", actorPlayerId: "player-2" },
        { ...diceEvent, id: "office", actorPlayerId: null },
      ] satisfies SafeEventSummary[],
    } satisfies PublicGameProjection;

    // When
    const entries = buildActivityLog(mixed, room, [], "player-1");

    // Then
    expect(entries.map((entry) => entry.origin)).toEqual(["local", "remote", "system"]);
    expect(entries.map((entry) => entry.slot)).toEqual([1, 2, undefined]);
  });

  it("marks nothing as the viewer's when no viewer is supplied", () => {
    // Given — the match report renders the same log with no seat context.
    const entries = buildActivityLog(game, room);

    // Then
    expect(entries.every((entry) => entry.origin !== "local")).toBe(true);
  });

  it("renders an unknown-provenance entry without inventing an owner", () => {
    // Given — a hand-built entry carries no origin at all.
    const markup = renderToStaticMarkup(
      <ActivityLog
        entries={[
          {
            id: "e1",
            revision: 1,
            occurredAt: "2026-07-24T12:00:00.000Z",
            text: "Something happened.",
            delta: null,
          },
        ]}
      />,
    );

    // Then
    expect(markup).toContain('data-origin="unknown"');
    expect(markup).toContain("Something happened.");
    expect(markup).not.toContain("hud-log-origin");
  });

  it("counts the split in the rail header so the treatment has a legend", () => {
    // Given
    const markup = rail();

    // Then
    expect(markup).toContain('data-slot="turn-rail-log-count"');
    expect(markup).toContain("2 you · 2 all · R9");
  });
});

describe("activity log arrival motion", () => {
  it("renders every row at rest on the first synchronous render", () => {
    // Given — an inline `opacity: 0` in the markup would mean the log depends on
    // JavaScript to become readable, and a reduced-motion or no-JS reader would
    // be left staring at an empty rail.
    const markup = rail();

    // Then
    expect(markup).not.toContain("opacity");
    expect(markup).not.toContain("transform");
    expect(markup).not.toContain("style=");
  });

  it("carries the revision on each row so an arrival can be identified", () => {
    // Given
    const markup = rail();

    // Then
    expect(markup).toContain('data-revision="9"');
    expect(markup).toContain('data-revision="8"');
  });

  it("marks turn boundaries so a round can be scanned in blocks", () => {
    // Given
    const markup = rail();

    // Then
    expect(markup).toContain('data-event="TurnStarted"');
    expect(markup).toContain('data-event="DiceRolled"');
  });
});

describe("turn rail bot visibility", () => {
  it("ties a sustained bot turn to a numbered seat, not just a name", () => {
    // Given
    const botTurn = { ...game, activePlayerId: "player-2" } satisfies PublicGameProjection;

    // When
    const markup = rail({ game: botTurn });

    // Then
    expect(markup).toContain('data-slot="turn-state-seat-chip"');
    expect(markup).toContain('class="hud-seat-chip hud-seat-2"');
    expect(markup).toContain("Waiting on Ada · Bot Ruthless");
    // Calm instrumentation only: an LED and a tag, never a pulse loop (§6.4).
    expect(markup).not.toContain("animate-pulse");
    expect(markup).not.toContain("animate-ping");
  });

  it("reports the seat that holds the turn even when it is the viewer's", () => {
    // Then
    expect(resolveTurnState(room, game, "player-1").slot).toBe(1);
    expect(resolveTurnState(room, game, "player-2").slot).toBe(1);
    expect(
      resolveTurnState(room, { ...game, status: "ended", activePlayerId: null }, "player-1").slot,
    ).toBeNull();
  });
});

describe("turn rail helpers", () => {
  it("signs every delta explicitly so gain and loss are never colour-only", () => {
    // Then
    expect(formatDelta({ amount: 1_200 })).toBe("+1,200");
    expect(formatDelta({ amount: -40, unit: "energy" })).toBe("-40 energy");
    expect(formatDelta({ amount: 0 })).toBe("+0");
  });

  it("keeps playerName resolving members by id for game-client", () => {
    // Then
    expect(playerName(room, "player-2")).toBe("Ada");
    expect(playerName(room, "nobody")).toBe("Seat ?");
  });

  it("renders rank ids as sentence-case prose", () => {
    // Then
    expect(rankLabel(player({ rank: { id: "r", kind: "rank.senior-staff", index: 2 } }))).toBe(
      "Senior staff",
    );
    expect(rankLabel(player({ rank: { id: "r", kind: null, index: 3 } }))).toBe("Tier 4");
  });

  it("derives a collision-free 1..6 seat slot from turn order, not the 0-based seat field", () => {
    // Then
    expect(seatSlot(game, "player-1")).toBe(1);
    expect(seatSlot(game, "player-3")).toBe(3);
    expect(seatSlot(game, "missing")).toBe(1);
  });
});
