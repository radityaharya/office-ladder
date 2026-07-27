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
    // Given — Avery is the viewer, so the line is written in the second person.
    const markup = rail();

    // Then
    expect(markup).toContain("You rolled 4.");
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
    const diceIndex = markup.indexOf("You rolled 4.");
    const turnIndex = markup.indexOf("Your turn.");

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

/*
 * These pin the defect found by watching a real campaign match: eight
 * consecutive rows that between them answered nothing. Verbatim from that run —
 *   "Contract Auditor had resources adjusted."   (twice per turn)
 *   "Temp Analyst proposed an effect."
 *   "Contract Auditor resolved their tile."
 * A reader cannot answer "what just happened to whom, and by how much" from any
 * of those, which is the only question the log exists to answer.
 */
describe("activity log says what happened", () => {
  /**
   * A summary carrying fields `SafeEventSummary` does not model yet.
   *
   * The generic arm of the union is metadata-only, so the payload the engine
   * already produces (`ResourceChangedEvent`, `PlayerMovedEvent`, …) is dropped
   * on the way out of `apps/server/src/rooms/service/game-setup.ts`. The log
   * reads those fields defensively, so these fixtures are what a row looks like
   * once the projection carries them — and the sibling tests below pin the
   * degraded, number-free rendering that holds until it does.
   */
  function summary(overrides: Record<string, unknown>): SafeEventSummary {
    return {
      id: "event-x",
      revision: 9,
      occurredAt: "2026-07-24T12:00:06.000Z",
      actorPlayerId: "player-1",
      ...overrides,
    } as unknown as SafeEventSummary;
  }

  function log(
    events: readonly SafeEventSummary[],
    selfPlayerId: string | null = "player-1",
  ): readonly ReturnType<typeof buildActivityLog>[number][] {
    return [...buildActivityLog({ ...game, eventSummaries: events }, room, [], selfPlayerId)];
  }

  it("names the reason and the amount instead of 'had resources adjusted'", () => {
    // Given
    const entries = log([
      summary({
        id: "event-fine",
        type: "ResourceChanged",
        resource: "resource.money",
        previousValue: 1_400,
        newValue: 1_200,
        reason: "audit-fine",
      }),
    ]);

    // Then
    expect(entries[0]?.text).toBe("You paid the audit fine.");
    expect(entries[0]?.delta).toEqual({ amount: -200, unit: "money" });
    expect(entries[0]?.text).not.toContain("resources adjusted");
  });

  it("renders a cash delta as money and never restates the amount in the sentence", () => {
    // Given
    const markup = renderToStaticMarkup(
      <ActivityLog
        entries={log([
          summary({
            id: "event-rent",
            type: "ResourceChanged",
            actorPlayerId: "player-2",
            resource: "resource.money",
            amount: -200,
            reason: "agreement-settlement",
          }),
        ])}
      />,
    );

    // Then
    expect(markup).toContain(">-$200</span>");
    expect(markup).toContain("Ada paid out on an agreement.");
    expect(markup).not.toContain("200.");
  });

  it("writes the viewer's own lines in the second person and everyone else's in the third", () => {
    // Given — a structural split a reader parses before the name, and one that
    // survives into assistive tech (§12.1).
    const entries = log([
      summary({ id: "mine", type: "PromotionAttempted", actorPlayerId: "player-1" }),
      summary({ id: "theirs", type: "PromotionAttempted", actorPlayerId: "player-2" }),
    ]);

    // Then
    expect(entries.map((entry) => entry.text)).toEqual([
      "You went for a promotion.",
      "Ada went for a promotion.",
    ]);
  });

  it("puts the row on the seat the change landed on, not the seat that issued the command", () => {
    // Given — the server stamps every bookkeeping event with the COMMANDING
    // seat, so a card Avery plays against Ada arrives attributed to Avery.
    const entries = log([
      summary({
        id: "event-hit",
        type: "ResourceChanged",
        actorPlayerId: "player-1",
        subjectPlayerId: "player-2",
        resource: "resource.reputation",
        amount: -2,
        reason: "attack",
      }),
    ]);

    // Then
    expect(entries[0]?.text).toBe("Ada was hit by a rival.");
    expect(entries[0]?.origin).toBe("remote");
    expect(entries[0]?.slot).toBe(2);
    expect(entries[0]?.delta).toEqual({ amount: -2, unit: "rep" });
  });

  it("collapses a turn's contentless bookkeeping into the lines that carry the facts", () => {
    // Given — the live sequence: five events, two of which said anything.
    const entries = log([
      summary({ id: "turn", type: "TurnStarted", revision: 10 }),
      summary({ id: "dice", type: "DiceRolled", revision: 11, dice: [4], total: 4, purpose: "" }),
      summary({ id: "moved", type: "PlayerMoved", revision: 11 }),
      summary({ id: "tile", type: "TileResolved", revision: 11 }),
      summary({ id: "res-1", type: "ResourceChanged", revision: 11 }),
      summary({ id: "res-2", type: "ResourceChanged", revision: 11 }),
    ]);

    // Then
    expect(entries.map((entry) => entry.text)).toEqual(["Your turn.", "You rolled 4."]);
  });

  it("keeps a folding line that has nothing above it to fold into", () => {
    // Given — the log truncates from the front at 200 events, so a supporting
    // event can be the oldest thing in the window. Losing it would be losing an
    // event, which is different from collapsing a restatement.
    const entries = log([summary({ id: "orphan", type: "TileResolved" })]);

    // Then
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toBe("Your tile resolved.");
  });

  it("never folds a line the caller decorated with a delta", () => {
    // Given
    const entries = buildActivityLog(
      {
        ...game,
        eventSummaries: [
          summary({ id: "dice", type: "DiceRolled", revision: 11, dice: [4], total: 4, purpose: "" }),
          summary({ id: "res", type: "ResourceChanged", revision: 11 }),
        ],
      },
      room,
      [{ eventId: "res", amount: -150, unit: "money", text: "You paid the tile." }],
      "player-1",
    );

    // Then
    expect(entries).toHaveLength(2);
    expect(entries[1]?.text).toBe("You paid the tile.");
  });

  it("renders no number at all when the projection carries none", () => {
    // Given — an unknown amount renders without one rather than with a guess.
    const entries = log([
      summary({ id: "salary", type: "SalaryAwarded" }),
      summary({ id: "promoted", type: "PlayerPromoted" }),
    ]);

    // Then
    expect(entries.map((entry) => entry.text)).toEqual([
      "You collected salary at reception.",
      "You were promoted.",
    ]);
    expect(entries.every((entry) => entry.delta === null)).toBe(true);
  });

  it("states salary, promotion and movement in full once the payload carries them", () => {
    // Given
    const entries = log([
      summary({ id: "moved", type: "PlayerMoved", to: 10, distance: 4, direction: "forward", lapsGained: 1 }),
      summary({ id: "salary", type: "SalaryAwarded", amount: 2_000 }),
      summary({ id: "promoted", type: "PlayerPromoted", toRank: "rank.senior-staff", cost: 1_500 }),
    ]);

    // Then
    expect(entries[0]?.text).toBe("You moved 4 to tile 11, passing reception.");
    expect(entries[1]?.text).toBe("You collected salary at reception.");
    expect(entries[1]?.delta).toEqual({ amount: 2_000, unit: "money" });
    expect(entries[2]?.text).toBe("You were promoted to Senior staff.");
    expect(entries[2]?.delta).toEqual({ amount: -1_500, unit: "money" });
  });

  it("keeps engine vocabulary out of every line it can still render", () => {
    // Given — one of each remaining type, so a wording regression is caught
    // here rather than in a live match.
    const texts = log([
      summary({ id: "e1", type: "EffectProposed", revision: 20 }),
      summary({ id: "e2", type: "EffectPrevented", revision: 21, preventedByPlayerId: "player-2" }),
      summary({ id: "e3", type: "PromptOpened", revision: 22 }),
      summary({ id: "e4", type: "PromptOpened", revision: 23, actorPlayerId: "player-2" }),
      summary({ id: "e5", type: "StatusApplied", revision: 24, status: "status.next-salary-multiplier" }),
      summary({ id: "e6", type: "PromotionBlocked", revision: 25, blockedByPlayerId: "player-2" }),
      summary({ id: "e7", type: "ManagementRevealed", revision: 26 }),
    ]).map((entry) => entry.text);

    // Then — `EffectProposed` is plumbing and has nothing above it to fold into
    // at revision 20, so it keeps a row; it must still read as English.
    expect(texts).toEqual([
      "You put an effect on the table.",
      "Ada blocked that effect.",
      "You have a decision to make.",
      "Ada has a decision to make.",
      "You picked up a status effect: next salary multiplier.",
      "Ada blocked your promotion.",
      "You are management. That is public now.",
    ]);
    for (const text of texts) {
      expect(text).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it("makes a turn boundary a heading rather than a sentence", () => {
    // Given — three words, so a reader scanning for where their own last turn
    // began finds it by shape. hud.css strengthens the rule under this row.
    const markup = rail();

    // Then
    expect(markup).toContain("Your turn.");
    expect(markup).not.toContain("started their turn");
    expect(markup).toContain('data-event="TurnStarted"');
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

  it("renders cash with a $ prefix so it is never mistaken for reputation", () => {
    // Then — same shape as `formatPanelSignedMoney` in the panel kit.
    expect(formatDelta({ amount: -200, unit: "money" })).toBe("-$200");
    expect(formatDelta({ amount: 2_000, unit: "money" })).toBe("+$2,000");
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
