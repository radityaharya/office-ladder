import type {
  EffectCondition,
  EffectDescriptor,
  EffectImmunityScope,
  EffectScale,
  EffectScaleMetric,
  EffectStatusFilter,
  EffectTarget,
  PlacementKind,
} from "@office-ladder/content";

import { deckPhrase } from "./authored-card-copy";

export type EffectPolarity = "gain" | "cost" | "neutral";

/**
 * One row of a card's effects readout.
 *
 * `sentence` is plain, sentence-case English describing exactly what the engine
 * does. `delta` is the same change restated as a mono, explicitly signed token
 * (`+150`, `-1`) so gain/loss is never carried by color alone (DESIGN.md §6.4,
 * §8); it is null only for effects that move no countable quantity.
 */
export type EffectReadout = {
  readonly type: EffectDescriptor["type"];
  readonly sentence: string;
  /** Short uppercase mono tag naming what the delta applies to, e.g. "MONEY". */
  readonly scope: string;
  readonly delta: string | null;
  readonly polarity: EffectPolarity;
};

/**
 * The four envelope fields gameplay v2 hangs off *every* effect
 * (`packages/content/src/schema/effects.ts`) all change what a card does, so
 * none of them may go unstated here:
 *
 * - **`target`** decides whether a card is fair or arbitrary. Every sentence is
 *   written in two voices — imperative when the effect lands on `self` (the
 *   default, and the voice every pre-v2 sentence was written in), third person
 *   naming the subject otherwise. See {@link voiceFor}.
 * - **`condition`** becomes an `If …,` / `Unless …,` lead. An effect that only
 *   fires for low-ranked players and reads as unconditional is simply wrong.
 * - **`scale`** becomes a `plus N per <metric>` clause. Half the corner deck's
 *   whole point is that the amount is not the same for everybody.
 * - **`preventable`** is stated because it is what tells a player that holding a
 *   reaction card is worth doing.
 *
 * Card copy is forbidden from restating numbers (spec §10.4) precisely because
 * this readout renders mechanics from `effects` directly — so a missing sentence
 * is not a cosmetic gap, it is a card that does something unannounced.
 */
type ReadoutContext = {
  /**
   * The target nested effects inherit when they declare none. `rollCheck`
   * outcomes and `opposedRoll` branches inherit the target of the roll they
   * belong to, never the actor — otherwise a six-player table reads as paying
   * one player six times.
   */
  readonly defaultTarget: EffectTarget;
};

const ROOT_CONTEXT: ReadoutContext = { defaultTarget: "self" };

/**
 * Exhaustive by construction: the `default` branch is an `effect satisfies never`
 * assertion, so a newly authored effect type in `packages/content` becomes a
 * compile error here instead of silently rendering a blank row. Do not weaken it
 * to a permissive default — failing to compile is the point.
 */
export function describeEffect(effect: EffectDescriptor): EffectReadout {
  return describeEffectIn(effect, ROOT_CONTEXT);
}

/** Plain-English sentence for a single effect. */
export function effectLabel(effect: EffectDescriptor): string {
  return describeEffect(effect).sentence;
}

function describeEffectIn(effect: EffectDescriptor, context: ReadoutContext): EffectReadout {
  const core = coreReadout(effect, context);
  return {
    ...core,
    sentence: withEnvelopeClauses(core.sentence, effect, voiceFor(targetOf(effect, context))),
  };
}

function coreReadout(effect: EffectDescriptor, context: ReadoutContext): EffectReadout {
  const voice = voiceFor(targetOf(effect, context));

  switch (effect.type) {
    case "drawCards": {
      const cards = effect.count === 1 ? "card" : "cards";
      return {
        type: effect.type,
        sentence: `${voice.clause("Draw", "draws")} ${effect.count} more ${cards} from the ${deckPhrase(effect.deckId)} deck.`,
        scope: "CARDS",
        delta: signed(effect.count),
        polarity: "neutral",
      };
    }
    case "modifyResource": {
      const isGain = effect.amount >= 0;
      return {
        type: effect.type,
        sentence: `${voice.clause(isGain ? "Gain" : "Lose", isGain ? "gains" : "loses")} ${resourceAmount(effect.resource, Math.abs(effect.amount))}.`,
        scope: resourceScope(effect.resource),
        delta: signed(effect.amount),
        polarity: isGain ? "gain" : "cost",
      };
    }
    case "restoreResourceToMaximum":
      return {
        type: effect.type,
        sentence: `${voice.clause("Restore", "restores")} ${resourceLabel(effect.resource)} to maximum.`,
        scope: resourceScope(effect.resource),
        delta: "MAX",
        polarity: "gain",
      };
    case "payResource":
      return {
        type: effect.type,
        // `insufficientFunds` has one member, `"pay-up-to-available"`, so the
        // shortfall rule is always in force and is always stated.
        sentence: `${voice.clause("Pay", "pays")} ${resourceAmount(effect.resource, effect.amount)}, or everything ${voice.pronoun} ${voice.have} if ${voice.pronoun} cannot cover it.`,
        scope: resourceScope(effect.resource),
        delta: signed(-effect.amount),
        polarity: "cost",
      };
    case "incrementWorkCounter": {
      const marks = effect.amount === 1 ? "mark" : "marks";
      return {
        type: effect.type,
        sentence: `${voice.clause("Log", "logs")} ${effect.amount} work ${marks}; every ${ordinal(effect.rewardEvery)} mark awards ${resourceAmount(effect.reward.resource, effect.reward.amount)}.`,
        scope: "WORK",
        delta: signed(effect.amount),
        polarity: "gain",
      };
    }
    case "rollCheck": {
      const dice = diceLabel(effect.dice);
      return {
        type: effect.type,
        sentence:
          effect.resolution === "per-target"
            ? `${voice.clause("Roll", "rolls")} ${dice} separately; whichever outcome matches that roll is applied immediately.`
            : `${voice.clause("Roll", "rolls")} ${dice}; whichever outcome matches the result is applied immediately.`,
        scope: "ROLL",
        delta: dice,
        polarity: "neutral",
      };
    }
    case "applyStatus":
      return statusReadout(effect, voice);
    case "skipTurns": {
      const turns = effect.count === 1 ? "turn" : `${effect.count} turns`;
      return {
        type: effect.type,
        sentence: `${voice.clause("Skip", "skips")} ${voice.possessive} next ${turns}.`,
        scope: effect.count === 1 ? "TURN" : "TURNS",
        delta: signed(-effect.count),
        polarity: "cost",
      };
    }
    case "gainSalary":
      return {
        type: effect.type,
        sentence:
          effect.trigger === "pass"
            ? `${voice.clause("Collect", "collects")} ${voice.possessive} salary when ${voice.pronoun} pass this tile.`
            : `${voice.clause("Collect", "collects")} ${voice.possessive} salary when ${voice.pronoun} land on this tile.`,
        scope: "SALARY",
        delta: null,
        polarity: "gain",
      };
    case "grantExtraRoll":
      return {
        type: effect.type,
        sentence: `${voice.clause("Roll", "rolls")} again before ${voice.possessive} turn ends.`,
        scope: effect.count === 1 ? "ROLL" : "ROLLS",
        delta: signed(effect.count),
        polarity: "gain",
      };
    case "attemptPromotion":
      return {
        type: effect.type,
        sentence: `${voice.clause("Attempt", "attempts")} the next promotion; it goes through only if ${voice.pronoun} can afford that rank.`,
        scope: "RANK",
        delta: null,
        polarity: "neutral",
      };
    case "auditConfinement": {
      const dice = diceLabel(effect.release.roll);
      return {
        type: effect.type,
        sentence: `${voice.clause("Report", "reports")} to audit review. To be released, ${voice.isSelf ? "" : "they must "}roll doubles on ${dice} or pay the ${money(effect.release.alternativeFine)} fine; a failed roll leaves ${voice.objectPronoun} in review.`,
        scope: "AUDIT",
        // Deliberately null: the fine is one of two release options, so a fixed
        // signed delta here would misstate the mechanic.
        delta: null,
        polarity: "cost",
      };
    }
    case "transferResource": {
      const toActor = (effect.direction ?? "target-to-actor") === "target-to-actor";
      const amount = resourceAmount(effect.resource, Math.abs(effect.amount));
      // The shortfall rule is a clause, not its own sentence, so the whole
      // effect still nests cleanly inside a `chooseOne` branch.
      const payer = toActor ? `${voice.pronoun} ${voice.have}` : "you have";
      const shortfall =
        effect.insufficientFunds === "all-or-nothing"
          ? `, and nothing at all unless ${toActor ? voice.pronoun : "you"} can cover it in full`
          : `, or as much of it as ${payer}`;
      const each =
        effect.perTarget === false && voice.isPlural
          ? " The amount is shared between them rather than charged to each."
          : "";
      return {
        type: effect.type,
        sentence: toActor
          ? `Take ${amount} from ${voice.object}${shortfall}.${each}`
          : `Give ${amount} to ${voice.object}${shortfall}.${each}`,
        scope: resourceScope(effect.resource),
        delta: signed(toActor ? Math.abs(effect.amount) : -Math.abs(effect.amount)),
        polarity: toActor ? "gain" : "cost",
      };
    }
    case "modifyHeat": {
      const raises = effect.amount >= 0;
      const points = Math.abs(effect.amount) === 1 ? "point" : "points";
      return {
        type: effect.type,
        sentence: raises
          ? `${voice.clause("Attract", "attracts")} ${Math.abs(effect.amount)} ${points} of heat — suspicion the rest of the table can act on.`
          : `${voice.clause("Shed", "sheds")} ${Math.abs(effect.amount)} ${points} of heat.`,
        scope: "HEAT",
        delta: signed(effect.amount),
        // Heat is accumulating pressure, never a score to maximise, so raising
        // it reads as a cost no matter who benefits from the card overall.
        polarity: raises ? "cost" : "gain",
      };
    }
    case "placeObject": {
      const placement = describePlacement(effect.placementKind);
      const charges = effect.charges ?? 1;
      const hidden =
        effect.visibility === "owner-only" ? " Only you can see it on the board." : "";
      return {
        type: effect.type,
        sentence: `${voice.clause("Leave", "leaves")} ${placement.article} on ${tilePhrase(effect.tileId)}: ${placement.consequence}${hidden}`,
        scope: "PLACEMENT",
        delta: `${charges} ${charges === 1 ? "USE" : "USES"}`,
        polarity: placement.polarity,
      };
    }
    case "claimTile":
      return {
        type: effect.type,
        sentence: `${voice.clause("Claim", "claims")} ${tilePhrase(effect.tileId)} for a base price of ${money(effect.baseCost)}, before the board's claim multiplier.`,
        scope: "TILE",
        delta: signed(-effect.baseCost),
        polarity: "cost",
      };
    case "releaseTile":
      return {
        type: effect.type,
        sentence: `${voice.clause("Give", "gives")} up ${voice.possessive} claim on ${tilePhrase(effect.tileId)}.`,
        scope: "TILE",
        delta: null,
        polarity: "cost",
      };
    case "startProject": {
      const joinable =
        effect.openToJoin === false
          ? " Nobody else may join it."
          : " Other players may join and contribute.";
      const deadline =
        effect.deadlineRounds === undefined
          ? ""
          : ` It must finish within ${effect.deadlineRounds} ${effect.deadlineRounds === 1 ? "round" : "rounds"}.`;
      return {
        type: effect.type,
        sentence: `${voice.clause("Start", "starts")} a project on ${tilePhrase(effect.tileId)} needing ${money(effect.requiredMoney)} and ${workMarks(effect.requiredWork)}; completing it pays ${money(effect.payout.money)}, ${effect.payout.reputation} reputation and ${effect.payout.objectiveProgress} objective progress.${joinable}${deadline}`,
        scope: "PROJECT",
        delta: signed(-effect.requiredMoney),
        polarity: "neutral",
      };
    }
    case "contributeToProject":
      return {
        type: effect.type,
        sentence: `${voice.clause("Commit", "commits")} ${money(effect.money)} and ${workMarks(effect.work)} to ${effect.projectId === undefined || effect.projectId === null ? "the open project on that tile" : "that project"}.`,
        scope: "PROJECT",
        delta: signed(-effect.money),
        polarity: "cost",
      };
    case "sabotageProject":
      return {
        type: effect.type,
        sentence: `${voice.clause("Set", "sets")} ${effect.projectId === undefined || effect.projectId === null ? "the first project you do not lead" : "that project"} back by ${workMarks(effect.amount)}.${effect.hidden === true ? " Nobody is told who did it." : ""}`,
        scope: "PROJECT",
        delta: signed(-effect.amount),
        polarity: "cost",
      };
    case "openBallot": {
      const closes =
        effect.closesInRounds === undefined
          ? ""
          : ` It closes in ${effect.closesInRounds} ${effect.closesInRounds === 1 ? "round" : "rounds"}.`;
      const sealed =
        effect.visibility === "sealed"
          ? " Votes stay sealed until it closes — nobody knows yet."
          : "";
      return {
        type: effect.type,
        sentence: `${voice.clause("Open", "opens")} a table-wide ${effect.ballotKind === "auction" ? "auction" : "vote"} on ${effect.subjectId}.${closes}${sealed}`,
        scope: "BALLOT",
        delta: null,
        polarity: "neutral",
      };
    }
    case "grantImmunity": {
      const blocked = immunityPhrase(effect.scope);
      const charges = effect.count ?? 1;
      const extent =
        effect.duration !== undefined
          ? `for ${effect.duration.count === 1 ? "one turn" : `${effect.duration.count} turns`}`
          : `the next ${charges === 1 ? "time" : `${charges} times`} it is aimed at ${voice.objectPronoun}`;
      return {
        type: effect.type,
        sentence: `${voice.clause("Ignore", "ignores")} ${blocked} ${extent}. Only preventable effects can be blocked this way.`,
        scope: "IMMUNITY",
        delta:
          effect.duration !== undefined
            ? `${effect.duration.count} ${effect.duration.count === 1 ? "TURN" : "TURNS"}`
            : signed(effect.count ?? 1),
        polarity: "gain",
      };
    }
    case "forceDiscard": {
      const cards = effect.count === 1 ? "card" : "cards";
      return {
        type: effect.type,
        sentence: `${voice.clause("Discard", "discards")} ${effect.count} ${cards} from hand.`,
        scope: "HAND",
        delta: signed(-effect.count),
        polarity: "cost",
      };
    }
    case "swapBoardPositions":
      return {
        type: effect.type,
        // `self` is meaningless here — swapping with yourself is not a mechanic —
        // so an undeclared target reads as the choice the engine will ask for.
        sentence: `Swap board positions with ${targetOf(effect, context) === "self" ? "the player you choose" : voice.object}.`,
        scope: "POSITION",
        delta: null,
        polarity: "neutral",
      };
    case "teleport":
      return {
        type: effect.type,
        sentence:
          effect.destination.kind === "tileIndex"
            ? `${voice.clause("Move", "moves")} straight to space ${effect.destination.index}, without resolving anything passed on the way.`
            : `${voice.clause("Move", "moves")} straight to ${tileName(effect.destination.tileId)}, without resolving anything passed on the way.`,
        scope: "POSITION",
        delta: null,
        polarity: "neutral",
      };
    case "modifyUpkeep": {
      const rises = effect.amount >= 0;
      return {
        type: effect.type,
        sentence: `${voice.possessiveSubject} recurring upkeep ${rises ? "rises" : "falls"} by ${money(Math.abs(effect.amount))} each round.`,
        scope: "UPKEEP",
        delta: signed(effect.amount),
        polarity: rises ? "cost" : "gain",
      };
    }
    case "openReactionWindow":
      return {
        type: effect.type,
        sentence: `${openWindowPhrase(effect.windowKind)} Anyone holding a reaction card may play it before play continues.`,
        scope: "WINDOW",
        delta: null,
        polarity: "neutral",
      };
    case "grantIncomeStream": {
      const duration =
        effect.remainingRounds === null
          ? "every round from now on"
          : `every round for ${effect.remainingRounds} ${effect.remainingRounds === 1 ? "round" : "rounds"}`;
      const pays = effect.perRound >= 0;
      return {
        type: effect.type,
        sentence: `${voice.clause(pays ? "Collect" : "Owe", pays ? "collects" : "owes")} ${money(Math.abs(effect.perRound))} ${duration}, from ${incomeStreamPhrase(effect.streamKind)}.`,
        scope: "INCOME",
        delta: signed(effect.perRound),
        polarity: pays ? "gain" : "cost",
      };
    }
    case "removeStatuses": {
      const removed = statusFilterPhrase(effect.filter);
      const howMany = effect.limit === undefined ? "every" : effect.limit.toLocaleString("en-US");
      return {
        type: effect.type,
        sentence: `${voice.clause("Clear", "clears")} ${howMany} ${removed}.`,
        scope: "STATUSES",
        delta: effect.limit === undefined ? "ALL" : signed(-effect.limit),
        polarity: "gain",
      };
    }
    case "chooseOne": {
      const chooser = effect.chooser ?? "self";
      const branches = effect.options
        .map((option) => `${option.label} (${summarize(option.effects, context)})`)
        .join("; or ");
      return {
        type: effect.type,
        sentence:
          chooser === "self"
            ? `Choose one: ${branches}.`
            : `${voiceFor(chooser).subject} chooses one: ${branches}.`,
        scope: "CHOICE",
        delta: `${effect.options.length} OPTIONS`,
        polarity: "neutral",
      };
    }
    case "noEffect":
      return {
        type: effect.type,
        sentence: "Nothing happens. The draw is spent and the card is recorded in the log.",
        scope: "NONE",
        delta: null,
        polarity: "neutral",
      };
    case "opposedRoll": {
      const opponent = effect.opponent ?? "chosen-opponent";
      const branchContext: ReadoutContext = { defaultTarget: opponent };
      const dice = diceLabel(effect.dice ?? { count: 2, sides: 6 });
      const tie =
        effect.onTie === undefined || effect.onTie.length === 0
          ? "on a tie, nothing happens"
          : `on a tie, ${summarize(effect.onTie, branchContext)}`;
      return {
        type: effect.type,
        sentence: `Both you and ${voiceFor(opponent).object} roll ${dice}: if you roll higher, ${summarize(effect.onWin, branchContext)}; if you roll lower, ${summarize(effect.onLose, branchContext)}; ${tie}.`,
        scope: "ROLL",
        delta: dice,
        polarity: "neutral",
      };
    }
    default:
      return effect satisfies never;
  }
}

/* -------------------------------------------------------------------------- */
/* Envelope: condition, scale, preventable                                     */
/* -------------------------------------------------------------------------- */

function withEnvelopeClauses(sentence: string, effect: EffectDescriptor, voice: Voice): string {
  let text = sentence;

  const lead = conditionLead(effect.condition, voice);
  if (lead !== null) text = `${lead}${lowerFirst(text)}`;

  // A trailing sentence rather than an inline clause: several core sentences
  // already carry a qualifier ("…, or everything they have if they cannot cover
  // it"), and splicing the scale in behind one of those reads as though the
  // scale modified the qualifier.
  const scale = scaleClause(effect);
  if (scale !== null) text = `${text} ${scale}`;

  if (effect.preventable === true) {
    text = `${text} A reaction can prevent this.`;
  }

  return text;
}

/**
 * `If …,` / `Unless …,` — never silence. An effect guarded to low-ranked players
 * that renders unconditionally is not an imprecise sentence, it is a false one.
 */
function conditionLead(condition: EffectCondition | undefined, voice: Voice): string | null {
  if (condition === undefined || condition.kind === "always") return null;
  if (condition.kind === "never") return "This never applies, by design: ";
  if (condition.kind === "not") return `Unless ${conditionClause(condition.of, voice)}, `;
  return `If ${conditionClause(condition, voice)}, `;
}

function conditionClause(condition: EffectCondition, voice: Voice): string {
  switch (condition.kind) {
    case "always":
      return "always";
    case "never":
      return "never";
    case "resourceAtLeast":
      return `${conditionSubject(condition.who, voice)} ${conditionResourceAmount(condition.resource, condition.amount)} or more`;
    case "resourceAtMost":
      return `${conditionSubject(condition.who, voice)} ${conditionResourceAmount(condition.resource, condition.amount)} or less`;
    case "rankIndexAtLeast":
      return `${conditionSubject(condition.who, voice)} reached rank ${condition.index} or higher`;
    case "rankIndexAtMost":
      return `${conditionSubject(condition.who, voice)} not passed rank ${condition.index}`;
    case "heatAtLeast":
      return `${conditionSubject(condition.who, voice)} ${condition.value} or more heat`;
    case "hasStatus":
      return `${conditionSubject(condition.who, voice)} the ${statusPhrase(condition.statusId)} status`;
    case "ownsTile":
      return `${conditionSubject(condition.who, voice)} claimed ${condition.tileId === null ? "the tile they are standing on" : tileName(condition.tileId)}`;
    case "roundAtLeast":
      return `it is round ${condition.round} or later`;
    case "quarterIndex":
      return `it is quarter ${condition.index}`;
    case "not":
      return `it is not the case that ${conditionClause(condition.of, voice)}`;
    case "all":
      return condition.of.map((inner) => conditionClause(inner, voice)).join(" and ");
    case "any":
      return condition.of.map((inner) => conditionClause(inner, voice)).join(" or ");
    default:
      return condition satisfies never;
  }
}

/**
 * Every clause above is written to read after a bare "has/have", so the subject
 * carries the verb: "you have 1 or more heat", "they have reached rank 5".
 *
 * `who: "target"` is the default in the authored grammar and it means *the
 * player this effect is landing on*, which is why it reads off the same voice
 * the sentence does — a guard on a self-targeted effect says "you", the same
 * guard on an `@all-players` effect says "they", and those are different cards.
 */
function conditionSubject(who: "actor" | "target", voice: Voice): string {
  if (who === "actor") return "you have";
  return `${voice.pronoun} ${voice.have}`;
}

function conditionResourceAmount(resource: string, amount: number): string {
  if (resource === "work-counter") return workMarks(amount);
  return resourceAmount(resource, amount);
}

/**
 * Effective amount = `amount + perUnit × metric`, capped by magnitude. §10.6
 * mandate 4 exists because an all-player effect that is identical for everybody
 * changes nobody's standing — so the thing that makes it *not* identical has to
 * be said out loud.
 */
function scaleClause(effect: EffectDescriptor): string | null {
  const scale: EffectScale | undefined = effect.scale;
  if (scale === undefined || scale.perUnit === 0) return null;

  const unit = scaleUnit(effect);
  const direction = scale.perUnit >= 0 ? "rises" : "falls";
  const whose = scale.of === "actor" ? " of yours" : "";
  const cap = scale.cap === undefined ? "" : `, capped at ${unit(Math.abs(scale.cap))}`;

  return `The amount ${direction} by ${unit(Math.abs(scale.perUnit))} for every ${scaleMetricPhrase(scale.by)}${whose}${cap}.`;
}

/** How a scaled amount is spelled, in the unit the effect it rides on moves. */
function scaleUnit(effect: EffectDescriptor): (amount: number) => string {
  switch (effect.type) {
    case "modifyResource":
    case "transferResource":
    case "payResource":
      return (amount) => resourceAmount(effect.resource, amount);
    case "claimTile":
    case "modifyUpkeep":
    case "contributeToProject":
    case "grantIncomeStream":
      return money;
    case "modifyHeat":
      return (amount) => `${amount} heat`;
    case "incrementWorkCounter":
    case "sabotageProject":
      return workMarks;
    case "forceDiscard":
    case "drawCards":
      return (amount) => `${amount} ${amount === 1 ? "card" : "cards"}`;
    default:
      return (amount) => amount.toLocaleString("en-US");
  }
}

function scaleMetricPhrase(metric: EffectScaleMetric): string {
  switch (metric) {
    case "rank-tier":
      return "rank tier";
    case "board-position":
      return "space travelled";
    case "laps":
      return "completed lap";
    case "heat":
      return "point of heat";
    case "debt":
      return "point of debt";
    case "work-counter":
      return "work mark";
    case "opponent-count":
      return "opponent at the table";
    default:
      return metric satisfies never;
  }
}

/* -------------------------------------------------------------------------- */
/* Targeting voice                                                             */
/* -------------------------------------------------------------------------- */

/**
 * "You" versus "each opponent" versus "the highest-ranked player" is the
 * difference between a card being fair and feeling arbitrary, so it is never
 * implied — it is the grammatical subject of the sentence.
 *
 * Every non-self subject is grammatically singular ("Each opponent gains…"),
 * which is what lets one `thirdPerson` verb form serve all ten of them. The
 * pronoun is singular *they* so that a following verb stays in its base form in
 * both voices — "the next tile you land on" / "the next tile they land on".
 */
type Voice = {
  /** Sentence-leading subject, e.g. "You" or "Each opponent". */
  readonly subject: string;
  /** Mid-sentence subject or object, e.g. "you" or "each opponent". */
  readonly object: string;
  /** Pronoun taking a base-form verb, e.g. "you" or "they". */
  readonly pronoun: string;
  /** Objective pronoun, e.g. "you" or "them". */
  readonly objectPronoun: string;
  /** "your" or "their". */
  readonly possessive: string;
  /** Sentence-leading possessive, e.g. "Your" or "Each opponent's". */
  readonly possessiveSubject: string;
  /** Agreeing form of "to be": "are" or "is". */
  readonly be: string;
  /** Agreeing form of "to have", used after {@link pronoun}. */
  readonly have: string;
  /** True when the effect lands on the reader — the imperative voice. */
  readonly isSelf: boolean;
  /** True when the target resolves to more than one player. */
  readonly isPlural: boolean;
  /**
   * Opens a clause in whichever voice the target calls for: the imperative for
   * `self`, the named subject plus a third-person verb for everyone else.
   */
  clause(imperative: string, thirdPerson: string): string;
};

function targetOf(effect: EffectDescriptor, context: ReadoutContext): EffectTarget {
  return effect.target ?? context.defaultTarget;
}

function voiceFor(target: EffectTarget): Voice {
  if (target === "self") {
    return {
      subject: "You",
      object: "you",
      pronoun: "you",
      objectPronoun: "you",
      possessive: "your",
      possessiveSubject: "Your",
      be: "are",
      have: "have",
      isSelf: true,
      isPlural: false,
      clause: (imperative) => imperative,
    };
  }

  const subject = targetSubject(target);
  return {
    subject,
    object: lowerFirst(subject),
    pronoun: "they",
    objectPronoun: "them",
    possessive: "their",
    possessiveSubject: `${subject}'s`,
    be: "is",
    have: "have",
    isSelf: false,
    isPlural: target === "all-opponents" || target === "all-players",
    clause: (_imperative, thirdPerson) => `${subject} ${thirdPerson}`,
  };
}

function targetSubject(target: Exclude<EffectTarget, "self">): string {
  switch (target) {
    case "active-player":
      return "The active player";
    case "chosen-opponent":
      return "Your chosen opponent";
    case "all-opponents":
      return "Each opponent";
    case "all-players":
      return "Every player";
    case "left-neighbour":
      return "Your left-hand neighbour";
    case "right-neighbour":
      return "Your right-hand neighbour";
    case "highest-rank":
      return "The highest-ranked player";
    case "lowest-rank":
      return "The lowest-ranked player";
    case "richest":
      return "The richest player";
    case "poorest":
      return "The poorest player";
    default:
      return target satisfies never;
  }
}

/* -------------------------------------------------------------------------- */
/* Statuses                                                                    */
/* -------------------------------------------------------------------------- */

type ApplyStatusEffect = Extract<EffectDescriptor, { readonly type: "applyStatus" }>;

/**
 * Status copy is a lookup with a derived fallback rather than an exhaustive
 * switch: `StatusId` grows with content, and an unrecognised status must still
 * read as a correct sentence instead of failing the build in a UI file.
 */
function statusReadout(effect: ApplyStatusEffect, voice: Voice): EffectReadout {
  const base = {
    type: effect.type,
    scope: statusScope(effect.statusId),
    delta: durationToken(effect.duration),
    polarity: effect.polarity === "negative" ? "cost" : "neutral",
  } as const satisfies Omit<EffectReadout, "sentence">;

  switch (effect.statusId) {
    case "status.next-salary-multiplier": {
      const multiplier = numberParameter(effect, "multiplier");
      return {
        ...base,
        sentence:
          multiplier === null
            ? `${voice.possessiveSubject} next salary payment is multiplied.`
            : `${voice.possessiveSubject} next salary payment is multiplied by ${multiplier}.`,
        delta: multiplier === null ? base.delta : `x${multiplier}`,
        polarity: "gain",
      };
    }
    case "status.next-roll-extra-movement": {
      const spaces = numberParameter(effect, "spaces");
      return {
        ...base,
        sentence:
          spaces === null
            ? `${voice.possessiveSubject} next roll moves ${voice.objectPronoun} further than it shows.`
            : `${voice.clause("Move", "moves")} ${spaces} extra ${spaces === 1 ? "space" : "spaces"} on ${voice.possessive} next roll.`,
        delta: spaces === null ? base.delta : signed(spaces),
        polarity: "gain",
      };
    }
    case "status.skip-next-tile-effect":
      return {
        ...base,
        sentence: `${voice.clause("Skip", "skips")} the effect of the next tile ${voice.pronoun} land on.`,
        polarity: "gain",
      };
    case "status.ignore-next-work-energy":
      return {
        ...base,
        sentence: `${voice.clause("Ignore", "ignores")} the energy cost of the next work tile ${voice.pronoun} land on.`,
        polarity: "gain",
      };
    case "status.audit":
      return {
        ...base,
        sentence: `${voice.subject} ${voice.be} marked as under audit.`,
        polarity: "cost",
      };
    case "status.burnout-tile":
      return {
        ...base,
        sentence: `${voice.subject} ${voice.be} marked as burnt out.`,
        polarity: "cost",
      };
    // The card vocabulary's statuses. Each carries its magnitude in
    // `parameters`, and a multiplier of 0 is an attack while a multiplier of 2
    // is a gift — so the number is the mechanic and cannot go unstated.
    case "status.next-work-card-money-multiplier":
      return multiplierStatusReadout(effect, voice, base, "money award", "work");
    case "status.next-work-card-reputation-multiplier":
      return multiplierStatusReadout(effect, voice, base, "reputation award", "work");
    case "status.next-promotion-reputation-discount": {
      const discount = numberParameter(effect, "reputation");
      return {
        ...base,
        sentence:
          discount === null
            ? `${voice.possessiveSubject} next promotion costs less reputation.`
            : `${voice.possessiveSubject} next promotion costs ${discount} less reputation.`,
        delta: discount === null ? base.delta : signed(-discount),
        polarity: "gain",
      };
    }
    case "status.cancel-next-money-loss":
      return {
        ...base,
        sentence: `${voice.clause("Cancel", "cancels")} the next loss of money ${voice.pronoun} would take.`,
        polarity: "gain",
      };
    case "status.skip-next-networking-reward":
      return {
        ...base,
        sentence: `${voice.possessiveSubject} next networking card gives up its rewards; its costs still land.`,
        polarity: "cost",
      };
    case "status.next-work-extra-energy": {
      const energy = numberParameter(effect, "energy");
      return {
        ...base,
        sentence:
          energy === null
            ? `${voice.possessiveSubject} next work card returns energy instead of spending it.`
            : `${voice.possessiveSubject} next work card returns ${energy} energy instead of spending it.`,
        delta: energy === null ? base.delta : signed(energy),
        polarity: "gain",
      };
    }
    case "status.ignore-next-meeting-energy":
      return {
        ...base,
        sentence: `${voice.clause("Ignore", "ignores")} the energy cost of the next meeting card ${voice.pronoun} draw.`,
        polarity: "gain",
      };
    default:
      return {
        ...base,
        sentence: `${voice.clause("Take", "takes")} on the ${statusPhrase(effect.statusId)} status ${durationPhrase(effect.duration)}.`,
      };
  }
}

/**
 * `×0` cancels the award outright and `×2` doubles it, so the two extremes of
 * the same status are opposite cards. The sentence names which one this is.
 */
function multiplierStatusReadout(
  effect: ApplyStatusEffect,
  voice: Voice,
  base: Omit<EffectReadout, "sentence">,
  award: string,
  deckWord: string,
): EffectReadout {
  const multiplier = numberParameter(effect, "multiplier");
  if (multiplier === null) {
    return {
      ...base,
      sentence: `${voice.possessiveSubject} next ${deckWord} card has its ${award} multiplied.`,
    };
  }
  if (multiplier === 0) {
    return {
      ...base,
      sentence: `${voice.possessiveSubject} next ${deckWord} card pays no ${award} at all.`,
      delta: "x0",
      polarity: "cost",
    };
  }
  return {
    ...base,
    sentence: `${voice.possessiveSubject} next ${deckWord} card has its ${award} multiplied by ${multiplier}.`,
    delta: `x${multiplier}`,
    polarity: multiplier < 1 ? "cost" : "gain",
  };
}

function numberParameter(effect: ApplyStatusEffect, key: string): number | null {
  const value = effect.parameters?.[key];
  return typeof value === "number" ? value : null;
}

function durationToken(duration: ApplyStatusEffect["duration"]): string {
  const unit = duration.kind === "uses" ? "USE" : "TURN";
  return `${duration.count} ${unit}${duration.count === 1 ? "" : "S"}`;
}

function durationPhrase(duration: ApplyStatusEffect["duration"]): string {
  if (duration.kind === "uses") {
    return duration.count === 1 ? "for its next use" : `for its next ${duration.count} uses`;
  }
  return duration.count === 1 ? "for one turn" : `for ${duration.count} turns`;
}

function statusPhrase(statusId: string): string {
  return statusId.replace("status.", "").replaceAll("-", " ");
}

function statusScope(statusId: string): string {
  switch (statusId) {
    case "status.next-salary-multiplier":
      return "NEXT SALARY";
    case "status.next-roll-extra-movement":
      return "NEXT ROLL";
    case "status.skip-next-tile-effect":
      return "NEXT TILE";
    case "status.ignore-next-work-energy":
      return "WORK ENERGY";
    default:
      return statusPhrase(statusId).toUpperCase();
  }
}

function statusFilterPhrase(filter: EffectStatusFilter): string {
  const parts: string[] = [];
  if (filter.polarity !== undefined) parts.push(filter.polarity);
  if (filter.statusId !== undefined) {
    parts.push(`${statusPhrase(filter.statusId)} status`);
  } else {
    parts.push("status");
  }
  const source =
    filter.sourceDeckId === undefined ? "" : ` picked up from the ${deckPhrase(filter.sourceDeckId)} deck`;
  return `${parts.join(" ")}${source}`;
}

/* -------------------------------------------------------------------------- */
/* Board, project and window vocabulary                                        */
/* -------------------------------------------------------------------------- */

type PlacementCopy = {
  readonly article: string;
  readonly consequence: string;
  readonly polarity: EffectPolarity;
};

function describePlacement(kind: PlacementKind): PlacementCopy {
  switch (kind) {
    case "placement.meeting-invite":
      return {
        article: "a meeting invite",
        consequence: "the next player to land there loses their next turn.",
        polarity: "cost",
      };
    case "placement.sabotage":
      return {
        article: "a sabotage",
        consequence: "the next player to land there pays you.",
        polarity: "cost",
      };
    case "placement.surveillance":
      return {
        article: "a surveillance marker",
        consequence: "you learn the hidden information of the next player to land there.",
        polarity: "neutral",
      };
    case "placement.rumour":
      return {
        article: "a rumour",
        consequence: "the next player to land there loses reputation.",
        polarity: "cost",
      };
    case "placement.favour":
      return {
        article: "a favour",
        consequence: "the next player to land there gains, at your expense.",
        polarity: "gain",
      };
    default:
      return kind satisfies never;
  }
}

function openWindowPhrase(windowKind: "prevention" | "end-turn" | "promotion-block"): string {
  switch (windowKind) {
    case "prevention":
      return "Open a window to prevent what is about to resolve.";
    case "end-turn":
      return "Open a window at the end of the turn.";
    case "promotion-block":
      return "Open a window in which a promotion can be blocked.";
    default:
      return windowKind satisfies never;
  }
}

function incomeStreamPhrase(streamKind: "asset" | "rent" | "project" | "side-gig"): string {
  switch (streamKind) {
    case "asset":
      return "an asset";
    case "rent":
      return "rent";
    case "project":
      return "a project";
    case "side-gig":
      return "a side gig";
    default:
      return streamKind satisfies never;
  }
}

function immunityPhrase(scope: EffectImmunityScope): string {
  const parts: string[] = [];
  if (scope.direction !== undefined) parts.push(scope.direction === "loss" ? "loss of" : "gain of");
  if (scope.resource !== undefined) parts.push(resourceLabel(scope.resource));
  if (scope.effectTypes !== undefined && scope.effectTypes.length > 0) {
    parts.push(scope.effectTypes.map((type) => effectTypePhrase(type)).join(" or "));
  }
  if (scope.sourceDeckId !== undefined) {
    parts.push(`anything from the ${deckPhrase(scope.sourceDeckId)} deck`);
  }
  return parts.length === 0 ? "the next effect aimed at you" : parts.join(" ");
}

/** Human wording for an `EffectDescriptor["type"]` named inside an immunity scope. */
function effectTypePhrase(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

function tilePhrase(tileId: string | null | undefined): string {
  if (tileId === undefined || tileId === null) return "the tile you are standing on";
  return tileName(tileId);
}

function tileName(tileId: string): string {
  return `the ${tileId.replace("tile.board.", "").replaceAll("-", " ")} tile`;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** Joins nested effects into one clause, for `chooseOne` and `opposedRoll`. */
function summarize(effects: readonly EffectDescriptor[], context: ReadoutContext): string {
  if (effects.length === 0) return "nothing happens";
  const clauses = effects.map((effect) =>
    lowerFirst(stripFinalPeriod(describeEffectIn(effect, context).sentence)),
  );
  const last = clauses.at(-1) ?? "";
  if (clauses.length === 1) return last;
  // "and then", not "and": several core sentences already contain a comma or a
  // semicolon of their own, and a bare conjunction lets a reader take the tail
  // of one clause for the head of the next. Effects also genuinely resolve in
  // the order they are authored.
  return `${clauses.slice(0, -1).join(", ")} and then ${last}`;
}

function diceLabel(dice: { readonly count: number; readonly sides: number }): string {
  return `${dice.count}d${dice.sides}`;
}

function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function signed(amount: number): string {
  return `${amount >= 0 ? "+" : "-"}${Math.abs(amount).toLocaleString("en-US")}`;
}

function money(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

function workMarks(amount: number): string {
  return `${amount.toLocaleString("en-US")} work ${amount === 1 ? "mark" : "marks"}`;
}

function resourceAmount(resource: string, amount: number): string {
  if (resourceLabel(resource) === "money") return money(amount);
  return `${amount.toLocaleString("en-US")} ${resourceLabel(resource)}`;
}

function resourceLabel(resource: string): string {
  return resource.replace("resource.", "").replaceAll("-", " ");
}

function resourceScope(resource: string): string {
  return resourceLabel(resource).toUpperCase();
}

function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function stripFinalPeriod(value: string): string {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}
