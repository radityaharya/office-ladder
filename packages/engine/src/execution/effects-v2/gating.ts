import type { ModeRules } from "@office-ladder/content";

import type { PlayerId } from "../../model";
import {
  effectTiming,
  isAggressiveEffect,
  type EffectTiming,
  type EffectV2,
} from "./vocabulary";

/**
 * Mode gating for §4's binding rule: **no mechanic may be gated on a hardcoded
 * constant or on a `modeId` string comparison.** Every enablement decision in
 * the resolver comes through this module, and every one of them names a field
 * of `ModeRules`.
 *
 * The rule path is reported alongside the refusal so a trace entry (and
 * ultimately a UI refusal) can say *which* switch turned the effect off, rather
 * than "nothing happened".
 */

export type EffectGate =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly rule: string };

const ENABLED: EffectGate = { enabled: true };

function disabled(rule: string): EffectGate {
  return { enabled: false, rule };
}

/** §10.2: a timing the mode has switched off. */
export function isEffectTimingEnabled(rules: ModeRules, timing: EffectTiming): boolean {
  switch (timing) {
    case "immediate":
      return true;
    case "stored":
      return rules.agency.handEnabled;
    case "reaction":
      return rules.interaction.reactionWindows;
    default:
      return timing satisfies never;
  }
}

/**
 * §10.2's deck-construction filter: *"A card whose timing is disabled by the
 * active mode must not enter its deck at setup — filter at deck construction,
 * do not draw-then-discard."*
 *
 * Exported for the setup/deck wave. A card is playable when every effect it
 * carries has a timing the mode allows.
 */
export function isCardPlayableUnderRules(
  rules: ModeRules,
  effects: readonly EffectV2[],
): boolean {
  return effects.every((effect) => isEffectTimingEnabled(rules, effectTiming(effect)));
}

/**
 * Whether `effect` may resolve at all under `rules`, given who it lands on.
 *
 * Two independent gates are folded in here:
 *
 * - the effect type's own switch (`board.ownershipEnabled` for `claimTile`, and
 *   so on), and
 * - `conflict.targetedAttacks`, which gates *any* hostile cross-player effect
 *   regardless of type. Without that second gate an authored card could reach
 *   across the table in a mode whose whole point is that nobody can.
 */
export function isEffectEnabled(
  rules: ModeRules,
  effect: EffectV2,
  actorId: PlayerId,
  targetId: PlayerId,
): EffectGate {
  if (isAggressiveEffect(effect, actorId, targetId) && !rules.conflict.targetedAttacks) {
    return disabled("conflict.targetedAttacks");
  }

  switch (effect.type) {
    case "transferResource":
      // Taking from yourself is not an attack and needs no conflict switch; the
      // cross-player case is already gated above.
      return ENABLED;
    case "modifyHeat":
      return rules.conflict.heatEnabled ? ENABLED : disabled("conflict.heatEnabled");
    case "placeObject":
      return rules.board.placementsEnabled ? ENABLED : disabled("board.placementsEnabled");
    case "claimTile":
    case "releaseTile":
      return rules.board.ownershipEnabled ? ENABLED : disabled("board.ownershipEnabled");
    case "startProject":
      return rules.projects.enabled ? ENABLED : disabled("projects.enabled");
    case "contributeToProject":
      return rules.projects.enabled ? ENABLED : disabled("projects.enabled");
    case "sabotageProject":
      if (!rules.projects.enabled) return disabled("projects.enabled");

      return rules.projects.sabotageable ? ENABLED : disabled("projects.sabotageable");
    case "openBallot":
      if (effect.ballotKind === "vote") {
        return rules.interaction.votesEnabled
          ? ENABLED
          : disabled("interaction.votesEnabled");
      }

      return rules.interaction.auctionsEnabled
        ? ENABLED
        : disabled("interaction.auctionsEnabled");
    case "grantImmunity":
      return rules.conflict.defenceEnabled ? ENABLED : disabled("conflict.defenceEnabled");
    case "forceDiscard":
      return rules.agency.handEnabled ? ENABLED : disabled("agency.handEnabled");
    case "swapBoardPositions":
    case "teleport":
      // Self-teleport is a movement trick, not an attack, so it stays open; the
      // cross-player case is gated by `conflict.targetedAttacks` above.
      return ENABLED;
    case "modifyUpkeep":
      return rules.economy.upkeepEnabled ? ENABLED : disabled("economy.upkeepEnabled");
    case "openReactionWindow":
      return rules.interaction.reactionWindows
        ? ENABLED
        : disabled("interaction.reactionWindows");
    case "grantIncomeStream":
      return rules.economy.incomeStreamsEnabled
        ? ENABLED
        : disabled("economy.incomeStreamsEnabled");
    case "opposedRoll":
      // Two rollers and a stake. There is no mode where a contest between two
      // players is anything but conflict, and §5.4 marks every authored
      // `opposedRoll` aimed — so it rides the same switch, already applied
      // above, and needs no second one.
      return ENABLED;
    case "removeStatuses":
    case "chooseOne":
    case "noEffect":
      // No `ModeRules` field of their own, deliberately. Removing a status you
      // are carrying, branching on a card you drew, and doing nothing on purpose
      // are all things every mode allows; gating them would need a switch
      // nothing in §4 declares, and §4's binding rule is that no mechanic may be
      // gated on anything but a named `ModeRules` field.
      return ENABLED;
    default:
      // Every v1 effect: no v2 switch of its own, and its cross-player
      // hostility (if any) was already gated above.
      return ENABLED;
  }
}
