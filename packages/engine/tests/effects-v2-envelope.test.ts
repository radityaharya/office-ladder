import { describe, expect, it } from "vitest";

import {
  EFFECT_TIMINGS,
  EFFECT_V2_TYPES,
  carriesHeatForAggression,
  effectTarget,
  effectTiming,
  evaluateEffectCondition,
  isAggressiveEffectShape,
  isCardPlayableUnderRules,
  isEffectTimingEnabled,
  isLegacyEffect,
  isNewEffect,
  isPreventable,
  parseEffectCondition,
  resolveEffectsV2,
} from "../src/execution/effects-v2";
import type { EffectCondition, EffectV2 } from "../src/execution/effects-v2";
import type { GameState } from "../src";
import {
  contentTileId,
  effectsRandom,
  effectsV2Ids,
  effectsV2State,
  moneyOf,
} from "./effects-v2-fixtures";
import { withRules } from "./turn-loop-fixtures";

const { actor, rival, leader } = effectsV2Ids;

function run(state: GameState, effects: readonly EffectV2[]) {
  return resolveEffectsV2({
    state,
    actorId: actor,
    effects,
    random: effectsRandom(),
    options: {},
  });
}

describe("the envelope's defaults reproduce v1 exactly", () => {
  it("defaults target to self, timing to immediate, preventable to false", () => {
    const bare: EffectV2 = { type: "modifyResource", resource: "money", amount: 10 };

    expect(effectTarget(bare)).toBe("self");
    expect(effectTiming(bare)).toBe("immediate");
    expect(isPreventable(bare)).toBe(false);
  });

  it("classifies every v2 type as new and every v1 type as legacy", () => {
    // Sixteen from spec §10.3, plus the four the re-cut plan's §3 and §11 add:
    // `removeStatuses`, `chooseOne`, `noEffect`, `opposedRoll`. All four were
    // classified as *legacy* until this table grew, which routed them into the v1
    // applier — the exact silent-no-op failure the exhaustive switch exists to
    // make impossible.
    expect(EFFECT_V2_TYPES).toHaveLength(20);
    expect(EFFECT_V2_TYPES).toContain("removeStatuses");
    expect(EFFECT_V2_TYPES).toContain("chooseOne");
    expect(EFFECT_V2_TYPES).toContain("noEffect");
    expect(EFFECT_V2_TYPES).toContain("opposedRoll");
    for (const type of EFFECT_V2_TYPES) {
      const effect = { type } as unknown as EffectV2;
      expect(isNewEffect(effect)).toBe(true);
      expect(isLegacyEffect(effect)).toBe(false);
    }

    const legacy: EffectV2 = { type: "grantExtraRoll", count: 1 };
    expect(isLegacyEffect(legacy)).toBe(true);
    expect(isNewEffect(legacy)).toBe(false);
  });
});

describe("timing (spec §10.2)", () => {
  it("allows immediate always, and gates the other two on their own rules", () => {
    const rules = effectsV2State().rules;

    expect(EFFECT_TIMINGS).toEqual(["immediate", "stored", "reaction"]);
    expect(isEffectTimingEnabled(rules, "immediate")).toBe(true);
    expect(isEffectTimingEnabled(rules, "stored")).toBe(rules.agency.handEnabled);
    expect(isEffectTimingEnabled(rules, "reaction")).toBe(rules.interaction.reactionWindows);
  });

  it("holds a stored effect back instead of resolving it on draw", () => {
    const before = effectsV2State();
    const stored: EffectV2 = {
      type: "modifyResource",
      resource: "money",
      amount: 500,
      timing: "stored",
    };
    const outcome = run(before, [stored]);

    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(outcome.storedEffects).toEqual([stored]);
  });

  it("holds a reaction effect back until it is resolved inside a window", () => {
    const before = effectsV2State();
    const reaction: EffectV2 = {
      type: "modifyResource",
      resource: "money",
      amount: 500,
      timing: "reaction",
    };

    const outside = run(before, [reaction]);
    expect(moneyOf(outside.state, actor)).toBe(moneyOf(before, actor));
    expect(outside.storedEffects).toEqual([reaction]);

    const inside = resolveEffectsV2({
      state: before,
      actorId: actor,
      effects: [reaction],
      random: effectsRandom(),
      options: { insideReactionWindow: true },
    });
    expect(moneyOf(inside.state, actor)).toBe(moneyOf(before, actor) + 500);
  });

  it("refuses a timing the mode has switched off, naming the rule", () => {
    const noHand = withRules(effectsV2State(), { agency: { handEnabled: false } });
    const outcome = run(noHand, [
      { type: "modifyResource", resource: "money", amount: 500, timing: "stored" },
    ]);

    expect(outcome.storedEffects).toEqual([]);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(noHand, actor));
    expect(outcome.trace).toContainEqual({
      type: "effect-skipped",
      reason: "timing-disabled",
      rule: "agency.handEnabled",
      path: "0",
      playerId: null,
    });
  });

  it("tells deck construction which cards may not enter a deck at all", () => {
    const noHand = withRules(effectsV2State(), { agency: { handEnabled: false } }).rules;
    const everything = effectsV2State().rules;
    const storedCard: readonly EffectV2[] = [
      { type: "modifyResource", resource: "money", amount: 500, timing: "stored" },
    ];
    const immediateCard: readonly EffectV2[] = [
      { type: "modifyResource", resource: "money", amount: 500 },
    ];

    expect(isCardPlayableUnderRules(noHand, storedCard)).toBe(false);
    expect(isCardPlayableUnderRules(noHand, immediateCard)).toBe(true);
    expect(isCardPlayableUnderRules(everything, storedCard)).toBe(true);
  });
});

describe("condition (spec §10.3)", () => {
  const state = effectsV2State();

  const holds = (condition: EffectCondition, targetId = rival): boolean =>
    evaluateEffectCondition(state, condition, actor, targetId);

  it("reads the actor and the target separately", () => {
    expect(holds({ kind: "resourceAtLeast", who: "actor", resource: "money", amount: 1000 })).toBe(
      true,
    );
    expect(holds({ kind: "resourceAtLeast", who: "target", resource: "money", amount: 1000 })).toBe(
      false,
    );
    expect(
      holds({ kind: "resourceAtLeast", who: "target", resource: "money", amount: 1000 }, leader),
    ).toBe(true);
  });

  it("evaluates every clause kind", () => {
    expect(holds({ kind: "always" })).toBe(true);
    expect(holds({ kind: "never" })).toBe(false);
    expect(holds({ kind: "resourceAtMost", who: "target", resource: "money", amount: 400 })).toBe(
      true,
    );
    expect(holds({ kind: "rankIndexAtLeast", who: "actor", index: 1 })).toBe(true);
    expect(holds({ kind: "rankIndexAtMost", who: "target", index: 0 })).toBe(true);
    expect(holds({ kind: "heatAtLeast", who: "actor", value: 1 })).toBe(false);
    expect(holds({ kind: "hasStatus", who: "actor", statusId: "status.burnout-tile" })).toBe(
      false,
    );
    expect(
      holds({ kind: "ownsTile", who: "target", tileId: contentTileId(effectsV2Ids.takenTile) }),
    ).toBe(false);
    expect(
      holds(
        { kind: "ownsTile", who: "target", tileId: contentTileId(effectsV2Ids.takenTile) },
        leader,
      ),
    ).toBe(true);
    expect(holds({ kind: "roundAtLeast", round: 2 })).toBe(true);
    expect(holds({ kind: "roundAtLeast", round: 3 })).toBe(false);
    expect(holds({ kind: "quarterIndex", index: 0 })).toBe(true);
    expect(holds({ kind: "not", of: { kind: "always" } })).toBe(false);
    expect(holds({ kind: "all", of: [{ kind: "always" }, { kind: "never" }] })).toBe(false);
    expect(holds({ kind: "any", of: [{ kind: "always" }, { kind: "never" }] })).toBe(true);
  });

  it("gates an effect per target rather than for the whole batch", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "transferResource",
        resource: "money",
        amount: 300,
        target: "all-opponents",
        condition: { kind: "resourceAtLeast", who: "target", resource: "money", amount: 1000 },
      },
    ]);

    // The rival is poor and is skipped; the leader can afford it and is not.
    expect(moneyOf(outcome.state, rival)).toBe(moneyOf(before, rival));
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader) - 300);
    expect(outcome.trace).toContainEqual({
      type: "effect-skipped",
      reason: "condition-failed",
      rule: null,
      path: "0",
      playerId: rival,
    });
  });

  it("fails closed on a condition it cannot parse", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "modifyResource",
        resource: "money",
        amount: 500,
        condition: { kind: "sudo-make-it-true" } as unknown as EffectCondition,
      },
    ]);

    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(outcome.trace).toContainEqual({
      type: "effect-skipped",
      reason: "condition-unparseable",
      rule: null,
      path: "0",
      playerId: actor,
    });
  });

  it("parses a condition back out of the loose JSON the spec stores it as", () => {
    const raw = {
      kind: "all",
      of: [
        { kind: "roundAtLeast", round: 2 },
        { kind: "not", of: { kind: "heatAtLeast", who: "actor", value: 3 } },
      ],
    };

    expect(parseEffectCondition(raw)).toEqual(raw);
    expect(parseEffectCondition({ kind: "resourceAtLeast", who: "nobody" })).toBeNull();
    expect(parseEffectCondition({ kind: "roundAtLeast" })).toBeNull();
    expect(parseEffectCondition("always")).toBeNull();
    expect(parseEffectCondition(undefined)).toBeNull();
  });
});

describe("the §10.4 authoring rule is mechanically checkable", () => {
  it("recognises every aggressive shape", () => {
    expect(isAggressiveEffectShape({ type: "transferResource", resource: "money", amount: 1 })).toBe(
      true,
    );
    expect(isAggressiveEffectShape({ type: "forceDiscard", count: 1 })).toBe(true);
    expect(isAggressiveEffectShape({ type: "sabotageProject", amount: 1 })).toBe(true);
    expect(isAggressiveEffectShape({ type: "swapBoardPositions" })).toBe(true);
    expect(isAggressiveEffectShape({ type: "modifyResource", resource: "money", amount: -1 })).toBe(
      true,
    );
    expect(isAggressiveEffectShape({ type: "modifyResource", resource: "money", amount: 1 })).toBe(
      false,
    );
    expect(isAggressiveEffectShape({ type: "grantExtraRoll", count: 1 })).toBe(false);
  });

  it("requires a self-directed modifyHeat alongside cross-table aggression", () => {
    const naked: readonly EffectV2[] = [
      { type: "transferResource", resource: "money", amount: 200, target: "chosen-opponent" },
    ];
    const withHeat: readonly EffectV2[] = [
      ...naked,
      { type: "modifyHeat", amount: 1 },
    ];
    const benign: readonly EffectV2[] = [
      { type: "modifyResource", resource: "money", amount: 200, target: "all-players" },
    ];

    expect(carriesHeatForAggression(naked)).toBe(false);
    expect(carriesHeatForAggression(withHeat)).toBe(true);
    expect(carriesHeatForAggression(benign)).toBe(true);
  });
});
