export interface RankDefinition {
  id: string;
}

export interface SalariedRankDefinition extends RankDefinition {
  salary: number;
}

export interface CalculateSalaryInput<Rank extends SalariedRankDefinition> {
  ranks: readonly Rank[];
  rankId: Rank["id"];
  /** Number of salary-awarding Receptionist crossings. */
  awards?: number;
  multiplier?: number;
  /** Flat bonus applied for each award before the multiplier. */
  bonusPerAward?: number;
}

export function findRankById<Rank extends RankDefinition>(
  ranks: readonly Rank[],
  rankId: Rank["id"],
): Rank | undefined {
  return ranks.find((rank) => rank.id === rankId);
}

export function getRankById<Rank extends RankDefinition>(
  ranks: readonly Rank[],
  rankId: Rank["id"],
): Rank {
  const rank = findRankById(ranks, rankId);

  if (!rank) {
    throw new RangeError(`Unknown rank: ${String(rankId)}`);
  }

  return rank;
}

export function getRankIndex<Rank extends RankDefinition>(
  ranks: readonly Rank[],
  rankId: Rank["id"],
): number {
  return ranks.findIndex((rank) => rank.id === rankId);
}

export function getNextRank<Rank extends RankDefinition>(
  ranks: readonly Rank[],
  rankId: Rank["id"],
): Rank | undefined {
  const index = getRankIndex(ranks, rankId);

  if (index < 0) {
    throw new RangeError(`Unknown rank: ${String(rankId)}`);
  }

  return ranks[index + 1];
}

export function getPreviousRank<Rank extends RankDefinition>(
  ranks: readonly Rank[],
  rankId: Rank["id"],
): Rank | undefined {
  const index = getRankIndex(ranks, rankId);

  if (index < 0) {
    throw new RangeError(`Unknown rank: ${String(rankId)}`);
  }

  return index === 0 ? undefined : ranks[index - 1];
}

export function getSalaryForRank<Rank extends SalariedRankDefinition>(
  ranks: readonly Rank[],
  rankId: Rank["id"],
): number {
  const salary = getRankById(ranks, rankId).salary;

  if (!Number.isFinite(salary) || salary < 0) {
    throw new RangeError("Rank salary must be a non-negative finite number");
  }

  return salary;
}

export function calculateSalary<Rank extends SalariedRankDefinition>({
  ranks,
  rankId,
  awards = 1,
  multiplier = 1,
  bonusPerAward = 0,
}: CalculateSalaryInput<Rank>): number {
  if (!Number.isSafeInteger(awards) || awards < 0) {
    throw new RangeError("Salary awards must be a non-negative safe integer");
  }

  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new RangeError("Salary multiplier must be a non-negative finite number");
  }

  if (!Number.isFinite(bonusPerAward)) {
    throw new RangeError("Salary bonus must be finite");
  }

  const amount =
    (getSalaryForRank(ranks, rankId) + bonusPerAward) * awards * multiplier;

  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("Calculated salary must be a non-negative finite number");
  }

  return amount;
}
