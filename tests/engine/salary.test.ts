import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { deadlineDashRanks } from "../../src/content/deadline-dash";
import {
  calculateSalary,
  findRankById,
  getNextRank,
  getPreviousRank,
  getRankById,
  getRankIndex,
  getSalaryForRank,
} from "../../src/engine/rules/salary";

describe("salary rules", () => {
  it("looks up every canonical rank and salary by id", () => {
    for (const [index, rank] of deadlineDashRanks.entries()) {
      expect(findRankById(deadlineDashRanks, rank.id)).toBe(rank);
      expect(getRankById(deadlineDashRanks, rank.id)).toBe(rank);
      expect(getRankIndex(deadlineDashRanks, rank.id)).toBe(index);
      expect(getSalaryForRank(deadlineDashRanks, rank.id)).toBe(rank.salary);
    }
  });

  it("navigates adjacent ranks and stops at both ends", () => {
    expect(getPreviousRank(deadlineDashRanks, "rank.intern")).toBeUndefined();
    expect(getNextRank(deadlineDashRanks, "rank.intern")).toBe(
      deadlineDashRanks[1],
    );
    expect(getPreviousRank(deadlineDashRanks, "rank.manager")).toBe(
      deadlineDashRanks[4],
    );
    expect(getNextRank(deadlineDashRanks, "rank.manager")).toBe(
      deadlineDashRanks[6],
    );
    expect(getNextRank(deadlineDashRanks, "rank.director")).toBeUndefined();
  });

  it("calculates default, repeated, multiplied, and bonus-adjusted awards", () => {
    expect(
      calculateSalary({ ranks: deadlineDashRanks, rankId: "rank.intern" }),
    ).toBe(200);
    expect(
      calculateSalary({
        ranks: deadlineDashRanks,
        rankId: "rank.manager",
        awards: 2,
      }),
    ).toBe(2_400);
    expect(
      calculateSalary({
        ranks: deadlineDashRanks,
        rankId: "rank.staff",
        awards: 2,
        multiplier: 1.5,
        bonusPerAward: 100,
      }),
    ).toBe(1_500);
    expect(
      calculateSalary({
        ranks: deadlineDashRanks,
        rankId: "rank.director",
        awards: 0,
        multiplier: 10,
      }),
    ).toBe(0);
  });

  it("matches the salary formula for every canonical rank", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: deadlineDashRanks.length - 1 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: -200, max: 500 }),
        (rankIndex, awards, multiplier, bonusPerAward) => {
          const rank = deadlineDashRanks[rankIndex];
          fc.pre(rank.salary + bonusPerAward >= 0);

          expect(
            calculateSalary({
              ranks: deadlineDashRanks,
              rankId: rank.id,
              awards,
              multiplier,
              bonusPerAward,
            }),
          ).toBe((rank.salary + bonusPerAward) * awards * multiplier);
        },
      ),
    );
  });

  it("rejects unknown ranks and invalid salary inputs", () => {
    const unknownRank =
      "rank.missing" as (typeof deadlineDashRanks)[number]["id"];

    expect(findRankById(deadlineDashRanks, unknownRank)).toBeUndefined();
    expect(getRankIndex(deadlineDashRanks, unknownRank)).toBe(-1);
    expect(() => getRankById(deadlineDashRanks, unknownRank)).toThrowError(
      new RangeError("Unknown rank: rank.missing"),
    );
    expect(() => getNextRank(deadlineDashRanks, unknownRank)).toThrow(RangeError);
    expect(() => getPreviousRank(deadlineDashRanks, unknownRank)).toThrow(
      RangeError,
    );
    expect(() =>
      getSalaryForRank([{ id: "rank.invalid", salary: -1 }], "rank.invalid"),
    ).toThrow(RangeError);
    expect(() =>
      calculateSalary({
        ranks: deadlineDashRanks,
        rankId: "rank.intern",
        awards: -1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateSalary({
        ranks: deadlineDashRanks,
        rankId: "rank.intern",
        multiplier: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateSalary({
        ranks: deadlineDashRanks,
        rankId: "rank.intern",
        bonusPerAward: Number.NaN,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateSalary({
        ranks: deadlineDashRanks,
        rankId: "rank.intern",
        bonusPerAward: -201,
      }),
    ).toThrow(RangeError);
  });
});
