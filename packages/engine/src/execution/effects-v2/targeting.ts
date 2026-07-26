import type { GameState, PlayerId, PlayerState } from "../../model";
import type { EffectTarget } from "./vocabulary";

/**
 * Target resolution for §10.1.
 *
 * **The whole module iterates `state.playerOrder` and nothing else.** Not
 * `Object.keys(state.players)`, not `Object.values(...)`, not a `Map`. The
 * repository round-trips canonical state through
 * `JSON.parse(JSON.stringify(…))`, and while V8 happens to preserve insertion
 * order for string keys today, that is not a contract the persistence layer
 * gives us and it is certainly not one a *different* JSON implementation gives
 * us. `playerOrder` is an authored array: it is the only ordering in this state
 * that means anything, and it is the one the spec names for tie-breaks.
 */

/** A resolved target set, or a choice the actor still has to make. */
export type TargetResolution =
  | { readonly kind: "resolved"; readonly playerIds: readonly PlayerId[] }
  /**
   * `chosen-opponent`. The caller **must** open a `PromptState` offering
   * `candidateIds` rather than picking one — an effect that resolves a choice
   * on the player's behalf is a bug (§10.1).
   */
  | { readonly kind: "choice-required"; readonly candidateIds: readonly PlayerId[] };

export type TargetInput = {
  readonly state: GameState;
  readonly actorId: PlayerId;
  readonly target: EffectTarget;
  /**
   * Whether the effect is hostile to whoever it lands on. Drives
   * `rules.conflict.leaderProtection`: `"hard"` removes the leader from the
   * candidate pool entirely, so a hostile derived target picks the next-best
   * player instead of the protected one.
   */
  readonly hostile: boolean;
};

/** Players still in the match, in canonical turn order. */
export function livePlayerIds(state: GameState): readonly PlayerId[] {
  return state.playerOrder.filter(
    (playerId) =>
      !state.eliminatedPlayerIds.includes(playerId) && state.players[playerId] !== undefined,
  );
}

function moneyOf(player: PlayerState): number {
  return player.resources["money"]?.value ?? 0;
}

/**
 * Who is winning, for `rules.conflict.leaderProtection`.
 *
 * Rank index first (it is the primary win path), money as the decider, and
 * `playerOrder` as the final tie-break so the answer never depends on key
 * iteration. Returns `null` for an empty table.
 */
export function leaderPlayerId(state: GameState): PlayerId | null {
  let leader: PlayerId | null = null;
  let leaderRank = -Infinity;
  let leaderMoney = -Infinity;

  for (const playerId of livePlayerIds(state)) {
    const player = state.players[playerId];
    if (player === undefined) continue;

    const rank = player.rank.index;
    const money = moneyOf(player);
    // Strictly greater only: the first player in `playerOrder` holds a tie,
    // which is what makes this deterministic.
    if (rank > leaderRank || (rank === leaderRank && money > leaderMoney)) {
      leader = playerId;
      leaderRank = rank;
      leaderMoney = money;
    }
  }

  return leader;
}

/**
 * The pool a target is derived from: everyone still playing, minus the leader
 * when they are under hard protection from a hostile effect.
 */
function candidatePool(input: TargetInput): readonly PlayerId[] {
  const live = livePlayerIds(input.state);
  if (!input.hostile || input.state.rules.conflict.leaderProtection !== "hard") {
    return live;
  }

  const protectedId = leaderPlayerId(input.state);
  if (protectedId === null) return live;

  return live.filter((playerId) => playerId !== protectedId);
}

/** Picks by a numeric key, holding ties for the earliest player in turn order. */
function extremeBy(
  state: GameState,
  pool: readonly PlayerId[],
  score: (player: PlayerState) => number,
  direction: "highest" | "lowest",
): readonly PlayerId[] {
  let chosen: PlayerId | null = null;
  let best = direction === "highest" ? -Infinity : Infinity;

  for (const playerId of pool) {
    const player = state.players[playerId];
    if (player === undefined) continue;

    const value = score(player);
    const better = direction === "highest" ? value > best : value < best;
    if (better) {
      chosen = playerId;
      best = value;
    }
  }

  return chosen === null ? [] : [chosen];
}

/**
 * The neighbour `offset` seats away in `playerOrder`, skipping anyone
 * eliminated, and never landing back on the actor.
 *
 * `right-neighbour` is the player who acts *after* the actor (turn order runs
 * forward through `playerOrder`); `left-neighbour` is the one who acts before.
 */
function neighbour(
  state: GameState,
  actorId: PlayerId,
  offset: 1 | -1,
): readonly PlayerId[] {
  const order = state.playerOrder;
  const size = order.length;
  const start = order.indexOf(actorId);
  if (start < 0 || size === 0) return [];

  for (let step = 1; step < size; step += 1) {
    const index = (((start + offset * step) % size) + size) % size;
    const candidate = order[index];
    if (candidate === undefined || candidate === actorId) continue;
    if (state.eliminatedPlayerIds.includes(candidate)) continue;
    if (state.players[candidate] === undefined) continue;

    return [candidate];
  }

  return [];
}

/** §10.1's eleven targets, resolved deterministically. */
export function resolveEffectTargets(input: TargetInput): TargetResolution {
  const { state, actorId, target } = input;
  const pool = candidatePool(input);
  const inPool = (playerId: PlayerId): boolean => pool.includes(playerId);

  switch (target) {
    case "self":
      // A self-effect is never blocked by leader protection: protecting the
      // leader from their own card would be nonsense.
      return {
        kind: "resolved",
        playerIds: state.players[actorId] === undefined ? [] : [actorId],
      };
    case "active-player": {
      const activeId = state.turn.activePlayerId;

      return {
        kind: "resolved",
        playerIds: activeId !== null && inPool(activeId) ? [activeId] : [],
      };
    }
    case "chosen-opponent":
      return {
        kind: "choice-required",
        candidateIds: pool.filter((playerId) => playerId !== actorId),
      };
    case "all-opponents":
      return {
        kind: "resolved",
        playerIds: pool.filter((playerId) => playerId !== actorId),
      };
    case "all-players":
      return { kind: "resolved", playerIds: pool };
    case "left-neighbour":
      return {
        kind: "resolved",
        playerIds: neighbour(state, actorId, -1).filter(inPool),
      };
    case "right-neighbour":
      return {
        kind: "resolved",
        playerIds: neighbour(state, actorId, 1).filter(inPool),
      };
    case "highest-rank":
      return {
        kind: "resolved",
        playerIds: extremeBy(state, pool, (player) => player.rank.index, "highest"),
      };
    case "lowest-rank":
      return {
        kind: "resolved",
        playerIds: extremeBy(state, pool, (player) => player.rank.index, "lowest"),
      };
    case "richest":
      return {
        kind: "resolved",
        playerIds: extremeBy(state, pool, moneyOf, "highest"),
      };
    case "poorest":
      return {
        kind: "resolved",
        playerIds: extremeBy(state, pool, moneyOf, "lowest"),
      };
    default:
      return target satisfies never;
  }
}
