import { describe, expect, it } from "vitest";

import { applyCommand, createScriptedRandomSource } from "../src";
import type { CommandId, DecisionPointId, FrameId, PromptOptionId } from "../src";
import { resolveTileEffects } from "../src/execution/resolve-tile-effects";
import { accepted, context, rollCommand, rollState } from "./turn-loop-fixtures";
import { fixtureIds } from "./fixtures";

const brand = <Id extends string>(value: string) => value as Id;

describe("tile effects", () => {
  it("Given a player one space from the finance tile, when they roll onto it, then payResource deducts money", () => {
    const state = rollState(0);
    const before = state.players[fixtureIds.owner]?.resources.money?.value ?? 0;

    const result = applyCommand(state, rollCommand(state), context([0]));
    const { state: nextState } = accepted(result);

    const after = nextState.players[fixtureIds.owner]?.resources.money?.value ?? 0;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it("Given a player one space from the energy-restore tile, when they roll onto it, then energy is restored to its maximum", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const drainedState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          resources: {
            ...owner.resources,
            energy: {
              id: owner.resources.money.id,
              kind: "resource.energy",
              value: 0,
              minimum: 0,
              maximum: 10,
            },
          },
        },
      },
    };

    const result = applyCommand(drainedState, rollCommand(drainedState), context([0.2]));
    const { state: nextState } = accepted(result);

    const energy = nextState.players[fixtureIds.owner]?.resources.energy;
    expect(energy?.value).toBe(10);
  });
});

describe("character passives", () => {
  it("Given the Workaholic character, when resolving an empty-effects tile of kind 'work', then the passive money bonus applies", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const workaholic = { ...owner, characterId: "character.workaholic" as typeof owner.characterId };
    const outcome = resolveTileEffects(
      workaholic,
      [],
      createScriptedRandomSource([]),
      "work",
      { type: "workLandingMoneyBonus", amount: 50 },
    );

    expect(outcome.player.resources.money.value).toBe(owner.resources.money.value + 50);
  });

  it("Given the Workaholic character, when landing on a non-work tile, then the passive does not apply", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const workaholic = { ...owner, characterId: "character.workaholic" as typeof owner.characterId };
    const outcome = resolveTileEffects(
      workaholic,
      [],
      createScriptedRandomSource([]),
      "meeting",
      { type: "workLandingMoneyBonus", amount: 50 },
    );

    expect(outcome.player.resources.money.value).toBe(owner.resources.money.value);
  });
});

describe("audit confinement (prompts/decisions)", () => {
  it("Given a player one roll from the audit tile, when they land on it, then a prompt opens, they're marked in-audit, and turn advances to the next player", () => {
    const state = rollState(16);

    // die = 6 lands on tile.board.22.audit
    const result = applyCommand(state, rollCommand(state), context([0.9]));
    const { state: nextState } = accepted(result);

    const owner = nextState.players[fixtureIds.owner];
    expect(owner?.inAudit).toBe(true);
    expect(nextState.prompts).toHaveLength(1);
    expect(nextState.prompts[0]).toMatchObject({
      kind: "audit-release",
      audience: [fixtureIds.owner],
    });
    expect(nextState.turn.activePlayerId).not.toBe(fixtureIds.owner);
  });

  it("Given an open audit prompt on the active player's own turn, when they choose to pay the fine, then they are released and 500 money is deducted", () => {
    const state = rollState(16);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const promptId = brand<DecisionPointId>("prompt-audit-test");
    const payFineOptionId = brand<PromptOptionId>("pay-fine");
    const attemptRollOptionId = brand<PromptOptionId>("attempt-roll");

    const confinedState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          inAudit: true,
          resources: { ...owner.resources, money: { ...owner.resources.money, value: 1000 } },
        },
      },
      prompts: [
        {
          id: promptId,
          frameId: brand<FrameId>("frame-audit-test"),
          kind: "audit-release",
          audience: [fixtureIds.owner],
          legalResponses: [
            { id: payFineOptionId, value: null },
            { id: attemptRollOptionId, value: null },
          ],
          deadlineAt: null,
          defaultResponse: { optionId: attemptRollOptionId, value: null },
          visibility: "public",
          responses: {},
        },
      ],
    };

    const command = {
      commandId: brand<CommandId>("command-respond-pay-fine"),
      gameId: confinedState.gameId,
      actorId: fixtureIds.owner,
      expectedRevision: confinedState.revision,
      decisionPointId: promptId,
      type: "prompt.respond" as const,
      payload: { optionId: payFineOptionId, value: null },
    };

    const result = applyCommand(confinedState, command, context([]));
    const { state: nextState } = accepted(result);

    expect(nextState.players[fixtureIds.owner]?.inAudit).toBe(false);
    expect(nextState.players[fixtureIds.owner]?.resources.money.value).toBe(500);
    expect(nextState.prompts).toHaveLength(0);
    expect(nextState.turn.activePlayerId).not.toBe(fixtureIds.owner);
  });
});

describe("promotion and win condition", () => {
  it("Given a player who can afford the final promotion, when they roll, then they are promoted and the match ends", () => {
    const state = rollState(0);
    const owner = state.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");

    const promotableState: typeof state = {
      ...state,
      players: {
        ...state.players,
        [fixtureIds.owner]: {
          ...owner,
          rank: { ...owner.rank, kind: "rank.general-manager" },
          resources: {
            ...owner.resources,
            money: { ...owner.resources.money, value: 999_999 },
            reputation: owner.resources.reputation
              ? { ...owner.resources.reputation, value: 999 }
              : {
                  id: owner.resources.money.id,
                  kind: "resource.reputation",
                  value: 999,
                  minimum: 0,
                  maximum: null,
                },
          },
        },
      },
    };

    const result = applyCommand(promotableState, rollCommand(promotableState), context([0.2]));
    const { state: nextState } = accepted(result);

    expect(nextState.status).toBe("ended");
    expect(nextState.outcome?.reason).toBe("director-reached");
    expect(nextState.outcome?.winnerPlayerIds).toContain(fixtureIds.owner);
    expect(nextState.players[fixtureIds.owner]?.rank.kind).toBe("rank.director");
  });

  it("Given a player who cannot afford the next promotion, when they roll, then rank and status are unchanged", () => {
    const state = rollState(0);

    const result = applyCommand(state, rollCommand(state), context([0.2]));
    const { state: nextState } = accepted(result);

    expect(nextState.status).toBe("active");
    expect(nextState.outcome).toBeNull();
  });
});
