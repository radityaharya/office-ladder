import type { BoardTile, ModeRules } from "@office-ladder/content";

import type { ClaimTileCommand, UpgradeTileCommand } from "../commands";
import type { GameEvent, ResourceChangedEvent } from "../events";
import type {
  GameState,
  PlayerId,
  PlayerState,
  ResourceId,
  ResourceKind,
  ResourceState,
  TileId,
  TileOwnershipState,
} from "../model";
import { createEventMetadata } from "./events";
import { rejectCommand } from "./errors";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Tile ownership — the first genuinely contestable thing on the board.
 *
 * Three pieces, deliberately kept in one file because they share one price
 * ladder: the `tile.claim` transition, the `tile.upgrade` transition, and the
 * toll hook the turn loop fires when a player lands on someone else's tile.
 *
 * Everything here is gated on `state.rules.board` and takes every tunable it
 * has from there — `ownershipEnabled`, `upgradesEnabled`, `claimCostMultiplier`,
 * `tollMultiplier`. There is no `modeId` comparison anywhere in this file and
 * flipping `ownershipEnabled` off makes both commands unreachable and the toll
 * inert, which is what "a mechanic that cannot be switched off from config is a
 * bug" means in practice.
 *
 * The two base numbers below are the one thing `ModeRules` does not carry. They
 * are the *unit* the mode's multipliers scale, not a gate: a mode that wants a
 * cheaper board sets `claimCostMultiplier`, and a mode that wants no board
 * economy at all sets `ownershipEnabled: false`. Adding
 * `board.claimCostBase`/`board.tollBase` to `ModeRules` would remove even that,
 * and is recorded as a follow-up for the rules owner.
 */

/**
 * Money a claim costs before `claimCostMultiplier`.
 *
 * Calibrated against the economy the content pack actually authored: starting
 * money is 1000–2000, a rank salary is 200–800, and the first promotion costs
 * 250–625. At 400 a claim is roughly one good salary — a real decision against
 * saving for promotion, which is the whole point of a money sink.
 */
export const TILE_CLAIM_BASE_COST = 400;

/**
 * Money a level-0 tile charges a visitor before `tollMultiplier`.
 *
 * A quarter of the claim price, so an unimproved tile pays for itself after
 * four visits and an upgrade shortens that. Cheap enough that landing on an
 * owned tile is an annoyance rather than a knockout, which matters because the
 * lander had no say in where the dice put them.
 */
export const TILE_TOLL_BASE_AMOUNT = 100;

/**
 * The highest `TileOwnershipState.level` an upgrade can reach.
 *
 * Bounded so the toll ladder terminates: without a cap the first player to get
 * ahead can convert an unbounded amount of money into an unbounded toll, and
 * every later landing on that tile is a non-decision.
 */
export const MAX_TILE_LEVEL = 3;

/**
 * One of a player's resources plus the key it lives under.
 *
 * The key is a setup detail; the `kind` is the contract. Everything below looks
 * a resource up by kind and then writes back through the key it found, so
 * neither this file nor placements.ts hardcodes a resource key.
 */
export type ResourceHandle = {
  readonly key: string;
  readonly resource: ResourceState;
};

/**
 * One resource movement a landing trigger caused.
 *
 * Carries `resourceId` so the caller can build a `ResourceChanged` event
 * without looking the resource back up — the turn integrator holds a player
 * record mid-flight, not the map the resource id would be found in.
 */
export type LandingResourceChange = {
  readonly playerId: PlayerId;
  readonly resourceId: ResourceId;
  /** The key the resource lives under on `PlayerState.resources`. */
  readonly resourceKey: string;
  readonly previousValue: number;
  readonly newValue: number;
  /** Goes straight into `ResourceChangedEvent.payload.reason`. */
  readonly reason: string;
};

export type TileTollLanding = {
  readonly state: GameState;
  /**
   * The landing player as movement resolution left them, which is *not*
   * `state.players[landerId]` during a turn — the mover has already been paid a
   * salary and had tile effects applied by the time the toll is charged.
   */
  readonly lander: PlayerState;
  readonly tileId: TileId;
};

export type TileTollOutcome = {
  readonly lander: PlayerState;
  /**
   * Who owns the tile that was landed on, or `null` when it is unowned, owned
   * by the lander themselves, or ownership is switched off. Set even when the
   * toll could not be collected, so a caller can tell "nobody owns this" from
   * "the owner went unpaid".
   */
  readonly ownerId: PlayerId | null;
  /** The owner's record after being paid; `null` when no toll was charged. */
  readonly owner: PlayerState | null;
  /** `state.tileOwnership` with `tollPaidCount` bumped, or unchanged. */
  readonly tileOwnership: GameState["tileOwnership"];
  /** What the tile's level and the mode's multiplier priced this landing at. */
  readonly assessed: number;
  /** What the lander could actually pay. Less than `assessed` when they are broke. */
  readonly paid: number;
  readonly changes: readonly LandingResourceChange[];
};

/**
 * A player's resource of `kind`, or `null` when they carry none.
 *
 * Exactly one resource of each kind exists per player, so the `find` is
 * unambiguous and its result does not depend on object key order — which
 * matters because key order is not stable across the repository's JSON round
 * trip.
 */
export function findResourceOfKind(
  player: PlayerState,
  kind: ResourceKind,
): ResourceHandle | null {
  const entry = Object.entries(player.resources).find(
    ([, resource]) => resource.kind === kind,
  );

  return entry === undefined ? null : { key: entry[0], resource: entry[1] };
}

/** The player with `handle`'s resource set to `nextValue`. */
export function withResourceValue(
  player: PlayerState,
  handle: ResourceHandle,
  nextValue: number,
): PlayerState {
  return {
    ...player,
    resources: {
      ...player.resources,
      [handle.key]: { ...handle.resource, value: nextValue },
    },
  };
}

/** The change record a caller turns into a `ResourceChanged` event. */
export function resourceChangeFor(
  playerId: PlayerId,
  handle: ResourceHandle,
  nextValue: number,
  reason: string,
): LandingResourceChange {
  return {
    playerId,
    resourceId: handle.resource.id,
    resourceKey: handle.key,
    previousValue: handle.resource.value,
    newValue: nextValue,
    reason,
  };
}

/** What a player can spend without breaching that resource's own minimum. */
export function spendableAmount(handle: ResourceHandle): number {
  return Math.max(0, handle.resource.value - (handle.resource.minimum ?? 0));
}

function findMoney(player: PlayerState): ResourceHandle | null {
  return findResourceOfKind(player, "resource.money");
}

/** Money a claim costs under this ruleset. */
export function tileClaimCost(rules: ModeRules): number {
  return Math.max(
    0,
    Math.round(TILE_CLAIM_BASE_COST * rules.board.claimCostMultiplier),
  );
}

/**
 * Money the *next* upgrade costs a tile currently sitting at `currentLevel`.
 *
 * Linear in the level reached, so the second improvement costs twice the first:
 * the toll ladder is linear too, which keeps the payback period constant
 * instead of making the top level strictly the best buy.
 */
export function tileUpgradeCost(rules: ModeRules, currentLevel: number): number {
  return Math.max(
    0,
    Math.round(
      TILE_CLAIM_BASE_COST * rules.board.claimCostMultiplier * (currentLevel + 1),
    ),
  );
}

/** Money a visitor owes the owner of a tile at `level`. */
export function tileTollAmount(rules: ModeRules, level: number): number {
  return Math.max(
    0,
    Math.round(TILE_TOLL_BASE_AMOUNT * rules.board.tollMultiplier * (level + 1)),
  );
}

/**
 * Whether a tile can be owned at all.
 *
 * Corners are excluded: the receptionist pays every passing player a salary,
 * audit confines them, and the two management corners are the table's shared
 * event decks. Those are the board's public infrastructure, and letting one
 * player toll the salary corner is a runaway loop rather than a mechanic.
 */
export function isClaimableTile(
  spaces: readonly BoardTile[],
  tileId: TileId,
): boolean {
  const tile = spaces.find((candidate) => candidate.id === tileId);

  return tile !== undefined && tile.placement === "side";
}

type OwnershipGuardFailure = {
  readonly code: "GAME_NOT_ACTIVE" | "ILLEGAL_ACTION" | "ACTOR_NOT_FOUND" | "NOT_ACTOR_TURN" | "INVALID_COMMAND";
  readonly message: string;
};

type OwnershipGuardSuccess = {
  readonly player: PlayerState;
  readonly money: ResourceHandle;
};

/**
 * Everything both board commands check before they look at ownership.
 *
 * Authorisation first and unconditionally (spec §6.3): the actor has to be a
 * seated player and it has to be their turn, checked *before* any state is
 * read for mutation. Standing on the tile is the third: a player claims the
 * tile the dice put them on, which is what keeps a rich player from buying the
 * whole board from across the room in a single turn and makes the claim a
 * decision about *this* landing.
 */
function guardBoardCommand(
  state: GameState,
  actorId: PlayerId,
  tileId: TileId,
  enabled: boolean,
  disabledMessage: string,
):
  | { readonly ok: true; readonly value: OwnershipGuardSuccess }
  | { readonly ok: false; readonly error: OwnershipGuardFailure } {
  if (state.status !== "active") {
    return {
      ok: false,
      error: { code: "GAME_NOT_ACTIVE", message: "The board can only be changed in an active game" },
    };
  }
  if (!enabled) {
    return { ok: false, error: { code: "ILLEGAL_ACTION", message: disabledMessage } };
  }

  const player = state.players[actorId];
  if (player === undefined) {
    return {
      ok: false,
      error: { code: "ACTOR_NOT_FOUND", message: "Command actor is not a player in this game" },
    };
  }
  if (state.turn.activePlayerId !== actorId) {
    return {
      ok: false,
      error: { code: "NOT_ACTOR_TURN", message: "Only the active player can change the board" },
    };
  }
  if (!state.tileIds.includes(tileId)) {
    return {
      ok: false,
      error: { code: "INVALID_COMMAND", message: "tileId is not a tile on this board" },
    };
  }
  if (state.tileIds[player.position] !== tileId) {
    return {
      ok: false,
      error: {
        code: "ILLEGAL_ACTION",
        message: "A tile can only be claimed or upgraded by a player standing on it",
      },
    };
  }

  const money = findMoney(player);
  if (money === null) {
    return {
      ok: false,
      error: { code: "ILLEGAL_ACTION", message: "The actor has no money resource to spend" },
    };
  }

  return { ok: true, value: { player, money } };
}

/**
 * The state a board purchase produces: money spent, ownership written, one
 * `ResourceChanged` event when money actually moved.
 *
 * A zero-cost purchase (a mode with `claimCostMultiplier: 0`) emits nothing,
 * matching the "no value changed, no event" rule the tile-effect walk already
 * follows. There is no `TileClaimed`/`TileUpgraded` event type yet — adding one
 * to `packages/engine/src/events/index.ts` belongs to that file's owner and is
 * reported as a follow-up.
 */
function commitPurchase(
  state: GameState,
  command: ClaimTileCommand | UpgradeTileCommand,
  context: TransitionContext,
  player: PlayerState,
  money: ResourceHandle,
  cost: number,
  ownership: TileOwnershipState,
  reason: string,
): TransitionResult {
  const nextValue = money.resource.value - cost;
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
        reason,
      },
    };
    events.push(charged);
  }

  const lastEvent = events[events.length - 1];

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent?.sequence ?? state.eventSequence,
        players: {
          ...state.players,
          [player.id]: withResourceValue(player, money, nextValue),
        },
        tileOwnership: {
          ...state.tileOwnership,
          [ownership.tileId]: ownership,
        },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}

/**
 * `tile.claim` — buy the unowned tile you are standing on.
 *
 * Does not touch the turn: claiming is a side action, not a turn-ending one.
 * That is safe against repetition because a player stands on exactly one tile,
 * and the tile stops being claimable the instant this succeeds — so however
 * long the active player holds the turn, they can claim at most one tile per
 * landing.
 */
export function claimTile(
  state: GameState,
  command: ClaimTileCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = guardBoardCommand(
    state,
    command.actorId,
    command.payload.tileId,
    state.rules.board.ownershipEnabled,
    "Tile ownership is disabled by this mode",
  );
  if (!guard.ok) {
    return rejectCommand(state, command, guard.error);
  }

  const { player, money } = guard.value;
  const tileId = command.payload.tileId;

  if (!isClaimableTile(context.content.board.spaces, tileId)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This tile cannot be owned",
    });
  }

  const existing = state.tileOwnership[tileId];
  if (existing !== undefined) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message:
        existing.ownerId === command.actorId
          ? "The actor already owns this tile"
          : "This tile is already owned by another player",
    });
  }

  const cost = tileClaimCost(state.rules);
  if (spendableAmount(money) < cost) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Claiming this tile costs more money than the actor has",
      details: { required: cost, available: spendableAmount(money) },
    });
  }

  return commitPurchase(state, command, context, player, money, cost, {
    tileId,
    ownerId: command.actorId,
    level: 0,
    claimedAtRound: state.turn.round,
    tollPaidCount: 0,
  }, "tile-claim");
}

/**
 * `tile.upgrade` — raise the toll on a tile you already own and are standing on.
 *
 * The authorisation that matters here is ownership: without it any player could
 * spend their own money to raise *someone else's* tolls, which is a gift rather
 * than an attack but is still an effect landing on a player who is not the
 * actor. Rejected as `ACTOR_NOT_AUTHORIZED`.
 */
export function upgradeTile(
  state: GameState,
  command: UpgradeTileCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = guardBoardCommand(
    state,
    command.actorId,
    command.payload.tileId,
    state.rules.board.ownershipEnabled && state.rules.board.upgradesEnabled,
    state.rules.board.ownershipEnabled
      ? "Tile upgrades are disabled by this mode"
      : "Tile ownership is disabled by this mode",
  );
  if (!guard.ok) {
    return rejectCommand(state, command, guard.error);
  }

  const { player, money } = guard.value;
  const tileId = command.payload.tileId;
  const existing = state.tileOwnership[tileId];

  if (existing === undefined) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This tile is unowned and cannot be upgraded",
    });
  }
  if (existing.ownerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Only a tile's owner can upgrade it",
    });
  }
  if (existing.level >= MAX_TILE_LEVEL) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This tile is already at its maximum level",
      details: { level: existing.level, maximum: MAX_TILE_LEVEL },
    });
  }

  const cost = tileUpgradeCost(state.rules, existing.level);
  if (spendableAmount(money) < cost) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "Upgrading this tile costs more money than the actor has",
      details: { required: cost, available: spendableAmount(money) },
    });
  }

  return commitPurchase(
    state,
    command,
    context,
    player,
    money,
    cost,
    { ...existing, level: existing.level + 1 },
    "tile-upgrade",
  );
}

function inertToll(landing: TileTollLanding): TileTollOutcome {
  return {
    lander: landing.lander,
    ownerId: null,
    owner: null,
    tileOwnership: landing.state.tileOwnership,
    assessed: 0,
    paid: 0,
    changes: [],
  };
}

/**
 * The landing trigger for ownership: charge the lander a toll and pay it to the
 * tile's owner.
 *
 * A pure hook — it emits no events and mutates no `GameState`. It hands back the
 * two player records it changed plus the resource movements, and the turn
 * integrator folds those into the state it is already assembling. That keeps
 * this out of `roll-turn.ts` and keeps the ordering decision (toll first, then
 * placements — see `resolveLandingTriggers` in placements.ts) in one place.
 *
 * Never charges the owner for landing on their own tile, and never charges at
 * all when `rules.board.ownershipEnabled` is false, even if the state carries
 * ownership rows from a differently-configured match.
 *
 * A lander who cannot cover the toll pays what they have and the remainder is
 * *forgiven*, not recorded as debt: `LoanState` exists and belongs to the
 * economy owner, and inventing a second debt representation here would leave two
 * of them to reconcile later. `paid` and `assessed` are both reported so the
 * caller can surface the shortfall.
 */
export function resolveTileToll(landing: TileTollLanding): TileTollOutcome {
  const { state, lander, tileId } = landing;

  if (!state.rules.board.ownershipEnabled) return inertToll(landing);

  const ownership = state.tileOwnership[tileId];
  if (ownership === undefined || ownership.ownerId === lander.id) {
    return inertToll(landing);
  }

  const owner = state.players[ownership.ownerId];
  if (owner === undefined) return inertToll(landing);

  const assessed = tileTollAmount(state.rules, ownership.level);
  const landerMoney = findMoney(lander);
  const ownerMoney = findMoney(owner);
  if (assessed <= 0 || landerMoney === null || ownerMoney === null) {
    return inertToll(landing);
  }

  const paid = Math.min(assessed, spendableAmount(landerMoney));
  if (paid <= 0) {
    return { ...inertToll(landing), ownerId: ownership.ownerId, assessed };
  }

  const landerValue = landerMoney.resource.value - paid;
  const ownerValue = ownerMoney.resource.value + paid;

  return {
    lander: withResourceValue(lander, landerMoney, landerValue),
    ownerId: ownership.ownerId,
    owner: withResourceValue(owner, ownerMoney, ownerValue),
    tileOwnership: {
      ...state.tileOwnership,
      [tileId]: { ...ownership, tollPaidCount: ownership.tollPaidCount + 1 },
    },
    assessed,
    paid,
    changes: [
      resourceChangeFor(lander.id, landerMoney, landerValue, "tile-toll"),
      resourceChangeFor(owner.id, ownerMoney, ownerValue, "tile-toll-received"),
    ],
  };
}
