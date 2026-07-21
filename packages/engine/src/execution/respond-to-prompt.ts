import type { RespondToPromptCommand } from "../commands";
import { createEventMetadata } from "./events";
import type { GameEvent, ResourceChangedEvent, TurnStartedEvent } from "../events";
import type { GameState, PlayerState } from "../model";
import { createSeededRandomSource, rollDie } from "../random";
import { rejectCommand } from "./errors";
import { resolveNextTurn } from "./next-turn";
import type { TransitionContext, TransitionResult } from "./types";

const AUDIT_FINE = 500;

/**
 * The only prompt kind currently wired up: the audit-confinement release
 * choice opened by the "audit" corner tile's auditConfinement effect (see
 * resolve-tile-effects.ts). Pay the fine to be released immediately, or
 * attempt a fresh 2d6 roll and hope for doubles. Either choice consumes the
 * player's turn — see AGENTS.md for the simplifications this makes versus a
 * full Monopoly-style "release then still move" jail mechanic.
 */
export function respondToPrompt(
  state: GameState,
  command: RespondToPromptCommand,
  context: TransitionContext,
): TransitionResult {
  const prompt = state.prompts.find((candidate) => candidate.id === command.decisionPointId);
  if (prompt === undefined) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_NOT_FOUND",
      message: "No matching open prompt for this decisionPointId",
    });
  }
  if (!prompt.audience.includes(command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Actor is not part of this prompt's audience",
    });
  }
  if (state.turn.activePlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can respond to their own prompt",
    });
  }
  const option = prompt.legalResponses.find((candidate) => candidate.id === command.payload.optionId);
  if (option === undefined) {
    return rejectCommand(state, command, {
      code: "INVALID_PROMPT_RESPONSE",
      message: "optionId is not one of this prompt's legal responses",
    });
  }
  const player = state.players[command.actorId];
  if (player === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Prompt actor is missing from canonical player state",
    });
  }
  if (prompt.kind !== "audit-release") {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Unsupported prompt kind",
    });
  }

  const revision = state.revision + 1;
  const allEvents: GameEvent[] = [];
  const eventMetadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + allEvents.length + 1,
    );

  let updatedPlayer: PlayerState = player;
  let released = false;

  if (String(option.id) === "pay-fine") {
    const money = player.resources.money;
    if (money !== undefined) {
      const newValue = Math.max(0, money.value - AUDIT_FINE);
      updatedPlayer = { ...player, resources: { ...player.resources, money: { ...money, value: newValue } } };
      const resourceChanged: ResourceChangedEvent = {
        ...eventMetadata(),
        type: "ResourceChanged",
        payload: {
          playerId: player.id,
          resourceId: money.id,
          previousValue: money.value,
          newValue,
          reason: "audit-fine",
        },
      };
      allEvents.push(resourceChanged);
    }
    released = true;
  } else {
    const releaseRandom = createSeededRandomSource(command.commandId);
    const first = rollDie(releaseRandom);
    const second = rollDie(releaseRandom);
    released = first === second;
  }

  updatedPlayer = { ...updatedPlayer, inAudit: !released };

  const currentOrderIndex = state.playerOrder.indexOf(command.actorId);
  const nextTurn = resolveNextTurn(state, currentOrderIndex, false, command.actorId);

  const turnStarted: TurnStartedEvent = {
    ...eventMetadata(),
    type: "TurnStarted",
    payload: {
      playerId: nextTurn.nextPlayerId,
      turnNumber: nextTurn.turnNumber,
      round: nextTurn.round,
      phase: "pre-roll",
      deadlineAt: null,
    },
  };
  allEvents.push(turnStarted);

  const lastEvent = allEvents[allEvents.length - 1];
  if (lastEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Prompt response did not emit an event",
    });
  }

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision,
        eventSequence: lastEvent.sequence,
        players: { ...nextTurn.players, [player.id]: updatedPlayer },
        // A failed "attempt-roll" leaves the same prompt open — the player
        // is still confined and gets asked again next time it's their turn.
        prompts: released
          ? state.prompts.filter((candidate) => candidate.id !== prompt.id)
          : state.prompts,
        turn: {
          number: nextTurn.turnNumber,
          round: nextTurn.round,
          activePlayerId: nextTurn.nextPlayerId,
          phase: "pre-roll",
          startedAt: context.logicalTimestamp,
          deadlineAt: null,
        },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: allEvents,
    },
  };
}
