import type { ModeRules } from "../../src/mode-rules";

/**
 * A ruleset the validator accepts, close to the shipped `mode.standard` preset.
 *
 * Shared by the mode-rules tests and the create-room tests so both prove the same
 * validator against the same object: a custom ruleset arriving on a create body
 * has to be exactly as hostile-input-hardened as one arriving on the lobby's own
 * set-rules endpoint, and a second, subtly different fixture is how that stops
 * being true.
 *
 * A fresh object every call, deliberately: every negative case below is this
 * object with one field changed, so a case can only fail for the reason it names
 * — and a shared frozen constant would let one test's override leak into the
 * next.
 */
export function validRules(): ModeRules {
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
export function withBlock<Key extends keyof ModeRules>(
  key: Key,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const base = validRules();
  return { ...base, [key]: { ...(base[key] as object), ...overrides } };
}
