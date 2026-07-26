import type { ModeRules } from "@office-ladder/content";

import type { PlacePlacementCommand } from "../commands";
import type { GameEvent, ResourceChangedEvent } from "../events";
import type {
  CardState,
  GameState,
  PlacementId,
  PlacementKind,
  PlacementState,
  PlayerId,
  PlayerState,
  PlayerStatusState,
  TileId,
} from "../model";
import { createStableId } from "../model";
import { createEventMetadata } from "./events";
import { rejectCommand } from "./errors";
import {
  findResourceOfKind,
  resolveTileToll,
  resourceChangeFor,
  spendableAmount,
  withResourceValue,
  type LandingResourceChange,
  type ResourceHandle,
} from "./tile-ownership";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Placements — objects a player leaves on a tile for whoever lands there next.
 *
 * The other half of "the board is shared space now": ownership makes a tile
 * expensive to visit, placements make a *specific* tile dangerous, and unlike
 * ownership a placement is aimed. Everything is gated on
 * `state.rules.board.placementsEnabled` and capped by
 * `rules.board.maxPlacementsPerPlayer`; magnitudes scale off the same two board
 * multipliers ownership uses (`claimCostMultiplier` for what you pay,
 * `tollMultiplier` for what moves when it fires), so one mode dial moves the
 * whole board economy together. No `modeId` comparison appears in this file.
 *
 * **Hidden by construction, not by filtering.** An `owner-only` placement is a
 * single `PlacementState` row and *nothing else*: no mirror on
 * `TileOwnershipState`, no marker on the tile, no entry in a public collection,
 * no event emitted from here that names it. That is deliberate — the projection
 * layer drops the whole row (`projections/public.ts` omits, never blanks), so a
 * leak would have to come from a second copy somewhere, and there is no second
 * copy to leak. The surveillance report is held the same way: as a `private`
 * status on the watcher, which per-viewer projection already restricts to self.
 */

/** What a placement kind costs, does, and who can see it. */
export type PlacementSpec = {
  readonly kind: PlacementKind;
  /** Money to place, before `board.claimCostMultiplier`. */
  readonly baseCost: number;
  /** How many landings it survives. One for every kind today. */
  readonly charges: number;
  readonly visibility: "public" | "owner-only";
  /**
   * Whether placing this counts as aggression and raises the actor's heat.
   * Spec §10.4: free aggression collapses the game into alpha-striking the
   * leader, so everything that lands on someone else carries a cost back.
   */
  readonly hostile: boolean;
  /** Money that moves when it fires, before `board.tollMultiplier`. */
  readonly baseMoney: number;
  readonly moneyFlow: "none" | "lander-to-owner" | "bank-to-lander";
  /**
   * Reputation the lander loses. Deliberately *not* scaled by a multiplier:
   * reputation is a 0–10ish integer ladder (a promotion needs 3–5), so any
   * multiplier either rounds to nothing or doubles the effect.
   */
  readonly reputationPenalty: number;
  /** Turns the lander loses. */
  readonly skipTurns: number;
  /** Whether firing this writes a surveillance report to its owner. */
  readonly surveils: boolean;
};

/**
 * The five kinds from the spec's §5.1, in a fixed order.
 *
 * Ordered because iteration order over this table must not depend on object key
 * order — the state it produces round-trips through JSON, and key order is not
 * a stable contract across that boundary.
 */
export const PLACEMENT_KINDS: readonly PlacementKind[] = [
  "placement.meeting-invite",
  "placement.sabotage",
  "placement.surveillance",
  "placement.rumour",
  "placement.favour",
];

export const PLACEMENT_SPECS: Readonly<Record<PlacementKind, PlacementSpec>> = {
  "placement.meeting-invite": {
    kind: "placement.meeting-invite",
    baseCost: 200,
    charges: 1,
    // A meeting in the calendar is visible; the trap is that it is on the tile
    // you were going to land on anyway.
    visibility: "public",
    hostile: true,
    baseMoney: 0,
    moneyFlow: "none",
    reputationPenalty: 0,
    skipTurns: 1,
    surveils: false,
  },
  "placement.sabotage": {
    kind: "placement.sabotage",
    baseCost: 150,
    charges: 1,
    visibility: "owner-only",
    hostile: true,
    baseMoney: 200,
    moneyFlow: "lander-to-owner",
    reputationPenalty: 0,
    skipTurns: 0,
    surveils: false,
  },
  "placement.surveillance": {
    kind: "placement.surveillance",
    baseCost: 100,
    charges: 1,
    visibility: "owner-only",
    hostile: true,
    baseMoney: 0,
    moneyFlow: "none",
    reputationPenalty: 0,
    skipTurns: 0,
    surveils: true,
  },
  "placement.rumour": {
    kind: "placement.rumour",
    baseCost: 150,
    charges: 1,
    visibility: "public",
    hostile: true,
    baseMoney: 0,
    moneyFlow: "none",
    reputationPenalty: 1,
    skipTurns: 0,
    surveils: false,
  },
  "placement.favour": {
    kind: "placement.favour",
    baseCost: 200,
    charges: 1,
    visibility: "public",
    // The one kind that helps whoever finds it, so it costs the owner heat
    // nothing. It is how an alliance is paid for without a trade.
    hostile: false,
    baseMoney: 150,
    moneyFlow: "bank-to-lander",
    reputationPenalty: 0,
    skipTurns: 0,
    surveils: false,
  },
};

/**
 * The status a `placement.surveillance` trigger writes on its owner.
 *
 * `private` visibility, so `projectPlayerView` hands it to the watcher and to
 * nobody else. Reports accumulate rather than replacing each other — each
 * carries the placement id it came from in `sourceId` — so a consumer reads
 * *every* status with this id, not just the first.
 */
export const SURVEILLANCE_REPORT_STATUS = "status.surveillance-report";

export function isPlacementKind(value: string): value is PlacementKind {
  return (PLACEMENT_KINDS as readonly string[]).includes(value);
}

/** Money placing `kind` costs under this ruleset. */
export function placementCost(rules: ModeRules, kind: PlacementKind): number {
  return Math.max(
    0,
    Math.round(PLACEMENT_SPECS[kind].baseCost * rules.board.claimCostMultiplier),
  );
}

/** Money `kind` moves when it fires under this ruleset. */
export function placementMoneyAmount(rules: ModeRules, kind: PlacementKind): number {
  return Math.max(
    0,
    Math.round(PLACEMENT_SPECS[kind].baseMoney * rules.board.tollMultiplier),
  );
}

/** How many placements a player currently has on the board. */
export function activePlacementCount(
  placements: readonly PlacementState[],
  ownerId: PlayerId,
): number {
  return placements.filter(
    (placement) => placement.ownerId === ownerId && placement.charges > 0,
  ).length;
}

/**
 * Aggression's price. No-ops when the mode has heat switched off, so a mode
 * without heat gets placements without a hidden penalty rather than a broken
 * one.
 */
function raiseHeat(player: PlayerState, rules: ModeRules, round: number): PlayerState {
  if (!rules.conflict.heatEnabled || rules.conflict.heatPerAttack <= 0) {
    return player;
  }

  return {
    ...player,
    heat: {
      ...player.heat,
      value: player.heat.value + rules.conflict.heatPerAttack,
      lastIncrementedAtRound: round,
    },
  };
}

/**
 * `placement.place` — leave an object on a tile.
 *
 * Authorisation (spec §6.3) is checked before anything is read for mutation:
 * the actor must be a seated player and it must be their turn. The payload's
 * `kind` and `tileId` are both client-supplied and both validated against the
 * engine's own vocabulary rather than trusted from the transport.
 *
 * Unlike `tile.claim` this does *not* require standing on the target tile —
 * placing a trap on the tile you are already on is nearly useless, since the
 * players who would trip it are behind you. The cap that keeps this from being
 * a free action is `rules.board.maxPlacementsPerPlayer` plus the money price;
 * one placement per player per tile stops a single player stacking a kill zone.
 */
export function placePlacement(
  state: GameState,
  command: PlacePlacementCommand,
  context: TransitionContext,
): TransitionResult {
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Placements can only be made in an active game",
    });
  }
  if (!state.rules.board.placementsEnabled) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Placements are disabled by this mode",
    });
  }

  const player = state.players[command.actorId];
  if (player === undefined) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_FOUND",
      message: "Command actor is not a player in this game",
    });
  }
  if (state.turn.activePlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can place on the board",
    });
  }
  if (!isPlacementKind(command.payload.kind)) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "kind is not a placement this game knows",
    });
  }
  if (!state.tileIds.includes(command.payload.tileId)) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "tileId is not a tile on this board",
    });
  }

  const { kind, tileId } = command.payload;
  const owned = activePlacementCount(state.placements, command.actorId);
  if (owned >= state.rules.board.maxPlacementsPerPlayer) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "The actor already has as many placements on the board as this mode allows",
      details: { placed: owned, maximum: state.rules.board.maxPlacementsPerPlayer },
    });
  }
  if (
    state.placements.some(
      (placement) =>
        placement.tileId === tileId &&
        placement.ownerId === command.actorId &&
        placement.charges > 0,
    )
  ) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "The actor already has a placement on this tile",
    });
  }

  const money = findResourceOfKind(player, "resource.money");
  if (money === null) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "The actor has no money resource to spend",
    });
  }

  const cost = placementCost(state.rules, kind);
  if (spendableAmount(money) < cost) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "This placement costs more money than the actor has",
      details: { required: cost, available: spendableAmount(money) },
    });
  }

  const spec = PLACEMENT_SPECS[kind];
  const nextValue = money.resource.value - cost;
  const placement: PlacementState = {
    // From server-owned canonical state only. `revision` advances exactly once
    // per accepted command, so this is unique within the game and re-derives
    // identically on replay — where building it from the client's command id
    // would let a client choose (or collide with) a placement id.
    id: createStableId("PlacementId", `${state.gameId}:placement:${state.revision + 1}`),
    kind,
    tileId,
    ownerId: command.actorId,
    charges: spec.charges,
    visibility: spec.visibility,
    placedAtRound: state.turn.round,
    // Nothing is stored here. Anything a placement could carry would be a second
    // copy of information the row itself already holds, and a second copy is
    // exactly how an `owner-only` placement would eventually leak.
    data: {},
  };

  const events: GameEvent[] = [];
  if (cost > 0) {
    const charged: ResourceChangedEvent = {
      ...createEventMetadata(state, command, context.logicalTimestamp, state.eventSequence + 1),
      type: "ResourceChanged",
      payload: {
        playerId: player.id,
        resourceId: money.resource.id,
        previousValue: money.resource.value,
        newValue: nextValue,
        // Neither the kind nor the tile: this event is public, and for an
        // `owner-only` placement either field would announce the trap.
        reason: "placement-cost",
      },
    };
    events.push(charged);
  }

  const lastEvent = events[events.length - 1];
  const paidPlayer = withResourceValue(player, money, nextValue);

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent?.sequence ?? state.eventSequence,
        players: {
          ...state.players,
          [player.id]: spec.hostile
            ? raiseHeat(paidPlayer, state.rules, state.turn.round)
            : paidPlayer,
        },
        placements: [...state.placements, placement],
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}

export type PlacementLanding = {
  readonly state: GameState;
  /**
   * The landing player as movement (and any earlier landing trigger) left them,
   * which is not `state.players[landerId]` mid-turn.
   */
  readonly lander: PlayerState;
  readonly tileId: TileId;
  /**
   * Player records that earlier work in this same turn has already changed —
   * the toll's owner, typically. Falls back to `state.players`.
   */
  readonly players?: Readonly<Record<string, PlayerState>>;
};

/**
 * One placement that fired.
 *
 * `ownerId` is the hidden half for an `owner-only` placement: a caller turning
 * these into feed entries must publish an entry naming the owner **only** when
 * `visibility` is `"public"`. A `placement.surveillance` trigger moves no
 * resource and skips no turn at all, so for it there is nothing public to say.
 */
export type PlacementTrigger = {
  readonly placementId: PlacementId;
  readonly kind: PlacementKind;
  readonly ownerId: PlayerId;
  readonly tileId: TileId;
  readonly visibility: "public" | "owner-only";
  /** Money moved, reputation lost or turns skipped — whichever this kind does. */
  readonly amount: number;
  readonly chargesRemaining: number;
};

export type PlacementLandingOutcome = {
  readonly lander: PlayerState;
  /**
   * Owner records this landing changed, keyed by `PlayerId`. Never contains the
   * lander — a placement never fires for its own owner.
   */
  readonly owners: Readonly<Record<string, PlayerState>>;
  /** `state.placements` with spent charges decremented and empty rows dropped. */
  readonly placements: readonly PlacementState[];
  readonly triggers: readonly PlacementTrigger[];
  readonly changes: readonly LandingResourceChange[];
};

function inertPlacements(landing: PlacementLanding): PlacementLandingOutcome {
  return {
    lander: landing.lander,
    owners: {},
    placements: landing.state.placements,
    triggers: [],
    changes: [],
  };
}

type AppliedPlacement = {
  readonly lander: PlayerState;
  readonly owner: PlayerState;
  readonly amount: number;
  readonly changes: readonly LandingResourceChange[];
};

/**
 * What one placement does to the two players involved.
 *
 * Reads the spec dimension by dimension rather than branching on the kind, so a
 * sixth kind is a row in `PLACEMENT_SPECS` and not a new branch here. Every kind
 * today moves exactly one dimension, which is why `amount` — the sum of what
 * moved — reads as "the number this placement is about".
 *
 * Returns the two player records and the movements. Never touches `GameState`
 * and never emits an event: an `owner-only` placement's whole value is that
 * nothing announces it, and the safest way to guarantee that is for this layer
 * to have no way to announce anything.
 */
function applyPlacement(
  state: GameState,
  placement: PlacementState,
  landedBy: PlayerState,
  placedBy: PlayerState,
): AppliedPlacement {
  const spec = PLACEMENT_SPECS[placement.kind];
  let lander = landedBy;
  let owner = placedBy;
  let amount = 0;
  const changes: LandingResourceChange[] = [];

  if (spec.skipTurns > 0) {
    lander = { ...lander, skipTurns: lander.skipTurns + spec.skipTurns };
    amount += spec.skipTurns;
  }

  if (spec.reputationPenalty > 0) {
    const reputation = findResourceOfKind(lander, "resource.reputation");
    // A lander already at the floor loses nothing and the charge is still spent:
    // the placement fired, it simply found nothing left to take.
    const lost =
      reputation === null
        ? 0
        : Math.min(spec.reputationPenalty, spendableAmount(reputation));
    if (reputation !== null && lost > 0) {
      const nextValue = reputation.resource.value - lost;
      lander = withResourceValue(lander, reputation, nextValue);
      changes.push(
        resourceChangeFor(lander.id, reputation, nextValue, `placement:${placement.kind}`),
      );
      amount += lost;
    }
  }

  if (spec.moneyFlow === "lander-to-owner") {
    const landerMoney = findResourceOfKind(lander, "resource.money");
    const ownerMoney = findResourceOfKind(owner, "resource.money");
    // Same forgiveness rule the toll uses: a lander who cannot cover it pays
    // what they have. Debt is `LoanState` and belongs to the economy owner;
    // inventing a second representation of it here would leave two to reconcile.
    const paid =
      landerMoney === null || ownerMoney === null
        ? 0
        : Math.min(
            placementMoneyAmount(state.rules, placement.kind),
            spendableAmount(landerMoney),
          );
    if (landerMoney !== null && ownerMoney !== null && paid > 0) {
      const landerValue = landerMoney.resource.value - paid;
      const ownerValue = ownerMoney.resource.value + paid;
      lander = withResourceValue(lander, landerMoney, landerValue);
      owner = withResourceValue(owner, ownerMoney, ownerValue);
      changes.push(
        resourceChangeFor(lander.id, landerMoney, landerValue, `placement:${placement.kind}`),
        resourceChangeFor(owner.id, ownerMoney, ownerValue, `placement:${placement.kind}:payout`),
      );
      amount += paid;
    }
  }

  if (spec.moneyFlow === "bank-to-lander") {
    const landerMoney = findResourceOfKind(lander, "resource.money");
    const gain = placementMoneyAmount(state.rules, placement.kind);
    if (landerMoney !== null && gain > 0) {
      const nextValue = landerMoney.resource.value + gain;
      lander = withResourceValue(lander, landerMoney, nextValue);
      changes.push(
        resourceChangeFor(lander.id, landerMoney, nextValue, `placement:${placement.kind}`),
      );
      amount += gain;
    }
  }

  if (spec.surveils) {
    owner = withSurveillanceReport(state, owner, lander, placement, state.turn.round);
  }

  return { lander, owner, amount, changes };
}

/**
 * The watcher's dossier on whoever walked past the camera.
 *
 * Records only things the watcher could not otherwise see: the hand (public
 * projections carry a *count*, never the contents) and the role (hidden until
 * revealed). Everything else about the lander — money, reputation, position,
 * heat — is already public, so copying it here would add a redundant second
 * copy of public state for no gain.
 */
function withSurveillanceReport(
  state: GameState,
  owner: PlayerState,
  lander: PlayerState,
  placement: PlacementState,
  round: number,
): PlayerState {
  const handDefinitionIds = lander.hand
    .map((cardId): CardState | undefined => state.cards[cardId])
    .filter((card): card is CardState => card !== undefined)
    .map((card) => String(card.definitionId));

  const report: PlayerStatusState = {
    id: createStableId("StatusId", SURVEILLANCE_REPORT_STATUS),
    sourceId: placement.id,
    stacks: 1,
    remainingTurns: null,
    expiresAtRound: null,
    // The whole mechanic rests on this one field: a `public` status here would
    // hand every player the hand and role it was written to hide.
    visibility: "private",
    data: {
      observedPlayerId: lander.id,
      tileId: placement.tileId,
      atRound: round,
      handCardIds: lander.hand.map((cardId) => String(cardId)),
      handDefinitionIds,
      roleKind: lander.role.kind,
      roleRevealed: lander.role.revealed,
    },
  };

  return { ...owner, statuses: [...owner.statuses, report] };
}

/**
 * The landing trigger for placements: fire everything sitting on this tile.
 *
 * A pure hook. Emits no events and builds no `GameState` — it returns the
 * player records it changed, the surviving placement list and the resource
 * movements, and the turn integrator folds those into the state it is already
 * assembling.
 *
 * Iterates `state.placements` in array order, which is the only ordering that
 * survives the repository's JSON round trip; two placements on one tile
 * therefore resolve oldest-first, every time, on the original and on replay.
 *
 * A placement never fires for its own owner. That is a rule, not an oversight:
 * without it `placement.favour` is an infinite money loop for anyone willing to
 * stand on their own gift, and `placement.sabotage` becomes a way to pay
 * yourself.
 */
export function resolvePlacementLanding(
  landing: PlacementLanding,
): PlacementLandingOutcome {
  const { state, tileId } = landing;
  if (!state.rules.board.placementsEnabled) return inertPlacements(landing);

  const source = landing.players ?? state.players;
  const owners: Record<string, PlayerState> = {};
  const remaining: PlacementState[] = [];
  const triggers: PlacementTrigger[] = [];
  const changes: LandingResourceChange[] = [];
  let lander = landing.lander;

  for (const placement of state.placements) {
    const owner = owners[placement.ownerId] ?? source[placement.ownerId];
    if (
      placement.tileId !== tileId ||
      placement.charges <= 0 ||
      placement.ownerId === lander.id ||
      owner === undefined
    ) {
      remaining.push(placement);
      continue;
    }

    const applied = applyPlacement(state, placement, lander, owner);
    lander = applied.lander;
    // Only when something about the owner actually changed: `owners` is a patch
    // the caller merges, and an unchanged record in it would overwrite whatever
    // else this turn has already done to that player.
    if (applied.owner !== owner) {
      owners[placement.ownerId] = applied.owner;
    }
    changes.push(...applied.changes);

    const chargesRemaining = placement.charges - 1;
    triggers.push({
      placementId: placement.id,
      kind: placement.kind,
      ownerId: placement.ownerId,
      tileId: placement.tileId,
      visibility: placement.visibility,
      amount: applied.amount,
      chargesRemaining,
    });

    // A spent placement is dropped rather than kept at zero charges: an
    // `owner-only` row that lingers is one more thing a future projection has
    // to remember to hide.
    if (chargesRemaining > 0) {
      remaining.push({ ...placement, charges: chargesRemaining });
    }
  }

  return {
    lander,
    owners,
    placements: triggers.length === 0 ? state.placements : remaining,
    triggers,
    changes,
  };
}

export type LandingTriggerInput = {
  readonly state: GameState;
  readonly lander: PlayerState;
  readonly tileId: TileId;
};

export type LandingTollSummary = {
  readonly ownerId: PlayerId;
  readonly assessed: number;
  readonly paid: number;
};

export type LandingTriggerOutcome = {
  readonly lander: PlayerState;
  /** Every *other* player whose record changed, keyed by `PlayerId`. */
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly tileOwnership: GameState["tileOwnership"];
  readonly placements: readonly PlacementState[];
  /** `null` when the tile is unowned, self-owned, or ownership is off. */
  readonly toll: LandingTollSummary | null;
  readonly triggers: readonly PlacementTrigger[];
  readonly changes: readonly LandingResourceChange[];
};

/**
 * Both landing triggers, in the order they resolve. This is the single call the
 * turn loop needs.
 *
 * **Toll first, then placements.** The toll is the tile's standing charge and
 * the placements are events on top of it; charging the toll first means a
 * `placement.sabotage` cannot empty a lander's wallet and let them walk off an
 * owned tile for free, which would make placing a trap on someone else's
 * property a way to *protect* the visitor from its owner.
 *
 * Both halves are exported individually as well, for a caller that wants to
 * interleave something between them.
 */
export function resolveLandingTriggers(
  landing: LandingTriggerInput,
): LandingTriggerOutcome {
  const toll = resolveTileToll(landing);
  const afterToll: Record<string, PlayerState> = {};
  if (toll.owner !== null) {
    afterToll[toll.owner.id] = toll.owner;
  }

  const placements = resolvePlacementLanding({
    state: landing.state,
    lander: toll.lander,
    tileId: landing.tileId,
    players: { ...landing.state.players, ...afterToll },
  });

  return {
    lander: placements.lander,
    players: { ...afterToll, ...placements.owners },
    tileOwnership: toll.tileOwnership,
    placements: placements.placements,
    toll:
      toll.ownerId === null
        ? null
        : { ownerId: toll.ownerId, assessed: toll.assessed, paid: toll.paid },
    triggers: placements.triggers,
    changes: [...toll.changes, ...placements.changes],
  };
}

export type { LandingResourceChange, ResourceHandle };
