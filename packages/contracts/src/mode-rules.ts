import { CHAT_MODES, type ChatMode } from "./chat";
import {
  ContractValidationError,
  requireBoolean,
  requireBoundedInteger,
  requireBoundedNumber,
  requireEnum,
  requireExactKeys,
  requireObject,
} from "./validate";

/**
 * The mode ruleset, mirrored from `ModeConfig.rules` in
 * `packages/content/src/schema/modes.ts` (spec §4.1).
 *
 * **Why a structural copy rather than an import.** This package has no
 * dependency on `@office-ladder/content` and must not gain one: it is the layer
 * that validates values arriving from a browser, and a validator that imports the
 * thing it is validating against tends to end up trusting it. The copy is
 * deliberate and the same choice already made for `ROOM_MODES`. If the two
 * drift, the mismatch surfaces where it should — in the server, which assigns a
 * parsed `ModeRules` into `GameState.rules` and will not typecheck if a field
 * moved.
 */
export const WIN_SHAPES = ["race", "fixed-length", "objectives", "survival"] as const;
export const BANKRUPTCY_RULES = ["none", "demote", "eliminate"] as const;
export const LEADER_PROTECTIONS = ["none", "soft", "hard"] as const;
export const TIMEOUT_BEHAVIOURS = ["auto-roll", "auto-pass", "best-move"] as const;
export const BOT_PACINGS = ["instant", "paced"] as const;

export type WinShape = (typeof WIN_SHAPES)[number];
export type BankruptcyRule = (typeof BANKRUPTCY_RULES)[number];
export type LeaderProtection = (typeof LEADER_PROTECTIONS)[number];
export type TimeoutBehaviour = (typeof TIMEOUT_BEHAVIOURS)[number];
export type BotPacing = (typeof BOT_PACINGS)[number];

export type ModeRules = {
  readonly winShape: WinShape;

  readonly quarters: {
    readonly enabled: boolean;
    readonly count: number;
    readonly roundsEach: number;
    readonly globalEvents: boolean;
  };

  /** Which win paths score. At least one must be true. */
  readonly winPaths: {
    readonly promotion: boolean;
    readonly wealth: boolean;
    readonly influence: boolean;
    readonly survival: boolean;
  };

  readonly economy: {
    readonly upkeepEnabled: boolean;
    /** Charge per round, indexed by rank index. Length must equal the rank ladder. */
    readonly upkeepByRankIndex: readonly number[];
    readonly loansEnabled: boolean;
    readonly maxLoanPrincipal: number;
    readonly interestBasisPoints: number;
    readonly bankruptcy: BankruptcyRule;
    readonly incomeStreamsEnabled: boolean;
  };

  readonly board: {
    readonly ownershipEnabled: boolean;
    readonly claimCostMultiplier: number;
    readonly tollMultiplier: number;
    readonly upgradesEnabled: boolean;
    readonly placementsEnabled: boolean;
    readonly maxPlacementsPerPlayer: number;
  };

  readonly projects: {
    readonly enabled: boolean;
    readonly maxConcurrentPerPlayer: number;
    readonly joinable: boolean;
    readonly sabotageable: boolean;
    readonly deadlineRounds: number;
  };

  readonly conflict: {
    readonly targetedAttacks: boolean;
    readonly heatEnabled: boolean;
    readonly heatPerAttack: number;
    readonly heatThreshold: number;
    readonly defenceEnabled: boolean;
    readonly leaderProtection: LeaderProtection;
    readonly elimination: boolean;
  };

  readonly agency: {
    readonly promotionIsChoice: boolean;
    readonly promotionRaisesUpkeep: boolean;
    readonly diceAdjustEnabled: boolean;
    readonly energyPerPip: number;
    readonly maxPipAdjust: number;
    readonly freeActionsPerTurn: number;
    readonly handEnabled: boolean;
  };

  readonly interaction: {
    readonly reactionWindows: boolean;
    readonly reactionWindowSeconds: number;
    readonly votesEnabled: boolean;
    readonly auctionsEnabled: boolean;
    readonly tradesEnabled: boolean;
    /** Unenforceable promises are recorded in the agreement log for social pressure. */
    readonly promisesRecorded: boolean;
  };

  readonly hidden: {
    readonly rolesEnabled: boolean;
    readonly roleWinConditions: boolean;
    readonly secretObjectives: boolean;
    readonly hiddenHands: boolean;
  };

  readonly social: {
    readonly chat: ChatMode;
    readonly emoteReactions: boolean;
    readonly directMessages: boolean;
  };

  readonly timers: {
    readonly turnSeconds: number;
    readonly onTimeout: TimeoutBehaviour;
    readonly chessClockSeconds: number | null;
  };

  readonly bots: {
    readonly pacing: BotPacing;
    readonly thinkMsRange: readonly [number, number];
    readonly canNegotiate: boolean;
  };
};

/**
 * The number of ranks in the Deadline Dash ladder, which is what
 * `economy.upkeepByRankIndex` has to have one entry per (spec §8.4).
 *
 * Mirrored from `packages/content/src/deadline-dash/ranks.ts` for the same reason
 * {@link ModeRules} is: no content dependency here. {@link parseModeRules} takes
 * an override so a caller that *does* have the content pack can pass the real
 * length and make the mirror irrelevant, and so a second content pack with a
 * different ladder is not silently validated against this one.
 */
export const DEADLINE_DASH_RANK_LADDER_LENGTH = 9;

/**
 * Every bound the custom-mode validator enforces, in one table.
 *
 * Exported because these numbers *are* the contract: the lobby needs them to
 * render sliders that cannot author an invalid ruleset, and the tests need them
 * to prove each boundary is inclusive on the value the table names. A bound
 * written inline in a parser is a bound nothing else can agree with.
 *
 * Every ceiling is a "no sane game needs more than this" number, not a limit of
 * the mechanic. The point is that an *unbounded* value is a cheat — a
 * `maxPipAdjust` of 12 lets a player choose their roll outright, an
 * `interestBasisPoints` of -5000 turns a loan into a grant, a `turnSeconds` of
 * 0.0001 hands every turn to the timeout driver.
 */
export const MODE_RULES_BOUNDS = {
  quarterCount: { minimum: 1, maximum: 12 },
  quarterRoundsEach: { minimum: 1, maximum: 50 },
  upkeepPerRound: { minimum: 0, maximum: 100_000 },
  maxLoanPrincipal: { minimum: 0, maximum: 1_000_000 },
  interestBasisPoints: { minimum: 0, maximum: 10_000 },
  claimCostMultiplier: { minimum: 0, maximum: 10 },
  tollMultiplier: { minimum: 0, maximum: 10 },
  maxPlacementsPerPlayer: { minimum: 0, maximum: 20 },
  maxConcurrentProjectsPerPlayer: { minimum: 0, maximum: 10 },
  projectDeadlineRounds: { minimum: 1, maximum: 50 },
  heatPerAttack: { minimum: 0, maximum: 100 },
  heatThreshold: { minimum: 1, maximum: 1_000 },
  energyPerPip: { minimum: 0, maximum: 10 },
  /**
   * Six pips: a whole die's worth of correction. Beyond that a player is not
   * shading a roll, they are selecting a destination, and dice stop being a
   * source of variance at all.
   */
  maxPipAdjust: { minimum: 0, maximum: 6 },
  freeActionsPerTurn: { minimum: 0, maximum: 5 },
  reactionWindowSeconds: { minimum: 1, maximum: 120 },
  turnSeconds: { minimum: 5, maximum: 600 },
  chessClockSeconds: { minimum: 30, maximum: 7_200 },
  botThinkMs: { minimum: 0, maximum: 60_000 },
} as const;

export type ModeRulesValidationOptions = {
  /**
   * How many ranks the ladder this ruleset will be played on has. Defaults to
   * {@link DEADLINE_DASH_RANK_LADDER_LENGTH}.
   */
  readonly rankLadderLength?: number;
};

function boundedInteger(
  value: unknown,
  path: string,
  bounds: { readonly minimum: number; readonly maximum: number },
): number {
  return requireBoundedInteger(value, path, bounds.minimum, bounds.maximum);
}

function boundedNumber(
  value: unknown,
  path: string,
  bounds: { readonly minimum: number; readonly maximum: number },
): number {
  return requireBoundedNumber(value, path, bounds.minimum, bounds.maximum);
}

function parseQuarters(value: unknown): ModeRules["quarters"] {
  const input = requireObject(value, "rules.quarters");
  requireExactKeys(
    input,
    ["enabled", "count", "roundsEach", "globalEvents"],
    "rules.quarters",
  );

  return {
    enabled: requireBoolean(input["enabled"], "rules.quarters.enabled"),
    count: boundedInteger(
      input["count"],
      "rules.quarters.count",
      MODE_RULES_BOUNDS.quarterCount,
    ),
    roundsEach: boundedInteger(
      input["roundsEach"],
      "rules.quarters.roundsEach",
      MODE_RULES_BOUNDS.quarterRoundsEach,
    ),
    globalEvents: requireBoolean(
      input["globalEvents"],
      "rules.quarters.globalEvents",
    ),
  };
}

function parseWinPaths(value: unknown): ModeRules["winPaths"] {
  const input = requireObject(value, "rules.winPaths");
  requireExactKeys(
    input,
    ["promotion", "wealth", "influence", "survival"],
    "rules.winPaths",
  );

  const winPaths = {
    promotion: requireBoolean(input["promotion"], "rules.winPaths.promotion"),
    wealth: requireBoolean(input["wealth"], "rules.winPaths.wealth"),
    influence: requireBoolean(input["influence"], "rules.winPaths.influence"),
    survival: requireBoolean(input["survival"], "rules.winPaths.survival"),
  };

  // An all-false winPaths is not a stalemate, it is an unwinnable match: every
  // scoring path is switched off, so the game runs to its end condition and
  // nobody can ever be the winner. Refused here rather than discovered by six
  // players an hour in.
  if (
    !winPaths.promotion &&
    !winPaths.wealth &&
    !winPaths.influence &&
    !winPaths.survival
  ) {
    throw new ContractValidationError(
      "rules.winPaths",
      "must enable at least one win path",
    );
  }

  return winPaths;
}

function parseUpkeepByRankIndex(
  value: unknown,
  rankLadderLength: number,
): readonly number[] {
  if (!Array.isArray(value)) {
    throw new ContractValidationError(
      "rules.economy.upkeepByRankIndex",
      "must be an array",
    );
  }
  // Length equality, not "at least": the engine indexes this table by the
  // player's rank index. A short table makes the top ranks read `undefined` and
  // pay nothing — a promotion that *removes* an obligation — and a long one hides
  // charges nobody can see in the lobby.
  if (value.length !== rankLadderLength) {
    throw new ContractValidationError(
      "rules.economy.upkeepByRankIndex",
      `must have exactly ${String(rankLadderLength)} entries, one per rank`,
    );
  }

  return value.map((entry, index) =>
    boundedInteger(
      entry,
      `rules.economy.upkeepByRankIndex[${String(index)}]`,
      MODE_RULES_BOUNDS.upkeepPerRound,
    ),
  );
}

function parseEconomy(value: unknown, rankLadderLength: number): ModeRules["economy"] {
  const input = requireObject(value, "rules.economy");
  requireExactKeys(
    input,
    [
      "upkeepEnabled",
      "upkeepByRankIndex",
      "loansEnabled",
      "maxLoanPrincipal",
      "interestBasisPoints",
      "bankruptcy",
      "incomeStreamsEnabled",
    ],
    "rules.economy",
  );

  return {
    upkeepEnabled: requireBoolean(
      input["upkeepEnabled"],
      "rules.economy.upkeepEnabled",
    ),
    upkeepByRankIndex: parseUpkeepByRankIndex(
      input["upkeepByRankIndex"],
      rankLadderLength,
    ),
    loansEnabled: requireBoolean(input["loansEnabled"], "rules.economy.loansEnabled"),
    maxLoanPrincipal: boundedInteger(
      input["maxLoanPrincipal"],
      "rules.economy.maxLoanPrincipal",
      MODE_RULES_BOUNDS.maxLoanPrincipal,
    ),
    interestBasisPoints: boundedInteger(
      input["interestBasisPoints"],
      "rules.economy.interestBasisPoints",
      MODE_RULES_BOUNDS.interestBasisPoints,
    ),
    bankruptcy: requireEnum(
      input["bankruptcy"],
      BANKRUPTCY_RULES,
      "rules.economy.bankruptcy",
      "a supported bankruptcy rule",
    ),
    incomeStreamsEnabled: requireBoolean(
      input["incomeStreamsEnabled"],
      "rules.economy.incomeStreamsEnabled",
    ),
  };
}

function parseBoard(value: unknown): ModeRules["board"] {
  const input = requireObject(value, "rules.board");
  requireExactKeys(
    input,
    [
      "ownershipEnabled",
      "claimCostMultiplier",
      "tollMultiplier",
      "upgradesEnabled",
      "placementsEnabled",
      "maxPlacementsPerPlayer",
    ],
    "rules.board",
  );

  return {
    ownershipEnabled: requireBoolean(
      input["ownershipEnabled"],
      "rules.board.ownershipEnabled",
    ),
    claimCostMultiplier: boundedNumber(
      input["claimCostMultiplier"],
      "rules.board.claimCostMultiplier",
      MODE_RULES_BOUNDS.claimCostMultiplier,
    ),
    tollMultiplier: boundedNumber(
      input["tollMultiplier"],
      "rules.board.tollMultiplier",
      MODE_RULES_BOUNDS.tollMultiplier,
    ),
    upgradesEnabled: requireBoolean(
      input["upgradesEnabled"],
      "rules.board.upgradesEnabled",
    ),
    placementsEnabled: requireBoolean(
      input["placementsEnabled"],
      "rules.board.placementsEnabled",
    ),
    maxPlacementsPerPlayer: boundedInteger(
      input["maxPlacementsPerPlayer"],
      "rules.board.maxPlacementsPerPlayer",
      MODE_RULES_BOUNDS.maxPlacementsPerPlayer,
    ),
  };
}

function parseProjects(value: unknown): ModeRules["projects"] {
  const input = requireObject(value, "rules.projects");
  requireExactKeys(
    input,
    ["enabled", "maxConcurrentPerPlayer", "joinable", "sabotageable", "deadlineRounds"],
    "rules.projects",
  );

  return {
    enabled: requireBoolean(input["enabled"], "rules.projects.enabled"),
    maxConcurrentPerPlayer: boundedInteger(
      input["maxConcurrentPerPlayer"],
      "rules.projects.maxConcurrentPerPlayer",
      MODE_RULES_BOUNDS.maxConcurrentProjectsPerPlayer,
    ),
    joinable: requireBoolean(input["joinable"], "rules.projects.joinable"),
    sabotageable: requireBoolean(
      input["sabotageable"],
      "rules.projects.sabotageable",
    ),
    deadlineRounds: boundedInteger(
      input["deadlineRounds"],
      "rules.projects.deadlineRounds",
      MODE_RULES_BOUNDS.projectDeadlineRounds,
    ),
  };
}

function parseConflict(value: unknown): ModeRules["conflict"] {
  const input = requireObject(value, "rules.conflict");
  requireExactKeys(
    input,
    [
      "targetedAttacks",
      "heatEnabled",
      "heatPerAttack",
      "heatThreshold",
      "defenceEnabled",
      "leaderProtection",
      "elimination",
    ],
    "rules.conflict",
  );

  return {
    targetedAttacks: requireBoolean(
      input["targetedAttacks"],
      "rules.conflict.targetedAttacks",
    ),
    heatEnabled: requireBoolean(input["heatEnabled"], "rules.conflict.heatEnabled"),
    heatPerAttack: boundedInteger(
      input["heatPerAttack"],
      "rules.conflict.heatPerAttack",
      MODE_RULES_BOUNDS.heatPerAttack,
    ),
    heatThreshold: boundedInteger(
      input["heatThreshold"],
      "rules.conflict.heatThreshold",
      MODE_RULES_BOUNDS.heatThreshold,
    ),
    defenceEnabled: requireBoolean(
      input["defenceEnabled"],
      "rules.conflict.defenceEnabled",
    ),
    leaderProtection: requireEnum(
      input["leaderProtection"],
      LEADER_PROTECTIONS,
      "rules.conflict.leaderProtection",
      "a supported leader protection",
    ),
    elimination: requireBoolean(input["elimination"], "rules.conflict.elimination"),
  };
}

function parseAgency(value: unknown): ModeRules["agency"] {
  const input = requireObject(value, "rules.agency");
  requireExactKeys(
    input,
    [
      "promotionIsChoice",
      "promotionRaisesUpkeep",
      "diceAdjustEnabled",
      "energyPerPip",
      "maxPipAdjust",
      "freeActionsPerTurn",
      "handEnabled",
    ],
    "rules.agency",
  );

  return {
    promotionIsChoice: requireBoolean(
      input["promotionIsChoice"],
      "rules.agency.promotionIsChoice",
    ),
    promotionRaisesUpkeep: requireBoolean(
      input["promotionRaisesUpkeep"],
      "rules.agency.promotionRaisesUpkeep",
    ),
    diceAdjustEnabled: requireBoolean(
      input["diceAdjustEnabled"],
      "rules.agency.diceAdjustEnabled",
    ),
    energyPerPip: boundedInteger(
      input["energyPerPip"],
      "rules.agency.energyPerPip",
      MODE_RULES_BOUNDS.energyPerPip,
    ),
    maxPipAdjust: boundedInteger(
      input["maxPipAdjust"],
      "rules.agency.maxPipAdjust",
      MODE_RULES_BOUNDS.maxPipAdjust,
    ),
    freeActionsPerTurn: boundedInteger(
      input["freeActionsPerTurn"],
      "rules.agency.freeActionsPerTurn",
      MODE_RULES_BOUNDS.freeActionsPerTurn,
    ),
    handEnabled: requireBoolean(input["handEnabled"], "rules.agency.handEnabled"),
  };
}

function parseInteraction(value: unknown): ModeRules["interaction"] {
  const input = requireObject(value, "rules.interaction");
  requireExactKeys(
    input,
    [
      "reactionWindows",
      "reactionWindowSeconds",
      "votesEnabled",
      "auctionsEnabled",
      "tradesEnabled",
      "promisesRecorded",
    ],
    "rules.interaction",
  );

  return {
    reactionWindows: requireBoolean(
      input["reactionWindows"],
      "rules.interaction.reactionWindows",
    ),
    reactionWindowSeconds: boundedInteger(
      input["reactionWindowSeconds"],
      "rules.interaction.reactionWindowSeconds",
      MODE_RULES_BOUNDS.reactionWindowSeconds,
    ),
    votesEnabled: requireBoolean(
      input["votesEnabled"],
      "rules.interaction.votesEnabled",
    ),
    auctionsEnabled: requireBoolean(
      input["auctionsEnabled"],
      "rules.interaction.auctionsEnabled",
    ),
    tradesEnabled: requireBoolean(
      input["tradesEnabled"],
      "rules.interaction.tradesEnabled",
    ),
    promisesRecorded: requireBoolean(
      input["promisesRecorded"],
      "rules.interaction.promisesRecorded",
    ),
  };
}

function parseHidden(value: unknown): ModeRules["hidden"] {
  const input = requireObject(value, "rules.hidden");
  requireExactKeys(
    input,
    ["rolesEnabled", "roleWinConditions", "secretObjectives", "hiddenHands"],
    "rules.hidden",
  );

  return {
    rolesEnabled: requireBoolean(input["rolesEnabled"], "rules.hidden.rolesEnabled"),
    roleWinConditions: requireBoolean(
      input["roleWinConditions"],
      "rules.hidden.roleWinConditions",
    ),
    secretObjectives: requireBoolean(
      input["secretObjectives"],
      "rules.hidden.secretObjectives",
    ),
    hiddenHands: requireBoolean(input["hiddenHands"], "rules.hidden.hiddenHands"),
  };
}

function parseSocial(value: unknown): ModeRules["social"] {
  const input = requireObject(value, "rules.social");
  requireExactKeys(input, ["chat", "emoteReactions", "directMessages"], "rules.social");

  const directMessages = requireBoolean(
    input["directMessages"],
    "rules.social.directMessages",
  );
  // §8.1: "No DMs in v1. `social.directMessages` exists in the config as an off
  // switch, not as a v1 feature." A client-authored ruleset that switches it on
  // would be asking the server for a private channel it has no moderation story
  // for, so the request is refused rather than accepted-and-ignored.
  if (directMessages) {
    throw new ContractValidationError(
      "rules.social.directMessages",
      "must be false: direct messages are not available",
    );
  }

  return {
    chat: requireEnum(
      input["chat"],
      CHAT_MODES,
      "rules.social.chat",
      "a supported chat mode",
    ),
    emoteReactions: requireBoolean(
      input["emoteReactions"],
      "rules.social.emoteReactions",
    ),
    directMessages,
  };
}

function parseTimers(value: unknown): ModeRules["timers"] {
  const input = requireObject(value, "rules.timers");
  requireExactKeys(input, ["turnSeconds", "onTimeout", "chessClockSeconds"], "rules.timers");

  const chessClockSeconds = input["chessClockSeconds"];

  return {
    turnSeconds: boundedInteger(
      input["turnSeconds"],
      "rules.timers.turnSeconds",
      MODE_RULES_BOUNDS.turnSeconds,
    ),
    onTimeout: requireEnum(
      input["onTimeout"],
      TIMEOUT_BEHAVIOURS,
      "rules.timers.onTimeout",
      "a supported timeout behaviour",
    ),
    // `null` is "no chess clock", which is a different fact from "a zero-length
    // one" — the latter would hand every turn straight to the timeout driver.
    chessClockSeconds:
      chessClockSeconds === null
        ? null
        : boundedInteger(
            chessClockSeconds,
            "rules.timers.chessClockSeconds",
            MODE_RULES_BOUNDS.chessClockSeconds,
          ),
  };
}

function parseBots(value: unknown): ModeRules["bots"] {
  const input = requireObject(value, "rules.bots");
  requireExactKeys(input, ["pacing", "thinkMsRange", "canNegotiate"], "rules.bots");

  const range = input["thinkMsRange"];
  if (!Array.isArray(range) || range.length !== 2) {
    throw new ContractValidationError(
      "rules.bots.thinkMsRange",
      "must be a pair of milliseconds",
    );
  }
  const lower = boundedInteger(
    range[0],
    "rules.bots.thinkMsRange[0]",
    MODE_RULES_BOUNDS.botThinkMs,
  );
  const upper = boundedInteger(
    range[1],
    "rules.bots.thinkMsRange[1]",
    MODE_RULES_BOUNDS.botThinkMs,
  );
  if (lower > upper) {
    throw new ContractValidationError(
      "rules.bots.thinkMsRange",
      "must be ordered from low to high",
    );
  }

  return {
    pacing: requireEnum(
      input["pacing"],
      BOT_PACINGS,
      "rules.bots.pacing",
      "a supported bot pacing",
    ),
    thinkMsRange: [lower, upper],
    canNegotiate: requireBoolean(input["canNegotiate"], "rules.bots.canNegotiate"),
  };
}

/**
 * Validates a client-authored `ModeRules` object (spec §8.4).
 *
 * A lobby can compose its own ruleset, which means an attacker can compose one
 * too, and every field of it is a lever on the match: `maxPipAdjust: 12` selects
 * the roll, `interestBasisPoints: -10000` makes a loan a gift, a short
 * `upkeepByRankIndex` makes the top of the ladder rent-free, an all-false
 * `winPaths` makes the match unwinnable.
 *
 * So: every field must be present (`requireExactKeys` at every level, no
 * defaulting — an omitted field is a field the author did not agree to), every
 * numeric is bounded on both sides by {@link MODE_RULES_BOUNDS}, and the whole
 * object is rejected on the first failure. There is no partial acceptance and no
 * clamping: what comes back is either a ruleset every player can be shown before
 * they sit down, or a `ContractValidationError`.
 *
 * The returned object is freshly built field by field, so nothing the caller sent
 * that this function did not read can survive into `GameState.rules`.
 */
export function parseModeRules(
  value: unknown,
  options: ModeRulesValidationOptions = {},
): ModeRules {
  const rankLadderLength = options.rankLadderLength ?? DEADLINE_DASH_RANK_LADDER_LENGTH;
  const input = requireObject(value, "rules");
  requireExactKeys(
    input,
    [
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
    ],
    "rules",
  );

  return {
    winShape: requireEnum(
      input["winShape"],
      WIN_SHAPES,
      "rules.winShape",
      "a supported win shape",
    ),
    quarters: parseQuarters(input["quarters"]),
    winPaths: parseWinPaths(input["winPaths"]),
    economy: parseEconomy(input["economy"], rankLadderLength),
    board: parseBoard(input["board"]),
    projects: parseProjects(input["projects"]),
    conflict: parseConflict(input["conflict"]),
    agency: parseAgency(input["agency"]),
    interaction: parseInteraction(input["interaction"]),
    hidden: parseHidden(input["hidden"]),
    social: parseSocial(input["social"]),
    timers: parseTimers(input["timers"]),
    bots: parseBots(input["bots"]),
  };
}

/**
 * The lobby's "use these rules" request. Kept separate from create-room so a host
 * can author a ruleset for a room that already exists, and so adopting custom
 * modes does not require a second version of the create-room body.
 */
export type SetModeRulesRequest = {
  readonly rules: ModeRules;
};

export function parseSetModeRulesRequest(
  value: unknown,
  options: ModeRulesValidationOptions = {},
): SetModeRulesRequest {
  const input = requireObject(value, "setModeRules");
  requireExactKeys(input, ["rules"], "setModeRules");

  return { rules: parseModeRules(input["rules"], options) };
}
