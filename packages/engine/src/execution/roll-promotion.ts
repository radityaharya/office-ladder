import type { PlayerState, ResourceState } from "../model";
import type { TransitionContent } from "./types";

export type PromotionResolution =
  | {
      readonly promoted: true;
      /** Raw content rank identifier (e.g. "rank.staff") — brand into engine RankId at the call site. */
      readonly toRankId: string;
      readonly toTier: number;
      readonly cost: number;
      readonly moneyKey: string;
      readonly reputationKey: string;
      readonly isFinalRank: boolean;
    }
  | { readonly promoted: false };

function findResource(
  player: PlayerState,
  kind: ResourceState["kind"],
): readonly [string, ResourceState] | undefined {
  return Object.entries(player.resources).find(([, resource]) => resource.kind === kind);
}

export function resolvePromotion(
  player: PlayerState,
  content: TransitionContent,
  modeId: string,
): PromotionResolution {
  const currentRankId = player.rank.kind;
  if (currentRankId === null) return { promoted: false };

  const currentRank = content.ranks.find((rank) => rank.id === currentRankId);
  if (currentRank === undefined) return { promoted: false };

  const nextRank = content.ranks.find((rank) => rank.tier === currentRank.tier + 1);
  if (nextRank === undefined || nextRank.promotionFromPrevious === null) {
    return { promoted: false };
  }

  const money = findResource(player, "resource.money");
  const reputation = findResource(player, "resource.reputation");
  if (money === undefined || reputation === undefined) return { promoted: false };

  const requirement = nextRank.promotionFromPrevious;
  const cost =
    requirement.moneyCost[modeId as keyof typeof requirement.moneyCost] ??
    requirement.moneyCost["mode.quick"];

  const character = Object.values(content.characters).find(
    (candidate) => candidate.id === player.characterId,
  );
  const reputationAdjustment =
    character?.passive.type === "modifyPromotionRequirement" &&
    character.passive.resource === "reputation"
      ? character.passive.amount
      : 0;
  const reputationRequired = Math.max(0, requirement.reputationRequired + reputationAdjustment);

  if (money[1].value < cost || reputation[1].value < reputationRequired) {
    return { promoted: false };
  }

  const maxTier = Math.max(...content.ranks.map((rank) => rank.tier));

  return {
    promoted: true,
    toRankId: nextRank.id,
    toTier: nextRank.tier,
    cost,
    moneyKey: money[0],
    reputationKey: reputation[0],
    isFinalRank: nextRank.tier === maxTier,
  };
}
