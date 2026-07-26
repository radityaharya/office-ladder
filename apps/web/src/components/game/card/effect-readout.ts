import type { EffectDescriptor } from "@office-ladder/content";

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
 * Exhaustive by construction: the `default` branch is an `effect satisfies never`
 * assertion, so a newly authored effect type in `packages/content` becomes a
 * compile error here instead of silently rendering a blank row. Do not weaken it
 * to a permissive default — failing to compile is the point.
 */
export function describeEffect(effect: EffectDescriptor): EffectReadout {
  switch (effect.type) {
    case "drawCards": {
      const cards = effect.count === 1 ? "card" : "cards";
      return {
        type: effect.type,
        sentence: `Draw ${effect.count} more ${cards} from the ${deckPhrase(effect.deckId)} deck.`,
        scope: "CARDS",
        delta: signed(effect.count),
        polarity: "neutral",
      };
    }
    case "modifyResource": {
      const isGain = effect.amount >= 0;
      return {
        type: effect.type,
        sentence: `${isGain ? "Gain" : "Lose"} ${resourceAmount(effect.resource, Math.abs(effect.amount))}.`,
        scope: resourceScope(effect.resource),
        delta: signed(effect.amount),
        polarity: isGain ? "gain" : "cost",
      };
    }
    case "restoreResourceToMaximum":
      return {
        type: effect.type,
        sentence: `Restore ${resourceLabel(effect.resource)} to maximum.`,
        scope: resourceScope(effect.resource),
        delta: "MAX",
        polarity: "gain",
      };
    case "payResource":
      return {
        type: effect.type,
        sentence:
          effect.insufficientFunds === "pay-up-to-available"
            ? `Pay ${resourceAmount(effect.resource, effect.amount)}, or everything you have if you cannot cover it.`
            : `Pay ${resourceAmount(effect.resource, effect.amount)}.`,
        scope: resourceScope(effect.resource),
        delta: signed(-effect.amount),
        polarity: "cost",
      };
    case "incrementWorkCounter": {
      const marks = effect.amount === 1 ? "mark" : "marks";
      return {
        type: effect.type,
        sentence: `Log ${effect.amount} work ${marks}; every ${ordinal(effect.rewardEvery)} mark awards ${resourceAmount(effect.reward.resource, effect.reward.amount)}.`,
        scope: "WORK",
        delta: signed(effect.amount),
        polarity: "gain",
      };
    }
    case "rollCheck": {
      const dice = `${effect.dice.count}d${effect.dice.sides}`;
      return {
        type: effect.type,
        sentence: `Roll ${dice}; whichever outcome matches the result is applied immediately.`,
        scope: "ROLL",
        delta: dice,
        polarity: "neutral",
      };
    }
    case "applyStatus":
      return statusReadout(effect);
    case "skipTurns": {
      const turns = effect.count === 1 ? "turn" : `${effect.count} turns`;
      return {
        type: effect.type,
        sentence: `Skip your next ${turns}.`,
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
            ? "Collect your salary when you pass this tile."
            : "Collect your salary when you land on this tile.",
        scope: "SALARY",
        delta: null,
        polarity: "gain",
      };
    case "grantExtraRoll":
      return {
        type: effect.type,
        sentence: "Roll again before your turn ends.",
        scope: effect.count === 1 ? "ROLL" : "ROLLS",
        delta: signed(effect.count),
        polarity: "gain",
      };
    case "attemptPromotion":
      return {
        type: effect.type,
        sentence: "Attempt the next promotion; it goes through only if you can afford that rank.",
        scope: "RANK",
        delta: null,
        polarity: "neutral",
      };
    case "auditConfinement": {
      const dice = `${effect.release.roll.count}d${effect.release.roll.sides}`;
      return {
        type: effect.type,
        sentence: `Report to audit review. To be released, roll doubles on ${dice} or pay the ${money(effect.release.alternativeFine)} fine; a failed roll leaves you in review.`,
        scope: "AUDIT",
        // Deliberately null: the fine is one of two release options, so a fixed
        // signed delta here would misstate the mechanic.
        delta: null,
        polarity: "cost",
      };
    }
    default:
      return effect satisfies never;
  }
}

/** Plain-English sentence for a single effect. */
export function effectLabel(effect: EffectDescriptor): string {
  return describeEffect(effect).sentence;
}

type ApplyStatusEffect = Extract<EffectDescriptor, { readonly type: "applyStatus" }>;

/**
 * Status copy is a lookup with a derived fallback rather than an exhaustive
 * switch: `StatusId` grows with content, and an unrecognised status must still
 * read as a correct sentence instead of failing the build in a UI file.
 */
function statusReadout(effect: ApplyStatusEffect): EffectReadout {
  const base = {
    type: effect.type,
    scope: statusScope(effect.statusId),
    delta: durationToken(effect.duration),
    polarity: "neutral",
  } as const satisfies Omit<EffectReadout, "sentence">;

  switch (effect.statusId) {
    case "status.next-salary-multiplier": {
      const multiplier = numberParameter(effect, "multiplier");
      return {
        ...base,
        sentence:
          multiplier === null
            ? "Your next salary payment is multiplied."
            : `Your next salary payment is multiplied by ${multiplier}.`,
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
            ? "Your next roll moves you further than it shows."
            : `Move ${spaces} extra ${spaces === 1 ? "space" : "spaces"} on your next roll.`,
        delta: spaces === null ? base.delta : signed(spaces),
        polarity: "gain",
      };
    }
    case "status.skip-next-tile-effect":
      return {
        ...base,
        sentence: "Skip the effect of the next tile you land on.",
        polarity: "gain",
      };
    case "status.ignore-next-work-energy":
      return {
        ...base,
        sentence: "Ignore the energy cost of the next work tile you land on.",
        polarity: "gain",
      };
    case "status.audit":
      return { ...base, sentence: "You are marked as under audit.", polarity: "cost" };
    case "status.burnout-tile":
      return { ...base, sentence: "You are marked as burnt out.", polarity: "cost" };
    default:
      return {
        ...base,
        sentence: `Take on the ${statusPhrase(effect.statusId)} status ${durationPhrase(effect.duration)}.`,
      };
  }
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
