import {
  deadlineDashBoard,
  deadlineDashCharacters,
  deadlineDashDecks,
  deadlineDashModes,
  deadlineDashRanks,
} from "../deadline-dash";
import type {
  BoardConfig,
  CharacterConfig,
  DeckConfig,
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
      energy: 5,
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
  "mode.marathon": {
    targetDurationMinutes: [60, 120],
    turnTimerSeconds: 30,
    startingResources: {
      money: 1500,
      reputation: 0,
      energy: 5,
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
      "deck.board-meeting": 25,
      "deck.annual-event": 25,
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
} as const;

const expectedRanks = [
  { id: "rank.intern", salary: 200, promotion: null, benefits: [] },
  {
    id: "rank.staff",
    salary: 400,
    promotion: { quick: 250, marathon: 500, reputation: 3 },
    benefits: [{ type: "salaryBonusOnReceptionistPass", amount: 100 }],
  },
  {
    id: "rank.senior-staff",
    salary: 600,
    promotion: { quick: 600, marathon: 1200, reputation: 5 },
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
    promotion: { quick: 1000, marathon: 2000, reputation: 7 },
    benefits: [{ type: "increaseMaximumEnergy", amount: 2 }],
  },
  {
    id: "rank.assistant-manager",
    salary: 1000,
    promotion: { quick: 1500, marathon: 3000, reputation: 9 },
    benefits: [{ type: "rerollNormalMovement", usesPerLap: 1 }],
  },
  {
    id: "rank.manager",
    salary: 1200,
    promotion: { quick: 2250, marathon: 4500, reputation: 11 },
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
    promotion: { quick: 3000, marathon: 6000, reputation: 13 },
    benefits: [{ type: "multiplyAnnualEventReward", multiplier: 2 }],
  },
  {
    id: "rank.general-manager",
    salary: 1600,
    promotion: { quick: 4000, marathon: 8000, reputation: 15 },
    benefits: [
      { type: "ignoreNegativeEffect", usesPerLap: 1, sources: ["tile", "card"] },
    ],
  },
  {
    id: "rank.director",
    salary: 2000,
    promotion: { quick: 5000, marathon: 10000, reputation: 17 },
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

const validStatusIds = new Set([
  "status.audit",
  "status.burnout-tile",
  "status.ignore-next-work-energy",
  "status.skip-next-tile-effect",
  "status.next-roll-extra-movement",
  "status.next-salary-multiplier",
]);

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
  | "mode.clock-deck-ids"
  | "mode.clock-quantity"
  | "mode.clock-total"
  | "mode.clock-provisional"
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
};

const canonicalContent: DeadlineDashContentValidationInput = {
  board: deadlineDashBoard,
  modes: deadlineDashModes,
  ranks: deadlineDashRanks,
  characters: deadlineDashCharacters,
  decks: deadlineDashDecks,
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
      if (
        effect.amount !== 1 ||
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

      const totalRanges: { readonly start: number; readonly end: number; readonly path: string }[] = [];
      effect.outcomes.forEach((outcome, outcomeIndex) => {
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
      if (!isPositiveInteger(effect.count) || effect.source !== "tile") {
        invalidShape("positive tile skipTurns effect");
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
      const coordinate = end - index + 1;
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

function validateModes(
  modes: DeadlineDashContentValidationInput["modes"],
  issues: DeadlineDashValidationIssue[],
): void {
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
      "mode.marathon": expected.promotion.marathon,
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
  validateModes(content.modes, issues);
  validateRanks(content.ranks, issues);
  validateCharacters(content.characters, issues);

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
