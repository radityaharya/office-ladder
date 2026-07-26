import { describe, expect, it } from "vitest";

import {
  EFFECT_TARGETS,
  leaderPlayerId,
  livePlayerIds,
  resolveEffectTargets,
} from "../src/execution/effects-v2";
import type { EffectTarget } from "../src/execution/effects-v2";
import type { GameState, PlayerId } from "../src";
import { effectsV2Ids, effectsV2State, roundTrip } from "./effects-v2-fixtures";
import { withRules } from "./turn-loop-fixtures";

const { actor, rival, leader } = effectsV2Ids;

function targets(
  state: GameState,
  target: EffectTarget,
  options: { readonly actorId?: PlayerId; readonly hostile?: boolean } = {},
): readonly PlayerId[] {
  const resolution = resolveEffectTargets({
    state,
    actorId: options.actorId ?? actor,
    target,
    hostile: options.hostile ?? false,
  });
  if (resolution.kind !== "resolved") {
    throw new Error(`expected a resolved target set, got ${resolution.kind}`);
  }

  return resolution.playerIds;
}

describe("effects-v2 targeting — the eleven values of spec §10.1", () => {
  it("resolves every non-choice target deterministically", () => {
    const state = effectsV2State();

    expect(targets(state, "self")).toEqual([actor]);
    expect(targets(state, "active-player")).toEqual([actor]);
    expect(targets(state, "all-opponents")).toEqual([rival, leader]);
    expect(targets(state, "all-players")).toEqual([actor, rival, leader]);
    expect(targets(state, "right-neighbour")).toEqual([rival]);
    expect(targets(state, "left-neighbour")).toEqual([leader]);
    expect(targets(state, "highest-rank")).toEqual([leader]);
    expect(targets(state, "lowest-rank")).toEqual([rival]);
    expect(targets(state, "richest")).toEqual([leader]);
    expect(targets(state, "poorest")).toEqual([rival]);
  });

  it("covers every declared target value", () => {
    const state = effectsV2State();

    for (const target of EFFECT_TARGETS) {
      const resolution = resolveEffectTargets({ state, actorId: actor, target, hostile: false });
      expect(["resolved", "choice-required"]).toContain(resolution.kind);
    }
    expect(EFFECT_TARGETS).toHaveLength(11);
  });

  it("never resolves chosen-opponent silently — it demands a decision", () => {
    const state = effectsV2State();
    const resolution = resolveEffectTargets({
      state,
      actorId: actor,
      target: "chosen-opponent",
      hostile: true,
    });

    expect(resolution.kind).toBe("choice-required");
    if (resolution.kind !== "choice-required") return;
    expect(resolution.candidateIds).toEqual([rival, leader]);
    expect(resolution.candidateIds).not.toContain(actor);
  });
});

describe("effects-v2 targeting — tie-breaks come from playerOrder, never key order", () => {
  /**
   * Two players tied on the derived key. `playerOrder` says the actor is first,
   * so the actor wins the tie — and must keep winning it after the state has
   * been through JSON, which is the property object-key iteration cannot give.
   */
  function tiedState(): GameState {
    const base = effectsV2State();

    return {
      ...base,
      players: {
        ...base.players,
        [actor]: {
          ...base.players[actor],
          rank: { ...base.players[actor].rank, index: 3 },
          resources: {
            ...base.players[actor].resources,
            money: { ...base.players[actor].resources["money"], value: 2000 },
          },
        },
      },
    };
  }

  it("breaks a rank tie toward the earlier seat in playerOrder", () => {
    expect(targets(tiedState(), "highest-rank")).toEqual([actor]);
  });

  it("breaks a money tie toward the earlier seat in playerOrder", () => {
    expect(targets(tiedState(), "richest")).toEqual([actor]);
  });

  it("survives a JSON round trip with the same answer", () => {
    const before = tiedState();
    const after = roundTrip(before);

    expect(targets(after, "highest-rank")).toEqual(targets(before, "highest-rank"));
    expect(targets(after, "richest")).toEqual(targets(before, "richest"));
  });

  /**
   * The failure this guards against is specific: a resolver reading
   * `Object.keys(state.players)` gets *insertion* order, and a state rebuilt
   * with its player map written in a different order would then pick a different
   * winner for the same tie. `playerOrder` is untouched by that rewrite, so the
   * answer must not move.
   */
  it("ignores the insertion order of the player map entirely", () => {
    const original = tiedState();
    const reversedKeys: GameState = {
      ...original,
      players: {
        [leader]: original.players[leader],
        [rival]: original.players[rival],
        [actor]: original.players[actor],
      },
    };

    expect(Object.keys(reversedKeys.players)).toEqual([leader, rival, actor]);
    expect(targets(reversedKeys, "highest-rank")).toEqual([actor]);
    expect(targets(reversedKeys, "richest")).toEqual([actor]);
    expect(targets(reversedKeys, "all-opponents")).toEqual([rival, leader]);
  });
});

describe("effects-v2 targeting — eliminated players and leader protection", () => {
  it("never targets an eliminated player", () => {
    const state: GameState = { ...effectsV2State(), eliminatedPlayerIds: [rival] };

    expect(livePlayerIds(state)).toEqual([actor, leader]);
    expect(targets(state, "all-players")).toEqual([actor, leader]);
    expect(targets(state, "all-opponents")).toEqual([leader]);
    expect(targets(state, "poorest")).toEqual([actor]);
    // The right neighbour walks past the eliminated seat rather than stopping.
    expect(targets(state, "right-neighbour")).toEqual([leader]);
  });

  it("names the leader by rank first, money as the decider", () => {
    const state = effectsV2State();

    expect(leaderPlayerId(state)).toBe(leader);
  });

  it("hard leader protection removes the leader from a hostile target pool", () => {
    const state = withRules(effectsV2State(), { conflict: { leaderProtection: "hard" } });

    expect(targets(state, "all-opponents", { hostile: true })).toEqual([rival]);
    // `highest-rank` picks the next-best player rather than resolving to nobody.
    expect(targets(state, "highest-rank", { hostile: true })).toEqual([actor]);
    expect(targets(state, "richest", { hostile: true })).toEqual([actor]);
  });

  it("hard leader protection leaves benign effects alone", () => {
    const state = withRules(effectsV2State(), { conflict: { leaderProtection: "hard" } });

    expect(targets(state, "all-players", { hostile: false })).toEqual([actor, rival, leader]);
    expect(targets(state, "richest", { hostile: false })).toEqual([leader]);
  });

  it("never protects a player from their own self-targeted effect", () => {
    const state = withRules(effectsV2State(), { conflict: { leaderProtection: "hard" } });

    expect(targets(state, "self", { actorId: leader, hostile: true })).toEqual([leader]);
  });
});
