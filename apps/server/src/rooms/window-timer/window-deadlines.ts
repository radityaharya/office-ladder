import type { GameState, ModeRules, PlayerId } from "@office-ladder/engine";

/**
 * The rules of the wall-clock boundary, as pure functions over a game and an
 * instant (spec §7.1).
 *
 * The engine writes `deadlineAt` onto a `ReactionWindowState`, a `BallotState`
 * and `TurnState` and then takes no further interest in time — it may not read a
 * clock at all. This module is the other half: given the state the engine wrote
 * and a "now" supplied by the caller, it answers *which* resolvables are due.
 * Nothing here reads the wall clock, the environment or the repository, which is
 * what makes every rule below assertable without a running server.
 *
 * Three properties this file exists to hold, and they are the whole difficulty:
 *
 * - **The deadline in state is the truth.** Never a constant, never the
 *   scheduler's own idea of how long a window should last. Where a deadline has
 *   to be *derived* (the turn clock, whose `TurnState.deadlineAt` the engine
 *   still writes as `null` on every transition), it is derived from
 *   `rules.timers.turnSeconds` and the turn's own `startedAt` — a mode setting,
 *   not a hardcoded number. Reaction windows already carry a deadline the engine
 *   computed from `rules.interaction.reactionWindowSeconds`, so the scheduler
 *   reads it rather than recomputing it and risking a different answer.
 * - **Late is fine, early is not.** {@link expiredExpiryTargets} has no upper
 *   bound: a deadline missed by an hour because the process was down is still
 *   due, which is the recoverable half of §7.1. It also has no tolerance below:
 *   a wakeup that lands a millisecond early finds nothing, and the driver simply
 *   sleeps again. The engine cannot reject an early expiry — `expireWindow` does
 *   not look at the deadline — so *not firing early* has to be enforced here.
 * - **A target that cannot be closed is not offered.** A resolved ballot keeps
 *   its past deadline forever (`expireBallot` refuses a second close rather than
 *   removing the row), so a scan that ignored `resolution` would hand the driver
 *   the same doomed command on every pass for the rest of the match.
 */

const MS_PER_SECOND = 1000;

/**
 * Floor on a single sleep. Below this the wakeup costs more than the wait saves,
 * and the driver would rather do the work now than schedule a callback for a
 * deadline that has all but arrived.
 */
export const MINIMUM_WAKEUP_MS = 50;

export type ExpiryTargetKind = "reaction-window" | "ballot" | "turn";

/**
 * One thing the wall clock is waiting on.
 *
 * `id` is the handle the resulting command addresses: the `DecisionPointId` of a
 * reaction window, the `BallotId` of a ballot (the dispatcher tells the two apart
 * itself), or the turn number for the turn clock, which has no decision point of
 * its own. It is also the stable half of the command id, which is what makes a
 * duplicate fire idempotent rather than a second resolution.
 */
export type ExpiryTarget = {
  readonly kind: ExpiryTargetKind;
  readonly id: string;
  readonly deadlineAt: string;
  /** `Date.parse(deadlineAt)`, resolved once so callers never re-parse. */
  readonly deadlineMs: number;
  /**
   * True when the deadline was computed from the mode rules rather than read
   * from state. Only ever the turn clock today, and reported on every fire so
   * that "the engine started writing turn deadlines" is visible in the log
   * rather than a silent behaviour change.
   */
  readonly derived: boolean;
};

export type ExpiryScanOptions = {
  /**
   * Whether this deployment runs a turn clock at all.
   *
   * The *length* of a turn always comes from `rules.timers.turnSeconds`; this is
   * only the on/off switch, and it exists so the operator-facing "no turn timer"
   * configuration that `apps/server/src/rooms/turn-timer/` already honours keeps
   * meaning what it says. Reaction windows and ballots are unaffected: those are
   * mechanics the mode enabled, not a deployment preference, and a window nobody
   * can close wedges the whole match.
   */
  readonly turnClockEnabled: boolean;
  /**
   * A bot seat is deliberately never on a clock — the bot driver commits its own
   * turns within its own pacing delay, so a second server-side actor aimed at the
   * same seat would be two mechanisms racing for one command with nothing to win.
   */
  readonly isBotSeat: (playerId: PlayerId) => boolean;
};

/** How long a reaction window lasts, per the mode's own rules. */
export function reactionWindowMs(rules: ModeRules): number {
  return Math.max(0, Math.round(rules.interaction.reactionWindowSeconds)) * MS_PER_SECOND;
}

/** How long a turn lasts, per the mode's own rules. */
export function turnClockMs(rules: ModeRules): number {
  return Math.max(0, Math.round(rules.timers.turnSeconds)) * MS_PER_SECOND;
}

/**
 * The longest the driver will sleep in one go.
 *
 * A `setTimeout` is not a clock: a suspended laptop, a stepped NTP correction or
 * a throttled timer queue can all deliver a callback long after the delay it was
 * given, and — worse for us — a long sleep can be the *only* thing standing
 * between a window and its expiry. Capping a single sleep at one window-length
 * means any such discontinuity costs at most one extra window's wait instead of
 * stranding the room until somebody happens to poll it. Both mode knobs feed it,
 * because either mechanic can be the one waiting.
 */
export function expiryWakeupCapMs(rules: ModeRules): number {
  return Math.max(MINIMUM_WAKEUP_MS, reactionWindowMs(rules), turnClockMs(rules));
}

function parsedMs(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The turn deadline, or `null` when the turn clock is not this scheduler's to
 * enforce right now.
 *
 * Every `null` below is a deliberate hand-off rather than an oversight:
 *
 * - **A prompt addressed to the active player.** `turn.timeout` refuses outright
 *   while one is open ("a prompt addressed to the active player must be answered
 *   before the turn ends"), and answering *for* an absent human is a policy
 *   decision that already lives in `turn-timer/turn-timeout-policy.ts`. Firing
 *   here would produce a guaranteed rejection on every pass.
 * - **An open reaction window.** The window is what is blocking the turn, and
 *   expiring the window — which this same scan offers — is what unblocks it.
 *   Timing the turn out first would take a turn away from a player who is not
 *   actually the one being waited on.
 * - **A phase the behaviour cannot run in.** `auto-roll` forces the roll and so
 *   needs `pre-roll`; `auto-pass` ends the turn from anywhere.
 */
function turnDeadline(game: GameState, options: ExpiryScanOptions): ExpiryTarget | null {
  if (!options.turnClockEnabled) return null;
  if (game.status !== "active") return null;

  const activePlayerId = game.turn.activePlayerId;
  if (activePlayerId === null) return null;
  if (options.isBotSeat(activePlayerId)) return null;
  if (game.prompts.some((prompt) => prompt.audience.includes(activePlayerId))) return null;
  if (game.reactionWindows.length > 0) return null;
  if (game.rules.timers.onTimeout !== "auto-pass" && game.turn.phase !== "pre-roll") return null;

  // State first, always: if the engine ever starts populating this field, its
  // value is the truth and the derivation below must not override it.
  const fromState = parsedMs(game.turn.deadlineAt);
  if (fromState !== null && game.turn.deadlineAt !== null) {
    return {
      kind: "turn",
      id: String(game.turn.number),
      deadlineAt: game.turn.deadlineAt,
      deadlineMs: fromState,
      derived: false,
    };
  }

  const budgetMs = turnClockMs(game.rules);
  if (budgetMs <= 0) return null;
  const startedMs = parsedMs(game.turn.startedAt);
  if (startedMs === null) return null;

  const deadlineMs = startedMs + budgetMs;
  return {
    kind: "turn",
    id: String(game.turn.number),
    deadlineAt: new Date(deadlineMs).toISOString(),
    deadlineMs,
    derived: true,
  };
}

/**
 * Every resolvable currently carrying a deadline, in a deterministic order.
 *
 * A resolvable with no parseable deadline is absent rather than treated as
 * overdue: the engine writes `null` when it could not read its own timestamp,
 * and inventing a deadline for it would close a window nobody agreed to close.
 * Such a window is drained by the ordinary all-eligible-players-answered path,
 * or explicitly by an operator — never by a clock guessing.
 */
export function expiryTargets(
  game: GameState,
  options: ExpiryScanOptions,
): readonly ExpiryTarget[] {
  const targets: ExpiryTarget[] = [];

  for (const window of game.reactionWindows) {
    const deadlineMs = parsedMs(window.deadlineAt);
    if (deadlineMs === null || window.deadlineAt === null) continue;
    targets.push({
      kind: "reaction-window",
      id: String(window.id),
      deadlineAt: window.deadlineAt,
      deadlineMs,
      derived: false,
    });
  }

  // A reaction window is drainable after the match ends — one left open would
  // otherwise sit in every projection forever with nothing able to close it —
  // but `expireBallot` refuses outright unless the game is active, so a ballot
  // on a finished match is not a target this scheduler can do anything about.
  const ballots = game.status === "active" ? game.ballots : [];
  for (const ballot of ballots) {
    // Closing is a one-way door and the row stays behind with its deadline
    // still in the past. Offering it again would be an infinite supply of
    // DECISION_POINT_STALE rejections.
    if (ballot.resolution !== null) continue;
    const deadlineMs = parsedMs(ballot.deadlineAt);
    if (deadlineMs === null || ballot.deadlineAt === null) continue;
    targets.push({
      kind: "ballot",
      id: String(ballot.id),
      deadlineAt: ballot.deadlineAt,
      deadlineMs,
      derived: false,
    });
  }

  const turn = turnDeadline(game, options);
  if (turn !== null) targets.push(turn);

  return sortTargets(targets);
}

/**
 * Earliest deadline first, then by kind, then by id.
 *
 * Deterministic on purpose: two targets due at the same millisecond must be
 * fired in the same order on every process and every replay, or the same match
 * resolves differently depending on which server happened to wake up.
 */
function sortTargets(targets: readonly ExpiryTarget[]): readonly ExpiryTarget[] {
  return [...targets].sort((left, right) => {
    if (left.deadlineMs !== right.deadlineMs) return left.deadlineMs - right.deadlineMs;
    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}

/**
 * Everything already due at `nowIso`, earliest first.
 *
 * Inclusive of the deadline instant itself, and unbounded above: a deadline the
 * process slept through, crashed through or was never running for is still
 * returned, which is exactly what makes a restart mid-window recoverable.
 */
export function expiredExpiryTargets(
  game: GameState,
  nowIso: string,
  options: ExpiryScanOptions,
): readonly ExpiryTarget[] {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [];
  return expiryTargets(game, options).filter((target) => target.deadlineMs <= nowMs);
}

/**
 * The earliest deadline still in the future, or `null` when nothing is waiting.
 *
 * Separate from {@link nextExpiryDelayMs}: that answers "how long do we sleep"
 * (capped and floored), this answers "what are we waiting for" — and a log line
 * that names the window is what makes a stalled match diagnosable.
 */
export function nextExpiryTarget(
  game: GameState,
  nowIso: string,
  options: ExpiryScanOptions,
): ExpiryTarget | null {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return null;
  return expiryTargets(game, options).find((target) => target.deadlineMs > nowMs) ?? null;
}

/**
 * Milliseconds until the next deadline that has *not* yet passed, or `null` when
 * nothing is waiting.
 *
 * Capped by {@link expiryWakeupCapMs} and floored by {@link MINIMUM_WAKEUP_MS}.
 * An unreadable `nowIso` answers `null` rather than `0`: a broken clock must not
 * turn into a busy loop that closes every window in the game.
 */
export function nextExpiryDelayMs(
  game: GameState,
  nowIso: string,
  options: ExpiryScanOptions,
): number | null {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return null;

  const next = nextExpiryTarget(game, nowIso, options);
  if (next === null) return null;

  const capMs = expiryWakeupCapMs(game.rules);
  return Math.max(MINIMUM_WAKEUP_MS, Math.min(capMs, next.deadlineMs - nowMs));
}

/** How late a fire was, in milliseconds; never negative. */
export function expiryLatenessMs(target: ExpiryTarget, nowIso: string): number {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return 0;
  return Math.max(0, nowMs - target.deadlineMs);
}
