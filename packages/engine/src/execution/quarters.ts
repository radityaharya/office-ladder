import type {
  EffectDescriptor,
  GlobalEventConfig,
  GlobalEventModifier,
  GlobalEventScope,
} from "@office-ladder/content";

import type { AdvanceQuarterCommand } from "../commands";
import type { ResourceChangedEvent } from "../events";
import type {
  GameState,
  ModeRules,
  PlayerId,
  PlayerState,
  QuarterState,
  RankState,
  ResourceId,
  ResourceState,
} from "../model";
import { createStableId } from "../model";
import { createSeededRandomSource, type RandomSource } from "../random";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import { applyEffectDescriptors } from "./resolve-tile-effects";
import type { TransitionContent, TransitionContext, TransitionResult } from "./types";

/**
 * The table-wide rule changes the current quarter's global event holds in force.
 *
 * Separate from `EffectDescriptor` for the reason the content schema gives: an
 * effect is something that happens *to a player*, while these suspend or scale a
 * rule for everyone, and a deck card must never be able to author "no promotions
 * this quarter".
 *
 * Every field is neutral in `NEUTRAL_QUARTER_MODIFIERS`, so a caller that reads
 * one without checking whether quarters are on at all degrades to a no-op rather
 * than to a surprise.
 */
export type QuarterModifiers = {
  readonly promotionsBlocked: boolean;
  readonly loansBlocked: boolean;
  readonly tileClaimsBlocked: boolean;
  readonly upkeepSuspended: boolean;
  readonly salaryMultiplier: number;
  readonly projectPayoutMultiplier: number;
  /** Signed: negative tightens scrutiny by lowering the effective heat threshold. */
  readonly heatThresholdDelta: number;
};

export const NEUTRAL_QUARTER_MODIFIERS: QuarterModifiers = {
  promotionsBlocked: false,
  loansBlocked: false,
  tileClaimsBlocked: false,
  upkeepSuspended: false,
  salaryMultiplier: 1,
  projectPayoutMultiplier: 1,
  heatThresholdDelta: 0,
};

export type QuarterResourceChange = {
  readonly playerId: PlayerId;
  readonly resourceId: ResourceId;
  readonly resourceKey: string;
  readonly previousValue: number;
  readonly newValue: number;
  /** Which global event caused it, for the feed line and the event `reason`. */
  readonly globalEventId: string;
};

export type QuarterDemotion = {
  readonly playerId: PlayerId;
  readonly fromRankIndex: number;
  readonly toRankIndex: number;
  readonly globalEventId: string;
};

export type QuarterAdvance = {
  readonly quarters: readonly QuarterState[];
  readonly currentQuarterIndex: number;
  /** The whole player map with the event's effects applied, ready to use as-is. */
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly changes: readonly QuarterResourceChange[];
  /** The event that resolved as this quarter opened, if any. */
  readonly resolvedEventId: string | null;
  /** The event announced for the *next* quarter, if there is one. */
  readonly announcedEventId: string | null;
  readonly announcedForQuarterIndex: number | null;
  readonly demotion: QuarterDemotion | null;
};

/**
 * Randomness for a quarter's global event.
 *
 * Seeded from server-owned canonical state only — the same rule
 * `ephemeral-random.ts` documents at length, and for the same reason: seeding
 * from a client-supplied command id was a real exploit that let a client grind
 * offline for a favourable outcome. `revision` and `eventSequence` advance on
 * every accepted command, so two quarters never draw the same stream, and the
 * seed is a pure function of `state`, so a replay re-derives it exactly.
 *
 * It is built here rather than through `createEphemeralRandom` because that
 * function's `EphemeralRandomPurpose` union is owned elsewhere; the domain prefix
 * below keeps this stream disjoint from every purpose in it. Folding it into that
 * union (and deleting this) is a tidy-up, not a behaviour change.
 */
function quarterEventRandomSeed(state: GameState, quarterIndex: number): string {
  const dice = state.rng.streams["dice"];
  const setup = state.rng.streams["setup"];
  const fields = (stream: typeof dice): readonly string[] =>
    stream === undefined
      ? ["-", "-", "-"]
      : [stream.algorithm, stream.state, String(stream.cursor)];

  return [
    "ephemeral",
    "quarter-event",
    state.gameId,
    String(quarterIndex),
    String(state.revision),
    String(state.eventSequence),
    ...fields(dice),
    ...fields(setup),
  ].join("|");
}

export function createQuarterEventRandom(
  state: GameState,
  quarterIndex: number,
): RandomSource {
  return createSeededRandomSource(quarterEventRandomSeed(state, quarterIndex));
}

/**
 * Whether the quarter track is running at all. Both flags matter: a mode can run
 * quarters purely as a match clock (`globalEvents: false`) and never schedule a
 * shock.
 */
export function quartersEnabled(rules: ModeRules): boolean {
  return rules.quarters.enabled;
}

export function globalEventsEnabled(rules: ModeRules): boolean {
  return rules.quarters.enabled && rules.quarters.globalEvents;
}

function findEvent(
  content: TransitionContent,
  eventId: string | null,
): GlobalEventConfig | null {
  if (eventId === null) return null;

  return (
    (Object.values(content.globalEvents) as readonly GlobalEventConfig[]).find(
      (event) => event.id === eventId,
    ) ?? null
  );
}

/**
 * The event the authored rotation puts in quarter `index`.
 *
 * Quarter 0 deliberately gets nothing. Every event is announced a quarter ahead
 * (spec §5.7), and there is no quarter before the first in which to announce one
 * — so the opening quarter is the quiet one, and what the table learns during it
 * is what quarter 1 will bring. A mode with more quarters than the rotation has
 * entries wraps around it, which is exactly what `mode.campaign`'s eight quarters
 * do with the authored six.
 */
export function scheduledEventForQuarter(
  content: TransitionContent,
  index: number,
): string | null {
  if (index <= 0) return null;

  const order: readonly string[] = content.globalEventOrder;
  if (order.length === 0) return null;

  return order[(index - 1) % order.length] ?? null;
}

/**
 * Fills in the first announcement, and nothing else.
 *
 * `createGame` lays the whole schedule out with `scheduledEventId: null`, and
 * this is what makes the announcement rule real instead of assumed: a quarter's
 * event appears in canonical state exactly one quarter before it lands, so a
 * projection can show "next quarter: budget freeze" and cannot show quarter 7's
 * event during quarter 1. Writing the entire rotation up front would satisfy the
 * type and defeat the rule.
 */
export function initialiseQuarterSchedule(
  state: GameState,
  content: TransitionContent,
): readonly QuarterState[] {
  if (!globalEventsEnabled(state.rules)) return state.quarters;

  return state.quarters.map((quarter) =>
    quarter.index === state.currentQuarterIndex + 1
      ? { ...quarter, scheduledEventId: scheduledEventForQuarter(content, quarter.index) }
      : quarter,
  );
}

/**
 * The quarter the track should move to for `round`, or null when it should not
 * move.
 *
 * One step at a time: a caller that has somehow skipped a quarter calls again and
 * the skipped quarter still resolves its own event, rather than being silently
 * swallowed.
 */
export function pendingQuarterIndex(state: GameState, round: number): number | null {
  if (!quartersEnabled(state.rules) || state.quarters.length === 0) return null;

  const current = state.quarters[state.currentQuarterIndex];
  if (current === undefined) return null;
  if (round <= current.endsAtRound) return null;

  const next = state.currentQuarterIndex + 1;

  return next < state.quarters.length ? next : null;
}

/** The schedule has run out: a fixed-length match ends here. */
export function quartersElapsed(state: GameState, round: number): boolean {
  if (!quartersEnabled(state.rules) || state.quarters.length === 0) return false;

  const last = state.quarters[state.quarters.length - 1];

  return last !== undefined && round > last.endsAtRound;
}

function foldModifiers(modifiers: readonly GlobalEventModifier[]): QuarterModifiers {
  let folded = NEUTRAL_QUARTER_MODIFIERS;

  for (const modifier of modifiers) {
    switch (modifier.type) {
      case "blockPromotions":
        folded = { ...folded, promotionsBlocked: true };
        break;
      case "blockLoans":
        folded = { ...folded, loansBlocked: true };
        break;
      case "blockTileClaims":
        folded = { ...folded, tileClaimsBlocked: true };
        break;
      case "suspendUpkeep":
        folded = { ...folded, upkeepSuspended: true };
        break;
      case "multiplySalary":
        folded = { ...folded, salaryMultiplier: folded.salaryMultiplier * modifier.multiplier };
        break;
      case "multiplyProjectPayout":
        folded = {
          ...folded,
          projectPayoutMultiplier: folded.projectPayoutMultiplier * modifier.multiplier,
        };
        break;
      case "adjustHeatThreshold":
        folded = { ...folded, heatThresholdDelta: folded.heatThresholdDelta + modifier.delta };
        break;
      case "demoteLowest":
        // Resolved once when the quarter opens (see `applyDemoteLowest`) rather
        // than held as a rule: "the lowest reputation is demoted" is an event,
        // not a rule that can hold for four rounds, and content has nowhere else
        // to put it.
        break;
      default:
        modifier satisfies never;
    }
  }

  return folded;
}

/**
 * What the *current* quarter's event is doing to the table right now.
 *
 * Reads the event that has actually **resolved**, never the one merely
 * scheduled: an announced event is a warning, and a warning must not already be
 * halving salaries.
 */
export function activeQuarterModifiers(
  state: GameState,
  content: TransitionContent,
): QuarterModifiers {
  if (!globalEventsEnabled(state.rules)) return NEUTRAL_QUARTER_MODIFIERS;

  const quarter = state.quarters[state.currentQuarterIndex];
  if (quarter === undefined) return NEUTRAL_QUARTER_MODIFIERS;

  let folded = NEUTRAL_QUARTER_MODIFIERS;
  for (const eventId of quarter.resolvedEventIds) {
    const event = findEvent(content, eventId);
    if (event === null) continue;
    const next = foldModifiers(event.modifiers);
    folded = {
      promotionsBlocked: folded.promotionsBlocked || next.promotionsBlocked,
      loansBlocked: folded.loansBlocked || next.loansBlocked,
      tileClaimsBlocked: folded.tileClaimsBlocked || next.tileClaimsBlocked,
      upkeepSuspended: folded.upkeepSuspended || next.upkeepSuspended,
      salaryMultiplier: folded.salaryMultiplier * next.salaryMultiplier,
      projectPayoutMultiplier: folded.projectPayoutMultiplier * next.projectPayoutMultiplier,
      heatThresholdDelta: folded.heatThresholdDelta + next.heatThresholdDelta,
    };
  }

  return folded;
}

/** The event the table has been warned about, or null. */
export function announcedQuarterEventId(state: GameState): string | null {
  const next = state.quarters[state.currentQuarterIndex + 1];

  return next?.scheduledEventId ?? null;
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

function seatedPlayers(state: GameState): readonly PlayerId[] {
  return state.playerOrder.filter((playerId) => !state.eliminatedPlayerIds.includes(playerId));
}

/**
 * The table in standing order, best first: rank, then money, then reputation,
 * with `playerOrder` breaking every remaining tie.
 *
 * The seat-order tiebreak is not decoration. Two players on identical numbers
 * have to be ranked *somehow*, and the only alternatives — object key order, or
 * whatever `sort` happens to do — are not stable across the JSON round trip the
 * repository puts every state through.
 */
export function standingOrder(state: GameState): readonly PlayerId[] {
  const seats = [...seatedPlayers(state)];

  return seats.sort((left, right) => {
    const a = state.players[left];
    const b = state.players[right];
    if (a === undefined || b === undefined) return 0;
    if (a.rank.index !== b.rank.index) return b.rank.index - a.rank.index;

    const moneyDelta =
      resourceValue(b, "resource.money") - resourceValue(a, "resource.money");
    if (moneyDelta !== 0) return moneyDelta;

    const reputationDelta =
      resourceValue(b, "resource.reputation") - resourceValue(a, "resource.reputation");
    if (reputationDelta !== 0) return reputationDelta;

    return state.playerOrder.indexOf(left) - state.playerOrder.indexOf(right);
  });
}

/**
 * Who a global event's one-shot effects land on.
 *
 * Always returned in `playerOrder`, whatever order the predicate found them in,
 * because the effects are applied from a single random stream and the order they
 * are applied in decides who gets which draw.
 */
export function resolveGlobalEventScope(
  state: GameState,
  scope: GlobalEventScope,
): readonly PlayerId[] {
  const seats = seatedPlayers(state);
  const inSeatOrder = (chosen: readonly PlayerId[]): readonly PlayerId[] =>
    seats.filter((playerId) => chosen.includes(playerId));

  switch (scope) {
    case "all-players":
      return seats;
    case "leader": {
      const leader = standingOrder(state)[0];

      return leader === undefined ? [] : [leader];
    }
    case "trailing-players": {
      const standing = standingOrder(state);
      // The bottom half, and never nobody: an event scoped to the players who
      // are behind has to find at least one of them or it is not an event.
      const count = Math.max(1, Math.floor(standing.length / 2));

      return inSeatOrder(standing.slice(standing.length - count));
    }
    case "players-with-heat":
      return seats.filter((playerId) => (state.players[playerId]?.heat.value ?? 0) > 0);
    case "players-in-debt":
      return seats.filter((playerId) => {
        const player = state.players[playerId];
        if (player === undefined) return false;

        return (
          resourceValue(player, "resource.money") < 0 ||
          player.loans.some((loan) => loan.outstanding > 0)
        );
      });
    default:
      return scope satisfies never;
  }
}

function characterSalaryMultiplier(
  player: PlayerState,
  content: TransitionContent,
): number {
  const character = Object.values(content.characters).find(
    (candidate) => candidate.id === player.characterId,
  );

  return character?.passive.type === "salaryMultiplier" ? character.passive.multiplier : 1;
}

/**
 * `gainSalary` inside a global event.
 *
 * `resolveTileEffects` returns inert for this effect type — a landing's salary is
 * decided once per turn in the roll transition, from movement — so a global event
 * that awards one has to do it here or bonus season would pay nothing. The
 * quarter's own `multiplySalary` modifier applies: the modifier is in force from
 * the moment the quarter opens, and the payout happens at that same moment.
 */
function applyGlobalEventSalary(
  player: PlayerState,
  content: TransitionContent,
  salaryMultiplier: number,
): { readonly player: PlayerState; readonly previousValue: number; readonly newValue: number } | null {
  const rankKind = player.rank.kind;
  const rank = content.ranks.find((candidate) => candidate.id === rankKind);
  const money = findResourceEntry(player, "resource.money");
  if (rank === undefined || money === undefined) return null;

  const amount = rank.salary * characterSalaryMultiplier(player, content) * salaryMultiplier;
  if (amount === 0) return null;

  const [key, resource] = money;
  const newValue = resource.value + amount;

  return {
    player: {
      ...player,
      resources: { ...player.resources, [key]: { ...resource, value: newValue } },
    },
    previousValue: resource.value,
    newValue,
  };
}

function demoteRank(content: TransitionContent, rank: RankState): RankState | null {
  if (rank.index <= 0) return null;

  const toIndex = rank.index - 1;
  const toRank = content.ranks.find((candidate) => candidate.tier === toIndex + 1);
  if (toRank === undefined) return null;

  return {
    id: createStableId("RankId", toRank.id),
    kind: toRank.id as RankState["kind"],
    index: toIndex,
  };
}

/**
 * The layoffs modifier: the lowest player on the named resource loses a rung.
 *
 * A demotion and not a removal, deliberately — a mode with
 * `conflict.elimination: false` must still be able to schedule layoffs, and the
 * content note on `globalEvent.layoffs` says exactly that. Upkeep follows the new
 * rank down when the ruleset charges upkeep at all, so canonical state cannot
 * hold a player paying a rank they no longer have.
 */
function applyDemoteLowest(
  state: GameState,
  players: Readonly<Record<string, PlayerState>>,
  content: TransitionContent,
  resource: "money" | "reputation",
  globalEventId: string,
): { readonly players: Readonly<Record<string, PlayerState>>; readonly demotion: QuarterDemotion | null } {
  const kind: ResourceState["kind"] =
    resource === "money" ? "resource.money" : "resource.reputation";

  let worstId: PlayerId | null = null;
  let worstValue = Number.POSITIVE_INFINITY;
  for (const playerId of seatedPlayers(state)) {
    const player = players[playerId];
    if (player === undefined || player.rank.index <= 0) continue;

    const value = resourceValue(player, kind);
    // Strictly less than, walking `playerOrder`: on a tie the earliest seat is
    // the one that goes, which is arbitrary but fixed.
    if (value < worstValue) {
      worstValue = value;
      worstId = playerId;
    }
  }
  if (worstId === null) return { players, demotion: null };

  const player = players[worstId];
  if (player === undefined) return { players, demotion: null };

  const demoted = demoteRank(content, player.rank);
  if (demoted === null) return { players, demotion: null };

  const upkeepPerRound = state.rules.economy.upkeepEnabled
    ? (state.rules.economy.upkeepByRankIndex[demoted.index] ?? player.upkeep.perRound)
    : player.upkeep.perRound;

  return {
    players: {
      ...players,
      [worstId]: {
        ...player,
        rank: demoted,
        upkeep: { ...player.upkeep, perRound: upkeepPerRound },
      },
    },
    demotion: {
      playerId: worstId,
      fromRankIndex: player.rank.index,
      toRankIndex: demoted.index,
      globalEventId,
    },
  };
}

function isSalaryEffect(effect: EffectDescriptor): boolean {
  return effect.type === "gainSalary";
}

/**
 * Resolves one global event against the table.
 *
 * Players are walked in `playerOrder` and every one of them draws from the same
 * source in that order, so the whole resolution is a pure function of the state
 * it was applied to.
 */
function resolveGlobalEvent(
  state: GameState,
  players: Readonly<Record<string, PlayerState>>,
  content: TransitionContent,
  event: GlobalEventConfig,
  random: RandomSource,
): {
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly changes: readonly QuarterResourceChange[];
  readonly demotion: QuarterDemotion | null;
} {
  const modifiers = foldModifiers(event.modifiers);
  const targets = resolveGlobalEventScope(state, event.scope);
  const salaryEffects = event.effects.filter(isSalaryEffect);
  const otherEffects = event.effects.filter((effect) => !isSalaryEffect(effect));

  let updated = players;
  const changes: QuarterResourceChange[] = [];

  for (const playerId of targets) {
    const player = updated[playerId];
    if (player === undefined) continue;

    let current = player;
    for (let index = 0; index < salaryEffects.length; index += 1) {
      const paid = applyGlobalEventSalary(current, content, modifiers.salaryMultiplier);
      if (paid === null) continue;
      const money = findResourceEntry(current, "resource.money");
      current = paid.player;
      if (money !== undefined) {
        changes.push({
          playerId,
          resourceId: money[1].id,
          resourceKey: money[0],
          previousValue: paid.previousValue,
          newValue: paid.newValue,
          globalEventId: event.id,
        });
      }
    }

    const applied = applyEffectDescriptors(current, otherEffects, random);
    current = applied.player;
    for (const change of applied.changes) {
      const resource = current.resources[change.resource];
      if (resource === undefined) continue;
      changes.push({
        playerId,
        resourceId: resource.id,
        resourceKey: change.resource,
        previousValue: change.previousValue,
        newValue: change.newValue,
        globalEventId: event.id,
      });
    }

    updated = { ...updated, [playerId]: current };
  }

  let demotion: QuarterDemotion | null = null;
  for (const modifier of event.modifiers) {
    if (modifier.type !== "demoteLowest") continue;
    const result = applyDemoteLowest(state, updated, content, modifier.resource, event.id);
    updated = result.players;
    demotion = result.demotion ?? demotion;
  }

  return { players: updated, changes, demotion };
}

/**
 * Moves the quarter track on one step for `round`: resolves the arriving
 * quarter's announced event, and announces the one after it.
 *
 * Returns null when nothing is due, which is what makes this safe to call on
 * every turn hand-off and safe to call twice — the second call sees the pointer
 * already moved and declines. Idempotency is also belt-and-braces inside: an
 * event id already listed in the quarter's `resolvedEventIds` is never resolved
 * again.
 */
export function advanceQuarterForRound(
  state: GameState,
  content: TransitionContent,
  round: number,
  players: Readonly<Record<string, PlayerState>> = state.players,
  random?: RandomSource,
): QuarterAdvance | null {
  const targetIndex = pendingQuarterIndex(state, round);
  if (targetIndex === null) return null;

  const target = state.quarters[targetIndex];
  if (target === undefined) return null;

  const announceIndex = targetIndex + 1;
  const announcedEventId = globalEventsEnabled(state.rules)
    ? scheduledEventForQuarter(content, announceIndex)
    : null;
  const announcesInto = state.quarters[announceIndex] === undefined ? null : announceIndex;

  const scheduledEventId = globalEventsEnabled(state.rules)
    ? (target.scheduledEventId ?? scheduledEventForQuarter(content, targetIndex))
    : null;
  const alreadyResolved =
    scheduledEventId !== null && target.resolvedEventIds.includes(scheduledEventId);
  const event = alreadyResolved ? null : findEvent(content, scheduledEventId);

  const resolution =
    event === null
      ? { players, changes: [] as readonly QuarterResourceChange[], demotion: null }
      : resolveGlobalEvent(
          state,
          players,
          content,
          event,
          random ?? createQuarterEventRandom(state, targetIndex),
        );

  const quarters = state.quarters.map((quarter) => {
    if (quarter.index === targetIndex) {
      return {
        ...quarter,
        scheduledEventId,
        resolvedEventIds:
          event === null ? quarter.resolvedEventIds : [...quarter.resolvedEventIds, event.id],
      };
    }
    if (announcesInto !== null && quarter.index === announcesInto) {
      return { ...quarter, scheduledEventId: announcedEventId };
    }

    return quarter;
  });

  return {
    quarters,
    currentQuarterIndex: targetIndex,
    players: resolution.players,
    changes: resolution.changes,
    resolvedEventId: event?.id ?? null,
    announcedEventId: announcesInto === null ? null : announcedEventId,
    announcedForQuarterIndex: announcesInto,
    demotion: resolution.demotion,
  };
}

/**
 * The `quarter.advance` command.
 *
 * **Server-injected only** (spec §6.2): the quarter track is a property of the
 * round counter, so a player must never be able to push it. Authorisation is the
 * first thing checked and it is checked before anything is read, let alone
 * mutated — the actor has to be somebody who does not hold a seat, which is the
 * only signal a pure engine has for "this came from the server". The ordinary
 * path is `advanceQuarterForRound` called from the turn hand-off; this exists so
 * the server can also drive the track directly (a resumed room whose round moved
 * on while nobody was connected, for instance).
 *
 * Idempotent: with no quarter due it is refused rather than applied twice.
 */
export function advanceQuarter(
  state: GameState,
  command: AdvanceQuarterCommand,
  context: TransitionContext,
): TransitionResult {
  if (state.players[command.actorId] !== undefined) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "The quarter track can only be advanced by the server",
    });
  }
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Quarters only advance in an active game",
    });
  }
  if (!quartersEnabled(state.rules)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This ruleset does not play with quarters",
    });
  }

  const advance = advanceQuarterForRound(state, context.content, state.turn.round);
  if (advance === null) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "No quarter is due to advance",
    });
  }

  const events = advance.changes.map<ResourceChangedEvent>((change, index) => ({
    ...createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + index + 1,
    ),
    type: "ResourceChanged",
    payload: {
      playerId: change.playerId,
      resourceId: change.resourceId,
      previousValue: change.previousValue,
      newValue: change.newValue,
      reason: `global-event:${change.globalEventId}`,
    },
  }));
  const lastEvent = events[events.length - 1];

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent?.sequence ?? state.eventSequence,
        players: advance.players,
        quarters: advance.quarters,
        currentQuarterIndex: advance.currentQuarterIndex,
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}
