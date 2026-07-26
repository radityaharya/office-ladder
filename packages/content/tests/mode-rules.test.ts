import { describe, expect, it } from "vitest";

import {
  deadlineDashContent,
  deadlineDashModes,
  deadlineDashRanks,
} from "../src/deadline-dash";
import type { ModeConfig, ModeId, ModeRules } from "../src/schema";
import { validateDeadlineDashContent, validateModeRules } from "../src/validation";
import type { DeadlineDashContentValidationInput } from "../src/validation";

const MODE_IDS = [
  "mode.quick",
  "mode.standard",
  "mode.marathon",
  "mode.campaign",
] as const satisfies readonly ModeId[];

const modes: Readonly<Record<ModeId, ModeConfig>> = deadlineDashModes;
const RANK_LADDER_LENGTH = deadlineDashRanks.length;

/**
 * A deliberately loose mirror of the parts of the content pack these tests
 * mutate. `structuredClone` gives a fully mutable copy; this type just keeps the
 * mutation sites honest without restating the real (deeply readonly) shapes.
 */
type MutableContent = {
  modes: Record<
    string,
    {
      turnTimerSeconds: number;
      rules: Record<string, unknown>;
    }
  >;
};

function validateMutation(mutate: (content: MutableContent) => void) {
  const content = structuredClone(deadlineDashContent) as unknown as MutableContent;
  mutate(content);
  return validateDeadlineDashContent(
    content as unknown as DeadlineDashContentValidationInput,
  );
}

function expectIssue(
  result: ReturnType<typeof validateDeadlineDashContent>,
  code: string,
  path: string,
): void {
  expect(result.valid).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code, path })]),
  );
}

function group(rules: Record<string, unknown>, name: string): Record<string, unknown> {
  return rules[name] as Record<string, unknown>;
}

/** Every number anywhere inside a rules block, with the path that reached it. */
function collectNumbers(
  value: unknown,
  path: string,
  found: Array<readonly [string, number]>,
): void {
  if (typeof value === "number") {
    found.push([path, value]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNumbers(entry, `${path}[${index}]`, found));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      collectNumbers(entry, `${path}.${key}`, found);
    }
  }
}

describe("shipped mode presets", () => {
  it("ships exactly the four preset ids, each keyed by its own id", () => {
    expect(Object.keys(deadlineDashModes)).toEqual([...MODE_IDS]);
    for (const modeId of MODE_IDS) {
      expect(modes[modeId].id).toBe(modeId);
      expect(modes[modeId].displayNameKey).toMatch(/^deadlineDash\.mode\.[A-Za-z]+\.name$/);
    }
  });

  it("does not ship a mode.custom preset", () => {
    // A custom ruleset is lobby-authored and stored on the room (spec §8.4). If
    // it ever became a content id it would also demand a `RankCostByMode`
    // column, which is exactly the coupling the spec avoids.
    expect(Object.keys(deadlineDashModes)).not.toContain("mode.custom");
  });

  it("gives every mode one upkeep charge per rung of the rank ladder", () => {
    for (const modeId of MODE_IDS) {
      expect(modes[modeId].rules.economy.upkeepByRankIndex).toHaveLength(RANK_LADDER_LENGTH);
    }
  });

  it("leaves at least one win path enabled in every mode", () => {
    for (const modeId of MODE_IDS) {
      const winPaths = modes[modeId].rules.winPaths;
      expect(Object.values(winPaths).some((enabled) => enabled)).toBe(true);
    }
  });

  it("keeps every numeric tunable non-negative and finite", () => {
    for (const modeId of MODE_IDS) {
      const found: Array<readonly [string, number]> = [];
      collectNumbers(modes[modeId].rules, `${modeId}.rules`, found);
      expect(found.length).toBeGreaterThan(0);
      const offenders = found.filter(
        ([, value]) => !Number.isFinite(value) || value < 0,
      );
      expect(offenders).toEqual([]);
    }
  });

  it("keeps timers.turnSeconds in step with the mode's own turnTimerSeconds", () => {
    for (const modeId of MODE_IDS) {
      expect(modes[modeId].rules.timers.turnSeconds).toBe(modes[modeId].turnTimerSeconds);
    }
  });

  it("ships direct messages off in every preset", () => {
    // Spec §8.1: the field is an off switch, not a v1 feature.
    for (const modeId of MODE_IDS) {
      expect(modes[modeId].rules.social.directMessages).toBe(false);
    }
  });

  it("enables the quarter track in every fixed-length mode", () => {
    for (const modeId of MODE_IDS) {
      const rules = modes[modeId].rules;
      if (rules.winShape !== "fixed-length") continue;
      expect(rules.quarters.enabled).toBe(true);
      expect(rules.quarters.count).toBeGreaterThan(0);
      expect(rules.quarters.roundsEach).toBeGreaterThan(0);
    }
  });

  it("only claims a survival win path where a player can actually be removed", () => {
    for (const modeId of MODE_IDS) {
      const rules = modes[modeId].rules;
      if (!rules.winPaths.survival) continue;
      expect(rules.conflict.elimination || rules.economy.bankruptcy === "eliminate").toBe(true);
    }
  });

  it("gives mode.quick the cheap depth only", () => {
    const rules = modes["mode.quick"].rules;
    expect(rules.winShape).toBe("race");
    expect({
      hand: rules.agency.handEnabled,
      reactions: rules.interaction.reactionWindows,
      promotionIsChoice: rules.agency.promotionIsChoice,
      diceAdjust: rules.agency.diceAdjustEnabled,
    }).toEqual({
      hand: true,
      reactions: true,
      promotionIsChoice: true,
      diceAdjust: true,
    });
    expect({
      ownership: rules.board.ownershipEnabled,
      placements: rules.board.placementsEnabled,
      projects: rules.projects.enabled,
      loans: rules.economy.loansEnabled,
      upkeep: rules.economy.upkeepEnabled,
      roles: rules.hidden.rolesEnabled,
      auctions: rules.interaction.auctionsEnabled,
      quarters: rules.quarters.enabled,
    }).toEqual({
      ownership: false,
      placements: false,
      projects: false,
      loans: false,
      upkeep: false,
      roles: false,
      auctions: false,
      quarters: false,
    });
  });

  it("neutralises the tunables of every subsystem mode.quick switches off", () => {
    // A neutral value degrades to a no-op if a mechanic ever reads a tunable
    // without checking its enablement flag first: zero for a magnitude, one for
    // a multiplier, "none" for a policy.
    const rules = modes["mode.quick"].rules;
    expect(rules.economy.upkeepByRankIndex.every((charge) => charge === 0)).toBe(true);
    expect(rules.economy.maxLoanPrincipal).toBe(0);
    expect(rules.economy.interestBasisPoints).toBe(0);
    expect(rules.economy.bankruptcy).toBe("none");
    expect(rules.board.claimCostMultiplier).toBe(1);
    expect(rules.board.tollMultiplier).toBe(1);
    expect(rules.board.maxPlacementsPerPlayer).toBe(0);
    expect(rules.projects.maxConcurrentPerPlayer).toBe(0);
    expect(rules.conflict.heatPerAttack).toBe(0);
    expect(rules.conflict.leaderProtection).toBe("none");
  });

  it("never zeroes a threshold or a duration, in any mode", () => {
    // Zero is inert for a magnitude but degenerate for these: a heat threshold
    // of 0 trips an investigation on the first attack and a project deadline of
    // 0 rounds fails on creation, so a disabled subsystem carries the minimum
    // legal value instead. This is also what keeps every preset inside
    // MODE_RULES_BOUNDS in packages/contracts/src/mode-rules.ts, whose minimum
    // for all four is 1 — a preset the lobby cannot re-save as a custom ruleset
    // would be a bug in the preset.
    for (const modeId of MODE_IDS) {
      const rules = modes[modeId].rules;
      expect(rules.quarters.count).toBeGreaterThanOrEqual(1);
      expect(rules.quarters.roundsEach).toBeGreaterThanOrEqual(1);
      expect(rules.projects.deadlineRounds).toBeGreaterThanOrEqual(1);
      expect(rules.conflict.heatThreshold).toBeGreaterThanOrEqual(1);
      expect(rules.interaction.reactionWindowSeconds).toBeGreaterThanOrEqual(1);
      expect(rules.timers.turnSeconds).toBeGreaterThanOrEqual(5);
    }
  });

  it("makes mode.standard a fixed-length 4x4 default with everything on but the three exclusions", () => {
    const rules = modes["mode.standard"].rules;
    expect(rules.winShape).toBe("fixed-length");
    expect(rules.quarters).toEqual({
      enabled: true,
      count: 4,
      roundsEach: 4,
      globalEvents: true,
    });
    expect({
      elimination: rules.conflict.elimination,
      directMessages: rules.social.directMessages,
      roleWinConditions: rules.hidden.roleWinConditions,
    }).toEqual({ elimination: false, directMessages: false, roleWinConditions: false });
    expect({
      upkeep: rules.economy.upkeepEnabled,
      loans: rules.economy.loansEnabled,
      incomeStreams: rules.economy.incomeStreamsEnabled,
      ownership: rules.board.ownershipEnabled,
      upgrades: rules.board.upgradesEnabled,
      placements: rules.board.placementsEnabled,
      projects: rules.projects.enabled,
      sabotage: rules.projects.sabotageable,
      attacks: rules.conflict.targetedAttacks,
      heat: rules.conflict.heatEnabled,
      defence: rules.conflict.defenceEnabled,
      hand: rules.agency.handEnabled,
      diceAdjust: rules.agency.diceAdjustEnabled,
      promotionIsChoice: rules.agency.promotionIsChoice,
      reactions: rules.interaction.reactionWindows,
      votes: rules.interaction.votesEnabled,
      auctions: rules.interaction.auctionsEnabled,
      trades: rules.interaction.tradesEnabled,
      promises: rules.interaction.promisesRecorded,
      roles: rules.hidden.rolesEnabled,
      secretObjectives: rules.hidden.secretObjectives,
      hiddenHands: rules.hidden.hiddenHands,
      globalEvents: rules.quarters.globalEvents,
    }).toEqual(
      Object.fromEntries(
        [
          "upkeep",
          "loans",
          "incomeStreams",
          "ownership",
          "upgrades",
          "placements",
          "projects",
          "sabotage",
          "attacks",
          "heat",
          "defence",
          "hand",
          "diceAdjust",
          "promotionIsChoice",
          "reactions",
          "votes",
          "auctions",
          "trades",
          "promises",
          "roles",
          "secretObjectives",
          "hiddenHands",
          "globalEvents",
        ].map((key) => [key, true]),
      ),
    );
  });

  it("keeps mode.marathon's existing behaviour and turns everything on", () => {
    const mode = modes["mode.marathon"];
    // The pre-v2 fields must be untouched: persisted games reference them.
    expect(mode.targetDurationMinutes).toEqual([60, 120]);
    expect(mode.turnTimerSeconds).toBe(30);
    expect(mode.handLimit).toBe(3);
    expect(mode.startingResources).toEqual({
      money: 1500,
      reputation: 0,
      energy: 5,
      workCounter: 0,
    });
    expect(mode.endgame).toEqual({
      type: "additional-rounds",
      rounds: 3,
      clockExhaustionStillEndsMatch: true,
      scoring: { rankTierPoints: 1000, moneyMultiplier: 0.1, reputationPoints: 50 },
    });

    const rules = mode.rules;
    expect(rules.winShape).toBe("fixed-length");
    expect(rules.conflict.elimination).toBe(true);
    expect(rules.economy.bankruptcy).toBe("eliminate");
    expect(rules.hidden).toEqual({
      rolesEnabled: true,
      roleWinConditions: true,
      secretObjectives: true,
      hiddenHands: true,
    });
  });

  it("keeps mode.quick's existing non-rules behaviour untouched", () => {
    const mode = modes["mode.quick"];
    expect(mode.targetDurationMinutes).toEqual([20, 30]);
    expect(mode.turnTimerSeconds).toBe(20);
    expect(mode.handLimit).toBe(1);
    expect(mode.startingResources).toEqual({
      money: 1000,
      reputation: 0,
      energy: 5,
      workCounter: 0,
    });
    expect(mode.endgame).toEqual({ type: "immediate" });
  });

  it("gives mode.campaign the objectives win shape with the full hidden-information set", () => {
    const rules = modes["mode.campaign"].rules;
    expect(rules.winShape).toBe("objectives");
    expect(rules.hidden).toEqual({
      rolesEnabled: true,
      roleWinConditions: true,
      secretObjectives: true,
      hiddenHands: true,
    });
    expect(rules.interaction.auctionsEnabled).toBe(true);
    expect(rules.quarters.enabled).toBe(true);
    // Longest preset: it must have strictly more scheduled rounds than standard.
    const campaignRounds = rules.quarters.count * rules.quarters.roundsEach;
    const standardRules = modes["mode.standard"].rules;
    expect(campaignRounds).toBeGreaterThan(
      standardRules.quarters.count * standardRules.quarters.roundsEach,
    );
    // Removing a player from a multi-hour social match is worse than demoting.
    expect(rules.conflict.elimination).toBe(false);
  });

  it("documents every preset's rules block as unplaytested", () => {
    for (const modeId of MODE_IDS) {
      expect(modes[modeId].sourceNotes.join("\n")).toContain("unplaytested");
    }
  });
});

describe("mode rules validation", () => {
  it("rejects an upkeep ladder that is not one entry per rank", () => {
    const short = validateMutation((content) => {
      const economy = group(content.modes["mode.standard"].rules, "economy");
      (economy.upkeepByRankIndex as number[]).pop();
    });
    expectIssue(
      short,
      "mode.rules-upkeep-length",
      "modes.mode.standard.rules.economy.upkeepByRankIndex.length",
    );

    const long = validateMutation((content) => {
      const economy = group(content.modes["mode.marathon"].rules, "economy");
      (economy.upkeepByRankIndex as number[]).push(1000);
    });
    expectIssue(
      long,
      "mode.rules-upkeep-length",
      "modes.mode.marathon.rules.economy.upkeepByRankIndex.length",
    );
  });

  it("rejects an all-false winPaths block", () => {
    const result = validateMutation((content) => {
      const winPaths = group(content.modes["mode.standard"].rules, "winPaths");
      winPaths.promotion = false;
      winPaths.wealth = false;
      winPaths.influence = false;
      winPaths.survival = false;
    });
    expectIssue(result, "mode.rules-win-paths", "modes.mode.standard.rules.winPaths");
  });

  it("rejects negative, fractional, and out-of-bound numeric tunables", () => {
    const result = validateMutation((content) => {
      const rules = content.modes["mode.standard"].rules;
      group(rules, "economy").interestBasisPoints = -1;
      (group(rules, "economy").upkeepByRankIndex as number[])[2] = -50;
      group(rules, "agency").maxPipAdjust = 999;
      group(rules, "board").tollMultiplier = -0.5;
      group(rules, "projects").deadlineRounds = 2.5;
    });

    expectIssue(
      result,
      "mode.rules-number",
      "modes.mode.standard.rules.economy.interestBasisPoints",
    );
    expectIssue(
      result,
      "mode.rules-number",
      "modes.mode.standard.rules.economy.upkeepByRankIndex[2]",
    );
    expectIssue(result, "mode.rules-number", "modes.mode.standard.rules.agency.maxPipAdjust");
    expectIssue(result, "mode.rules-number", "modes.mode.standard.rules.board.tollMultiplier");
    expectIssue(
      result,
      "mode.rules-number",
      "modes.mode.standard.rules.projects.deadlineRounds",
    );
  });

  it("rejects an ascending-range violation in bots.thinkMsRange", () => {
    const result = validateMutation((content) => {
      group(content.modes["mode.standard"].rules, "bots").thinkMsRange = [2000, 500];
    });
    expectIssue(result, "mode.rules-number", "modes.mode.standard.rules.bots.thinkMsRange");
  });

  it("rejects unknown enum members and unknown or missing rule groups", () => {
    const enums = validateMutation((content) => {
      const rules = content.modes["mode.standard"].rules;
      rules.winShape = "sudden-death";
      group(rules, "economy").bankruptcy = "fire";
      group(rules, "timers").onTimeout = "auto-lose";
    });
    expectIssue(enums, "mode.rules-enum", "modes.mode.standard.rules.winShape");
    expectIssue(enums, "mode.rules-enum", "modes.mode.standard.rules.economy.bankruptcy");
    expectIssue(enums, "mode.rules-enum", "modes.mode.standard.rules.timers.onTimeout");

    const structural = validateMutation((content) => {
      const rules = content.modes["mode.standard"].rules;
      delete rules.bots;
      rules.cheatMode = true;
      group(rules, "agency").unlimitedPips = true;
    });
    expectIssue(structural, "mode.rules-shape", "modes.mode.standard.rules.bots");
    expectIssue(structural, "mode.rules-shape", "modes.mode.standard.rules.cheatMode");
    expectIssue(
      structural,
      "mode.rules-shape",
      "modes.mode.standard.rules.agency.unlimitedPips",
    );
  });

  it("rejects direct messages being switched on", () => {
    const result = validateMutation((content) => {
      group(content.modes["mode.standard"].rules, "social").directMessages = true;
    });
    expectIssue(
      result,
      "mode.rules-direct-messages",
      "modes.mode.standard.rules.social.directMessages",
    );
  });

  it("rejects a turn timer that disagrees with the mode's own turnTimerSeconds", () => {
    const result = validateMutation((content) => {
      group(content.modes["mode.standard"].rules, "timers").turnSeconds = 99;
    });
    expectIssue(
      result,
      "mode.rules-turn-seconds",
      "modes.mode.standard.rules.timers.turnSeconds",
    );
  });

  it("rejects a fixed-length mode with no quarter track", () => {
    const result = validateMutation((content) => {
      const quarters = group(content.modes["mode.marathon"].rules, "quarters");
      quarters.enabled = false;
    });
    expectIssue(result, "mode.rules-quarters", "modes.mode.marathon.rules.quarters.enabled");
  });

  it("rejects an enabled quarter track with no quarters in it", () => {
    const result = validateMutation((content) => {
      const quarters = group(content.modes["mode.standard"].rules, "quarters");
      quarters.count = 0;
    });
    expectIssue(result, "mode.rules-quarters", "modes.mode.standard.rules.quarters");
  });
});

describe("validateModeRules as a standalone validator", () => {
  // This is the entry point contracts needs for a lobby-authored custom
  // ruleset (spec §8.4), so it has to hold on its own without a content pack.
  const options = { rankLadderLength: RANK_LADDER_LENGTH } as const;

  it("accepts each shipped preset's rules in isolation", () => {
    for (const modeId of MODE_IDS) {
      expect(validateModeRules(modes[modeId].rules, options)).toEqual({
        valid: true,
        issues: [],
      });
    }
  });

  it("reports every issue against a caller-supplied path", () => {
    const rules = structuredClone(modes["mode.standard"].rules) as unknown as Record<
      string,
      unknown
    >;
    group(rules, "agency").maxPipAdjust = -1;

    const result = validateModeRules(rules, options, "room.customRules");
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mode.rules-number",
          path: "room.customRules.agency.maxPipAdjust",
        }),
      ]),
    );
  });

  it("rejects a non-object, and a rules object missing every group", () => {
    expect(validateModeRules(null, options).valid).toBe(false);
    expect(validateModeRules("race", options).valid).toBe(false);
    const empty = validateModeRules({}, options);
    expect(empty.valid).toBe(false);
    // One issue for winShape plus one per missing group.
    expect(empty.issues.length).toBeGreaterThanOrEqual(13);
  });

  it("checks the upkeep ladder against the caller's ladder length, not a constant", () => {
    const rules: ModeRules = modes["mode.standard"].rules;
    expect(validateModeRules(rules, { rankLadderLength: RANK_LADDER_LENGTH + 1 }).valid).toBe(
      false,
    );
  });
});

describe("rank costs per mode", () => {
  it("declares a cost for all four modes on every promotable rank", () => {
    for (const rank of deadlineDashRanks) {
      if (rank.promotionFromPrevious === null) continue;
      expect(Object.keys(rank.promotionFromPrevious.moneyCost).sort()).toEqual(
        [...MODE_IDS].sort(),
      );
    }
  });

  it("derives mode.standard from mode.marathon unchanged and mode.campaign at 1.25x", () => {
    for (const rank of deadlineDashRanks) {
      const requirement = rank.promotionFromPrevious;
      if (requirement === null) continue;
      const marathon = requirement.moneyCost["mode.marathon"];
      expect(requirement.moneyCost["mode.standard"]).toBe(marathon);
      expect(requirement.moneyCost["mode.campaign"]).toBe(marathon * 1.25);
      // x1.25 lands exactly on the money scale at every rung, so no rounding
      // judgement was needed and none should creep in later.
      expect(Number.isInteger(requirement.moneyCost["mode.campaign"])).toBe(true);
      expect(requirement.moneyCost["mode.campaign"] % 25).toBe(0);
    }
  });

  it("records on every affected rank that the two new columns are underived", () => {
    for (const rank of deadlineDashRanks) {
      if (rank.promotionFromPrevious === null) {
        continue;
      }
      const notes = (rank.sourceNotes ?? []).join("\n");
      expect(notes).toContain("unplaytested");
      expect(notes).toContain("mode.standard");
      expect(notes).toContain("mode.campaign");
    }
  });

  it("keeps the pre-existing quick and marathon columns byte-for-byte", () => {
    const costs = deadlineDashRanks
      .filter((rank) => rank.promotionFromPrevious !== null)
      .map((rank) => [
        rank.promotionFromPrevious!.moneyCost["mode.quick"],
        rank.promotionFromPrevious!.moneyCost["mode.marathon"],
      ]);

    expect(costs).toEqual([
      [250, 500],
      [600, 1200],
      [1000, 2000],
      [1500, 3000],
      [2250, 4500],
      [3000, 6000],
      [4000, 8000],
      [5000, 10000],
    ]);
  });
});
