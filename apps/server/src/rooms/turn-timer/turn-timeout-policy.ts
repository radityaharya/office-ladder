import type { LegalAction } from "@office-ladder/engine";

/**
 * What the server does on a player's behalf when their turn clock runs out.
 *
 * Rolling for somebody is uncontroversial: rolling is forced whenever it is
 * legal, so the timeout takes no decision away from them. Answering a *prompt*
 * for them is a different thing entirely — it is choosing, with consequences, for
 * a human who is not there. So the rule is not "pick something", it is:
 *
 *   **spend nothing, and keep the decision open if the rules allow it.**
 *
 * For the one prompt kind that exists today, `audit-release`, that means
 * `attempt-roll` and never `pay-fine`:
 *
 * - `pay-fine` takes 500 money — a quarter of a promotion — from an absent
 *   player, permanently and irreversibly. It is a real strategic choice, and
 *   making it for somebody can hand the match to another player.
 * - `attempt-roll` costs nothing. It consumes the turn either way (the engine
 *   advances the turn on any prompt response, so the table is never blocked), and
 *   on a failed attempt the prompt stays open — so the player still gets to make
 *   the actual decision when they come back. That is the least-harmful option by
 *   every axis that matters, and it is reversible in a way `pay-fine` is not.
 *
 * The same rule generalizes: a tile decision's authored `decline` branch "must
 * never cost the player anything" (packages/content/src/schema/board.ts), so
 * declining is the safe answer there too.
 *
 * @see NO_COST_OPTION_IDS for the allow-list, and {@link TurnTimeoutDecision}'s
 * `unclassified` flag for what happens to a prompt kind nobody has classified
 * yet.
 */

/**
 * Option ids that are known to cost the player nothing, in preference order.
 * Matched against what the prompt actually offers, never assumed to be present.
 */
const NO_COST_OPTION_IDS: readonly string[] = ["decline", "attempt-roll", "pass"];

export type TurnTimeoutDecision =
  | { readonly kind: "roll" }
  | {
      readonly kind: "respond";
      readonly decisionPointId: string;
      readonly optionId: string;
      readonly promptKind: string;
      /**
       * True when no option could be identified as harmless and the first offered
       * one was taken instead.
       *
       * This is the honest shape of an unavoidable trade-off. With today's command
       * surface there is no way to pass or skip a prompt — `prompt.respond` is the
       * only command that can clear one — so refusing to answer an unrecognized
       * prompt would leave the player holding the turn forever and the match
       * unable to continue for *everybody*. A deadlocked table is worse than an
       * imperfect auto-choice, so the choice is made and flagged loudly rather
       * than skipped quietly: whoever adds the next prompt kind should see this in
       * the log and add its safe option to NO_COST_OPTION_IDS.
       */
      readonly unclassified: boolean;
    }
  /** Nothing legal to do. The clock is not the thing that is wrong here. */
  | { readonly kind: "none" };

/**
 * Pure: no I/O, no randomness, no clock. Same legal actions, same decision.
 */
export function decideTurnTimeoutAction(
  legalActions: readonly LegalAction[],
): TurnTimeoutDecision {
  const prompt = legalActions.find((action) => action.type === "prompt.respond");
  if (prompt !== undefined && prompt.type === "prompt.respond") {
    const options = prompt.options.map((option) => String(option));
    const safe = NO_COST_OPTION_IDS.find((candidate) => options.includes(candidate));
    // The prompt itself is authoritative about what it accepts, so the fallback is
    // an option it offered rather than anything this module made up.
    const optionId = safe ?? options[0];
    if (optionId === undefined) return { kind: "none" };
    return {
      kind: "respond",
      decisionPointId: String(prompt.decisionPointId),
      optionId,
      promptKind: prompt.kind,
      unclassified: safe === undefined,
    };
  }

  if (legalActions.some((action) => action.type === "turn.roll")) {
    return { kind: "roll" };
  }

  return { kind: "none" };
}
