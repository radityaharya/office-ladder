import { deadlineDashModes } from "@office-ladder/content";
import { DEFAULT_ROOM_MODE, type ModeRules } from "@office-ladder/contracts";

/**
 * Every shipped preset, described **from its own `rules` block** rather than
 * from a hand-written blurb.
 *
 * The reason is not purity. A blurb is a second copy of the ruleset written in
 * English, and the moment somebody flips `conflict.elimination` in
 * `packages/content/src/deadline-dash/modes.ts` the blurb is a lie that nothing
 * type-checks and no test catches — the lobby would keep promising a mode the
 * server no longer runs. Everything on a preset card here is read out of the
 * preset at render time, so the only way for the copy to be wrong is for the
 * data to be wrong.
 *
 * What *is* authored here is the **selection**: which of the ~100 fields in
 * `ModeRules` are worth a player's attention before they sit down. That is a
 * design judgement and it is stated once, in {@link MODE_FACETS} and
 * {@link MODE_TAGS}, not scattered through JSX.
 */

/** The preset ids the content pack actually ships, in its own authored order. */
export const MODE_PRESET_IDS = Object.keys(
  deadlineDashModes,
) as readonly ModePresetId[];

export type ModePresetId = keyof typeof deadlineDashModes;

/**
 * Spec §4.2: "`mode.standard` … **The default.**" Every room created before this
 * picker existed was `mode.quick`, because that was the literal hardcoded into
 * the create call.
 *
 * Read off the contract's own `DEFAULT_ROOM_MODE` rather than restated, which is
 * the whole reason that constant exists — "so the create form and any
 * server-side default read the same value instead of each hardcoding one". The
 * annotation is load-bearing: if the contract ever defaults to a mode the content
 * pack does not ship, this line stops compiling instead of the picker quietly
 * pre-selecting nothing.
 */
export const DEFAULT_MODE_PRESET_ID: ModePresetId = DEFAULT_ROOM_MODE;

export function isModePresetId(value: string): value is ModePresetId {
  return (MODE_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * The preset's ruleset, structurally identical to the contract's `ModeRules` —
 * `packages/contracts/src/mode-rules.ts` mirrors the content schema deliberately
 * and documents why it does not import it. This assignment is the point where
 * the two would fail to typecheck if they ever drifted.
 */
export function presetRules(modeId: ModePresetId): ModeRules {
  return deadlineDashModes[modeId].rules;
}

export function presetName(modeId: ModePresetId): string {
  const key = deadlineDashModes[modeId].displayNameKey
    .replace("deadlineDash.mode.", "")
    .replace(".name", "");
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** `[40, 60]` → `"40–60 min"`. Presets carry a target; a custom ruleset does not. */
function presetDurationLabel(modeId: ModePresetId): string {
  const [low, high] = deadlineDashModes[modeId].targetDurationMinutes;
  return low === high ? `${String(low)} min` : `${String(low)}–${String(high)} min`;
}

/* ------------------------------------------------------------------ facets */

export type ModeFacet = {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
};

type FacetSpec = {
  readonly id: string;
  readonly label: string;
  readonly read: (rules: ModeRules) => boolean;
};

/**
 * The eight switches that change what a *turn* is like — the systems a player
 * either gets to use or does not.
 *
 * Every one of them is off in `mode.quick` and on in the other three, which is
 * precisely why they are the grid: they are the shape of the "is this a
 * roll-and-move game or an economy game" question, and that is the first thing
 * anyone choosing a mode is actually asking.
 */
const MODE_FACETS: readonly FacetSpec[] = [
  { id: "projects", label: "Projects", read: (rules) => rules.projects.enabled },
  {
    id: "ownership",
    label: "Tile ownership",
    read: (rules) => rules.board.ownershipEnabled,
  },
  {
    id: "placements",
    label: "Placements",
    read: (rules) => rules.board.placementsEnabled,
  },
  { id: "trading", label: "Trading", read: (rules) => rules.interaction.tradesEnabled },
  {
    id: "auctions",
    label: "Auctions",
    read: (rules) => rules.interaction.auctionsEnabled,
  },
  { id: "loans", label: "Loans", read: (rules) => rules.economy.loansEnabled },
  { id: "upkeep", label: "Upkeep", read: (rules) => rules.economy.upkeepEnabled },
  {
    id: "sabotage",
    label: "Sabotage",
    read: (rules) => rules.conflict.targetedAttacks,
  },
];

/* -------------------------------------------------------------------- tags */

export type ModeTagTone = "neutral" | "caution";

export type ModeTag = {
  readonly id: string;
  readonly label: string;
  readonly tone: ModeTagTone;
};

type TagSpec = ModeTag & { readonly read: (rules: ModeRules) => boolean };

/**
 * Facts that only exist when they are switched on, so a row reading "off" would
 * be noise. These are what separate the three big presets from each other —
 * standard, marathon and campaign all switch on every facet above, and differ
 * here and in their quarter shape.
 *
 * `elimination` carries the caution tone rather than a neutral one: per spec
 * §12.4 a rule that can remove a player from the table is a warning register,
 * not a feature bullet. It is still labelled in words — never tone alone
 * (DESIGN.md §8).
 */
const MODE_TAGS: readonly TagSpec[] = [
  {
    id: "quarterly-events",
    label: "Quarterly events",
    tone: "neutral",
    read: (rules) => rules.quarters.enabled && rules.quarters.globalEvents,
  },
  {
    id: "hidden-roles",
    label: "Hidden roles",
    tone: "neutral",
    read: (rules) => rules.hidden.rolesEnabled,
  },
  {
    id: "secret-objectives",
    label: "Secret objectives",
    tone: "neutral",
    read: (rules) => rules.hidden.secretObjectives,
  },
  {
    id: "hidden-hands",
    label: "Hidden hands",
    tone: "neutral",
    read: (rules) => rules.hidden.hiddenHands,
  },
  {
    id: "role-win-conditions",
    label: "Secret win conditions",
    tone: "neutral",
    read: (rules) => rules.hidden.roleWinConditions,
  },
  {
    id: "elimination",
    label: "Elimination",
    tone: "caution",
    read: (rules) => rules.conflict.elimination,
  },
];

/* ----------------------------------------------------------------- summary */

export type ModeSummary = {
  /** "4 quarters of 4 rounds" — the match's own length, in its own units. */
  readonly length: string;
  /** "25s per turn". */
  readonly turnClock: string;
  /** How the match resolves once its length runs out. */
  readonly ending: string;
  /** Which win paths score. */
  readonly scoring: string;
  /** What running out of money costs. */
  readonly stakes: string;
  readonly facets: readonly ModeFacet[];
  readonly tags: readonly ModeTag[];
};

const ENDING_BY_WIN_SHAPE = {
  race: "first to Director wins",
  "fixed-length": "highest score at the end",
  objectives: "resolves on objectives",
  survival: "last player standing wins",
} as const;

const STAKES_BY_BANKRUPTCY = {
  none: "Running out of money costs nothing.",
  demote: "Running out of money demotes you a rank.",
  eliminate: "Running out of money puts you out of the match.",
} as const;

const WIN_PATH_LABELS = [
  ["promotion", "promotion"],
  ["wealth", "wealth"],
  ["influence", "influence"],
  ["survival", "survival"],
] as const;

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** "a, b and c" — an English list, not a comma-joined array dump. */
function joinWords(words: readonly string[]): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/**
 * Everything a picker card says, derived. Takes a `ModeRules` rather than a
 * preset id so the custom-ruleset card describes itself through exactly the same
 * code path — a custom mode that reads differently from a preset would be
 * describing itself with different words for the same data.
 */
export function summarizeModeRules(rules: ModeRules): ModeSummary {
  const { quarters } = rules;
  const length = quarters.enabled
    ? `${plural(quarters.count, "quarter")} of ${plural(quarters.roundsEach, "round")}`
    : "No fixed length";

  const scoringPaths = WIN_PATH_LABELS.filter(([key]) => rules.winPaths[key]).map(
    ([, label]) => label,
  );

  return {
    length,
    turnClock: `${String(rules.timers.turnSeconds)}s per turn`,
    ending: ENDING_BY_WIN_SHAPE[rules.winShape],
    scoring:
      scoringPaths.length === 0
        ? "No win path is switched on."
        : `Scores on ${joinWords(scoringPaths)}.`,
    stakes: STAKES_BY_BANKRUPTCY[rules.economy.bankruptcy],
    facets: MODE_FACETS.map(({ id, label, read }) => ({
      id,
      label,
      enabled: read(rules),
    })),
    tags: MODE_TAGS.filter(({ read }) => read(rules)).map(({ id, label, tone }) => ({
      id,
      label,
      tone,
    })),
  };
}

export type ModePreset = {
  readonly id: ModePresetId;
  readonly name: string;
  readonly durationLabel: string;
  readonly summary: ModeSummary;
};

function modePreset(modeId: ModePresetId): ModePreset {
  return {
    id: modeId,
    name: presetName(modeId),
    durationLabel: presetDurationLabel(modeId),
    summary: summarizeModeRules(presetRules(modeId)),
  };
}

export function modePresets(): readonly ModePreset[] {
  return MODE_PRESET_IDS.map(modePreset);
}

/**
 * Which preset, if any, a ruleset is byte-for-byte identical to. Used to tell a
 * host that their "custom" ruleset is still just Standard, rather than letting
 * them post an identical object under a different name.
 */
export function matchingPresetId(rules: ModeRules): ModePresetId | null {
  return MODE_PRESET_IDS.find((id) => deepEquals(presetRules(id), rules)) ?? null;
}

/**
 * Structural equality, not `JSON.stringify` equality: a draft is built by
 * spreading a preset, and a spread that happens to reorder a key would make an
 * untouched ruleset look edited.
 */
function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((entry, index) => deepEquals(entry, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightRecord = right as Record<string, unknown>;
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        deepEquals((left as Record<string, unknown>)[key], rightRecord[key]),
    )
  );
}
