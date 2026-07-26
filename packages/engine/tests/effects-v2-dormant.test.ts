import { describe, expect, it } from "vitest";

import {
  CHOOSE_ONE_PROMPT_KIND,
  IMMUNITY_STATUS_ID,
  STATUS_POLARITY_KEY,
  STATUS_SOURCE_DECK_KEY,
  immunityScope,
  resolveEffectsV2,
  resumePendingEffect,
  scaledAmount,
  statusPolarity,
  statusSourceDeckId,
} from "../src/execution/effects-v2";
import type {
  EffectV2,
  EffectsV2Options,
  EffectsV2Outcome,
} from "../src/execution/effects-v2";
import { createSeededRandomSource } from "../src";
import type { GameState, PlayerId, PlayerState } from "../src";
import {
  effectsRandom,
  effectsV2Ids,
  effectsV2State,
  moneyOf,
  reputationOf,
  roundTrip,
} from "./effects-v2-fixtures";
import { withRules } from "./turn-loop-fixtures";

/**
 * The nine schema features that validated and then did nothing.
 *
 * Each one had a type, a validator entry and authored usage in the 242-card
 * pack, and no behaviour whatsoever behind it. This file is the proof that each
 * now has a consumer — and, for the two that carry the most weight, that the
 * consumer does the thing the design depends on rather than merely existing:
 *
 * - **`scale`** is what makes §10.6 mandate 4 satisfiable. Forty-five corner
 *   cards apply one instruction to every seat, and a symmetric effect applied to
 *   everyone changes nobody's relative standing. The assertions below check that
 *   the *same* effect moves different amounts for different players, because
 *   that difference is the entire mechanic.
 * - **`removeStatuses`** needs provenance to be evaluable at all. "Remove all
 *   negative Work card effects" is not a missing verb, it is a verb with nothing
 *   to filter on, so the provenance tests come first.
 */

const { actor, rival, leader } = effectsV2Ids;

function run(
  state: GameState,
  effects: readonly EffectV2[],
  options: EffectsV2Options = {},
  actorId: PlayerId = actor,
): EffectsV2Outcome {
  return resolveEffectsV2({
    state,
    actorId,
    effects,
    random: effectsRandom(),
    options,
  });
}

function playerOf(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players[playerId];
  if (player === undefined) throw new Error(`no player ${playerId}`);

  return player;
}

function energyOf(state: GameState, playerId: PlayerId): number {
  return state.players[playerId]?.resources["energy"]?.value ?? 0;
}

function skips(outcome: EffectsV2Outcome): readonly string[] {
  return outcome.trace
    .filter((entry) => entry.type === "effect-skipped")
    .map((entry) => entry.reason);
}

/* ------------------------------------------------------------------ scale */

describe("scale — the asymmetry vehicle §10.6 mandate 4 depends on", () => {
  /**
   * The fixture's three seats sit at rank 1 / 0 / 3 with 1000 / 400 / 2000
   * money, so a rank-scaled all-players effect must pay three different amounts.
   */
  it("pays each player by their own metric, not the drawer's, on an all-players effect", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "modifyResource",
        resource: "money",
        amount: 100,
        target: "all-players",
        scale: { by: "rank-tier", perUnit: 100 },
      },
    ]);

    // actor rank 1 → 200, rival rank 0 → 100, leader rank 3 → 400.
    expect(moneyOf(outcome.state, actor) - moneyOf(before, actor)).toBe(200);
    expect(moneyOf(outcome.state, rival) - moneyOf(before, rival)).toBe(100);
    expect(moneyOf(outcome.state, leader) - moneyOf(before, leader)).toBe(400);

    // The finding that triggered the whole re-cut, stated as an assertion: the
    // three deltas must not all be equal, or the card is ceremonial.
    const deltas = new Set([
      moneyOf(outcome.state, actor) - moneyOf(before, actor),
      moneyOf(outcome.state, rival) - moneyOf(before, rival),
      moneyOf(outcome.state, leader) - moneyOf(before, leader),
    ]);
    expect(deltas.size).toBe(3);
  });

  it("reads the actor once when `of` says so", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "modifyResource",
        resource: "money",
        amount: 100,
        target: "all-players",
        scale: { by: "rank-tier", perUnit: 100, of: "actor" },
      },
    ]);

    // Every seat now gets the *actor's* rank-1 amount, which is exactly the
    // symmetric reading `of` exists to distinguish from the default.
    for (const playerId of [actor, rival, leader]) {
      expect(moneyOf(outcome.state, playerId) - moneyOf(before, playerId)).toBe(200);
    }
  });

  it("scales off every declared metric", () => {
    const base = effectsV2State();
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        [actor]: {
          ...playerOf(base, actor),
          position: 7,
          lapsCompleted: 2,
          heat: { ...playerOf(base, actor).heat, value: 3 },
          loans: [
            {
              id: "loan-1" as never,
              principal: 900,
              outstanding: 600,
              interestBasisPoints: 500,
              takenAtRound: 1,
            },
          ],
        },
      },
    };

    const at = (by: Parameters<typeof scaledAmount>[1]["by"], perUnit: number): number =>
      scaledAmount(state, { by, perUnit }, 0, actor, actor);

    expect(at("rank-tier", 1)).toBe(1);
    expect(at("board-position", 1)).toBe(7);
    expect(at("laps", 1)).toBe(2);
    expect(at("heat", 1)).toBe(3);
    expect(at("debt", 1)).toBe(600);
    expect(at("work-counter", 1)).toBe(4);
    // Three live seats, so two opponents — the metric that keeps a corner card
    // balanced from three players to six.
    expect(at("opponent-count", 1)).toBe(2);
  });

  it("caps magnitude without ever flipping the sign", () => {
    const state = effectsV2State();

    expect(scaledAmount(state, { by: "rank-tier", perUnit: 1000, cap: 400 }, 100, actor, leader))
      .toBe(400);
    expect(scaledAmount(state, { by: "rank-tier", perUnit: -1000, cap: 400 }, -100, actor, leader))
      .toBe(-400);
    // Below the cap, the cap does nothing.
    expect(scaledAmount(state, { by: "rank-tier", perUnit: 10, cap: 400 }, 100, actor, rival))
      .toBe(100);
  });

  it("scales a transfer, so a steal is worth more against a senior target", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "transferResource",
        resource: "money",
        amount: 100,
        target: "all-opponents",
        scale: { by: "rank-tier", perUnit: 100 },
      },
    ]);

    // rival is rank 0 → 100; leader is rank 3 → 400.
    expect(moneyOf(outcome.state, rival)).toBe(moneyOf(before, rival) - 100);
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader) - 400);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor) + 500);
  });

  it("leaves an effect whose amount it cannot mean alone", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "incrementWorkCounter",
        amount: 1,
        rewardEvery: 5,
        reward: { resource: "reputation", amount: 1 },
        cumulative: true,
        // `amount` here is a stride the `rewardEvery` arithmetic assumes, not a
        // magnitude. Scaling it would be a silent rules change.
        scale: { by: "rank-tier", perUnit: 10 },
      },
    ]);

    expect(playerOf(outcome.state, actor).resources["work-counter"]?.value).toBe(5);
  });
});

/* -------------------------------------------------- applyStatus provenance */

describe("applyStatus polarity and sourceDeckId — provenance, not decoration", () => {
  const debuff: EffectV2 = {
    type: "applyStatus",
    statusId: "status.next-work-card-money-multiplier",
    duration: { kind: "uses", count: 1 },
    parameters: { multiplier: 0 },
    polarity: "negative",
    sourceDeckId: "deck.work",
  };

  it("records both on the status it writes, alongside the authored parameters", () => {
    const outcome = run(effectsV2State(), [debuff]);
    const status = playerOf(outcome.state, actor).statuses[0];

    expect(status?.id).toBe("status.next-work-card-money-multiplier");
    expect(statusPolarity(status!)).toBe("negative");
    expect(statusSourceDeckId(status!)).toBe("deck.work");
    // The authored parameter is still readable by its own name — provenance sits
    // beside it under namespaced keys rather than on top of it.
    expect(status?.data["multiplier"]).toBe(0);
    expect(status?.data[STATUS_POLARITY_KEY]).toBe("negative");
    expect(status?.data[STATUS_SOURCE_DECK_KEY]).toBe("deck.work");
  });

  it("infers the deck from the resolving card when the author did not repeat it", () => {
    const outcome = run(
      effectsV2State(),
      [
        {
          type: "applyStatus",
          statusId: "status.next-salary-multiplier",
          duration: { kind: "uses", count: 1 },
          polarity: "positive",
        },
      ],
      { sourceDeckId: "deck.event" },
    );

    const status = playerOf(outcome.state, actor).statuses[0];
    expect(statusSourceDeckId(status!)).toBe("deck.event");
    expect(statusPolarity(status!)).toBe("positive");
  });

  it("survives the repository's JSON round trip with provenance intact", () => {
    const outcome = run(effectsV2State(), [debuff]);
    const revived = roundTrip(outcome.state);

    expect(statusPolarity(playerOf(revived, actor).statuses[0]!)).toBe("negative");
    expect(statusSourceDeckId(playerOf(revived, actor).statuses[0]!)).toBe("deck.work");
    expect(revived).toEqual(outcome.state);
  });

  it("makes an authored polarity answer whether the status is an attack", () => {
    const before = effectsV2State();
    const attacksOff = withRules(before, { conflict: { targetedAttacks: false } });

    const hostile = run(attacksOff, [{ ...debuff, target: "chosen-opponent" }]);
    // A negative status aimed at somebody else is an attack and the mode refuses
    // it; the effect never even reaches the prompt.
    expect(skips(hostile)).toContain("mode-disabled");

    const gift = run(attacksOff, [
      {
        type: "applyStatus",
        statusId: "status.next-salary-multiplier",
        duration: { kind: "uses", count: 1 },
        parameters: { multiplier: 2 },
        polarity: "positive",
        target: "right-neighbour",
      },
    ]);
    expect(skips(gift)).not.toContain("mode-disabled");
    expect(playerOf(gift.state, rival).statuses).toHaveLength(1);
  });
});

/* --------------------------------------------------------- removeStatuses */

describe("removeStatuses — the only verb that takes state away", () => {
  function withStatuses(state: GameState): GameState {
    const seeded = run(state, [
      {
        type: "applyStatus",
        statusId: "status.next-work-card-money-multiplier",
        duration: { kind: "uses", count: 1 },
        polarity: "negative",
        sourceDeckId: "deck.work",
      },
      {
        type: "applyStatus",
        statusId: "status.ignore-next-meeting-energy",
        duration: { kind: "uses", count: 1 },
        polarity: "negative",
        sourceDeckId: "deck.meeting",
      },
      {
        type: "applyStatus",
        statusId: "status.next-salary-multiplier",
        duration: { kind: "uses", count: 1 },
        polarity: "positive",
        sourceDeckId: "deck.work",
      },
    ]);

    return seeded.state;
  }

  it("strips every negative status from one deck and leaves the rest standing", () => {
    const seeded = withStatuses(effectsV2State());
    expect(playerOf(seeded, actor).statuses).toHaveLength(3);

    const outcome = run(seeded, [
      {
        type: "removeStatuses",
        filter: { polarity: "negative", sourceDeckId: "deck.work" },
      },
    ]);

    const remaining = playerOf(outcome.state, actor).statuses.map((status) => status.id);
    expect(remaining).toEqual([
      "status.ignore-next-meeting-energy",
      "status.next-salary-multiplier",
    ]);
    expect(outcome.trace).toContainEqual({
      type: "statuses-removed",
      playerId: actor,
      statusIds: ["status.next-work-card-money-multiplier"],
    });
  });

  it("honours limit, taking the oldest match first", () => {
    const seeded = withStatuses(effectsV2State());
    const outcome = run(seeded, [
      { type: "removeStatuses", filter: { polarity: "negative" }, limit: 1 },
    ]);

    const remaining = playerOf(outcome.state, actor).statuses.map((status) => status.id);
    expect(remaining).toEqual([
      "status.ignore-next-meeting-energy",
      "status.next-salary-multiplier",
    ]);
  });

  it("fails closed on a status whose provenance was never recorded", () => {
    const base = effectsV2State();
    const untagged: GameState = {
      ...base,
      players: {
        ...base.players,
        [actor]: {
          ...playerOf(base, actor),
          statuses: [
            {
              id: "status.burnout-tile" as never,
              sourceId: null,
              stacks: 1,
              remainingTurns: null,
              expiresAtRound: null,
              visibility: "private",
              data: {},
            },
          ],
        },
      },
    };

    const outcome = run(untagged, [
      { type: "removeStatuses", filter: { polarity: "negative" } },
    ]);

    // An untagged status could be anything. Stripping it on a "clear one
    // penalty" card would as easily clear a benefit.
    expect(playerOf(outcome.state, actor).statuses).toHaveLength(1);
    expect(skips(outcome)).toContain("no-status-to-remove");
  });

  it("matches a bare statusId filter without needing provenance", () => {
    const seeded = withStatuses(effectsV2State());
    const outcome = run(seeded, [
      { type: "removeStatuses", filter: { statusId: "status.next-salary-multiplier" } },
    ]);

    expect(
      playerOf(outcome.state, actor).statuses.map((status) => status.id),
    ).not.toContain("status.next-salary-multiplier");
  });
});

/* ----------------------------------------------------------- grantImmunity */

describe("grantImmunity — the declared shape, with a scope that means something", () => {
  const shield: EffectV2 = {
    type: "grantImmunity",
    count: 1,
    scope: { resource: "energy", direction: "loss" },
  };

  it("blocks only what its scope names, and lets everything else through", () => {
    const guarded = run(effectsV2State(), [shield]).state;

    const energyHit = run(guarded, [
      { type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true },
    ]);
    expect(energyOf(energyHit.state, actor)).toBe(energyOf(guarded, actor));
    expect(skips(energyHit)).toContain("immune");

    const moneyHit = run(guarded, [
      { type: "modifyResource", resource: "money", amount: -300, clampAtZero: true },
    ]);
    expect(moneyOf(moneyHit.state, actor)).toBe(moneyOf(guarded, actor) - 300);
  });

  it("does not absorb a gain when it was granted against a loss", () => {
    const guarded = run(effectsV2State(), [shield]).state;
    const gain = run(guarded, [
      { type: "modifyResource", resource: "energy", amount: 2, clampAtMaximum: true },
    ]);

    expect(energyOf(gain.state, actor)).toBe(energyOf(guarded, actor) + 2);
  });

  it("spends a count-based charge exactly once", () => {
    const guarded = run(effectsV2State(), [shield]).state;
    const first = run(guarded, [
      { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
    ]);
    expect(energyOf(first.state, actor)).toBe(energyOf(guarded, actor));
    expect(playerOf(first.state, actor).statuses).toHaveLength(0);

    const second = run(first.state, [
      { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
    ]);
    expect(energyOf(second.state, actor)).toBe(energyOf(first.state, actor) - 1);
  });

  it("never spends a duration-based charge — 'all energy loss this turn' is a window", () => {
    const guarded = run(effectsV2State(), [
      {
        type: "grantImmunity",
        duration: { kind: "turns", count: 1 },
        scope: { resource: "energy", direction: "loss" },
      },
    ]).state;

    const hits = run(guarded, [
      { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
    ]);

    expect(energyOf(hits.state, actor)).toBe(energyOf(guarded, actor));
    expect(playerOf(hits.state, actor).statuses[0]?.remainingTurns).toBe(1);
  });

  it("blocks by effect type — the audit-exemption card's whole mechanism", () => {
    const guarded = run(effectsV2State(), [
      { type: "grantImmunity", count: 1, scope: { effectTypes: ["auditConfinement"] } },
    ]).state;

    const audited = run(guarded, [
      {
        type: "auditConfinement",
        release: {
          roll: { count: 2, sides: 6 },
          requiresTrueDoubles: true,
          rerollEligible: false,
          alternativeFine: 500,
        },
      },
    ]);

    expect(playerOf(audited.state, actor).inAudit).toBe(false);
    expect(audited.auditPromptPlayerIds).toEqual([]);
  });

  it("blocks by source deck — 'ignore one negative Networking card'", () => {
    const guarded = run(effectsV2State(), [
      { type: "grantImmunity", count: 1, scope: { sourceDeckId: "deck.networking" } },
    ]).state;

    const fromNetworking = run(
      guarded,
      [{ type: "modifyResource", resource: "reputation", amount: -2, clampAtZero: true }],
      { sourceDeckId: "deck.networking" },
    );
    expect(reputationOf(fromNetworking.state, actor)).toBe(reputationOf(guarded, actor));

    const fromWork = run(
      guarded,
      [{ type: "modifyResource", resource: "reputation", amount: -2, clampAtZero: true }],
      { sourceDeckId: "deck.work" },
    );
    expect(reputationOf(fromWork.state, actor)).toBe(reputationOf(guarded, actor) - 2);
  });

  it("keeps two differently-scoped shields apart instead of merging them", () => {
    const guarded = run(effectsV2State(), [
      { type: "grantImmunity", count: 1, scope: { resource: "energy", direction: "loss" } },
      { type: "grantImmunity", count: 1, scope: { resource: "money", direction: "loss" } },
    ]).state;

    const statuses = playerOf(guarded, actor).statuses.filter(
      (status) => status.id === IMMUNITY_STATUS_ID,
    );
    expect(statuses).toHaveLength(2);
    expect(statuses.map((status) => immunityScope(status)?.resource).sort()).toEqual([
      "energy",
      "money",
    ]);

    // Spending the energy shield must leave the money one untouched, which is
    // the whole reason they are separate rows.
    const afterEnergy = run(guarded, [
      { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
    ]);
    expect(
      playerOf(afterEnergy.state, actor).statuses.filter(
        (status) => status.id === IMMUNITY_STATUS_ID,
      ),
    ).toHaveLength(1);
    expect(moneyOf(run(afterEnergy.state, [
      { type: "modifyResource", resource: "money", amount: -100, clampAtZero: true },
    ]).state, actor)).toBe(moneyOf(afterEnergy.state, actor));
  });
});

/* -------------------------------------------- transferResource direction */

describe("transferResource direction and perTarget", () => {
  it("moves from the actor to the target when the direction says so", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "transferResource",
        resource: "money",
        amount: 100,
        direction: "actor-to-target",
        target: "all-opponents",
      },
    ]);

    expect(moneyOf(outcome.state, rival)).toBe(moneyOf(before, rival) + 100);
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader) + 100);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor) - 200);
  });

  it("is not an attack in the gift direction, so a peaceful mode still allows it", () => {
    const before = withRules(effectsV2State(), { conflict: { targetedAttacks: false } });

    const gift = run(before, [
      {
        type: "transferResource",
        resource: "money",
        amount: 100,
        direction: "actor-to-target",
        target: "right-neighbour",
      },
    ]);
    expect(moneyOf(gift.state, rival)).toBe(moneyOf(before, rival) + 100);

    const steal = run(before, [
      { type: "transferResource", resource: "money", amount: 100, target: "right-neighbour" },
    ]);
    expect(moneyOf(steal.state, rival)).toBe(moneyOf(before, rival));
    expect(skips(steal)).toContain("mode-disabled");
  });

  it("treats the amount as per-target by default, so it is correct at any seat count", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      { type: "transferResource", resource: "money", amount: 100, target: "all-opponents" },
    ]);

    expect(moneyOf(outcome.state, rival)).toBe(moneyOf(before, rival) - 100);
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader) - 100);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor) + 200);
  });

  it("splits the amount exactly when perTarget is false, losing nothing to rounding", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "transferResource",
        resource: "money",
        amount: 101,
        perTarget: false,
        target: "all-opponents",
      },
    ]);

    // 101 across two seats: 51 to the earlier seat in `playerOrder`, 50 to the
    // later one. The pot arrives whole.
    const taken =
      moneyOf(before, rival) -
      moneyOf(outcome.state, rival) +
      (moneyOf(before, leader) - moneyOf(outcome.state, leader));
    expect(taken).toBe(101);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor) + 101);
  });

  it("moves what is available rather than failing, in both directions", () => {
    const before = effectsV2State();

    const steal = run(before, [
      { type: "transferResource", resource: "money", amount: 10_000, target: "right-neighbour" },
    ]);
    expect(moneyOf(steal.state, rival)).toBe(0);
    expect(moneyOf(steal.state, actor)).toBe(moneyOf(before, actor) + 400);

    const overspend = run(before, [
      {
        type: "transferResource",
        resource: "money",
        amount: 10_000,
        direction: "actor-to-target",
        target: "right-neighbour",
      },
    ]);
    expect(moneyOf(overspend.state, actor)).toBe(0);
    expect(moneyOf(overspend.state, rival)).toBe(moneyOf(before, rival) + 1000);
  });
});

/* -------------------------------------------------- rollCheck resolution */

describe("rollCheck resolution — shared versus per-target", () => {
  const outcomes = [
    { when: { total: [2, 7] as const }, effects: [
      { type: "modifyResource", resource: "money", amount: -200, clampAtZero: true },
    ] },
    { when: { total: [8, 12] as const }, effects: [
      { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
    ] },
  ] as const;

  it("rolls once for the table when resolution is shared — the default", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "rollCheck",
        dice: { count: 2, sides: 6 },
        rerollEligible: false,
        target: "all-players",
        outcomes: [...outcomes],
      },
    ]);

    const rolls = outcome.trace.filter((entry) => entry.type === "roll-check");
    expect(rolls).toHaveLength(1);

    // One roll, one matched outcome, applied to all three seats — every delta is
    // the same sign and the same size.
    const deltas = [actor, rival, leader].map(
      (playerId) => moneyOf(outcome.state, playerId) - moneyOf(before, playerId),
    );
    expect(new Set(deltas).size).toBe(1);
    expect(Math.abs(deltas[0]!)).toBe(200);
  });

  it("rolls per seat when the card says so, producing independent results", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "rollCheck",
        dice: { count: 2, sides: 6 },
        rerollEligible: false,
        target: "all-players",
        resolution: "per-target",
        outcomes: [...outcomes],
      },
    ]);

    // Rolling independently is only observable as *different* results, and this
    // seed produces them. Anything else would be indistinguishable from shared.
    const deltas = [actor, rival, leader].map(
      (playerId) => moneyOf(outcome.state, playerId) - moneyOf(before, playerId),
    );
    expect(new Set(deltas).size).toBeGreaterThan(1);
  });

  it("is unchanged for a single target, so the v1 roll path keeps its passives", () => {
    const before = effectsV2State();
    const shared = run(before, [
      {
        type: "rollCheck",
        dice: { count: 2, sides: 6 },
        rerollEligible: false,
        outcomes: [...outcomes],
      },
    ]);
    const perTarget = run(before, [
      {
        type: "rollCheck",
        dice: { count: 2, sides: 6 },
        rerollEligible: false,
        resolution: "per-target",
        outcomes: [...outcomes],
      },
    ]);

    expect(moneyOf(shared.state, actor)).toBe(moneyOf(perTarget.state, actor));
    expect(shared.trace.filter((entry) => entry.type === "roll-check")).toHaveLength(0);
  });

  it("lets a nested outcome effect re-target itself when it carries a target", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "rollCheck",
        dice: { count: 1, sides: 6 },
        rerollEligible: false,
        target: "all-players",
        outcomes: [
          {
            when: { total: [1, 6] },
            effects: [
              {
                type: "modifyResource",
                resource: "money",
                amount: 500,
                target: "poorest",
                clampAtZero: true,
              },
            ],
          },
        ],
      },
    ]);

    // `@poorest` inside the outcome means the poorest player once, not once per
    // seat the roll covered.
    expect(moneyOf(outcome.state, rival)).toBe(moneyOf(before, rival) + 500);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader));
  });
});

/* ------------------------------------------------------------- chooseOne */

describe("chooseOne — the branch primitive", () => {
  const choice: EffectV2 = {
    type: "chooseOne",
    options: [
      {
        id: "fast",
        label: "Ship it",
        effects: [{ type: "modifyResource", resource: "money", amount: 250, clampAtZero: true }],
      },
      {
        id: "careful",
        label: "Take the time",
        effects: [{ type: "modifyResource", resource: "energy", amount: 2, clampAtMaximum: true }],
      },
    ],
  };

  it("asks rather than picking, changing nothing until it is answered", () => {
    const before = effectsV2State();
    const outcome = run(before, [choice]);

    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(energyOf(outcome.state, actor)).toBe(energyOf(before, actor));
    expect(outcome.openedPrompts).toHaveLength(1);
    expect(outcome.openedPrompts[0]?.kind).toBe(CHOOSE_ONE_PROMPT_KIND);
    expect(outcome.openedPrompts[0]?.audience).toEqual([actor]);
    expect(outcome.openedPrompts[0]?.legalResponses.map((option) => option.value)).toEqual([
      "fast",
      "careful",
    ]);
    expect(outcome.parkedEffects).toHaveLength(1);
  });

  it("applies exactly the branch that was chosen", () => {
    const before = effectsV2State();
    const asked = run(before, [choice]);
    const parked = asked.parkedEffects[0]!;

    const careful = resumePendingEffect(asked.state, parked.id, effectsRandom(), {
      chosenOptionId: "careful",
    });
    expect(careful.ok).toBe(true);
    if (!careful.ok) return;

    expect(energyOf(careful.outcome.state, actor)).toBe(energyOf(before, actor) + 2);
    expect(moneyOf(careful.outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(careful.outcome.state.pendingEffects).toHaveLength(0);
  });

  it("refuses a branch the card never offered", () => {
    const asked = run(effectsV2State(), [choice]);
    const bogus = resumePendingEffect(asked.state, asked.parkedEffects[0]!.id, effectsRandom(), {
      chosenOptionId: "free-money",
    });

    expect(bogus).toEqual({ ok: false, reason: "option-not-offered" });
  });

  it("addresses the prompt to the chooser, not to the actor, when chooser says so", () => {
    const outcome = run(effectsV2State(), [
      { ...choice, chooser: "chosen-opponent" } as EffectV2,
    ]);

    // "The drawer picks after targeting" and "the target picks the lesser evil"
    // are different cards; `chooser` is the only thing that says which.
    expect(outcome.openedPrompts[0]?.audience).toEqual([rival, leader]);
  });

  it("lands the branch on the targets the choice was resolved against", () => {
    const before = effectsV2State();
    const asked = run(before, [
      {
        ...choice,
        target: "all-opponents",
        options: [
          {
            id: "pay",
            label: "Pay the table",
            effects: [
              { type: "modifyResource", resource: "money", amount: 100, clampAtZero: true },
            ],
          },
        ],
      } as EffectV2,
    ]);

    const resumed = resumePendingEffect(asked.state, asked.parkedEffects[0]!.id, effectsRandom(), {
      chosenOptionId: "pay",
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;

    expect(moneyOf(resumed.outcome.state, rival)).toBe(moneyOf(before, rival) + 100);
    expect(moneyOf(resumed.outcome.state, leader)).toBe(moneyOf(before, leader) + 100);
    expect(moneyOf(resumed.outcome.state, actor)).toBe(moneyOf(before, actor));
  });

  it("parks a payload that survives the repository's JSON round trip", () => {
    const asked = run(effectsV2State(), [choice]);
    const revived = roundTrip(asked.state);

    const resumed = resumePendingEffect(revived, asked.parkedEffects[0]!.id, effectsRandom(), {
      chosenOptionId: "fast",
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;

    expect(moneyOf(resumed.outcome.state, actor)).toBe(moneyOf(revived, actor) + 250);
  });
});

/* ------------------------------------------------------------ opposedRoll */

describe("opposedRoll — two rollers and a comparison", () => {
  const bet: EffectV2 = {
    type: "opposedRoll",
    opponent: "right-neighbour",
    dice: { count: 1, sides: 6 },
    onWin: [
      {
        type: "transferResource",
        resource: "money",
        amount: 200,
        direction: "target-to-actor",
        insufficientFunds: "transfer-up-to-available",
      },
    ],
    onLose: [
      {
        type: "transferResource",
        resource: "money",
        amount: 200,
        direction: "actor-to-target",
        insufficientFunds: "transfer-up-to-available",
      },
    ],
  };

  /** Finds a seed whose first two dice give the requested comparison. */
  function seedWhere(compare: (a: number, b: number) => boolean): string {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const seed = `opposed-${attempt}`;
      const random = createSeededRandomSource(seed);
      const first = Math.floor(random.next() * 6) + 1;
      const second = Math.floor(random.next() * 6) + 1;
      if (compare(first, second)) return seed;
    }
    throw new Error("no seed found");
  }

  function rollWith(seed: string, state: GameState): EffectsV2Outcome {
    return resolveEffectsV2({
      state,
      actorId: actor,
      effects: [bet],
      random: createSeededRandomSource(seed),
      options: {},
    });
  }

  it("pays the winner and charges the loser, in the same direction the roll went", () => {
    const before = effectsV2State();

    const won = rollWith(seedWhere((a, b) => a > b), before);
    expect(moneyOf(won.state, actor)).toBe(moneyOf(before, actor) + 200);
    expect(moneyOf(won.state, rival)).toBe(moneyOf(before, rival) - 200);

    const lost = rollWith(seedWhere((a, b) => a < b), before);
    expect(moneyOf(lost.state, actor)).toBe(moneyOf(before, actor) - 200);
    expect(moneyOf(lost.state, rival)).toBe(moneyOf(before, rival) + 200);
  });

  it("does nothing on a tie when no onTie branch was authored", () => {
    const before = effectsV2State();
    const tied = rollWith(seedWhere((a, b) => a === b), before);

    expect(moneyOf(tied.state, actor)).toBe(moneyOf(before, actor));
    expect(moneyOf(tied.state, rival)).toBe(moneyOf(before, rival));
  });

  it("reports both totals so the log can show the contest", () => {
    const outcome = rollWith(seedWhere((a, b) => a !== b), effectsV2State());
    const rolled = outcome.trace.find((entry) => entry.type === "opposed-roll");

    expect(rolled).toBeDefined();
    if (rolled?.type !== "opposed-roll") return;
    expect(rolled.actorId).toBe(actor);
    expect(rolled.opponentId).toBe(rival);
    expect(rolled.actorTotal).not.toBe(rolled.opponentTotal);
  });

  it("asks who to bet against rather than picking, when the opponent is chosen", () => {
    const before = effectsV2State();
    const outcome = run(before, [{ ...bet, opponent: "chosen-opponent" } as EffectV2]);

    expect(outcome.openedPrompts).toHaveLength(1);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));

    const resumed = resumePendingEffect(outcome.state, outcome.parkedEffects[0]!.id, effectsRandom(), {
      chosenPlayerIds: [leader],
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;

    // Whoever won, exactly 200 moved between the actor and the player they
    // actually chose — and nobody else was touched.
    expect(moneyOf(resumed.outcome.state, rival)).toBe(moneyOf(outcome.state, rival));
    expect(
      Math.abs(moneyOf(resumed.outcome.state, actor) - moneyOf(outcome.state, actor)),
    ).toBe(200);
  });
});

/* --------------------------------------------------------------- noEffect */

describe("noEffect", () => {
  it("does nothing, on purpose, without falling into the v1 applier", () => {
    const before = effectsV2State();
    const outcome = run(before, [{ type: "noEffect" }]);

    expect(outcome.state).toEqual(before);
    expect(outcome.changes).toEqual([]);
    expect(outcome.trace).toEqual([]);
  });
});
