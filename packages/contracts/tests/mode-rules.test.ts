import { describe, expect, it } from "vitest";

import {
  DEADLINE_DASH_RANK_LADDER_LENGTH,
  MODE_RULES_BOUNDS,
  parseModeRules,
  parseSetModeRulesRequest,
  type ModeRules,
} from "../src/mode-rules";
import { ContractValidationError } from "../src/validate";

/**
 * A ruleset the validator accepts, close to the shipped `mode.standard` preset.
 * Every negative case below is this object with one field changed, so a case can
 * only fail for the reason it names.
 */
function validRules(): ModeRules {
  return {
    winShape: "fixed-length",
    quarters: { enabled: true, count: 4, roundsEach: 4, globalEvents: true },
    winPaths: { promotion: true, wealth: true, influence: true, survival: false },
    economy: {
      upkeepEnabled: true,
      upkeepByRankIndex: [0, 50, 100, 150, 200, 300, 400, 500, 650],
      loansEnabled: true,
      maxLoanPrincipal: 2_000,
      interestBasisPoints: 1_000,
      bankruptcy: "demote",
      incomeStreamsEnabled: true,
    },
    board: {
      ownershipEnabled: true,
      claimCostMultiplier: 1.5,
      tollMultiplier: 0.5,
      upgradesEnabled: true,
      placementsEnabled: true,
      maxPlacementsPerPlayer: 3,
    },
    projects: {
      enabled: true,
      maxConcurrentPerPlayer: 2,
      joinable: true,
      sabotageable: true,
      deadlineRounds: 4,
    },
    conflict: {
      targetedAttacks: true,
      heatEnabled: true,
      heatPerAttack: 2,
      heatThreshold: 6,
      defenceEnabled: true,
      leaderProtection: "soft",
      elimination: false,
    },
    agency: {
      promotionIsChoice: true,
      promotionRaisesUpkeep: true,
      diceAdjustEnabled: true,
      energyPerPip: 1,
      maxPipAdjust: 2,
      freeActionsPerTurn: 1,
      handEnabled: true,
    },
    interaction: {
      reactionWindows: true,
      reactionWindowSeconds: 12,
      votesEnabled: true,
      auctionsEnabled: true,
      tradesEnabled: true,
      promisesRecorded: true,
    },
    hidden: {
      rolesEnabled: true,
      roleWinConditions: false,
      secretObjectives: true,
      hiddenHands: true,
    },
    social: { chat: "full", emoteReactions: true, directMessages: false },
    timers: { turnSeconds: 45, onTimeout: "auto-roll", chessClockSeconds: null },
    bots: { pacing: "paced", thinkMsRange: [400, 1_200], canNegotiate: false },
  };
}

/** `validRules()` with one nested block partially overridden. */
function withBlock<Key extends keyof ModeRules>(
  key: Key,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const base = validRules();
  return { ...base, [key]: { ...(base[key] as object), ...overrides } };
}

describe("custom mode rules", () => {
  it("Given a complete ruleset, When validating it, Then it comes back field for field", () => {
    expect(parseModeRules(validRules())).toEqual(validRules());
  });

  it("Given a ruleset with fields this validator does not read, When validating it, Then they do not survive into the result", () => {
    // The result is rebuilt field by field rather than spread from the input, so a
    // rules object cannot smuggle a key into `GameState.rules` — but an unknown key
    // is refused outright rather than dropped, which is the stronger property.
    expect(() =>
      parseModeRules({ ...validRules(), cheatMode: true }),
    ).toThrow(ContractValidationError);
    expect(() =>
      parseModeRules(withBlock("agency", { unlimitedActions: true })),
    ).toThrow(ContractValidationError);
  });

  it.each([
    "winShape",
    "quarters",
    "winPaths",
    "economy",
    "board",
    "projects",
    "conflict",
    "agency",
    "interaction",
    "hidden",
    "social",
    "timers",
    "bots",
  ])(
    "Given a ruleset with %s missing, When validating it, Then it is rejected rather than defaulted",
    (field) => {
      // No defaulting anywhere: an omitted field is a rule nobody at the table
      // agreed to, and a default would make the lobby's summary a lie.
      const rules: Record<string, unknown> = { ...validRules() };
      delete rules[field];
      expect(() => parseModeRules(rules)).toThrow(ContractValidationError);
    },
  );

  it.each([
    ["a non-object", 7],
    ["null", null],
    ["an array", []],
  ])(
    "Given %s in place of a ruleset, When validating it, Then it is rejected",
    (_label, value) => {
      expect(() => parseModeRules(value)).toThrow(ContractValidationError);
    },
  );
});

describe("custom mode rules — the exploit cases", () => {
  it("Given an unbounded maxPipAdjust, When validating it, Then it is rejected", () => {
    // 12 pips on 2d6 is not a nudge, it is choosing the destination: dice stop
    // being variance and the board stops being a risk.
    expect(() => parseModeRules(withBlock("agency", { maxPipAdjust: 12 }))).toThrow(
      ContractValidationError,
    );
    expect(() =>
      parseModeRules(withBlock("agency", { maxPipAdjust: Number.MAX_SAFE_INTEGER })),
    ).toThrow(ContractValidationError);
    expect(() => parseModeRules(withBlock("agency", { maxPipAdjust: -1 }))).toThrow(
      ContractValidationError,
    );
    // The documented ceiling itself is legal, inclusively.
    expect(
      parseModeRules(
        withBlock("agency", { maxPipAdjust: MODE_RULES_BOUNDS.maxPipAdjust.maximum }),
      ).agency.maxPipAdjust,
    ).toBe(MODE_RULES_BOUNDS.maxPipAdjust.maximum);
  });

  it("Given a negative interestBasisPoints, When validating it, Then it is rejected", () => {
    // Negative interest turns a loan into a grant that pays the borrower to hold
    // it, and there is no cap on how many times it can be taken.
    expect(() =>
      parseModeRules(withBlock("economy", { interestBasisPoints: -5_000 })),
    ).toThrow(ContractValidationError);
    expect(() =>
      parseModeRules(withBlock("economy", { interestBasisPoints: -1 })),
    ).toThrow(ContractValidationError);
    // Zero interest is a legitimate mode choice; 100% is the ceiling.
    expect(
      parseModeRules(withBlock("economy", { interestBasisPoints: 0 })).economy
        .interestBasisPoints,
    ).toBe(0);
    expect(
      parseModeRules(
        withBlock("economy", {
          interestBasisPoints: MODE_RULES_BOUNDS.interestBasisPoints.maximum,
        }),
      ).economy.interestBasisPoints,
    ).toBe(MODE_RULES_BOUNDS.interestBasisPoints.maximum);
    expect(() =>
      parseModeRules(
        withBlock("economy", {
          interestBasisPoints: MODE_RULES_BOUNDS.interestBasisPoints.maximum + 1,
        }),
      ),
    ).toThrow(ContractValidationError);
  });

  it("Given an all-false winPaths, When validating it, Then it is rejected as unwinnable", () => {
    expect(() =>
      parseModeRules(
        withBlock("winPaths", {
          promotion: false,
          wealth: false,
          influence: false,
          survival: false,
        }),
      ),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["promotion", { promotion: true, wealth: false, influence: false, survival: false }],
    ["wealth", { promotion: false, wealth: true, influence: false, survival: false }],
    ["influence", { promotion: false, wealth: false, influence: true, survival: false }],
    ["survival", { promotion: false, wealth: false, influence: false, survival: true }],
  ])(
    "Given a winPaths with only %s enabled, When validating it, Then it is accepted",
    (_label, winPaths) => {
      // One path is enough. The check is "at least one", not "at least two".
      expect(parseModeRules(withBlock("winPaths", winPaths)).winPaths).toEqual(winPaths);
    },
  );

  it.each([
    ["one entry short", DEADLINE_DASH_RANK_LADDER_LENGTH - 1],
    ["one entry long", DEADLINE_DASH_RANK_LADDER_LENGTH + 1],
    ["empty", 0],
  ])(
    "Given an upkeepByRankIndex that is %s, When validating it, Then it is rejected",
    (_label, length) => {
      // A short table makes the top of the ladder rent-free — the engine indexes
      // by rank index and reads `undefined` — which inverts the whole point of
      // upkeep rising with rank.
      expect(() =>
        parseModeRules(
          withBlock("economy", {
            upkeepByRankIndex: Array.from({ length }, () => 100),
          }),
        ),
      ).toThrow(ContractValidationError);
    },
  );

  it("Given a content pack with a different ladder length, When validating against it, Then the table must match that ladder instead", () => {
    const rules = withBlock("economy", {
      upkeepByRankIndex: [0, 10, 20],
    });

    expect(() => parseModeRules(rules)).toThrow(ContractValidationError);
    expect(
      parseModeRules(rules, { rankLadderLength: 3 }).economy.upkeepByRankIndex,
    ).toEqual([0, 10, 20]);
  });

  it.each([
    ["a negative charge", [0, -50, 100, 150, 200, 300, 400, 500, 650]],
    ["a fractional charge", [0, 50.5, 100, 150, 200, 300, 400, 500, 650]],
    ["a charge past the ceiling", [0, 50, 100, 150, 200, 300, 400, 500, 1e9]],
    ["a string charge", [0, "50", 100, 150, 200, 300, 400, 500, 650]],
    ["a null charge", [0, null, 100, 150, 200, 300, 400, 500, 650]],
  ])(
    "Given an upkeep table containing %s, When validating it, Then the whole ruleset is rejected",
    (_label, upkeepByRankIndex) => {
      // A negative upkeep is an income stream nobody voted for.
      expect(() => parseModeRules(withBlock("economy", { upkeepByRankIndex }))).toThrow(
        ContractValidationError,
      );
    },
  );

  it("Given a ruleset that switches direct messages on, When validating it, Then it is rejected", () => {
    // §8.1: the flag is an off switch, not a v1 feature. Accepting it would make
    // the server promise a private channel it has no moderation story for.
    expect(() => parseModeRules(withBlock("social", { directMessages: true }))).toThrow(
      ContractValidationError,
    );
  });

  it.each([
    ["an unknown win shape", "sudden-death"],
    ["a win shape that is not a string", 2],
  ])(
    "Given %s as the win shape, When validating it, Then it is rejected",
    (_label, winShape) => {
      expect(() => parseModeRules({ ...validRules(), winShape })).toThrow(
        ContractValidationError,
      );
    },
  );

  it.each([
    ["an unknown bankruptcy rule", "economy", { bankruptcy: "jail" }],
    ["an unknown leader protection", "conflict", { leaderProtection: "absolute" }],
    ["an unknown timeout behaviour", "timers", { onTimeout: "auto-win" }],
    ["an unknown chat mode", "social", { chat: "voice" }],
    ["an unknown bot pacing", "bots", { pacing: "glacial" }],
  ])(
    "Given %s, When validating it, Then it is rejected",
    (_label, block, override) => {
      expect(() =>
        parseModeRules(withBlock(block as keyof ModeRules, override)),
      ).toThrow(ContractValidationError);
    },
  );

  it("Given a zero-length chess clock, When validating it, Then it is rejected while null stays legal", () => {
    // `null` means "no chess clock". A zero-second one would hand every turn to
    // the timeout driver the moment it started, which is a different thing.
    expect(parseModeRules(withBlock("timers", { chessClockSeconds: null })).timers
      .chessClockSeconds).toBeNull();
    expect(() =>
      parseModeRules(withBlock("timers", { chessClockSeconds: 0 })),
    ).toThrow(ContractValidationError);
    expect(
      parseModeRules(
        withBlock("timers", {
          chessClockSeconds: MODE_RULES_BOUNDS.chessClockSeconds.minimum,
        }),
      ).timers.chessClockSeconds,
    ).toBe(MODE_RULES_BOUNDS.chessClockSeconds.minimum);
  });

  it.each([
    ["below the floor", MODE_RULES_BOUNDS.turnSeconds.minimum - 1],
    ["above the ceiling", MODE_RULES_BOUNDS.turnSeconds.maximum + 1],
    ["fractional", 30.5],
  ])(
    "Given a turn timer %s, When validating it, Then it is rejected",
    (_label, turnSeconds) => {
      expect(() => parseModeRules(withBlock("timers", { turnSeconds }))).toThrow(
        ContractValidationError,
      );
    },
  );

  it.each([
    ["the floor", MODE_RULES_BOUNDS.turnSeconds.minimum],
    ["the ceiling", MODE_RULES_BOUNDS.turnSeconds.maximum],
  ])(
    "Given a turn timer at %s, When validating it, Then it is accepted inclusively",
    (_label, turnSeconds) => {
      expect(parseModeRules(withBlock("timers", { turnSeconds })).timers.turnSeconds).toBe(
        turnSeconds,
      );
    },
  );

  it("Given a bot think range that runs backwards, When validating it, Then it is rejected", () => {
    expect(() => parseModeRules(withBlock("bots", { thinkMsRange: [2_000, 100] }))).toThrow(
      ContractValidationError,
    );
    expect(() => parseModeRules(withBlock("bots", { thinkMsRange: [100] }))).toThrow(
      ContractValidationError,
    );
    expect(() =>
      parseModeRules(withBlock("bots", { thinkMsRange: [100, 200, 300] })),
    ).toThrow(ContractValidationError);
    expect(() => parseModeRules(withBlock("bots", { thinkMsRange: [-1, 200] }))).toThrow(
      ContractValidationError,
    );
    // An equal pair is a fixed think time, which is legal.
    expect(
      parseModeRules(withBlock("bots", { thinkMsRange: [500, 500] })).bots.thinkMsRange,
    ).toEqual([500, 500]);
  });

  it.each([
    ["a fractional claim cost multiplier", "board", { claimCostMultiplier: 1.25 }, true],
    ["a fractional toll multiplier", "board", { tollMultiplier: 0.75 }, true],
    ["a negative claim cost multiplier", "board", { claimCostMultiplier: -1 }, false],
    ["a toll multiplier past the ceiling", "board", { tollMultiplier: 11 }, false],
    ["a non-finite multiplier", "board", { tollMultiplier: Number.NaN }, false],
    ["zero quarters", "quarters", { count: 0 }, false],
    ["thirteen quarters", "quarters", { count: 13 }, false],
    ["a zero-round quarter", "quarters", { roundsEach: 0 }, false],
    ["a zero heat threshold", "conflict", { heatThreshold: 0 }, false],
    ["a zero-second reaction window", "interaction", { reactionWindowSeconds: 0 }, false],
    ["six free actions per turn", "agency", { freeActionsPerTurn: 6 }, false],
    ["a project with no deadline", "projects", { deadlineRounds: 0 }, false],
  ])(
    "Given %s, When validating it, Then acceptance follows the documented bound",
    (_label, block, override, accepted) => {
      const rules = withBlock(block as keyof ModeRules, override as Record<string, unknown>);
      if (accepted) {
        expect(() => parseModeRules(rules)).not.toThrow();
        return;
      }
      expect(() => parseModeRules(rules)).toThrow(ContractValidationError);
    },
  );

  it.each([["a boolean field as a string", "quarters", { enabled: "true" }], ["a boolean field as a number", "hidden", { hiddenHands: 1 }]])(
    "Given %s, When validating it, Then it is rejected rather than coerced",
    (_label, block, override) => {
      expect(() =>
        parseModeRules(withBlock(block as keyof ModeRules, override)),
      ).toThrow(ContractValidationError);
    },
  );
});

describe("the set-mode-rules request", () => {
  it("Given a request wrapping a valid ruleset, When parsing it, Then the ruleset comes back", () => {
    expect(parseSetModeRulesRequest({ rules: validRules() }).rules).toEqual(validRules());
  });

  it.each([
    ["an unknown sibling field", { rules: validRules(), modeId: "mode.custom" }],
    ["no rules at all", {}],
    ["a ruleset that fails validation", { rules: { winShape: "race" } }],
  ])(
    "Given a set-mode-rules request with %s, When parsing it, Then it is rejected",
    (_label, body) => {
      expect(() => parseSetModeRulesRequest(body)).toThrow(ContractValidationError);
    },
  );

  it("Given a rank ladder override, When parsing the request, Then it reaches the ruleset validator", () => {
    const body = {
      rules: withBlock("economy", { upkeepByRankIndex: [0, 5] }),
    };

    expect(() => parseSetModeRulesRequest(body)).toThrow(ContractValidationError);
    expect(
      parseSetModeRulesRequest(body, { rankLadderLength: 2 }).rules.economy
        .upkeepByRankIndex,
    ).toEqual([0, 5]);
  });
});
