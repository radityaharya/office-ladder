import { deadlineDashBoard } from "@office-ladder/content";
import type { BotDifficulty } from "@office-ladder/contracts";
import type { LegalAction } from "@office-ladder/engine";

/**
 * What a bot wants to do next. Deliberately a small closed union: the engine's
 * command surface is only `turn.roll` and `prompt.respond`, so anything richer
 * would be inventing decisions the game does not offer.
 */
export type BotDecision =
  | { readonly kind: "roll" }
  | { readonly kind: "respond"; readonly decisionPointId: string; readonly optionId: string }
  | { readonly kind: "none" };

export type BotDecisionInput = {
  /** Exactly what enumerateLegalActions(game, botPlayerId) returned. */
  readonly legalActions: readonly LegalAction[];
  readonly difficulty: BotDifficulty;
  /** The bot's current money resource value. */
  readonly money: number;
};

const PAY_FINE = "pay-fine";
const ATTEMPT_ROLL = "attempt-roll";

/**
 * Fallback only. The real number is authored in the content pack and read by
 * auditReleaseFine() below; this constant exists so a content pack that drops
 * the audit tile cannot make the policy throw.
 */
const FALLBACK_AUDIT_FINE = 500;

/**
 * "standard" wants a 2x cushion before spending the fine; "ruthless" pays as
 * soon as it can cover it at all, treating a lost turn as worse than the cash.
 */
const COMFORT_MULTIPLIER: Readonly<Record<BotDifficulty, number>> = {
  easy: Number.POSITIVE_INFINITY,
  standard: 2,
  ruthless: 1,
};

/** The audit tile's authored `auditConfinement.release.alternativeFine`. */
function auditReleaseFine(): number {
  for (const tile of deadlineDashBoard.spaces) {
    for (const effect of tile.effects) {
      if (effect.type === "auditConfinement") {
        return effect.release.alternativeFine;
      }
    }
  }
  return FALLBACK_AUDIT_FINE;
}

export const AUDIT_RELEASE_FINE = auditReleaseFine();

/**
 * Never trust the preferred option id: the prompt is authoritative about what
 * it will accept, so intersect with it and fall back to the first offered
 * option (which the engine guarantees is legal).
 */
function offeredOption(preferred: string, options: readonly string[]): string | null {
  const match = options.find((option) => option === preferred);
  return match ?? options[0] ?? null;
}

function preferredAuditOption(difficulty: BotDifficulty, money: number): string {
  const multiplier = COMFORT_MULTIPLIER[difficulty];
  return money >= AUDIT_RELEASE_FINE * multiplier ? PAY_FINE : ATTEMPT_ROLL;
}

/**
 * Pure: no I/O, no randomness, no clock. Same input, same decision, always.
 *
 * Difficulty only changes the audit-release choice, because that is the only
 * genuine decision the current ruleset ever asks a player to make — rolling is
 * forced whenever it is legal.
 */
export function decideBotAction(input: BotDecisionInput): BotDecision {
  const prompt = input.legalActions.find((action) => action.type === "prompt.respond");
  if (prompt !== undefined && prompt.type === "prompt.respond") {
    const options = prompt.options.map((option) => String(option));
    const preferred =
      prompt.kind === "audit-release"
        ? preferredAuditOption(input.difficulty, input.money)
        : (options[0] ?? "");
    const optionId = offeredOption(preferred, options);
    if (optionId === null) return { kind: "none" };
    return {
      kind: "respond",
      decisionPointId: String(prompt.decisionPointId),
      optionId,
    };
  }

  if (input.legalActions.some((action) => action.type === "turn.roll")) {
    return { kind: "roll" };
  }

  return { kind: "none" };
}
