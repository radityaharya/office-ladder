import type {
  GameState,
  ModeRules,
  ObjectiveId,
  ObjectiveState,
  PlayerId,
  PlayerState,
  ResourceId,
  ResourceState,
  WinPath,
} from "../model";
import { createStableId } from "../model";

/**
 * What an objective measures. Every metric is read straight out of canonical
 * state, so progress is *derived* rather than accumulated: there is no counter to
 * drift, nothing to replay incorrectly, and a JSON round trip cannot lose a
 * partially-tracked objective.
 *
 * Deliberately a small, closed vocabulary. An objective must be something a
 * player can see themselves getting closer to, which rules out anything the
 * engine would have to book-keep behind their back.
 */
export type ObjectiveMetric =
  | "money"
  | "reputation"
  | "rank-index"
  | "work-counter"
  | "laps-completed"
  | "tiles-owned"
  | "projects-completed";

export type ObjectiveDefinition = {
  /** Stored on `ObjectiveState.definitionId`. */
  readonly id: string;
  /**
   * Which win path this objective belongs to. Two jobs: it decides whether the
   * objective is dealt at all (a wealth objective is never dealt in a mode where
   * wealth does not score), and it names the `MatchOutcome.winPath` when
   * completing it is what ends the match.
   */
  readonly winPath: WinPath;
  readonly metric: ObjectiveMetric;
  readonly target: number;
  readonly rewardPoints: number;
  readonly rewardMoney: number;
};

/**
 * The built-in objective catalogue.
 *
 * **This is a stand-in, and is meant to be replaced.** No objective content has
 * ever been authored (`packages/content` has board, characters, decks, modes,
 * ranks and global events, and nothing else), and `ObjectiveState.definitionId`
 * is a bare string precisely because the vocabulary had no home yet. The same
 * decision was taken once before for `DECK_FLAVOR_EFFECTS` in
 * `resolve-tile-effects.ts`, and it is recorded the same way: authoring real
 * objectives in the content pack and having `assignObjectives` read them is the
 * natural next step, not a code change here.
 *
 * Targets and rewards are first-pass and unplaytested. What is *not* provisional
 * is the shape: an objective names a win path, and the ruleset decides which win
 * paths exist, which is what keeps the whole mechanic switchable from config.
 *
 * `advanceObjectives` ignores any objective whose `definitionId` is not in this
 * list rather than guessing at it, so an objective seeded from somewhere else
 * (authored content later, a test fixture now) is left strictly alone.
 */
export const OBJECTIVE_DEFINITIONS: readonly ObjectiveDefinition[] = [
  {
    id: "objective.make-the-shortlist",
    winPath: "promotion",
    metric: "rank-index",
    target: 4,
    rewardPoints: 600,
    rewardMoney: 0,
  },
  {
    id: "objective.corner-office",
    winPath: "promotion",
    metric: "rank-index",
    target: 6,
    rewardPoints: 1000,
    rewardMoney: 0,
  },
  {
    id: "objective.billable-hours",
    winPath: "promotion",
    metric: "work-counter",
    target: 15,
    rewardPoints: 500,
    rewardMoney: 0,
  },
  {
    id: "objective.reserve-fund",
    winPath: "wealth",
    metric: "money",
    target: 3000,
    rewardPoints: 500,
    rewardMoney: 0,
  },
  {
    id: "objective.discretionary-budget",
    winPath: "wealth",
    metric: "money",
    target: 6000,
    rewardPoints: 900,
    rewardMoney: 0,
  },
  {
    id: "objective.floor-space",
    winPath: "wealth",
    metric: "tiles-owned",
    target: 3,
    rewardPoints: 700,
    rewardMoney: 0,
  },
  {
    id: "objective.name-on-the-door",
    winPath: "influence",
    metric: "reputation",
    target: 10,
    rewardPoints: 500,
    rewardMoney: 250,
  },
  {
    id: "objective.everyone-knows-you",
    winPath: "influence",
    metric: "reputation",
    target: 18,
    rewardPoints: 900,
    rewardMoney: 500,
  },
  {
    id: "objective.delivery-record",
    winPath: "influence",
    metric: "projects-completed",
    target: 2,
    rewardPoints: 700,
    rewardMoney: 0,
  },
  {
    id: "objective.still-here",
    winPath: "survival",
    metric: "laps-completed",
    target: 4,
    rewardPoints: 600,
    rewardMoney: 0,
  },
];

/** How many objectives each player is dealt when nothing says otherwise. */
export const DEFAULT_OBJECTIVES_PER_PLAYER = 1;

export type AssignObjectivesOptions = {
  /** Defaults to `DEFAULT_OBJECTIVES_PER_PLAYER`. */
  readonly perPlayer?: number;
  /** Defaults to `OBJECTIVE_DEFINITIONS`; authored content can replace it wholesale. */
  readonly definitions?: readonly ObjectiveDefinition[];
};

export type ObjectiveResourceChange = {
  readonly playerId: PlayerId;
  readonly resourceId: ResourceId;
  /** The key the resource lives under in `PlayerState.resources`. */
  readonly resourceKey: string;
  readonly previousValue: number;
  readonly newValue: number;
};

export type ObjectiveCompletion = {
  readonly objectiveId: ObjectiveId;
  readonly definitionId: string;
  /** `null` for a table-wide objective. */
  readonly playerId: PlayerId | null;
  readonly winPath: WinPath | null;
  readonly rewardPoints: number;
  /** What was actually paid, which is `rewardMoney` unless the player has no wallet. */
  readonly rewardMoneyPaid: number;
  readonly completedAtRound: number;
};

export type ObjectiveProgressResult = {
  readonly objectives: readonly ObjectiveState[];
  /** The whole player map with any reward paid in, ready to be used as-is. */
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly completed: readonly ObjectiveCompletion[];
  readonly changes: readonly ObjectiveResourceChange[];
};

/**
 * Whether this ruleset plays with objectives at all.
 *
 * Two independent reasons to have them, and either is enough: the mode resolves
 * *on* them (`winShape: "objectives"`), or it hands out secret ones as a scoring
 * side-channel (`hidden.secretObjectives`, which `mode.standard` and
 * `mode.marathon` both switch on while resolving on quarters). `mode.quick` has
 * neither, and deals none.
 */
export function objectivesEnabled(rules: ModeRules): boolean {
  return rules.winShape === "objectives" || rules.hidden.secretObjectives;
}

/**
 * The definitions this ruleset can legally deal.
 *
 * A definition survives only when its win path scores *and* the subsystem its
 * metric reads from is switched on — dealing "own three tiles" in a mode with
 * `board.ownershipEnabled: false` would be an objective nobody could ever
 * complete.
 */
export function eligibleObjectiveDefinitions(
  rules: ModeRules,
  definitions: readonly ObjectiveDefinition[] = OBJECTIVE_DEFINITIONS,
): readonly ObjectiveDefinition[] {
  return definitions.filter((definition) => {
    if (!rules.winPaths[definition.winPath]) return false;
    if (definition.metric === "tiles-owned" && !rules.board.ownershipEnabled) return false;
    if (definition.metric === "projects-completed" && !rules.projects.enabled) return false;

    return true;
  });
}

function findResourceEntry(
  player: PlayerState,
  kind: ResourceState["kind"],
): readonly [string, ResourceState] | undefined {
  return Object.entries(player.resources).find(([, resource]) => resource.kind === kind);
}

function resourceValue(player: PlayerState, kind: ResourceState["kind"]): number {
  return findResourceEntry(player, kind)?.[1].value ?? 0;
}

function measureForPlayer(
  state: GameState,
  players: Readonly<Record<string, PlayerState>>,
  metric: ObjectiveMetric,
  playerId: PlayerId,
): number {
  const player = players[playerId];
  if (player === undefined) return 0;

  switch (metric) {
    case "money":
      return resourceValue(player, "resource.money");
    case "reputation":
      return resourceValue(player, "resource.reputation");
    case "work-counter":
      return resourceValue(player, "resource.work-counter");
    case "rank-index":
      return player.rank.index;
    case "laps-completed":
      return player.lapsCompleted;
    case "tiles-owned":
      // Counting is order-independent, so reading the ownership record's values
      // is safe here in a way that *ordering* by them would not be.
      return Object.values(state.tileOwnership).filter(
        (ownership) => ownership.ownerId === playerId,
      ).length;
    case "projects-completed":
      return state.projects.filter(
        (project) =>
          project.status === "completed" &&
          (project.leadPlayerId === playerId ||
            project.contributions.some((contribution) => contribution.playerId === playerId)),
      ).length;
    default:
      return metric satisfies never;
  }
}

/**
 * The raw, unclamped measurement behind an objective's progress.
 *
 * A table-wide objective (`ownerId: null`) takes the best any seated player has
 * managed, walked in `playerOrder` so the maximum is found the same way on every
 * replay even though `Math.max` does not care about order.
 */
export function measureObjective(
  state: GameState,
  metric: ObjectiveMetric,
  ownerId: PlayerId | null,
  players: Readonly<Record<string, PlayerState>> = state.players,
): number {
  if (ownerId !== null) {
    return measureForPlayer(state, players, metric, ownerId);
  }

  let best = 0;
  for (const seatId of state.playerOrder) {
    if (state.eliminatedPlayerIds.includes(seatId)) continue;
    const value = measureForPlayer(state, players, metric, seatId);
    if (value > best) best = value;
  }

  return best;
}

export function findObjectiveDefinition(
  definitionId: string,
  definitions: readonly ObjectiveDefinition[] = OBJECTIVE_DEFINITIONS,
): ObjectiveDefinition | null {
  return definitions.find((definition) => definition.id === definitionId) ?? null;
}

function clampProgress(value: number, target: number): number {
  if (value < 0) return 0;

  return value > target ? target : value;
}

/**
 * Deals each seat its objectives at `game.start`.
 *
 * Deterministic and unseeded on purpose: the deal walks `playerOrder` and takes
 * definitions from the eligible list by rotation, so it re-derives identically on
 * replay and consumes none of the game's randomness. Randomising it would buy
 * variety at the cost of one more stream to keep in step, and the eligible list
 * is already mode-dependent.
 *
 * Objectives are `secret` exactly when the ruleset says hidden information is on;
 * everything downstream (projections, the score screen) reads that field rather
 * than re-deciding.
 */
export function assignObjectives(
  state: GameState,
  options: AssignObjectivesOptions = {},
): readonly ObjectiveState[] {
  if (!objectivesEnabled(state.rules)) return [];

  const definitions = eligibleObjectiveDefinitions(state.rules, options.definitions);
  if (definitions.length === 0) return [];

  const perPlayer = Math.max(0, options.perPlayer ?? DEFAULT_OBJECTIVES_PER_PLAYER);
  const visibility = state.rules.hidden.secretObjectives ? "secret" : "public";
  const objectives: ObjectiveState[] = [];

  state.playerOrder.forEach((playerId, seatIndex) => {
    for (let slot = 0; slot < perPlayer; slot += 1) {
      const definition = definitions[(seatIndex * perPlayer + slot) % definitions.length];
      if (definition === undefined) continue;

      objectives.push({
        // Keyed by seat and slot, never by definition. `ObjectiveState.id` is
        // published in full to every viewer (a secret objective projects as
        // existence-only, which means its id is the part that is *not* redacted),
        // so an id built from the definition id would hand the whole table the
        // contents of every secret objective in the game. Caught by a projection
        // test, which is exactly the sort of leak §7.2 warns is structural rather
        // than accidental.
        id: createStableId("ObjectiveId", `${state.gameId}:objective:${playerId}:${slot}`),
        definitionId: definition.id,
        ownerId: playerId,
        progress: clampProgress(
          measureObjective(state, definition.metric, playerId),
          definition.target,
        ),
        target: definition.target,
        completedAtRound: null,
        visibility,
        rewardPoints: definition.rewardPoints,
        rewardMoney: definition.rewardMoney,
      });
    }
  });

  return objectives;
}

function payReward(
  player: PlayerState,
  amount: number,
): { readonly player: PlayerState; readonly change: ObjectiveResourceChange | null } {
  if (amount <= 0) return { player, change: null };

  const money = findResourceEntry(player, "resource.money");
  if (money === undefined) return { player, change: null };

  const [key, resource] = money;
  const newValue = resource.value + amount;

  return {
    player: {
      ...player,
      resources: { ...player.resources, [key]: { ...resource, value: newValue } },
    },
    change: {
      playerId: player.id,
      resourceId: resource.id,
      resourceKey: key,
      previousValue: resource.value,
      newValue,
    },
  };
}

/**
 * Re-measures every open objective and completes the ones that have arrived.
 *
 * Completion is **permanent**: an objective that has been met keeps its
 * `completedAtRound` even if the player then spends the money back down, which is
 * why progress can be re-derived from live state without the mechanic becoming
 * take-backs. Everything else is recomputed from scratch each time, so calling
 * this twice for the same round is a no-op the second time.
 *
 * `players` lets the caller pass the map *as their transition leaves it* — the
 * turn that pushed a player over the line is the turn it should complete on, not
 * the one after.
 */
export function advanceObjectives(
  state: GameState,
  round: number,
  players: Readonly<Record<string, PlayerState>> = state.players,
  definitions: readonly ObjectiveDefinition[] = OBJECTIVE_DEFINITIONS,
): ObjectiveProgressResult {
  if (!objectivesEnabled(state.rules) || state.objectives.length === 0) {
    return { objectives: state.objectives, players, completed: [], changes: [] };
  }

  let updatedPlayers = players;
  const objectives: ObjectiveState[] = [];
  const completed: ObjectiveCompletion[] = [];
  const changes: ObjectiveResourceChange[] = [];

  for (const objective of state.objectives) {
    const definition = findObjectiveDefinition(objective.definitionId, definitions);
    if (definition === null || objective.completedAtRound !== null) {
      objectives.push(objective);
      continue;
    }

    const progress = clampProgress(
      measureObjective(state, definition.metric, objective.ownerId, updatedPlayers),
      objective.target,
    );
    if (progress < objective.target) {
      objectives.push(progress === objective.progress ? objective : { ...objective, progress });
      continue;
    }

    const owner = objective.ownerId === null ? undefined : updatedPlayers[objective.ownerId];
    const paid = owner === undefined ? null : payReward(owner, objective.rewardMoney);
    if (paid !== null && paid.change !== null) {
      updatedPlayers = { ...updatedPlayers, [paid.player.id]: paid.player };
      changes.push(paid.change);
    }

    objectives.push({ ...objective, progress, completedAtRound: round });
    completed.push({
      objectiveId: objective.id,
      definitionId: objective.definitionId,
      playerId: objective.ownerId,
      winPath: definition.winPath,
      rewardPoints: objective.rewardPoints,
      rewardMoneyPaid: paid?.change === null || paid === null ? 0 : objective.rewardMoney,
      completedAtRound: round,
    });
  }

  return { objectives, players: updatedPlayers, completed, changes };
}

/**
 * Total objective score for one player: the reward points of every objective
 * they own and have completed.
 *
 * Table-wide objectives (`ownerId: null`) score nobody. They are a shared goal
 * the whole table can watch, and canonical state does not record which player's
 * measurement completed one, so attributing their points to anybody would be a
 * guess.
 */
export function objectivePointsFor(state: GameState, playerId: PlayerId): number {
  return state.objectives.reduce(
    (total, objective) =>
      objective.ownerId === playerId && objective.completedAtRound !== null
        ? total + objective.rewardPoints
        : total,
    0,
  );
}

export type ObjectiveWinner = {
  readonly playerId: PlayerId;
  /** The completed objective that names the win path, richest reward first. */
  readonly objectiveId: ObjectiveId;
  readonly winPath: WinPath | null;
};

/**
 * Every player who has completed all of the objectives they were dealt.
 *
 * Ungated on purpose — it answers "who is finished", and *whether that ends the
 * match* is the ruleset's business (`winShape: "objectives"`), decided in
 * `evaluateMatchEnd`. A player with no objectives is never finished, so a mode
 * that deals none can never trip this.
 *
 * Walks `playerOrder`, so a round in which two players finish together returns
 * them in seat order and the resulting outcome is a stable draw rather than a
 * race between object keys.
 */
export function playersWithAllObjectivesComplete(
  state: GameState,
  definitions: readonly ObjectiveDefinition[] = OBJECTIVE_DEFINITIONS,
): readonly ObjectiveWinner[] {
  const winners: ObjectiveWinner[] = [];

  for (const playerId of state.playerOrder) {
    if (state.eliminatedPlayerIds.includes(playerId)) continue;

    const owned = state.objectives.filter((objective) => objective.ownerId === playerId);
    if (owned.length === 0) continue;
    if (owned.some((objective) => objective.completedAtRound === null)) continue;

    // The richest completed objective names the path; ties fall back to the
    // order the objectives sit in canonical state, which survives a JSON round
    // trip because it is an array.
    let best = owned[0];
    if (best === undefined) continue;
    for (const objective of owned) {
      if (objective.rewardPoints > best.rewardPoints) best = objective;
    }

    winners.push({
      playerId,
      objectiveId: best.id,
      winPath: findObjectiveDefinition(best.definitionId, definitions)?.winPath ?? null,
    });
  }

  return winners;
}
