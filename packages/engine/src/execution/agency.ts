import type { BoardTile } from "@office-ladder/content";

import type {
  ActivateCharacterCommand,
  AdjustRollCommand,
  GameCommand,
  PayAuditFineCommand,
  ShuffleManagementDeckCommand,
} from "../commands";
import type {
  EffectProposedEvent,
  GameEvent,
  PlayerMovedEvent,
  ResourceChangedEvent,
  StatusAppliedEvent,
  TurnStartedEvent,
} from "../events";
import type {
  AbilityId,
  AbilityState,
  DeckState,
  GameState,
  JsonObject,
  JsonValue,
  ModeRules,
  PlayerId,
  PlayerState,
  PlayerStatusState,
  ResourceState,
} from "../model";
import { createStableId } from "../model";
import { createSeededRandomSource, randomInt, type RandomSource } from "../random";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import { resolveNextTurn, withBurnoutRecoveries } from "./next-turn";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Statuses this module writes into `PlayerState.statuses`.
 *
 * Every one of them is a *pending decision the player already paid for*, and
 * they live on the player rather than in a new `GameState` field on purpose:
 * `statuses` is the one already-modelled, JSON-serialisable, per-player slot
 * that survives the repository's `JSON.parse(JSON.stringify(…))` boundary
 * unchanged, and the roll transition already knows how to read and consume
 * statuses (`status.next-roll-extra-movement`, `status.next-salary-multiplier`).
 * Adding a field to `GameState` for a one-turn scratchpad would have been a
 * schema change for something that is, by construction, transient.
 */
export const AGENCY_STATUS_IDS = {
  /** Pips of paid-for dice adjustment waiting for the next roll. */
  rollAdjustment: "status.roll-adjustment",
  /** A spent Lucky Employee active: the next roll draws twice. */
  rollReroll: "status.next-roll-reroll",
  /** How many turn actions the holder has spent, and on which turn number. */
  turnActions: "status.turn-actions",
  /** The holder waved promotion off at a rank; suppresses the offer, not the command. */
  promotionDeclined: "status.promotion-declined",
  /** Existing status, already consumed by the roll transition's salary step. */
  nextSalaryMultiplier: "status.next-salary-multiplier",
} as const;

/** How the four turn verbs and a character activation draw from one budget. */
export type TurnActionBudget = {
  readonly perTurn: number;
  readonly used: number;
  readonly remaining: number;
};

export type ActorGuard =
  | { readonly ok: true; readonly player: PlayerState }
  | { readonly ok: false; readonly rejection: TransitionResult };

export type TurnActorOptions = {
  /**
   * Let the command through even though a prompt addressed to the actor is
   * open. Exactly one command needs this — `audit.pay-fine`, which *is* the
   * answer to the audit-release prompt blocking the actor.
   */
  readonly allowOwnPrompt?: boolean;
};

/* ------------------------------------------------------------------ *
 * Guards
 * ------------------------------------------------------------------ */

/**
 * The identity and lifecycle checks every command in this wave repeats.
 *
 * Deliberately duplicated rather than delegated to `applyCommand`: a transition
 * that is only safe because its caller checked something is a transition that
 * becomes unsafe the moment it is called from a second place (a bot policy, a
 * server-injected expiry, a future macro command). `rollTurn` already re-checks
 * its own preconditions for the same reason.
 */
export function requireSeatedActor(
  state: GameState,
  command: GameCommand,
): ActorGuard {
  const player = state.players[command.actorId];
  if (player === undefined) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "ACTOR_NOT_FOUND",
        message: "Command actor is not a player in this game",
      }),
    };
  }
  if (state.status === "ended" || state.outcome !== null) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "GAME_ALREADY_ENDED",
        message: "The game has already ended",
      }),
    };
  }
  if (state.status !== "active") {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "GAME_NOT_ACTIVE",
        message: "The game cannot currently accept commands",
      }),
    };
  }
  if (state.eliminatedPlayerIds.includes(command.actorId)) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "An eliminated player cannot act",
      }),
    };
  }

  return { ok: true, player };
}

/** `requireSeatedActor` plus "it is your turn, and the turn is yours to spend". */
export function requireTurnActor(
  state: GameState,
  command: GameCommand,
  options: TurnActorOptions = {},
): ActorGuard {
  const seated = requireSeatedActor(state, command);
  if (!seated.ok) return seated;

  if (state.turn.activePlayerId !== command.actorId) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "NOT_ACTOR_TURN",
        message: "Only the active player can act",
      }),
    };
  }
  if (state.turn.phase !== "pre-roll") {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "INVALID_PHASE",
        message: "This command can only be issued before rolling",
      }),
    };
  }

  const ownPromptOpen = state.prompts.some((prompt) =>
    prompt.audience.includes(command.actorId),
  );
  if (
    state.resolutionStack.length > 0 ||
    state.pendingEffects.length > 0 ||
    state.reactionWindows.length > 0 ||
    (ownPromptOpen && options.allowOwnPrompt !== true)
  ) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "Pending engine work blocks this command",
      }),
    };
  }

  return { ok: true, player: seated.player };
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export type EventCollector = {
  readonly events: GameEvent[];
  /** The sequence the *next* pushed event will carry. */
  nextSequence(): number;
  metadata(): Omit<GameEvent, "type" | "payload">;
};

export function createEventCollector(
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
): EventCollector {
  const events: GameEvent[] = [];

  return {
    events,
    nextSequence: () => state.eventSequence + events.length + 1,
    metadata: () =>
      createEventMetadata(
        state,
        command,
        context.logicalTimestamp,
        state.eventSequence + events.length + 1,
      ),
  };
}

/**
 * The generic "this command happened" marker.
 *
 * The event union has no member for a free action, a dice adjustment, a
 * character activation or a deck shuffle, and the union is owned elsewhere.
 * `EffectProposed` is the vocabulary the union already provides for "an effect
 * with this shape was raised", so it carries a structured `effect` object rather
 * than inventing an event type this wave is not allowed to add. Every command
 * here emits exactly one, which also guarantees the "an accepted command always
 * emits at least one event" invariant even when nothing numeric moved.
 */
export function pushMarker(
  state: GameState,
  collector: EventCollector,
  effect: JsonObject,
  affectedPlayerIds: readonly PlayerId[],
): void {
  const sequence = collector.nextSequence();
  const proposed: EffectProposedEvent = {
    ...collector.metadata(),
    type: "EffectProposed",
    payload: {
      effectId: createStableId("EffectId", `${state.gameId}:effect:${sequence}`),
      affectedPlayerIds,
      effect,
    },
  };
  collector.events.push(proposed);
}

export function pushResourceChanged(
  collector: EventCollector,
  playerId: PlayerId,
  resource: ResourceState,
  previousValue: number,
  newValue: number,
  reason: string,
): void {
  if (previousValue === newValue) return;

  const changed: ResourceChangedEvent = {
    ...collector.metadata(),
    type: "ResourceChanged",
    payload: { playerId, resourceId: resource.id, previousValue, newValue, reason },
  };
  collector.events.push(changed);
}

/* ------------------------------------------------------------------ *
 * Resources
 * ------------------------------------------------------------------ */

/**
 * A player's resource of a given kind, found without depending on record key
 * order.
 *
 * The keys are scanned in sorted order rather than insertion order because a
 * `GameState` that has been through the repository's jsonb boundary comes back
 * with its keys re-ordered, and "the first entry whose kind matches" would then
 * be a different entry. Sorting makes the lookup a function of the *set* of
 * keys, which the round trip preserves.
 */
export function findResourceEntry(
  player: PlayerState,
  kind: ResourceState["kind"],
): readonly [string, ResourceState] | null {
  const keys = Object.keys(player.resources).sort();
  for (const key of keys) {
    const resource = player.resources[key];
    if (resource !== undefined && resource.kind === kind) {
      return [key, resource];
    }
  }

  return null;
}

export type ResourceWrite = {
  readonly player: PlayerState;
  readonly resource: ResourceState;
  readonly previousValue: number;
  readonly newValue: number;
};

/** Writes an absolute value, honouring the resource's own floor and ceiling. */
export function writeResource(
  player: PlayerState,
  key: string,
  resource: ResourceState,
  value: number,
): ResourceWrite {
  let next = value;
  if (resource.minimum !== null) next = Math.max(resource.minimum, next);
  if (resource.maximum !== null) next = Math.min(resource.maximum, next);

  const updated: ResourceState = { ...resource, value: next };

  return {
    player: { ...player, resources: { ...player.resources, [key]: updated } },
    resource: updated,
    previousValue: resource.value,
    newValue: next,
  };
}

/* ------------------------------------------------------------------ *
 * Statuses
 * ------------------------------------------------------------------ */

export function readStatusData(
  player: PlayerState,
  statusId: string,
): JsonObject | null {
  const status = player.statuses.find(
    (candidate) => candidate.id === statusId && candidate.stacks > 0,
  );

  return status?.data ?? null;
}

export function setStatus(
  player: PlayerState,
  statusId: string,
  data: JsonObject,
  stacks = 1,
): PlayerState {
  const status: PlayerStatusState = {
    id: createStableId("StatusId", statusId),
    sourceId: "agency",
    stacks,
    remainingTurns: null,
    expiresAtRound: null,
    visibility: "private",
    data,
  };

  return {
    ...player,
    statuses: [
      ...player.statuses.filter((existing) => existing.id !== statusId),
      status,
    ],
  };
}

export function removeStatus(player: PlayerState, statusId: string): PlayerState {
  if (!player.statuses.some((status) => status.id === statusId)) return player;

  return {
    ...player,
    statuses: player.statuses.filter((status) => status.id !== statusId),
  };
}

function readNumber(data: JsonObject | null, key: string): number | null {
  if (data === null) return null;
  const value = data[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * The per-turn action budget
 * ------------------------------------------------------------------ */

/**
 * One budget for every optional verb a turn can contain — the four free actions
 * *and* a character activation *and* a management deck shuffle.
 *
 * A single budget is what stops a turn from being "do everything, then roll",
 * and it is the switch that turns all of them off together: a mode with
 * `agency.freeActionsPerTurn: 0` has no optional verbs at all, which is exactly
 * the roll-and-move game this wave replaces. Dice adjustment is deliberately
 * *not* in here — it is priced in energy and bounded by `maxPipAdjust`, so it
 * already has its own limiter.
 */
export function turnActionBudget(
  state: GameState,
  player: PlayerState,
): TurnActionBudget {
  const perTurn = Math.max(0, Math.floor(state.rules.agency.freeActionsPerTurn));
  const data = readStatusData(player, AGENCY_STATUS_IDS.turnActions);
  const recordedTurn = readNumber(data, "turn");
  const used =
    recordedTurn === state.turn.number ? Math.max(0, readNumber(data, "used") ?? 0) : 0;

  return { perTurn, used, remaining: Math.max(0, perTurn - used) };
}

export function consumeTurnActions(
  state: GameState,
  player: PlayerState,
  count: number,
): PlayerState {
  const budget = turnActionBudget(state, player);
  const used = Math.min(budget.perTurn, budget.used + Math.max(0, Math.floor(count)));

  return setStatus(player, AGENCY_STATUS_IDS.turnActions, {
    turn: state.turn.number,
    used,
  });
}

/* ------------------------------------------------------------------ *
 * Heat
 * ------------------------------------------------------------------ */

/**
 * The price of aggression (spec §5.4 and §10.4: every aggressive effect carries
 * a heat increment on its actor).
 *
 * A no-op when the mode has heat switched off, so an aggressive verb stays
 * available in a mode that simply does not model suspicion. Crossing
 * `threshold` is deliberately *not* handled here — opening an investigation
 * against the attacker is the conflict mechanic's job, and it reads the same
 * `HeatState` this writes.
 */
export function raiseHeat(
  player: PlayerState,
  rules: ModeRules,
  round: number,
): PlayerState {
  if (!rules.conflict.heatEnabled) return player;

  const increment = Math.max(0, rules.conflict.heatPerAttack);
  if (increment === 0) return player;

  return {
    ...player,
    heat: {
      ...player.heat,
      value: player.heat.value + increment,
      lastIncrementedAtRound: round,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Randomness
 * ------------------------------------------------------------------ */

/**
 * A seeded source for one agency command, following the same discipline as
 * `ephemeral-random.ts`: every seed field is server-owned canonical state, the
 * client's command id is deliberately absent (seeding from it was a real
 * exploit — a client could grind ids offline until one produced the shuffle it
 * wanted), and the seed is a pure function of `state` so a replay re-derives it
 * exactly.
 *
 * It builds its own seed rather than calling `createEphemeralRandom` only
 * because `EphemeralRandomPurpose` is a closed union owned by another file in
 * this wave. The `"agency"` prefix is the domain separator: no purpose string
 * there can ever produce this seed, so these draws cannot correlate with a tile
 * check or an audit-release attempt resolved against the same state.
 */
function agencyRandom(state: GameState, purpose: string): RandomSource {
  const dice = state.rng.streams.dice;
  const setup = state.rng.streams.setup;
  const seed = [
    "agency",
    purpose,
    state.gameId,
    String(state.revision),
    String(state.eventSequence),
    dice?.algorithm ?? "-",
    dice?.state ?? "-",
    dice === undefined ? "-" : String(dice.cursor),
    setup?.algorithm ?? "-",
    setup?.state ?? "-",
    setup === undefined ? "-" : String(setup.cursor),
  ].join("|");

  return createSeededRandomSource(seed);
}

function shuffled<T>(items: readonly T[], random: RandomSource): readonly T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = randomInt(random, 0, index);
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * turn.adjust-roll
 * ------------------------------------------------------------------ */

/** Pips of adjustment the player has already paid for and not yet spent. */
export function pendingRollAdjustment(player: PlayerState): number {
  const pips = readNumber(
    readStatusData(player, AGENCY_STATUS_IDS.rollAdjustment),
    "pips",
  );

  return pips === null ? 0 : Math.trunc(pips);
}

export type RollAgencyOutcome = {
  readonly player: PlayerState;
  /** The face to move on: rerolled if a reroll was spent, then shifted. Always >= 1. */
  readonly die: number;
  /** The face the dice source produced first, before any agency applied. */
  readonly rawDie: number;
  /** The shift actually applied — smaller than the shift paid for if the >= 1 clamp bit. */
  readonly adjustment: number;
  /** The second face a spent reroll drew, or null when none was spent. */
  readonly rerolledFace: number | null;
};

/**
 * **The seam `roll-turn.ts` calls.** One line, immediately after the movement
 * die is drawn:
 *
 * ```ts
 * const agency = applyRollAgency(player, die, () => rollDie(trackedRandom.source));
 * ```
 *
 * It consumes the two "next roll" agency statuses and hands back the face to
 * actually move on. Everything it consumes was paid for on an earlier command
 * (energy for pips, a character activation for the reroll), so this function
 * charges nothing and can never reject.
 *
 * The extra die comes from the caller's own dice source through `rollAgain`,
 * not from a source built here, so the persisted stream's cursor accounting
 * stays correct and the reroll is as replayable as the first face.
 */
export function applyRollAgency(
  player: PlayerState,
  die: number,
  rollAgain: () => number,
): RollAgencyOutcome {
  let updated = player;
  let face = die;
  let rerolledFace: number | null = null;

  if (readStatusData(player, AGENCY_STATUS_IDS.rollReroll) !== null) {
    rerolledFace = rollAgain();
    // "Lucky", not "gambling": the ability is spent before the face is known,
    // so keeping the better of the two is the only reading under which spending
    // it is ever correct.
    face = Math.max(face, rerolledFace);
    updated = removeStatus(updated, AGENCY_STATUS_IDS.rollReroll);
  }

  const requested = pendingRollAdjustment(player);
  if (requested !== 0) {
    updated = removeStatus(updated, AGENCY_STATUS_IDS.rollAdjustment);
  }
  // A roll never stops a player dead: moving zero spaces would re-resolve the
  // tile they are already standing on, which the movement rules also guard.
  const adjusted = Math.max(1, face + requested);

  return {
    player: updated,
    die: adjusted,
    rawDie: die,
    adjustment: adjusted - face,
    rerolledFace,
  };
}

/**
 * Spend energy to shift the roll you are about to make.
 *
 * This is what turns energy from a passive drain into a resource you steer
 * with: every pip costs `rules.agency.energyPerPip`, the running total is
 * bounded by `rules.agency.maxPipAdjust`, and the whole mechanic is off when
 * `rules.agency.diceAdjustEnabled` is false. Several commands may stack up to
 * the cap, and `pips` may be negative — landing *short* of a tile is often the
 * point.
 */
export function adjustRoll(
  state: GameState,
  command: AdjustRollCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = requireTurnActor(state, command);
  if (!guard.ok) return guard.rejection;

  const rules = state.rules.agency;
  if (!rules.diceAdjustEnabled || rules.maxPipAdjust <= 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode does not allow the roll to be adjusted",
    });
  }

  const pips = command.payload.pips;
  if (!Number.isSafeInteger(pips) || pips === 0) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Roll adjustment must be a non-zero whole number of pips",
    });
  }

  const player = guard.player;
  const current = pendingRollAdjustment(player);
  const total = current + pips;
  if (Math.abs(total) > Math.floor(rules.maxPipAdjust)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Adjustment exceeds this mode's pip cap",
      details: { requested: total, maxPipAdjust: rules.maxPipAdjust },
    });
  }

  const cost = Math.abs(pips) * Math.max(0, rules.energyPerPip);
  const energy = findResourceEntry(player, "resource.energy");
  if (cost > 0 && energy === null) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "The actor has no energy to spend on a roll adjustment",
    });
  }
  if (energy !== null && energy[1].value < cost) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Not enough energy to adjust the roll by that much",
      details: { cost, available: energy[1].value },
    });
  }

  const collector = createEventCollector(state, command, context);
  let updated = player;

  if (energy !== null && cost > 0) {
    const write = writeResource(updated, energy[0], energy[1], energy[1].value - cost);
    updated = write.player;
    pushResourceChanged(
      collector,
      player.id,
      write.resource,
      write.previousValue,
      write.newValue,
      "roll-adjustment",
    );
  }

  updated =
    total === 0
      ? removeStatus(updated, AGENCY_STATUS_IDS.rollAdjustment)
      : setStatus(updated, AGENCY_STATUS_IDS.rollAdjustment, { pips: total });

  pushMarker(
    state,
    collector,
    { kind: "turn.adjust-roll", pips, total, energySpent: cost },
    [player.id],
  );

  return commit(state, command, collector, { [player.id]: updated });
}

/* ------------------------------------------------------------------ *
 * audit.pay-fine
 * ------------------------------------------------------------------ */

/** The fine authored on the board's audit tile; never a constant in here. */
export function auditFineAmount(context: TransitionContext): number | null {
  for (const tile of context.content.board.spaces as readonly BoardTile[]) {
    for (const effect of tile.effects) {
      if (effect.type === "auditConfinement") {
        return effect.release.alternativeFine;
      }
    }
  }

  return null;
}

/**
 * Buy your way out of audit confinement.
 *
 * The same trade the audit-release prompt's `pay-fine` branch offers, reachable
 * as a first-class command so a client does not have to hold a decision-point
 * id to take it. It costs the turn for exactly the reason the prompt branch
 * does — confinement is the penalty, and paying it off is what the turn was
 * for — so releasing here and *also* rolling would make the command strictly
 * better than the prompt it mirrors.
 */
export function payAuditFine(
  state: GameState,
  command: PayAuditFineCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = requireTurnActor(state, command, { allowOwnPrompt: true });
  if (!guard.ok) return guard.rejection;

  const player = guard.player;
  if (!player.inAudit) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "The actor is not in audit confinement",
    });
  }

  const fine = auditFineAmount(context);
  if (fine === null) {
    return rejectCommand(state, command, {
      code: "CONTENT_MISMATCH",
      message: "The content pack authors no audit fine",
    });
  }

  const money = findResourceEntry(player, "resource.money");
  if (money === null || money[1].value < fine) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Not enough money to pay the audit fine",
      details: { fine, available: money?.[1].value ?? 0 },
    });
  }

  const collector = createEventCollector(state, command, context);
  const write = writeResource(player, money[0], money[1], money[1].value - fine);
  const released: PlayerState = { ...write.player, inAudit: false };
  pushResourceChanged(
    collector,
    player.id,
    write.resource,
    write.previousValue,
    write.newValue,
    "audit-fine",
  );
  pushMarker(state, collector, { kind: "audit.pay-fine", fine }, [player.id]);

  return commitEndingTurn(state, command, context, collector, released, {
    // The prompt that asked the question is answered by this command; leaving it
    // open would let the same confinement be paid off twice.
    closePromptKinds: ["audit-release"],
  });
}

/* ------------------------------------------------------------------ *
 * turn.activate-character
 * ------------------------------------------------------------------ */

/** The stable id of a character's one active ability. */
export function characterActiveAbilityId(characterId: string): AbilityId {
  return createStableId("AbilityId", `${characterId}:active`);
}

export type AbilityAvailability = {
  readonly abilityId: AbilityId;
  readonly ready: boolean;
  readonly cooldownLapsRemaining: number;
  readonly cooldownTurnsRemaining: number;
  readonly usesRemaining: number | null;
};

function abilityRecord(player: PlayerState, abilityId: AbilityId): AbilityState | null {
  return player.abilities.find((ability) => ability.id === abilityId) ?? null;
}

/**
 * Whether a character's active is off cooldown.
 *
 * Readiness is stored as the absolute lap/turn the ability becomes available
 * again, not as a counter something has to remember to decrement every turn.
 * That keeps the whole mechanic inside this file: there is no tick to wire into
 * the turn loop, nothing drifts if a turn is skipped, and the answer is a pure
 * function of state that a projection or a bot can ask for free.
 * `cooldownLapsRemaining` on the record is kept in step as a derived,
 * presentation-facing mirror of `data.readyAtLap`.
 */
export function abilityAvailability(
  state: GameState,
  player: PlayerState,
  abilityId: AbilityId,
): AbilityAvailability {
  const record = abilityRecord(player, abilityId);
  if (record === null) {
    return {
      abilityId,
      ready: true,
      cooldownLapsRemaining: 0,
      cooldownTurnsRemaining: 0,
      usesRemaining: null,
    };
  }

  const readyAtLap = readNumber(record.data, "readyAtLap") ?? 0;
  const readyAtTurn = readNumber(record.data, "readyAtTurn") ?? 0;
  const cooldownLapsRemaining = Math.max(0, readyAtLap - player.lapsCompleted);
  const cooldownTurnsRemaining = Math.max(0, readyAtTurn - state.turn.number);
  const usesExhausted = record.usesRemaining !== null && record.usesRemaining <= 0;

  return {
    abilityId,
    ready:
      !usesExhausted && cooldownLapsRemaining === 0 && cooldownTurnsRemaining === 0,
    cooldownLapsRemaining,
    cooldownTurnsRemaining,
    usesRemaining: record.usesRemaining,
  };
}

function markAbilityUsed(
  state: GameState,
  player: PlayerState,
  abilityId: AbilityId,
  cooldown: { readonly unit: "laps" | "turns"; readonly amount: number },
): PlayerState {
  const existing = abilityRecord(player, abilityId);
  const readyAtLap =
    cooldown.unit === "laps" ? player.lapsCompleted + Math.max(0, cooldown.amount) : 0;
  const readyAtTurn =
    cooldown.unit === "turns" ? state.turn.number + Math.max(0, cooldown.amount) : 0;
  const record: AbilityState = {
    id: abilityId,
    usesRemaining:
      existing?.usesRemaining === undefined || existing.usesRemaining === null
        ? null
        : Math.max(0, existing.usesRemaining - 1),
    cooldownLapsRemaining: cooldown.unit === "laps" ? Math.max(0, cooldown.amount) : 0,
    data: { readyAtLap, readyAtTurn, lastUsedAtTurn: state.turn.number },
  };

  return {
    ...player,
    abilities: [
      ...player.abilities.filter((ability) => ability.id !== abilityId),
      record,
    ],
  };
}

function readTileIndexChoice(choice: JsonValue, boardSize: number): number | null {
  const raw =
    typeof choice === "number"
      ? choice
      : choice !== null &&
          typeof choice === "object" &&
          !Array.isArray(choice) &&
          typeof (choice as JsonObject)["tileIndex"] === "number"
        ? ((choice as JsonObject)["tileIndex"] as number)
        : null;
  if (raw === null || !Number.isSafeInteger(raw)) return null;
  if (raw < 0 || raw >= boardSize) return null;

  return raw;
}

/**
 * The character ACTIVE abilities, which have never existed until now — the
 * targeted ones (`swapBoardPositions`, `stealResource`), `teleport`,
 * `payToRestoreEnergy`, `nextSalaryMultiplier` and `rerollDice`.
 *
 * Three rules bind all of them. They spend one of the turn's actions, so a
 * character's active competes with work/network/scheme/rest rather than being
 * free on top. Anything that reaches another player additionally requires
 * `rules.conflict.targetedAttacks` and raises the actor's heat, per spec §10.4.
 * And the cooldown authored on the character (`active.cooldown`) is enforced
 * from `AbilityState`, which the model has carried unused since the first
 * commit.
 */
export function activateCharacter(
  state: GameState,
  command: ActivateCharacterCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = requireTurnActor(state, command);
  if (!guard.ok) return guard.rejection;

  const player = guard.player;
  const budget = turnActionBudget(state, player);
  if (budget.perTurn <= 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode grants no turn actions, so no active can be used",
    });
  }
  if (budget.remaining <= 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "No turn actions remain this turn",
    });
  }

  const character = Object.values(context.content.characters).find(
    (candidate) => candidate.id === player.characterId,
  );
  if (character === undefined) {
    return rejectCommand(state, command, {
      code: "CONTENT_MISMATCH",
      message: "The actor's character is not in the content pack",
    });
  }

  const abilityId = characterActiveAbilityId(character.id);
  if (command.payload.abilityId !== abilityId) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "That ability does not belong to the actor's character",
    });
  }

  const availability = abilityAvailability(state, player, abilityId);
  if (!availability.ready) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "The character's active is still on cooldown",
      details: {
        cooldownLapsRemaining: availability.cooldownLapsRemaining,
        cooldownTurnsRemaining: availability.cooldownTurnsRemaining,
      },
    });
  }

  const effect = character.active.effect;
  const targeted =
    effect.type === "swapBoardPositions" || effect.type === "stealResource";

  let target: PlayerState | null = null;
  if (targeted) {
    if (!state.rules.conflict.targetedAttacks) {
      return rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "This mode does not allow targeting another player",
      });
    }
    const targetIds = command.payload.targetPlayerIds;
    if (targetIds.length !== 1) {
      return rejectCommand(state, command, {
        code: "INVALID_COMMAND",
        message: "This active needs exactly one target",
      });
    }
    const targetId = targetIds[0];
    if (targetId === command.actorId) {
      return rejectCommand(state, command, {
        code: "INVALID_COMMAND",
        message: "This active cannot target its own actor",
      });
    }
    const candidate = state.players[targetId];
    if (candidate === undefined || state.eliminatedPlayerIds.includes(targetId)) {
      return rejectCommand(state, command, {
        code: "INVALID_COMMAND",
        message: "Target is not a player in this game",
      });
    }
    target = candidate;
  }

  const collector = createEventCollector(state, command, context);
  let actor = player;
  const others: Record<string, PlayerState> = {};
  const affected: PlayerId[] = [player.id];
  if (target !== null) affected.push(target.id);

  switch (effect.type) {
    case "payToRestoreEnergy": {
      const money = findResourceEntry(actor, "resource.money");
      const energy = findResourceEntry(actor, "resource.energy");
      if (money === null || energy === null || energy[1].maximum === null) {
        return rejectCommand(state, command, {
          code: "INVARIANT_VIOLATION",
          message: "The actor lacks the resources this active operates on",
        });
      }
      if (money[1].value < effect.moneyCost) {
        return rejectCommand(state, command, {
          code: "INSUFFICIENT_RESOURCE",
          message: "Not enough money to buy back energy",
          details: { cost: effect.moneyCost, available: money[1].value },
        });
      }
      const paid = writeResource(actor, money[0], money[1], money[1].value - effect.moneyCost);
      actor = paid.player;
      pushResourceChanged(
        collector,
        actor.id,
        paid.resource,
        paid.previousValue,
        paid.newValue,
        "character-active",
      );
      const restored = writeResource(actor, energy[0], energy[1], energy[1].maximum);
      actor = restored.player;
      pushResourceChanged(
        collector,
        actor.id,
        restored.resource,
        restored.previousValue,
        restored.newValue,
        "character-active",
      );
      break;
    }
    case "nextSalaryMultiplier": {
      actor = setStatus(actor, AGENCY_STATUS_IDS.nextSalaryMultiplier, {
        multiplier: effect.multiplier,
      });
      const applied: StatusAppliedEvent = {
        ...collector.metadata(),
        type: "StatusApplied",
        payload: {
          playerId: actor.id,
          statusId: createStableId("StatusId", AGENCY_STATUS_IDS.nextSalaryMultiplier),
          stacks: 1,
          data: { multiplier: effect.multiplier },
        },
      };
      collector.events.push(applied);
      break;
    }
    case "rerollDice": {
      actor = setStatus(actor, AGENCY_STATUS_IDS.rollReroll, { keep: "higher" });
      const applied: StatusAppliedEvent = {
        ...collector.metadata(),
        type: "StatusApplied",
        payload: {
          playerId: actor.id,
          statusId: createStableId("StatusId", AGENCY_STATUS_IDS.rollReroll),
          stacks: 1,
          data: { keep: "higher" },
        },
      };
      collector.events.push(applied);
      break;
    }
    case "teleport": {
      const destination = readTileIndexChoice(command.payload.choice, state.boardSize);
      if (destination === null) {
        return rejectCommand(state, command, {
          code: "INVALID_COMMAND",
          message: "Teleport needs a tileIndex inside the board",
        });
      }
      if (destination === actor.position) {
        return rejectCommand(state, command, {
          code: "ILLEGAL_ACTION",
          message: "Teleporting to the tile you already occupy does nothing",
        });
      }
      const from = actor.position;
      // `traversal: false` in content: the destination is reached without
      // crossing anything, so no lap completes and no receptionist salary is
      // paid. Landing effects are the roll transition's business and are not
      // re-run here.
      actor = { ...actor, position: destination };
      const moved: PlayerMovedEvent = {
        ...collector.metadata(),
        type: "PlayerMoved",
        payload: {
          playerId: actor.id,
          from,
          to: destination,
          distance: 0,
          direction: "teleport",
          lapsGained: 0,
        },
      };
      collector.events.push(moved);
      break;
    }
    case "swapBoardPositions": {
      if (target === null) {
        return rejectCommand(state, command, {
          code: "INVARIANT_VIOLATION",
          message: "A targeted active resolved without a target",
        });
      }
      const actorFrom = actor.position;
      const targetFrom = target.position;
      if (actorFrom === targetFrom) {
        return rejectCommand(state, command, {
          code: "ILLEGAL_ACTION",
          message: "Both players already occupy the same tile",
        });
      }
      actor = { ...actor, position: targetFrom };
      const movedTarget: PlayerState = { ...target, position: actorFrom };
      others[movedTarget.id] = movedTarget;
      for (const move of [
        { playerId: actor.id, from: actorFrom, to: targetFrom },
        { playerId: movedTarget.id, from: targetFrom, to: actorFrom },
      ]) {
        const moved: PlayerMovedEvent = {
          ...collector.metadata(),
          type: "PlayerMoved",
          payload: {
            playerId: move.playerId,
            from: move.from,
            to: move.to,
            distance: 0,
            direction: "teleport",
            lapsGained: 0,
          },
        };
        collector.events.push(moved);
      }
      break;
    }
    case "stealResource": {
      if (target === null) {
        return rejectCommand(state, command, {
          code: "INVARIANT_VIOLATION",
          message: "A targeted active resolved without a target",
        });
      }
      const victimEntry = findResourceEntry(target, "resource.reputation");
      const actorEntry = findResourceEntry(actor, "resource.reputation");
      if (victimEntry === null || actorEntry === null) {
        return rejectCommand(state, command, {
          code: "INVARIANT_VIOLATION",
          message: "Reputation is missing from canonical player state",
        });
      }
      // `insufficientFunds: "transfer-up-to-available"` in content: taking what
      // is there rather than refusing, so the active is never wasted outright.
      const amount = Math.max(0, Math.min(effect.amount, victimEntry[1].value));
      if (amount === 0) {
        return rejectCommand(state, command, {
          code: "ILLEGAL_ACTION",
          message: "The target has no reputation to take",
        });
      }
      const taken = writeResource(
        target,
        victimEntry[0],
        victimEntry[1],
        victimEntry[1].value - amount,
      );
      others[target.id] = taken.player;
      pushResourceChanged(
        collector,
        target.id,
        taken.resource,
        taken.previousValue,
        taken.newValue,
        "character-active-stolen",
      );
      const gained = writeResource(
        actor,
        actorEntry[0],
        actorEntry[1],
        actorEntry[1].value + amount,
      );
      actor = gained.player;
      pushResourceChanged(
        collector,
        actor.id,
        gained.resource,
        gained.previousValue,
        gained.newValue,
        "character-active",
      );
      break;
    }
    default:
      return rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "That character's active is a passive-only descriptor",
      });
  }

  if (targeted) {
    actor = raiseHeat(actor, state.rules, state.turn.round);
  }
  actor = markAbilityUsed(state, actor, abilityId, character.active.cooldown);
  actor = consumeTurnActions(state, actor, 1);

  pushMarker(
    state,
    collector,
    {
      kind: "turn.activate-character",
      abilityId,
      characterId: character.id,
      effect: effect.type,
    },
    affected,
  );

  return commit(state, command, collector, { ...others, [actor.id]: actor });
}

/* ------------------------------------------------------------------ *
 * management.shuffle-deck
 * ------------------------------------------------------------------ */

/**
 * A management player's standing power over the decks.
 *
 * Authorised on the *role*, not on a seat index: the actor must actually hold
 * `role.management`, and the whole power is off in a mode with
 * `hidden.rolesEnabled: false`, where Management does not exist as a real role
 * at all. It draws from the same per-turn action budget as everything else, so
 * it cannot be spammed to churn revisions.
 */
export function shuffleManagementDeck(
  state: GameState,
  command: ShuffleManagementDeckCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = requireTurnActor(state, command);
  if (!guard.ok) return guard.rejection;

  if (!state.rules.hidden.rolesEnabled) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode has no Management role",
    });
  }

  const player = guard.player;
  if (player.role.kind !== "role.management") {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Only a Management player can shuffle a deck",
    });
  }

  const budget = turnActionBudget(state, player);
  if (budget.perTurn <= 0 || budget.remaining <= 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "No turn actions remain this turn",
    });
  }

  const deck: DeckState | undefined = state.decks[command.payload.deckId];
  if (deck === undefined) {
    return rejectCommand(state, command, {
      code: "CARD_NOT_AVAILABLE",
      message: "No such deck in this game",
    });
  }
  if (!deck.managementShuffleEligible) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "That deck cannot be shuffled by Management",
    });
  }
  if (deck.drawPile.length < 2) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "That deck has nothing left to shuffle",
    });
  }

  const collector = createEventCollector(state, command, context);
  const random = agencyRandom(state, `shuffle-deck:${deck.id}`);
  const shuffledDeck: DeckState = {
    ...deck,
    drawPile: shuffled(deck.drawPile, random),
    shuffleCount: deck.shuffleCount + 1,
  };
  const updated = consumeTurnActions(state, player, 1);

  pushMarker(
    state,
    collector,
    {
      kind: "management.shuffle-deck",
      deckId: deck.id,
      cards: deck.drawPile.length,
      shuffleCount: shuffledDeck.shuffleCount,
    },
    [player.id],
  );

  return commit(
    state,
    command,
    collector,
    { [player.id]: updated },
    { decks: { ...state.decks, [deck.id]: shuffledDeck } },
  );
}

/* ------------------------------------------------------------------ *
 * Commit helpers
 * ------------------------------------------------------------------ */

/**
 * Fold a transition's work into a next state, leaving the turn exactly where it
 * was.
 *
 * Every command in this wave happens *during* a turn and none of them ends it —
 * that is the whole point of giving a turn decisions instead of one verb — so
 * the turn block is copied through untouched and only `revision`,
 * `eventSequence` and `lastCommandId` move.
 */
export function commit(
  state: GameState,
  command: GameCommand,
  collector: EventCollector,
  players: Readonly<Record<string, PlayerState>>,
  patch: Partial<GameState> = {},
): TransitionResult {
  const lastEvent = collector.events[collector.events.length - 1];
  if (lastEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The command produced no event",
    });
  }

  return {
    ok: true,
    value: {
      state: {
        ...state,
        ...patch,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        players: { ...state.players, ...players },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: collector.events,
    },
  };
}

export type EndTurnOptions = {
  /** Prompt kinds addressed to the actor that this command has just answered. */
  readonly closePromptKinds?: readonly string[];
};

/**
 * Fold in a transition that *does* end the actor's turn.
 *
 * Shares the turn hand-off with the roll and prompt transitions rather than
 * re-deriving it: `resolveNextTurn` owns skipped turns and the start-of-turn
 * burnout refill, and it is handed the actor's record as this command leaves it
 * because the walk can reach the actor themselves.
 */
export function commitEndingTurn(
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
  collector: EventCollector,
  actorState: PlayerState,
  options: EndTurnOptions = {},
): TransitionResult {
  const currentOrderIndex = state.playerOrder.indexOf(command.actorId);
  if (currentOrderIndex < 0) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The actor is not in canonical turn order",
    });
  }

  const nextTurn = resolveNextTurn(
    state,
    currentOrderIndex,
    false,
    command.actorId,
    actorState,
  );
  const actorAfterHandoff = nextTurn.players[command.actorId] ?? actorState;

  for (const recovery of nextTurn.burnoutRecoveries) {
    const refilled: ResourceChangedEvent = {
      ...collector.metadata(),
      type: "ResourceChanged",
      payload: {
        playerId: recovery.playerId,
        resourceId: recovery.resourceId,
        previousValue: recovery.previousValue,
        newValue: recovery.newValue,
        reason: "burnout-recovery",
      },
    };
    collector.events.push(refilled);
  }

  const turnStarted: TurnStartedEvent = {
    ...collector.metadata(),
    type: "TurnStarted",
    payload: {
      playerId: nextTurn.nextPlayerId,
      turnNumber: nextTurn.turnNumber,
      round: nextTurn.round,
      phase: "pre-roll",
      deadlineAt: null,
    },
  };
  collector.events.push(turnStarted);

  const lastEvent = collector.events[collector.events.length - 1];
  if (lastEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The command produced no event",
    });
  }

  const closeKinds = options.closePromptKinds ?? [];
  const prompts =
    closeKinds.length === 0
      ? state.prompts
      : state.prompts.filter(
          (prompt) =>
            !(
              closeKinds.includes(prompt.kind) &&
              prompt.audience.includes(command.actorId)
            ),
        );

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        players: withBurnoutRecoveries(
          { ...nextTurn.players, [command.actorId]: actorAfterHandoff },
          nextTurn.burnoutRecoveries,
        ),
        prompts,
        turn: {
          number: nextTurn.turnNumber,
          round: nextTurn.round,
          activePlayerId: nextTurn.nextPlayerId,
          phase: "pre-roll",
          startedAt: context.logicalTimestamp,
          deadlineAt: null,
        },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: collector.events,
    },
  };
}
