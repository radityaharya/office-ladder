import { describe, expect, it } from "vitest";

import {
  CHOOSE_OPPONENT_PROMPT_KIND,
  IMMUNITY_STATUS_ID,
  cancelPendingEffect,
  decodePendingEffect,
  resolveEffectsV2,
  resumePendingEffect,
} from "../src/execution/effects-v2";
import type { EffectV2, EffectsV2Outcome } from "../src/execution/effects-v2";
import type { GameState, PlayerId } from "../src";
import {
  effectsRandom,
  effectsV2Ids,
  effectsV2State,
  moneyOf,
  roundTrip,
} from "./effects-v2-fixtures";
import { withRules } from "./turn-loop-fixtures";

const { actor, rival, leader } = effectsV2Ids;

function run(
  state: GameState,
  effects: readonly EffectV2[],
  actorId: PlayerId = actor,
): EffectsV2Outcome {
  return resolveEffectsV2({ state, actorId, effects, random: effectsRandom(), options: {} });
}

const steal: EffectV2 = {
  type: "transferResource",
  resource: "money",
  amount: 300,
  target: "chosen-opponent",
};

describe("chosen-opponent opens a prompt instead of picking (spec §10.1)", () => {
  it("parks the effect and asks the actor, changing nothing yet", () => {
    const before = effectsV2State();
    const outcome = run(before, [steal]);

    expect(outcome.openedPrompts).toHaveLength(1);
    expect(outcome.parkedEffects).toHaveLength(1);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(moneyOf(outcome.state, rival)).toBe(moneyOf(before, rival));
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader));
  });

  it("addresses the prompt to the actor alone and offers every eligible opponent", () => {
    const prompt = run(effectsV2State(), [steal]).openedPrompts[0];

    expect(prompt?.kind).toBe(CHOOSE_OPPONENT_PROMPT_KIND);
    expect(prompt?.audience).toEqual([actor]);
    expect(prompt?.legalResponses.map((option) => option.value)).toEqual([rival, leader]);
    // The default is the first eligible opponent in `playerOrder` — deterministic,
    // and nothing a stalling actor can steer.
    expect(prompt?.defaultResponse.value).toBe(rival);
  });

  it("links the prompt to the parked effect through a shared frame", () => {
    const outcome = run(effectsV2State(), [steal]);

    expect(outcome.openedPrompts[0]?.frameId).toBe(outcome.parkedEffects[0]?.frameId);
  });

  it("parks a payload the reactions/prompt side can read back", () => {
    const outcome = run(effectsV2State(), [steal]);
    const payload = decodePendingEffect(outcome.parkedEffects[0]!.effect);

    expect(payload?.actorId).toBe(actor);
    expect(payload?.effect.type).toBe("transferResource");
    // The target is rewritten to `self`: resolution already happened, and
    // re-deriving it later would re-aim the effect at a different player.
    expect(payload?.effect.target).toBe("self");
  });

  it("applies the effect only once the actor has answered", () => {
    const before = effectsV2State();
    const parked = run(before, [steal]);
    const pendingId = parked.parkedEffects[0]!.id;

    const resumed = resumePendingEffect(parked.state, pendingId, effectsRandom(), {
      chosenPlayerIds: [leader],
      expectedActorId: actor,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;

    expect(moneyOf(resumed.outcome.state, leader)).toBe(moneyOf(before, leader) - 300);
    expect(moneyOf(resumed.outcome.state, actor)).toBe(moneyOf(before, actor) + 300);
    expect(moneyOf(resumed.outcome.state, rival)).toBe(moneyOf(before, rival));
  });

  it("refuses a chosen target who was never eligible", () => {
    const parked = run(effectsV2State(), [steal]);
    const pendingId = parked.parkedEffects[0]!.id;

    // The actor is not one of their own opponents; answering with themselves is
    // the obvious way to turn a steal into a no-op, or worse, a self-heal.
    expect(
      resumePendingEffect(parked.state, pendingId, effectsRandom(), {
        chosenPlayerIds: [actor],
      }),
    ).toEqual({ ok: false, reason: "target-not-eligible" });
    expect(
      resumePendingEffect(parked.state, pendingId, effectsRandom(), {
        chosenPlayerIds: ["player-not-at-this-table" as PlayerId],
      }),
    ).toEqual({ ok: false, reason: "target-not-eligible" });
    expect(
      resumePendingEffect(parked.state, pendingId, effectsRandom(), { chosenPlayerIds: [] }),
    ).toEqual({ ok: false, reason: "target-not-eligible" });
  });

  it("refuses to let anyone but the parked actor answer (spec §6.3)", () => {
    const before = effectsV2State();
    const parked = run(before, [steal]);
    const pendingId = parked.parkedEffects[0]!.id;

    // The rival tries to answer the actor's prompt and aim the steal at the
    // leader. Rejected before anything moves.
    const hijack = resumePendingEffect(parked.state, pendingId, effectsRandom(), {
      chosenPlayerIds: [leader],
      expectedActorId: rival,
    });

    expect(hijack).toEqual({ ok: false, reason: "actor-mismatch" });
    expect(parked.state.pendingEffects).toHaveLength(1);
    expect(moneyOf(parked.state, leader)).toBe(moneyOf(before, leader));
    expect(moneyOf(parked.state, rival)).toBe(moneyOf(before, rival));
  });

  it("refuses a target who has been eliminated since the prompt opened", () => {
    const parked = run(effectsV2State(), [steal]);
    const pendingId = parked.parkedEffects[0]!.id;
    const afterElimination: GameState = {
      ...parked.state,
      eliminatedPlayerIds: [leader],
    };

    expect(
      resumePendingEffect(afterElimination, pendingId, effectsRandom(), {
        chosenPlayerIds: [leader],
      }),
    ).toEqual({ ok: false, reason: "target-not-eligible" });
  });

  it("says nothing to ask when there is nobody to choose from", () => {
    const soloTable: GameState = {
      ...effectsV2State(),
      eliminatedPlayerIds: [rival, leader],
    };
    const outcome = run(soloTable, [steal]);

    expect(outcome.openedPrompts).toHaveLength(0);
    expect(outcome.parkedEffects).toHaveLength(0);
    expect(outcome.trace).toContainEqual({
      type: "effect-skipped",
      reason: "no-target",
      rule: null,
      path: "0",
      playerId: null,
    });
  });
});

describe("preventable: true is what raises a ReactionWindowState (spec §10.3)", () => {
  const preventableSteal: EffectV2 = {
    type: "transferResource",
    resource: "money",
    amount: 300,
    target: "richest",
    preventable: true,
  };

  it("parks the effect behind a window pointing back at it", () => {
    const before = effectsV2State();
    const outcome = run(before, [preventableSteal]);
    const window = outcome.openedReactionWindows[0];
    const pending = outcome.parkedEffects[0];

    expect(window?.kind).toBe("prevention");
    expect(window?.pendingEffectId).toBe(pending?.id);
    expect(window?.frameId).toBe(pending?.frameId);
    expect(window?.eligiblePlayerIds).toEqual([leader]);
    expect(window?.priorityPlayerId).toBe(leader);
    expect(pending?.preventionEligible).toBe(true);
    expect(pending?.affectedPlayerIds).toEqual([leader]);
    // Nothing has landed yet.
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader));
  });

  it("does not raise a window when the mode has reaction windows off", () => {
    const before = withRules(effectsV2State(), { interaction: { reactionWindows: false } });
    const outcome = run(before, [preventableSteal]);

    expect(outcome.openedReactionWindows).toHaveLength(0);
    expect(outcome.parkedEffects).toHaveLength(0);
    // With nobody able to react, the effect simply resolves.
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader) - 300);
  });

  it("does not raise a window for an effect that only touches the actor", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      { type: "modifyResource", resource: "money", amount: -100, preventable: true },
    ]);

    expect(outcome.openedReactionWindows).toHaveLength(0);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor) - 100);
  });

  it("leaves a non-preventable effect alone — false is the default", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      { type: "transferResource", resource: "money", amount: 300, target: "richest" },
    ]);

    expect(outcome.openedReactionWindows).toHaveLength(0);
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader) - 300);
  });

  it("resumes into the same targets it parked with", () => {
    const before = effectsV2State();
    const parked = run(before, [preventableSteal]);
    const resumed = resumePendingEffect(
      parked.state,
      parked.parkedEffects[0]!.id,
      effectsRandom(),
    );

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(moneyOf(resumed.outcome.state, leader)).toBe(moneyOf(before, leader) - 300);
    // The window and the parked effect are both gone once it resolves.
    expect(resumed.outcome.state.pendingEffects).toHaveLength(0);
    expect(resumed.outcome.state.reactionWindows).toHaveLength(0);
  });

  it("is idempotent: a second resume cannot double-apply (spec §7.1)", () => {
    const before = effectsV2State();
    const parked = run(before, [preventableSteal]);
    const pendingId = parked.parkedEffects[0]!.id;

    const first = resumePendingEffect(parked.state, pendingId, effectsRandom());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = resumePendingEffect(first.outcome.state, pendingId, effectsRandom());
    expect(second).toEqual({ ok: false, reason: "not-parked" });
    expect(moneyOf(first.outcome.state, leader)).toBe(moneyOf(before, leader) - 300);
  });

  it("cancels cleanly when a reaction actually prevents it", () => {
    const before = effectsV2State();
    const parked = run(before, [preventableSteal]);
    const pendingId = parked.parkedEffects[0]!.id;

    const cancelled = cancelPendingEffect(parked.state, pendingId);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.state.pendingEffects).toHaveLength(0);
    expect(cancelled.state.reactionWindows).toHaveLength(0);
    expect(moneyOf(cancelled.state, leader)).toBe(moneyOf(before, leader));

    // Cancelling twice is a no-op, and a cancelled effect can never be resumed.
    expect(cancelPendingEffect(cancelled.state, pendingId).cancelled).toBe(false);
    expect(resumePendingEffect(cancelled.state, pendingId, effectsRandom())).toEqual({
      ok: false,
      reason: "not-parked",
    });
  });

  it("refuses to resume a pending effect this resolver did not write", () => {
    const foreign: GameState = {
      ...effectsV2State(),
      pendingEffects: [
        {
          id: "effect-from-somewhere-else" as never,
          frameId: "frame-from-somewhere-else" as never,
          sourceId: null,
          affectedPlayerIds: [],
          effect: { kind: "something-else" },
          preventionEligible: false,
          visibility: "public",
        },
      ],
    };

    expect(
      resumePendingEffect(foreign, "effect-from-somewhere-else" as never, effectsRandom()),
    ).toEqual({ ok: false, reason: "not-effects-v2" });
  });

  it("survives a JSON round trip and still resumes to the same result", () => {
    const before = effectsV2State();
    const parked = run(before, [preventableSteal]);
    const persisted = roundTrip(parked.state);
    expect(persisted).toEqual(parked.state);

    const resumed = resumePendingEffect(
      persisted,
      parked.parkedEffects[0]!.id,
      effectsRandom(),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(moneyOf(resumed.outcome.state, leader)).toBe(moneyOf(before, leader) - 300);
  });
});

describe("grantImmunity blocks preventable effects and is really consumed", () => {
  const preventableHit: EffectV2 = {
    type: "modifyResource",
    resource: "reputation",
    amount: -3,
    target: "right-neighbour",
    preventable: true,
  };

  function shielded(): GameState {
    const base = effectsV2State();
    const granted = resolveEffectsV2({
      state: base,
      actorId: rival,
      effects: [{ type: "grantImmunity", charges: 1 }],
      random: effectsRandom(),
      options: {},
    });

    return granted.state;
  }

  it("absorbs the effect and spends the charge", () => {
    const before = shielded();
    const outcome = run(before, [preventableHit]);

    expect(outcome.state.players[rival]?.resources["reputation"]?.value).toBe(2);
    expect(
      outcome.state.players[rival]?.statuses.find((status) => status.id === IMMUNITY_STATUS_ID),
    ).toBeUndefined();
    expect(outcome.trace).toContainEqual({
      type: "effect-skipped",
      reason: "immune",
      rule: null,
      path: "0",
      playerId: rival,
    });
  });

  it("only absorbs once — the second hit gets through to a window and then lands", () => {
    const outcome = run(shielded(), [preventableHit, preventableHit]);

    // First hit absorbed; second one has no charge left to eat it, so it does
    // what any unabsorbed preventable effect does — it raises a window.
    expect(outcome.state.players[rival]?.resources["reputation"]?.value).toBe(2);
    expect(outcome.openedReactionWindows).toHaveLength(1);
    expect(outcome.openedReactionWindows[0]?.eligiblePlayerIds).toEqual([rival]);

    const resumed = resumePendingEffect(
      outcome.state,
      outcome.parkedEffects[0]!.id,
      effectsRandom(),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.outcome.state.players[rival]?.resources["reputation"]?.value).toBe(-1);
  });

  it("does not absorb a non-preventable effect", () => {
    const outcome = run(shielded(), [{ ...preventableHit, preventable: false }]);

    // v1 clamping is authored, not implied: `modifyResource` without
    // `clampAtZero` goes negative here exactly as it always has.
    expect(outcome.state.players[rival]?.resources["reputation"]?.value).toBe(-1);
    expect(
      outcome.state.players[rival]?.statuses.find((status) => status.id === IMMUNITY_STATUS_ID)
        ?.stacks,
    ).toBe(1);
  });

  it("means an all-opponents effect still lands on everybody else", () => {
    const outcome = run(shielded(), [
      { type: "modifyResource", resource: "reputation", amount: -3, target: "all-opponents", preventable: true },
    ]);

    expect(outcome.state.players[rival]?.resources["reputation"]?.value).toBe(2);
    // Only the unshielded opponent is left to react, so a window opens for them.
    expect(outcome.openedReactionWindows[0]?.eligiblePlayerIds).toEqual([leader]);
  });
});
