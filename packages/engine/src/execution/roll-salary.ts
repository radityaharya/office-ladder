import type { PlayerState, RankId, ResourceState } from "../model";
import type { BoardMovementResult } from "../rules";
import type { TransitionContent } from "./types";

export type SalaryResolution = {
  readonly amount: number;
  readonly rankId: RankId;
  readonly moneyKey: string;
  readonly moneyResource: ResourceState;
};

function findMoney(
  player: PlayerState,
): readonly [string, ResourceState] | undefined {
  return Object.entries(player.resources).find(
    ([, resource]) => resource.kind === "resource.money",
  );
}

function characterSalaryMultiplier(
  player: PlayerState,
  content: TransitionContent,
): number {
  const character = Object.values(content.characters).find(
    (candidate) => candidate.id === player.characterId,
  );
  return character?.passive.type === "salaryMultiplier"
    ? character.passive.multiplier
    : 1;
}

function isRankId(value: string): value is RankId {
  return value.startsWith("rank.");
}

export function resolveSalary(
  player: PlayerState,
  movement: BoardMovementResult,
  content: TransitionContent,
): SalaryResolution | null {
  const rankKind = player.rank.kind;
  const rank = content.ranks.find((candidate) => candidate.id === rankKind);
  const money = findMoney(player);
  if (
    rankKind === null ||
    !isRankId(rankKind) ||
    rank === undefined ||
    money === undefined
  ) {
    return null;
  }

  const passBonus = movement.passedReceptionist
    ? (rank.benefits.find(
        (benefit) => benefit.type === "salaryBonusOnReceptionistPass",
      )?.amount ?? 0)
    : 0;
  const amount =
    movement.receptionistSalaryAwards > 0
      ? (rank.salary + passBonus) *
        movement.receptionistSalaryAwards *
        characterSalaryMultiplier(player, content)
      : 0;

  return {
    amount,
    rankId: player.rank.id,
    moneyKey: money[0],
    moneyResource: money[1],
  };
}
