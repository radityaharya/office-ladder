import type { ModeRules } from "@office-ladder/content";

import type {
  ContributeToProjectCommand,
  GameCommand,
  SabotageProjectCommand,
  StartProjectCommand,
} from "../commands";
import type {
  GameEvent,
  PromptOpenedEvent,
  ResourceChangedEvent,
} from "../events";
import {
  createStableId,
  type GameState,
  type PlayerId,
  type PlayerState,
  type ProjectContribution,
  type ProjectId,
  type ProjectPayout,
  type ProjectSabotage,
  type ProjectState,
  type ProjectStatus,
  type PromptState,
  type ResourceId,
  type ResourceState,
  type TileId,
} from "../model";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import { buildInvestigationPrompt, raiseHeat } from "./heat";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Projects — the gameplay-v2 centrepiece (plans/24-gameplay-v2-spec.md §5.2).
 *
 * A project is the one object that is simultaneously a money sink, a thing
 * placed in shared space, a reason to co-operate, and a thing worth ruining.
 * Everything here is a pure transition over `GameState`: no clock, no ambient
 * randomness, no key-order iteration that could change an outcome.
 *
 * ## The incentive this design deliberately resolves
 *
 * The failure mode of any "join a shared pot" mechanic is that joining strictly
 * dominates leading, so nobody ever leads and the mechanic is dead content.
 * Four properties keep leading worth doing:
 *
 * 1. **The pot is fixed, and shares are pro rata.** `payout.money` does not grow
 *    with contributions, so every additional contributor dilutes every existing
 *    one. Joining is therefore *finite* value, not free value, and there is a
 *    race to be early rather than a queue to be late.
 * 2. **The lead is by construction the earliest contributor.** `project.start`
 *    charges `leadStakeMoney` and records it as contribution #0, so the lead
 *    enters the pot when it is at its least diluted. That is the whole reason
 *    the return is worth chasing at all.
 * 3. **The lead takes `leadBonusBasisPoints` off the top** before pro-rata
 *    distribution, on top of their own share.
 * 4. **The lead is paid for that with risk.** On failure every contributor loses
 *    their contribution outright (it was spent when it was made — that is the
 *    money sink) *and* a pro-rata slice of `failureReputationPenalty`, while the
 *    lead takes the full penalty flat. Leading is a positive-expectation bet
 *    only if you actually believe the thing will land.
 *
 * So: leading beats joining when you can finish it, joining beats abstaining
 * whenever the pot is still underfunded, and abstaining beats joining a project
 * you expect to fail. No branch of that is ever a dominated non-decision.
 *
 * ## Hidden sabotage never leaks (spec §7.3)
 *
 * `ProjectStatus` is a function of *gross* contributions only — never of
 * sabotage — so a project sitting on hidden damage still reads as `funded` to
 * the whole table, including its lead. Nothing about a project's public shape
 * changes when it is secretly sabotaged. That is also why hidden sabotage does
 * **not** raise heat at the moment it is committed: `HeatState` is deliberately
 * public (see `PublicPlayerProjection`), so an immediate bump would announce
 * "somebody just attacked something" on the exact turn it happened. Hidden
 * sabotage's heat lands at resolution, when it is revealed — you get away with
 * it right up until the post-mortem.
 */

/** Basis-point denominator. Not a tunable — it is what "basis point" means. */
const BASIS_POINTS = 10_000;

/**
 * The authored parameters of one kind of project.
 *
 * These are **content**, not mode rules: mode rules decide whether projects
 * exist at all and how long they run (`rules.projects.*`), while a definition
 * decides what one specific project costs and pays. `packages/content` has not
 * authored a project catalog yet, so `DEFAULT_PROJECT_DEFINITIONS` below stands
 * in for one — the same honest stopgap `DECK_FLAVOR_EFFECTS` is for the
 * unauthored management decks. When real definitions land, pass them through
 * `ProjectCommandOptions.definitions` and delete nothing else.
 */
export interface ProjectDefinition {
  readonly id: string;
  /** Gross money the contributions must reach. */
  readonly requiredMoney: number;
  /** Gross work the contributions must reach, *before* sabotage is netted off. */
  readonly requiredWork: number;
  /**
   * What one point of work is worth, in money, when shares are computed.
   *
   * Money and work are different units and the split has to weigh them against
   * each other somehow. Doing it by normalising each against its own
   * requirement (`money/requiredMoney + work/requiredWork`) sounds neutral and
   * is not: it makes the two tracks co-equal regardless of what they cost, and
   * since a work counter is far cheaper to come by than cash, it quietly makes
   * every money contribution loss-making. An explicit authored exchange rate
   * keeps the whole split money-denominated and lets a definition price its own
   * labour.
   */
  readonly workValueMoney: number;
  /** Money the lead stakes at `project.start`, recorded as their first contribution. */
  readonly leadStakeMoney: number;
  /** The whole pot. Fixed: it does not scale with how much was put in. */
  readonly payout: ProjectPayout;
  /** The lead's slice of the pot, taken before the pro-rata split. */
  readonly leadBonusBasisPoints: number;
  /**
   * Reputation the lead loses outright on failure. Non-lead contributors split
   * the same number pro rata, so the lead always carries strictly more downside
   * than anyone who merely joined.
   */
  readonly failureReputationPenalty: number;
  /** Money a saboteur pays per point of damage to keep the sabotage hidden. */
  readonly hiddenSabotageMoneyPerWork: number;
}

/**
 * A stand-in catalog until `packages/content` authors real project definitions.
 *
 * Deliberately three rungs so the decision "which project do I lead" exists at
 * all: a cheap one you can finish alone, a middle one that needs one partner,
 * and a big one nobody funds without the table. Each pays roughly 1.85x its
 * total money-equivalent requirement (`requiredMoney + requiredWork *
 * workValueMoney`), which is the number that has to clear 1.0 or contributing
 * is a donation, and each rung pays a slightly better multiple and a bigger
 * lead bonus than the one below so the big project is the one worth leading and
 * the one nobody can fill alone. Every one requires work, so every one is
 * sabotageable. **Unplaytested.**
 */
export const DEFAULT_PROJECT_DEFINITIONS: readonly ProjectDefinition[] = [
  {
    id: "project.quarterly-report",
    requiredMoney: 300,
    requiredWork: 3,
    workValueMoney: 100,
    leadStakeMoney: 150,
    payout: { money: 1_100, reputation: 4, objectiveProgress: 1 },
    leadBonusBasisPoints: 1_500,
    failureReputationPenalty: 2,
    hiddenSabotageMoneyPerWork: 100,
  },
  {
    id: "project.office-relocation",
    requiredMoney: 800,
    requiredWork: 6,
    workValueMoney: 150,
    leadStakeMoney: 400,
    payout: { money: 3_200, reputation: 8, objectiveProgress: 2 },
    leadBonusBasisPoints: 2_000,
    failureReputationPenalty: 3,
    hiddenSabotageMoneyPerWork: 150,
  },
  {
    id: "project.product-launch",
    requiredMoney: 1_600,
    requiredWork: 10,
    workValueMoney: 200,
    leadStakeMoney: 800,
    payout: { money: 7_000, reputation: 14, objectiveProgress: 3 },
    leadBonusBasisPoints: 2_500,
    failureReputationPenalty: 5,
    hiddenSabotageMoneyPerWork: 200,
  },
];

export type ProjectCommandOptions = {
  /**
   * The project catalog to resolve `definitionId` against.
   *
   * **Pass the same catalog to `resolveDueProjects` that you passed to
   * `startProject`.** `ProjectState` cannot carry `workValueMoney` or
   * `failureReputationPenalty` (its shape is fixed by the spec), so resolution
   * has to look the definition up again; a mismatched catalog would price the
   * split differently from the one the project was started under.
   */
  readonly definitions?: readonly ProjectDefinition[];
};

export type ProjectResolutionOptions = ProjectCommandOptions & {
  /**
   * The player map to apply payouts over. Defaults to `state.players`, but the
   * turn transition has usually already rebuilt it (skip-turn decrements,
   * burnout refills) by the time projects resolve, and layering payouts onto
   * `state.players` would silently discard that work.
   */
  readonly players?: Readonly<Record<string, PlayerState>>;
  /** The project array to resolve over. Defaults to `state.projects`. */
  readonly projects?: readonly ProjectState[];
};

/** One resource mutation, shaped so a caller can emit `ResourceChanged` verbatim. */
export type ProjectResourceChange = {
  readonly playerId: PlayerId;
  readonly resourceId: ResourceId;
  readonly previousValue: number;
  readonly newValue: number;
  readonly reason: string;
};

export type ProjectShare = {
  readonly playerId: PlayerId;
  readonly money: number;
  readonly reputation: number;
};

/** One project that crossed its deadline during a single `resolveDueProjects` call. */
export type ResolvedProject = {
  readonly projectId: ProjectId;
  readonly definitionId: string;
  readonly leadPlayerId: PlayerId;
  readonly status: Extract<ProjectStatus, "completed" | "failed">;
  readonly grossMoney: number;
  readonly grossWork: number;
  readonly sabotagedWork: number;
  /** `grossWork - sabotagedWork`: what the deadline check actually measures. */
  readonly netWork: number;
  /** Positive awards on success; empty on failure. */
  readonly payouts: readonly ProjectShare[];
  /** Negative reputation deltas on failure; empty on success. */
  readonly penalties: readonly ProjectShare[];
  /** Surfaced for the objectives mechanic; this module does not touch objectives. */
  readonly objectiveProgress: number;
  /** Saboteurs whose `hidden` entry was flipped public by this resolution. */
  readonly revealedSaboteurIds: readonly PlayerId[];
  /** Saboteurs whose deferred (hidden) heat landed here. */
  readonly heatRaisedPlayerIds: readonly PlayerId[];
  /**
   * Saboteurs whose deferred heat crossed their investigation threshold as it
   * landed. The caller opens `buildInvestigationPrompt` for each — sequencing
   * prompts belongs to whichever transition drove the round forward, not here.
   */
  readonly investigationPlayerIds: readonly PlayerId[];
};

export type ProjectResolution = {
  /** The full replacement `GameState.projects` array. */
  readonly projects: readonly ProjectState[];
  /** The full replacement player map. */
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly resolved: readonly ResolvedProject[];
  readonly changes: readonly ProjectResourceChange[];
};

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

type ResourceEntry = { readonly key: string; readonly resource: ResourceState };

/**
 * The player's resource of a given kind.
 *
 * Setup mints exactly one resource per kind, but this picks the
 * lexicographically-smallest matching key rather than the first one
 * `Object.entries` happens to yield, so the answer cannot depend on record key
 * order — which is insertion order in memory and sorted order after the
 * repository's JSON round trip, i.e. not a stable contract.
 */
function findResource(
  player: PlayerState,
  kind: NonNullable<ResourceState["kind"]>,
): ResourceEntry | null {
  let found: ResourceEntry | null = null;
  for (const [key, resource] of Object.entries(player.resources)) {
    if (resource.kind !== kind) continue;
    if (found === null || key < found.key) found = { key, resource };
  }

  return found;
}

function resourceValue(
  player: PlayerState,
  kind: NonNullable<ResourceState["kind"]>,
): number {
  return findResource(player, kind)?.resource.value ?? 0;
}

type Charge = {
  readonly kind: NonNullable<ResourceState["kind"]>;
  readonly delta: number;
  readonly reason: string;
};

/**
 * Applies a sequence of resource deltas to one player, clamping each to that
 * resource's own declared bounds and reporting every change that actually moved
 * a value. The resource is re-looked-up per charge, so two charges against the
 * same resource compose correctly instead of the second overwriting the first.
 */
function applyCharges(
  player: PlayerState,
  charges: readonly Charge[],
): { readonly player: PlayerState; readonly changes: readonly ProjectResourceChange[] } {
  let current = player;
  const changes: ProjectResourceChange[] = [];

  for (const charge of charges) {
    if (charge.delta === 0) continue;
    const entry = findResource(current, charge.kind);
    if (entry === null) continue;

    let next = entry.resource.value + charge.delta;
    if (entry.resource.minimum !== null) next = Math.max(entry.resource.minimum, next);
    if (entry.resource.maximum !== null) next = Math.min(entry.resource.maximum, next);
    if (next === entry.resource.value) continue;

    current = {
      ...current,
      resources: {
        ...current.resources,
        [entry.key]: { ...entry.resource, value: next },
      },
    };
    changes.push({
      playerId: current.id,
      resourceId: entry.resource.id,
      previousValue: entry.resource.value,
      newValue: next,
      reason: charge.reason,
    });
  }

  return { player: current, changes };
}

function grossMoney(project: ProjectState): number {
  return project.contributions.reduce((sum, entry) => sum + entry.money, 0);
}

function grossWork(project: ProjectState): number {
  return project.contributions.reduce((sum, entry) => sum + entry.work, 0);
}

function sabotagedWork(project: ProjectState): number {
  return project.sabotage.reduce((sum, entry) => sum + entry.amount, 0);
}

/**
 * `open` until gross contributions cover both requirements, then `funded`.
 *
 * Gross, never net: netting sabotage in here would make a project's public
 * status a sabotage detector, which is exactly what `hidden: true` is supposed
 * to prevent. The netting happens once, at the deadline.
 */
function fundingStatus(project: ProjectState): ProjectStatus {
  return grossMoney(project) >= project.requiredMoney &&
    grossWork(project) >= project.requiredWork
    ? "funded"
    : "open";
}

function isLive(project: ProjectState): boolean {
  return project.status === "open" || project.status === "funded";
}

export function findProjectDefinition(
  definitionId: string,
  definitions: readonly ProjectDefinition[] = DEFAULT_PROJECT_DEFINITIONS,
): ProjectDefinition | null {
  return definitions.find((candidate) => candidate.id === definitionId) ?? null;
}

/** How many live projects this player is leading right now. */
export function leadProjectCount(
  projects: readonly ProjectState[],
  playerId: PlayerId,
): number {
  return projects.filter(
    (project) => project.leadPlayerId === playerId && isLive(project),
  ).length;
}

// ---------------------------------------------------------------------------
// Pro-rata distribution
// ---------------------------------------------------------------------------

type ContributorWeight = {
  readonly playerId: PlayerId;
  readonly weight: number;
};

/**
 * What one point of work counts for in a split when the project's definition is
 * not available (a stored game whose definition this build no longer ships).
 *
 * Falls back to the rate the project's own requirements imply — finishing the
 * work track is worth as much as finishing the money track — which is the least
 * arbitrary guess available and is exactly right for a definition that priced
 * itself that way.
 */
function impliedWorkValue(project: ProjectState): number {
  if (project.requiredWork <= 0) return 0;

  return Math.max(1, Math.round(project.requiredMoney / project.requiredWork));
}

/**
 * Each contributor's integer weight in the pro-rata split, money-denominated:
 *
 *     weight = money + work * workValueMoney
 *
 * Integers throughout (contributions and the rate are whole numbers), so there
 * is no float drift for a JSON round trip to expose.
 *
 * Aggregation walks `playerOrder`, never `Object.keys`, so two contributors with
 * identical weights always tie-break the same way. A contributor who is no
 * longer in `playerOrder` is dropped and everyone else's share renormalises —
 * their stake is forfeit rather than becoming an unpayable remainder.
 */
function contributorWeights(
  project: ProjectState,
  playerOrder: readonly PlayerId[],
  workValueMoney: number,
): readonly ContributorWeight[] {
  const totals = new Map<string, { money: number; work: number }>();
  for (const entry of project.contributions) {
    const running = totals.get(entry.playerId) ?? { money: 0, work: 0 };
    totals.set(entry.playerId, {
      money: running.money + entry.money,
      work: running.work + entry.work,
    });
  }

  const weights: ContributorWeight[] = [];
  for (const playerId of playerOrder) {
    const total = totals.get(playerId);
    if (total === undefined) continue;

    const weight = total.money + total.work * workValueMoney;
    if (weight <= 0) continue;
    weights.push({ playerId, weight });
  }

  return weights;
}

/**
 * Splits an integer pot across weights by the largest-remainder method.
 *
 * Integer-only and total: every unit of `pot` is handed to exactly one
 * contributor, so a payout never silently loses money to rounding. Ties on the
 * remainder are broken by position in `weights`, which is `playerOrder`, so the
 * split is identical on replay and after a JSON round trip.
 */
function distribute(
  pot: number,
  weights: readonly ContributorWeight[],
): ReadonlyMap<string, number> {
  const shares = new Map<string, number>();
  if (weights.length === 0) return shares;

  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0 || pot <= 0) {
    for (const entry of weights) shares.set(entry.playerId, 0);
    return shares;
  }

  const scored = weights.map((entry, index) => {
    const exact = pot * entry.weight;
    const base = Math.floor(exact / totalWeight);
    return { playerId: entry.playerId, index, base, remainder: exact - base * totalWeight };
  });

  let assigned = 0;
  for (const entry of scored) {
    shares.set(entry.playerId, entry.base);
    assigned += entry.base;
  }

  const ranked = [...scored].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index,
  );
  // `pot - assigned` is strictly less than `ranked.length` for any non-negative
  // integer weights, so one pass over the ranking always finishes the job.
  for (const entry of ranked) {
    if (assigned >= pot) break;
    shares.set(entry.playerId, (shares.get(entry.playerId) ?? 0) + 1);
    assigned += 1;
  }

  return shares;
}

// ---------------------------------------------------------------------------
// Heat
// ---------------------------------------------------------------------------

type SabotageHeat = {
  readonly player: PlayerState;
  readonly raised: boolean;
  readonly investigationOpened: boolean;
};

/**
 * Charges a saboteur `charges` units of the conflict mechanic's heat curve.
 *
 * Routed through `raiseHeat` rather than adding to `HeatState` by hand: it owns
 * the `heatEnabled` gate, the accumulating threshold multiples and the
 * `investigationsOpened` bookkeeping, and it already declares
 * `"project-sabotage"` as a first-class `HeatSource` for exactly this call.
 * Duplicating that curve here would let the two drift.
 */
function chargeSabotageHeat(
  player: PlayerState,
  state: GameState,
  round: number,
  charges: number,
): SabotageHeat {
  if (charges <= 0) {
    return { player, raised: false, investigationOpened: false };
  }

  const outcome = raiseHeat({
    rules: state.rules,
    player,
    round,
    source: "project-sabotage",
    charges,
  });

  return {
    player: outcome.player,
    raised: outcome.amount > 0,
    investigationOpened: outcome.investigationOpened,
  };
}

// ---------------------------------------------------------------------------
// Shared command guards
// ---------------------------------------------------------------------------

type GuardFailure = {
  readonly code:
    | "ACTOR_NOT_FOUND"
    | "GAME_NOT_ACTIVE"
    | "ILLEGAL_ACTION"
    | "INVALID_COMMAND"
    | "INVALID_PHASE"
    | "NOT_ACTOR_TURN";
  readonly message: string;
};

type GuardResult =
  | { readonly ok: true; readonly actor: PlayerState }
  | { readonly ok: false; readonly failure: GuardFailure };

/**
 * The preconditions every project verb shares.
 *
 * Project commands are **free actions taken before rolling**, not turn-ending
 * verbs: they are legal only in `pre-roll`, and none of them advances the turn.
 * That keeps them composable with the roll transition (which this module does
 * not own) and means a player can fund a project and still take their turn.
 *
 * The authorisation rule that matters most (spec §6.3) is the one that is
 * structural rather than checked: every verb below reads the acting player out
 * of `state.players[command.actorId]` and spends *that* record's resources.
 * There is no payload field naming whose money to move, so there is no shape in
 * which `project.contribute` could spend somebody else's.
 */
function guardProjectCommand(
  state: GameState,
  actorId: PlayerId,
  rules: ModeRules,
): GuardResult {
  if (!rules.projects.enabled) {
    return {
      ok: false,
      failure: { code: "ILLEGAL_ACTION", message: "Projects are disabled in this mode" },
    };
  }
  if (state.status !== "active") {
    return {
      ok: false,
      failure: { code: "GAME_NOT_ACTIVE", message: "Projects need an active game" },
    };
  }
  if (state.turn.phase !== "pre-roll") {
    return {
      ok: false,
      failure: {
        code: "INVALID_PHASE",
        message: "Project actions are taken before rolling, during pre-roll",
      },
    };
  }
  if (state.turn.activePlayerId !== actorId) {
    return {
      ok: false,
      failure: {
        code: "NOT_ACTOR_TURN",
        message: "Only the active player can act on a project",
      },
    };
  }
  const actor = state.players[actorId];
  if (actor === undefined) {
    return {
      ok: false,
      failure: {
        code: "ACTOR_NOT_FOUND",
        message: "Command actor is not a player in this game",
      },
    };
  }
  if (state.eliminatedPlayerIds.includes(actorId)) {
    return {
      ok: false,
      failure: { code: "ILLEGAL_ACTION", message: "An eliminated player cannot act" },
    };
  }

  return { ok: true, actor };
}

function findProject(
  state: GameState,
  projectId: ProjectId,
): ProjectState | null {
  return state.projects.find((candidate) => candidate.id === projectId) ?? null;
}

function definitionFor(
  project: ProjectState,
  definitions: readonly ProjectDefinition[],
): ProjectDefinition | null {
  return findProjectDefinition(project.definitionId, definitions);
}

function replaceProject(
  projects: readonly ProjectState[],
  updated: ProjectState,
): readonly ProjectState[] {
  return projects.map((candidate) => (candidate.id === updated.id ? updated : candidate));
}

function commit(
  state: GameState,
  command: GameCommand,
  next: {
    readonly players: Readonly<Record<string, PlayerState>>;
    readonly projects: readonly ProjectState[];
    readonly changes: readonly ProjectResourceChange[];
    readonly logicalTimestamp: string;
    /** An investigation this command's heat raise triggered, if any. */
    readonly openInvestigationFor?: PlayerId | null;
  },
): TransitionResult {
  const events: GameEvent[] = [
    ...projectResourceEvents(
      state,
      command,
      next.logicalTimestamp,
      state.eventSequence + 1,
      next.changes,
    ),
  ];

  // The sequence the PromptOpened event is about to carry. The prompt's id is
  // derived from it (see heat.ts), so it is read before the push that would
  // change it and the two always agree.
  const promptSequence = state.eventSequence + events.length + 1;
  const prompt: PromptState | null =
    next.openInvestigationFor === undefined || next.openInvestigationFor === null
      ? null
      : buildInvestigationPrompt(state, promptSequence, next.openInvestigationFor);
  if (prompt !== null) {
    const opened: PromptOpenedEvent = {
      ...createEventMetadata(state, command, next.logicalTimestamp, promptSequence),
      type: "PromptOpened",
      payload: { prompt },
    };
    events.push(opened);
  }

  const lastEvent = events[events.length - 1];

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent?.sequence ?? state.eventSequence,
        players: next.players,
        projects: next.projects,
        prompts: prompt === null ? state.prompts : [...state.prompts, prompt],
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}

// ---------------------------------------------------------------------------
// project.start
// ---------------------------------------------------------------------------

/**
 * Opens a project, charging the lead their stake.
 *
 * The id comes from `state.gameId` plus the revision this command is about to
 * produce. Both are server-owned and `revision` is strictly monotonic, so the id
 * is unique within the game and re-derives identically on replay — where letting
 * the client name it would let one client mint the id of a project another
 * client was about to reference.
 */
export function startProject(
  state: GameState,
  command: StartProjectCommand,
  context: TransitionContext,
  options: ProjectCommandOptions = {},
): TransitionResult {
  const rules = state.rules;
  const guard = guardProjectCommand(state, command.actorId, rules);
  if (!guard.ok) return rejectCommand(state, command, guard.failure);

  const definitions = options.definitions ?? DEFAULT_PROJECT_DEFINITIONS;
  const definition = findProjectDefinition(command.payload.definitionId, definitions);
  if (definition === null) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Unknown project definition",
    });
  }
  if (rules.projects.deadlineRounds < 1) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode gives projects no rounds to run in",
    });
  }
  if (
    leadProjectCount(state.projects, command.actorId) >=
    rules.projects.maxConcurrentPerPlayer
  ) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This player is already leading the maximum number of live projects",
      details: {
        maxConcurrentPerPlayer: rules.projects.maxConcurrentPerPlayer,
        leading: leadProjectCount(state.projects, command.actorId),
      },
    });
  }

  const tileId: TileId | null = command.payload.tileId;
  if (tileId !== null) {
    if (!state.tileIds.includes(tileId)) {
      return rejectCommand(state, command, {
        code: "INVALID_COMMAND",
        message: "Project tile is not on this board",
      });
    }
    // A project occupies the space it is placed on: the board is the shared,
    // rivalrous thing, so two live projects cannot sit on the same tile.
    if (state.projects.some((candidate) => isLive(candidate) && candidate.tileId === tileId)) {
      return rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "Another live project already occupies that tile",
      });
    }
  }

  if (resourceValue(guard.actor, "resource.money") < definition.leadStakeMoney) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "The lead cannot cover this project's stake",
      details: {
        required: definition.leadStakeMoney,
        available: resourceValue(guard.actor, "resource.money"),
      },
    });
  }

  const staked = applyCharges(guard.actor, [
    { kind: "resource.money", delta: -definition.leadStakeMoney, reason: "project-stake" },
  ]);

  const contribution: ProjectContribution = {
    playerId: command.actorId,
    money: definition.leadStakeMoney,
    work: 0,
    atRound: state.turn.round,
  };
  const project: ProjectState = {
    id: createStableId("ProjectId", `${state.gameId}:project:${state.revision + 1}`),
    definitionId: definition.id,
    leadPlayerId: command.actorId,
    tileId,
    status: "open",
    requiredMoney: definition.requiredMoney,
    requiredWork: definition.requiredWork,
    contributions: [contribution],
    sabotage: [],
    deadlineRound: state.turn.round + rules.projects.deadlineRounds,
    payout: definition.payout,
    // A mode that forbids joining cannot have a joinable project in it,
    // whatever the client asked for.
    openToJoin: rules.projects.joinable && command.payload.openToJoin,
    leadBonusBasisPoints: definition.leadBonusBasisPoints,
  };

  return commit(state, command, {
    players: { ...state.players, [command.actorId]: staked.player },
    projects: [
      ...state.projects,
      { ...project, status: fundingStatus(project) },
    ],
    changes: staked.changes,
    logicalTimestamp: context.logicalTimestamp,
  });
}

// ---------------------------------------------------------------------------
// project.contribute
// ---------------------------------------------------------------------------

/**
 * Puts money and/or work into a live project.
 *
 * Money leaves the contributor's purse and work leaves their work counter *now*
 * — that is what makes a project a money sink and what makes failure cost
 * something. Nothing is escrowed and nothing is refundable.
 *
 * Takes no `ProjectCommandOptions`, unlike its two siblings: every number a
 * contribution needs (`requiredMoney`, `requiredWork`, `openToJoin`,
 * `deadlineRound`) is already on the `ProjectState`, so there is nothing for a
 * definition catalog to answer here.
 */
export function contributeToProject(
  state: GameState,
  command: ContributeToProjectCommand,
  context: TransitionContext,
): TransitionResult {
  const rules = state.rules;
  const guard = guardProjectCommand(state, command.actorId, rules);
  if (!guard.ok) return rejectCommand(state, command, guard.failure);

  const { money, work, projectId } = command.payload;
  if (!isNonNegativeInteger(money) || !isNonNegativeInteger(work)) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "A contribution must be whole, non-negative amounts",
    });
  }
  if (money + work === 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "A contribution of nothing is not a contribution",
    });
  }

  const project = findProject(state, projectId);
  if (project === null) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "No such project",
    });
  }
  if (!isLive(project)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This project has already resolved",
    });
  }
  if (state.turn.round > project.deadlineRound) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This project's deadline has passed",
    });
  }
  if (
    command.actorId !== project.leadPlayerId &&
    !(rules.projects.joinable && project.openToJoin)
  ) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This project is not open to contributors other than its lead",
    });
  }

  const availableMoney = resourceValue(guard.actor, "resource.money");
  if (availableMoney < money) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Not enough money to contribute that much",
      details: { required: money, available: availableMoney },
    });
  }
  const availableWork = resourceValue(guard.actor, "resource.work-counter");
  if (availableWork < work) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Not enough work to contribute that much",
      details: { required: work, available: availableWork },
    });
  }

  const paid = applyCharges(guard.actor, [
    { kind: "resource.money", delta: -money, reason: "project-contribution" },
    { kind: "resource.work-counter", delta: -work, reason: "project-contribution-work" },
  ]);

  const contributed: ProjectState = {
    ...project,
    contributions: [
      ...project.contributions,
      { playerId: command.actorId, money, work, atRound: state.turn.round },
    ],
  };

  return commit(state, command, {
    players: { ...state.players, [command.actorId]: paid.player },
    projects: replaceProject(state.projects, {
      ...contributed,
      status: fundingStatus(contributed),
    }),
    changes: paid.changes,
    logicalTimestamp: context.logicalTimestamp,
  });
}

// ---------------------------------------------------------------------------
// project.sabotage
// ---------------------------------------------------------------------------

/**
 * Damages a live project's work track.
 *
 * Sabotage hits **work**, never money: money already paid into a project is
 * banked and there is no fiction in which an office rival un-banks it, whereas
 * work is exactly the thing a rival can quietly undo. A project that requires no
 * work is therefore genuinely sabotage-proof, which is a real strategic texture
 * rather than an oversight — fund-heavy projects buy safety with cost.
 *
 * The saboteur pays in their own work counter, one for one: wrecking someone
 * else's quarter costs you your own. `hidden` costs money on top
 * (`hiddenSabotageMoneyPerWork`) — that premium is the whole price of the
 * concealment, since hidden sabotage also defers its heat to resolution.
 */
export function sabotageProject(
  state: GameState,
  command: SabotageProjectCommand,
  context: TransitionContext,
  options: ProjectCommandOptions = {},
): TransitionResult {
  const rules = state.rules;
  const guard = guardProjectCommand(state, command.actorId, rules);
  if (!guard.ok) return rejectCommand(state, command, guard.failure);

  if (!rules.projects.sabotageable) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Project sabotage is disabled in this mode",
    });
  }

  const { amount, hidden, projectId } = command.payload;
  if (!isNonNegativeInteger(amount) || amount === 0) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Sabotage must be a whole, positive amount",
    });
  }

  const project = findProject(state, projectId);
  if (project === null) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "No such project",
    });
  }
  if (!isLive(project)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This project has already resolved",
    });
  }
  if (state.turn.round > project.deadlineRound) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This project's deadline has passed",
    });
  }
  if (project.leadPlayerId === command.actorId) {
    // There is no configuration in which wrecking your own project is a
    // decision rather than a mistake: the lead takes the largest failure
    // penalty at the table, so self-sabotage is pure self-harm.
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "A project's lead cannot sabotage it",
    });
  }
  if (project.requiredWork <= 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This project has no work to damage",
    });
  }

  const definitions = options.definitions ?? DEFAULT_PROJECT_DEFINITIONS;
  const definition = definitionFor(project, definitions);
  // Only concealment needs the definition (for its price). A stored project
  // whose definition this build no longer ships can still be sabotaged in the
  // open — refusing that would make an unknown definition a shield.
  if (definition === null && hidden) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Project references a definition this build cannot price concealment against",
    });
  }

  const availableWork = resourceValue(guard.actor, "resource.work-counter");
  if (availableWork < amount) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Not enough work to sabotage that much",
      details: { required: amount, available: availableWork },
    });
  }
  const concealmentCost =
    hidden && definition !== null ? amount * definition.hiddenSabotageMoneyPerWork : 0;
  const availableMoney = resourceValue(guard.actor, "resource.money");
  if (availableMoney < concealmentCost) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Not enough money to conceal sabotage on that scale",
      details: { required: concealmentCost, available: availableMoney },
    });
  }

  const paid = applyCharges(guard.actor, [
    { kind: "resource.work-counter", delta: -amount, reason: "project-sabotage-cost" },
    {
      kind: "resource.money",
      delta: -concealmentCost,
      reason: "project-sabotage-concealment",
    },
  ]);

  // Open sabotage is public the moment it happens, so its heat lands now.
  // Hidden sabotage defers its heat to resolution: heat is public state, and
  // bumping it here would announce the attack on the turn it was made — which
  // is precisely the information `hidden: true` is bought to withhold.
  const heat = chargeSabotageHeat(
    paid.player,
    state,
    state.turn.round,
    hidden ? 0 : 1,
  );

  const entry: ProjectSabotage = {
    playerId: command.actorId,
    amount,
    hidden,
    atRound: state.turn.round,
  };

  return commit(state, command, {
    players: { ...state.players, [command.actorId]: heat.player },
    projects: replaceProject(state.projects, {
      ...project,
      sabotage: [...project.sabotage, entry],
    }),
    changes: paid.changes,
    logicalTimestamp: context.logicalTimestamp,
    openInvestigationFor: heat.investigationOpened ? command.actorId : null,
  });
}

// ---------------------------------------------------------------------------
// Deadline resolution
// ---------------------------------------------------------------------------

type PlayerAccumulator = {
  players: Record<string, PlayerState>;
  changes: ProjectResourceChange[];
};

function chargePlayer(
  accumulator: PlayerAccumulator,
  playerId: PlayerId,
  charges: readonly Charge[],
): void {
  const player = accumulator.players[playerId];
  if (player === undefined) return;

  const applied = applyCharges(player, charges);
  accumulator.players[playerId] = applied.player;
  accumulator.changes.push(...applied.changes);
}

function resolveOne(
  project: ProjectState,
  state: GameState,
  accumulator: PlayerAccumulator,
  round: number,
  definitions: readonly ProjectDefinition[],
): { readonly project: ProjectState; readonly resolved: ResolvedProject } {
  const money = grossMoney(project);
  const work = grossWork(project);
  const damage = sabotagedWork(project);
  const netWork = work - damage;
  const succeeded = money >= project.requiredMoney && netWork >= project.requiredWork;

  const payouts: ProjectShare[] = [];
  const penalties: ProjectShare[] = [];
  const definition = findProjectDefinition(project.definitionId, definitions);
  const weights = contributorWeights(
    project,
    state.playerOrder,
    definition?.workValueMoney ?? impliedWorkValue(project),
  );

  if (succeeded) {
    const leadMoneyBonus = Math.floor(
      (project.payout.money * project.leadBonusBasisPoints) / BASIS_POINTS,
    );
    const leadReputationBonus = Math.floor(
      (project.payout.reputation * project.leadBonusBasisPoints) / BASIS_POINTS,
    );
    const moneyShares = distribute(project.payout.money - leadMoneyBonus, weights);
    const reputationShares = distribute(
      project.payout.reputation - leadReputationBonus,
      weights,
    );

    for (const weight of weights) {
      const isLead = weight.playerId === project.leadPlayerId;
      const awardMoney = (moneyShares.get(weight.playerId) ?? 0) + (isLead ? leadMoneyBonus : 0);
      const awardReputation =
        (reputationShares.get(weight.playerId) ?? 0) + (isLead ? leadReputationBonus : 0);
      if (awardMoney === 0 && awardReputation === 0) continue;

      payouts.push({
        playerId: weight.playerId,
        money: awardMoney,
        reputation: awardReputation,
      });
      chargePlayer(accumulator, weight.playerId, [
        { kind: "resource.money", delta: awardMoney, reason: "project-payout" },
        { kind: "resource.reputation", delta: awardReputation, reason: "project-payout" },
      ]);
    }
  } else {
    // A project whose definition this build no longer knows still fails; it
    // just cannot price the reputation penalty, and inventing one would be
    // worse than charging none.
    const penalty = definition?.failureReputationPenalty ?? 0;
    const shared = distribute(penalty, weights);

    // The lead pays the *whole* penalty flat; everyone else pays only their
    // pro-rata slice of the same number, so the lead's downside is strictly the
    // largest at the table however small their stake was. That gap is exactly
    // what `leadBonusBasisPoints` buys, and it is why leading is a bet rather
    // than a free upgrade. The lead's entry in `shared` is discarded on purpose.
    for (const playerId of state.playerOrder) {
      const isLead = playerId === project.leadPlayerId;
      const loss = isLead ? penalty : (shared.get(playerId) ?? 0);
      if (loss <= 0) continue;

      penalties.push({ playerId, money: 0, reputation: -loss });
      chargePlayer(accumulator, playerId, [
        {
          kind: "resource.reputation",
          delta: -loss,
          reason: "project-failure-penalty",
        },
      ]);
    }
  }

  // Reveal every hidden sabotage and settle its deferred heat, ordered by
  // playerOrder so two saboteurs are always processed the same way.
  const hiddenCounts = new Map<string, number>();
  for (const entry of project.sabotage) {
    if (!entry.hidden) continue;
    hiddenCounts.set(entry.playerId, (hiddenCounts.get(entry.playerId) ?? 0) + 1);
  }
  const revealedSaboteurIds: PlayerId[] = [];
  const heatRaisedPlayerIds: PlayerId[] = [];
  const investigationPlayerIds: PlayerId[] = [];
  for (const playerId of state.playerOrder) {
    const times = hiddenCounts.get(playerId) ?? 0;
    if (times === 0) continue;
    revealedSaboteurIds.push(playerId);

    const player = accumulator.players[playerId];
    if (player === undefined) continue;
    const heat = chargeSabotageHeat(player, state, round, times);
    accumulator.players[playerId] = heat.player;
    if (heat.raised) heatRaisedPlayerIds.push(playerId);
    if (heat.investigationOpened) investigationPlayerIds.push(playerId);
  }

  const status: Extract<ProjectStatus, "completed" | "failed"> = succeeded
    ? "completed"
    : "failed";

  return {
    project: {
      ...project,
      status,
      // Revealed by resolution, per spec §5.2: from here on every viewer's
      // projection carries the full sabotage list.
      sabotage: project.sabotage.map((entry) =>
        entry.hidden ? { ...entry, hidden: false } : entry,
      ),
      // A resolved project is closed to everything.
      openToJoin: false,
    },
    resolved: {
      projectId: project.id,
      definitionId: project.definitionId,
      leadPlayerId: project.leadPlayerId,
      status,
      grossMoney: money,
      grossWork: work,
      sabotagedWork: damage,
      netWork,
      payouts,
      penalties,
      objectiveProgress: succeeded ? project.payout.objectiveProgress : 0,
      revealedSaboteurIds,
      heatRaisedPlayerIds,
      investigationPlayerIds,
    },
  };
}

/**
 * Resolves every live project whose deadline `round` has passed.
 *
 * The engine has no clock (spec §7.1): "the deadline fired" is a fact about
 * `GameState.turn.round`, so a caller hands in the round the game has reached
 * and this settles everything that is now overdue. It is therefore also
 * **catch-up safe** — a game restored past several deadlines resolves all of
 * them in one call, in stored project order — and **idempotent**, because
 * `completed`/`failed` are terminal and a second call at the same round finds
 * nothing live to resolve.
 *
 * A project resolves only at its deadline, never early, even once fully funded.
 * That window is what gives sabotage somewhere to live and what makes the lead
 * sweat, and it is the only reason `hidden` sabotage has time to stay hidden.
 */
export function resolveDueProjects(
  state: GameState,
  round: number,
  options: ProjectResolutionOptions = {},
): ProjectResolution {
  const source = options.projects ?? state.projects;
  const definitions = options.definitions ?? DEFAULT_PROJECT_DEFINITIONS;
  const accumulator: PlayerAccumulator = {
    players: { ...(options.players ?? state.players) },
    changes: [],
  };

  const due = source.some(
    (project) => isLive(project) && round > project.deadlineRound,
  );
  if (!due) {
    return {
      projects: source,
      players: accumulator.players,
      resolved: [],
      changes: [],
    };
  }

  const projects: ProjectState[] = [];
  const resolved: ResolvedProject[] = [];
  for (const project of source) {
    if (!isLive(project) || round <= project.deadlineRound) {
      projects.push(project);
      continue;
    }

    const outcome = resolveOne(project, state, accumulator, round, definitions);
    projects.push(outcome.project);
    resolved.push(outcome.resolved);
  }

  return {
    projects,
    players: accumulator.players,
    resolved,
    changes: accumulator.changes,
  };
}

/**
 * `ResourceChanged` events for a batch of project `changes`, numbered from a
 * caller-supplied starting sequence.
 *
 * Kept separate from `resolveDueProjects` so the caller — which owns the
 * command, the event ordering and the rest of the turn's events — decides where
 * in its own stream these land. There is deliberately no `ProjectStarted` /
 * `ProjectResolved` event type: `packages/engine/src/events/index.ts` is a
 * shared file this module does not own, so every project mutation is reported
 * through the existing `ResourceChanged` shape, distinguished by `reason`
 * (`project-stake`, `project-contribution`, `project-contribution-work`,
 * `project-sabotage-cost`, `project-sabotage-concealment`, `project-payout`,
 * `project-failure-penalty`).
 */
export function projectResourceEvents(
  state: GameState,
  command: GameCommand,
  logicalTimestamp: string,
  firstSequence: number,
  changes: readonly ProjectResourceChange[],
): readonly GameEvent[] {
  return changes.map((change, index) => {
    const event: ResourceChangedEvent = {
      ...createEventMetadata(state, command, logicalTimestamp, firstSequence + index),
      type: "ResourceChanged",
      payload: {
        playerId: change.playerId,
        resourceId: change.resourceId,
        previousValue: change.previousValue,
        newValue: change.newValue,
        reason: change.reason,
      },
    };

    return event;
  });
}

// ---------------------------------------------------------------------------
// Legal-action predicates
// ---------------------------------------------------------------------------

/**
 * Whether this player could legally start any project right now.
 *
 * Written for `legal-actions.ts`, which this module does not own: it answers the
 * gating question without duplicating the gate. `startProject` is still the
 * authority — this is an advertisement, not an authorisation.
 */
export function canStartProject(
  state: GameState,
  playerId: PlayerId,
  options: ProjectCommandOptions = {},
): boolean {
  const guard = guardProjectCommand(state, playerId, state.rules);
  if (!guard.ok) return false;
  if (state.rules.projects.deadlineRounds < 1) return false;
  if (
    leadProjectCount(state.projects, playerId) >=
    state.rules.projects.maxConcurrentPerPlayer
  ) {
    return false;
  }

  const definitions = options.definitions ?? DEFAULT_PROJECT_DEFINITIONS;
  const money = resourceValue(guard.actor, "resource.money");

  return definitions.some((definition) => definition.leadStakeMoney <= money);
}

/** The project definitions this player could afford to lead right now. */
export function affordableProjectDefinitions(
  state: GameState,
  playerId: PlayerId,
  options: ProjectCommandOptions = {},
): readonly ProjectDefinition[] {
  if (!canStartProject(state, playerId, options)) return [];
  const player = state.players[playerId];
  if (player === undefined) return [];

  const definitions = options.definitions ?? DEFAULT_PROJECT_DEFINITIONS;
  const money = resourceValue(player, "resource.money");

  return definitions.filter((definition) => definition.leadStakeMoney <= money);
}

/** The live projects this player is allowed to put resources into. */
export function contributableProjects(
  state: GameState,
  playerId: PlayerId,
): readonly ProjectState[] {
  const guard = guardProjectCommand(state, playerId, state.rules);
  if (!guard.ok) return [];

  return state.projects.filter(
    (project) =>
      isLive(project) &&
      state.turn.round <= project.deadlineRound &&
      (project.leadPlayerId === playerId ||
        (state.rules.projects.joinable && project.openToJoin)),
  );
}

/** The live projects this player is allowed to damage. */
export function sabotageableProjects(
  state: GameState,
  playerId: PlayerId,
): readonly ProjectState[] {
  const guard = guardProjectCommand(state, playerId, state.rules);
  if (!guard.ok) return [];
  if (!state.rules.projects.sabotageable) return [];

  return state.projects.filter(
    (project) =>
      isLive(project) &&
      state.turn.round <= project.deadlineRound &&
      project.leadPlayerId !== playerId &&
      project.requiredWork > 0,
  );
}
