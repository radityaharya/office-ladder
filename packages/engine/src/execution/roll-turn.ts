import type { RollTurnCommand } from "../commands";
import { createEventMetadata } from "./events";
import type { GameEvent, MatchEndedEvent, PlayerPromotedEvent } from "../events";
import { createStableId, type GameState, type MatchOutcome, type PlayerState } from "../model";
import { rollDie } from "../random";
import { moveAroundBoard } from "../rules";
import { rejectCommand } from "./errors";
import { resolvePromotion } from "./roll-promotion";
import { createRollEvents } from "./roll-events";
import {
  diceCursor,
  persistedDiceStream,
  restoreDiceSource,
  trackRandom,
} from "./roll-random";
import { resolveSalary } from "./roll-salary";
import type { TransitionContext, TransitionResult } from "./types";

export function rollTurn(
  state: GameState,
  command: RollTurnCommand,
  context: TransitionContext,
): TransitionResult {
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Dice can only be rolled in an active game",
    });
  }
  if (state.turn.phase !== "pre-roll") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "Dice can only be rolled during pre-roll",
    });
  }
  if (state.turn.activePlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can roll",
    });
  }
  if (
    state.resolutionStack.length > 0 ||
    state.prompts.length > 0 ||
    state.pendingEffects.length > 0 ||
    state.reactionWindows.length > 0
  ) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Pending engine work blocks rolling",
    });
  }

  const player = state.players[command.actorId];
  const diceStream = state.rng.streams.dice;
  const currentOrderIndex = state.playerOrder.indexOf(command.actorId);
  const receptionistIndex = context.content.board.spaces.find(
    (tile) => tile.kind === "receptionist",
  )?.index;
  if (
    player === undefined ||
    diceStream === undefined ||
    currentOrderIndex < 0 ||
    receptionistIndex === undefined
  ) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The active turn is missing required canonical state",
    });
  }

  const productionRandom = context.random === undefined;
  const restoredRandom = productionRandom ? restoreDiceSource(diceStream) : null;
  if (productionRandom && restoredRandom === null) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The persisted dice stream is not a supported seeded stream",
    });
  }
  const random = context.random ?? restoredRandom;
  if (random === null) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The dice random source is unavailable",
    });
  }

  const trackedRandom = trackRandom(random);
  const die = rollDie(trackedRandom.source);
  const movement = moveAroundBoard({
    position: player.position,
    spaces: die,
    boardSize: state.boardSize,
    receptionistIndex,
  });
  const nextOrderIndex = (currentOrderIndex + 1) % state.playerOrder.length;
  const nextPlayerId = state.playerOrder[nextOrderIndex];
  const tileId = state.tileIds[movement.destination];
  if (nextPlayerId === undefined || tileId === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Movement resolved outside canonical turn or board state",
    });
  }

  const salary = resolveSalary(player, movement, context.content);
  if (salary === null) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Salary resolution requires canonical rank and money state",
    });
  }

  const updatedMoney = salary.moneyResource.value + salary.amount;
  const revision = state.revision + 1;
  const nextTurnNumber = state.turn.number + 1;
  const nextRound =
    nextPlayerId === state.playerOrder[0] ? state.turn.round + 1 : state.turn.round;
  const consumed = trackedRandom.consumed();
  const rngCursor = diceCursor(random, diceStream, consumed);
  const persistedStream = persistedDiceStream(random, diceStream, consumed);
  const events = createRollEvents({
    state,
    command,
    context,
    player,
    die,
    rngCursor,
    movement,
    salary,
    tileId,
    nextPlayerId,
    nextTurnNumber,
    nextRound,
  });
  const finalEvent = events[events.length - 1];
  if (finalEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Roll resolution did not emit a turn event",
    });
  }

  const movedPlayer: PlayerState = {
    ...player,
    position: movement.destination,
    lapsCompleted: player.lapsCompleted + movement.laps,
    resources:
      salary.amount > 0
        ? {
            ...player.resources,
            [salary.moneyKey]: {
              ...salary.moneyResource,
              value: updatedMoney,
            },
          }
        : player.resources,
  };

  const promotion = resolvePromotion(movedPlayer, context.content, state.modeId);
  const allEvents: GameEvent[] = [...events];
  const eventMetadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + allEvents.length + 1,
    );

  let updatedPlayer = movedPlayer;
  let outcome: MatchOutcome | null = null;

  if (promotion.promoted) {
    const currentReputation = movedPlayer.resources[promotion.reputationKey];
    const currentMoney = movedPlayer.resources[promotion.moneyKey];
    if (currentReputation !== undefined && currentMoney !== undefined) {
      const toRankId = createStableId("RankId", promotion.toRankId);
      updatedPlayer = {
        ...movedPlayer,
        rank: {
          id: toRankId,
          kind: promotion.toRankId as PlayerState["rank"]["kind"],
          index: movedPlayer.rank.index + 1,
        },
        resources: {
          ...movedPlayer.resources,
          [promotion.moneyKey]: {
            ...currentMoney,
            value: currentMoney.value - promotion.cost,
          },
        },
      };

      const promotedEvent: PlayerPromotedEvent = {
        ...eventMetadata(),
        type: "PlayerPromoted",
        payload: {
          playerId: updatedPlayer.id,
          fromRankId: createStableId("RankId", movedPlayer.rank.kind ?? promotion.toRankId),
          toRankId,
          cost: promotion.cost,
        },
      };
      allEvents.push(promotedEvent);

      if (promotion.isFinalRank) {
        outcome = {
          reason: "director-reached",
          winnerPlayerIds: [updatedPlayer.id],
          winningRole: null,
          endedAt: context.logicalTimestamp,
          data: {},
        };
        const matchEndedEvent: MatchEndedEvent = {
          ...eventMetadata(),
          type: "MatchEnded",
          payload: { outcome },
        };
        allEvents.push(matchEndedEvent);
      }
    }
  }

  const lastEvent = allEvents[allEvents.length - 1] ?? finalEvent;

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision,
        eventSequence: lastEvent.sequence,
        status: outcome !== null ? "ended" : state.status,
        outcome: outcome ?? state.outcome,
        players: { ...state.players, [player.id]: updatedPlayer },
        turn: {
          number: nextTurnNumber,
          round: nextRound,
          activePlayerId: nextPlayerId,
          phase: "pre-roll",
          startedAt: context.logicalTimestamp,
          deadlineAt: null,
        },
        rng: {
          streams: { ...state.rng.streams, dice: persistedStream },
        },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: allEvents,
    },
  };
}
