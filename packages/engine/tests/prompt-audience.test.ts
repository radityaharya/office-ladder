import { describe, expect, it } from "vitest";

import { applyCommand } from "../src";
import type {
  DecisionPointId,
  GameState,
  PlayerId,
  PromptOptionId,
  PromptState,
  RespondToPromptCommand,
} from "../src";
import {
  HEAT_INVESTIGATION_OPTIONS,
  buildInvestigationPrompt,
} from "../src/execution/heat";
import { respondToPrompt } from "../src/execution/respond-to-prompt";
import {
  accepted,
  agencyContext,
  agencyIds,
  agencyState,
  branded,
  commandBase,
  expectRoundTrips,
  rejected,
  resourceValue,
} from "./agency-fixtures";

/**
 * `prompt.respond` used to require `state.turn.activePlayerId === actorId`, in
 * both `respond-to-prompt.ts` and `apply-command.ts`. `PromptState.audience` is
 * a list, and it is a list precisely because prompts are not single-audience —
 * so that check made every prompt raised on somebody who is not the active
 * player unanswerable: reactions, votes, trade offers, the chosen-opponent
 * prompt, and the heat investigation a round boundary raises on whoever authored
 * a sabotage that just came due.
 *
 * Every case here that answers off-turn fails against that check with
 * NOT_ACTOR_TURN.
 */

const THRESHOLD = 3;

/** The heat threshold is what an accepted reprimand docks, so it is pinned. */
function investigatedState(audience?: readonly PlayerId[]): GameState {
  const base = agencyState({
    rules: { conflict: { heatEnabled: true, heatThreshold: THRESHOLD } },
    opponent: { reputation: 9 },
    bystander: { reputation: 9 },
  });
  const raised = buildInvestigationPrompt(
    base,
    base.eventSequence + 1,
    agencyIds.hiddenOpponent,
  );
  const prompt: PromptState =
    audience === undefined ? raised : { ...raised, audience };

  return { ...base, prompts: [prompt] };
}

function respond(
  state: GameState,
  actorId: PlayerId,
  optionId: string,
  commandId: string,
  overrides: Partial<RespondToPromptCommand> = {},
): RespondToPromptCommand {
  const prompt = state.prompts[0];
  if (prompt === undefined) throw new Error("expected an open prompt");

  return {
    ...commandBase(state, commandId, actorId),
    type: "prompt.respond",
    decisionPointId: prompt.id,
    payload: { optionId: branded<PromptOptionId>(optionId), value: null },
    ...overrides,
  };
}

describe("prompt.respond — the audience is the authorisation", () => {
  it("Given an investigation raised on a player who is not the active one, When they accept the reprimand, Then it is applied and nobody else's turn moves", () => {
    const state = investigatedState();
    expect(state.turn.activePlayerId).toBe(agencyIds.owner);
    expect(state.prompts[0]?.audience).toEqual([agencyIds.hiddenOpponent]);

    const { state: next, events } = accepted(
      applyCommand(
        state,
        respond(
          state,
          agencyIds.hiddenOpponent,
          HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
          "respond-off-turn",
        ),
        agencyContext(),
      ),
    );

    expect(resourceValue(next, agencyIds.hiddenOpponent, "reputation")).toBe(9 - THRESHOLD);
    expect(next.prompts).toEqual([]);
    // The answer belongs to the responder, not to whoever happens to be rolling:
    // it must not hand off, renumber, or otherwise spend the active player's turn.
    expect(next.turn).toEqual(state.turn);
    expect(events.map((event) => event.type)).toEqual(["ResourceChanged", "EffectProposed"]);
    expect(events[1]?.payload).toMatchObject({
      affectedPlayerIds: [agencyIds.hiddenOpponent],
      effect: { kind: "prompt.respond", optionId: HEAT_INVESTIGATION_OPTIONS.acceptReprimand },
    });
    expectRoundTrips(next);
  });

  it("Given an investigation raised on a player who is not the active one, When they take leave instead, Then the branch that spends no resource still costs them a future turn", () => {
    const state = investigatedState();

    const { state: next } = accepted(
      applyCommand(
        state,
        respond(
          state,
          agencyIds.hiddenOpponent,
          HEAT_INVESTIGATION_OPTIONS.takeLeave,
          "respond-leave",
        ),
        agencyContext(),
      ),
    );

    expect(next.players[agencyIds.hiddenOpponent]?.skipTurns).toBe(1);
    expect(resourceValue(next, agencyIds.hiddenOpponent, "reputation")).toBe(9);
    expect(next.turn).toEqual(state.turn);
    expectRoundTrips(next);
  });

  it("Given a prompt addressed to somebody else, When the active player answers it, Then holding the turn buys them nothing", () => {
    const state = investigatedState();

    rejected(
      applyCommand(
        state,
        respond(
          state,
          agencyIds.owner,
          HEAT_INVESTIGATION_OPTIONS.takeLeave,
          "respond-hijack",
        ),
        agencyContext(),
      ),
      "ACTOR_NOT_AUTHORIZED",
    );
    expect(state.prompts).toHaveLength(1);
  });

  it("Given an audience member, When they answer with an option the prompt never offered, Then it is refused", () => {
    const state = investigatedState();

    rejected(
      applyCommand(
        state,
        respond(state, agencyIds.hiddenOpponent, "resign-with-full-pay", "respond-invented"),
        agencyContext(),
      ),
      "INVALID_PROMPT_RESPONSE",
    );
  });

  it("Given an audience member, When they name a decision point that is not open, Then it is refused before anything is read from the payload", () => {
    const state = investigatedState();

    rejected(
      applyCommand(
        state,
        respond(
          state,
          agencyIds.hiddenOpponent,
          HEAT_INVESTIGATION_OPTIONS.takeLeave,
          "respond-unknown-point",
          { decisionPointId: branded<DecisionPointId>("decision-invented") },
        ),
        agencyContext(),
      ),
      "DECISION_POINT_NOT_FOUND",
    );
  });

  it("Given a prompt of a kind nothing resolves, When an audience member answers it, Then it is refused rather than silently accepted", () => {
    const state = investigatedState();
    const prompt = state.prompts[0];
    if (prompt === undefined) throw new Error("expected an open prompt");
    const madeUp: GameState = { ...state, prompts: [{ ...prompt, kind: "made-up-decision" }] };

    rejected(
      applyCommand(
        madeUp,
        respond(
          madeUp,
          agencyIds.hiddenOpponent,
          HEAT_INVESTIGATION_OPTIONS.takeLeave,
          "respond-made-up",
        ),
        agencyContext(),
      ),
      "ILLEGAL_ACTION",
    );
  });
});

describe("prompt.respond — one answer per audience member", () => {
  const twoAudience = [agencyIds.hiddenOpponent, agencyIds.revealedOpponent] as const;

  it("Given a two-seat audience, When the first member answers, Then their answer is recorded and the prompt stays open for the other", () => {
    const state = investigatedState(twoAudience);

    const { state: next } = accepted(
      applyCommand(
        state,
        respond(
          state,
          agencyIds.hiddenOpponent,
          HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
          "respond-first",
        ),
        agencyContext(),
      ),
    );

    expect(next.prompts).toHaveLength(1);
    expect(next.prompts[0]?.responses).toEqual({
      [agencyIds.hiddenOpponent]: {
        optionId: HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
        value: null,
      },
    });
    expect(resourceValue(next, agencyIds.hiddenOpponent, "reputation")).toBe(9 - THRESHOLD);
    expect(resourceValue(next, agencyIds.revealedOpponent, "reputation")).toBe(9);
    expectRoundTrips(next);
  });

  it("Given a member who has already answered, When they answer the same prompt again, Then the second one is refused", () => {
    const state = investigatedState(twoAudience);
    const { state: once } = accepted(
      applyCommand(
        state,
        respond(
          state,
          agencyIds.hiddenOpponent,
          HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
          "respond-first",
        ),
        agencyContext(),
      ),
    );

    rejected(
      applyCommand(
        once,
        respond(
          once,
          agencyIds.hiddenOpponent,
          HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
          "respond-again",
        ),
        agencyContext(),
      ),
      "DECISION_POINT_STALE",
    );
    // The docking happened exactly once, which is the point of the guard.
    expect(resourceValue(once, agencyIds.hiddenOpponent, "reputation")).toBe(9 - THRESHOLD);
  });

  it("Given a two-seat audience, When the last outstanding member answers, Then the prompt closes", () => {
    const state = investigatedState(twoAudience);
    const { state: once } = accepted(
      applyCommand(
        state,
        respond(
          state,
          agencyIds.hiddenOpponent,
          HEAT_INVESTIGATION_OPTIONS.acceptReprimand,
          "respond-first",
        ),
        agencyContext(),
      ),
    );

    const { state: twice } = accepted(
      applyCommand(
        once,
        respond(
          once,
          agencyIds.revealedOpponent,
          HEAT_INVESTIGATION_OPTIONS.takeLeave,
          "respond-second",
        ),
        agencyContext(),
      ),
    );

    expect(twice.prompts).toEqual([]);
    expect(twice.players[agencyIds.revealedOpponent]?.skipTurns).toBe(1);
    expect(twice.turn).toEqual(state.turn);
    expectRoundTrips(twice);
  });
});

/* ------------------------------------------------------------------ *
 * The kinds that still need the turn
 * ------------------------------------------------------------------ */

function auditPrompt(playerId: PlayerId): PromptState {
  return {
    id: branded<DecisionPointId>("prompt-audit-release"),
    frameId: branded("frame-audit-release"),
    kind: "audit-release",
    audience: [playerId],
    legalResponses: [
      { id: branded<PromptOptionId>("pay-fine"), value: null },
      { id: branded<PromptOptionId>("attempt-roll"), value: null },
    ],
    deadlineAt: null,
    defaultResponse: { optionId: branded<PromptOptionId>("attempt-roll"), value: null },
    visibility: "public",
    responses: {},
  };
}

describe("prompt.respond — audit-release is still answered on your own turn", () => {
  it("Given a confined player whose turn has moved on, When they try to answer the release prompt, Then it is refused as not their turn", () => {
    // The audit prompt outlives the roll that opened it — roll-turn.ts hands the
    // turn on while it stays open — so without a turn requirement of its own a
    // confined player could pay the fine, or re-roll `attempt-roll` (which
    // deliberately keeps the prompt open on a failure) as many times as they
    // liked, during everybody else's turns.
    const base = agencyState({ opponent: { money: 1000, inAudit: true } });
    const state: GameState = { ...base, prompts: [auditPrompt(agencyIds.hiddenOpponent)] };

    rejected(
      applyCommand(
        state,
        respond(state, agencyIds.hiddenOpponent, "pay-fine", "respond-audit-off-turn"),
        agencyContext(),
      ),
      "NOT_ACTOR_TURN",
    );
    expect(state.players[agencyIds.hiddenOpponent]?.inAudit).toBe(true);
  });

  it("Given a confined player holding the turn, When they pay the fine, Then they are released and the turn hands off exactly as before", () => {
    const base = agencyState({ owner: { money: 1000, inAudit: true } });
    const state: GameState = { ...base, prompts: [auditPrompt(agencyIds.owner)] };

    const { state: next, events } = accepted(
      respondToPrompt(
        state,
        respond(state, agencyIds.owner, "pay-fine", "respond-audit-on-turn"),
        agencyContext(),
      ),
    );

    expect(resourceValue(next, agencyIds.owner, "money")).toBe(500);
    expect(next.players[agencyIds.owner]?.inAudit).toBe(false);
    expect(next.prompts).toEqual([]);
    expect(next.turn.activePlayerId).toBe(agencyIds.hiddenOpponent);
    expect(events.at(-1)?.type).toBe("TurnStarted");
    expectRoundTrips(next);
  });
});
