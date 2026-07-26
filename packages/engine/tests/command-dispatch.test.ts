import { describe, expect, it } from "vitest";

import { applyCommand } from "../src";
import type {
  AbilityId,
  CommandId,
  DecisionPointId,
  GameCommand,
  GameCommandType,
  GameState,
  PlayerId,
  ResourceId,
} from "../src";
import { createCanonicalGameState, createSharedSpaceGameState, fixtureIds } from "./fixtures";
import { accepted, context, rejected, rollState, withRules } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const SERVER_ACTOR = brand<PlayerId>("server-scheduler");

/**
 * Every type in the `GameCommand` union, with the smallest payload the router
 * has to be able to carry. This list is the point of the test file: before this
 * round `applyCommand` handled three of thirty and refused the rest with
 * "Command type is not supported by this execution slice", so a mechanic could
 * be fully built, fully tested in isolation, and completely unreachable.
 */
const COMMAND_PAYLOADS: Readonly<Record<GameCommandType, unknown>> = {
  "game.start": {},
  "turn.roll": {},
  "turn.play-card": { cardId: brand("card-x"), targetPlayerIds: [], choice: null },
  "turn.activate-character": { abilityId: brand("ability-x"), targetPlayerIds: [], choice: null },
  "turn.spend-token": { tokenId: brand("token-move"), quantity: 1, use: "extra-movement" },
  "prompt.respond": { optionId: brand("option-owner"), value: null },
  "reaction.play": { cardId: null, abilityId: brand("ability-x"), targetPlayerIds: [], choice: null },
  "reaction.pass": {},
  "audit.pay-fine": {},
  "promotion.attempt": {},
  "management.shuffle-deck": { deckId: fixtureIds.deck },
  "management.block-promotion": {},
  "turn.timeout": {},
  "turn.adjust-roll": { pips: 1 },
  "turn.action": { action: "work", targetPlayerIds: [], choice: null },
  "promotion.decline": {},
  "tile.claim": { tileId: brand("tile-5") },
  "tile.upgrade": { tileId: brand("tile-5") },
  "placement.place": { kind: "placement.rumour", tileId: brand("tile-9") },
  "project.start": { definitionId: "project.quarterly-report", tileId: null, openToJoin: true },
  "project.contribute": { projectId: brand("project-rebrand"), money: 10, work: 1 },
  "project.sabotage": { projectId: brand("project-rebrand"), amount: 1, hidden: false },
  "agreement.offer": {
    recipientIds: [fixtureIds.revealedOpponent],
    give: [{ kind: "money", amount: 10 }],
    receive: [{ kind: "promise", text: "later" }],
    expiresAtRound: 9,
    visibility: "public",
  },
  "agreement.respond": { agreementId: brand("agreement-public"), accept: false },
  "attack.target": {
    targetPlayerId: fixtureIds.revealedOpponent,
    vector: "attack.undermine",
    cardId: null,
  },
  "ballot.cast": { ballotId: brand("ballot-open"), value: "for" },
  "loan.take": { principal: 100 },
  "loan.repay": { loanId: brand("loan-x"), amount: 10 },
  "window.expire": { decisionPointId: brand<DecisionPointId>("decision-unknown") },
  "quarter.advance": {},
};

const COMMAND_TYPES = Object.keys(COMMAND_PAYLOADS) as readonly GameCommandType[];

/** The rejection the router used to return for twenty-seven of the thirty. */
const UNSUPPORTED = "Command type is not supported by this execution slice";

const SERVER_INJECTED: readonly GameCommandType[] = [
  "window.expire",
  "quarter.advance",
  "turn.timeout",
];

function command(
  state: GameState,
  type: GameCommandType,
  overrides: { readonly actorId?: PlayerId; readonly commandId?: string } = {},
): GameCommand {
  return {
    commandId: brand<CommandId>(overrides.commandId ?? `command-${type}`),
    gameId: state.gameId,
    actorId: overrides.actorId ?? fixtureIds.owner,
    expectedRevision: state.revision,
    type,
    decisionPointId: brand<DecisionPointId>("decision-unknown"),
    payload: COMMAND_PAYLOADS[type],
  } as unknown as GameCommand;
}

/** An active, unblocked pre-roll turn owned by the owner, with everything on. */
function activeState(): GameState {
  const state = createSharedSpaceGameState();

  return {
    ...state,
    status: "active",
    boardSize: state.tileIds.length,
    turn: { ...state.turn, activePlayerId: fixtureIds.owner, phase: "pre-roll" },
    resolutionStack: [],
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    lastCommandId: null,
  };
}

/** The base fixture's open prevention window, restored onto an active turn. */
function windowState(): GameState {
  const canonical = createCanonicalGameState();
  const base = rollState(3);

  return {
    ...base,
    pendingEffects: canonical.pendingEffects,
    reactionWindows: canonical.reactionWindows,
    turn: { ...base.turn, phase: "reaction" },
  };
}

describe("applyCommand dispatch", () => {
  it("routes every declared command type", () => {
    // Given: an active table with the Standard preset's rules.
    const state = activeState();

    for (const type of COMMAND_TYPES) {
      // When: each declared command type is submitted.
      const result = applyCommand(state, command(state, type), context([0, 0]));

      // Then: it reaches a transition. Most are still refused — the payloads name
      // things that do not exist — but never with "unsupported", which is the
      // router saying the mechanic is unreachable rather than the mechanic saying
      // no.
      if (!result.ok) {
        expect(result.error.message, `${type} was not routed`).not.toBe(UNSUPPORTED);
      }
    }
  });

  it("still rejects a command type that is not in the union", () => {
    // Given: a well-formed roll with a garbage type.
    const state = activeState();
    const rogue = command(state, "turn.roll");
    Reflect.set(rogue, "type", "turn.unsupported");

    // When/Then: an unknown type is malformed input, not an unknown mechanic.
    rejected(applyCommand(state, rogue, context([0])), "INVALID_COMMAND");
  });

  describe("server-injected commands (§7.1)", () => {
    it.each(SERVER_INJECTED)("rejects %s from a player at the table", (type) => {
      // Given: an active table and a seated actor.
      const state = activeState();

      // When: a player submits a command the scheduler owns.
      const result = applyCommand(
        state,
        command(state, type, { actorId: fixtureIds.owner }),
        context([0]),
      );

      // Then: refused. A player who could expire a window could close it the
      // instant it opened and deny everyone else their say.
      rejected(result, "ACTOR_NOT_AUTHORIZED");
      expect(state).toEqual(activeState());
    });

    it.each(SERVER_INJECTED)(
      "rejects %s from every other seat too, not just the active one",
      (type) => {
        const state = activeState();

        for (const actorId of state.playerOrder) {
          rejected(
            applyCommand(state, command(state, type, { actorId }), context([0])),
            "ACTOR_NOT_AUTHORIZED",
          );
        }
      },
    );

    it("lets a non-seated actor past the ACTOR_NOT_FOUND guard", () => {
      // Given: the scheduler's own actor id, which is a seat at no table.
      const state = activeState();

      // When: it submits an expiry for a decision point that does not exist.
      const result = applyCommand(
        state,
        command(state, "window.expire", { actorId: SERVER_ACTOR }),
        context([0]),
      );

      // Then: the failure is about the decision point, not about the actor —
      // the old blanket guard rejected every legitimate expiry before it ran.
      rejected(result, "DECISION_POINT_NOT_FOUND");
    });
  });

  describe("the pending-work guard", () => {
    it("blocks a turn verb while a reaction window is open", () => {
      const state = windowState();

      rejected(
        applyCommand(
          { ...state, turn: { ...state.turn, phase: "pre-roll" } },
          command(state, "turn.roll"),
          context([0]),
        ),
        "ILLEGAL_ACTION",
      );
    });

    it("does not block the reaction that answers the window", () => {
      // Given: an open prevention window the owner is eligible for. The old guard
      // refused every command except prompt.respond here, which made the window
      // unanswerable and wedged the match permanently.
      const state = windowState();
      const window = state.reactionWindows[0];
      if (window === undefined) throw new Error("fixture missing a reaction window");

      // When: the eligible player passes.
      const result = applyCommand(
        state,
        { ...command(state, "reaction.pass"), decisionPointId: window.id } as GameCommand,
        context([0]),
      );

      // Then: it lands, and the window is gone.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state.reactionWindows).toEqual([]);
      expect(result.value.state.revision).toBe(state.revision + 1);
    });

    it("does not block a ballot cast while the engine is mid-resolution", () => {
      // Given: an open window plus a live ballot — an auction is supposed to run
      // *while* something else resolves (§7.3).
      const shared = createSharedSpaceGameState();
      const state: GameState = {
        ...windowState(),
        ballots: shared.ballots,
        rules: shared.rules,
      };

      // When: a player who is not the one the window is waiting on casts.
      const result = applyCommand(
        state,
        command(state, "ballot.cast", { actorId: fixtureIds.hiddenOpponent }),
        context([0]),
      );

      // Then: whatever the ballot layer decides, the router did not refuse it.
      if (!result.ok) {
        expect(result.error.message).not.toBe("Pending engine work blocks this command");
      }
    });
  });

  describe("lifecycle", () => {
    it("refuses every mutating verb while the game is still in setup", () => {
      const base = activeState();
      const state: GameState = { ...base, status: "setup" };

      for (const type of COMMAND_TYPES) {
        if (type === "game.start" || type === "window.expire") continue;
        const result = applyCommand(
          state,
          command(state, type, { actorId: SERVER_INJECTED.includes(type) ? SERVER_ACTOR : fixtureIds.owner }),
          context([0]),
        );
        expect(result.ok, `${type} ran against a setup game`).toBe(false);
      }
    });

    it("still lets the server drain a window after the match has ended", () => {
      // Given: a window still open when somebody reached Director.
      const base = windowState();
      const state: GameState = { ...base, status: "ended" };
      const window = state.reactionWindows[0];
      if (window === undefined) throw new Error("fixture missing a reaction window");

      // When: the scheduler expires it.
      const result = applyCommand(
        state,
        {
          ...command(state, "window.expire", { actorId: SERVER_ACTOR }),
          payload: { decisionPointId: window.id },
        } as GameCommand,
        context([0]),
      );

      // Then: it drains, rather than sitting in every projection forever with
      // nothing able to close it.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state.reactionWindows).toEqual([]);
    });

    it("makes window.expire idempotent", () => {
      // Given: a window the scheduler has already expired.
      const state = windowState();
      const window = state.reactionWindows[0];
      if (window === undefined) throw new Error("fixture missing a reaction window");
      const expire = (target: GameState, commandId: string): GameCommand =>
        ({
          ...command(target, "window.expire", { actorId: SERVER_ACTOR, commandId }),
          expectedRevision: target.revision,
          payload: { decisionPointId: window.id },
        }) as GameCommand;

      const first = applyCommand(state, expire(state, "expire-1"), context([0]));
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      // When: the scheduler fires a second time (a duplicated timer, or a replay).
      const second = applyCommand(
        first.value.state,
        expire(first.value.state, "expire-2"),
        context([0]),
      );

      // Then: nothing double-resolves — the close is a one-way door.
      rejected(second, "DECISION_POINT_NOT_FOUND");
    });
  });

  describe("turn.timeout", () => {
    const timeout = (state: GameState): GameCommand =>
      command(state, "turn.timeout", { actorId: SERVER_ACTOR });

    it("rolls for the active player when the mode says auto-roll", () => {
      // Given: a ruleset whose timeout behaviour is auto-roll.
      const state = withRules(rollState(3), { timers: { onTimeout: "auto-roll" } });

      // When: the clock runs out.
      const { state: next, events } = accepted(
        applyCommand(state, timeout(state), context([0, 0])),
      );

      // Then: the turn was actually taken on the player's behalf — the server
      // acts *for* them, so the die is theirs and the turn moves on.
      expect(events.some((event) => event.type === "DiceRolled")).toBe(true);
      expect(next.revision).toBe(state.revision + 1);
    });

    it("hands the turn on without a roll when the mode says auto-pass", () => {
      // Given: the same table under a ruleset that passes instead.
      const state = withRules(rollState(3), { timers: { onTimeout: "auto-pass" } });

      // When: the clock runs out.
      const { state: next, events } = accepted(
        applyCommand(state, timeout(state), context([0, 0])),
      );

      // Then: no die was drawn and somebody else is up.
      expect(events.some((event) => event.type === "DiceRolled")).toBe(false);
      expect(events.some((event) => event.type === "TurnStarted")).toBe(true);
      expect(next.turn.activePlayerId).not.toBe(fixtureIds.owner);
    });

    it("is mode-driven, not hardcoded — the two behaviours differ on one state", () => {
      const base = rollState(3);
      const rolled = applyCommand(
        withRules(base, { timers: { onTimeout: "auto-roll" } }),
        timeout(base),
        context([0, 0]),
      );
      const passed = applyCommand(
        withRules(base, { timers: { onTimeout: "auto-pass" } }),
        timeout(base),
        context([0, 0]),
      );

      expect(rolled.ok && passed.ok).toBe(true);
      if (!rolled.ok || !passed.ok) return;
      expect(rolled.value.state.players[fixtureIds.owner]?.position).not.toBe(
        passed.value.state.players[fixtureIds.owner]?.position,
      );
    });

    it("refuses to guess at a prompt the active player owes an answer to", () => {
      // Given: an audit-release prompt open against the active player.
      const canonical = createCanonicalGameState();
      const base = rollState(3);
      const state: GameState = { ...base, prompts: canonical.prompts };

      // When/Then: `PromptState.defaultResponse` is the prompt layer's to apply;
      // a timeout must not invent an answer.
      rejected(applyCommand(state, timeout(state), context([0])), "ILLEGAL_ACTION");
    });

    it("is rejected from the player whose clock it is", () => {
      const state = rollState(3);

      rejected(
        applyCommand(
          state,
          command(state, "turn.timeout", { actorId: fixtureIds.owner }),
          context([0]),
        ),
        "ACTOR_NOT_AUTHORIZED",
      );
    });
  });

  describe("authorisation (§6.3)", () => {
    const TURN_SCOPED: readonly GameCommandType[] = [
      "turn.roll",
      "turn.adjust-roll",
      "turn.action",
      "turn.play-card",
      "turn.spend-token",
      "turn.activate-character",
      "promotion.attempt",
      "promotion.decline",
      "audit.pay-fine",
      "tile.claim",
      "tile.upgrade",
      "placement.place",
      "project.start",
      "attack.target",
      "loan.take",
      "loan.repay",
      "management.shuffle-deck",
    ];

    it.each(TURN_SCOPED)("rejects %s from a player whose turn it is not", (type) => {
      // Given: an active turn belonging to the owner.
      const state = activeState();

      // When: a different seat submits a turn-scoped verb.
      const result = applyCommand(
        state,
        command(state, type, { actorId: fixtureIds.hiddenOpponent }),
        context([0, 0]),
      );

      // Then: refused, and canonical state is byte-identical.
      expect(result.ok, `${type} accepted from the wrong seat`).toBe(false);
      expect(state).toEqual(activeState());
    });

    it("rejects every command from an actor who is not at the table", () => {
      const state = activeState();
      const stranger = brand<PlayerId>("player-stranger");

      for (const type of COMMAND_TYPES) {
        if (SERVER_INJECTED.includes(type)) continue;
        const result = applyCommand(
          state,
          command(state, type, { actorId: stranger }),
          context([0]),
        );
        expect(result.ok, `${type} accepted from a stranger`).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("ACTOR_NOT_FOUND");
      }
    });
  });

  describe("closing a window the reaction layer cannot settle", () => {
    /**
     * The shared-space fixture's players carry only a money resource, so a table
     * that can actually fight has to be built: energy for the attacker to spend,
     * reputation on the target for the vector to drain, and one ready ability for
     * the defender to counter with.
     */
    function fightableState(defenceEnabled: boolean): GameState {
      const base = activeState();
      const attacker = base.players[fixtureIds.owner];
      const defender = base.players[fixtureIds.revealedOpponent];
      if (attacker === undefined || defender === undefined) {
        throw new Error("fixture missing a combatant");
      }

      return withRules(
        {
          ...base,
          players: {
            ...base.players,
            [fixtureIds.owner]: {
              ...attacker,
              resources: {
                ...attacker.resources,
                energy: {
                  id: brand<ResourceId>("resource-owner-energy"),
                  kind: "resource.energy",
                  value: 5,
                  minimum: 0,
                  maximum: 10,
                },
              },
            },
            [fixtureIds.revealedOpponent]: {
              ...defender,
              resources: {
                ...defender.resources,
                reputation: {
                  id: brand<ResourceId>("resource-defender-reputation"),
                  kind: "resource.reputation",
                  value: 4,
                  minimum: 0,
                  maximum: null,
                },
              },
              abilities: [
                {
                  id: brand<AbilityId>("ability-defender-counter"),
                  usesRemaining: 1,
                  cooldownLapsRemaining: 0,
                  data: {},
                },
              ],
            },
          },
        },
        { conflict: { targetedAttacks: true, defenceEnabled, heatEnabled: false } },
      );
    }

    /** An attack parked behind a defence window, opened through the router. */
    function openedAttack(): { readonly state: GameState; readonly decisionPointId: DecisionPointId } {
      const base = fightableState(true);
      const { state } = accepted(
        applyCommand(
          base,
          command(base, "attack.target", { commandId: "command-attack" }),
          context([0]),
        ),
      );
      const window = state.reactionWindows[0];
      if (window === undefined) throw new Error("the attack opened no defence window");

      return { state, decisionPointId: window.id };
    }

    function reputationOf(state: GameState, playerId: PlayerId): number {
      return state.players[playerId]?.resources["reputation"]?.value ?? 0;
    }

    it("lands the attack when the defender passes", () => {
      // Given: an attack waiting on its target's answer.
      const { state, decisionPointId } = openedAttack();
      const before = reputationOf(state, fixtureIds.revealedOpponent);

      // When: the defender declines to counter.
      const { state: next } = accepted(
        applyCommand(
          state,
          {
            ...command(state, "reaction.pass", { actorId: fixtureIds.revealedOpponent }),
            decisionPointId,
          } as GameCommand,
          context([0]),
        ),
      );

      // Then: the damage actually moves. The reaction layer closes the window
      // correctly but its pending-effect interpreter speaks only the v1 effect
      // vocabulary, so without the router handing the window back to attack.ts an
      // uncountered attack would silently do nothing at all.
      expect(next.reactionWindows).toEqual([]);
      expect(next.pendingEffects).toEqual([]);
      expect(reputationOf(next, fixtureIds.revealedOpponent)).toBe(before - 1);
      expect(next.revision).toBe(state.revision + 1);
    });

    it("drops the attack when the defender counters it", () => {
      // Given: the same attack, and a defender holding a usable ability.
      const { state, decisionPointId } = openedAttack();
      const defender = state.players[fixtureIds.revealedOpponent];
      if (defender === undefined) throw new Error("fixture missing the defender");
      const abilityId = defender.abilities[0]?.id;
      if (abilityId === undefined) throw new Error("fixture defender holds no ability");
      const before = reputationOf(state, fixtureIds.revealedOpponent);

      // When: they play a reaction.
      const result = applyCommand(
        state,
        {
          ...command(state, "reaction.play", { actorId: fixtureIds.revealedOpponent }),
          decisionPointId,
          payload: { cardId: null, abilityId, targetPlayerIds: [], choice: null },
        } as GameCommand,
        context([0]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Then: nothing lands, and the router does not re-apply it on top.
      expect(result.value.state.reactionWindows).toEqual([]);
      expect(reputationOf(result.value.state, fixtureIds.revealedOpponent)).toBe(before);
      expect(
        result.value.events.some((event) => event.type === "EffectPrevented"),
      ).toBe(true);
    });

    it("lands the attack when the server expires the window instead", () => {
      // Given: a defender who never answered.
      const { state, decisionPointId } = openedAttack();
      const before = reputationOf(state, fixtureIds.revealedOpponent);

      // When: the scheduler fires at the deadline.
      const { state: next } = accepted(
        applyCommand(
          state,
          {
            ...command(state, "window.expire", { actorId: SERVER_ACTOR }),
            payload: { decisionPointId },
          } as GameCommand,
          context([0]),
        ),
      );

      // Then: the same outcome as a pass — a missed answer is not a free escape.
      expect(next.reactionWindows).toEqual([]);
      expect(reputationOf(next, fixtureIds.revealedOpponent)).toBe(before - 1);
    });

    it("never opens a defence window at all once the mode disables defence", () => {
      // Given: the same attack under a ruleset with defence switched off.
      const base = fightableState(false);

      // When: the attack is made.
      const { state } = accepted(
        applyCommand(base, command(base, "attack.target"), context([0])),
      );

      // Then: it resolves immediately, with nothing left for a window to guard.
      expect(state.reactionWindows).toEqual([]);
      expect(state.pendingEffects).toEqual([]);
    });
  });

  it("dispatches identically across a JSON round trip", () => {
    // Given: the repository's actual persistence boundary.
    const state = activeState();
    const restored = JSON.parse(JSON.stringify(state)) as GameState;

    for (const type of COMMAND_TYPES) {
      const actorId = SERVER_INJECTED.includes(type) ? SERVER_ACTOR : fixtureIds.owner;
      const live = applyCommand(state, command(state, type, { actorId }), context([0, 0]));
      const replayed = applyCommand(
        restored,
        command(restored, type, { actorId }),
        context([0, 0]),
      );

      expect(replayed.ok, `${type} diverged after a round trip`).toBe(live.ok);
      if (live.ok && replayed.ok) {
        expect(replayed.value.state).toEqual(live.value.state);
      } else if (!live.ok && !replayed.ok) {
        expect(replayed.error.code).toBe(live.error.code);
      }
    }
  });
});
