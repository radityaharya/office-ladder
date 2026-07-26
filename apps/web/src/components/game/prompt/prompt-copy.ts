import {
  deadlineDashBoard,
  type BoardTile,
  type EffectDescriptor,
  type RollOutcome,
  type TileDecisionConfig,
} from "@office-ladder/content";

/**
 * Copy for the game's decision prompts, keyed by prompt kind.
 *
 * Two kinds exist in the engine today
 * (`packages/engine/src/execution/respond-to-prompt.ts`):
 * - `audit-release` — hard-coded in the engine.
 * - any authored `BoardTile.decision.kind` (today `training-course`) — fully
 *   generic over content, so the copy below is derived from the authored
 *   `TileDecisionConfig` rather than restated. New authored decisions get real
 *   copy with no change here.
 *
 * Anything else falls back to generic-but-correct copy derived from the ids the
 * server sent, so an unknown kind — or a known kind that grows an unknown
 * option — renders something truthful instead of blank.
 *
 * Nothing in this file may describe a mechanic the engine does not implement.
 */

export type PromptTone = "caution" | "info";

export type PromptOptionCopy = {
  readonly optionId: string;
  /** Command voice. Rendered uppercase by `label` typography, so keep it terse. */
  readonly label: string;
  /** Mono column value. Always carries an explicit sign or an explicit words-only cost. */
  readonly cost: string;
  /** Sentence case. Must state what happens on success *and* on failure. */
  readonly outcome: string;
  /** Optional mono caption qualifier (balances, odds, clamping behaviour). */
  readonly note: string | null;
  /**
   * Non-null only when the engine would reject this response outright — the
   * button is disabled and this text explains why. Never used for a response
   * the engine merely clamps.
   */
  readonly disabledReason: string | null;
};

export type PromptCopy = {
  readonly kind: string;
  readonly kicker: string;
  readonly title: string;
  readonly summary: string;
  readonly tone: PromptTone;
  readonly options: readonly PromptOptionCopy[];
  /** The single §6.1 primary action. Never more than one. */
  readonly primaryOptionId: string | null;
};

/**
 * The audit fine, read from the authored content pack rather than restated —
 * `tile.board.22.audit`'s `auditConfinement.release.alternativeFine`. The
 * engine's own `AUDIT_FINE` constant is the same 500, and the server's bot
 * policy reads the authored value the same way.
 */
export const AUDIT_FINE: number = readAuthoredAuditFine();

export function resolvePromptCopy(input: {
  readonly kind: string;
  readonly optionIds: readonly string[];
  readonly money: number | null;
}): PromptCopy {
  const base =
    input.kind === "audit-release"
      ? auditReleaseCopy(input.money)
      : (tileDecisionCopy(input.kind, input.money) ?? genericCopy(input.kind));

  return { ...base, options: selectOptions(base.options, input.optionIds) };
}

/** Exactly one primary, even for an unknown kind whose options we cannot rank. */
export function resolvePrimaryOptionId(copy: PromptCopy): string | null {
  const optionIds = copy.options.map((option) => option.optionId);
  if (copy.primaryOptionId !== null && optionIds.includes(copy.primaryOptionId)) {
    return copy.primaryOptionId;
  }

  return optionIds.at(-1) ?? null;
}

/**
 * A short, stable case reference derived from the real decision point id — the
 * engine mints those as `<commandId>:<suffix>`, so the leading characters are
 * the distinguishing part.
 */
export function promptCaseRef(decisionPointId: string): string {
  const head = decisionPointId.replace(/[^0-9a-z]/gi, "").slice(0, 6).toUpperCase();
  return head.length === 0 ? "#UNKNOWN" : `#${head}`;
}

export function formatMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function auditReleaseCopy(money: number | null): PromptCopy {
  // respond-to-prompt.ts clamps: `Math.max(0, money.value - AUDIT_FINE)`, then
  // releases unconditionally. Paying while short does NOT fail — it empties the
  // account and still clears the audit — so the option is never disabled.
  const deducted = money === null ? AUDIT_FINE : Math.min(AUDIT_FINE, Math.max(0, money));
  const isShort = money !== null && money < AUDIT_FINE;

  return {
    kind: "audit-release",
    kicker: "Decision required",
    title: "Audit review",
    summary:
      "Compliance is holding you at the audit desk. Choose how you leave. Either response spends this turn — you do not move, and play passes on once it is filed.",
    tone: "caution",
    primaryOptionId: "attempt-roll",
    options: [
      {
        optionId: "pay-fine",
        label: "Pay the fine",
        cost: `-${formatMoney(deducted)}`,
        outcome:
          "Settles the audit on the spot. You are released immediately and roll as normal on your next turn.",
        note: auditFineNote(money, isShort),
        disabledReason: null,
      },
      {
        optionId: "attempt-roll",
        label: "Attempt release roll",
        cost: "No fee",
        outcome:
          "Rolls 2d6. Matching faces release you; any other result keeps this notice open and asks you again next turn.",
        note: "6 of the 36 face combinations release you. A failed attempt does not clear the confinement.",
        disabledReason: null,
      },
    ],
  };
}

function auditFineNote(money: number | null, isShort: boolean): string | null {
  if (money === null) return `Recorded fine ${formatMoney(AUDIT_FINE)}.`;
  if (isShort) {
    return `Recorded fine ${formatMoney(AUDIT_FINE)}; you hold ${formatMoney(money)}. The balance floors at ${formatMoney(0)} and the release still stands.`;
  }

  return `On hand ${formatMoney(money)} -> ${formatMoney(money - AUDIT_FINE)} after settlement.`;
}

/**
 * Copy for an authored tile decision, built entirely from the content pack: the
 * cost, the dice, every outcome band and the decline branch's effects. The
 * engine rejects an accept the player cannot pay for
 * (`ILLEGAL_ACTION: "Accepting this decision costs more than the player has"`),
 * so that branch really is disabled rather than clamped — the opposite of the
 * audit fine. In practice `whenUnaffordable: "resolve-decline"` means the prompt
 * is not even opened in that case; this covers a stale projection.
 */
function tileDecisionCopy(kind: string, money: number | null): PromptCopy | null {
  const decision = findAuthoredDecision(kind);
  if (decision === null) return null;

  const { cost, roll } = decision.accept;
  const costsMoney = cost.resource === "money";
  const affordable = !costsMoney || money === null || money >= cost.amount;

  return {
    kind,
    kicker: "Decision required",
    title: humanizeId(kind),
    summary:
      "An optional deal, not a penalty. Taking it pays the cost up front and rolls for the payoff; walking away costs nothing. Either response spends this turn — you do not move, and play passes on once it is filed.",
    tone: "info",
    primaryOptionId: affordable ? decision.accept.optionId : decision.decline.optionId,
    options: [
      {
        optionId: decision.accept.optionId,
        label: humanizeId(decision.accept.optionId),
        cost: `-${describeResourceAmount(cost.resource, cost.amount)}`,
        outcome: `Pays ${describeResourceAmount(cost.resource, cost.amount)} and rolls ${roll.count}d${roll.sides}. ${describeOutcomes(decision.accept.outcomes)}`,
        note: affordable
          ? null
          : `You hold ${money === null ? "an unknown balance" : formatMoney(money)}, short of the ${describeResourceAmount(cost.resource, cost.amount)} cost.`,
        disabledReason: affordable
          ? null
          : "The server rejects a deal the acting player cannot pay for.",
      },
      {
        optionId: decision.decline.optionId,
        label: humanizeId(decision.decline.optionId),
        cost: "No fee",
        outcome: describeDecline(decision.decline.effects),
        note: null,
        disabledReason: null,
      },
    ],
  };
}

function genericCopy(kind: string): PromptCopy {
  const title = humanizeId(kind);

  return {
    kind,
    kicker: "Decision required",
    title: title.length === 0 ? "Decision required" : title,
    summary:
      "The office systems need a response from you before this turn can continue. Every response below was declared legal by the server; the committed result is applied as soon as you file one.",
    tone: "caution",
    primaryOptionId: null,
    options: [],
  };
}

function selectOptions(
  authored: readonly PromptOptionCopy[],
  optionIds: readonly string[],
): readonly PromptOptionCopy[] {
  const offered = new Set(optionIds);
  const known = authored.filter((option) => offered.has(option.optionId));
  const knownIds = new Set(known.map((option) => option.optionId));
  const unknown = optionIds
    .filter((optionId) => !knownIds.has(optionId))
    .map(genericOptionCopy);

  return [...known, ...unknown];
}

function genericOptionCopy(optionId: string): PromptOptionCopy {
  const label = humanizeId(optionId);

  return {
    optionId,
    label: label.length === 0 ? optionId : label,
    cost: "Not stated",
    outcome: "The server applies the committed result of this response.",
    note: null,
    disabledReason: null,
  };
}

function findAuthoredDecision(kind: string): TileDecisionConfig | null {
  // Widened to the schema type: the authored literal only carries `decision` on
  // the tiles that actually ask a question.
  const tiles: readonly BoardTile[] = deadlineDashBoard.spaces;
  for (const tile of tiles) {
    const decision = tile.decision;
    if (decision !== undefined && decision.kind === kind) return decision;
  }

  return null;
}

function describeOutcomes(outcomes: readonly RollOutcome[]): string {
  const clauses = outcomes.map(
    (outcome) => `${describeRollCondition(outcome.when)} ${describeEffects(outcome.effects)}`,
  );

  return clauses.length === 0
    ? "The server applies the committed outcome."
    : clauses.join(" ");
}

function describeRollCondition(when: RollOutcome["when"]): string {
  if ("total" in when) return `Totals ${when.total[0]}-${when.total[1]}:`;
  return when.doubles ? "Matching faces:" : "Anything but matching faces:";
}

function describeDecline(effects: readonly EffectDescriptor[]): string {
  return effects.length === 0
    ? "Walks away. Nothing is gained or lost."
    : `Walks away and pays nothing. ${startSentence(describeEffects(effects))}`;
}

/**
 * Effect clauses are written lower-case so they can sit after a colon; this
 * lifts one into sentence position.
 */
function startSentence(clause: string): string {
  return clause.length === 0 ? clause : clause.charAt(0).toUpperCase() + clause.slice(1);
}

function describeEffects(effects: readonly EffectDescriptor[]): string {
  return effects.map(describeEffect).join(" ");
}

/**
 * Compact description of an authored effect. Deliberately total with a generic
 * default rather than exhaustive: content can add effect types at any time and
 * an unhandled one must still render a true sentence.
 */
function describeEffect(effect: EffectDescriptor): string {
  switch (effect.type) {
    case "modifyResource":
      return `${effect.amount >= 0 ? "gain" : "lose"} ${describeResourceAmount(effect.resource, Math.abs(effect.amount))}.`;
    case "payResource":
      return `pay ${describeResourceAmount(effect.resource, effect.amount)}.`;
    case "restoreResourceToMaximum":
      return `restore ${describeResourceLabel(effect.resource)} to maximum.`;
    case "skipTurns":
      return `skip ${effect.count} turn${effect.count === 1 ? "" : "s"}.`;
    case "drawCards":
      return `draw ${effect.count} card${effect.count === 1 ? "" : "s"}.`;
    case "grantExtraRoll":
      return "take one extra roll.";
    case "attemptPromotion":
      return "attempt the next promotion.";
    default:
      return `the ${splitCamelCase(effect.type)} effect applies.`;
  }
}

function describeResourceAmount(resource: string, amount: number): string {
  if (resource === "money" || resource === "resource.money") return formatMoney(amount);
  return `${amount} ${describeResourceLabel(resource)}`;
}

function describeResourceLabel(resource: string): string {
  return resource.replace("resource.", "").replaceAll("-", " ");
}

function splitCamelCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

function humanizeId(value: string): string {
  const words = value
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .trim();

  return words.length === 0 ? "" : words.charAt(0).toUpperCase() + words.slice(1);
}

function readAuthoredAuditFine(): number {
  for (const tile of deadlineDashBoard.spaces) {
    for (const effect of tile.effects) {
      if (effect.type === "auditConfinement") return effect.release.alternativeFine;
    }
  }

  // The audit tile has always carried this effect; keep the engine's constant
  // as the floor rather than rendering a blank cost if content ever drops it.
  return 500;
}
