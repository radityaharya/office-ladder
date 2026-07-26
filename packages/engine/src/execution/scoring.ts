import type {
  GameState,
  JsonObject,
  MatchOutcome,
  ModeRules,
  PlayerId,
  PlayerState,
  ResourceState,
  ScoreBreakdown,
  WinPath,
} from "../model";
import { objectivePointsFor, playersWithAllObjectivesComplete } from "./objectives";
import { quartersElapsed } from "./quarters";
import type { TransitionContent } from "./types";

/**
 * Every weight the score sheet needs.
 *
 * The first three are authored: they are the `endgame.scoring` block that has sat
 * in `mode.marathon` since the content pack was written and has never had a
 * consumer. They are read from content rather than restated here.
 *
 * The last four have no authored home yet — `ScoreBreakdown` asks for ownership,
 * project and penalty columns and `ModeConfig` has no numbers for them — so they
 * are *derived* from the authored three rather than invented, and every one of
 * them is overridable by the caller. See `DERIVED_WEIGHT_NOTES`.
 */
export type ScoringConfig = {
  readonly rankTierPoints: number;
  readonly moneyMultiplier: number;
  readonly reputationPoints: number;
  readonly ownershipPointsPerLevel: number;
  readonly projectCompletionPoints: number;
  readonly missedUpkeepPenaltyPoints: number;
  readonly debtMultiplier: number;
};

/**
 * The authored weights, repeated here only as the fallback for a mode whose
 * `endgame` is `{ type: "immediate" }`.
 *
 * A race mode ends the moment somebody reaches Director and has no scoring block
 * of its own, but `MatchOutcome.scores` is filled in whatever the end reason is —
 * the end screen shows the table how close it was — so a race still needs a
 * scale. Reusing marathon's is the only choice that keeps two matches of
 * different modes comparable.
 */
export const FALLBACK_SCORING_WEIGHTS = {
  rankTierPoints: 1000,
  moneyMultiplier: 0.1,
  reputationPoints: 50,
} as const;

export const DERIVED_WEIGHT_NOTES: readonly string[] = [
  "`ownershipPointsPerLevel` = `reputationPoints`: a claimed tile level is worth one point of reputation. Upgrades scale it linearly, so a level-2 tile scores three times a bare claim.",
  "`projectCompletionPoints` = `rankTierPoints` / 2: a delivered project is worth half a promotion, split between its contributors.",
  "`missedUpkeepPenaltyPoints` = `reputationPoints` x 2: missing a charge costs more than one point of reputation earns, so upkeep is a real obligation rather than an optional one.",
  "`debtMultiplier` = `moneyMultiplier`: money you owe scores as negative money at exactly the rate money scores positively, so borrowing is neutral at the buzzer and only the interest hurts.",
];

/**
 * The mode's own scoring block, or the fallback when it has none.
 *
 * `modeId` is a plain string for the same reason `resolvePromotion` takes one:
 * `GameState.modeId` is branded, content keys are literals, and the lookup is a
 * find rather than an index.
 */
export function resolveScoringConfig(
  content: TransitionContent,
  modeId: string,
  overrides: Partial<ScoringConfig> = {},
): ScoringConfig {
  const mode = Object.values(content.modes).find((candidate) => candidate.id === modeId);
  const authored =
    mode !== undefined && mode.endgame.type === "additional-rounds"
      ? mode.endgame.scoring
      : FALLBACK_SCORING_WEIGHTS;

  return {
    rankTierPoints: authored.rankTierPoints,
    moneyMultiplier: authored.moneyMultiplier,
    reputationPoints: authored.reputationPoints,
    ownershipPointsPerLevel: authored.reputationPoints,
    projectCompletionPoints: authored.rankTierPoints / 2,
    missedUpkeepPenaltyPoints: authored.reputationPoints * 2,
    debtMultiplier: authored.moneyMultiplier,
    ...overrides,
  };
}

/**
 * Points are whole numbers.
 *
 * `moneyMultiplier` is 0.1, so an unrounded money column would put values like
 * 123.30000000000001 into canonical state, and canonical state goes through
 * `JSON.parse(JSON.stringify(...))` on every save. Rounding at the point of
 * production keeps a score that survives the boundary and a total that is the
 * sum of the columns the player can see.
 */
function points(value: number): number {
  return Math.round(value);
}

function resourceValue(player: PlayerState, kind: ResourceState["kind"]): number {
  return (
    Object.values(player.resources).find((resource) => resource.kind === kind)?.value ?? 0
  );
}

function ownershipPoints(
  state: GameState,
  playerId: PlayerId,
  config: ScoringConfig,
): number {
  if (!state.rules.board.ownershipEnabled) return 0;

  // A sum, so record iteration order cannot change the answer.
  return Object.values(state.tileOwnership).reduce(
    (total, ownership) =>
      ownership.ownerId === playerId
        ? total + (ownership.level + 1) * config.ownershipPointsPerLevel
        : total,
    0,
  );
}

/**
 * A completed project pays its contributors.
 *
 * The lead takes `leadBonusBasisPoints` off the top — the authored field that
 * exists precisely for this — and the rest is split by money contributed, which
 * is the only contribution unit that is comparable across players. A project
 * completed on work alone splits evenly rather than paying nobody.
 */
function projectPoints(
  state: GameState,
  playerId: PlayerId,
  config: ScoringConfig,
): number {
  if (!state.rules.projects.enabled) return 0;

  let total = 0;
  for (const project of state.projects) {
    if (project.status !== "completed") continue;

    const pool = config.projectCompletionPoints;
    const leadShare = points((pool * project.leadBonusBasisPoints) / 10_000);
    const remainder = pool - leadShare;
    const contributedMoney = project.contributions.reduce(
      (sum, contribution) => sum + contribution.money,
      0,
    );
    const mine = project.contributions
      .filter((contribution) => contribution.playerId === playerId)
      .reduce((sum, contribution) => sum + contribution.money, 0);

    if (project.leadPlayerId === playerId) total += leadShare;

    if (contributedMoney > 0) {
      total += points((remainder * mine) / contributedMoney);
      continue;
    }

    const contributors = state.playerOrder.filter((seatId) =>
      project.contributions.some((contribution) => contribution.playerId === seatId),
    );
    if (contributors.includes(playerId) && contributors.length > 0) {
      total += points(remainder / contributors.length);
    }
  }

  return total;
}

function penaltyPoints(
  state: GameState,
  player: PlayerState,
  config: ScoringConfig,
): number {
  const outstanding = player.loans.reduce((sum, loan) => sum + loan.outstanding, 0);

  return (
    player.upkeep.missedPayments * config.missedUpkeepPenaltyPoints +
    points(outstanding * config.debtMultiplier)
  );
}

/**
 * One player's score sheet.
 *
 * Every column is gated on the ruleset: a mode where wealth does not score has a
 * zero money column rather than a hidden one, so the breakdown is the same shape
 * in every mode and the UI can render it without knowing which paths are on.
 */
export function scorePlayer(
  state: GameState,
  playerId: PlayerId,
  config: ScoringConfig,
): ScoreBreakdown {
  const player = state.players[playerId];
  if (player === undefined) {
    return {
      playerId,
      rankPoints: 0,
      moneyPoints: 0,
      reputationPoints: 0,
      objectivePoints: 0,
      ownershipPoints: 0,
      projectPoints: 0,
      penaltyPoints: 0,
      total: 0,
    };
  }

  const rankPoints = state.rules.winPaths.promotion
    ? player.rank.index * config.rankTierPoints
    : 0;
  const moneyPoints = state.rules.winPaths.wealth
    ? points(resourceValue(player, "resource.money") * config.moneyMultiplier)
    : 0;
  const reputationPoints = state.rules.winPaths.influence
    ? points(resourceValue(player, "resource.reputation") * config.reputationPoints)
    : 0;
  const objectivePoints = objectivePointsFor(state, playerId);
  const owned = ownershipPoints(state, playerId, config);
  const projects = projectPoints(state, playerId, config);
  const penalties = penaltyPoints(state, player, config);

  return {
    playerId,
    rankPoints,
    moneyPoints,
    reputationPoints,
    objectivePoints,
    ownershipPoints: owned,
    projectPoints: projects,
    penaltyPoints: penalties,
    total:
      rankPoints +
      moneyPoints +
      reputationPoints +
      objectivePoints +
      owned +
      projects -
      penalties,
  };
}

/** Every seat's score sheet, in `playerOrder`. Eliminated players are included. */
export function scoreMatch(
  state: GameState,
  config: ScoringConfig,
): readonly ScoreBreakdown[] {
  return state.playerOrder.map((playerId) => scorePlayer(state, playerId, config));
}

/**
 * The highest total, and everybody who tied for it.
 *
 * Walks `playerOrder` and keeps the strict maximum, so a draw is reported as a
 * draw rather than resolved by whichever seat the comparison happened to see
 * first.
 */
export function leadingScores(
  scores: readonly ScoreBreakdown[],
): readonly PlayerId[] {
  let best = Number.NEGATIVE_INFINITY;
  for (const score of scores) {
    if (score.total > best) best = score.total;
  }

  return scores.filter((score) => score.total === best).map((score) => score.playerId);
}

/**
 * Which path a scored win was won on: the enabled path that contributed most to
 * the winner's total.
 *
 * The `promotion → wealth → influence` tiebreak is fixed rather than clever, so
 * that a player who scored identically on two paths always gets the same answer.
 * `survival` is never inferred from a column — nothing in `ScoreBreakdown`
 * measures it — so it is only ever the answer when the match ended by everybody
 * else being gone, which `evaluateMatchEnd` passes in explicitly.
 */
export function winPathFor(
  breakdown: ScoreBreakdown | undefined,
  rules: ModeRules,
): WinPath | null {
  if (breakdown === undefined) return null;

  const candidates: readonly { readonly path: WinPath; readonly value: number }[] = [
    { path: "promotion", value: rules.winPaths.promotion ? breakdown.rankPoints : 0 },
    { path: "wealth", value: rules.winPaths.wealth ? breakdown.moneyPoints : 0 },
    { path: "influence", value: rules.winPaths.influence ? breakdown.reputationPoints : 0 },
  ];

  let best: { readonly path: WinPath; readonly value: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.value <= 0) continue;
    if (best === null || candidate.value > best.value) best = candidate;
  }

  return best?.path ?? null;
}

export type MatchEndOptions = {
  /** The round the match would be entering. */
  readonly round: number;
  readonly endedAt: string;
  readonly config?: ScoringConfig;
};

/**
 * The end-of-match check for every win shape that is not the race.
 *
 * Returns null when the match keeps going, which is the overwhelmingly common
 * answer, so this is safe to call on every turn hand-off. It never re-ends a
 * finished match: an outcome already in canonical state is left alone, which is
 * what makes it idempotent under the server re-injecting a boundary command.
 *
 * The race win (reaching Director) is **not** here. It is decided inside the roll
 * transition, where the promotion that triggers it happens, and duplicating it
 * would mean two places could disagree about who won. What this does offer that
 * transition is `scoreMatch`, so a race outcome can still carry a full score
 * sheet instead of the empty array it ships today.
 *
 * Precedence is deliberate: being the last player standing beats everything
 * (there is nobody left to score against), completing your objectives beats the
 * clock (you finished before it ran out), and the clock is the fallback.
 *
 * The clock is checked whatever the win shape, not only for `fixed-length`. A
 * ruleset that switches quarters on has declared a length, and a match that runs
 * past its own schedule has to end somewhere — `mode.quick` never reaches this
 * because it has no quarters at all, which is the switch that actually controls
 * it.
 */
export function evaluateMatchEnd(
  state: GameState,
  content: TransitionContent,
  options: MatchEndOptions,
): MatchOutcome | null {
  if (state.outcome !== null || state.status !== "active") return null;

  const config = options.config ?? resolveScoringConfig(content, state.modeId);
  const scores = scoreMatch(state, config);
  const survivors = state.playerOrder.filter(
    (playerId) => !state.eliminatedPlayerIds.includes(playerId),
  );
  const outcome = (
    reason: MatchOutcome["reason"],
    winnerPlayerIds: readonly PlayerId[],
    winPath: WinPath | null,
    data: JsonObject,
  ): MatchOutcome => ({
    reason,
    winnerPlayerIds,
    // Hidden roles are cosmetic and leaky today (spec §7.2 says make them real or
    // delete them), so no outcome claims a role won anything.
    winningRole: null,
    endedAt: options.endedAt,
    scores,
    winPath,
    data,
  });

  if (
    state.rules.conflict.elimination &&
    state.eliminatedPlayerIds.length > 0 &&
    survivors.length <= 1
  ) {
    return outcome(
      "last-standing",
      survivors,
      state.rules.winPaths.survival ? "survival" : null,
      { round: options.round },
    );
  }

  if (state.rules.winShape === "objectives") {
    const finished = playersWithAllObjectivesComplete(state);
    if (finished.length > 0) {
      const winners = finished.map((entry) => entry.playerId);
      // Every finisher's own objective names a path; with a draw the first seat's
      // is used, matching the order `playersWithAllObjectivesComplete` walks.
      return outcome("objectives-complete", winners, finished[0]?.winPath ?? null, {
        round: options.round,
        objectiveIds: finished.map((entry) => entry.objectiveId),
      });
    }
  }

  if (quartersElapsed(state, options.round)) {
    const winners = leadingScores(scores);
    const winner = scores.find((score) => score.playerId === winners[0]);

    return outcome("quarters-elapsed", winners, winPathFor(winner, state.rules), {
      round: options.round,
    });
  }

  return null;
}
