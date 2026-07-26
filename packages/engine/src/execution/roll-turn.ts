import type { BoardTile, TileDecisionConfig } from "@office-ladder/content";

import type { RollTurnCommand } from "../commands";
import { createEventMetadata } from "./events";
import type {
  CardDrawnEvent,
  EffectPreventedEvent,
  GameEvent,
  MatchEndedEvent,
  PlayerPromotedEvent,
  PromptOpenedEvent,
  ResourceChangedEvent,
  TurnStartedEvent,
} from "../events";
import {
  createStableId,
  type GameState,
  type MatchOutcome,
  type PlayerState,
  type PromptState,
  type TurnPhase,
} from "../model";
import { rollDie } from "../random";
import { moveAroundBoard } from "../rules";
import { createEphemeralRandom } from "./ephemeral-random";
import { rejectCommand } from "./errors";
import { resolveNextTurn, withBurnoutRecoveries } from "./next-turn";
import {
  consumeStatus,
  findActiveStatus,
  statusMovementPenalty,
  tickStatusTurns,
} from "./player-status";
import { resolvePromotion, type PromotionResolution } from "./roll-promotion";
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

function assertNeverTraceEntry(value: never): never {
  throw new TypeError(`Unsupported tile-effect trace entry: ${String(value)}`);
}

/**
 * Whether the player could still pay an open decision's `accept` cost once the
 * automatic promotion has taken its money. The offer's affordability is decided
 * during tile resolution, which happens *before* promotion, so without this the
 * promotion can quietly make an already-open offer unpayable.
 */
function affordsAfterPromotion(
  player: PlayerState,
  promotion: Extract<PromotionResolution, { readonly promoted: true }>,
  decision: TileDecisionConfig,
): boolean {
  const resource = player.resources[decision.accept.cost.resource];
  if (resource === undefined) return false;

  const spentOnPromotion =
    decision.accept.cost.resource === promotion.moneyKey ? promotion.cost : 0;

  return resource.value - spentOnPromotion >= decision.accept.cost.amount;
}

type PromptIds = {
  readonly decisionPointId: PromptState["id"];
  readonly frameId: PromptState["frameId"];
};

/**
 * Prompt and frame ids from server-owned state only.
 *
 * `sequence` is the event sequence the accompanying `PromptOpened` event will
 * carry — the game's own monotonic counter — so these ids are unique within the
 * game and re-derive identically on replay. They used to be built from the
 * client-supplied command id, which meant a client chose the id of a prompt the
 * server would then address to it, and could aim that id at another player's
 * prompt. `kind` is authored content, not client input; it is in the id purely
 * so a log line says what was asked.
 */
function promptIds(state: GameState, sequence: number, kind: string): PromptIds {
  return {
    decisionPointId: createStableId(
      "DecisionPointId",
      `${state.gameId}:prompt:${sequence}:${kind}`,
    ),
    frameId: createStableId("FrameId", `${state.gameId}:frame:${sequence}`),
  };
}

/**
 * A tile decision keeps the acting player on their own turn: they land, they
 * are asked, and only their answer ends the turn. That is the whole point of a
 * trade-off — asking them a full round later, as audit-release does (it opens
 * on landing but is answered on the player's *next* turn, because confinement
 * is a lasting condition rather than an offer), would make the choice
 * unreadable.
 */
function buildDecisionPrompt(
  ids: PromptIds,
  playerId: PlayerState["id"],
  decision: TileDecisionConfig,
): PromptState {
  return {
    id: ids.decisionPointId,
    frameId: ids.frameId,
    kind: decision.kind,
    audience: [playerId],
    // Decline is offered first and is the default: a consumer that has no
    // opinion (a timeout, a naive bot) must never spend a player's money.
    legalResponses: [
      { id: createStableId("PromptOptionId", decision.decline.optionId), value: null },
      { id: createStableId("PromptOptionId", decision.accept.optionId), value: null },
    ],
    deadlineAt: null,
    defaultResponse: {
      optionId: createStableId("PromptOptionId", decision.decline.optionId),
      value: null,
    },
    visibility: "public",
    responses: {},
  };
}

function buildAuditPrompt(ids: PromptIds, playerId: PlayerState["id"]): PromptState {
  return {
    id: ids.decisionPointId,
    frameId: ids.frameId,
    kind: "audit-release",
    audience: [playerId],
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
  };
}

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

  // Turn-start upkeep for turns-based statuses. The penalty is read *before*
  // ticking, so a status authored for N turns is in force on exactly N of this
  // player's own turns and is gone on the (N+1)th: reading after the tick would
  // silently cost the last turn of every duration. Only the acting player ticks,
  // which is what "for your next N turns" means; a turn spent answering an
  // audit-release prompt is not a rolled turn and does not tick.
  const movementPenalty = statusMovementPenalty(playerAfterMovementStatus);
  const playerAfterUpkeep = tickStatusTurns(playerAfterMovementStatus);

  // A penalty never stops a player dead: moving zero spaces would re-resolve
  // the tile they are already standing on.
  const spaces = Math.max(1, die + bonusSpaces - movementPenalty);
  const movement = moveAroundBoard({
    position: player.position,
    spaces,
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

  // Only look for the multiplier when a salary is actually being paid: the
  // status promises to multiply the *next* award, so a turn that awards nothing
  // must not consume it.
  const salaryMultiplierStatus =
    salary.amount > 0
      ? findActiveStatus(playerAfterUpkeep, "status.next-salary-multiplier")
      : null;
  const salaryMultiplier =
    salaryMultiplierStatus !== null && typeof salaryMultiplierStatus.data["multiplier"] === "number"
      ? salaryMultiplierStatus.data["multiplier"]
      : 1;
  const effectiveSalaryAmount = salary.amount * salaryMultiplier;
  const playerAfterSalaryStatus =
    salaryMultiplierStatus !== null
      ? consumeStatus(playerAfterUpkeep, "status.next-salary-multiplier")
      : playerAfterUpkeep;

  const landedTile: BoardTile | undefined = context.content.board.spaces.find(
    (tile) => tile.id === tileId,
  );
  const revision = state.revision + 1;
  const updatedMoney = salary.moneyResource.value + effectiveSalaryAmount;

  const movedPlayer: PlayerState = {
    ...playerAfterSalaryStatus,
    position: movement.destination,
    lapsCompleted: player.lapsCompleted + movement.laps,
    // Crossing the receptionist starts a new lap, which is exactly when a
    // per-lap passive allowance comes back.
    negativeEffectsIgnoredThisLap:
      movement.laps > 0 ? 0 : playerAfterSalaryStatus.negativeEffectsIgnoredThisLap,
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

  // Tile effects draw from a dedicated ephemeral source seeded from
  // server-owned canonical state — see ephemeral-random.ts. Deterministic and
  // replay-safe (the seed is a function of `state` alone) without perturbing the
  // persisted "dice" stream's cursor, which only ever advances once per die
  // roll, and without letting the client's command id pick the outcome.
  const tileEffectRandom = createEphemeralRandom(state, "tile-effects");
  const character = Object.values(context.content.characters).find(
    (candidate) => candidate.id === movedPlayer.characterId,
  );
  const tileOutcome =
    landedTile === undefined
      ? {
          player: movedPlayer,
          changes: [],
          trace: [],
          grantedExtraRoll: false,
          openAuditPrompt: false,
          openDecision: null,
          ignoredNegativeEffects: 0,
        }
      : resolveTileEffects(
          movedPlayer,
          landedTile.effects,
          tileEffectRandom,
          landedTile.kind,
          character?.passive,
          context.content.decks,
          landedTile.decision,
        );

  // Resolved up front (it is pure) so a promotion that ends the match can
  // suppress a prompt nobody would ever be able to answer.
  const promotionCandidate = resolvePromotion(tileOutcome.player, context.content, state.modeId);
  // An offer that opened as affordable has to stay payable until it is
  // answered, so the automatic promotion never spends money the player has just
  // been invited to spend. Where the two collide the promotion loses: it is
  // re-attempted on this player's very next roll (every roll attempts it), which
  // costs them one turn of rank, whereas letting it through would leave the
  // prompt advertising an `accept` branch that respond-to-prompt then refuses.
  // Reaching the final rank ends the match and withdraws the offer anyway, so
  // that case always takes priority over the offer.
  const promotion: PromotionResolution =
    promotionCandidate.promoted &&
    !promotionCandidate.isFinalRank &&
    tileOutcome.openDecision !== null &&
    !affordsAfterPromotion(tileOutcome.player, promotionCandidate, tileOutcome.openDecision)
      ? { promoted: false }
      : promotionCandidate;
  const matchEnds = promotion.promoted && promotion.isFinalRank;

  const openDecision = matchEnds ? null : tileOutcome.openDecision;
  const openAuditPrompt = !matchEnds && tileOutcome.openAuditPrompt;
  const decisionHoldsTurn = openDecision !== null;
  const nextPhase: TurnPhase = decisionHoldsTurn ? "prompt" : "pre-roll";

  // The walk is handed the actor's record as this roll leaves it — the tile may
  // have just charged them skipped turns or emptied their energy, and the walk
  // can reach them (see next-turn.ts).
  const nextTurn = resolveNextTurn(
    state,
    currentOrderIndex,
    tileOutcome.grantedExtraRoll || decisionHoldsTurn,
    command.actorId,
    tileOutcome.player,
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
    spaces,
    rngCursor,
    movement,
    salary,
    awardedSalary: effectiveSalaryAmount,
    tileId,
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

  for (const traceEntry of tileOutcome.trace) {
    switch (traceEntry.type) {
      case "card-drawn": {
        const cardDrawn: CardDrawnEvent = {
          ...eventMetadata(),
          type: "CardDrawn",
          payload: {
            playerId: tileOutcome.player.id,
            cardId: createStableId("CardDefinitionId", traceEntry.card.id),
            deckId: createStableId("DeckId", traceEntry.card.deckId),
            nameKey: traceEntry.card.nameKey,
          },
        };
        allEvents.push(cardDrawn);
        break;
      }
      case "resource-changed": {
        const resource = tileOutcome.player.resources[traceEntry.change.resource];
        if (resource === undefined) break;
        const resourceChanged: ResourceChangedEvent = {
          ...eventMetadata(),
          type: "ResourceChanged",
          payload: {
            playerId: tileOutcome.player.id,
            resourceId: resource.id,
            previousValue: traceEntry.change.previousValue,
            newValue: traceEntry.change.newValue,
            reason: "tile-effect",
          },
        };
        allEvents.push(resourceChanged);
        break;
      }
      case "negative-effect-ignored": {
        const { ignored } = traceEntry;
        // The sequence this event is about to be given. Same arithmetic as
        // `eventMetadata()`, evaluated before the push that would change it, so
        // the effect id and the event's own sequence always agree — and the id
        // comes from server-owned state rather than the client's command id.
        const preventedSequence = state.eventSequence + allEvents.length + 1;
        const effectPrevented: EffectPreventedEvent = {
          ...eventMetadata(),
          type: "EffectPrevented",
          payload: {
            effectId: createStableId(
              "EffectId",
              `${state.gameId}:effect-prevented:${preventedSequence}`,
            ),
            preventedByPlayerId: tileOutcome.player.id,
            sourceId: `passive:ignoreNegativeEffect:${ignored.origin}:${ignored.effectType}:${ignored.resource}:${ignored.amount}`,
          },
        };
        allEvents.push(effectPrevented);
        break;
      }
      default:
        assertNeverTraceEntry(traceEntry);
    }
  }

  // The sequence the PromptOpened event below will carry; nothing is pushed
  // between here and it, so the prompt's id and its event agree.
  const promptSequence = state.eventSequence + allEvents.length + 1;
  const prompt: PromptState | null = openAuditPrompt
    ? buildAuditPrompt(promptIds(state, promptSequence, "audit-release"), player.id)
    : openDecision !== null
      ? buildDecisionPrompt(
          promptIds(state, promptSequence, openDecision.kind),
          player.id,
          openDecision,
        )
      : null;

  if (prompt !== null) {
    const promptOpened: PromptOpenedEvent = {
      ...eventMetadata(),
      type: "PromptOpened",
      payload: { prompt },
    };
    allEvents.push(promptOpened);
  }

  // Burnout refills belong to the turn hand-off that just happened, so they are
  // reported after this turn's own work and immediately before the turn they
  // cost their holder. They consume no randomness: the dice cursor is already
  // fixed above and is not touched here.
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
      playerId: nextPlayerId,
      turnNumber: nextTurnNumber,
      round: nextRound,
      phase: nextPhase,
      deadlineAt: null,
    },
  };
  allEvents.push(turnStarted);

  // The promotion is layered on top of whatever the turn hand-off left the actor
  // holding (a skipTurns decrement or a burnout refill the walk granted them),
  // not on the pre-hand-off record: this value is what overwrites their entry in
  // the final player map, so building it from `tileOutcome.player` would undo the
  // walk's own bookkeeping for the actor.
  const actorAfterHandoff = nextTurn.players[command.actorId] ?? tileOutcome.player;
  let updatedPlayer = actorAfterHandoff;
  let outcome: MatchOutcome | null = null;

  if (promotion.promoted) {
    const currentReputation = actorAfterHandoff.resources[promotion.reputationKey];
    const currentMoney = actorAfterHandoff.resources[promotion.moneyKey];
    if (currentReputation !== undefined && currentMoney !== undefined) {
      const toRankId = createStableId("RankId", promotion.toRankId);
      updatedPlayer = {
        ...actorAfterHandoff,
        rank: {
          id: toRankId,
          kind: promotion.toRankId as PlayerState["rank"]["kind"],
          index: actorAfterHandoff.rank.index + 1,
        },
        resources: {
          ...actorAfterHandoff.resources,
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
          fromRankId: createStableId("RankId", actorAfterHandoff.rank.kind ?? promotion.toRankId),
          toRankId,
          cost: promotion.cost,
        },
      };
      allEvents.push(promotedEvent);

      // The promotion's money is a real resource mutation and has to be reported
      // as one. Without this the event stream is the only thing that disagrees
      // with canonical state anywhere in the engine: a read model folding
      // ResourceChanged (which is what `game_events` is for) ends every game
      // holding more money than the snapshot does, by exactly the sum of every
      // promotion ever paid — measurable at 20-30 divergences per match. Paired
      // with PlayerPromoted the same way SalaryAwarded is paired with its own
      // ResourceChanged, and skipped when a promotion is free, matching the
      // "no value changed, no event" rule the tile-effect walk already follows.
      if (promotion.cost > 0) {
        const promotionCharged: ResourceChangedEvent = {
          ...eventMetadata(),
          type: "ResourceChanged",
          payload: {
            playerId: updatedPlayer.id,
            resourceId: currentMoney.id,
            previousValue: currentMoney.value,
            newValue: currentMoney.value - promotion.cost,
            reason: "promotion-cost",
          },
        };
        allEvents.push(promotionCharged);
      }

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
        players: withBurnoutRecoveries(
          { ...nextTurn.players, [player.id]: updatedPlayer },
          nextTurn.burnoutRecoveries,
        ),
        prompts: prompt !== null ? [...state.prompts, prompt] : state.prompts,
        turn: {
          number: nextTurnNumber,
          round: nextRound,
          activePlayerId: nextPlayerId,
          phase: nextPhase,
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
