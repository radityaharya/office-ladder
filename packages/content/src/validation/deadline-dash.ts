import {
  deadlineDashBoard,
  deadlineDashCharacters,
  deadlineDashDecks,
  deadlineDashGlobalEventOrder,
  deadlineDashGlobalEvents,
  deadlineDashModes,
  deadlineDashRanks,
} from "../deadline-dash";
import type {
  BoardConfig,
  CharacterConfig,
  DeckConfig,
  GlobalEventConfig,
  ModeConfig,
  RankConfig,
} from "../schema";

const BOARD_SIZE = 44;
const SIDE_SIZE = 10;

const cornerExpectations = [
  [0, "bottom-right", "receptionist"],
  [11, "bottom-left", "board-meeting"],
  [22, "top-left", "audit"],
  [33, "top-right", "annual-event"],
] as const;

const sideExpectations = [
  ["bottom", 1, 10],
  ["left", 12, 21],
  ["top", 23, 32],
  ["right", 34, 43],
] as const;

const expectedKinds = {
  receptionist: 1,
  "board-meeting": 1,
  audit: 1,
  "annual-event": 1,
  training: 1,
  work: 14,
  networking: 3,
  hr: 1,
  meeting: 4,
  "energy-restore": 4,
  finance: 1,
  it: 1,
  event: 3,
  marketing: 1,
  legal: 1,
  operation: 1,
  "best-employee": 1,
  sales: 1,
  "ceo-favorite": 1,
  "ceo-office": 1,
  burnout: 1,
} as const;

const expectedModes = {
  "mode.quick": {
    targetDurationMinutes: [20, 30],
    turnTimerSeconds: 20,
    startingResources: {
      money: 1000,
      reputation: 0,
      energy: 8,
      energyMaximum: 8,
      workCounter: 0,
    },
    startingTokens: { move: 1 },
    handLimit: 1,
    tokenCaps: { move: 3, momentum: 3, reputation: 2, money: 2 },
    deckQuantities: {
      "deck.work": 25,
      "deck.meeting": 15,
      "deck.event": 15,
      "deck.networking": 24,
      "deck.board-meeting": 13,
      "deck.annual-event": 13,
    },
    clockQuantities: { meeting: 15, event: 15, total: 30 },
    endgame: { type: "immediate" },
  },
  "mode.standard": {
    targetDurationMinutes: [40, 60],
    turnTimerSeconds: 25,
    startingResources: {
      money: 1200,
      reputation: 0,
      energy: 8,
      energyMaximum: 8,
      workCounter: 0,
    },
    startingTokens: { move: 1 },
    handLimit: 2,
    tokenCaps: { move: 4, momentum: 4, reputation: 3, money: 3 },
    deckQuantities: {
      "deck.work": 38,
      "deck.meeting": 22,
      "deck.event": 22,
      "deck.networking": 36,
      "deck.board-meeting": 19,
      "deck.annual-event": 19,
    },
    clockQuantities: { meeting: 22, event: 22, total: 44 },
    endgame: {
      type: "additional-rounds",
      rounds: 3,
      clockExhaustionStillEndsMatch: true,
      scoring: {
        rankTierPoints: 1000,
        moneyMultiplier: 0.1,
        reputationPoints: 50,
      },
    },
  },
  "mode.marathon": {
    targetDurationMinutes: [60, 120],
    turnTimerSeconds: 30,
    startingResources: {
      money: 1500,
      reputation: 0,
      energy: 8,
      energyMaximum: 8,
      workCounter: 0,
    },
    startingTokens: { move: 1 },
    handLimit: 3,
    tokenCaps: { move: 5, momentum: 5, reputation: 3, money: 4 },
    deckQuantities: {
      "deck.work": 50,
      "deck.meeting": 30,
      "deck.event": 30,
      "deck.networking": 47,
      "deck.board-meeting": 23,
      "deck.annual-event": 24,
    },
    clockQuantities: { meeting: 30, event: 30, total: 60 },
    endgame: {
      type: "additional-rounds",
      rounds: 3,
      clockExhaustionStillEndsMatch: true,
      scoring: {
        rankTierPoints: 1000,
        moneyMultiplier: 0.1,
        reputationPoints: 50,
      },
    },
  },
  "mode.campaign": {
    targetDurationMinutes: [120, 240],
    turnTimerSeconds: 45,
    startingResources: {
      money: 2000,
      reputation: 0,
      energy: 8,
      energyMaximum: 8,
      workCounter: 0,
    },
    startingTokens: { move: 1, momentum: 1 },
    handLimit: 4,
    tokenCaps: { move: 6, momentum: 6, reputation: 4, money: 5 },
    deckQuantities: {
      "deck.work": 55,
      "deck.meeting": 38,
      "deck.event": 38,
      "deck.networking": 49,
      "deck.board-meeting": 23,
      "deck.annual-event": 24,
    },
    clockQuantities: { meeting: 38, event: 38, total: 76 },
    endgame: {
      type: "additional-rounds",
      rounds: 3,
      clockExhaustionStillEndsMatch: true,
      scoring: {
        rankTierPoints: 1000,
        moneyMultiplier: 0.1,
        reputationPoints: 50,
      },
    },
  },
} as const;

const expectedRanks = [
  { id: "rank.intern", salary: 200, promotion: null, benefits: [] },
  {
    id: "rank.staff",
    salary: 400,
    promotion: {
      quick: 250,
      standard: 500,
      marathon: 500,
      campaign: 625,
      reputation: 3,
    },
    benefits: [{ type: "salaryBonusOnReceptionistPass", amount: 100 }],
  },
  {
    id: "rank.senior-staff",
    salary: 600,
    promotion: {
      quick: 600,
      standard: 1200,
      marathon: 1200,
      campaign: 1500,
      reputation: 5,
    },
    benefits: [
      {
        type: "extraWorkMilestoneReward",
        milestone: 5,
        effects: [{ type: "modifyResource", resource: "reputation", amount: 1 }],
      },
    ],
  },
  {
    id: "rank.supervisor",
    salary: 800,
    promotion: {
      quick: 1000,
      standard: 2000,
      marathon: 2000,
      campaign: 2500,
      reputation: 8,
    },
    benefits: [{ type: "increaseMaximumEnergy", amount: 2 }],
  },
  {
    id: "rank.assistant-manager",
    salary: 1000,
    promotion: {
      quick: 1500,
      standard: 3000,
      marathon: 3000,
      campaign: 3750,
      reputation: 12,
    },
    benefits: [{ type: "rerollNormalMovement", usesPerLap: 1 }],
  },
  {
    id: "rank.manager",
    salary: 1200,
    promotion: {
      quick: 2250,
      standard: 4500,
      marathon: 4500,
      campaign: 5625,
      reputation: 18,
    },
    benefits: [
      {
        type: "meetingLandingBonus",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 1 }],
      },
    ],
  },
  {
    id: "rank.senior-manager",
    salary: 1400,
    promotion: {
      quick: 3000,
      standard: 6000,
      marathon: 6000,
      campaign: 7500,
      reputation: 27,
    },
    benefits: [{ type: "multiplyAnnualEventReward", multiplier: 2 }],
  },
  {
    id: "rank.general-manager",
    salary: 1600,
    promotion: {
      quick: 4000,
      standard: 8000,
      marathon: 8000,
      campaign: 10000,
      reputation: 40,
    },
    benefits: [
      { type: "ignoreNegativeEffect", usesPerLap: 1, sources: ["tile", "card"] },
    ],
  },
  {
    id: "rank.director",
    salary: 2000,
    promotion: {
      quick: 5000,
      standard: 10000,
      marathon: 10000,
      campaign: 12500,
      reputation: 58,
    },
    benefits: [{ type: "directorOutcome" }],
  },
] as const;

const expectedCharacters = [
  ["character.workaholic", "workLandingMoneyBonus", "laps", 2, "payToRestoreEnergy"],
  [
    "character.social-butterfly",
    "meetingLandingReputationBonus",
    "laps",
    3,
    "swapBoardPositions",
  ],
  ["character.sales-star", "salaryMultiplier", "laps", 3, "nextSalaryMultiplier"],
  ["character.tech-genius", "ignoreNegativeEffect", "laps", 3, "teleport"],
  [
    "character.office-politician",
    "modifyPromotionRequirement",
    "laps",
    3,
    "stealResource",
  ],
  ["character.lucky-employee", "doublesMoneyBonus", "turns", 5, "rerollDice"],
] as const;

const expectedDeckIds = [
  "deck.work",
  "deck.meeting",
  "deck.event",
  "deck.networking",
  "deck.board-meeting",
  "deck.annual-event",
] as const;

const validDeckIds = new Set<string>(expectedDeckIds);

/** Mirrors `ResourceId`. */
const RESOURCE_IDS: readonly string[] = ["money", "reputation", "energy"];

/** Mirrors `EffectTarget` in `src/schema/effects.ts`. */
const VALID_EFFECT_TARGETS = new Set<string>([
  "self",
  "active-player",
  "chosen-opponent",
  "all-opponents",
  "all-players",
  "left-neighbour",
  "right-neighbour",
  "highest-rank",
  "lowest-rank",
  "richest",
  "poorest",
]);

/** Mirrors `EffectScaleMetric`. */
const VALID_SCALE_METRICS = new Set<string>([
  "rank-tier",
  "board-position",
  "laps",
  "heat",
  "debt",
  "work-counter",
  "opponent-count",
]);

const VALID_CONDITION_SUBJECTS = new Set<string>(["actor", "target"]);
const VALID_CONDITION_RESOURCES = new Set<string>([...RESOURCE_IDS, "work-counter"]);

/**
 * Mirrors `StatusId` in `src/schema/ids.ts`. The first six are the tile-authored
 * statuses the engine already consumes; the rest are the card vocabulary's, per
 * the re-cut plan's §11.2. An id here with no engine consumer validates,
 * persists, and does nothing — see the docstring on `StatusId`.
 */
const validStatusIds = new Set([
  "status.audit",
  "status.burnout-tile",
  "status.ignore-next-work-energy",
  "status.skip-next-tile-effect",
  "status.next-roll-extra-movement",
  "status.next-salary-multiplier",
  "status.next-work-card-money-multiplier",
  "status.next-work-card-reputation-multiplier",
  "status.next-promotion-reputation-discount",
  "status.cancel-next-money-loss",
  "status.skip-next-networking-reward",
  "status.next-work-extra-energy",
  "status.ignore-next-meeting-energy",
]);

const expectedGlobalEventIds = [
  "globalEvent.audit-season",
  "globalEvent.layoffs",
  "globalEvent.budget-freeze",
  "globalEvent.reorg",
  "globalEvent.merger-rumour",
  "globalEvent.bonus-season",
] as const;

const validGlobalEventScopes = [
  "all-players",
  "leader",
  "trailing-players",
  "players-with-heat",
  "players-in-debt",
] as const;

/**
 * Shape of every `GlobalEventModifier` variant, keyed by `type`: the extra
 * numeric/enum payload each one carries. An empty spec means the discriminant is
 * the whole modifier.
 */
const globalEventModifierShapes = {
  blockPromotions: {},
  blockLoans: {},
  blockTileClaims: {},
  suspendUpkeep: {},
  multiplySalary: { multiplier: "non-negative-number" },
  multiplyProjectPayout: { multiplier: "non-negative-number" },
  // Signed on purpose: a negative delta tightens scrutiny.
  adjustHeatThreshold: { delta: "signed-number" },
  demoteLowest: { resource: "money-or-reputation" },
} as const satisfies Readonly<Record<string, Readonly<Record<string, string>>>>;

export type DeadlineDashValidationIssueCode =
  | "board.count"
  | "board.index"
  | "board.duplicate-id"
  | "board.corner"
  | "board.side-count"
  | "board.side-traversal"
  | "board.kind-count"
  | "board.expected-count"
  | "board.effect-shape"
  | "board.effect-deck-id"
  | "board.effect-status-id"
  | "board.effect-dice"
  | "board.effect-outcome"
  | "board.effect-target"
  | "board.effect-condition"
  | "board.decision-shape"
  | "deck.count"
  | "deck.duplicate-id"
  | "deck.id"
  | "deck.empty"
  | "deck.card-duplicate-id"
  | "deck.card-id"
  | "deck.card-name-key"
  | "deck.card-effects"
  | "mode.ids"
  | "mode.id"
  | "mode.resource"
  | "mode.starting-token"
  | "mode.hand-limit"
  | "mode.target-duration"
  | "mode.endgame"
  | "mode.timer"
  | "mode.token-cap"
  | "mode.deck-quantity"
  | "mode.deck-quantity-exceeds-deck"
  | "mode.clock-deck-ids"
  | "mode.clock-quantity"
  | "mode.clock-total"
  | "mode.clock-provisional"
  | "mode.rules-shape"
  | "mode.rules-enum"
  | "mode.rules-number"
  | "mode.rules-upkeep-length"
  | "mode.rules-win-paths"
  | "mode.rules-quarters"
  | "mode.rules-turn-seconds"
  | "mode.rules-direct-messages"
  | "globalEvent.ids"
  | "globalEvent.id"
  | "globalEvent.name-key"
  | "globalEvent.scope"
  | "globalEvent.empty"
  | "globalEvent.modifier"
  | "globalEvent.announcement"
  | "globalEvent.order"
  | "rank.count"
  | "rank.order"
  | "rank.tier"
  | "rank.salary"
  | "rank.requirement"
  | "rank.benefits"
  | "character.count"
  | "character.order"
  | "character.duplicate-id"
  | "character.id"
  | "character.passive"
  | "character.active"
  | "character.cooldown";

export type DeadlineDashValidationIssue = {
  readonly code: DeadlineDashValidationIssueCode;
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
  readonly message: string;
};

export type DeadlineDashValidationResult = {
  readonly valid: boolean;
  readonly issues: readonly DeadlineDashValidationIssue[];
};

export type DeadlineDashContentValidationInput = {
  readonly board: Pick<BoardConfig, "spaces" | "expectedCounts">;
  readonly modes: Readonly<Record<string, ModeConfig>>;
  readonly ranks: readonly RankConfig[];
  readonly characters: Readonly<Record<string, CharacterConfig>>;
  readonly decks: readonly DeckConfig[];
  readonly globalEvents: Readonly<Record<string, GlobalEventConfig>>;
  readonly globalEventOrder: readonly string[];
};

const canonicalContent: DeadlineDashContentValidationInput = {
  board: deadlineDashBoard,
  modes: deadlineDashModes,
  ranks: deadlineDashRanks,
  characters: deadlineDashCharacters,
  decks: deadlineDashDecks,
  globalEvents: deadlineDashGlobalEvents,
  globalEventOrder: deadlineDashGlobalEventOrder,
};

function formatValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

export function formatDeadlineDashValidationIssue(
  issue: Pick<DeadlineDashValidationIssue, "code" | "path" | "expected" | "actual">,
): string {
  return `[${issue.code}] ${issue.path}: expected ${issue.expected}; received ${issue.actual}`;
}

export function formatDeadlineDashValidationIssues(
  issues: readonly DeadlineDashValidationIssue[],
): string {
  return issues
    .map((issue, index) => `${index + 1}. ${formatDeadlineDashValidationIssue(issue)}`)
    .join("\n");
}

function addIssue(
  issues: DeadlineDashValidationIssue[],
  code: DeadlineDashValidationIssueCode,
  path: string,
  expected: unknown,
  actual: unknown,
): void {
  const issue = {
    code,
    path,
    expected: formatValue(expected),
    actual: formatValue(actual),
  };

  issues.push({
    ...issue,
    message: formatDeadlineDashValidationIssue(issue),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function validateDice(
  dice: unknown,
  path: string,
  issues: DeadlineDashValidationIssue[],
): { readonly minimum: number; readonly maximum: number } | null {
  if (
    !isRecord(dice) ||
    (dice.count !== 1 && dice.count !== 2) ||
    dice.sides !== 6
  ) {
    addIssue(
      issues,
      "board.effect-dice",
      path,
      "{ count: 1 | 2, sides: 6 }",
      dice,
    );
    return null;
  }

  return { minimum: dice.count, maximum: dice.count * dice.sides };
}

function validateEffectList(
  effects: unknown,
  path: string,
  issues: DeadlineDashValidationIssue[],
  authoredDeckIds: ReadonlySet<string>,
): void {
  if (!Array.isArray(effects)) {
    addIssue(issues, "board.effect-shape", path, "effect array", effects);
    return;
  }

  effects.forEach((effect, index) => {
    validateEffect(effect, `${path}[${index}]`, issues, authoredDeckIds);
  });
}

/**
 * Shared by `rollCheck` and by a tile decision's accept branch: both match a
 * dice total (or doubles) against a set of non-overlapping outcomes, and both
 * must reject ranges the declared dice cannot produce.
 */
function validateRollOutcomes(
  outcomes: readonly unknown[],
  range: { readonly minimum: number; readonly maximum: number } | null,
  path: string,
  issues: DeadlineDashValidationIssue[],
  authoredDeckIds: ReadonlySet<string>,
): void {
  const totalRanges: { readonly start: number; readonly end: number; readonly path: string }[] = [];

  outcomes.forEach((outcome, outcomeIndex) => {
    const outcomePath = `${path}.outcomes[${outcomeIndex}]`;
    if (!isRecord(outcome) || !isRecord(outcome.when) || !Array.isArray(outcome.effects)) {
      addIssue(
        issues,
        "board.effect-outcome",
        outcomePath,
        "outcome with one condition and an effect array",
        outcome,
      );
      return;
    }

    const conditionKeys = Object.keys(outcome.when);
    if (conditionKeys.length !== 1) {
      addIssue(
        issues,
        "board.effect-outcome",
        `${outcomePath}.when`,
        "exactly one roll condition",
        outcome.when,
      );
    }

    if ("total" in outcome.when) {
      const total = outcome.when.total;
      if (
        !Array.isArray(total) ||
        total.length !== 2 ||
        !Number.isInteger(total[0]) ||
        !Number.isInteger(total[1]) ||
        total[0] > total[1] ||
        (range !== null && (total[0] < range.minimum || total[1] > range.maximum))
      ) {
        addIssue(
          issues,
          "board.effect-outcome",
          `${outcomePath}.when.total`,
          range ? `integer range within ${range.minimum}-${range.maximum}` : "valid integer range",
          total,
        );
      } else {
        totalRanges.push({ start: total[0], end: total[1], path: `${outcomePath}.when.total` });
      }
    } else if (outcome.when.doubles !== true && outcome.when.doubles !== false) {
      addIssue(
        issues,
        "board.effect-outcome",
        `${outcomePath}.when`,
        "total range or doubles boolean",
        outcome.when,
      );
    }

    validateEffectList(outcome.effects, `${outcomePath}.effects`, issues, authoredDeckIds);
  });

  for (let index = 0; index < totalRanges.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < totalRanges.length; otherIndex += 1) {
      const current = totalRanges[index];
      const other = totalRanges[otherIndex];
      if (current.start <= other.end && other.start <= current.end) {
        addIssue(
          issues,
          "board.effect-outcome",
          other.path,
          `non-overlapping with ${current.path}`,
          [other.start, other.end],
        );
      }
    }
  }
}

/**
 * Effects a decision branch must never contain, because the engine's response
 * path (`applyEffectDescriptors` in packages/engine/src/execution/
 * resolve-tile-effects.ts, called from respond-to-prompt.ts) applies them to
 * canonical state but has nowhere to report them:
 *
 * - `drawCards` mutates the player from the drawn card's effects, yet the
 *   `card-drawn` trace entry is dropped, so no `CardDrawn` event is emitted.
 *   State and event stream would then disagree — fatal for the event-sourced
 *   read model, and invisible to the client either way.
 * - `auditConfinement` sets `inAudit` but the `openAuditPrompt` signal is
 *   dropped, so the player is flagged as confined with no prompt that could
 *   ever release them.
 * - `grantExtraRoll` is dropped outright: an authored "and roll again" would
 *   silently not happen.
 *
 * Tile resolution handles all three; a decision response does not. Rejecting
 * them at authoring time is the only place this can be caught, since the engine
 * resolver is deliberately generic over whatever content authors.
 */
const DECISION_UNSUPPORTED_EFFECT_TYPES: readonly string[] = [
  "drawCards",
  "auditConfinement",
  "grantExtraRoll",
];

/** Walks a decision branch's effects, including nested rollCheck outcomes. */
function validateDecisionBranchEffects(
  effects: readonly unknown[],
  path: string,
  issues: DeadlineDashValidationIssue[],
  depth = 0,
): void {
  if (depth > 4) return;

  effects.forEach((effect, index) => {
    if (!isRecord(effect)) return;
    const effectPath = `${path}[${index}]`;
    if (
      typeof effect.type === "string" &&
      DECISION_UNSUPPORTED_EFFECT_TYPES.includes(effect.type)
    ) {
      addIssue(
        issues,
        "board.decision-shape",
        effectPath,
        "effect a decision response can resolve and report",
        effect,
      );
    }
    if (effect.type === "rollCheck" && Array.isArray(effect.outcomes)) {
      effect.outcomes.forEach((outcome, outcomeIndex) => {
        if (!isRecord(outcome) || !Array.isArray(outcome.effects)) return;
        validateDecisionBranchEffects(
          outcome.effects,
          `${effectPath}.outcomes[${outcomeIndex}].effects`,
          issues,
          depth + 1,
        );
      });
    }
  });
}

/**
 * Effects that fight a decision on the *same tile* for control of the turn, and
 * lose silently.
 *
 * `rollTurn` builds at most one prompt per landing and resolves the two in a
 * fixed order (see packages/engine/src/execution/roll-turn.ts): an
 * `auditConfinement` prompt wins, so the decision is dropped and never offered
 * even though the turn is still held open in the `prompt` phase waiting for an
 * answer to it. `grantExtraRoll` loses the other way: a held decision hands the
 * turn to `respondToPrompt`, which advances turn order unconditionally, so the
 * free roll is silently forfeited.
 *
 * Neither is detectable at runtime — both paths are a legal no-op — so authoring
 * time is the only place it can be caught. Same reasoning as
 * DECISION_UNSUPPORTED_EFFECT_TYPES, one level up: there the *branch* holds an
 * effect the response path cannot report, here the *tile* holds one the landing
 * path cannot honour alongside a question.
 */
const DECISION_CONFLICTING_TILE_EFFECT_TYPES: readonly string[] = [
  "auditConfinement",
  "grantExtraRoll",
];

/** Rejects a tile that both asks a question and carries a turn-holding effect. */
function validateDecisionTileEffects(
  effects: readonly unknown[],
  path: string,
  issues: DeadlineDashValidationIssue[],
): void {
  effects.forEach((effect, index) => {
    if (!isRecord(effect)) return;
    if (
      typeof effect.type === "string" &&
      DECISION_CONFLICTING_TILE_EFFECT_TYPES.includes(effect.type)
    ) {
      addIssue(
        issues,
        "board.decision-shape",
        `${path}[${index}]`,
        "no turn-holding effect on a tile that also opens a decision",
        effect,
      );
    }
  });
}

/**
 * A tile decision is authored data the engine reads back at response time, so
 * it has to be as tightly checked as an effect tree: a malformed accept branch
 * would strand a player in an open prompt with no legal resolution.
 */
function validateTileDecision(
  decision: unknown,
  path: string,
  issues: DeadlineDashValidationIssue[],
  authoredDeckIds: ReadonlySet<string>,
): void {
  if (!isRecord(decision)) {
    addIssue(issues, "board.decision-shape", path, "decision object", decision);
    return;
  }
  if (typeof decision.kind !== "string" || decision.kind.length === 0) {
    addIssue(issues, "board.decision-shape", `${path}.kind`, "non-empty prompt kind", decision.kind);
  }
  if (decision.whenUnaffordable !== "resolve-decline") {
    addIssue(
      issues,
      "board.decision-shape",
      `${path}.whenUnaffordable`,
      "resolve-decline",
      decision.whenUnaffordable,
    );
  }

  const accept = decision.accept;
  const decline = decision.decline;
  if (!isRecord(accept) || !isRecord(decline)) {
    addIssue(
      issues,
      "board.decision-shape",
      path,
      "decision with an accept and a decline branch",
      decision,
    );
    return;
  }

  if (
    typeof accept.optionId !== "string" ||
    accept.optionId.length === 0 ||
    typeof decline.optionId !== "string" ||
    decline.optionId.length === 0 ||
    accept.optionId === decline.optionId
  ) {
    addIssue(
      issues,
      "board.decision-shape",
      `${path}.accept.optionId`,
      "two distinct non-empty option ids",
      [accept.optionId, decline.optionId],
    );
  }

  if (
    !isRecord(accept.cost) ||
    accept.cost.resource !== "money" ||
    !isPositiveInteger(accept.cost.amount)
  ) {
    addIssue(
      issues,
      "board.decision-shape",
      `${path}.accept.cost`,
      "positive money cost",
      accept.cost,
    );
  }
  if (accept.rerollEligible !== false) {
    addIssue(
      issues,
      "board.decision-shape",
      `${path}.accept.rerollEligible`,
      false,
      accept.rerollEligible,
    );
  }

  const range = validateDice(accept.roll, `${path}.accept.roll`, issues);
  if (!Array.isArray(accept.outcomes) || accept.outcomes.length === 0) {
    addIssue(
      issues,
      "board.decision-shape",
      `${path}.accept.outcomes`,
      "non-empty outcome array",
      accept.outcomes,
    );
  } else {
    validateRollOutcomes(accept.outcomes, range, `${path}.accept`, issues, authoredDeckIds);
    accept.outcomes.forEach((outcome, outcomeIndex) => {
      if (!isRecord(outcome) || !Array.isArray(outcome.effects)) return;
      validateDecisionBranchEffects(
        outcome.effects,
        `${path}.accept.outcomes[${outcomeIndex}].effects`,
        issues,
      );
    });
  }

  if (!Array.isArray(decline.effects)) {
    addIssue(
      issues,
      "board.decision-shape",
      `${path}.decline.effects`,
      "effect array",
      decline.effects,
    );
    return;
  }
  // Declining must never cost anything — that is what makes it a safe default
  // response for a timeout or a disconnected player.
  decline.effects.forEach((effect, index) => {
    if (!isRecord(effect)) return;
    const takesResource =
      effect.type === "payResource" ||
      (effect.type === "modifyResource" && isFiniteNumber(effect.amount) && effect.amount < 0) ||
      effect.type === "skipTurns" ||
      effect.type === "auditConfinement";
    if (takesResource) {
      addIssue(
        issues,
        "board.decision-shape",
        `${path}.decline.effects[${index}]`,
        "effect that costs the player nothing",
        effect,
      );
    }
  });
  validateDecisionBranchEffects(decline.effects, `${path}.decline.effects`, issues);
  validateEffectList(decline.effects, `${path}.decline.effects`, issues, authoredDeckIds);
}

/**
 * `EffectCondition` is a **closed** grammar, and the engine's
 * `parseEffectCondition` fails closed on anything it does not recognise — an
 * unrecognised guard silently never fires. Validating it here is what turns
 * that silence into a build error.
 */
function validateEffectCondition(
  condition: unknown,
  path: string,
  issues: DeadlineDashValidationIssue[],
): void {
  if (!isRecord(condition) || typeof condition.kind !== "string") {
    addIssue(issues, "board.effect-condition", path, "condition object with a kind", condition);
    return;
  }

  const invalid = (expected: string): void => {
    addIssue(issues, "board.effect-condition", path, expected, condition);
  };
  const subjectOk = (): boolean => VALID_CONDITION_SUBJECTS.has(String(condition.who));

  switch (condition.kind) {
    case "always":
    case "never":
      return;
    case "resourceAtLeast":
    case "resourceAtMost":
      if (
        !subjectOk() ||
        !VALID_CONDITION_RESOURCES.has(String(condition.resource)) ||
        !isFiniteNumber(condition.amount)
      ) {
        invalid("resource comparison with who, resource and finite amount");
      }
      return;
    case "rankIndexAtLeast":
    case "rankIndexAtMost":
      if (!subjectOk() || !isFiniteNumber(condition.index) || condition.index < 0) {
        invalid("rank comparison with who and a non-negative index");
      }
      return;
    case "heatAtLeast":
      if (!subjectOk() || !isFiniteNumber(condition.value)) {
        invalid("heat comparison with who and a finite value");
      }
      return;
    case "hasStatus":
      if (!subjectOk() || typeof condition.statusId !== "string") {
        invalid("hasStatus with who and a status id");
        return;
      }
      if (!validStatusIds.has(condition.statusId)) {
        addIssue(
          issues,
          "board.effect-status-id",
          `${path}.statusId`,
          [...validStatusIds],
          condition.statusId,
        );
      }
      return;
    case "ownsTile":
      if (!subjectOk() || (condition.tileId !== null && typeof condition.tileId !== "string")) {
        invalid("ownsTile with who and a tile id or null");
      }
      return;
    case "roundAtLeast":
      if (!isPositiveInteger(condition.round)) invalid("roundAtLeast with a positive round");
      return;
    case "quarterIndex":
      if (!isFiniteNumber(condition.index) || condition.index < 0) {
        invalid("quarterIndex with a non-negative index");
      }
      return;
    case "not":
      validateEffectCondition(condition.of, `${path}.of`, issues);
      return;
    case "all":
    case "any":
      if (!Array.isArray(condition.of) || condition.of.length === 0) {
        invalid("combinator with a non-empty clause list");
        return;
      }
      condition.of.forEach((clause, index) => {
        validateEffectCondition(clause, `${path}.of[${index}]`, issues);
      });
      return;
    default:
      invalid("known condition kind");
  }
}

/**
 * The four fields `EffectEnvelope` adds to *every* effect. All optional; every
 * default reproduces v1 behaviour, which is why the pre-v2 pack validated
 * without this.
 */
function validateEffectEnvelope(
  effect: Record<string, unknown>,
  path: string,
  issues: DeadlineDashValidationIssue[],
): void {
  if (effect.target !== undefined && !VALID_EFFECT_TARGETS.has(String(effect.target))) {
    addIssue(issues, "board.effect-target", `${path}.target`, [...VALID_EFFECT_TARGETS], effect.target);
  }
  if (effect.preventable !== undefined && typeof effect.preventable !== "boolean") {
    addIssue(issues, "board.effect-shape", `${path}.preventable`, "boolean", effect.preventable);
  }
  if (effect.condition !== undefined) {
    validateEffectCondition(effect.condition, `${path}.condition`, issues);
  }
  if (effect.scale !== undefined) {
    const scale = effect.scale;
    if (
      !isRecord(scale) ||
      !VALID_SCALE_METRICS.has(String(scale.by)) ||
      !isFiniteNumber(scale.perUnit) ||
      (scale.cap !== undefined && !isFiniteNumber(scale.cap)) ||
      (scale.of !== undefined && !VALID_CONDITION_SUBJECTS.has(String(scale.of)))
    ) {
      addIssue(
        issues,
        "board.effect-shape",
        `${path}.scale`,
        "scale with a known metric and finite perUnit",
        scale,
      );
    }
  }
}

function validateEffect(
  effect: unknown,
  path: string,
  issues: DeadlineDashValidationIssue[],
  authoredDeckIds: ReadonlySet<string>,
): void {
  if (!isRecord(effect) || typeof effect.type !== "string") {
    addIssue(issues, "board.effect-shape", path, "effect object with a type", effect);
    return;
  }

  const invalidShape = (expected: string): void => {
    addIssue(issues, "board.effect-shape", path, expected, effect);
  };

  validateEffectEnvelope(effect, path, issues);

  switch (effect.type) {
    case "drawCards":
      if (typeof effect.deckId !== "string" || !isPositiveInteger(effect.count)) {
        invalidShape("drawCards with deckId and positive integer count");
      }
      if (typeof effect.deckId === "string" && !authoredDeckIds.has(effect.deckId)) {
        addIssue(
          issues,
          "board.effect-deck-id",
          `${path}.deckId`,
          [...authoredDeckIds],
          effect.deckId,
        );
      }
      return;
    case "modifyResource":
      if (
        !["money", "reputation", "energy"].includes(String(effect.resource)) ||
        !isFiniteNumber(effect.amount)
      ) {
        invalidShape("modifyResource with a valid resource and finite amount");
      }
      return;
    case "restoreResourceToMaximum":
      if (effect.resource !== "energy") invalidShape("energy restore effect");
      return;
    case "payResource":
      if (
        effect.resource !== "money" ||
        !isFiniteNumber(effect.amount) ||
        effect.amount < 0 ||
        effect.insufficientFunds !== "pay-up-to-available"
      ) {
        invalidShape("money payment with non-negative amount and insufficient-funds rule");
      }
      return;
    case "incrementWorkCounter":
      // `amount` was widened from the literal 1 in the v2 schema: the re-cut's
      // `WC(n)` notation needs multi-step cards and `rewardEvery` already
      // handles a stride.
      if (
        !isPositiveInteger(effect.amount) ||
        effect.rewardEvery !== 5 ||
        effect.cumulative !== true ||
        !isRecord(effect.reward) ||
        effect.reward.resource !== "reputation" ||
        effect.reward.amount !== 1
      ) {
        invalidShape("canonical cumulative Work counter effect");
      }
      return;
    case "rollCheck": {
      const range = validateDice(effect.dice, `${path}.dice`, issues);
      if (typeof effect.rerollEligible !== "boolean" || !Array.isArray(effect.outcomes)) {
        invalidShape("rollCheck with rerollEligible and outcomes");
        return;
      }

      validateRollOutcomes(effect.outcomes, range, path, issues, authoredDeckIds);
      return;
    }
    case "applyStatus":
      if (
        typeof effect.statusId !== "string" ||
        !isRecord(effect.duration) ||
        !["uses", "turns"].includes(String(effect.duration.kind)) ||
        !isPositiveInteger(effect.duration.count)
      ) {
        invalidShape("status effect with positive uses or turns duration");
      }
      if (typeof effect.statusId === "string" && !validStatusIds.has(effect.statusId)) {
        addIssue(
          issues,
          "board.effect-status-id",
          `${path}.statusId`,
          [...validStatusIds],
          effect.statusId,
        );
      }
      return;
    case "skipTurns":
      // `source` was widened from the literal "tile": cards skip turns too.
      if (
        !isPositiveInteger(effect.count) ||
        (effect.source !== "tile" && effect.source !== "card")
      ) {
        invalidShape("positive skipTurns effect sourced from a tile or a card");
      }
      return;
    case "gainSalary":
      if (effect.trigger !== "pass" && effect.trigger !== "land") {
        invalidShape("salary trigger of pass or land");
      }
      return;
    case "grantExtraRoll":
      if (effect.count !== 1) invalidShape("one extra roll");
      return;
    case "attemptPromotion":
      return;
    case "auditConfinement":
      if (
        !isRecord(effect.release) ||
        effect.release.requiresTrueDoubles !== true ||
        effect.release.rerollEligible !== false ||
        !isFiniteNumber(effect.release.alternativeFine) ||
        effect.release.alternativeFine < 0
      ) {
        invalidShape("audit confinement with release rules");
      }
      if (isRecord(effect.release)) {
        validateDice(effect.release.roll, `${path}.release.roll`, issues);
      }
      return;

    // ---- v2 vocabulary (spec §10.3, re-cut plan §3) ----------------------
    case "transferResource":
      if (
        !RESOURCE_IDS.includes(String(effect.resource)) ||
        !isFiniteNumber(effect.amount) ||
        effect.amount < 0 ||
        (effect.direction !== undefined &&
          effect.direction !== "target-to-actor" &&
          effect.direction !== "actor-to-target") ||
        (effect.perTarget !== undefined && typeof effect.perTarget !== "boolean") ||
        (effect.insufficientFunds !== undefined &&
          effect.insufficientFunds !== "transfer-up-to-available" &&
          effect.insufficientFunds !== "all-or-nothing")
      ) {
        invalidShape("transferResource with a valid resource, non-negative amount and direction");
      }
      return;
    case "modifyHeat":
      if (!isFiniteNumber(effect.amount) || effect.amount === 0) {
        invalidShape("modifyHeat with a non-zero finite amount");
      }
      return;
    case "grantImmunity": {
      const hasCount = effect.count !== undefined;
      const hasDuration = effect.duration !== undefined;
      if (
        !isRecord(effect.scope) ||
        hasCount === hasDuration ||
        (hasCount && !isPositiveInteger(effect.count)) ||
        (hasDuration &&
          (!isRecord(effect.duration) ||
            effect.duration.kind !== "turns" ||
            !isPositiveInteger(effect.duration.count)))
      ) {
        invalidShape("grantImmunity with a scope and exactly one of count or turns duration");
        return;
      }
      const scope = effect.scope;
      if (
        Object.keys(scope).length === 0 ||
        (scope.resource !== undefined && !RESOURCE_IDS.includes(String(scope.resource))) ||
        (scope.direction !== undefined &&
          scope.direction !== "loss" &&
          scope.direction !== "gain") ||
        (scope.effectTypes !== undefined &&
          (!Array.isArray(scope.effectTypes) ||
            scope.effectTypes.some((entry) => typeof entry !== "string"))) ||
        (scope.sourceDeckId !== undefined && typeof scope.sourceDeckId !== "string")
      ) {
        invalidShape("grantImmunity scope with at least one recognised filter");
        return;
      }
      if (typeof scope.sourceDeckId === "string" && !authoredDeckIds.has(scope.sourceDeckId)) {
        addIssue(
          issues,
          "board.effect-deck-id",
          `${path}.scope.sourceDeckId`,
          [...authoredDeckIds],
          scope.sourceDeckId,
        );
      }
      return;
    }
    case "removeStatuses": {
      if (!isRecord(effect.filter) || Object.keys(effect.filter).length === 0) {
        invalidShape("removeStatuses with a non-empty filter");
        return;
      }
      const filter = effect.filter;
      if (
        (filter.polarity !== undefined &&
          filter.polarity !== "positive" &&
          filter.polarity !== "negative") ||
        (filter.sourceDeckId !== undefined && typeof filter.sourceDeckId !== "string") ||
        (filter.statusId !== undefined && typeof filter.statusId !== "string") ||
        (effect.limit !== undefined && !isPositiveInteger(effect.limit))
      ) {
        invalidShape("removeStatuses filter with recognised polarity, deck and status");
        return;
      }
      if (typeof filter.statusId === "string" && !validStatusIds.has(filter.statusId)) {
        addIssue(
          issues,
          "board.effect-status-id",
          `${path}.filter.statusId`,
          [...validStatusIds],
          filter.statusId,
        );
      }
      if (typeof filter.sourceDeckId === "string" && !authoredDeckIds.has(filter.sourceDeckId)) {
        addIssue(
          issues,
          "board.effect-deck-id",
          `${path}.filter.sourceDeckId`,
          [...authoredDeckIds],
          filter.sourceDeckId,
        );
      }
      return;
    }
    case "chooseOne": {
      if (!Array.isArray(effect.options) || effect.options.length < 2) {
        invalidShape("chooseOne with at least two options");
        return;
      }
      const optionIds = new Set<string>();
      effect.options.forEach((option, index) => {
        const optionPath = `${path}.options[${index}]`;
        if (
          !isRecord(option) ||
          typeof option.id !== "string" ||
          option.id.length === 0 ||
          typeof option.label !== "string" ||
          option.label.length === 0
        ) {
          addIssue(issues, "board.effect-shape", optionPath, "choice option with id and label", option);
          return;
        }
        if (optionIds.has(option.id)) {
          addIssue(issues, "board.effect-shape", `${optionPath}.id`, "unique option id", option.id);
        }
        optionIds.add(option.id);
        validateEffectList(option.effects, `${optionPath}.effects`, issues, authoredDeckIds);
      });
      return;
    }
    case "noEffect":
      return;
    case "opposedRoll":
      if (!Array.isArray(effect.onWin) || !Array.isArray(effect.onLose)) {
        invalidShape("opposedRoll with onWin and onLose effect lists");
        return;
      }
      if (effect.dice !== undefined) validateDice(effect.dice, `${path}.dice`, issues);
      validateEffectList(effect.onWin, `${path}.onWin`, issues, authoredDeckIds);
      validateEffectList(effect.onLose, `${path}.onLose`, issues, authoredDeckIds);
      if (effect.onTie !== undefined) {
        validateEffectList(effect.onTie, `${path}.onTie`, issues, authoredDeckIds);
      }
      return;

    /**
     * Declared in `schema/effects.ts` but not yet reached by any authored card
     * or tile. Accepted structurally so authoring one is not blocked by a
     * validator false alarm; each needs a real shape check the day it is used.
     */
    case "placeObject":
    case "claimTile":
    case "releaseTile":
    case "startProject":
    case "contributeToProject":
    case "sabotageProject":
    case "openBallot":
    case "forceDiscard":
    case "swapBoardPositions":
    case "teleport":
    case "modifyUpkeep":
    case "openReactionWindow":
    case "grantIncomeStream":
      return;
    default:
      invalidShape("known board effect type");
  }
}

function validateBoard(
  board: DeadlineDashContentValidationInput["board"],
  issues: DeadlineDashValidationIssue[],
  authoredDeckIds: ReadonlySet<string>,
): void {
  const spaces = board.spaces;

  if (spaces.length !== BOARD_SIZE) {
    addIssue(issues, "board.count", "board.spaces.length", BOARD_SIZE, spaces.length);
  }

  const seenIds = new Map<string, number>();
  const sideCounts = new Map<string, number>();
  const kindCounts = new Map<string, number>();

  spaces.forEach((space, position) => {
    if (space.index !== position) {
      addIssue(issues, "board.index", `board.spaces[${position}].index`, position, space.index);
    }

    const firstPosition = seenIds.get(space.id);
    if (firstPosition !== undefined) {
      addIssue(
        issues,
        "board.duplicate-id",
        `board.spaces[${position}].id`,
        `unique (first used at board.spaces[${firstPosition}].id)`,
        space.id,
      );
    } else {
      seenIds.set(space.id, position);
    }

    kindCounts.set(space.kind, (kindCounts.get(space.kind) ?? 0) + 1);
    if (space.placement === "side") {
      sideCounts.set(space.side, (sideCounts.get(space.side) ?? 0) + 1);
    }
    validateEffectList(
      space.effects,
      `board.spaces[${position}].effects`,
      issues,
      authoredDeckIds,
    );
    if (space.decision !== undefined) {
      validateTileDecision(
        space.decision,
        `board.spaces[${position}].decision`,
        issues,
        authoredDeckIds,
      );
      validateDecisionTileEffects(
        space.effects,
        `board.spaces[${position}].effects`,
        issues,
      );
    }
  });

  for (const [index, coordinate, kind] of cornerExpectations) {
    const space = spaces[index];
    const actual = space
      ? { placement: space.placement, coordinate: space.coordinate, kind: space.kind }
      : undefined;
    const expected = { placement: "corner", coordinate, kind };
    if (
      !space ||
      space.placement !== "corner" ||
      space.coordinate !== coordinate ||
      space.kind !== kind
    ) {
      addIssue(issues, "board.corner", `board.spaces[${index}]`, expected, actual);
    }
  }

  for (const [side, start, end] of sideExpectations) {
    const count = sideCounts.get(side) ?? 0;
    if (count !== SIDE_SIZE) {
      addIssue(issues, "board.side-count", `board.sides.${side}.count`, SIDE_SIZE, count);
    }

    for (let index = start; index <= end; index += 1) {
      const space = spaces[index];
      // The workbook's ordering column is authoritative: board index =
      // 11 * (side - 1) + coordinate, so coordinates ascend with the index.
      const coordinate = index - start + 1;
      const actual = space
        ? {
            placement: space.placement,
            side: space.placement === "side" ? space.side : undefined,
            coordinate: space.coordinate,
          }
        : undefined;
      const expected = { placement: "side", side, coordinate };
      if (
        !space ||
        space.placement !== "side" ||
        space.side !== side ||
        space.coordinate !== coordinate
      ) {
        addIssue(issues, "board.side-traversal", `board.spaces[${index}]`, expected, actual);
      }
    }
  }

  for (const [kind, expected] of Object.entries(expectedKinds)) {
    const actual = kindCounts.get(kind) ?? 0;
    if (actual !== expected) {
      addIssue(issues, "board.kind-count", `board.kinds.${kind}`, expected, actual);
    }
  }

  const expectedCountMetadata = {
    total: BOARD_SIZE,
    corners: cornerExpectations.length,
    regular: BOARD_SIZE - cornerExpectations.length,
    perSide: SIDE_SIZE,
  } as const;
  for (const [key, expected] of Object.entries(expectedCountMetadata)) {
    const actual = board.expectedCounts[key as keyof typeof expectedCountMetadata];
    if (actual !== expected) {
      addIssue(issues, "board.expected-count", `board.expectedCounts.${key}`, expected, actual);
    }
  }
  for (const [kind, expected] of Object.entries(expectedKinds)) {
    const actual = board.expectedCounts.byKind[kind as keyof typeof expectedKinds];
    if (actual !== expected) {
      addIssue(
        issues,
        "board.expected-count",
        `board.expectedCounts.byKind.${kind}`,
        expected,
        actual,
      );
    }
  }
}

function validateDecks(
  decks: DeadlineDashContentValidationInput["decks"],
  issues: DeadlineDashValidationIssue[],
): ReadonlySet<string> {
  if (decks.length !== expectedDeckIds.length) {
    addIssue(issues, "deck.count", "decks.length", expectedDeckIds.length, decks.length);
  }

  const authoredDeckIds = new Set(decks.map((deck) => deck.id));
  const seenDeckIds = new Map<string, number>();
  const seenCardIds = new Map<string, string>();

  decks.forEach((deck, deckIndex) => {
    const deckPath = `decks[${deckIndex}]`;
    const firstDeckIndex = seenDeckIds.get(deck.id);
    if (firstDeckIndex !== undefined) {
      addIssue(
        issues,
        "deck.duplicate-id",
        `${deckPath}.id`,
        `unique (first used at decks[${firstDeckIndex}].id)`,
        deck.id,
      );
    } else {
      seenDeckIds.set(deck.id, deckIndex);
    }

    if (!validDeckIds.has(deck.id)) {
      addIssue(issues, "deck.id", `${deckPath}.id`, expectedDeckIds, deck.id);
    }
    if (deck.cards.length === 0) {
      addIssue(issues, "deck.empty", `${deckPath}.cards`, "non-empty card array", deck.cards);
    }

    deck.cards.forEach((card, cardIndex) => {
      const cardPath = `${deckPath}.cards[${cardIndex}]`;
      const firstCardPath = seenCardIds.get(card.id);
      if (firstCardPath !== undefined) {
        addIssue(
          issues,
          "deck.card-duplicate-id",
          `${cardPath}.id`,
          `unique (first used at ${firstCardPath})`,
          card.id,
        );
      } else {
        seenCardIds.set(card.id, `${cardPath}.id`);
      }

      if (!/^card\.[A-Za-z][A-Za-z0-9-]*\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.id)) {
        addIssue(issues, "deck.card-id", `${cardPath}.id`, "card.<deck>.<slug>", card.id);
      } else {
        const cardDeckId = card.id.slice("card.".length, card.id.lastIndexOf("."));
        const expectedCardDeckId = deck.id.slice("deck.".length);
        if (cardDeckId !== expectedCardDeckId) {
          addIssue(
            issues,
            "deck.card-id",
            `${cardPath}.id`,
            `card.${expectedCardDeckId}.<slug>`,
            card.id,
          );
        }
      }
      if (!/^deadlineDash\.card\.[A-Za-z][A-Za-z0-9]*\.name$/.test(card.nameKey)) {
        addIssue(
          issues,
          "deck.card-name-key",
          `${cardPath}.nameKey`,
          "deadlineDash.card.<name>.name",
          card.nameKey,
        );
      }
      if (card.effects.length === 0) {
        addIssue(
          issues,
          "deck.card-effects",
          `${cardPath}.effects`,
          "non-empty effect array",
          card.effects,
        );
      }
      validateEffectList(card.effects, `${cardPath}.effects`, issues, authoredDeckIds);
    });
  });

  return authoredDeckIds;
}

function validateNumberRecord(
  actual: Partial<Readonly<Record<string, number>>>,
  expected: Readonly<Record<string, number>>,
  path: string,
  code: DeadlineDashValidationIssueCode,
  issues: DeadlineDashValidationIssue[],
): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      addIssue(issues, code, `${path}.${key}`, expectedValue, actual[key]);
    }
  }

  for (const key of Object.keys(actual).sort()) {
    if (!(key in expected)) {
      addIssue(issues, code, `${path}.${key}`, "absent", actual[key]);
    }
  }
}

type NumericBound = {
  readonly integer?: boolean;
  /** Inclusive; defaults to 0. Above 0 only where a zero is degenerate, not inert. */
  readonly minimum?: number;
  /** Inclusive. Present on every numeric: §8.4 treats an unbounded tunable as a cheat. */
  readonly maximum: number;
};

type RuleFieldSpec =
  | { readonly kind: "boolean" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | ({ readonly kind: "number" } & NumericBound)
  | ({ readonly kind: "nullable-number" } & NumericBound)
  | ({ readonly kind: "number-pair" } & NumericBound)
  | ({ readonly kind: "number-array" } & NumericBound);

const BOOLEAN_FIELD = { kind: "boolean" } as const;

/**
 * The `ModeRules` shape as data, so one walker can check the authored presets
 * *and* an untrusted lobby-authored custom ruleset (spec §8.4) against exactly
 * the same rules. Nothing here may be relaxed for content and tightened for
 * client input, or the two drift.
 *
 * Every numeric carries an inclusive maximum. That is not defensive padding: an
 * unbounded `maxPipAdjust` or `maxLoanPrincipal` from a lobby is a cheat, and a
 * multi-thousand-round `quarters.count` is a denial of service. Non-negativity
 * is enforced for all of them, and signed values are deliberately absent from
 * this shape — nothing in `ModeRules` is meaningfully negative.
 *
 * The bounds mirror `MODE_RULES_BOUNDS` in
 * `packages/contracts/src/mode-rules.ts` value for value, so that every shipped
 * preset provably survives the client-input gate as well: if the two tables
 * disagree, a mode the lobby offers is one the lobby cannot save back.
 */
const MODE_RULES_SHAPE = {
  quarters: {
    enabled: BOOLEAN_FIELD,
    count: { kind: "number", integer: true, minimum: 1, maximum: 12 },
    roundsEach: { kind: "number", integer: true, minimum: 1, maximum: 50 },
    globalEvents: BOOLEAN_FIELD,
  },
  winPaths: {
    promotion: BOOLEAN_FIELD,
    wealth: BOOLEAN_FIELD,
    influence: BOOLEAN_FIELD,
    survival: BOOLEAN_FIELD,
  },
  endgame: {
    rankTierPoints: { kind: "number", integer: true, maximum: 100_000 },
    // Not an integer: the shipped weight is 0.1, i.e. a point per ten money.
    moneyMultiplier: { kind: "number", maximum: 100 },
    reputationPoints: { kind: "number", integer: true, maximum: 100_000 },
    clockDecksEndMatch: BOOLEAN_FIELD,
  },
  economy: {
    upkeepEnabled: BOOLEAN_FIELD,
    upkeepByRankIndex: { kind: "number-array", integer: true, maximum: 100_000 },
    promotionCostByRankIndex: { kind: "number-array", integer: true, maximum: 1_000_000 },
    loansEnabled: BOOLEAN_FIELD,
    maxLoanPrincipal: { kind: "number", integer: true, maximum: 1_000_000 },
    interestBasisPoints: { kind: "number", integer: true, maximum: 10_000 },
    bankruptcy: { kind: "enum", values: ["none", "demote", "eliminate"] },
    incomeStreamsEnabled: BOOLEAN_FIELD,
  },
  board: {
    ownershipEnabled: BOOLEAN_FIELD,
    claimCostMultiplier: { kind: "number", maximum: 10 },
    tollMultiplier: { kind: "number", maximum: 10 },
    upgradesEnabled: BOOLEAN_FIELD,
    placementsEnabled: BOOLEAN_FIELD,
    maxPlacementsPerPlayer: { kind: "number", integer: true, maximum: 20 },
  },
  projects: {
    enabled: BOOLEAN_FIELD,
    maxConcurrentPerPlayer: { kind: "number", integer: true, maximum: 10 },
    joinable: BOOLEAN_FIELD,
    sabotageable: BOOLEAN_FIELD,
    deadlineRounds: { kind: "number", integer: true, minimum: 1, maximum: 50 },
  },
  conflict: {
    targetedAttacks: BOOLEAN_FIELD,
    heatEnabled: BOOLEAN_FIELD,
    heatPerAttack: { kind: "number", integer: true, maximum: 100 },
    heatThreshold: { kind: "number", integer: true, minimum: 1, maximum: 1_000 },
    defenceEnabled: BOOLEAN_FIELD,
    leaderProtection: { kind: "enum", values: ["none", "soft", "hard"] },
    elimination: BOOLEAN_FIELD,
  },
  agency: {
    promotionIsChoice: BOOLEAN_FIELD,
    promotionRaisesUpkeep: BOOLEAN_FIELD,
    diceAdjustEnabled: BOOLEAN_FIELD,
    energyPerPip: { kind: "number", integer: true, maximum: 10 },
    maxPipAdjust: { kind: "number", integer: true, maximum: 6 },
    freeActionsPerTurn: { kind: "number", integer: true, maximum: 5 },
    handEnabled: BOOLEAN_FIELD,
    handLimit: { kind: "number", integer: true, maximum: 20 },
  },
  interaction: {
    reactionWindows: BOOLEAN_FIELD,
    reactionWindowSeconds: { kind: "number", integer: true, minimum: 1, maximum: 120 },
    votesEnabled: BOOLEAN_FIELD,
    auctionsEnabled: BOOLEAN_FIELD,
    tradesEnabled: BOOLEAN_FIELD,
    promisesRecorded: BOOLEAN_FIELD,
  },
  hidden: {
    rolesEnabled: BOOLEAN_FIELD,
    roleWinConditions: BOOLEAN_FIELD,
    secretObjectives: BOOLEAN_FIELD,
    hiddenHands: BOOLEAN_FIELD,
  },
  social: {
    chat: { kind: "enum", values: ["off", "quick", "full"] },
    emoteReactions: BOOLEAN_FIELD,
    directMessages: BOOLEAN_FIELD,
  },
  timers: {
    turnSeconds: { kind: "number", integer: true, minimum: 5, maximum: 600 },
    onTimeout: { kind: "enum", values: ["auto-roll", "auto-pass", "best-move"] },
    chessClockSeconds: {
      kind: "nullable-number",
      integer: true,
      minimum: 30,
      maximum: 7_200,
    },
  },
  bots: {
    pacing: { kind: "enum", values: ["instant", "paced"] },
    thinkMsRange: { kind: "number-pair", integer: true, maximum: 60_000 },
    canNegotiate: BOOLEAN_FIELD,
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, RuleFieldSpec>>>>;

const WIN_SHAPES = ["race", "fixed-length", "objectives", "survival"] as const;

function validateBoundedNumber(
  value: unknown,
  spec: NumericBound,
  path: string,
  issues: DeadlineDashValidationIssue[],
): void {
  const minimum = spec.minimum ?? 0;
  const expected = `${spec.integer ? "integer" : "number"} in ${minimum}-${spec.maximum}`;
  if (
    !isFiniteNumber(value) ||
    value < minimum ||
    value > spec.maximum ||
    (spec.integer === true && !Number.isInteger(value))
  ) {
    addIssue(issues, "mode.rules-number", path, expected, value);
  }
}

function validateRuleField(
  value: unknown,
  spec: RuleFieldSpec,
  path: string,
  issues: DeadlineDashValidationIssue[],
): void {
  switch (spec.kind) {
    case "boolean":
      if (typeof value !== "boolean") {
        addIssue(issues, "mode.rules-shape", path, "boolean", value);
      }
      return;
    case "enum":
      if (typeof value !== "string" || !spec.values.includes(value)) {
        addIssue(issues, "mode.rules-enum", path, spec.values, value);
      }
      return;
    case "number":
      validateBoundedNumber(value, spec, path, issues);
      return;
    case "nullable-number":
      if (value !== null) validateBoundedNumber(value, spec, path, issues);
      return;
    case "number-pair":
      if (!Array.isArray(value) || value.length !== 2) {
        addIssue(issues, "mode.rules-shape", path, "two-element numeric range", value);
        return;
      }
      validateBoundedNumber(value[0], spec, `${path}[0]`, issues);
      validateBoundedNumber(value[1], spec, `${path}[1]`, issues);
      if (isFiniteNumber(value[0]) && isFiniteNumber(value[1]) && value[0] > value[1]) {
        addIssue(issues, "mode.rules-number", path, "ascending range", value);
      }
      return;
    case "number-array":
      if (!Array.isArray(value)) {
        addIssue(issues, "mode.rules-shape", path, "numeric array", value);
        return;
      }
      value.forEach((entry, index) => {
        validateBoundedNumber(entry, spec, `${path}[${index}]`, issues);
      });
      return;
  }
}

/**
 * Named to stay distinct from `ModeRulesValidationOptions` in
 * `@office-ladder/contracts`: that one belongs to the client-input parser and
 * has a different shape, and the server imports from both packages.
 */
export type ModeRulesContentValidationOptions = {
  /**
   * `economy.upkeepByRankIndex` must have exactly one charge per rung of the
   * ladder — a short array silently exempts the top ranks from upkeep, which is
   * precisely backwards.
   */
  readonly rankLadderLength: number;
  /**
   * When supplied, `timers.turnSeconds` must match it. `ModeConfig` carries
   * `turnTimerSeconds` as well, and two turn-timer numbers that disagree is a
   * bug waiting for whichever consumer reads the other one.
   */
  readonly turnTimerSeconds?: number;
};

/**
 * Validates a `ModeRules` object structurally and against its cross-field
 * invariants. Exported so the same walker can be pointed at a lobby-authored
 * custom ruleset (spec §8.4) instead of at authored content — never trust a
 * client-supplied rules object.
 */
export function validateModeRules(
  rules: unknown,
  options: ModeRulesContentValidationOptions,
  path = "rules",
): DeadlineDashValidationResult {
  const issues: DeadlineDashValidationIssue[] = [];
  appendModeRulesIssues(rules, options, path, issues);
  return { valid: issues.length === 0, issues };
}

function appendModeRulesIssues(
  rules: unknown,
  options: ModeRulesContentValidationOptions,
  path: string,
  issues: DeadlineDashValidationIssue[],
): void {
  if (!isRecord(rules)) {
    addIssue(issues, "mode.rules-shape", path, "ModeRules object", rules);
    return;
  }

  if (typeof rules.winShape !== "string" || !WIN_SHAPES.includes(rules.winShape as never)) {
    addIssue(issues, "mode.rules-enum", `${path}.winShape`, WIN_SHAPES, rules.winShape);
  }

  const expectedKeys = new Set<string>(["winShape", ...Object.keys(MODE_RULES_SHAPE)]);
  for (const key of Object.keys(rules).sort()) {
    if (!expectedKeys.has(key)) {
      addIssue(issues, "mode.rules-shape", `${path}.${key}`, "absent", rules[key]);
    }
  }

  for (const [groupName, groupShape] of Object.entries(MODE_RULES_SHAPE)) {
    const groupPath = `${path}.${groupName}`;
    const group = rules[groupName];
    if (!isRecord(group)) {
      addIssue(issues, "mode.rules-shape", groupPath, `${groupName} rules object`, group);
      continue;
    }

    for (const [fieldName, fieldSpec] of Object.entries(groupShape)) {
      validateRuleField(
        group[fieldName],
        fieldSpec as RuleFieldSpec,
        `${groupPath}.${fieldName}`,
        issues,
      );
    }
    for (const key of Object.keys(group).sort()) {
      if (!(key in groupShape)) {
        addIssue(issues, "mode.rules-shape", `${groupPath}.${key}`, "absent", group[key]);
      }
    }
  }

  const winPaths = rules.winPaths;
  if (
    isRecord(winPaths) &&
    winPaths.promotion === false &&
    winPaths.wealth === false &&
    winPaths.influence === false &&
    winPaths.survival === false
  ) {
    addIssue(
      issues,
      "mode.rules-win-paths",
      `${path}.winPaths`,
      "at least one enabled win path",
      winPaths,
    );
  }

  const economy = rules.economy;
  if (isRecord(economy) && Array.isArray(economy.upkeepByRankIndex)) {
    if (economy.upkeepByRankIndex.length !== options.rankLadderLength) {
      addIssue(
        issues,
        "mode.rules-upkeep-length",
        `${path}.economy.upkeepByRankIndex.length`,
        options.rankLadderLength,
        economy.upkeepByRankIndex.length,
      );
    }
  }
  // One price per rung, for the same reason as upkeep: a short ladder makes the
  // ranks past its end free, which for promotion costs is the whole game.
  if (isRecord(economy) && Array.isArray(economy.promotionCostByRankIndex)) {
    if (economy.promotionCostByRankIndex.length !== options.rankLadderLength) {
      addIssue(
        issues,
        "mode.rules-upkeep-length",
        `${path}.economy.promotionCostByRankIndex.length`,
        options.rankLadderLength,
        economy.promotionCostByRankIndex.length,
      );
    }
    // Nobody is promoted *into* the entry rank, so a non-zero first entry is a
    // ladder that has been shifted by one — which would price every promotion
    // one rung short.
    if (economy.promotionCostByRankIndex[0] !== 0) {
      addIssue(
        issues,
        "mode.rules-number",
        `${path}.economy.promotionCostByRankIndex[0]`,
        0,
        economy.promotionCostByRankIndex[0],
      );
    }
  }

  const quarters = rules.quarters;
  if (isRecord(quarters)) {
    if (
      quarters.enabled === true &&
      (!isPositiveInteger(quarters.count) || !isPositiveInteger(quarters.roundsEach))
    ) {
      addIssue(
        issues,
        "mode.rules-quarters",
        `${path}.quarters`,
        "positive count and roundsEach when quarters are enabled",
        { count: quarters.count, roundsEach: quarters.roundsEach },
      );
    }
    // A fixed-length match has to know when it ends, and the quarter track is
    // the only thing in ModeRules that says so.
    if (rules.winShape === "fixed-length" && quarters.enabled !== true) {
      addIssue(
        issues,
        "mode.rules-quarters",
        `${path}.quarters.enabled`,
        "true when winShape is fixed-length",
        quarters.enabled,
      );
    }
  }

  // Spec §8.1: private channels are an abuse surface and a moderation
  // obligation, so `directMessages` ships as an off switch, never as a feature.
  // Enforced here rather than only in the presets so a lobby-authored ruleset
  // cannot turn them on either.
  const social = rules.social;
  if (isRecord(social) && social.directMessages !== false) {
    addIssue(
      issues,
      "mode.rules-direct-messages",
      `${path}.social.directMessages`,
      false,
      social.directMessages,
    );
  }

  const timers = rules.timers;
  if (
    options.turnTimerSeconds !== undefined &&
    isRecord(timers) &&
    timers.turnSeconds !== options.turnTimerSeconds
  ) {
    addIssue(
      issues,
      "mode.rules-turn-seconds",
      `${path}.timers.turnSeconds`,
      options.turnTimerSeconds,
      timers.turnSeconds,
    );
  }
}

function validateGlobalEvents(
  globalEvents: DeadlineDashContentValidationInput["globalEvents"],
  globalEventOrder: DeadlineDashContentValidationInput["globalEventOrder"],
  issues: DeadlineDashValidationIssue[],
  authoredDeckIds: ReadonlySet<string>,
): void {
  const actualIds = Object.keys(globalEvents).sort();
  const expectedIds = [...expectedGlobalEventIds].sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    addIssue(issues, "globalEvent.ids", "globalEvents.keys", expectedIds, actualIds);
  }

  for (const [key, event] of Object.entries(globalEvents)) {
    const path = `globalEvents.${key}`;
    if (event.id !== key) {
      addIssue(issues, "globalEvent.id", `${path}.id`, key, event.id);
    }

    const slug = key.slice("globalEvent.".length);
    const camel = slug.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
    if (event.displayNameKey !== `deadlineDash.globalEvent.${camel}.name`) {
      addIssue(
        issues,
        "globalEvent.name-key",
        `${path}.displayNameKey`,
        `deadlineDash.globalEvent.${camel}.name`,
        event.displayNameKey,
      );
    }
    if (event.descriptionKey !== `deadlineDash.globalEvent.${camel}.description`) {
      addIssue(
        issues,
        "globalEvent.name-key",
        `${path}.descriptionKey`,
        `deadlineDash.globalEvent.${camel}.description`,
        event.descriptionKey,
      );
    }

    if (!validGlobalEventScopes.includes(event.scope as never)) {
      addIssue(issues, "globalEvent.scope", `${path}.scope`, validGlobalEventScopes, event.scope);
    }

    // Every authored effect has to be a real effect shape, checked by exactly
    // the walker the board and the decks go through — a quarter event is
    // resolved by the same engine resolver, so anything it cannot interpret is
    // a silent no-op at the worst possible moment.
    validateEffectList(event.effects, `${path}.effects`, issues, authoredDeckIds);

    if (!Array.isArray(event.modifiers)) {
      addIssue(issues, "globalEvent.modifier", `${path}.modifiers`, "modifier array", event.modifiers);
    } else {
      event.modifiers.forEach((modifier, index) => {
        validateGlobalEventModifier(modifier, `${path}.modifiers[${index}]`, issues);
      });
    }

    const effectCount = Array.isArray(event.effects) ? event.effects.length : 0;
    const modifierCount = Array.isArray(event.modifiers) ? event.modifiers.length : 0;
    if (effectCount === 0 && modifierCount === 0) {
      addIssue(
        issues,
        "globalEvent.empty",
        path,
        "at least one effect or quarter modifier",
        { effects: effectCount, modifiers: modifierCount },
      );
    }

    // Spec §5.7: a shock the table can prepare for is a decision, an
    // unannounced one is just variance. Every shipped event is announced.
    if (event.announcedQuarterAhead !== true) {
      addIssue(
        issues,
        "globalEvent.announcement",
        `${path}.announcedQuarterAhead`,
        true,
        event.announcedQuarterAhead,
      );
    }
  }

  const seenInOrder = new Set<string>();
  globalEventOrder.forEach((eventId, index) => {
    if (!(eventId in globalEvents)) {
      addIssue(
        issues,
        "globalEvent.order",
        `globalEventOrder[${index}]`,
        Object.keys(globalEvents),
        eventId,
      );
      return;
    }
    if (seenInOrder.has(eventId)) {
      addIssue(issues, "globalEvent.order", `globalEventOrder[${index}]`, "unique entry", eventId);
    }
    seenInOrder.add(eventId);
  });
  for (const key of Object.keys(globalEvents).sort()) {
    if (!seenInOrder.has(key)) {
      addIssue(
        issues,
        "globalEvent.order",
        `globalEventOrder`,
        `an entry for ${key}`,
        globalEventOrder,
      );
    }
  }
}

function validateGlobalEventModifier(
  modifier: unknown,
  path: string,
  issues: DeadlineDashValidationIssue[],
): void {
  if (!isRecord(modifier) || typeof modifier.type !== "string") {
    addIssue(issues, "globalEvent.modifier", path, "modifier object with a type", modifier);
    return;
  }

  const shape = globalEventModifierShapes[modifier.type as keyof typeof globalEventModifierShapes];
  if (shape === undefined) {
    addIssue(
      issues,
      "globalEvent.modifier",
      `${path}.type`,
      Object.keys(globalEventModifierShapes),
      modifier.type,
    );
    return;
  }

  for (const [field, rule] of Object.entries(shape as Readonly<Record<string, string>>)) {
    const value = modifier[field];
    const fieldPath = `${path}.${field}`;
    if (rule === "non-negative-number") {
      if (!isFiniteNumber(value) || value < 0 || value > 100) {
        addIssue(issues, "globalEvent.modifier", fieldPath, "number in 0-100", value);
      }
    } else if (rule === "signed-number") {
      if (!isFiniteNumber(value) || !Number.isInteger(value) || Math.abs(value) > 100) {
        addIssue(issues, "globalEvent.modifier", fieldPath, "integer in -100..100", value);
      }
    } else if (rule === "money-or-reputation") {
      if (value !== "money" && value !== "reputation") {
        addIssue(issues, "globalEvent.modifier", fieldPath, ["money", "reputation"], value);
      }
    }
  }

  for (const key of Object.keys(modifier).sort()) {
    if (key !== "type" && !(key in shape)) {
      addIssue(issues, "globalEvent.modifier", `${path}.${key}`, "absent", modifier[key]);
    }
  }
}

function validateModes(
  modes: DeadlineDashContentValidationInput["modes"],
  issues: DeadlineDashValidationIssue[],
  rankLadderLength: number,
  decks: DeadlineDashContentValidationInput["decks"],
  ranks: DeadlineDashContentValidationInput["ranks"],
): void {
  /**
   * Physical size of each authored deck — designs expanded by `copies`. This is
   * the check nobody had: `deckQuantities` was only ever compared against the
   * hardcoded table above and never against the cards that exist, which is how
   * four impossible entries shipped. `buildDecks` cycles the pool rather than
   * throwing, so an over-large quantity reprints cards silently instead of
   * failing — the rarity curve lies and nothing says so.
   */
  const physicalSizes = new Map<string, number>();
  for (const deck of decks) {
    physicalSizes.set(
      deck.id,
      deck.cards.reduce((total, card) => total + (card.copies ?? 1), 0),
    );
  }

  const expectedIds = Object.keys(expectedModes);
  const actualIds = Object.keys(modes).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify([...expectedIds].sort())) {
    addIssue(issues, "mode.ids", "modes.keys", [...expectedIds].sort(), actualIds);
  }

  for (const modeId of expectedIds as (keyof typeof expectedModes)[]) {
    const mode = modes[modeId];
    const expected = expectedModes[modeId];
    if (!mode) continue;

    if (mode.id !== modeId) {
      addIssue(issues, "mode.id", `modes.${modeId}.id`, modeId, mode.id);
    }
    if (mode.turnTimerSeconds !== expected.turnTimerSeconds) {
      addIssue(
        issues,
        "mode.timer",
        `modes.${modeId}.turnTimerSeconds`,
        expected.turnTimerSeconds,
        mode.turnTimerSeconds,
      );
    }
    if (!valuesEqual(mode.targetDurationMinutes, expected.targetDurationMinutes)) {
      addIssue(
        issues,
        "mode.target-duration",
        `modes.${modeId}.targetDurationMinutes`,
        expected.targetDurationMinutes,
        mode.targetDurationMinutes,
      );
    }
    if (mode.handLimit !== expected.handLimit) {
      addIssue(
        issues,
        "mode.hand-limit",
        `modes.${modeId}.handLimit`,
        expected.handLimit,
        mode.handLimit,
      );
    }

    validateNumberRecord(
      mode.startingResources,
      expected.startingResources,
      `modes.${modeId}.startingResources`,
      "mode.resource",
      issues,
    );
    validateNumberRecord(
      mode.startingTokens,
      expected.startingTokens,
      `modes.${modeId}.startingTokens`,
      "mode.starting-token",
      issues,
    );
    validateNumberRecord(
      mode.tokenCaps,
      expected.tokenCaps,
      `modes.${modeId}.tokenCaps`,
      "mode.token-cap",
      issues,
    );
    validateNumberRecord(
      mode.deckQuantities,
      expected.deckQuantities,
      `modes.${modeId}.deckQuantities`,
      "mode.deck-quantity",
      issues,
    );

    for (const [deckId, quantity] of Object.entries(mode.deckQuantities)) {
      const available = physicalSizes.get(deckId);
      if (available !== undefined && quantity > available) {
        addIssue(
          issues,
          "mode.deck-quantity-exceeds-deck",
          `modes.${modeId}.deckQuantities.${deckId}`,
          `at most ${available} (the deck's physical size)`,
          quantity,
        );
      }
    }

    if (JSON.stringify(mode.clockDeck.deckIds) !== JSON.stringify(["deck.meeting", "deck.event"])) {
      addIssue(
        issues,
        "mode.clock-deck-ids",
        `modes.${modeId}.clockDeck.deckIds`,
        ["deck.meeting", "deck.event"],
        mode.clockDeck.deckIds,
      );
    }
    validateNumberRecord(
      mode.clockDeck.quantities,
      expected.clockQuantities,
      `modes.${modeId}.clockDeck.quantities`,
      "mode.clock-quantity",
      issues,
    );

    const calculatedTotal =
      mode.clockDeck.quantities.meeting + mode.clockDeck.quantities.event;
    if (mode.clockDeck.quantities.total !== calculatedTotal) {
      addIssue(
        issues,
        "mode.clock-total",
        `modes.${modeId}.clockDeck.quantities.total`,
        calculatedTotal,
        mode.clockDeck.quantities.total,
      );
    }
    if (
      mode.deckQuantities["deck.meeting"] !== mode.clockDeck.quantities.meeting ||
      mode.deckQuantities["deck.event"] !== mode.clockDeck.quantities.event
    ) {
      addIssue(
        issues,
        "mode.clock-total",
        `modes.${modeId}.clockDeck.quantities`,
        {
          meeting: mode.deckQuantities["deck.meeting"],
          event: mode.deckQuantities["deck.event"],
        },
        {
          meeting: mode.clockDeck.quantities.meeting,
          event: mode.clockDeck.quantities.event,
        },
      );
    }
    if (mode.clockDeck.provisional !== true) {
      addIssue(
        issues,
        "mode.clock-provisional",
        `modes.${modeId}.clockDeck.provisional`,
        true,
        mode.clockDeck.provisional,
      );
    }
    if (!valuesEqual(mode.endgame, expected.endgame)) {
      addIssue(
        issues,
        "mode.endgame",
        `modes.${modeId}.endgame`,
        expected.endgame,
        mode.endgame,
      );
    }

    // The two values `ModeRules` mirrors out of `ModeConfig` so that the engine
    // can read them from the frozen snapshot instead of from the live pack
    // (spec §5.9). A mirror that can drift is worse than no mirror: the lobby
    // would advertise one hand limit and the match would enforce another, and a
    // finished match's score sheet would stop matching the mode it was played
    // under. So they are checked rather than trusted.
    if (mode.rules.agency.handLimit !== mode.handLimit) {
      addIssue(
        issues,
        "mode.hand-limit",
        `modes.${modeId}.rules.agency.handLimit`,
        mode.handLimit,
        mode.rules.agency.handLimit,
      );
    }
    const authoredCosts = ranks.map((rank) =>
      rank.promotionFromPrevious === null
        ? 0
        : (rank.promotionFromPrevious.moneyCost[
            modeId as keyof typeof rank.promotionFromPrevious.moneyCost
          ] ?? 0),
    );
    if (!valuesEqual(mode.rules.economy.promotionCostByRankIndex, authoredCosts)) {
      addIssue(
        issues,
        "mode.rules-number",
        `modes.${modeId}.rules.economy.promotionCostByRankIndex`,
        authoredCosts,
        mode.rules.economy.promotionCostByRankIndex,
      );
    }

    if (mode.endgame.type === "additional-rounds") {
      const authored = mode.endgame.scoring;
      const mirrored = {
        rankTierPoints: mode.rules.endgame.rankTierPoints,
        moneyMultiplier: mode.rules.endgame.moneyMultiplier,
        reputationPoints: mode.rules.endgame.reputationPoints,
      };
      if (!valuesEqual(mirrored, authored)) {
        addIssue(
          issues,
          "mode.endgame",
          `modes.${modeId}.rules.endgame`,
          authored,
          mirrored,
        );
      }
    }

    appendModeRulesIssues(
      mode.rules,
      { rankLadderLength, turnTimerSeconds: mode.turnTimerSeconds },
      `modes.${modeId}.rules`,
      issues,
    );
  }
}

function validateRanks(
  ranks: DeadlineDashContentValidationInput["ranks"],
  issues: DeadlineDashValidationIssue[],
): void {
  if (ranks.length !== expectedRanks.length) {
    addIssue(issues, "rank.count", "ranks.length", expectedRanks.length, ranks.length);
  }

  ranks.forEach((rank, index) => {
    const expected = expectedRanks[index];
    if (!expected) return;

    if (rank.id !== expected.id) {
      addIssue(issues, "rank.order", `ranks[${index}].id`, expected.id, rank.id);
    }

    const expectedTier = index + 1;
    if (rank.tier !== expectedTier) {
      addIssue(issues, "rank.tier", `ranks[${index}].tier`, expectedTier, rank.tier);
    }

    if (rank.salary !== expected.salary) {
      addIssue(issues, "rank.salary", `ranks[${index}].salary`, expected.salary, rank.salary);
    }

    if (!valuesEqual(rank.benefits, expected.benefits)) {
      addIssue(
        issues,
        "rank.benefits",
        `ranks[${index}].benefits`,
        expected.benefits,
        rank.benefits,
      );
    }

    if (expected.promotion === null) {
      if (rank.promotionFromPrevious !== null) {
        addIssue(
          issues,
          "rank.requirement",
          "ranks[0].promotionFromPrevious",
          null,
          rank.promotionFromPrevious,
        );
      }
      return;
    }

    const requirement = rank.promotionFromPrevious;
    if (!requirement) {
      addIssue(
        issues,
        "rank.requirement",
        `ranks[${index}].promotionFromPrevious`,
        "promotion requirements",
        requirement,
      );
      return;
    }

    const expectedCosts = {
      "mode.quick": expected.promotion.quick,
      "mode.standard": expected.promotion.standard,
      "mode.marathon": expected.promotion.marathon,
      "mode.campaign": expected.promotion.campaign,
    };
    validateNumberRecord(
      requirement.moneyCost,
      expectedCosts,
      `ranks[${index}].promotionFromPrevious.moneyCost`,
      "rank.requirement",
      issues,
    );
    if (requirement.reputationRequired !== expected.promotion.reputation) {
      addIssue(
        issues,
        "rank.requirement",
        `ranks[${index}].promotionFromPrevious.reputationRequired`,
        expected.promotion.reputation,
        requirement.reputationRequired,
      );
    }
  });
}

function validateCharacters(
  characters: DeadlineDashContentValidationInput["characters"],
  issues: DeadlineDashValidationIssue[],
): void {
  const entries = Object.entries(characters);
  if (entries.length !== expectedCharacters.length) {
    addIssue(issues, "character.count", "characters.keys.length", expectedCharacters.length, entries.length);
  }

  const seenIds = new Map<string, string>();
  entries.forEach(([key, character], index) => {
    const expectedAtIndex = expectedCharacters[index];
    if (expectedAtIndex && key !== expectedAtIndex[0]) {
      addIssue(issues, "character.order", `characters.keys[${index}]`, expectedAtIndex[0], key);
    }
    if (character.id !== key) {
      addIssue(issues, "character.id", `characters.${key}.id`, key, character.id);
    }

    const firstKey = seenIds.get(character.id);
    if (firstKey !== undefined) {
      addIssue(
        issues,
        "character.duplicate-id",
        `characters.${key}.id`,
        `unique (first used at characters.${firstKey}.id)`,
        character.id,
      );
    } else {
      seenIds.set(character.id, key);
    }

    const expected = expectedCharacters.find(([id]) => id === key);
    if (!expected) return;
    if (!isRecord(character.passive) || character.passive.type !== expected[1]) {
      addIssue(
        issues,
        "character.passive",
        `characters.${key}.passive.type`,
        expected[1],
        isRecord(character.passive) ? character.passive.type : character.passive,
      );
    }
    if (!isRecord(character.active) || !isRecord(character.active.effect)) {
      addIssue(
        issues,
        "character.active",
        `characters.${key}.active`,
        "active ability with cooldown and effect",
        character.active,
      );
      return;
    }
    if (character.active.effect.type !== expected[4]) {
      addIssue(
        issues,
        "character.active",
        `characters.${key}.active.effect.type`,
        expected[4],
        character.active.effect.type,
      );
    }
    if (
      !isRecord(character.active.cooldown) ||
      character.active.cooldown.unit !== expected[2] ||
      character.active.cooldown.amount !== expected[3] ||
      !isPositiveInteger(character.active.cooldown.amount)
    ) {
      addIssue(
        issues,
        "character.cooldown",
        `characters.${key}.active.cooldown`,
        { unit: expected[2], amount: expected[3] },
        character.active.cooldown,
      );
    }
  });
}

export function validateDeadlineDashContent(
  content: DeadlineDashContentValidationInput = canonicalContent,
): DeadlineDashValidationResult {
  const issues: DeadlineDashValidationIssue[] = [];

  const authoredDeckIds = validateDecks(content.decks, issues);
  validateBoard(content.board, issues, authoredDeckIds);
  validateModes(content.modes, issues, content.ranks.length, content.decks, content.ranks);
  validateRanks(content.ranks, issues);
  validateCharacters(content.characters, issues);
  validateGlobalEvents(
    content.globalEvents,
    content.globalEventOrder,
    issues,
    authoredDeckIds,
  );

  return { valid: issues.length === 0, issues };
}

export function assertDeadlineDashContent(
  content: DeadlineDashContentValidationInput = canonicalContent,
): asserts content is DeadlineDashContentValidationInput {
  const result = validateDeadlineDashContent(content);
  if (!result.valid) {
    throw new Error(
      `Deadline Dash content validation failed (${result.issues.length} issue${
        result.issues.length === 1 ? "" : "s"
      }):\n${formatDeadlineDashValidationIssues(result.issues)}`,
    );
  }
}
