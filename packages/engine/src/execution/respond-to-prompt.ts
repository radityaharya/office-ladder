import type { BoardTile, TileDecisionConfig } from "@office-ladder/content";

import type { RespondToPromptCommand } from "../commands";
import { createEventMetadata } from "./events";
import type {
  DiceRolledEvent,
  GameEvent,
  ResourceChangedEvent,
  TurnStartedEvent,
} from "../events";
import type { GameState, PlayerState, PromptState } from "../model";
import { rollDie } from "../random";
import { createEphemeralRandom, ephemeralRandomStreamName } from "./ephemeral-random";
import { rejectCommand } from "./errors";
import { resolveNextTurn, withBurnoutRecoveries } from "./next-turn";
import { applyEffectDescriptors, matchRollOutcome } from "./resolve-tile-effects";
import type { TransitionContext, TransitionResult } from "./types";

const AUDIT_FINE = 500;

type EventMetadata = () => Omit<GameEvent, "type" | "payload">;

type Resolution = {
  readonly player: PlayerState;
  /**
   * A prompt that stays open leaves the player facing the same question on
   * their next turn — a failed audit-release attempt, never a decision the
   * player actually answered.
   */
  readonly keepPromptOpen: boolean;
};

type ResolutionResult =
  | { readonly ok: true; readonly value: Resolution }
  | {
      readonly ok: false;
      readonly error: { readonly code: "ILLEGAL_ACTION" | "INVARIANT_VIOLATION"; readonly message: string };
    };

/**
 * The audit-confinement release choice opened by the "audit" corner tile's
 * auditConfinement effect (see resolve-tile-effects.ts). Pay the fine to be
 * released immediately, or attempt a fresh 2d6 roll and hope for doubles.
 * Either choice consumes the player's turn — see AGENTS.md for the
 * simplifications this makes versus a full Monopoly-style jail mechanic.
 *
 * The attempt is a ~1/6 gamble against a 500-money alternative, so its
 * randomness is exactly what a cheat wants to control. It comes from an
 * ephemeral source seeded from server-owned state (see ephemeral-random.ts) and
 * from nothing the client sends; a failed attempt is re-rolled from a *later*
 * state, so it is a fresh draw rather than the same losing roll forever.
 */
function resolveAuditRelease(
  state: GameState,
  player: PlayerState,
  optionId: string,
  events: GameEvent[],
  eventMetadata: EventMetadata,
): ResolutionResult {
  let updatedPlayer = player;
  let released = false;

  if (optionId === "pay-fine") {
    const money = player.resources.money;
    if (money !== undefined) {
      const newValue = Math.max(0, money.value - AUDIT_FINE);
      updatedPlayer = {
        ...player,
        resources: { ...player.resources, money: { ...money, value: newValue } },
      };
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
      events.push(resourceChanged);
    }
    released = true;
  } else {
    const releaseRandom = createEphemeralRandom(state, "audit-release");
    const first = rollDie(releaseRandom);
    const second = rollDie(releaseRandom);
    released = first === second;
  }

  return {
    ok: true,
    value: {
      player: { ...updatedPlayer, inAudit: !released },
      keepPromptOpen: !released,
    },
  };
}

function emitResourceEvents(
  player: PlayerState,
  changes: ReturnType<typeof applyEffectDescriptors>["changes"],
  reason: string,
  events: GameEvent[],
  eventMetadata: EventMetadata,
): void {
  for (const change of changes) {
    const resource = player.resources[change.resource];
    if (resource === undefined) continue;
    const resourceChanged: ResourceChangedEvent = {
      ...eventMetadata(),
      type: "ResourceChanged",
      payload: {
        playerId: player.id,
        resourceId: resource.id,
        previousValue: change.previousValue,
        newValue: change.newValue,
        reason,
      },
    };
    events.push(resourceChanged);
  }
}

/**
 * Resolves an authored tile decision (`BoardTile.decision`). Fully generic over
 * the authored config: the prompt kind, both option ids, the cost, the check and
 * every outcome come from content, so a second tile decision needs no engine
 * change at all — only new authored data.
 *
 * Randomness comes from an ephemeral source seeded from server-owned canonical
 * state (see ephemeral-random.ts), under its own purpose so it never correlates
 * with the audit-release attempt or with tile resolution: the persisted "dice"
 * stream advances only for movement rolls, and replaying the same command
 * against the same state re-derives the same faces.
 */
function resolveTileDecision(
  state: GameState,
  player: PlayerState,
  decision: TileDecisionConfig,
  context: TransitionContext,
  optionId: string,
  events: GameEvent[],
  eventMetadata: EventMetadata,
): ResolutionResult {
  const random = createEphemeralRandom(state, "tile-decision");

  if (optionId === decision.decline.optionId) {
    const declined = applyEffectDescriptors(
      player,
      decision.decline.effects,
      random,
      context.content.decks,
    );
    emitResourceEvents(declined.player, declined.changes, "tile-decision", events, eventMetadata);
    return { ok: true, value: { player: declined.player, keepPromptOpen: false } };
  }
  if (optionId !== decision.accept.optionId) {
    return {
      ok: false,
      error: {
        code: "ILLEGAL_ACTION",
        message: "Option is not one of this tile decision's branches",
      },
    };
  }

  const cost = player.resources[decision.accept.cost.resource];
  if (cost === undefined || cost.value < decision.accept.cost.amount) {
    return {
      ok: false,
      error: {
        code: "ILLEGAL_ACTION",
        message: "Accepting this decision costs more than the player has",
      },
    };
  }

  const paidValue = cost.value - decision.accept.cost.amount;
  const paidPlayer: PlayerState = {
    ...player,
    resources: {
      ...player.resources,
      [decision.accept.cost.resource]: { ...cost, value: paidValue },
    },
  };
  const costCharged: ResourceChangedEvent = {
    ...eventMetadata(),
    type: "ResourceChanged",
    payload: {
      playerId: player.id,
      resourceId: cost.id,
      previousValue: cost.value,
      newValue: paidValue,
      reason: "tile-decision-cost",
    },
  };
  events.push(costCharged);

  const faces: number[] = [];
  for (let index = 0; index < decision.accept.roll.count; index += 1) {
    faces.push(rollDie(random, decision.accept.roll.sides));
  }
  const total = faces.reduce((sum, face) => sum + face, 0);
  const isDoubles = faces.length === 2 && faces[0] === faces[1];
  const diceRolled: DiceRolledEvent = {
    ...eventMetadata(),
    type: "DiceRolled",
    payload: {
      playerId: player.id,
      dice: faces,
      total,
      purpose: decision.kind,
      // Named honestly: this is the ephemeral per-purpose stream, not the
      // persisted "dice" stream, whose cursor is untouched here.
      rngStream: ephemeralRandomStreamName("tile-decision"),
      rngCursor: random.getCursor(),
    },
  };
  events.push(diceRolled);

  const outcome = matchRollOutcome(decision.accept.outcomes, total, isDoubles);
  if (outcome === null) {
    // Authored outcomes must cover every face the declared dice can produce;
    // the content validator enforces it, so reaching here is a content bug.
    return {
      ok: false,
      error: {
        code: "INVARIANT_VIOLATION",
        message: "No authored outcome matches this decision's roll",
      },
    };
  }

  const applied = applyEffectDescriptors(
    paidPlayer,
    outcome.effects,
    random,
    context.content.decks,
  );
  emitResourceEvents(applied.player, applied.changes, "tile-decision", events, eventMetadata);

  return { ok: true, value: { player: applied.player, keepPromptOpen: false } };
}

/** The authored decision on the tile the player is standing on, if any. */
function findTileDecision(
  state: GameState,
  context: TransitionContext,
  player: PlayerState,
): TileDecisionConfig | null {
  const tileId = state.tileIds[player.position];
  if (tileId === undefined) return null;
  const tile: BoardTile | undefined = context.content.board.spaces.find(
    (candidate) => candidate.id === tileId,
  );

  return tile?.decision ?? null;
}

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

  const allEvents: GameEvent[] = [];
  const eventMetadata: EventMetadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + allEvents.length + 1,
    );

  const decision = findTileDecision(state, context, player);
  const resolution: ResolutionResult =
    prompt.kind === "audit-release"
      ? resolveAuditRelease(state, player, String(option.id), allEvents, eventMetadata)
      : decision !== null && decision.kind === prompt.kind
        ? resolveTileDecision(
            state,
            player,
            decision,
            context,
            String(option.id),
            allEvents,
            eventMetadata,
          )
        : {
            ok: false,
            error: { code: "ILLEGAL_ACTION", message: "Unsupported prompt kind" },
          };

  if (!resolution.ok) {
    return rejectCommand(state, command, resolution.error);
  }

  const currentOrderIndex = state.playerOrder.indexOf(command.actorId);
  // As in roll-turn.ts, the walk gets the actor's record as this response leaves
  // it — an answer can move money and can release confinement, and the walk is
  // able to reach the actor themselves (see next-turn.ts).
  const nextTurn = resolveNextTurn(
    state,
    currentOrderIndex,
    false,
    command.actorId,
    resolution.value.player,
  );
  const updatedPlayer = nextTurn.players[command.actorId] ?? resolution.value.player;

  // Answering a prompt ends a turn too, so the same start-of-turn burnout check
  // runs here and is reported the same way — see next-turn.ts.
  for (const recovery of nextTurn.burnoutRecoveries) {
    const refilled: ResourceChangedEvent = {
      ...eventMetadata(),
      type: "ResourceChanged",
      payload: {
        playerId: recovery.playerId,
        resourceId: recovery.resourceId,
        previousValue: recovery.previousValue,
        newValue: recovery.newValue,
        reason: "burnout-recovery",
      },
    };
    allEvents.push(refilled);
  }

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

  const remainingPrompts: readonly PromptState[] = resolution.value.keepPromptOpen
    ? state.prompts
    : state.prompts.filter((candidate) => candidate.id !== prompt.id);

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        players: withBurnoutRecoveries(
          { ...nextTurn.players, [player.id]: updatedPlayer },
          nextTurn.burnoutRecoveries,
        ),
        prompts: remainingPrompts,
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
