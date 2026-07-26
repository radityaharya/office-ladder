import { describe, expect, it } from "vitest";

import { enumerateLegalActions } from "../src";
import type { GameState, PlayerId } from "../src";
import {
  createCanonicalGameState,
  createSharedSpaceGameState,
  fixtureIds,
  sharedSpaceIds,
} from "./fixtures";
import { withRules } from "./turn-loop-fixtures";

const unknownPlayerId = "player-unknown" as PlayerId;

const types = (state: GameState, actorId: PlayerId): readonly string[] =>
  enumerateLegalActions(state, actorId).map((action) => action.type);

const expectedAction = (
  state: GameState,
  actorId: PlayerId,
  type: "game.start" | "turn.roll",
) => ({
  gameId: state.gameId,
  actorId,
  expectedRevision: state.revision,
  type,
  payload: {},
});

const setupState = (revision = 17) => {
  const state = createCanonicalGameState();

  return {
    ...state,
    status: "setup" as const,
    revision,
    startAuthorizedPlayerId: fixtureIds.owner,
    turn: {
      ...state.turn,
      activePlayerId: null,
      phase: "not-started" as const,
    },
    resolutionStack: [],
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
  };
};

const preRollState = (revision = 17) => {
  const state = createCanonicalGameState();

  return {
    ...state,
    status: "active" as const,
    revision,
    turn: {
      ...state.turn,
      activePlayerId: fixtureIds.owner,
      phase: "pre-roll" as const,
    },
    resolutionStack: [],
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
  };
};

/** The shared-space fixture, wound to an active pre-roll turn for the owner. */
const sharedPreRollState = (revision = 17): GameState => {
  const state = createSharedSpaceGameState();

  return {
    ...state,
    status: "active",
    revision,
    turn: { ...state.turn, activePlayerId: fixtureIds.owner, phase: "pre-roll" },
    resolutionStack: [],
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
  };
};

describe("enumerateLegalActions", () => {
  it("returns only game.start to the authorized starter during setup", () => {
    // Given: a setup game whose start authority belongs to the owner.
    const state = setupState(23);

    // When: the owner asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: only the start command is legal, with the current revision.
    expect(actions).toEqual([
      expectedAction(state, fixtureIds.owner, "game.start"),
    ]);
  });

  it.each([
    ["another player", fixtureIds.hiddenOpponent],
    ["an unknown player", unknownPlayerId],
  ] as const)("returns no setup action to %s", (_actorDescription, actorId) => {
    // Given: a setup game whose start authority belongs to the owner.
    const state = setupState();

    // When: a non-authorized actor asks for legal actions.
    const actions = enumerateLegalActions(state, actorId);

    // Then: setup exposes no action to that actor.
    expect(actions).toEqual([]);
  });

  it("offers turn.roll to the active player before rolling", () => {
    // Given: an active game in the pre-roll phase with no blocking work.
    const state = preRollState(31);

    // When: the active player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: rolling is legal, with the current revision. It is no longer the
    // *only* verb a turn offers (spec §6.2) — the Quick preset the base fixture
    // carries also enables the free action and dice adjustment — but every offer
    // is aimed at the actor who asked and carries the state's revision.
    expect(actions).toContainEqual(expectedAction(state, fixtureIds.owner, "turn.roll"));
    expect(actions.every((action) => action.actorId === fixtureIds.owner)).toBe(true);
    expect(actions.every((action) => action.expectedRevision === 31)).toBe(true);
  });

  it("returns no roll action to the wrong player", () => {
    // Given: an active pre-roll turn owned by the owner.
    const state = preRollState();

    // When: another player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.hiddenOpponent);

    // Then: the wrong player has no legal action.
    expect(actions).toEqual([]);
  });

  it.each([
    ["a resolution frame", { resolutionStack: createCanonicalGameState().resolutionStack }],
    ["a pending effect", { pendingEffects: createCanonicalGameState().pendingEffects }],
  ] as const)("blocks rolling while %s is pending", (_blockerDescription, blocker) => {
    // Given: an active pre-roll turn with one unresolved blocker.
    const state = { ...preRollState(), ...blocker };

    // When: the active player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: rolling is not legal until the blocker resolves.
    expect(actions).toEqual([]);
  });

  it("replaces the turn's verbs with an answer while a reaction window is open", () => {
    // Given: an active pre-roll turn with the fixture's open prevention window,
    // which the owner is eligible for.
    const state = {
      ...preRollState(),
      reactionWindows: createCanonicalGameState().reactionWindows,
    };
    const window = state.reactionWindows[0];
    if (window === undefined) throw new Error("fixture missing a reaction window");

    // When: the eligible player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: the turn is blocked, but the window is answerable — the old shape
    // returned nothing at all here, which is what made an open window a deadlock.
    expect(actions.map((action) => action.type)).not.toContain("turn.roll");
    expect(actions).toContainEqual({
      gameId: state.gameId,
      actorId: fixtureIds.owner,
      expectedRevision: state.revision,
      type: "reaction.pass",
      decisionPointId: window.id,
      kind: window.kind,
    });
  });

  it("offers a reaction to an eligible player whose turn it is not", () => {
    // Given: a window the *other* player is eligible for, on the owner's turn.
    const base = preRollState();
    const window = createCanonicalGameState().reactionWindows[0];
    if (window === undefined) throw new Error("fixture missing a reaction window");
    const state: GameState = {
      ...base,
      reactionWindows: [
        {
          ...window,
          eligiblePlayerIds: [fixtureIds.hiddenOpponent],
          priorityPlayerId: fixtureIds.hiddenOpponent,
        },
      ],
    };

    // When: the non-active, eligible player asks.
    const actions = enumerateLegalActions(state, fixtureIds.hiddenOpponent);

    // Then: reacting out of turn is the entire mechanic, so it is advertised.
    expect(actions.map((action) => action.type)).toContain("reaction.pass");
  });

  it("offers prompt.respond instead of the turn's verbs while a prompt addressed to the active player is pending", () => {
    // Given: an active pre-roll turn with the canonical fixture's open prompt.
    const state = { ...preRollState(), prompts: createCanonicalGameState().prompts };
    const openPrompt = state.prompts[0];
    if (openPrompt === undefined) throw new Error("fixture missing an open prompt");

    // When: the active player (who the prompt addresses) asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: prompt.respond replaces the turn's verbs, carrying the prompt's own
    // options. The Quick preset has lending off, so nothing else survives.
    expect(actions).toEqual([
      {
        gameId: state.gameId,
        actorId: fixtureIds.owner,
        expectedRevision: state.revision,
        type: "prompt.respond",
        decisionPointId: openPrompt.id,
        kind: openPrompt.kind,
        options: openPrompt.legalResponses.map((option) => option.id),
      },
    ]);
  });

  it("does not offer prompt.respond to a player the prompt isn't addressed to, and still blocks their roll", () => {
    // Given: an open prompt addressed only to the owner.
    const state = { ...preRollState(), prompts: createCanonicalGameState().prompts };

    // When/Then: a different active-turn scenario isn't relevant here since
    // turn.activePlayerId still points at the owner — the other player has
    // no legal action at all (it's not their turn either way).
    const actions = enumerateLegalActions(state, fixtureIds.hiddenOpponent);
    expect(actions).toEqual([]);
  });

  it("blocks starting while engine work is pending", () => {
    const state = {
      ...setupState(),
      prompts: createCanonicalGameState().prompts,
    };

    expect(enumerateLegalActions(state, fixtureIds.owner)).toEqual([]);
  });

  it.each([
    ["paused", { status: "paused" as const }],
    ["ended", { status: "ended" as const }],
    ["in the wrong phase", { turn: { ...preRollState().turn, phase: "post-roll" as const } }],
  ] as const)("returns no action when the game is %s", (_stateDescription, change) => {
    // Given: a state that cannot accept a pre-roll command.
    const state = { ...preRollState(), ...change };

    // When: the active player asks for legal actions.
    const actions = enumerateLegalActions(state, fixtureIds.owner);

    // Then: no action is exposed.
    expect(actions).toEqual([]);
  });

  it("copies the state revision into every enumerated action", () => {
    // Given: setup and pre-roll states at different revisions.
    const setup = setupState(41);
    const preRoll = sharedPreRollState(59);

    // When: the authorized actors ask for legal actions.
    const setupActions = enumerateLegalActions(setup, fixtureIds.owner);
    const preRollActions = enumerateLegalActions(preRoll, fixtureIds.owner);

    // Then: every DTO carries the revision from its source state — including the
    // two dozen new verbs, any of which would silently fail its optimistic
    // concurrency check if it carried the wrong one.
    expect(setupActions).toEqual([
      expectedAction(setup, fixtureIds.owner, "game.start"),
    ]);
    expect(preRollActions.length).toBeGreaterThan(1);
    expect(preRollActions.every((action) => action.expectedRevision === 59)).toBe(true);
  });

  it("returns nothing at all to an eliminated player", () => {
    // Given: a table where the active player has been eliminated.
    const base = sharedPreRollState();
    const state: GameState = { ...base, eliminatedPlayerIds: [fixtureIds.owner] };

    // When/Then: elimination removes every verb, not just the turn's.
    expect(enumerateLegalActions(state, fixtureIds.owner)).toEqual([]);
  });

  describe("out-of-turn actions", () => {
    it("offers ballot.cast to a player whose turn it is not", () => {
      // Given: the shared-space fixture's two open ballots, on the owner's turn.
      const state = sharedPreRollState();

      // When: a non-active member of both audiences asks.
      const actions = enumerateLegalActions(state, fixtureIds.hiddenOpponent);

      // Then: an auction is supposed to run *while* something else resolves —
      // that is the dead-time fix — so it is offered off-turn.
      const ballots = actions.filter((action) => action.type === "ballot.cast");
      expect(ballots.map((action) => action.ballotId)).toContain(sharedSpaceIds.openBallot);
    });

    it("offers agreement.respond to the recipient of an open offer", () => {
      // Given: a public offer from the owner to the revealed opponent.
      const state = sharedPreRollState();

      // When: the recipient asks, out of turn.
      const actions = enumerateLegalActions(state, fixtureIds.revealedOpponent);

      // Then: the offer is answerable.
      const responses = actions.filter((action) => action.type === "agreement.respond");
      expect(responses.map((action) => action.agreementId)).toContain(
        sharedSpaceIds.publicAgreement,
      );
    });

    it("does not offer another player's ballot to somebody outside its audience", () => {
      // Given: a ballot whose audience is only the two opponents.
      const base = sharedPreRollState();
      const state: GameState = {
        ...base,
        ballots: base.ballots.map((ballot) => ({
          ...ballot,
          audience: [fixtureIds.hiddenOpponent, fixtureIds.revealedOpponent],
        })),
      };

      // When/Then: the owner is not entitled to cast, so it is never advertised.
      expect(types(state, fixtureIds.owner)).not.toContain("ballot.cast");
    });
  });

  describe("mode gating", () => {
    it("offers the shared-space verbs when the ruleset enables them", () => {
      // Given: the Standard preset, which has ownership, projects and trading on.
      const state = sharedPreRollState();

      // When: the active player asks.
      const offered = types(state, fixtureIds.owner);

      // Then: the mechanics the mode switches on are reachable from the UI.
      expect(offered).toContain("turn.roll");
      expect(offered).toContain("agreement.offer");
      expect(offered).toContain("project.contribute");
      expect(offered).toContain("loan.take");
    });

    it.each([
      ["ownership", { board: { ownershipEnabled: false } }, "tile.claim"],
      ["projects", { projects: { enabled: false } }, "project.start"],
      ["trading", { interaction: { tradesEnabled: false, promisesRecorded: false } }, "agreement.offer"],
      ["lending", { economy: { loansEnabled: false } }, "loan.take"],
      ["placements", { board: { placementsEnabled: false } }, "placement.place"],
      ["attacks", { conflict: { targetedAttacks: false } }, "attack.target"],
      [
        "dice adjustment",
        { agency: { diceAdjustEnabled: false, maxPipAdjust: 0 } },
        "turn.adjust-roll",
      ],
    ] as const)(
      "never offers %s once the ruleset switches it off",
      (_label, overrides, forbidden) => {
        // Given: the same table with exactly one gate flipped off.
        const state = withRules(sharedPreRollState(), overrides);

        // When/Then: a command a mode has disabled must not be advertised — an
        // offer the transition would then refuse is worse than no offer.
        expect(types(state, fixtureIds.owner)).not.toContain(forbidden);
      },
    );

    it("offers no free-action verb once the ruleset grants no turn actions", () => {
      // Given: a ruleset with the free-action economy switched off entirely.
      const state = withRules(sharedPreRollState(), {
        agency: { freeActionsPerTurn: 0 },
      });

      // When: the active player asks.
      const action = enumerateLegalActions(state, fixtureIds.owner).find(
        (candidate) => candidate.type === "turn.action",
      );

      // Then: none of work/network/scheme/rest is on offer. `turn.action` itself
      // may survive carrying only `role.reveal`, which spends no budget and is
      // gated on `hidden.rolesEnabled` rather than on the action economy — but a
      // free action must not be, and the budget must read as spent out.
      if (action !== undefined) {
        expect(action.type).toBe("turn.action");
        if (action.type !== "turn.action") throw new Error("narrowing");
        expect(action.actions).toEqual(["role.reveal"]);
        expect(action.remaining).toBe(0);
      }
      expect(
        enumerateLegalActions(state, fixtureIds.owner).some(
          (candidate) => candidate.type === "turn.activate-character",
        ),
      ).toBe(false);
    });

    it("never offers promotion.attempt while promotion is automatic", () => {
      // Given: a ruleset that promotes players as a side effect of the roll.
      const state = withRules(sharedPreRollState(), {
        agency: { promotionIsChoice: false },
      });

      // When/Then: the command exists but is illegal, so it is not advertised.
      const offered = types(state, fixtureIds.owner);
      expect(offered).not.toContain("promotion.attempt");
      expect(offered).not.toContain("promotion.decline");
    });

    it("never offers management.shuffle-deck to a player without the role", () => {
      // Given: hidden roles on, and an owner who is not Management.
      const state = withRules(sharedPreRollState(), {
        hidden: { rolesEnabled: true },
      });

      // When/Then: the Management verb is Management's alone.
      expect(state.players[fixtureIds.owner]?.role.kind).not.toBe("role.management");
      expect(types(state, fixtureIds.owner)).not.toContain("management.shuffle-deck");
    });
  });

  it("never advertises a server-injected command", () => {
    // Given: every seat at a fully-featured table.
    const state = sharedPreRollState();

    // When/Then: window.expire, quarter.advance and turn.timeout are the
    // server's alone (spec §7.1) — advertising one would be advertising an
    // exploit, because a player who could expire a window could close it the
    // instant it opened.
    for (const actorId of state.playerOrder) {
      const offered = types(state, actorId);
      expect(offered).not.toContain("window.expire");
      expect(offered).not.toContain("quarter.advance");
      expect(offered).not.toContain("turn.timeout");
    }
  });

  it("enumerates identically across a JSON round trip", () => {
    // Given: a fully-featured table and the repository's actual persistence
    // boundary.
    const state = sharedPreRollState(83);
    const restored = JSON.parse(JSON.stringify(state)) as GameState;

    // When/Then: what a player may do cannot depend on having been in memory.
    for (const actorId of state.playerOrder) {
      expect(enumerateLegalActions(restored, actorId)).toEqual(
        enumerateLegalActions(state, actorId),
      );
    }
  });
});
