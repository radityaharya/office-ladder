import { beforeAll, describe, expect, it } from "vitest";

import type { GameState } from "@office-ladder/engine";
import {
  expiredExpiryTargets,
  expiryLatenessMs,
  expiryTargets,
  expiryWakeupCapMs,
  MINIMUM_WAKEUP_MS,
  nextExpiryDelayMs,
  nextExpiryTarget,
  reactionWindowMs,
  turnClockMs,
  type ExpiryScanOptions,
} from "../../../src/rooms/window-timer/window-deadlines";
import {
  ballot,
  BALLOT_ID,
  isoAt,
  players,
  promptFor,
  QUICK_REACTION_WINDOW_MS,
  QUICK_TURN_CLOCK_MS,
  reactionWindow,
  startMatch,
  WINDOW_ID,
  withRules,
} from "./fixtures";

/**
 * The pure half of spec §7.1: which resolvables are due, given a game and an
 * instant. No repository, no timers, no clock — "now" is always an argument.
 */

const NOBODY_IS_A_BOT = (): boolean => false;

const DEFAULT_OPTIONS: ExpiryScanOptions = {
  turnClockEnabled: true,
  isBotSeat: NOBODY_IS_A_BOT,
};

let started: GameState;

beforeAll(async () => {
  const fixture = await startMatch();
  started = await fixture.game();
});

/** The started match with no wall-clock boundary of its own. */
function noTurnClock(game: GameState): GameState {
  return { ...game, turn: { ...game.turn, startedAt: null } };
}

describe("window lengths come from the mode rules, never a constant", () => {
  it("Given the shipped quick preset, When the two knobs are read, Then they are the mode's own seconds", () => {
    expect(reactionWindowMs(started.rules)).toBe(QUICK_REACTION_WINDOW_MS);
    expect(turnClockMs(started.rules)).toBe(QUICK_TURN_CLOCK_MS);
  });

  it("Given a mode with a different turnSeconds, When the turn deadline is derived, Then it moves with the rule", () => {
    const slow = withRules(started, { timers: { turnSeconds: 90 } });
    const fast = withRules(started, { timers: { turnSeconds: 5 } });

    const slowTarget = expiryTargets(slow, DEFAULT_OPTIONS)[0];
    const fastTarget = expiryTargets(fast, DEFAULT_OPTIONS)[0];

    expect(slowTarget).toMatchObject({ kind: "turn", derived: true, deadlineAt: isoAt(90_000) });
    expect(fastTarget).toMatchObject({ kind: "turn", derived: true, deadlineAt: isoAt(5_000) });
  });

  it("Given both knobs, When a sleep is capped, Then the cap is the longer of the two and never a hardcoded number", () => {
    const longWindow = withRules(started, {
      interaction: { reactionWindowSeconds: 100 },
      timers: { turnSeconds: 30 },
    });
    const longTurn = withRules(started, {
      interaction: { reactionWindowSeconds: 5 },
      timers: { turnSeconds: 300 },
    });

    expect(expiryWakeupCapMs(longWindow.rules)).toBe(100_000);
    expect(expiryWakeupCapMs(longTurn.rules)).toBe(300_000);
  });

  it("Given a turnSeconds of zero, When the turn is scanned, Then there is no turn deadline at all", () => {
    const off = withRules(started, { timers: { turnSeconds: 0 } });

    expect(expiryTargets(off, DEFAULT_OPTIONS)).toEqual([]);
  });
});

describe("reaction windows", () => {
  it("Given a window carrying a deadline, When the instant arrives, Then it is due — and not one millisecond before", () => {
    const game = noTurnClock({
      ...started,
      reactionWindows: [reactionWindow(isoAt(10_000))],
    });

    expect(expiredExpiryTargets(game, isoAt(9_999), DEFAULT_OPTIONS)).toEqual([]);
    expect(expiredExpiryTargets(game, isoAt(10_000), DEFAULT_OPTIONS)).toMatchObject([
      { kind: "reaction-window", id: WINDOW_ID, derived: false },
    ]);
  });

  it("Given a deadline missed by an hour, When the scan runs, Then it is still due", () => {
    // The recoverable half of §7.1: a process that was down through the deadline
    // must resolve it on its first pass, not decide it is too late to bother.
    const game = noTurnClock({
      ...started,
      reactionWindows: [reactionWindow(isoAt(10_000))],
    });

    const due = expiredExpiryTargets(game, isoAt(3_600_000), DEFAULT_OPTIONS);

    expect(due).toHaveLength(1);
    expect(expiryLatenessMs(due[0]!, isoAt(3_600_000))).toBe(3_590_000);
  });

  it("Given a window with no deadline, When the scan runs, Then it is never offered", () => {
    // The engine writes null when it could not read its own timestamp. Inventing
    // a deadline would close a window nobody agreed to close.
    const game = noTurnClock({ ...started, reactionWindows: [reactionWindow(null)] });

    expect(expiryTargets(game, DEFAULT_OPTIONS)).toEqual([]);
    expect(nextExpiryDelayMs(game, isoAt(0), DEFAULT_OPTIONS)).toBeNull();
  });

  it("Given a mode with reaction windows switched off, When one exists anyway, Then it is still drainable", () => {
    // Deliberate, and it matches the engine: opening and answering are gated on
    // the rule, draining is the escape hatch. A window stranded by a ruleset
    // change would block every other command in the match forever.
    const game = noTurnClock(
      withRules(
        { ...started, reactionWindows: [reactionWindow(isoAt(1_000))] },
        { interaction: { reactionWindows: false } },
      ),
    );

    expect(expiredExpiryTargets(game, isoAt(2_000), DEFAULT_OPTIONS)).toHaveLength(1);
  });

  it("Given a match that has ended with a window still open, When the scan runs, Then the window is still drainable", () => {
    const game = noTurnClock({
      ...started,
      status: "ended",
      reactionWindows: [reactionWindow(isoAt(1_000))],
    });

    expect(expiredExpiryTargets(game, isoAt(2_000), DEFAULT_OPTIONS)).toMatchObject([
      { kind: "reaction-window" },
    ]);
  });
});

describe("ballots", () => {
  it("Given an open ballot past its deadline, When the scan runs, Then it is due", () => {
    const game = noTurnClock({ ...started, ballots: [ballot(isoAt(5_000))] });

    expect(expiredExpiryTargets(game, isoAt(5_000), DEFAULT_OPTIONS)).toMatchObject([
      { kind: "ballot", id: BALLOT_ID },
    ]);
  });

  it("Given a ballot that has already closed, When the scan runs, Then it is never offered again", () => {
    // The row keeps its past deadline forever — `expireBallot` refuses a second
    // close rather than removing it. A scan that ignored `resolution` would hand
    // the driver the same doomed command on every pass for the rest of the match.
    const game = noTurnClock({
      ...started,
      ballots: [ballot(isoAt(5_000), { resolution: { kind: "vote", closedBy: "expired" } })],
    });

    expect(expiryTargets(game, DEFAULT_OPTIONS)).toEqual([]);
  });

  it("Given a finished match, When a ballot is still open, Then it is not offered", () => {
    // `expireBallot` refuses outright unless the game is active, so offering it
    // would be an infinite supply of GAME_NOT_ACTIVE rejections.
    const game = noTurnClock({
      ...started,
      status: "ended",
      ballots: [ballot(isoAt(5_000))],
    });

    expect(expiryTargets(game, DEFAULT_OPTIONS)).toEqual([]);
  });
});

describe("the turn clock", () => {
  it("Given a live turn, When the scan runs, Then the deadline is startedAt plus the mode's turnSeconds", () => {
    expect(started.turn.startedAt).toBe(isoAt(0));

    expect(expiryTargets(started, DEFAULT_OPTIONS)).toMatchObject([
      { kind: "turn", deadlineAt: isoAt(QUICK_TURN_CLOCK_MS), derived: true },
    ]);
  });

  it("Given the engine has written turn.deadlineAt, When the scan runs, Then state wins over the derivation", () => {
    // State is the truth. The derivation exists only because every transition
    // still writes null; the day one stops, its value must not be overridden.
    const game: GameState = {
      ...started,
      turn: { ...started.turn, deadlineAt: isoAt(123_000) },
    };

    expect(expiryTargets(game, DEFAULT_OPTIONS)).toMatchObject([
      { kind: "turn", deadlineAt: isoAt(123_000), derived: false },
    ]);
  });

  it("Given the turn clock is switched off for this deployment, When the scan runs, Then no turn is ever due", () => {
    const options: ExpiryScanOptions = { ...DEFAULT_OPTIONS, turnClockEnabled: false };

    expect(expiryTargets(started, options)).toEqual([]);
    expect(expiredExpiryTargets(started, isoAt(600_000), options)).toEqual([]);
  });

  it("Given a bot holds the turn, When the scan runs, Then it is not on a clock", () => {
    const options: ExpiryScanOptions = {
      ...DEFAULT_OPTIONS,
      isBotSeat: (playerId) => playerId === started.turn.activePlayerId,
    };

    expect(expiryTargets(started, options)).toEqual([]);
  });

  it("Given a prompt addressed to the active player, When the scan runs, Then the turn is not this scheduler's to end", () => {
    // `turn.timeout` refuses outright while one is open, and answering for an
    // absent human is the turn-timeout policy's decision, not the clock's.
    const activePlayerId = started.turn.activePlayerId;
    expect(activePlayerId).not.toBeNull();
    const game: GameState = { ...started, prompts: [promptFor(activePlayerId!)] };

    expect(expiryTargets(game, DEFAULT_OPTIONS)).toEqual([]);
  });

  it("Given an open reaction window, When the scan runs, Then the window is due but the turn is not", () => {
    // The window is what is blocking the turn; expiring it is what unblocks it.
    // Timing the turn out first would take a turn from the wrong player.
    const game: GameState = {
      ...started,
      reactionWindows: [reactionWindow(isoAt(1_000))],
    };

    expect(expiryTargets(game, DEFAULT_OPTIONS)).toMatchObject([{ kind: "reaction-window" }]);
  });

  it("Given auto-roll and a phase it cannot run in, When the scan runs, Then the turn is not offered", () => {
    const rolling = withRules(
      { ...started, turn: { ...started.turn, phase: "movement" } },
      { timers: { onTimeout: "auto-roll" } },
    );
    const passing = withRules(rolling, { timers: { onTimeout: "auto-pass" } });

    expect(expiryTargets(rolling, DEFAULT_OPTIONS)).toEqual([]);
    // auto-pass ends the turn from anywhere, so it stays enforceable.
    expect(expiryTargets(passing, DEFAULT_OPTIONS)).toMatchObject([{ kind: "turn" }]);
  });

  it("Given a match that is not active, When the scan runs, Then no turn is due", () => {
    expect(expiryTargets({ ...started, status: "ended" }, DEFAULT_OPTIONS)).toEqual([]);
    expect(expiryTargets({ ...started, status: "paused" }, DEFAULT_OPTIONS)).toEqual([]);
  });
});

describe("scheduling the next look", () => {
  it("Given nothing due yet, When the delay is computed, Then it is the time remaining, capped by the mode's longest window", () => {
    const game = noTurnClock({
      ...started,
      reactionWindows: [reactionWindow(isoAt(10_000))],
    });

    expect(nextExpiryDelayMs(game, isoAt(2_000), DEFAULT_OPTIONS)).toBe(8_000);
    expect(nextExpiryTarget(game, isoAt(2_000), DEFAULT_OPTIONS)).toMatchObject({
      kind: "reaction-window",
    });
  });

  it("Given a deadline further out than one window length, When the delay is computed, Then the sleep is capped", () => {
    // A single long sleep is the one thing standing between a window and its
    // expiry, and a suspended process can overshoot it arbitrarily. Capping
    // costs at most one extra look; not capping can cost the match.
    const game = noTurnClock({
      ...started,
      reactionWindows: [reactionWindow(isoAt(86_400_000))],
    });

    expect(nextExpiryDelayMs(game, isoAt(0), DEFAULT_OPTIONS)).toBe(
      expiryWakeupCapMs(game.rules),
    );
  });

  it("Given a deadline all but arrived, When the delay is computed, Then it is floored rather than zero", () => {
    const game = noTurnClock({
      ...started,
      reactionWindows: [reactionWindow(isoAt(10_000))],
    });

    expect(nextExpiryDelayMs(game, isoAt(9_999), DEFAULT_OPTIONS)).toBe(MINIMUM_WAKEUP_MS);
  });

  it("Given nothing carries a deadline, When the delay is computed, Then there is nothing to wait for", () => {
    const game = noTurnClock(started);

    expect(nextExpiryDelayMs(game, isoAt(0), DEFAULT_OPTIONS)).toBeNull();
    expect(nextExpiryTarget(game, isoAt(0), DEFAULT_OPTIONS)).toBeNull();
  });
});

describe("hostile and broken input", () => {
  it("Given an unparseable deadline in state, When the scan runs, Then it is ignored rather than treated as overdue", () => {
    const game = noTurnClock({
      ...started,
      reactionWindows: [reactionWindow("not-a-timestamp")],
      ballots: [ballot("")],
    });

    expect(expiryTargets(game, DEFAULT_OPTIONS)).toEqual([]);
    expect(expiredExpiryTargets(game, isoAt(0), DEFAULT_OPTIONS)).toEqual([]);
  });

  it("Given an unreadable clock, When the scan runs, Then nothing is due and nothing is scheduled", () => {
    // A broken clock must never turn into a busy loop that closes every window
    // in the game.
    const game = noTurnClock({
      ...started,
      reactionWindows: [reactionWindow(isoAt(1_000))],
    });

    expect(expiredExpiryTargets(game, "not-a-timestamp", DEFAULT_OPTIONS)).toEqual([]);
    expect(nextExpiryDelayMs(game, "not-a-timestamp", DEFAULT_OPTIONS)).toBeNull();
    expect(expiryLatenessMs(expiryTargets(game, DEFAULT_OPTIONS)[0]!, "nope")).toBe(0);
  });

  it("Given a turn whose startedAt was lost, When the scan runs, Then no deadline is invented for it", () => {
    expect(expiryTargets(noTurnClock(started), DEFAULT_OPTIONS)).toEqual([]);
  });

  it("Given several deadlines at the same instant, When the scan runs, Then the order is deterministic", () => {
    // Two processes must fire the same one first, or the same match resolves
    // differently depending on which server happened to wake up.
    const game = noTurnClock({
      ...started,
      reactionWindows: [
        reactionWindow(isoAt(1_000), {
          id: started.reactionWindows[0]?.id ?? ("decision-b" as never),
        }),
        reactionWindow(isoAt(1_000)),
      ],
      ballots: [ballot(isoAt(1_000))],
    });

    const order = expiredExpiryTargets(game, isoAt(1_000), DEFAULT_OPTIONS).map(
      (target) => `${target.kind}:${target.id}`,
    );

    expect(order).toEqual([...order].sort());
    expect(order[0]?.startsWith("ballot:")).toBe(true);
  });

  it("Given a player who never took a turn, When the active seat is scanned, Then the scan does not blow up on a missing player", () => {
    const game: GameState = {
      ...started,
      turn: { ...started.turn, activePlayerId: null },
    };

    expect(expiryTargets(game, DEFAULT_OPTIONS)).toEqual([]);
  });
});

describe("the scan never reads a clock of its own", () => {
  it("Given the same game and the same instant, When scanned twice, Then the answers are identical", () => {
    const game = { ...started, reactionWindows: [reactionWindow(isoAt(1_000))] };

    expect(expiredExpiryTargets(game, isoAt(5_000), DEFAULT_OPTIONS)).toEqual(
      expiredExpiryTargets(game, isoAt(5_000), DEFAULT_OPTIONS),
    );
  });

  it("Given players is keyed by seat, When a bot predicate is supplied, Then it is the only authority on bot seats", () => {
    const everyone: ExpiryScanOptions = {
      turnClockEnabled: true,
      isBotSeat: () => true,
    };

    expect(expiryTargets(started, everyone)).toEqual([]);
    expect(expiryTargets(started, DEFAULT_OPTIONS)).toHaveLength(1);
    expect(players.host).toBe(started.turn.activePlayerId);
  });
});
