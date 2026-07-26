import type { GameCommand, TargetAttackCommand } from "../commands";
import type {
  EffectPreventedEvent,
  EffectProposedEvent,
  GameEvent,
  PromptOpenedEvent,
  ReactionWindowOpenedEvent,
  ResourceChangedEvent,
} from "../events";
import {
  createStableId,
  type CardState,
  type DecisionPointId,
  type GameState,
  type PendingEffectState,
  type PlayerId,
  type PlayerState,
  type ReactionWindowState,
  type TurnPhase,
} from "../model";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import {
  ATTACK_IMMUNITY_STATUS_ID,
  applyLeaderProtection,
  buildInvestigationPrompt,
  raiseHeat,
} from "./heat";
import { consumeStatus, findActiveStatus } from "./player-status";
import type { ResourceKey } from "./resolve-tile-effects";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * `attack.target` — the first command whose effect lands on somebody who is not
 * the actor, and therefore the first place where authorisation is a real
 * question rather than a formality.
 *
 * Three rules hold everything here together, all from spec §5.4 and §6.3:
 *
 * 1. **Every attack raises the actor's heat**, through the one `raiseHeat`
 *    primitive in heat.ts. Including attacks that hit immunity, and including
 *    attacks a defender goes on to counter — the aggression is the *targeting*,
 *    not the landing, and a free retry would be free aggression.
 * 2. **Entitlement is checked before anything mutates.** The actor must be the
 *    active player, must not be eliminated, must own any card they name, and must
 *    be able to pay the vector's cost. A rejected command leaves `state` byte-identical.
 * 3. **Every gate is `rules.conflict`.** `targetedAttacks` switches the verb off,
 *    `heatEnabled` switches the cost off, `defenceEnabled` routes through a
 *    reaction window, `leaderProtection` prices or forbids hitting whoever is
 *    ahead. No `modeId` is ever compared and no magnitude is invented.
 *
 * Pure: no clock, no randomness (an attack is a deliberate act with a known
 * outcome, so it draws nothing), no iteration over object keys.
 */

export type AttackVectorEffect =
  /** The target loses the resource; nobody gains it. */
  | { readonly kind: "drain"; readonly resource: ResourceKey; readonly amount: number }
  /** The steal primitive: the target loses it and the actor gains exactly that much. */
  | { readonly kind: "steal"; readonly resource: ResourceKey; readonly amount: number };

export type AttackVectorDescriptor = {
  readonly id: string;
  /** Charged to the actor up front, whatever the attack goes on to do. */
  readonly cost: { readonly resource: ResourceKey; readonly amount: number };
  readonly effect: AttackVectorEffect;
};

/**
 * The attack vectors, as a built-in table.
 *
 * **This is a stand-in for authored content**, in the same spirit (and with the
 * same caveat) as `DECK_FLAVOR_EFFECTS` in resolve-tile-effects.ts: spec §10
 * grows the content vocabulary with `transferResource` and `modifyHeat` precisely
 * so vectors can be authored in `packages/content`, and when they are, this table
 * should be replaced by a lookup into the pack rather than extended here.
 *
 * What is *not* provisional is the shape: an energy cost to the actor plus one
 * resource effect on the target. Energy is what keeps attacking self-limiting
 * inside a single turn — the turn's free-action budget
 * (`rules.agency.freeActionsPerTurn`) is not modelled in canonical state yet, so
 * the cost is currently the only thing bounding how many attacks fit in a turn.
 */
export const ATTACK_VECTORS: Readonly<Record<string, AttackVectorDescriptor>> = {
  "attack.undermine": {
    id: "attack.undermine",
    cost: { resource: "energy", amount: 1 },
    effect: { kind: "drain", resource: "reputation", amount: 1 },
  },
  "attack.poach-credit": {
    id: "attack.poach-credit",
    cost: { resource: "energy", amount: 2 },
    effect: { kind: "steal", resource: "money", amount: 200 },
  },
  "attack.overload": {
    id: "attack.overload",
    cost: { resource: "energy", amount: 1 },
    effect: { kind: "drain", resource: "energy", amount: 2 },
  },
};

export function findAttackVector(vector: string): AttackVectorDescriptor | null {
  return Object.prototype.hasOwnProperty.call(ATTACK_VECTORS, vector)
    ? (ATTACK_VECTORS[vector] ?? null)
    : null;
}

/** The `PendingEffectState.effect` discriminator an attack awaiting defence carries. */
export const PENDING_ATTACK_EFFECT_TYPE = "attack.target";

export type PendingAttack = {
  readonly attackerId: PlayerId;
  readonly targetPlayerId: PlayerId;
  readonly vector: AttackVectorDescriptor;
};

/**
 * Reads a pending effect back as an attack, or `null` if it is some other kind of
 * pending effect. The reactions agent uses this to tell "this window is holding an
 * attack I know how to resolve" from "this window belongs to somebody else".
 */
export function readPendingAttack(
  pendingEffect: PendingEffectState,
): PendingAttack | null {
  const effect = pendingEffect.effect;
  if (effect["type"] !== PENDING_ATTACK_EFFECT_TYPE) return null;

  const attackerId = effect["attackerId"];
  const targetPlayerId = effect["targetPlayerId"];
  const vectorId = effect["vector"];
  if (
    typeof attackerId !== "string" ||
    typeof targetPlayerId !== "string" ||
    typeof vectorId !== "string"
  ) {
    return null;
  }
  const vector = findAttackVector(vectorId);
  if (vector === null) return null;

  return {
    attackerId: attackerId as PlayerId,
    targetPlayerId: targetPlayerId as PlayerId,
    vector,
  };
}

export type AttackWindow = {
  readonly window: ReactionWindowState;
  readonly pendingEffect: PendingEffectState;
  readonly attack: PendingAttack;
};

/**
 * Finds the open defence window for `decisionPointId`, when it is holding an
 * attack. Returns `null` for an unknown id, a window with no pending effect, or a
 * pending effect that is not an attack — which is what makes
 * {@link resolveAttackWindow} safely routable and, in particular, **idempotent**:
 * a second `window.expire` for an already-resolved window finds nothing and the
 * caller can return the state untouched.
 */
export function findAttackWindow(
  state: GameState,
  decisionPointId: DecisionPointId,
): AttackWindow | null {
  const window = state.reactionWindows.find(
    (candidate) => candidate.id === decisionPointId,
  );
  if (window === undefined || window.pendingEffectId === null) return null;

  const pendingEffect = state.pendingEffects.find(
    (candidate) => candidate.id === window.pendingEffectId,
  );
  if (pendingEffect === undefined) return null;

  const attack = readPendingAttack(pendingEffect);
  if (attack === null) return null;

  return { window, pendingEffect, attack };
}

type ResourceMove = {
  readonly playerId: PlayerId;
  readonly resource: ResourceKey;
  readonly previousValue: number;
  readonly newValue: number;
  readonly reason: string;
};

type Damage = {
  readonly attacker: PlayerState;
  readonly target: PlayerState;
  readonly moves: readonly ResourceMove[];
};

function floorOf(minimum: number | null): number {
  return minimum ?? 0;
}

function setResource(
  player: PlayerState,
  key: ResourceKey,
  value: number,
): PlayerState {
  const resource = player.resources[key];
  if (resource === undefined) return player;

  return {
    ...player,
    resources: { ...player.resources, [key]: { ...resource, value } },
  };
}

/**
 * Applies one vector to one target.
 *
 * A steal moves exactly what the target actually has — never more, so an attack
 * can neither mint money nor push a target below its own floor — and respects the
 * actor's ceiling on the way in, so the pair stays conservative.
 */
function applyVector(
  attacker: PlayerState,
  target: PlayerState,
  vector: AttackVectorDescriptor,
): Damage {
  const resourceKey = vector.effect.resource;
  const targetResource = target.resources[resourceKey];
  if (targetResource === undefined) {
    return { attacker, target, moves: [] };
  }

  const available = targetResource.value - floorOf(targetResource.minimum);
  const taken = Math.max(0, Math.min(vector.effect.amount, available));
  if (taken === 0) {
    return { attacker, target, moves: [] };
  }

  const targetValue = targetResource.value - taken;
  const damagedTarget = setResource(target, resourceKey, targetValue);
  const moves: ResourceMove[] = [
    {
      playerId: target.id,
      resource: resourceKey,
      previousValue: targetResource.value,
      newValue: targetValue,
      reason: "attack",
    },
  ];

  if (vector.effect.kind === "drain") {
    return { attacker, target: damagedTarget, moves };
  }

  const attackerResource = attacker.resources[resourceKey];
  if (attackerResource === undefined) {
    return { attacker, target: damagedTarget, moves };
  }
  const ceiling = attackerResource.maximum;
  const gainedValue =
    ceiling === null
      ? attackerResource.value + taken
      : Math.min(ceiling, attackerResource.value + taken);
  if (gainedValue !== attackerResource.value) {
    moves.push({
      playerId: attacker.id,
      resource: resourceKey,
      previousValue: attackerResource.value,
      newValue: gainedValue,
      reason: "attack-gain",
    });
  }

  return {
    attacker: setResource(attacker, resourceKey, gainedValue),
    target: damagedTarget,
    moves,
  };
}

/** Moves a played attack card out of the actor's hand and onto its deck's discard pile. */
function discardCard(
  state: GameState,
  actor: PlayerState,
  card: CardState,
): {
  readonly actor: PlayerState;
  readonly cards: GameState["cards"];
  readonly decks: GameState["decks"];
} {
  const discarded: CardState = {
    ...card,
    zone: "discard-pile",
    ownerId: null,
    faceUp: true,
  };
  const deck = state.decks[card.deckId];

  return {
    actor: { ...actor, hand: actor.hand.filter((held) => held !== card.id) },
    cards: { ...state.cards, [card.id]: discarded },
    decks:
      deck === undefined
        ? state.decks
        : {
            ...state.decks,
            [card.deckId]: {
              ...deck,
              discardPile: [...deck.discardPile, card.id],
            },
          },
  };
}

type Emitter = {
  readonly push: (event: (sequence: number) => GameEvent) => void;
  readonly nextSequence: () => number;
  readonly events: readonly GameEvent[];
};

function createEmitter(state: GameState): Emitter {
  const events: GameEvent[] = [];

  return {
    push: (event) => {
      events.push(event(state.eventSequence + events.length + 1));
    },
    nextSequence: () => state.eventSequence + events.length + 1,
    events,
  };
}

function metadata(
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
  sequence: number,
): Omit<GameEvent, "type" | "payload"> {
  return createEventMetadata(state, command, context.logicalTimestamp, sequence);
}

function pushResourceMoves(
  emitter: Emitter,
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
  moves: readonly ResourceMove[],
  players: Readonly<Record<string, PlayerState>>,
): void {
  for (const move of moves) {
    const resource = players[move.playerId]?.resources[move.resource];
    if (resource === undefined) continue;
    emitter.push((sequence): ResourceChangedEvent => ({
      ...metadata(state, command, context, sequence),
      type: "ResourceChanged",
      payload: {
        playerId: move.playerId,
        resourceId: resource.id,
        previousValue: move.previousValue,
        newValue: move.newValue,
        reason: move.reason,
      },
    }));
  }
}

/**
 * `attack.target`.
 *
 * Does **not** end the turn. An attack is an in-turn verb taken before the roll,
 * so the actor keeps their turn and can still roll — which is what makes it a
 * decision (spend energy on aggression, or keep it) rather than a substitute for
 * one. The only exception is a defence window: while one is open the phase moves
 * to `reaction` so nothing else can proceed until it resolves.
 */
export function targetAttack(
  state: GameState,
  command: TargetAttackCommand,
  context: TransitionContext,
): TransitionResult {
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Attacks can only be made in an active game",
    });
  }
  if (!state.rules.conflict.targetedAttacks) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Targeted attacks are disabled by this mode's ruleset",
    });
  }
  if (state.turn.phase !== "pre-roll") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "Attacks can only be made before rolling",
    });
  }

  const actor = state.players[command.actorId];
  if (actor === undefined) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_FOUND",
      message: "Command actor is not a player in this game",
    });
  }
  // Entitlement, before anything is read for mutation: an attack lands on
  // somebody else's resources, so "is this actor allowed to act at all" is the
  // first question, not a later one.
  if (state.turn.activePlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can attack",
    });
  }
  if (state.eliminatedPlayerIds.includes(command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "An eliminated player cannot attack",
    });
  }

  const targetPlayerId = command.payload.targetPlayerId;
  const target = state.players[targetPlayerId];
  if (target === undefined) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Attack target is not a player in this game",
    });
  }
  if (targetPlayerId === command.actorId) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "A player cannot attack themselves",
    });
  }
  if (state.eliminatedPlayerIds.includes(targetPlayerId)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An eliminated player cannot be attacked",
    });
  }

  const vector = findAttackVector(command.payload.vector);
  if (vector === null) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Unknown attack vector",
    });
  }

  const cardId = command.payload.cardId;
  let card: CardState | null = null;
  if (cardId !== null) {
    if (!state.rules.agency.handEnabled) {
      return rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "Hands are disabled by this mode's ruleset",
      });
    }
    const candidate = state.cards[cardId];
    // Ownership, not just existence: naming another player's card is the
    // cheapest possible cross-player exploit.
    if (
      candidate === undefined ||
      candidate.zone !== "hand" ||
      candidate.ownerId !== command.actorId ||
      !actor.hand.includes(cardId)
    ) {
      return rejectCommand(state, command, {
        code: "CARD_NOT_AVAILABLE",
        message: "Card is not in the actor's hand",
      });
    }
    card = candidate;
  }

  const ruling = applyLeaderProtection(state, targetPlayerId);
  if (ruling.kind === "forbidden") {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode's leader protection forbids attacking the leader",
    });
  }

  const costResource = actor.resources[vector.cost.resource];
  if (costResource === undefined || costResource.value < vector.cost.amount) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Actor cannot pay this attack vector's cost",
    });
  }

  // ---- Past here nothing can reject: every mutation below is unconditional. ----

  const emitter = createEmitter(state);
  const costValue = costResource.value - vector.cost.amount;
  let attacker = setResource(actor, vector.cost.resource, costValue);
  let cards = state.cards;
  let decks = state.decks;

  emitter.push((sequence): ResourceChangedEvent => ({
    ...metadata(state, command, context, sequence),
    type: "ResourceChanged",
    payload: {
      playerId: actor.id,
      resourceId: costResource.id,
      previousValue: costResource.value,
      newValue: costValue,
      reason: "attack-cost",
    },
  }));

  if (card !== null) {
    const discarded = discardCard(state, attacker, card);
    attacker = discarded.actor;
    cards = discarded.cards;
    decks = discarded.decks;
  }

  // Heat first, and unconditionally: the aggression is the targeting. An attack
  // that immunity absorbs or a defender counters still cost the table something,
  // and charging only successful attacks would make retrying free.
  const heated = raiseHeat({
    rules: state.rules,
    player: attacker,
    round: state.turn.round,
    source: "attack",
    charges: ruling.heatCharges,
  });
  attacker = heated.player;

  if (heated.amount > 0) {
    emitter.push((sequence): EffectProposedEvent => ({
      ...metadata(state, command, context, sequence),
      type: "EffectProposed",
      payload: {
        effectId: createStableId("EffectId", `${state.gameId}:effect:${sequence}`),
        affectedPlayerIds: [attacker.id],
        effect: {
          type: "modifyHeat",
          source: heated.source,
          amount: heated.amount,
          previousValue: heated.previousValue,
          newValue: heated.newValue,
          threshold: heated.threshold,
          targetIsLeader: ruling.targetIsLeader,
        },
      },
    }));
  }

  const investigation = heated.investigationOpened
    ? buildInvestigationPrompt(state, emitter.nextSequence(), attacker.id)
    : null;
  if (investigation !== null) {
    emitter.push((sequence): PromptOpenedEvent => ({
      ...metadata(state, command, context, sequence),
      type: "PromptOpened",
      payload: { prompt: investigation },
    }));
  }

  // One id for the attack itself, proposed before it is resolved, so whichever
  // branch runs next can refer back to the same effect: immunity prevents *this*
  // effect, a defence window holds *this* effect, and an immediate resolution is
  // the same effect landing at once.
  const proposalSequence = emitter.nextSequence();
  const effectId = createStableId(
    "EffectId",
    `${state.gameId}:effect:${proposalSequence}`,
  );
  const frameId = createStableId("FrameId", `${state.gameId}:frame:${proposalSequence}`);
  const attackEffect = {
    type: PENDING_ATTACK_EFFECT_TYPE,
    vector: vector.id,
    attackerId: attacker.id,
    targetPlayerId: target.id,
  };
  emitter.push((sequence): EffectProposedEvent => ({
    ...metadata(state, command, context, sequence),
    type: "EffectProposed",
    payload: {
      effectId,
      affectedPlayerIds: [target.id],
      effect: attackEffect,
    },
  }));

  const immunity = findActiveStatus(target, ATTACK_IMMUNITY_STATUS_ID);
  let defended = target;
  let pendingEffects = state.pendingEffects;
  let reactionWindows = state.reactionWindows;
  let phase: TurnPhase = state.turn.phase;

  if (immunity !== null) {
    // Immunity absorbs the attack outright — no damage, no window, one charge
    // spent. The actor still paid the cost and the heat.
    defended = consumeStatus(target, ATTACK_IMMUNITY_STATUS_ID);
    emitter.push((sequence): EffectPreventedEvent => ({
      ...metadata(state, command, context, sequence),
      type: "EffectPrevented",
      payload: {
        effectId,
        preventedByPlayerId: target.id,
        sourceId: vector.id,
      },
    }));
  } else if (state.rules.conflict.defenceEnabled) {
    const pendingEffect: PendingEffectState = {
      id: effectId,
      frameId,
      sourceId: vector.id,
      affectedPlayerIds: [target.id],
      effect: attackEffect,
      preventionEligible: true,
      // The target has to be able to see what they are countering.
      visibility: "public",
    };
    const window: ReactionWindowState = {
      id: createStableId(
        "DecisionPointId",
        `${state.gameId}:reaction:${proposalSequence}:attack`,
      ),
      frameId,
      kind: "prevention",
      eligiblePlayerIds: [target.id],
      priorityPlayerId: target.id,
      passedPlayerIds: [],
      playedByPlayerIds: [],
      // Engine writes no wall clock (spec §7.1). The server's scheduler fills
      // the deadline and injects `window.expire`.
      deadlineAt: null,
      pendingEffectId: effectId,
    };
    pendingEffects = [...state.pendingEffects, pendingEffect];
    reactionWindows = [...state.reactionWindows, window];
    phase = "reaction";

    emitter.push((sequence): ReactionWindowOpenedEvent => ({
      ...metadata(state, command, context, sequence),
      type: "ReactionWindowOpened",
      payload: { reactionWindow: window },
    }));
  } else {
    const damage = applyVector(attacker, target, vector);
    attacker = damage.attacker;
    defended = damage.target;
    pushResourceMoves(emitter, state, command, context, damage.moves, {
      [damage.attacker.id]: damage.attacker,
      [damage.target.id]: damage.target,
    });
  }

  const events = emitter.events;
  const lastEvent = events[events.length - 1];
  if (lastEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "An attack did not emit an event",
    });
  }

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        players: {
          ...state.players,
          [attacker.id]: attacker,
          [defended.id]: defended,
        },
        cards,
        decks,
        prompts:
          investigation === null ? state.prompts : [...state.prompts, investigation],
        pendingEffects,
        reactionWindows,
        turn: { ...state.turn, phase },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}

export type AttackWindowOutcome = {
  readonly decisionPointId: DecisionPointId;
  /** True when a defender countered it; false when they passed or it expired. */
  readonly prevented: boolean;
  /** Who countered. Ignored when `prevented` is false. */
  readonly preventedByPlayerId: PlayerId | null;
};

/**
 * Closes a defence window opened by {@link targetAttack} and lands (or drops) the
 * attack it was holding.
 *
 * Meant to be **returned directly** from whichever reaction transition closes the
 * window — `reaction.play`, `reaction.pass`, or the server-injected
 * `window.expire` — because it does the whole job: it removes the window and its
 * pending effect, restores the phase the attack interrupted, applies the damage
 * when nobody countered, and bumps `revision`. Composing it with another
 * revision bump would double-count.
 *
 * Rejects an unknown or non-attack window rather than guessing. Callers that need
 * `window.expire`'s idempotency should ask {@link findAttackWindow} first: a
 * second expiry for the same window finds nothing, which is the signal to return
 * the state untouched instead of resolving twice.
 */
export function resolveAttackWindow(
  state: GameState,
  command: GameCommand,
  outcome: AttackWindowOutcome,
  context: TransitionContext,
): TransitionResult {
  const found = findAttackWindow(state, outcome.decisionPointId);
  if (found === null) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_NOT_FOUND",
      message: "No open attack defence window for this decisionPointId",
    });
  }

  const attacker = state.players[found.attack.attackerId];
  const target = state.players[found.attack.targetPlayerId];
  if (attacker === undefined || target === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "A pending attack references a player who is no longer in the game",
    });
  }
  if (
    outcome.prevented &&
    outcome.preventedByPlayerId !== null &&
    !found.window.eligiblePlayerIds.includes(outcome.preventedByPlayerId)
  ) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Only an eligible defender can counter this attack",
    });
  }

  const emitter = createEmitter(state);
  let players = state.players;

  if (outcome.prevented) {
    emitter.push((sequence): EffectPreventedEvent => ({
      ...metadata(state, command, context, sequence),
      type: "EffectPrevented",
      payload: {
        effectId: found.pendingEffect.id,
        preventedByPlayerId: outcome.preventedByPlayerId ?? target.id,
        sourceId: found.attack.vector.id,
      },
    }));
  } else {
    // Re-proposed as it lands, so the window always closes with an event even
    // when the target had nothing left to lose.
    emitter.push((sequence): EffectProposedEvent => ({
      ...metadata(state, command, context, sequence),
      type: "EffectProposed",
      payload: {
        effectId: found.pendingEffect.id,
        affectedPlayerIds: [target.id],
        effect: found.pendingEffect.effect,
      },
    }));
    const damage = applyVector(attacker, target, found.attack.vector);
    players = {
      ...players,
      [damage.attacker.id]: damage.attacker,
      [damage.target.id]: damage.target,
    };
    pushResourceMoves(emitter, state, command, context, damage.moves, players);
  }

  const events = emitter.events;
  const lastEvent = events[events.length - 1];

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent?.sequence ?? state.eventSequence,
        players,
        pendingEffects: state.pendingEffects.filter(
          (candidate) => candidate.id !== found.pendingEffect.id,
        ),
        reactionWindows: state.reactionWindows.filter(
          (candidate) => candidate.id !== found.window.id,
        ),
        // The attack interrupted a pre-roll turn; hand it back.
        turn: {
          ...state.turn,
          phase: state.turn.phase === "reaction" ? "pre-roll" : state.turn.phase,
        },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}
