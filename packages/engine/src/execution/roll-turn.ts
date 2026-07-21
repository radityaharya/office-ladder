import type { RollTurnCommand } from "../commands";
import { createEventMetadata } from "./events";
import type {
  GameEvent,
  MatchEndedEvent,
  PlayerPromotedEvent,
  ResourceChangedEvent,
} from "../events";
import {
  createStableId,
  type GameState,
  type MatchOutcome,
  type PlayerState,
  type PromptState,
} from "../model";
import { createSeededRandomSource, rollDie } from "../random";
import { moveAroundBoard } from "../rules";
import { rejectCommand } from "./errors";
import { resolveNextTurn } from "./next-turn";
import { consumeStatus, findActiveStatus } from "./player-status";
import { resolvePromotion } from "./roll-promotion";
import { resolveTileEffects } from "./resolve-tile-effects";
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
    state.pendingEffects.length > 0 ||
    state.reactionWindows.length > 0 ||
    state.prompts.some((prompt) => prompt.audience.includes(command.actorId))
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

  // Consume any one-shot "next roll" statuses (from applyStatus tile effects
  // on a *previous* turn) before resolving this roll's movement/salary.
  const extraMovementStatus = findActiveStatus(player, "status.next-roll-extra-movement");
  const bonusSpaces =
    extraMovementStatus !== null && typeof extraMovementStatus.data["spaces"] === "number"
      ? extraMovementStatus.data["spaces"]
      : 0;
  const playerAfterMovementStatus =
    extraMovementStatus !== null
      ? consumeStatus(player, "status.next-roll-extra-movement")
      : player;

  const movement = moveAroundBoard({
    position: player.position,
    spaces: die + bonusSpaces,
    boardSize: state.boardSize,
    receptionistIndex,
  });
  const nextOrderIndex = (currentOrderIndex + 1) % state.playerOrder.length;
  const naturalNextPlayerId = state.playerOrder[nextOrderIndex];
  const tileId = state.tileIds[movement.destination];
  if (naturalNextPlayerId === undefined || tileId === undefined) {
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

  const salaryMultiplierStatus = findActiveStatus(
    playerAfterMovementStatus,
    "status.next-salary-multiplier",
  );
  const salaryMultiplier =
    salaryMultiplierStatus !== null && typeof salaryMultiplierStatus.data["multiplier"] === "number"
      ? salaryMultiplierStatus.data["multiplier"]
      : 1;
  const effectiveSalaryAmount = salary.amount * salaryMultiplier;
  const playerAfterSalaryStatus =
    salaryMultiplierStatus !== null
      ? consumeStatus(playerAfterMovementStatus, "status.next-salary-multiplier")
      : playerAfterMovementStatus;

  const landedTile = context.content.board.spaces.find((tile) => tile.id === tileId);
  const revision = state.revision + 1;
  const updatedMoney = salary.moneyResource.value + effectiveSalaryAmount;

  const movedPlayer: PlayerState = {
    ...playerAfterSalaryStatus,
    position: movement.destination,
    lapsCompleted: player.lapsCompleted + movement.laps,
    resources:
      effectiveSalaryAmount > 0
        ? {
            ...playerAfterSalaryStatus.resources,
            [salary.moneyKey]: {
              ...salary.moneyResource,
              value: updatedMoney,
            },
          }
        : playerAfterSalaryStatus.resources,
  };

  // Tile effects draw from a dedicated, ephemeral source seeded by the
  // command id — deterministic and replay-safe (the same command always
  // re-derives the same seed) without perturbing the persisted "dice"
  // stream's cursor, which only ever advances once per die roll.
  const tileEffectRandom = createSeededRandomSource(command.commandId);
  const character = Object.values(context.content.characters).find(
    (candidate) => candidate.id === movedPlayer.characterId,
  );
  const tileOutcome =
    landedTile === undefined
      ? { player: movedPlayer, changes: [], grantedExtraRoll: false, openAuditPrompt: false }
      : resolveTileEffects(
          movedPlayer,
          landedTile.effects,
          tileEffectRandom,
          landedTile.kind,
          character?.passive,
        );

  const nextTurn = resolveNextTurn(
    state,
    currentOrderIndex,
    tileOutcome.grantedExtraRoll,
    command.actorId,
  );
  const nextPlayerId = nextTurn.nextPlayerId;
  const nextTurnNumber = nextTurn.turnNumber;
  const nextRound = nextTurn.round;

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

  const allEvents: GameEvent[] = [...events];
  const eventMetadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + allEvents.length + 1,
    );

  for (const change of tileOutcome.changes) {
    const resource = tileOutcome.player.resources[change.resource];
    if (resource === undefined) continue;
    const resourceChanged: ResourceChangedEvent = {
      ...eventMetadata(),
      type: "ResourceChanged",
      payload: {
        playerId: tileOutcome.player.id,
        resourceId: resource.id,
        previousValue: change.previousValue,
        newValue: change.newValue,
        reason: "tile-effect",
      },
    };
    allEvents.push(resourceChanged);
  }

  const promotion = resolvePromotion(tileOutcome.player, context.content, state.modeId);

  let updatedPlayer = tileOutcome.player;
  let outcome: MatchOutcome | null = null;

  if (promotion.promoted) {
    const currentReputation = tileOutcome.player.resources[promotion.reputationKey];
    const currentMoney = tileOutcome.player.resources[promotion.moneyKey];
    if (currentReputation !== undefined && currentMoney !== undefined) {
      const toRankId = createStableId("RankId", promotion.toRankId);
      updatedPlayer = {
        ...tileOutcome.player,
        rank: {
          id: toRankId,
          kind: promotion.toRankId as PlayerState["rank"]["kind"],
          index: tileOutcome.player.rank.index + 1,
        },
        resources: {
          ...tileOutcome.player.resources,
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
          fromRankId: createStableId("RankId", tileOutcome.player.rank.kind ?? promotion.toRankId),
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

  const auditPrompt: PromptState | null = tileOutcome.openAuditPrompt
    ? {
        id: createStableId("DecisionPointId", `${command.commandId}:audit`),
        frameId: createStableId("FrameId", `${command.commandId}:frame`),
        kind: "audit-release",
        audience: [updatedPlayer.id],
        legalResponses: [
          { id: createStableId("PromptOptionId", "pay-fine"), value: null },
          { id: createStableId("PromptOptionId", "attempt-roll"), value: null },
        ],
        deadlineAt: null,
        defaultResponse: {
          optionId: createStableId("PromptOptionId", "attempt-roll"),
          value: null,
        },
        visibility: "public",
        responses: {},
      }
    : null;

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision,
        eventSequence: lastEvent.sequence,
        status: outcome !== null ? "ended" : state.status,
        outcome: outcome ?? state.outcome,
        players: { ...nextTurn.players, [player.id]: updatedPlayer },
        prompts: auditPrompt !== null ? [...state.prompts, auditPrompt] : state.prompts,
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
