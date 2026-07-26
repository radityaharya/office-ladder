import {
  BANKRUPTCY_RULES,
  CHAT_MODES,
  ContractValidationError,
  DEADLINE_DASH_RANK_LADDER_LENGTH,
  LEADER_PROTECTIONS,
  MODE_RULES_BOUNDS,
  parseModeRules,
  WIN_SHAPES,
  type BankruptcyRule,
  type ChatMode,
  type LeaderProtection,
  type ModeRules,
  type WinShape,
} from "@office-ladder/contracts";

import { presetRules, type ModePresetId } from "./mode-presets";

/**
 * Client-side validation for a lobby-authored ruleset (spec §8.4).
 *
 * **This mirrors the contracts validator. It never replaces it.** The server
 * calls `parseModeRules` on whatever arrives and refuses the whole object on the
 * first failure; nothing here changes that, and nothing here is allowed to be
 * the only thing standing between a hostile ruleset and `GameState.rules`. The
 * job of this module is narrower and purely a courtesy: tell the host which
 * field is wrong *before* they submit, instead of trading a round trip for a
 * single error string.
 *
 * Two layers, deliberately:
 *
 * 1. {@link modeRulesFieldIssues} walks every field and reports **all** of them,
 *    reading its bounds from `MODE_RULES_BOUNDS` — the table contracts exports
 *    precisely so "the lobby needs them to render sliders that cannot author an
 *    invalid ruleset". A form that reports one error per submit is a form nobody
 *    finishes.
 * 2. {@link gateModeRules} calls the real `parseModeRules` and reports whatever
 *    it throws. This is the submit gate, so the thing that decides whether the
 *    button is live is the *actual* validator rather than a copy of it — if
 *    layer 1 ever drifts, the gate is still right and the drift shows up as a
 *    field that looks fine but will not submit.
 */

export type ModeRulesIssue = {
  /** The contract's own dotted path, e.g. `rules.quarters.count`. */
  readonly path: string;
  readonly message: string;
};

type Bounds = { readonly minimum: number; readonly maximum: number };

function integerIssue(value: number, path: string, bounds: Bounds): ModeRulesIssue | null {
  if (!Number.isSafeInteger(value)) return { path, message: "must be a whole number" };
  if (value < bounds.minimum || value > bounds.maximum) {
    return {
      path,
      message: `must be between ${String(bounds.minimum)} and ${String(bounds.maximum)}`,
    };
  }
  return null;
}

function numberIssue(value: number, path: string, bounds: Bounds): ModeRulesIssue | null {
  if (!Number.isFinite(value)) return { path, message: "must be a finite number" };
  if (value < bounds.minimum || value > bounds.maximum) {
    return {
      path,
      message: `must be between ${String(bounds.minimum)} and ${String(bounds.maximum)}`,
    };
  }
  return null;
}

function enumIssue<Allowed extends string>(
  value: string,
  allowed: readonly Allowed[],
  path: string,
  label: string,
): ModeRulesIssue | null {
  return (allowed as readonly string[]).includes(value)
    ? null
    : { path, message: `must be ${label}` };
}

/**
 * Every field, not only the ones the builder exposes.
 *
 * The unexposed fields are inherited verbatim from a shipped preset, so they are
 * in range today — but "today" is doing a lot of work in that sentence. A preset
 * edited out of bounds in `packages/content` would otherwise surface as an
 * opaque 400 on create; here it surfaces as a named field.
 */
export function modeRulesFieldIssues(rules: ModeRules): readonly ModeRulesIssue[] {
  const bounds = MODE_RULES_BOUNDS;
  const issues: (ModeRulesIssue | null)[] = [
    enumIssue(rules.winShape, WIN_SHAPES, "rules.winShape", "a supported win shape"),

    integerIssue(rules.quarters.count, "rules.quarters.count", bounds.quarterCount),
    integerIssue(
      rules.quarters.roundsEach,
      "rules.quarters.roundsEach",
      bounds.quarterRoundsEach,
    ),

    integerIssue(
      rules.economy.maxLoanPrincipal,
      "rules.economy.maxLoanPrincipal",
      bounds.maxLoanPrincipal,
    ),
    integerIssue(
      rules.economy.interestBasisPoints,
      "rules.economy.interestBasisPoints",
      bounds.interestBasisPoints,
    ),
    enumIssue(
      rules.economy.bankruptcy,
      BANKRUPTCY_RULES,
      "rules.economy.bankruptcy",
      "a supported bankruptcy rule",
    ),

    numberIssue(
      rules.board.claimCostMultiplier,
      "rules.board.claimCostMultiplier",
      bounds.claimCostMultiplier,
    ),
    numberIssue(
      rules.board.tollMultiplier,
      "rules.board.tollMultiplier",
      bounds.tollMultiplier,
    ),
    integerIssue(
      rules.board.maxPlacementsPerPlayer,
      "rules.board.maxPlacementsPerPlayer",
      bounds.maxPlacementsPerPlayer,
    ),

    integerIssue(
      rules.projects.maxConcurrentPerPlayer,
      "rules.projects.maxConcurrentPerPlayer",
      bounds.maxConcurrentProjectsPerPlayer,
    ),
    integerIssue(
      rules.projects.deadlineRounds,
      "rules.projects.deadlineRounds",
      bounds.projectDeadlineRounds,
    ),

    integerIssue(
      rules.conflict.heatPerAttack,
      "rules.conflict.heatPerAttack",
      bounds.heatPerAttack,
    ),
    integerIssue(
      rules.conflict.heatThreshold,
      "rules.conflict.heatThreshold",
      bounds.heatThreshold,
    ),
    enumIssue(
      rules.conflict.leaderProtection,
      LEADER_PROTECTIONS,
      "rules.conflict.leaderProtection",
      "a supported leader protection",
    ),

    integerIssue(rules.agency.energyPerPip, "rules.agency.energyPerPip", bounds.energyPerPip),
    integerIssue(rules.agency.maxPipAdjust, "rules.agency.maxPipAdjust", bounds.maxPipAdjust),
    integerIssue(
      rules.agency.freeActionsPerTurn,
      "rules.agency.freeActionsPerTurn",
      bounds.freeActionsPerTurn,
    ),

    integerIssue(
      rules.interaction.reactionWindowSeconds,
      "rules.interaction.reactionWindowSeconds",
      bounds.reactionWindowSeconds,
    ),

    enumIssue(rules.social.chat, CHAT_MODES, "rules.social.chat", "a supported chat mode"),

    integerIssue(rules.timers.turnSeconds, "rules.timers.turnSeconds", bounds.turnSeconds),
    rules.timers.chessClockSeconds === null
      ? null
      : integerIssue(
          rules.timers.chessClockSeconds,
          "rules.timers.chessClockSeconds",
          bounds.chessClockSeconds,
        ),
  ];

  // §8.4's own worked example of a cheat: an all-false winPaths is not a
  // stalemate, it is an unwinnable match nobody discovers until the end.
  if (
    !rules.winPaths.promotion &&
    !rules.winPaths.wealth &&
    !rules.winPaths.influence &&
    !rules.winPaths.survival
  ) {
    issues.push({
      path: "rules.winPaths",
      message: "must enable at least one win path",
    });
  }

  // Length equality, same as the contract: a short ladder makes the top ranks
  // read `undefined` and pay no upkeep at all.
  if (rules.economy.upkeepByRankIndex.length !== DEADLINE_DASH_RANK_LADDER_LENGTH) {
    issues.push({
      path: "rules.economy.upkeepByRankIndex",
      message: `must have exactly ${String(DEADLINE_DASH_RANK_LADDER_LENGTH)} entries, one per rank`,
    });
  }
  rules.economy.upkeepByRankIndex.forEach((charge, index) => {
    issues.push(
      integerIssue(
        charge,
        `rules.economy.upkeepByRankIndex[${String(index)}]`,
        bounds.upkeepPerRound,
      ),
    );
  });

  // §8.1: DMs are an off switch, not a feature. The contract refuses `true`
  // outright, so the builder never offers the control — but a ruleset assembled
  // anywhere else still has to fail here rather than at the server.
  if (rules.social.directMessages) {
    issues.push({
      path: "rules.social.directMessages",
      message: "must be false: direct messages are not available",
    });
  }

  const [thinkLow, thinkHigh] = rules.bots.thinkMsRange;
  issues.push(integerIssue(thinkLow, "rules.bots.thinkMsRange[0]", bounds.botThinkMs));
  issues.push(integerIssue(thinkHigh, "rules.bots.thinkMsRange[1]", bounds.botThinkMs));
  if (thinkLow > thinkHigh) {
    issues.push({
      path: "rules.bots.thinkMsRange",
      message: "must be ordered from low to high",
    });
  }

  return issues.filter((issue): issue is ModeRulesIssue => issue !== null);
}

export type ModeRulesGate =
  | { readonly ok: true; readonly rules: ModeRules }
  | { readonly ok: false; readonly issue: ModeRulesIssue };

/**
 * The submit gate: the contract's own parser, run on the client.
 *
 * `parseModeRules` is pure and has no server dependency, so there is no reason
 * to approximate it. What comes back on success is the parser's own rebuilt
 * object — the same normalisation the server will perform — so the body posted
 * is exactly the body that was validated.
 */
export function gateModeRules(rules: ModeRules): ModeRulesGate {
  try {
    return { ok: true, rules: parseModeRules(rules) };
  } catch (error: unknown) {
    if (error instanceof ContractValidationError) {
      return { ok: false, issue: { path: error.path, message: error.reason } };
    }
    throw error;
  }
}

export function issueFor(
  issues: readonly ModeRulesIssue[],
  path: string,
): ModeRulesIssue | null {
  return issues.find((issue) => issue.path === path) ?? null;
}

/* ------------------------------------------------------------------- edits */

/**
 * A draft is a whole `ModeRules`, always — never a patch.
 *
 * The contract requires every field to be present (`requireExactKeys` at every
 * level, no defaulting: "an omitted field is a field the author did not agree
 * to"). Modelling the draft as a partial and filling gaps at submit time would
 * put the defaulting back on the client, which is the thing §8.4 refuses.
 */
export type ModeRulesDraft = {
  readonly baseModeId: ModePresetId;
  readonly rules: ModeRules;
};

export function draftFromPreset(baseModeId: ModePresetId): ModeRulesDraft {
  return { baseModeId, rules: presetRules(baseModeId) };
}

type Section = Exclude<keyof ModeRules, "winShape">;

/** Immutable replacement of one field inside one section. */
export function editSection<S extends Section>(
  rules: ModeRules,
  section: S,
  patch: Partial<ModeRules[S]>,
): ModeRules {
  return { ...rules, [section]: { ...rules[section], ...patch } };
}

export function editWinShape(rules: ModeRules, winShape: WinShape): ModeRules {
  return { ...rules, winShape };
}

/* --------------------------------------------------- typed option vocabularies */

/**
 * Option text is split into a short label and a sentence.
 *
 * The label goes in the `<option>`, which lives in a grid cell narrower than the
 * sentence — a truncated option is a choice nobody can read. The sentence is
 * rendered under the closed select, so the *current* choice is always spelled
 * out in full and the list stays scannable.
 */
export const WIN_SHAPE_LABELS: Readonly<Record<WinShape, string>> = {
  race: "Race",
  "fixed-length": "Fixed length",
  objectives: "Objectives",
  survival: "Survival",
};

export const WIN_SHAPE_HINTS: Readonly<Record<WinShape, string>> = {
  race: "First to Director wins outright.",
  "fixed-length": "Highest score once the rounds run out.",
  objectives: "Resolves when objectives complete.",
  survival: "The last player still standing wins.",
};

export const BANKRUPTCY_LABELS: Readonly<Record<BankruptcyRule, string>> = {
  none: "Nothing",
  demote: "Lose a rank",
  eliminate: "Out of the match",
};

export const BANKRUPTCY_HINTS: Readonly<Record<BankruptcyRule, string>> = {
  none: "Money can hit zero with no penalty.",
  demote: "Hitting zero costs you a rank.",
  eliminate: "Hitting zero removes you from the match.",
};

export const LEADER_PROTECTION_LABELS: Readonly<Record<LeaderProtection, string>> = {
  none: "None",
  soft: "Soft",
  hard: "Hard",
};

export const LEADER_PROTECTION_HINTS: Readonly<Record<LeaderProtection, string>> = {
  none: "Anyone can pile on whoever is ahead.",
  soft: "Attacking the leader costs the attacker more.",
  hard: "Whoever is ahead cannot be targeted at all.",
};

export const CHAT_LABELS: Readonly<Record<ChatMode, string>> = {
  off: "Off",
  quick: "Canned lines",
  full: "Free text",
};

export const CHAT_HINTS: Readonly<Record<ChatMode, string>> = {
  off: "No table talk in the client.",
  quick: "A fixed set of phrases, nothing typed.",
  full: "Anything players type.",
};
