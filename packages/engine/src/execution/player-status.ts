import type { PlayerState, PlayerStatusState } from "../model";
import { createStableId } from "../model";

export function findActiveStatus(
  player: PlayerState,
  statusId: string,
): PlayerStatusState | null {
  return player.statuses.find((status) => status.id === statusId && status.stacks > 0) ?? null;
}

/** Decrements one stack of a status, removing it entirely once exhausted. */
export function consumeStatus(player: PlayerState, statusId: string): PlayerState {
  const statuses = player.statuses
    .map((status) =>
      status.id === statusId ? { ...status, stacks: status.stacks - 1 } : status,
    )
    .filter((status) => status.stacks > 0);

  return { ...player, statuses };
}

/** Applies the applyStatus tile effect: adds (or replaces) a status by id. */
export function applyStatusEffect(
  player: PlayerState,
  input: {
    readonly statusId: string;
    readonly duration:
      | { readonly kind: "uses"; readonly count: number }
      | { readonly kind: "turns"; readonly count: number };
    readonly parameters?: Readonly<Record<string, number | string | boolean>>;
  },
): PlayerState {
  const status: PlayerStatusState = {
    id: createStableId("StatusId", input.statusId),
    sourceId: null,
    stacks: input.duration.kind === "uses" ? input.duration.count : 1,
    remainingTurns: input.duration.kind === "turns" ? input.duration.count : null,
    expiresAtRound: null,
    visibility: "private",
    data: input.parameters ?? {},
  };

  return {
    ...player,
    statuses: [...player.statuses.filter((existing) => existing.id !== status.id), status],
  };
}

/** Decrements remainingTurns for every turns-based status the player holds, dropping expired ones. */
export function tickStatusTurns(player: PlayerState): PlayerState {
  const statuses = player.statuses
    .map((status) =>
      status.remainingTurns === null
        ? status
        : { ...status, remainingTurns: status.remainingTurns - 1 },
    )
    .filter((status) => status.remainingTurns === null || status.remainingTurns > 0);

  return { ...player, statuses };
}
