import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  PublicGameProjection,
  PublicPlayerProjection,
  RoomMemberProjection,
  RoomProjection,
} from "@office-ladder/contracts";

import { GameHudStrip, TurnClock, TurnStateIndicator } from "./game-hud";
import { resolveTurnState } from "./turn-rail";

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
  members: [member(), member({ id: "player-2", displayName: "Morgan", seat: 1, isHost: false })],
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
  players: [player(), player({ id: "player-2", position: 12, resources: { money: 900 } })],
  eventSummaries: [],
  winnerPlayerIds: [],
} satisfies PublicGameProjection;

function strip(
  overrides: {
    readonly game?: PublicGameProjection;
    readonly room?: RoomProjection;
    readonly selfPlayerId?: string;
    readonly selfCharacterId?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <GameHudStrip
      game={overrides.game ?? game}
      room={overrides.room ?? room}
      selfCharacterId={overrides.selfCharacterId ?? null}
      selfPlayerId={overrides.selfPlayerId ?? "player-1"}
    />,
  );
}

describe("game hud strip", () => {
  it("renders every readout as an uppercase label plus a mono tabular value", () => {
    // Given
    const markup = strip();

    // When
    const cells = markup.match(/data-slot="game-hud-cell"/g) ?? [];

    // Then
    expect(markup).toContain('class="hud-strip"');
    expect(cells.length).toBeGreaterThanOrEqual(9);
    expect(markup).toContain('<dt class="hud-label">Round</dt>');
    expect(markup).toContain('<dt class="hud-label">Cash</dt>');
    expect(markup).toContain("$1,200");
    expect(markup).toContain("hud-value");
  });

  it("keeps every readout labelled as text, with no pill or resting shadow", () => {
    // Given
    const markup = strip();

    // When
    const labels = ["Round", "Turn", "Seat", "Rank", "Cash", "Rep", "Energy", "Work", "Tile"];

    // Then
    for (const label of labels) {
      expect(markup).toContain(`>${label}</dt>`);
    }
    expect(markup).not.toContain("rounded-full");
    expect(markup).not.toContain("shadow-");
  });

  it("renders the energy meter as a bordered track with the value echoed in mono", () => {
    // Given
    const markup = strip();

    // Then
    expect(markup).toContain('data-slot="game-hud-meter"');
    // 4 of 8, not 4 of 5: the mode's energy ceiling is now an explicit
    // `energyMaximum` of 8 instead of being pinned to the starting value.
    expect(markup).toContain('data-percent="50"');
    expect(markup).toContain("4/8");
  });

  it("flags low energy with a text label, not colour alone", () => {
    // Given
    const drained = {
      ...game,
      players: [player({ resources: { money: 10, reputation: 0, energy: 1, "work-counter": 0 } })],
    } satisfies PublicGameProjection;

    // When
    const markup = strip({ game: drained });

    // Then
    expect(markup).toContain("hud-meter--low");
    expect(markup).toContain(">Low</span>");
  });

  it("reports the binding promotion requirement for the next rank", () => {
    // Given — 1,200 cash clears staff's 250, so reputation 2 of 3 is binding.
    const markup = strip();

    // Then
    expect(markup).toContain(">Next rank</dt>");
    expect(markup).toContain("Staff");
    expect(markup).toContain("2/3 rep");
  });

  it("states the full promotion requirement as text, not only in a hover title", () => {
    // Given — the visible readout only names the BINDING requirement, so the
    // money/reputation pair would be pointer-only if `title` were its only home.
    const markup = strip();

    // Then
    expect(markup).toContain('data-slot="game-hud-cell-description"');
    expect(markup).toContain(
      "Staff needs $250 and 3 reputation. You hold $1,200 and 2 reputation.",
    );
  });

  it("marks the promotion meter ready once both requirements are met", () => {
    // Given
    const ready = {
      ...game,
      players: [player({ resources: { money: 400, reputation: 3, energy: 5, "work-counter": 0 } })],
    } satisfies PublicGameProjection;

    // When
    const markup = strip({ game: ready });

    // Then
    expect(markup).toContain("hud-meter--met");
    expect(markup).toContain(">Ready</span>");
  });

  it("applies the office politician's reduced reputation requirement when known", () => {
    // Given — staff normally needs 3 reputation; the passive drops it to 2.
    const markup = strip({ selfCharacterId: "character.office-politician" });

    // Then
    expect(markup).toContain("hud-meter--met");
    expect(markup).toContain(">Ready</span>");
  });

  it("stops at the top rank instead of inventing one past director", () => {
    // Given
    const director = {
      ...game,
      players: [player({ rank: { id: "rank.director", kind: "rank.director", index: 8 } })],
    } satisfies PublicGameProjection;

    // When
    const markup = strip({ game: director });

    // Then
    expect(markup).toContain(">Top rank</span>");
  });

  it("pairs the seat colour with a seat-number glyph rather than colour alone", () => {
    // Given
    const markup = strip();

    // Then
    expect(markup).toContain("hud-seat-1");
    expect(markup).toContain(">S1</span>");
    expect(markup).toContain("Avery");
  });

  it("degrades to a spectator readout when the viewer holds no seat", () => {
    // Given
    const markup = strip({ selfPlayerId: "observer-9" });

    // Then
    expect(markup).toContain(">View</dt>");
    expect(markup).toContain("Spectating");
    expect(markup).not.toContain('data-hud-cell="energy"');
  });
});

describe("hud strip width discipline", () => {
  /*
   * Measured in headless Chrome at the shell's real 1184px: the ten readouts
   * wanted 1508px, and `.hud-strip` hides its own scrollbar, so `Next rank` was
   * simply absent with nothing to suggest it existed. Two guards keep that from
   * coming back — the strip is allowed to wrap, and the two widest non-readouts
   * (a duplicated display name, a constant board length) stay out of the strip.
   */
  const stylesheet = readFileSync(
    fileURLToPath(new URL("../../styles/hud.css", import.meta.url)),
    "utf8",
  );

  it("degrades by wrapping rather than by hiding a readout", () => {
    // Then
    expect(stylesheet).toMatch(/@media \(min-width: 768px\) \{\s*\.hud-strip \{[^}]*flex-wrap: wrap/);
    expect(stylesheet).toMatch(/@media \(min-width: 768px\) \{[\s\S]*?\.hud-strip::after/);
  });

  it("keeps the mobile strip scrollable with values as text, not icons (§9)", () => {
    // Given — below 768px the strip is the one place horizontal scroll is right.
    const base = stylesheet.slice(
      stylesheet.indexOf(".hud-strip {"),
      stylesheet.indexOf("}", stylesheet.indexOf(".hud-strip {")),
    );

    // Then
    expect(base).toContain("overflow-x: auto");
    expect(base).toContain("height: 40px");
  });

  it("states the viewer's name in the cell description instead of spending 93px on it", () => {
    // Given — the dossier row already prints it in full, and here it truncated
    // to "Contract Aud…", which is not a readout at all.
    const markup = strip();

    // Then
    expect(markup).toContain("You are Avery, seat 1.");
    expect(markup).toContain(">S1</span>");
    expect(markup).not.toContain('<span class="hud-sub">Avery</span>');
  });

  it("moves the constant board length out of the tile readout", () => {
    // Given
    const markup = strip();

    // Then
    expect(markup).toContain("Tile 07 of 44.");
    expect(markup).not.toContain(">/44</span>");
  });
});

describe("hud resource ticks", () => {
  /*
   * The count itself is unobservable here — apps/web's vitest environment is
   * `node`, so there is no frame loop and no `matchMedia`. What IS testable is
   * the property the tick must never break: the committed value is what renders
   * synchronously. A reduced-motion player reads the real number immediately
   * because the real number is the first thing painted, not because the
   * animation was skipped.
   */
  it("renders the committed value on the first synchronous render", () => {
    // Given
    const markup = strip();

    // Then
    expect(markup).toContain('data-slot="game-hud-cash" data-value="1200">$1,200</span>');
    expect(markup).toContain('data-slot="game-hud-reputation" data-value="2">2</span>');
    expect(markup).toContain('data-slot="game-hud-energy" data-value="4">4/8</span>');
    expect(markup).toContain('data-slot="game-hud-work" data-value="3">3</span>');
  });

  it("keeps the committed value in a machine-readable attribute as well as the text", () => {
    // Given — while a count is mid-flight the text is an interpolation, so
    // anything reading the DOM for truth reads `data-value` instead.
    const rich = {
      ...game,
      players: [
        player({ resources: { money: 12_400, reputation: 7, energy: 2, "work-counter": 11 } }),
      ],
    } satisfies PublicGameProjection;

    // When
    const markup = strip({ game: rich });

    // Then
    expect(markup).toContain('data-value="12400">$12,400</span>');
    expect(markup).toContain('data-value="11">11</span>');
  });

  it("reserves the delta lane so an arriving +300 cannot shove the strip sideways", () => {
    // Given
    const markup = strip();

    // When
    const lanes = markup.match(/class="hud-delta-slot"/g) ?? [];

    // Then — one lane per ticking readout: cash, rep, energy, work.
    expect(lanes).toHaveLength(4);
  });

  it("shows no delta before anything has changed", () => {
    // Given
    const markup = strip();

    // Then
    expect(markup).not.toContain("hud-delta ");
    expect(markup).not.toContain("data-sign");
  });

  it("keeps the values as mono tabular text, never an icon or a chip", () => {
    // Given
    const markup = strip();

    // Then
    expect(markup).toContain('class="hud-value" data-slot="game-hud-cash"');
    expect(markup).not.toContain("rounded-full");
    expect(markup).not.toContain("<svg");
  });

  it("paints the energy meter at its real fill on the first render", () => {
    // Given — the meter illustrates a value that is also printed beside it, so
    // its resting geometry has to be correct without JavaScript.
    const markup = strip();

    // Then
    expect(markup).toContain('data-percent="50"');
    expect(markup).toContain('style="width:50%"');
  });
});

describe("hud turn-state indicator", () => {
  it("names the bot the game is waiting on, with its difficulty and an LED", () => {
    // Given
    const botRoom = {
      ...room,
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
      ],
    } satisfies RoomProjection;
    const botTurn = { ...game, activePlayerId: "player-2" } satisfies PublicGameProjection;

    // When
    const markup = renderToStaticMarkup(
      <TurnStateIndicator state={resolveTurnState(botRoom, botTurn, "player-1")} />,
    );

    // Then
    expect(markup).toContain("Waiting on Ada · Bot Ruthless");
    expect(markup).toContain("hud-led--remote");
    expect(markup).not.toContain("animate-pulse");
    // The seat number ties the wait to a token on the board (§8).
    expect(markup).toContain('class="hud-seat-chip hud-seat-2"');
  });

  it("says it is the viewer's own move when they hold the turn", () => {
    // Given
    const markup = renderToStaticMarkup(
      <TurnStateIndicator state={resolveTurnState(room, game, "player-1")} />,
    );

    // Then
    expect(markup).toContain("Your move");
    expect(markup).toContain("hud-led--attention");
  });

  it("reports a closed match rather than looking frozen", () => {
    // Given
    const ended = { ...game, status: "ended", activePlayerId: null } satisfies PublicGameProjection;

    // When
    const markup = renderToStaticMarkup(
      <TurnStateIndicator state={resolveTurnState(room, ended, "player-1")} />,
    );

    // Then
    expect(markup).toContain("Match closed");
    expect(markup).toContain("hud-led--idle");
  });
});

/*
 * The turn clock. What replaced a `/T(\d{2}:\d{2}:\d{2})/` over `deadlineAt`
 * rendering a static wall-clock time — a timestamp, not a countdown.
 *
 * The depletion itself is unobservable in this environment (node, no frame loop,
 * no CSS) and is deliberately not JavaScript's job anyway: it is one CSS animation
 * whose duration is the server's budget and whose delay is negative by the elapsed
 * time. What IS testable, and what the whole design rests on, is that the resting
 * geometry is a pure function of two SERVER instants — so the same markup renders
 * on the server, in this test and on the first client paint, and none of it depends
 * on the browser's clock.
 */
const CLOCK_ARMED = {
  ...game,
  deadlineAt: "2026-07-27T10:00:30.000Z",
  turnTimerDurationMs: 30_000,
} satisfies PublicGameProjection;

function clock(
  overrides: {
    readonly game?: PublicGameProjection;
    readonly selfPlayerId?: string;
    readonly serverTime?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <TurnClock
      game={overrides.game ?? CLOCK_ARMED}
      selfPlayerId={overrides.selfPlayerId ?? "player-1"}
      serverTime={overrides.serverTime === undefined ? "2026-07-27T10:00:00.000Z" : overrides.serverTime}
    />,
  );
}

describe("turn clock", () => {
  it("renders a depleting bar, never a ticking number (§12.3)", () => {
    // Given a 30s budget armed 0s ago
    const markup = clock();

    // Then there is a track and a fill, and the only number on screen is the
    // static budget — nothing here counts down in text.
    expect(markup).toContain('data-slot="game-turn-clock"');
    expect(markup).toContain('class="hud-clock-track"');
    expect(markup).toContain('class="hud-clock-fill"');
    expect(markup).toContain('data-remaining="100"');
    expect(markup).toContain(">30s<");
    // A wall-clock readout is exactly what this replaces.
    expect(markup).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("takes its geometry from the two server instants, not from the browser clock", () => {
    // Given 12 of the 30 seconds already gone, per the server's own stamps: the
    // deadline is 10:00:30 and the budget was 30s, so the clock was armed at
    // 10:00:00 and the projection is stamped 12s later.
    const markup = clock({ serverTime: "2026-07-27T10:00:12.000Z" });

    // Then the bar rests at 60% and the CSS animation is seeked 12s in — a full
    // budget as its duration, and the elapsed time as a NEGATIVE delay.
    expect(markup).toContain('data-remaining="60"');
    expect(markup).toContain("animation-delay:-12000ms");
    expect(markup).toContain("animation-duration:30000ms");
    // The resting transform is what shows if animations never run at all.
    expect(markup).toContain("transform:scaleX(0.6)");
    expect(markup).toContain('data-synced="true"');
  });

  it("stops at zero rather than going negative or looping", () => {
    // Given a deadline the server has already passed
    const markup = clock({ serverTime: "2026-07-27T10:01:00.000Z" });

    // Then
    expect(markup).toContain('data-remaining="0"');
    expect(markup).toContain("transform:scaleX(0)");
    expect(markup).toContain("animation-delay:-30000ms");
  });

  it("holds its lane when no clock is running, so a turn ending cannot move the board", () => {
    // Given a projection with no deadline — the timer is off, the match is over,
    // or a bot holds the turn
    const markup = clock({ game });

    // Then the readout is still there, still the same lane, with no fill.
    expect(markup).toContain('data-slot="game-turn-clock"');
    expect(markup).toContain('data-armed="false"');
    expect(markup).toContain('class="hud-clock-track"');
    expect(markup).not.toContain("hud-clock-fill");
    expect(markup).toContain(">—<");
    expect(markup).toContain("No turn clock is running.");
  });

  it("says in words whose clock it is and what happens at zero", () => {
    // Given the local player holds the turn
    const mine = clock();

    // Then the auto-action is stated, not implied — this is the "kalo abis auto
    // roll" half of the feature, and a bar alone cannot say it.
    expect(mine).toContain('data-owner="self"');
    expect(mine).toContain("a 30 second budget for you");
    expect(mine).toContain("the server rolls for you");
  });

  it("distinguishes your own clock from an opponent's structurally", () => {
    // Given the same armed clock seen by the other seat
    const theirs = clock({ selfPlayerId: "player-2" });

    // Then own-versus-opponent is an attribute the stylesheet keys the fill tone
    // and the leading rule off, plus a different sentence naming the seat.
    expect(theirs).toContain('data-owner="opponent"');
    expect(theirs).toContain("budget for seat 1");
    expect(theirs).toContain("the server rolls on their behalf");
  });

  it("reports itself unsynced rather than guessing from Date.now()", () => {
    // Given a caller that did not pass `GameBootstrap.serverTime`
    const markup = clock({ serverTime: null });

    // Then it runs the real budget and says the elapsed portion is unknown — the
    // client's own clock can be minutes off, so it is never consulted.
    expect(markup).toContain('data-synced="false"');
    expect(markup).toContain('data-remaining="100"');
    expect(markup).toContain("Remaining time is unsynced.");
  });

  it("ignores a deadline it cannot make a proportion out of", () => {
    // Given a deadline with no budget beside it, and an unparseable instant
    const noBudget = clock({
      game: { ...CLOCK_ARMED, turnTimerDurationMs: null },
    });
    const unparseable = clock({
      game: { ...CLOCK_ARMED, deadlineAt: "not-an-instant" },
    });

    // Then both degrade to the resting lane instead of rendering a wrong bar.
    expect(noBudget).toContain('data-armed="false"');
    expect(unparseable).toContain('data-armed="false"');
  });

  it("scales a long budget into minutes without ever ticking", () => {
    // Given a 2-minute turn
    const markup = clock({
      game: {
        ...CLOCK_ARMED,
        deadlineAt: "2026-07-27T10:02:00.000Z",
        turnTimerDurationMs: 120_000,
      },
    });

    // Then
    expect(markup).toContain(">2:00<");
    expect(markup).toContain("a 2 minute budget for you");
  });
});

describe("turn clock stylesheet", () => {
  const stylesheet = readFileSync(
    fileURLToPath(new URL("../../styles/hud.css", import.meta.url)),
    "utf8",
  );

  it("degrades to discrete steps under reduced motion rather than vanishing", () => {
    // Then — §12.3: the remaining time is information, not decoration, so the
    // one sanctioned continuous animation in the system quantises instead of
    // being removed.
    expect(stylesheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.hud-clock-fill \{[^}]*animation-timing-function: steps\(/,
    );
  });

  it("runs the bar once, linearly, and holds it at zero", () => {
    // Given
    const fill = stylesheet.slice(
      stylesheet.indexOf(".hud-clock-fill {"),
      stylesheet.indexOf("}", stylesheet.indexOf(".hud-clock-fill {")),
    );

    // Then — a literal progress meter is the one place DESIGN.md §7 allows
    // `easing-linear`, and `forwards` is what makes it stop at zero and wait for
    // the next update instead of resetting.
    expect(fill).toContain("animation-timing-function: linear");
    expect(fill).toContain("animation-iteration-count: 1");
    expect(fill).toContain("animation-fill-mode: forwards");
    // The duration and the delay are the server's numbers, set per render.
    expect(fill).not.toContain("animation-duration");
    expect(fill).not.toContain("animation-delay");
  });

  it("reserves the clock's lane at every width", () => {
    // Given
    const lane = stylesheet.slice(
      stylesheet.indexOf(".hud-clock {"),
      stylesheet.indexOf("}", stylesheet.indexOf(".hud-clock {")),
    );

    // Then the lane has a definite width whether or not a clock is armed, so the
    // header the board sits under never changes size.
    expect(lane).toContain("width: 96px");
    expect(stylesheet).toMatch(/@media \(min-width: 768px\) \{\s*\.hud-clock \{[^}]*width: 136px/);
  });

  it("keeps the track flat and sunken, with no glow and no radius (§6.4)", () => {
    // Given
    const track = stylesheet.slice(
      stylesheet.indexOf(".hud-clock-track {"),
      stylesheet.indexOf("}", stylesheet.indexOf(".hud-clock-track {")),
    );

    // Then
    expect(track).toContain("border-radius: 0");
    expect(track).toContain("background-color: var(--surface-sunken)");
    expect(track).not.toContain("box-shadow");
  });
});
