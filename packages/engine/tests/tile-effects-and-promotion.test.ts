import { describe, expect, it } from "vitest";

import { applyCommand } from "../src";
import { accepted, context, rollCommand, rollState } from "./turn-loop-fixtures";
import { fixtureIds } from "./fixtures";

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
