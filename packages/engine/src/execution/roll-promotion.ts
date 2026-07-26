import type { ModeRules, PlayerState, ResourceState } from "../model";
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

/**
 * What the next rung costs, from the **snapshotted** ruleset.
 *
 * `rules.economy.promotionCostByRankIndex` mirrors the
 * `promotionFromPrevious.moneyCost[modeId]` column of the authored rank ladder
 * (content validation proves the two agree), indexed by the rank being promoted
 * *into*. Reading it here instead of indexing the live pack by `GameState.modeId`
 * is what makes a promotion — and therefore the race win — replay to the same
 * answer after the ladder is repriced, and it is the only source that means
 * anything at all for a lobby-authored ruleset, which has no column in the pack.
 *
 * A ruleset with no ladder (a pre-v2 snapshot, spec §5.10) falls back to the
 * authored column so an old match stays playable at the price it was played at.
 */
export function promotionCostForRankIndex(
  rules: ModeRules,
  rankIndex: number,
  authored: Readonly<Record<string, number>>,
  modeId: string,
): number {
  const ladder = (rules.economy as { readonly promotionCostByRankIndex?: readonly number[] })
    .promotionCostByRankIndex;
  const snapshotted = ladder?.[rankIndex];
  if (typeof snapshotted === "number" && Number.isFinite(snapshotted)) return snapshotted;

  return authored[modeId] ?? authored["mode.quick"] ?? 0;
}

export function resolvePromotion(
  player: PlayerState,
  content: TransitionContent,
  modeId: string,
  rules: ModeRules,
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
  // Rank index is tier - 1: the ladder is authored 1-based and every rank-indexed
  // table in `ModeRules` is 0-based, the same convention `upkeepByRankIndex` uses.
  const cost = promotionCostForRankIndex(
    rules,
    nextRank.tier - 1,
    requirement.moneyCost,
    modeId,
  );

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
