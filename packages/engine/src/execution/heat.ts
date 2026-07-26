import type {
  GameState,
  ModeRules,
  PlayerId,
  PlayerState,
  PromptState,
} from "../model";
import { createStableId } from "../model";
import type { ResourceKey, TileEffectChange } from "./resolve-tile-effects";

/**
 * Heat — HR suspicion — is the price of aggression, and it is the reason this
 * module exists as a single primitive rather than as four copies.
 *
 * Spec §5.4 is blunt about why: *"Aggression must cost the aggressor or the game
 * degenerates into every table alpha-striking the leader every match."* Every
 * aggressive verb in gameplay v2 — `attack.target`, `project.sabotage`, a hostile
 * `applyStatus`, a `transferResource` aimed at somebody else, breaking a recorded
 * agreement — must charge the *actor* through {@link raiseHeat}. If four agents
 * each write their own curve, the cost of aggression stops being a single legible
 * number and the whole deterrent stops working.
 *
 * Nothing here reads a clock, draws randomness, or compares a `modeId`. Every
 * magnitude comes from `state.rules.conflict`, so a mode can switch the entire
 * mechanic off (`heatEnabled: false`) and every function below degrades to a
 * no-op rather than to a hidden default.
 */

/** The status id `grantImmunity` writes and every targeted attack checks. */
export const ATTACK_IMMUNITY_STATUS_ID = "status.attack-immunity";

/** `PromptState.kind` for the investigation opened against an *attacker*. */
export const HEAT_INVESTIGATION_PROMPT_KIND = "heat-investigation";

/**
 * The two branches of an investigation.
 *
 * `take-leave` is deliberately first and is the default response: answering a
 * prompt already costs the attacker their turn, so a consumer with no opinion (a
 * timeout, a naive bot) must take the branch that spends no resource — the same
 * principle `buildDecisionPrompt` applies in roll-turn.ts.
 */
export const HEAT_INVESTIGATION_OPTIONS = {
  /** Take gardening leave: one turn skipped, no resource spent. */
  takeLeave: "take-leave",
  /** Accept the reprimand: reputation docked by the heat threshold you crossed. */
  acceptReprimand: "accept-reprimand",
} as const;

export type HeatInvestigationOptionId =
  (typeof HEAT_INVESTIGATION_OPTIONS)[keyof typeof HEAT_INVESTIGATION_OPTIONS];

/**
 * Which aggressive verb is being charged. A domain label, not a magnitude: the
 * amount always comes from `rules.conflict.heatPerAttack`, so a new aggressive
 * mechanic adds a member here and changes nothing about the curve.
 */
export type HeatSource =
  | "attack"
  | "project-sabotage"
  | "placement"
  | "agreement-breach"
  | "hostile-effect";

export type RaiseHeatInput = {
  readonly rules: ModeRules;
  readonly player: PlayerState;
  /** `state.turn.round`, recorded on the heat track. Never a wall clock. */
  readonly round: number;
  readonly source: HeatSource;
  /**
   * How many times `heatPerAttack` is charged. Defaults to 1. Leader protection
   * is the only thing that raises it today — see {@link applyLeaderProtection}.
   */
  readonly charges?: number;
};

export type RaiseHeatOutcome = {
  readonly player: PlayerState;
  readonly source: HeatSource;
  readonly previousValue: number;
  readonly newValue: number;
  /** Heat actually added. Zero when the mode has heat switched off. */
  readonly amount: number;
  readonly threshold: number;
  /**
   * True when this raise crossed the next multiple of the threshold, and the
   * caller must therefore open an investigation prompt against the *attacker*
   * (see {@link buildInvestigationPrompt}).
   */
  readonly investigationOpened: boolean;
};

function thresholdOf(rules: ModeRules): number {
  // A threshold of zero would trip an investigation on a raise of nothing, so
  // the floor is 1 — which is also the minimum every shipped preset carries and
  // the minimum `MODE_RULES_BOUNDS` validates a custom ruleset against.
  const configured = Math.floor(rules.conflict.heatThreshold);

  return Number.isFinite(configured) ? Math.max(1, configured) : 1;
}

function chargesOf(charges: number | undefined): number {
  if (charges === undefined) return 1;
  if (!Number.isFinite(charges)) return 1;

  return Math.max(0, Math.floor(charges));
}

/**
 * **The** heat primitive. Every aggressive action in the game routes through it.
 *
 * The curve, stated once so nobody has to reverse-engineer it:
 *
 * - Heat only accumulates; it is never silently reset. It is a public record of
 *   how much damage a player has done, which is exactly what makes the table able
 *   to price a would-be aggressor.
 * - An investigation opens the moment `value` reaches the next whole multiple of
 *   `threshold` — 1x, 2x, 3x — so the *n*th investigation costs the same number of
 *   aggressive acts as the first. `investigationsOpened` is the counter that
 *   remembers where the last one fired, so a single large raise that jumps several
 *   multiples opens one investigation and clears the backlog rather than queueing
 *   one prompt per multiple.
 * - `heatEnabled: false` makes this a total no-op: the player comes back
 *   untouched, `amount` is 0, and no investigation is ever reported. That is the
 *   config switch the spec's §4 demands, and it is why no caller may add heat by
 *   hand.
 *
 * Pure and total: no clock, no randomness, no lookups outside the arguments.
 */
export function raiseHeat(input: RaiseHeatInput): RaiseHeatOutcome {
  const { rules, player, round, source } = input;
  const heat = player.heat;
  const threshold = thresholdOf(rules);

  if (!rules.conflict.heatEnabled) {
    return {
      player,
      source,
      previousValue: heat.value,
      newValue: heat.value,
      amount: 0,
      threshold: heat.threshold,
      investigationOpened: false,
    };
  }

  const perAttack = Number.isFinite(rules.conflict.heatPerAttack)
    ? Math.max(0, Math.floor(rules.conflict.heatPerAttack))
    : 0;
  const amount = perAttack * chargesOf(input.charges);
  const newValue = heat.value + amount;
  const investigationOpened =
    amount > 0 && newValue >= threshold * (heat.investigationsOpened + 1);
  const investigationsOpened = investigationOpened
    ? Math.max(heat.investigationsOpened + 1, Math.floor(newValue / threshold))
    : heat.investigationsOpened;

  return {
    player: {
      ...player,
      heat: {
        value: newValue,
        threshold,
        investigationsOpened,
        lastIncrementedAtRound: amount > 0 ? round : heat.lastIncrementedAtRound,
      },
    },
    source,
    previousValue: heat.value,
    newValue,
    amount,
    threshold,
    investigationOpened,
  };
}

/**
 * The relief half of `modifyHeat` (spec §10.3, "raise or lower suspicion").
 *
 * Deliberately *not* a negative {@link raiseHeat}: lowering heat can never open
 * an investigation and must never move `investigationsOpened`, or a player could
 * launder a crossing by buying heat down and back up again.
 */
export function lowerHeat(player: PlayerState, amount: number): PlayerState {
  if (!Number.isFinite(amount) || amount <= 0) return player;

  const newValue = Math.max(0, player.heat.value - Math.floor(amount));
  if (newValue === player.heat.value) return player;

  return { ...player, heat: { ...player.heat, value: newValue } };
}

function resourceValue(player: PlayerState, key: ResourceKey): number {
  return player.resources[key]?.value ?? 0;
}

/**
 * Standing, most-ahead first: rank, then money, then reputation.
 *
 * Ties are *not* broken here. A tie means nobody is meaningfully ahead, and
 * "ahead" is the only thing leader protection is about — see
 * {@link findLeaderPlayerId}.
 */
function compareStanding(left: PlayerState, right: PlayerState): number {
  if (left.rank.index !== right.rank.index) {
    return left.rank.index - right.rank.index;
  }
  const money = resourceValue(left, "money") - resourceValue(right, "money");
  if (money !== 0) return money;

  return resourceValue(left, "reputation") - resourceValue(right, "reputation");
}

/**
 * Who, if anyone, is currently ahead.
 *
 * Walks `playerOrder` — never `Object.keys(players)`, whose order is not a
 * contract across the repository's `JSON.parse(JSON.stringify(…))` boundary — and
 * skips eliminated players.
 *
 * Returns `null` when the top standing is shared. That is not a tie-break dodge:
 * on round one every player is identical, and a rule that quietly anointed
 * whoever happened to sit in seat zero as "the leader" would hand them a
 * protection they did nothing to earn.
 */
export function findLeaderPlayerId(state: GameState): PlayerId | null {
  let leader: PlayerState | null = null;
  let shared = false;

  for (const playerId of state.playerOrder) {
    if (state.eliminatedPlayerIds.includes(playerId)) continue;
    const candidate = state.players[playerId];
    if (candidate === undefined) continue;
    if (leader === null) {
      leader = candidate;
      shared = false;
      continue;
    }

    const comparison = compareStanding(candidate, leader);
    if (comparison > 0) {
      leader = candidate;
      shared = false;
    } else if (comparison === 0) {
      shared = true;
    }
  }

  return leader === null || shared ? null : leader.id;
}

/**
 * The heat surcharge for hitting the player who is already ahead.
 *
 * One structural multiple, not a tunable: the base charge plus a surcharge of
 * exactly the same size. Every magnitude in the mechanic still comes from
 * `rules.conflict.heatPerAttack`; the enum only decides how many times it is
 * charged.
 */
const LEADER_SURCHARGE_CHARGES = 2;

export type LeaderProtectionRuling =
  | {
      readonly kind: "allowed";
      /** Pass straight to `raiseHeat`'s `charges`. */
      readonly heatCharges: number;
      readonly targetIsLeader: boolean;
    }
  | { readonly kind: "forbidden" };

/**
 * `conflict.leaderProtection`, applied to one prospective target.
 *
 * - `none` — nothing to see; every target costs the base charge.
 * - `soft` — the leader is still attackable, but it costs double heat, so the
 *   table can still gang up on a runaway and simply pays for it.
 * - `hard` — the leader cannot be targeted at all. The caller must reject.
 *
 * Under `none` the leader is not even computed: the ruling is identical either
 * way, and the comparison is the one place this module walks every player.
 */
export function applyLeaderProtection(
  state: GameState,
  targetPlayerId: PlayerId,
): LeaderProtectionRuling {
  const protection = state.rules.conflict.leaderProtection;
  if (protection === "none") {
    return { kind: "allowed", heatCharges: 1, targetIsLeader: false };
  }

  const leaderId = findLeaderPlayerId(state);
  if (leaderId === null || leaderId !== targetPlayerId) {
    return { kind: "allowed", heatCharges: 1, targetIsLeader: false };
  }
  if (protection === "hard") {
    return { kind: "forbidden" };
  }

  return {
    kind: "allowed",
    heatCharges: LEADER_SURCHARGE_CHARGES,
    targetIsLeader: true,
  };
}

/**
 * The investigation prompt, addressed to the attacker.
 *
 * Ids come from `sequence` — the event sequence the accompanying `PromptOpened`
 * event will carry, which is the game's own monotonic counter — exactly as
 * roll-turn.ts derives its prompt ids. Nothing client-supplied reaches an id
 * here: a client that could name a prompt could aim it at another player's.
 *
 * `visibility: "public"`. Heat is public state by design (it is what lets the
 * table price an aggressor), so hiding the consequence would be theatre.
 */
export function buildInvestigationPrompt(
  state: GameState,
  sequence: number,
  playerId: PlayerId,
): PromptState {
  return {
    id: createStableId(
      "DecisionPointId",
      `${state.gameId}:prompt:${sequence}:${HEAT_INVESTIGATION_PROMPT_KIND}`,
    ),
    frameId: createStableId("FrameId", `${state.gameId}:frame:${sequence}`),
    kind: HEAT_INVESTIGATION_PROMPT_KIND,
    audience: [playerId],
    legalResponses: [
      {
        id: createStableId("PromptOptionId", HEAT_INVESTIGATION_OPTIONS.takeLeave),
        value: null,
      },
      {
        id: createStableId(
          "PromptOptionId",
          HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
        ),
        value: null,
      },
    ],
    // The engine writes no wall-clock deadline (spec §7.1): the server's
    // scheduler owns expiry and injects `window.expire` through the ordinary
    // command path, the same way `TurnState.deadlineAt` is filled today.
    deadlineAt: null,
    defaultResponse: {
      optionId: createStableId(
        "PromptOptionId",
        HEAT_INVESTIGATION_OPTIONS.takeLeave,
      ),
      value: null,
    },
    visibility: "public",
    responses: {},
  };
}

export type InvestigationResolution = {
  readonly player: PlayerState;
  /**
   * Shaped for `emitResourceEvents` in respond-to-prompt.ts, so the integrator
   * emits investigation resource changes exactly the way it already emits tile
   * ones.
   */
  readonly changes: readonly TileEffectChange[];
  /** Always false: both branches close the investigation. */
  readonly keepPromptOpen: false;
};

/**
 * Resolves one answer to a `heat-investigation` prompt.
 *
 * Both branches close the investigation and both cost the attacker their turn
 * (answering a prompt ends a turn), so the choice is a real trade-off rather than
 * a strictly-dominated pair:
 *
 * - `take-leave` — one further turn skipped. Costs tempo, spends no resource,
 *   and is the default a timeout takes.
 * - `accept-reprimand` — reputation docked by `conflict.heatThreshold`, the exact
 *   amount of heat that triggered the investigation. Costs a promotion path,
 *   keeps the tempo.
 *
 * Returns `null` when `optionId` is neither branch, so the caller rejects with
 * `INVALID_PROMPT_RESPONSE` instead of silently doing nothing.
 */
export function resolveInvestigationResponse(
  state: GameState,
  player: PlayerState,
  optionId: string,
): InvestigationResolution | null {
  if (optionId === HEAT_INVESTIGATION_OPTIONS.takeLeave) {
    return {
      player: { ...player, skipTurns: player.skipTurns + 1 },
      changes: [],
      keepPromptOpen: false,
    };
  }
  if (optionId !== HEAT_INVESTIGATION_OPTIONS.acceptReprimand) {
    return null;
  }

  const reputation = player.resources.reputation;
  if (reputation === undefined) {
    return { player, changes: [], keepPromptOpen: false };
  }

  const floorValue = reputation.minimum ?? 0;
  const newValue = Math.max(floorValue, reputation.value - thresholdOf(state.rules));
  if (newValue === reputation.value) {
    return { player, changes: [], keepPromptOpen: false };
  }

  return {
    player: {
      ...player,
      resources: {
        ...player.resources,
        reputation: { ...reputation, value: newValue },
      },
    },
    changes: [
      {
        resource: "reputation",
        previousValue: reputation.value,
        newValue,
      },
    ],
    keepPromptOpen: false,
  };
}
