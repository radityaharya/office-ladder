import type { GameState, PlayerId, PlayerState } from "../../model";
import { findActiveStatus } from "../player-status";
import type { EffectCondition, EffectConditionSubject } from "./vocabulary";

/**
 * §10.3's `condition` guard, evaluated before an effect is applied.
 *
 * Pure and total: every clause reads canonical state, nothing reads a clock, and
 * an unrecognised clause can never reach here because `parseEffectCondition`
 * rejects it upstream (the resolver then declines to apply the effect — see the
 * fail-closed note on `EffectCondition`).
 *
 * Evaluated **per (actor, target) pair**, because `who: "target"` clauses are
 * exactly the point: "steal 200 from the richest player, but only if they
 * actually have 200" is one effect whose guard answers differently per target.
 */
export function evaluateEffectCondition(
  state: GameState,
  condition: EffectCondition,
  actorId: PlayerId,
  targetId: PlayerId,
): boolean {
  const subject = (who: EffectConditionSubject): PlayerState | undefined =>
    state.players[who === "actor" ? actorId : targetId];

  switch (condition.kind) {
    case "always":
      return true;
    case "never":
      return false;
    case "resourceAtLeast": {
      const player = subject(condition.who);
      const resource = player?.resources[condition.resource];

      return resource !== undefined && resource.value >= condition.amount;
    }
    case "resourceAtMost": {
      const player = subject(condition.who);
      const resource = player?.resources[condition.resource];

      return resource !== undefined && resource.value <= condition.amount;
    }
    case "rankIndexAtLeast": {
      const player = subject(condition.who);

      return player !== undefined && player.rank.index >= condition.index;
    }
    case "rankIndexAtMost": {
      const player = subject(condition.who);

      return player !== undefined && player.rank.index <= condition.index;
    }
    case "heatAtLeast": {
      const player = subject(condition.who);

      return player !== undefined && player.heat.value >= condition.value;
    }
    case "hasStatus": {
      const player = subject(condition.who);

      return player !== undefined && findActiveStatus(player, condition.statusId) !== null;
    }
    case "ownsTile": {
      const player = subject(condition.who);
      if (player === undefined) return false;

      const tileId =
        condition.tileId ?? (state.tileIds[player.position] as string | undefined) ?? null;
      if (tileId === null) return false;

      return state.tileOwnership[tileId]?.ownerId === player.id;
    }
    case "roundAtLeast":
      return state.turn.round >= condition.round;
    case "quarterIndex":
      return state.currentQuarterIndex === condition.index;
    case "not":
      return !evaluateEffectCondition(state, condition.of, actorId, targetId);
    case "all":
      return condition.of.every((inner) =>
        evaluateEffectCondition(state, inner, actorId, targetId),
      );
    case "any":
      return condition.of.some((inner) =>
        evaluateEffectCondition(state, inner, actorId, targetId),
      );
    default:
      return condition satisfies never;
  }
}
