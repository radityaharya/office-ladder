import { deadlineDashContent } from "@office-ladder/content";
import { describe, expect, it } from "vitest";

import {
  deserializeGameState,
  serializeGameState,
  stableStringify,
} from "../src";
import type {
  CardInstanceId,
  CommandId,
  DecisionPointId,
  GameState,
  PlayerId,
  PlayerState,
  ResourceId,
  ResourceState,
  TargetAttackCommand,
  TransitionResult,
} from "../src";
import {
  ATTACK_VECTORS,
  findAttackWindow,
  resolveAttackWindow,
  targetAttack,
} from "../src/execution/attack";
import {
  ATTACK_IMMUNITY_STATUS_ID,
  HEAT_INVESTIGATION_OPTIONS,
  HEAT_INVESTIGATION_PROMPT_KIND,
  applyLeaderProtection,
  buildInvestigationPrompt,
  findLeaderPlayerId,
  lowerHeat,
  raiseHeat,
  resolveInvestigationResponse,
} from "../src/execution/heat";
import { createCanonicalGameState, fixtureIds, sharedSpaceRules } from "./fixtures";
import { logicalTimestamp, withRules, type RulesOverrides } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const attackerId = fixtureIds.owner;
const targetId = fixtureIds.revealedOpponent;
const bystanderId = fixtureIds.hiddenOpponent;

const context = { logicalTimestamp, content: deadlineDashContent };

type ResourceSpec = {
  readonly money: number;
  readonly reputation: number;
  readonly energy: number;
};

function resources(playerId: PlayerId, spec: ResourceSpec): Record<string, ResourceState> {
  return {
    money: {
      id: brand<ResourceId>(`${playerId}-money`),
      kind: "resource.money",
      value: spec.money,
      minimum: 0,
      maximum: null,
    },
    reputation: {
      id: brand<ResourceId>(`${playerId}-reputation`),
      kind: "resource.reputation",
      value: spec.reputation,
      minimum: 0,
      maximum: null,
    },
    energy: {
      id: brand<ResourceId>(`${playerId}-energy`),
      kind: "resource.energy",
      value: spec.energy,
      minimum: 0,
      maximum: 5,
    },
  };
}

function seat(
  base: PlayerState,
  spec: ResourceSpec,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return {
    ...base,
    resources: resources(base.id, spec),
    statuses: [],
    skipTurns: 0,
    inAudit: false,
    heat: {
      value: 0,
      threshold: sharedSpaceRules.conflict.heatThreshold,
      investigationsOpened: 0,
      lastIncrementedAtRound: null,
    },
    ...overrides,
  };
}

/**
 * A three-seat table under the Standard ruleset with conflict on, the leader
 * protection and the defence window both switched *off* by default so each test
 * opts into exactly the gate it is about.
 *
 * The attacker sits on rank index 1 and the target on rank index 3, so the target
 * is genuinely the player who is ahead — which is what makes the leader-protection
 * assertions below mean something rather than being arranged.
 */
function attackState(overrides: RulesOverrides = {}): GameState {
  const canonical = createCanonicalGameState();
  const state: GameState = {
    ...canonical,
    rules: sharedSpaceRules,
    status: "active",
    revision: 17,
    eventSequence: 29,
    turn: {
      number: 4,
      round: 2,
      activePlayerId: attackerId,
      phase: "pre-roll",
      startedAt: logicalTimestamp,
      deadlineAt: null,
    },
    players: {
      [attackerId]: seat(canonical.players[attackerId] as PlayerState, {
        money: 1000,
        reputation: 4,
        energy: 5,
      }),
      [bystanderId]: seat(canonical.players[bystanderId] as PlayerState, {
        money: 100,
        reputation: 0,
        energy: 3,
      }),
      [targetId]: seat(canonical.players[targetId] as PlayerState, {
        money: 800,
        reputation: 6,
        energy: 4,
      }),
    },
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    resolutionStack: [],
    lastCommandId: null,
  };

  return withRules(
    withRules(state, {
      conflict: { leaderProtection: "none", defenceEnabled: false },
    }),
    overrides,
  );
}

function attackCommand(
  state: GameState,
  overrides: {
    readonly actorId?: PlayerId;
    readonly targetPlayerId?: PlayerId;
    readonly vector?: string;
    readonly cardId?: string | null;
    readonly commandId?: string;
  } = {},
): TargetAttackCommand {
  return {
    commandId: brand<CommandId>(overrides.commandId ?? "command-attack"),
    gameId: state.gameId,
    actorId: overrides.actorId ?? attackerId,
    expectedRevision: state.revision,
    type: "attack.target",
    payload: {
      targetPlayerId: overrides.targetPlayerId ?? targetId,
      vector: overrides.vector ?? "attack.undermine",
      cardId:
        overrides.cardId === undefined || overrides.cardId === null
          ? null
          : brand<CardInstanceId>(overrides.cardId),
    },
  };
}

function accepted(result: TransitionResult): {
  readonly state: GameState;
  readonly events: readonly { readonly type: string; readonly payload: unknown }[];
} {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return { state: result.value.state, events: result.value.events };
}

function rejectedWith(result: TransitionResult, code: string): void {
  expect(result).toEqual(
    expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code }),
    }),
  );
}

function value(state: GameState, playerId: PlayerId, key: string): number {
  const resource = state.players[playerId]?.resources[key];
  if (resource === undefined) throw new Error(`no ${key} on ${playerId}`);

  return resource.value;
}

function deepFreeze<T>(input: T, seen = new Set<unknown>()): T {
  if (input === null || typeof input !== "object" || seen.has(input)) return input;
  seen.add(input);
  for (const inner of Object.values(input as Record<string, unknown>)) {
    deepFreeze(inner, seen);
  }

  return Object.freeze(input);
}

describe("raiseHeat — the single aggression primitive", () => {
  const player = (heatValue: number, investigationsOpened = 0): PlayerState =>
    seat(createCanonicalGameState().players[attackerId] as PlayerState, {
      money: 100,
      reputation: 1,
      energy: 3,
    }, {
      heat: {
        value: heatValue,
        threshold: sharedSpaceRules.conflict.heatThreshold,
        investigationsOpened,
        lastIncrementedAtRound: null,
      },
    });

  it("Given a mode with heat enabled, When an aggressive act is charged, Then heatPerAttack is added and the round is recorded", () => {
    const outcome = raiseHeat({
      rules: sharedSpaceRules,
      player: player(0),
      round: 4,
      source: "attack",
    });

    expect(outcome.amount).toBe(sharedSpaceRules.conflict.heatPerAttack);
    expect(outcome.player.heat.value).toBe(sharedSpaceRules.conflict.heatPerAttack);
    expect(outcome.player.heat.lastIncrementedAtRound).toBe(4);
    expect(outcome.investigationOpened).toBe(false);
  });

  it("Given a mode with heat switched off, When an aggressive act is charged, Then nothing changes at all", () => {
    const rules = withRules(attackState(), { conflict: { heatEnabled: false } }).rules;

    const outcome = raiseHeat({
      rules,
      player: player(0),
      round: 4,
      source: "project-sabotage",
    });

    expect(outcome.amount).toBe(0);
    expect(outcome.investigationOpened).toBe(false);
    expect(outcome.player.heat.value).toBe(0);
    expect(outcome.player.heat.lastIncrementedAtRound).toBeNull();
  });

  it("Given heat one short of the threshold, When it is crossed, Then exactly one investigation is reported and the next crossing waits for the next multiple", () => {
    const threshold = sharedSpaceRules.conflict.heatThreshold;
    const crossing = raiseHeat({
      rules: sharedSpaceRules,
      player: player(threshold - 1),
      round: 2,
      source: "attack",
    });

    expect(crossing.investigationOpened).toBe(true);
    expect(crossing.player.heat.investigationsOpened).toBe(1);

    // The very next act must not open a second one: an investigation every turn
    // would make heat a tax rather than a threshold.
    const after = raiseHeat({
      rules: sharedSpaceRules,
      player: crossing.player,
      round: 3,
      source: "attack",
    });
    expect(after.investigationOpened).toBe(false);

    // ...but the next whole multiple does.
    let walked = after.player;
    let opened = 0;
    for (let index = 0; index < threshold; index += 1) {
      const step = raiseHeat({
        rules: sharedSpaceRules,
        player: walked,
        round: 4,
        source: "attack",
      });
      walked = step.player;
      if (step.investigationOpened) opened += 1;
    }
    expect(opened).toBe(1);
  });

  it("Given a single raise that jumps several thresholds, When it is charged, Then one investigation opens and the backlog is cleared rather than queued", () => {
    const threshold = sharedSpaceRules.conflict.heatThreshold;
    const outcome = raiseHeat({
      rules: sharedSpaceRules,
      player: player(0),
      round: 1,
      source: "hostile-effect",
      charges: threshold * 3,
    });

    expect(outcome.investigationOpened).toBe(true);
    expect(outcome.player.heat.investigationsOpened).toBe(3);
  });

  it("Given heat that has already triggered an investigation, When it is lowered and re-raised, Then the crossing cannot be laundered", () => {
    const threshold = sharedSpaceRules.conflict.heatThreshold;
    const crossed = raiseHeat({
      rules: sharedSpaceRules,
      player: player(threshold - 1),
      round: 2,
      source: "attack",
    });

    const relieved = lowerHeat(crossed.player, threshold);
    expect(relieved.heat.value).toBe(0);
    expect(relieved.heat.investigationsOpened).toBe(1);

    const again = raiseHeat({
      rules: sharedSpaceRules,
      player: relieved,
      round: 3,
      source: "attack",
    });
    expect(again.investigationOpened).toBe(false);
  });

  it("Given heat at zero, When it is lowered, Then it never goes negative", () => {
    expect(lowerHeat(player(0), 5).heat.value).toBe(0);
    expect(lowerHeat(player(2), -5).heat.value).toBe(2);
  });
});

describe("leader protection", () => {
  it("Given a table where the top standing is shared, When the leader is looked up, Then nobody is protected", () => {
    const state = attackState();
    const level = (player: PlayerState): PlayerState => ({
      ...player,
      rank: { ...player.rank, index: 2 },
      resources: resources(player.id, { money: 500, reputation: 1, energy: 3 }),
    });

    const tied: GameState = {
      ...state,
      players: {
        [attackerId]: level(state.players[attackerId] as PlayerState),
        [bystanderId]: level(state.players[bystanderId] as PlayerState),
        [targetId]: level(state.players[targetId] as PlayerState),
      },
    };

    expect(findLeaderPlayerId(tied)).toBeNull();
  });

  it("Given equal ranks, When the leader is looked up, Then money then reputation break it, never object key order", () => {
    const state = attackState();
    const at = (player: PlayerState, spec: ResourceSpec): PlayerState => ({
      ...player,
      rank: { ...player.rank, index: 2 },
      resources: resources(player.id, spec),
    });

    const byMoney: GameState = {
      ...state,
      players: {
        [attackerId]: at(state.players[attackerId] as PlayerState, { money: 500, reputation: 9, energy: 3 }),
        [bystanderId]: at(state.players[bystanderId] as PlayerState, { money: 900, reputation: 0, energy: 3 }),
        [targetId]: at(state.players[targetId] as PlayerState, { money: 100, reputation: 9, energy: 3 }),
      },
    };
    expect(findLeaderPlayerId(byMoney)).toBe(bystanderId);

    const byReputation: GameState = {
      ...state,
      players: {
        [attackerId]: at(state.players[attackerId] as PlayerState, { money: 500, reputation: 1, energy: 3 }),
        [bystanderId]: at(state.players[bystanderId] as PlayerState, { money: 500, reputation: 7, energy: 3 }),
        [targetId]: at(state.players[targetId] as PlayerState, { money: 500, reputation: 3, energy: 3 }),
      },
    };
    expect(findLeaderPlayerId(byReputation)).toBe(bystanderId);
  });

  it("Given an eliminated front-runner, When the leader is looked up, Then they are skipped", () => {
    const state = attackState();
    const eliminated: GameState = { ...state, eliminatedPlayerIds: [targetId] };

    expect(findLeaderPlayerId(state)).toBe(targetId);
    expect(findLeaderPlayerId(eliminated)).toBe(attackerId);
  });

  it("Given soft leader protection, When the leader is attacked, Then the heat charge doubles", () => {
    const soft = attackState({ conflict: { leaderProtection: "soft" } });

    expect(applyLeaderProtection(soft, targetId)).toEqual({
      kind: "allowed",
      heatCharges: 2,
      targetIsLeader: true,
    });
    expect(applyLeaderProtection(soft, bystanderId)).toEqual({
      kind: "allowed",
      heatCharges: 1,
      targetIsLeader: false,
    });

    const result = accepted(targetAttack(soft, attackCommand(soft), context));
    expect(result.state.players[attackerId]?.heat.value).toBe(
      soft.rules.conflict.heatPerAttack * 2,
    );
  });

  it("Given hard leader protection, When the leader is attacked, Then it is refused and nothing moves", () => {
    const hard = attackState({ conflict: { leaderProtection: "hard" } });

    const result = targetAttack(hard, attackCommand(hard), context);

    rejectedWith(result, "ILLEGAL_ACTION");
    // A player who is not the leader is still fair game under the same ruleset.
    expect(accepted(targetAttack(hard, attackCommand(hard, { targetPlayerId: bystanderId }), context)).state
      .players[bystanderId]?.resources.reputation?.value).toBe(0);
  });
});

describe("attack.target", () => {
  it("Given an enabled mode and an affordable vector, When a player attacks, Then the cost, the damage and the heat all land and the turn is not spent", () => {
    const state = attackState();

    const { state: next, events } = accepted(
      targetAttack(state, attackCommand(state), context),
    );

    // Cost to the actor, damage to the target.
    expect(value(next, attackerId, "energy")).toBe(4);
    expect(value(next, targetId, "reputation")).toBe(5);
    // Heat charged through the one primitive.
    expect(next.players[attackerId]?.heat.value).toBe(1);
    expect(next.players[attackerId]?.heat.lastIncrementedAtRound).toBe(2);
    // The attack is an in-turn verb: the actor keeps their turn and can still roll.
    expect(next.turn.activePlayerId).toBe(attackerId);
    expect(next.turn.phase).toBe("pre-roll");
    expect(next.revision).toBe(state.revision + 1);
    expect(events.map((event) => event.type)).toEqual([
      "ResourceChanged",
      "EffectProposed",
      "EffectProposed",
      "ResourceChanged",
    ]);
  });

  it("Given a steal vector, When the target holds less than the vector takes, Then exactly what they have moves and no money is minted", () => {
    const state = attackState();
    const poor: GameState = {
      ...state,
      players: {
        ...state.players,
        [targetId]: {
          ...(state.players[targetId] as PlayerState),
          resources: resources(targetId, { money: 60, reputation: 6, energy: 4 }),
        },
      },
    };

    const { state: next } = accepted(
      targetAttack(poor, attackCommand(poor, { vector: "attack.poach-credit" }), context),
    );

    expect(value(next, targetId, "money")).toBe(0);
    expect(value(next, attackerId, "money")).toBe(1060);
    const before = value(poor, targetId, "money") + value(poor, attackerId, "money");
    expect(value(next, targetId, "money") + value(next, attackerId, "money")).toBe(before);
  });

  it("Given a player who is not the active player, When they attack, Then it is refused and no state moves", () => {
    const state = attackState();

    const result = targetAttack(
      state,
      attackCommand(state, { actorId: bystanderId, targetPlayerId: attackerId }),
      context,
    );

    rejectedWith(result, "NOT_ACTOR_TURN");
  });

  it("Given an actor aiming at themselves, When they attack, Then it is refused", () => {
    const state = attackState();

    rejectedWith(
      targetAttack(state, attackCommand(state, { targetPlayerId: attackerId }), context),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a mode with targeted attacks switched off, When a player attacks, Then it is refused", () => {
    const disabled = attackState({ conflict: { targetedAttacks: false } });

    rejectedWith(targetAttack(disabled, attackCommand(disabled), context), "ILLEGAL_ACTION");
  });

  it("Given a mode with heat switched off but attacks left on, When a player attacks, Then the damage lands and no heat is charged anywhere", () => {
    const cold = attackState({
      conflict: { heatEnabled: false, heatPerAttack: 0, leaderProtection: "soft" },
    });

    const { state: next, events } = accepted(
      targetAttack(cold, attackCommand(cold), context),
    );

    expect(value(next, targetId, "reputation")).toBe(5);
    expect(next.players[attackerId]?.heat.value).toBe(0);
    expect(next.players[attackerId]?.heat.lastIncrementedAtRound).toBeNull();
    expect(next.prompts).toHaveLength(0);
    expect(
      events.filter(
        (event) =>
          event.type === "EffectProposed" &&
          (event.payload as { readonly effect: { readonly type: string } }).effect.type ===
            "modifyHeat",
      ),
    ).toHaveLength(0);
  });

  it("Given a mode with no leader protection, When the front-runner is attacked, Then they are charged the base rate like anyone else", () => {
    const state = attackState();

    expect(findLeaderPlayerId(state)).toBe(targetId);
    expect(applyLeaderProtection(state, targetId)).toEqual({
      kind: "allowed",
      heatCharges: 1,
      targetIsLeader: false,
    });
    expect(
      accepted(targetAttack(state, attackCommand(state), context)).state.players[attackerId]
        ?.heat.value,
    ).toBe(state.rules.conflict.heatPerAttack);
  });

  it("Given an actor who cannot pay the vector's cost, When they attack, Then it is refused before anything mutates", () => {
    const state = attackState();
    const spent: GameState = {
      ...state,
      players: {
        ...state.players,
        [attackerId]: {
          ...(state.players[attackerId] as PlayerState),
          resources: resources(attackerId, { money: 1000, reputation: 4, energy: 1 }),
        },
      },
    };

    const before = stableStringify(spent);
    const result = targetAttack(
      spent,
      attackCommand(spent, { vector: "attack.poach-credit" }),
      context,
    );

    rejectedWith(result, "INSUFFICIENT_RESOURCE");
    expect(stableStringify(spent)).toBe(before);
  });

  it("Given an unknown vector or an unknown target, When a player attacks, Then it is refused", () => {
    const state = attackState();

    rejectedWith(
      targetAttack(state, attackCommand(state, { vector: "attack.nope" }), context),
      "INVALID_COMMAND",
    );
    rejectedWith(
      targetAttack(
        state,
        attackCommand(state, { targetPlayerId: brand<PlayerId>("player-ghost") }),
        context,
      ),
      "INVALID_COMMAND",
    );
  });

  it("Given an eliminated target, When a player attacks them, Then it is refused", () => {
    const state = { ...attackState(), eliminatedPlayerIds: [targetId] };

    rejectedWith(targetAttack(state, attackCommand(state), context), "ILLEGAL_ACTION");
  });

  it("Given a card the actor does not hold, When they name it in an attack, Then it is refused", () => {
    const state = attackState();

    rejectedWith(
      targetAttack(
        state,
        attackCommand(state, { cardId: fixtureIds.revealedOpponentHandCard }),
        context,
      ),
      "CARD_NOT_AVAILABLE",
    );
  });

  it("Given a card the actor does hold, When they attack with it, Then it leaves their hand for the discard pile", () => {
    const state = attackState();

    const { state: next } = accepted(
      targetAttack(
        state,
        attackCommand(state, { cardId: fixtureIds.ownerHandCard }),
        context,
      ),
    );

    expect(next.players[attackerId]?.hand).not.toContain(fixtureIds.ownerHandCard);
    expect(next.cards[fixtureIds.ownerHandCard]?.zone).toBe("discard-pile");
    expect(next.decks[fixtureIds.deck]?.discardPile).toContain(fixtureIds.ownerHandCard);
  });

  it("Given a target holding attack immunity, When they are attacked, Then the attack is absorbed, one charge is spent, and the attacker still pays", () => {
    const state = attackState();
    const immune: GameState = {
      ...state,
      players: {
        ...state.players,
        [targetId]: {
          ...(state.players[targetId] as PlayerState),
          statuses: [
            {
              id: brand(ATTACK_IMMUNITY_STATUS_ID),
              sourceId: null,
              stacks: 2,
              remainingTurns: null,
              expiresAtRound: null,
              visibility: "public",
              data: {},
            },
          ],
        },
      },
    };

    const { state: next, events } = accepted(
      targetAttack(immune, attackCommand(immune), context),
    );

    expect(value(next, targetId, "reputation")).toBe(6);
    expect(
      next.players[targetId]?.statuses.find((status) => status.id === ATTACK_IMMUNITY_STATUS_ID)
        ?.stacks,
    ).toBe(1);
    // Aggression is the targeting, not the landing: the cost and the heat stand.
    expect(value(next, attackerId, "energy")).toBe(4);
    expect(next.players[attackerId]?.heat.value).toBe(1);
    expect(events.some((event) => event.type === "EffectPrevented")).toBe(true);
  });

  it("Given a mode with defence enabled, When a player attacks, Then a reaction window holds the effect instead of it landing", () => {
    const state = attackState({ conflict: { defenceEnabled: true } });

    const { state: next, events } = accepted(
      targetAttack(state, attackCommand(state), context),
    );

    expect(value(next, targetId, "reputation")).toBe(6);
    expect(next.reactionWindows).toHaveLength(1);
    expect(next.reactionWindows[0]?.eligiblePlayerIds).toEqual([targetId]);
    expect(next.reactionWindows[0]?.priorityPlayerId).toBe(targetId);
    // The engine writes no wall clock; the server schedules the expiry.
    expect(next.reactionWindows[0]?.deadlineAt).toBeNull();
    expect(next.pendingEffects).toHaveLength(1);
    expect(next.pendingEffects[0]?.preventionEligible).toBe(true);
    expect(next.turn.phase).toBe("reaction");
    expect(events.some((event) => event.type === "ReactionWindowOpened")).toBe(true);
    // Heat is charged when the attack is made, not when it lands.
    expect(next.players[attackerId]?.heat.value).toBe(1);
  });

  it("Given an attacker crossing the heat threshold, When they attack, Then the investigation prompt is addressed to the attacker and not to the victim", () => {
    const state = attackState();
    const threshold = state.rules.conflict.heatThreshold;
    const hot: GameState = {
      ...state,
      players: {
        ...state.players,
        [attackerId]: {
          ...(state.players[attackerId] as PlayerState),
          heat: {
            value: threshold - state.rules.conflict.heatPerAttack,
            threshold,
            investigationsOpened: 0,
            lastIncrementedAtRound: 1,
          },
        },
      },
    };

    const { state: next, events } = accepted(targetAttack(hot, attackCommand(hot), context));

    expect(next.prompts).toHaveLength(1);
    expect(next.prompts[0]?.kind).toBe(HEAT_INVESTIGATION_PROMPT_KIND);
    expect(next.prompts[0]?.audience).toEqual([attackerId]);
    expect(next.prompts[0]?.defaultResponse.optionId).toBe(
      HEAT_INVESTIGATION_OPTIONS.takeLeave,
    );
    expect(events.some((event) => event.type === "PromptOpened")).toBe(true);
    expect(next.players[attackerId]?.heat.investigationsOpened).toBe(1);
  });

  it("Given an attack in any mode, When the resulting state crosses the jsonb boundary, Then it round-trips unchanged", () => {
    for (const overrides of [
      {},
      { conflict: { defenceEnabled: true } },
      { conflict: { leaderProtection: "soft" as const } },
    ]) {
      const state = attackState(overrides);
      const { state: next } = accepted(targetAttack(state, attackCommand(state), context));

      const serialized = serializeGameState(next);
      expect(deserializeGameState(serialized)).toEqual(next);
      expect(serializeGameState(deserializeGameState(serialized))).toBe(serialized);
    }
  });

  it("Given a frozen state, When the same attack is applied twice, Then the events and next state are byte-identical and the input is untouched", () => {
    const original = attackState({ conflict: { defenceEnabled: true } });
    const frozen = deepFreeze(structuredClone(original));

    const first = targetAttack(frozen, attackCommand(frozen), context);
    const second = targetAttack(frozen, attackCommand(frozen), context);
    const a = accepted(first);
    const b = accepted(second);

    expect(stableStringify(b.state)).toBe(stableStringify(a.state));
    expect(stableStringify(b.events)).toBe(stableStringify(a.events));
    expect(stableStringify(frozen)).toBe(stableStringify(original));
  });

  it("Given two different logical timestamps, When the same attack is applied, Then only the timestamps differ", () => {
    const state = attackState();
    const strip = (input: string) =>
      input.replaceAll("2020-01-01T00:00:00.000Z", "T").replaceAll("2099-12-31T23:59:59.000Z", "T");

    const early = accepted(
      targetAttack(state, attackCommand(state), {
        ...context,
        logicalTimestamp: "2020-01-01T00:00:00.000Z",
      }),
    );
    const late = accepted(
      targetAttack(state, attackCommand(state), {
        ...context,
        logicalTimestamp: "2099-12-31T23:59:59.000Z",
      }),
    );

    expect(strip(stableStringify(late.state))).toBe(strip(stableStringify(early.state)));
    expect(strip(stableStringify(late.events))).toBe(strip(stableStringify(early.events)));
  });
});

describe("resolveAttackWindow — the defence hand-off", () => {
  function openWindow(): {
    readonly state: GameState;
    readonly decisionPointId: DecisionPointId;
  } {
    const state = attackState({ conflict: { defenceEnabled: true } });
    const { state: next } = accepted(targetAttack(state, attackCommand(state), context));
    const decisionPointId = next.reactionWindows[0]?.id;
    if (decisionPointId === undefined) throw new Error("no window opened");

    return { state: next, decisionPointId };
  }

  const closeCommand = (state: GameState) =>
    attackCommand(state, { commandId: "command-close-window" });

  it("Given a window nobody countered, When it closes, Then the attack lands, the window clears and the turn is handed back", () => {
    const { state, decisionPointId } = openWindow();

    const { state: next } = accepted(
      resolveAttackWindow(
        state,
        closeCommand(state),
        { decisionPointId, prevented: false, preventedByPlayerId: null },
        context,
      ),
    );

    expect(value(next, targetId, "reputation")).toBe(5);
    expect(next.reactionWindows).toHaveLength(0);
    expect(next.pendingEffects).toHaveLength(0);
    expect(next.turn.phase).toBe("pre-roll");
    expect(next.revision).toBe(state.revision + 1);
  });

  it("Given a defender who counters, When the window closes, Then no damage lands and the prevention is recorded", () => {
    const { state, decisionPointId } = openWindow();

    const { state: next, events } = accepted(
      resolveAttackWindow(
        state,
        closeCommand(state),
        { decisionPointId, prevented: true, preventedByPlayerId: targetId },
        context,
      ),
    );

    expect(value(next, targetId, "reputation")).toBe(6);
    expect(events.some((event) => event.type === "EffectPrevented")).toBe(true);
    expect(next.reactionWindows).toHaveLength(0);
    // The heat the attack already cost is not refunded by a successful defence.
    expect(next.players[attackerId]?.heat.value).toBe(1);
  });

  it("Given a player who is not eligible to defend, When they claim to have countered, Then it is refused", () => {
    const { state, decisionPointId } = openWindow();

    rejectedWith(
      resolveAttackWindow(
        state,
        closeCommand(state),
        { decisionPointId, prevented: true, preventedByPlayerId: bystanderId },
        context,
      ),
      "ACTOR_NOT_AUTHORIZED",
    );
  });

  it("Given a window that already resolved, When the same expiry fires again, Then there is nothing left to find and it cannot double-resolve", () => {
    const { state, decisionPointId } = openWindow();
    const { state: next } = accepted(
      resolveAttackWindow(
        state,
        closeCommand(state),
        { decisionPointId, prevented: false, preventedByPlayerId: null },
        context,
      ),
    );

    expect(findAttackWindow(next, decisionPointId)).toBeNull();
    rejectedWith(
      resolveAttackWindow(
        next,
        closeCommand(next),
        { decisionPointId, prevented: false, preventedByPlayerId: null },
        context,
      ),
      "DECISION_POINT_NOT_FOUND",
    );
    expect(value(next, targetId, "reputation")).toBe(5);
  });

  it("Given a resolved window, When the state crosses the jsonb boundary, Then it round-trips unchanged", () => {
    const { state, decisionPointId } = openWindow();
    const { state: next } = accepted(
      resolveAttackWindow(
        state,
        closeCommand(state),
        { decisionPointId, prevented: false, preventedByPlayerId: null },
        context,
      ),
    );

    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
  });
});

describe("heat investigations", () => {
  const prompt = () => buildInvestigationPrompt(attackState(), 42, attackerId);

  it("Given an investigation prompt, When it is built, Then both branches are offered and the resource-free one is the default", () => {
    const built = prompt();

    expect(built.audience).toEqual([attackerId]);
    expect(built.legalResponses.map((option) => option.id)).toEqual([
      HEAT_INVESTIGATION_OPTIONS.takeLeave,
      HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
    ]);
    expect(built.defaultResponse.optionId).toBe(HEAT_INVESTIGATION_OPTIONS.takeLeave);
    expect(built.deadlineAt).toBeNull();
  });

  it("Given the take-leave branch, When the attacker answers, Then they skip a turn and spend nothing", () => {
    const state = attackState();
    const player = state.players[attackerId] as PlayerState;

    const resolution = resolveInvestigationResponse(
      state,
      player,
      HEAT_INVESTIGATION_OPTIONS.takeLeave,
    );

    expect(resolution?.player.skipTurns).toBe(player.skipTurns + 1);
    expect(resolution?.changes).toEqual([]);
    expect(resolution?.keepPromptOpen).toBe(false);
  });

  it("Given the accept-reprimand branch, When the attacker answers, Then reputation is docked by the threshold they crossed", () => {
    const state = attackState();
    const player = state.players[attackerId] as PlayerState;

    const resolution = resolveInvestigationResponse(
      state,
      player,
      HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
    );

    expect(resolution?.player.resources.reputation?.value).toBe(
      4 - state.rules.conflict.heatThreshold,
    );
    expect(resolution?.changes).toEqual([
      { resource: "reputation", previousValue: 4, newValue: 1 },
    ]);
    expect(resolution?.player.skipTurns).toBe(player.skipTurns);
  });

  it("Given an attacker with almost no reputation, When they accept the reprimand, Then it clamps at the resource floor", () => {
    const state = attackState();
    const broke: PlayerState = {
      ...(state.players[attackerId] as PlayerState),
      resources: resources(attackerId, { money: 10, reputation: 1, energy: 3 }),
    };

    const resolution = resolveInvestigationResponse(
      state,
      broke,
      HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
    );

    expect(resolution?.player.resources.reputation?.value).toBe(0);
  });

  it("Given an option that is not one of the branches, When it is answered, Then the resolver refuses it rather than doing nothing", () => {
    const state = attackState();

    expect(
      resolveInvestigationResponse(
        state,
        state.players[attackerId] as PlayerState,
        "pay-fine",
      ),
    ).toBeNull();
  });
});

describe("attack vectors", () => {
  it("Given the vector table, When every vector is inspected, Then each charges the actor and moves exactly one resource", () => {
    const vectors = Object.values(ATTACK_VECTORS);
    expect(vectors.length).toBeGreaterThan(0);

    for (const vector of vectors) {
      expect(vector.cost.amount).toBeGreaterThan(0);
      expect(vector.effect.amount).toBeGreaterThan(0);
      expect(["drain", "steal"]).toContain(vector.effect.kind);
    }
  });
});
