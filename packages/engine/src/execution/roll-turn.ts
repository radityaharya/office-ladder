import type { BoardTile, TileDecisionConfig } from "@office-ladder/content";

import type { RollTurnCommand } from "../commands";
import { createEventMetadata } from "./events";
import type {
  CardDrawnEvent,
  ClockDeckExhaustedEvent,
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
import { applyRollAgency, findResourceEntry } from "./agency";
import { expireAgreements } from "./agreements";
import {
  clockDeckExhaustionOutcome,
  clockDeckRemaining,
  isClockDeckExhausted,
  resolveClockDeckIds,
} from "./deck-depletion";
import { createEphemeralRandom } from "./ephemeral-random";
import { rejectCommand } from "./errors";
import { buildInvestigationPrompt } from "./heat";
import { resolveNextTurn, skipEliminatedNextTurn, withBurnoutRecoveries } from "./next-turn";
import { advanceObjectives } from "./objectives";
import { resolveLandingTriggers } from "./placements";
import {
  consumeStatus,
  findActiveStatus,
  statusMovementPenalty,
  tickStatusTurns,
} from "./player-status";
import { promotionIsAutomatic } from "./promotion-choice";
import { projectResourceEvents, resolveDueProjects } from "./projects";
import { activeQuarterModifiers, advanceQuarterForRound } from "./quarters";
import { concludeRoleWin } from "./roles";
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
import { evaluateMatchEnd, resolveScoringConfig, scoreMatch } from "./scoring";
import type { TransitionContent, TransitionContext, TransitionResult } from "./types";
import { refreshUpkeepForRank, settleRound } from "./upkeep";

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

/**
 * Apply the newly-reached rank's `increaseMaximumEnergy` benefits.
 *
 * The benefit has existed in the schema, the content pack (`rank.supervisor`,
 * `+2`) and the validator's mirror since the pack was first authored, and had
 * **no consumer anywhere in the engine** — a grep found it in exactly those
 * three places and nowhere that reads game state. This is that consumer.
 *
 * A promotion **widens the tank, it does not fill it**: `maximum` goes up and
 * `value` is left exactly where the player earned it. That is the whole point —
 * a Supervisor who has been grinding gets somewhere to put the energy that the
 * pack's `+energy` cards and `restoreResourceToMaximum` grant, rather than
 * having them silently discarded at a ceiling equal to their starting value.
 *
 * A null `maximum` means uncapped, so there is nothing to widen; the resource is
 * returned untouched rather than being given a finite ceiling it never had.
 *
 * No event is emitted. Every resource event in this engine reports a *value*
 * change (`previousValue`/`newValue`), and no value changes here — the same
 * "no value changed, no event" rule the tile-effect walk follows. A read model
 * rebuilding from `game_events` re-derives the ceiling from `PlayerPromoted`'s
 * `toRankId` plus the rank's own benefits, which is where it is authored.
 */
function widenEnergyMaximumForRank(
  player: PlayerState,
  content: TransitionContent,
  toRankId: string,
): PlayerState {
  const rank = content.ranks.find((candidate) => candidate.id === toRankId);
  if (rank === undefined) return player;

  const increase = rank.benefits.reduce(
    (total, benefit) => (benefit.type === "increaseMaximumEnergy" ? total + benefit.amount : total),
    0,
  );
  if (increase === 0) return player;

  const energy = findResourceEntry(player, "resource.energy");
  if (energy === null) return player;

  const [energyKey, energyResource] = energy;
  if (energyResource.maximum === null) return player;

  return {
    ...player,
    resources: {
      ...player.resources,
      [energyKey]: { ...energyResource, maximum: energyResource.maximum + increase },
    },
  };
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

/**
 * =========================================================================
 * THE TURN ORDER. Read this before changing anything below it.
 * =========================================================================
 *
 * Every gameplay-v2 mechanic hangs off one of these steps, and almost every
 * cross-mechanic bug in this codebase is two of them being run in the wrong
 * order. The order is:
 *
 *  1. **Turn start** — the acting player's turn begins. (The economy's charge
 *     for the round they are starting was applied by the *previous* command's
 *     hand-off, step 13; see the note there.)
 *  2. **Status tick** — `tickStatusTurns` ages the acting player's
 *     `duration.kind === "turns"` statuses. The movement penalty is read
 *     *before* the tick, so a status authored for N turns is in force on
 *     exactly N of this player's own turns.
 *  3. **Roll, with agency** — one die from the persisted `dice` stream, then
 *     `applyRollAgency` spends any reroll and any pips bought by an earlier
 *     `turn.adjust-roll`. The reroll draws from the *same* source, so the
 *     stream's cursor accounting stays honest.
 *  4. **Movement** — plus one-shot movement statuses, then salary if the
 *     receptionist was passed (scaled by `status.next-salary-multiplier` and by
 *     the active quarter's `salaryMultiplier`).
 *  5. **Tile effects** — the landed tile's authored effects.
 *  6. **Landing triggers** — the tile's *standing* charges: toll to the owner,
 *     then any placement waiting on the tile. After the tile's own effects,
 *     because effects are what the tile *is* and these are what other players
 *     have done *to* it.
 *  7. **Free action** — NOT here. `turn.action` is its own command
 *     (`free-action.ts`) taken during the pre-roll phase; it is in the turn
 *     order but not in this transition, which starts at the roll.
 *  8. **Promotion decision** — automatic only when
 *     `promotionIsAutomatic(rules)` and the quarter is not blocking
 *     promotions. Under `agency.promotionIsChoice` the player is offered
 *     `promotion.attempt` instead and nothing happens here.
 *  9. **Turn hand-off** — `resolveNextTurn`: skipTurns, burnout, eliminated
 *     seats. This is computed *before* steps 10-14 even though it is
 *     conceptually last, because it produces the round number every one of
 *     them keys off. Nothing it does is observable to them beyond that number
 *     and the player map it returns.
 * 10. **Project deadlines** — settled at the round now being entered; a
 *     project is due when the round passes its `deadlineRound`.
 * 11. **Quarter / global-event boundary** — one step at a time, resolving the
 *     arriving quarter's announced event and announcing the next.
 * 12. **Agreement expiry** — stale offers are swept to `expired`.
 * 13. **Economy settlement** — income, then interest, then upkeep, then
 *     bankruptcy, for the round being entered. This is step 1 of the *next*
 *     turn, which is why it is after the hand-off and not before it: the bill
 *     for round N is charged as the game enters round N.
 * 14. **Objectives** — re-measured against the table as every step above left
 *     it, so the turn that pushed a player over the line completes on that
 *     turn and not the one after.
 * 15. **Win check** — in precedence order: the race win (reaching Director,
 *     decided in step 8 because that is where the promotion happens), then
 *     `evaluateMatchEnd` (last-standing / objectives-complete /
 *     quarters-elapsed), then clock-deck exhaustion. Whichever fires is run
 *     through `concludeRoleWin`, which re-attributes it to the winning side and
 *     turns every role face up when `hidden.roleWinConditions` is on.
 * 16. **Turn end** — canonical state and the event list are committed.
 *
 * Every step from 6 onwards is inert under a ruleset that switches its mechanic
 * off, and every one of them reads that switch from `state.rules` — the
 * snapshot taken at game start — never from content and never from `modeId`.
 */
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
  const rawDie = rollDie(trackedRandom.source);

  // STEP 3 — agency. Everything this consumes was paid for on an earlier
  // command (energy for pips via `turn.adjust-roll`, a character activation for
  // the reroll), so it charges nothing and cannot reject. The reroll draws from
  // `trackedRandom.source`, the same persisted dice stream, so the cursor still
  // counts exactly the faces the match actually produced.
  const agency = applyRollAgency(player, rawDie, () => rollDie(trackedRandom.source));
  const die = agency.die;

  // Consume any one-shot "next roll" statuses (from applyStatus tile effects
  // on a *previous* turn) before resolving this roll's movement/salary.
  const extraMovementStatus = findActiveStatus(agency.player, "status.next-roll-extra-movement");
  const bonusSpaces =
    extraMovementStatus !== null && typeof extraMovementStatus.data["spaces"] === "number"
      ? extraMovementStatus.data["spaces"]
      : 0;
  const playerAfterMovementStatus =
    extraMovementStatus !== null
      ? consumeStatus(agency.player, "status.next-roll-extra-movement")
      : agency.player;

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
  // The quarter's own modifiers, read from the quarter the game is in *now* —
  // before step 11 moves the track on. A warning announced for the next quarter
  // must not already be halving this quarter's pay.
  const quarterModifiers = activeQuarterModifiers(state, context.content);
  // Rounding is applied only when a quarter is actually scaling pay, so a
  // neutral schedule (and every ruleset with quarters off) produces the exact
  // arithmetic this transition has always produced.
  const effectiveSalaryAmount =
    quarterModifiers.salaryMultiplier === 1
      ? salary.amount * salaryMultiplier
      : Math.round(salary.amount * salaryMultiplier * quarterModifiers.salaryMultiplier);
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

  // STEP 6 — landing triggers. Toll first, then placements (the ordering is
  // load-bearing and is argued in placements.ts). Both are inert when
  // `board.ownershipEnabled` / `board.placementsEnabled` are off, so this is a
  // pure pass-through in every ruleset that does not own the board.
  const landing = resolveLandingTriggers({
    state,
    lander: tileOutcome.player,
    tileId,
  });
  const landedPlayer = landing.lander;

  // STEP 8 — the promotion decision.
  //
  // `promotionIsAutomatic` is the switch, not a `modeId` comparison: a ruleset
  // with `agency.promotionIsChoice` hands the climb to the player as
  // `promotion.attempt`, and promoting them here as a side effect of landing on
  // a tile is precisely the decision that mode is trying to give them — it
  // would also let them be charged twice. A quarter that blocks promotions
  // suppresses it the same way, for the length of that quarter only.
  const promotionAllowed =
    promotionIsAutomatic(state.rules) && !quarterModifiers.promotionsBlocked;
  // Resolved up front (it is pure) so a promotion that ends the match can
  // suppress a prompt nobody would ever be able to answer.
  const promotionCandidate: PromotionResolution = promotionAllowed
    ? resolvePromotion(landedPlayer, context.content, state.modeId)
    : { promoted: false };
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
    !affordsAfterPromotion(landedPlayer, promotionCandidate, tileOutcome.openDecision)
      ? { promoted: false }
      : promotionCandidate;
  const matchEnds = promotion.promoted && promotion.isFinalRank;

  const openDecision = matchEnds ? null : tileOutcome.openDecision;
  const openAuditPrompt = !matchEnds && tileOutcome.openAuditPrompt;
  const decisionHoldsTurn = openDecision !== null;
  const nextPhase: TurnPhase = decisionHoldsTurn ? "prompt" : "pre-roll";

  // STEP 9 — the turn hand-off.
  //
  // The walk is handed the actor's record as this roll leaves it — the tile may
  // have just charged them skipped turns or emptied their energy, and the walk
  // can reach them (see next-turn.ts). It is also handed a state whose player
  // map already carries anyone the landing triggers paid or charged, so a toll
  // credited to a seat the walk then passes over is not silently reverted by the
  // walk's own rewrite of that record.
  const stateForHandoff: GameState =
    Object.keys(landing.players).length === 0
      ? state
      : { ...state, players: { ...state.players, ...landing.players } };
  const nextTurn = resolveNextTurn(
    stateForHandoff,
    currentOrderIndex,
    tileOutcome.grantedExtraRoll || decisionHoldsTurn,
    command.actorId,
    landedPlayer,
  );
  const nextTurnNumber = nextTurn.turnNumber;

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

  // Landing triggers report as `ResourceChanged` with their own `reason`
  // (`tile-toll`, `tile-toll-received`, `placement-*`). There is no
  // `TollPaid` / `PlacementTriggered` event type — `events/index.ts` is a shared
  // file this transition does not own — so the feed can say the money moved but
  // not yet who owned the tile. Emitted after the tile's own effects, matching
  // the order they resolved in.
  for (const change of landing.changes) {
    const landingChanged: ResourceChangedEvent = {
      ...eventMetadata(),
      type: "ResourceChanged",
      payload: {
        playerId: change.playerId,
        resourceId: change.resourceId,
        previousValue: change.previousValue,
        newValue: change.newValue,
        reason: change.reason,
      },
    };
    allEvents.push(landingChanged);
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

  // The promotion is layered on top of whatever the turn hand-off left the actor
  // holding (a skipTurns decrement or a burnout refill the walk granted them),
  // not on the pre-hand-off record: this value is what overwrites their entry in
  // the final player map, so building it from `landing.lander` would undo the
  // walk's own bookkeeping for the actor.
  const actorAfterHandoff = nextTurn.players[command.actorId] ?? landedPlayer;
  let updatedPlayer = actorAfterHandoff;
  let raceOutcome: MatchOutcome | null = null;

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
      // The economy seam. `agency.promotionRaisesUpkeep` is what makes climbing
      // a decision rather than a strictly-good move, and it does nothing at all
      // unless the new rank's row of `economy.upkeepByRankIndex` is actually
      // written onto the player here. A no-op when the flag — or upkeep itself —
      // is off.
      updatedPlayer = refreshUpkeepForRank(updatedPlayer, state.rules);

      // The other half of the new rank's benefits: `increaseMaximumEnergy`
      // widens the tank without filling it. Applied after the money deduction
      // and the upkeep refresh so it composes with whatever they left on the
      // record, and before the events below so `updatedPlayer` is final.
      updatedPlayer = widenEnergyMaximumForRank(updatedPlayer, context.content, promotion.toRankId);

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
        raceOutcome = {
          reason: "director-reached",
          winnerPlayerIds: [updatedPlayer.id],
          winningRole: null,
          endedAt: context.logicalTimestamp,
          data: {},
          // Reaching Director is the promotion win path by definition. The score
          // sheet is filled in below, once every round-boundary hook has had its
          // say — a payout landing on the same turn belongs in the totals.
          scores: [],
          winPath: "promotion",
        };
      }
    }
  }

  // =======================================================================
  // STEPS 10-14 — the round boundary.
  //
  // Every hook below is keyed off `nextTurn.round`, the round the game is
  // *entering*, and every one of them is idempotent at that round, so the
  // server re-injecting a boundary command cannot double-charge or double-pay.
  // They run against a `working` state that carries each previous hook's
  // output, because several of them read collections the ones before them
  // wrote: objectives measure tiles and projects, and the win check reads all
  // of it.
  // =======================================================================
  const playersAfterPromotion: Readonly<Record<string, PlayerState>> = withBurnoutRecoveries(
    { ...nextTurn.players, [player.id]: updatedPlayer },
    nextTurn.burnoutRecoveries,
  );
  let working: GameState = {
    ...state,
    players: playersAfterPromotion,
    tileOwnership: landing.tileOwnership,
    placements: landing.placements,
  };
  const boundaryPrompts: PromptState[] = [];

  // STEP 10 — project deadlines.
  const projectResolution = resolveDueProjects(working, nextTurn.round, {
    players: working.players,
  });
  if (projectResolution.resolved.length > 0) {
    allEvents.push(
      ...projectResourceEvents(
        state,
        command,
        context.logicalTimestamp,
        state.eventSequence + allEvents.length + 1,
        projectResolution.changes,
      ),
    );
    working = {
      ...working,
      players: projectResolution.players,
      projects: projectResolution.projects,
    };
    // A sabotage revealed at resolution can push its author over the heat
    // threshold. The prompt has to be opened by the transition that drove the
    // round forward, because that is what owns the event sequence — which is
    // exactly why `resolveDueProjects` reports the ids instead of opening them.
    for (const resolved of projectResolution.resolved) {
      for (const playerId of resolved.investigationPlayerIds) {
        const investigationSequence = state.eventSequence + allEvents.length + 1;
        const investigation = buildInvestigationPrompt(working, investigationSequence, playerId);
        boundaryPrompts.push(investigation);
        const opened: PromptOpenedEvent = {
          ...eventMetadata(),
          type: "PromptOpened",
          payload: { prompt: investigation },
        };
        allEvents.push(opened);
      }
    }
  }

  // STEP 11 — the quarter / global-event boundary.
  const quarterAdvance = advanceQuarterForRound(
    working,
    context.content,
    nextTurn.round,
    working.players,
  );
  if (quarterAdvance !== null) {
    for (const change of quarterAdvance.changes) {
      const globalChanged: ResourceChangedEvent = {
        ...eventMetadata(),
        type: "ResourceChanged",
        payload: {
          playerId: change.playerId,
          resourceId: change.resourceId,
          previousValue: change.previousValue,
          newValue: change.newValue,
          reason: `global-event:${change.globalEventId}`,
        },
      };
      allEvents.push(globalChanged);
    }
    working = {
      ...working,
      players: quarterAdvance.players,
      quarters: quarterAdvance.quarters,
      currentQuarterIndex: quarterAdvance.currentQuarterIndex,
    };
  }

  // STEP 12 — agreement expiry. Cosmetic in the sense that `respondToAgreement`
  // independently refuses an acceptance past `expiresAtRound`; this is what
  // makes a dead offer *look* dead in a projection instead of lingering as
  // `offered` forever.
  const afterAgreements = expireAgreements(working, nextTurn.round);
  if (afterAgreements !== working) {
    working = { ...working, agreements: afterAgreements.agreements };
  }

  // STEP 13 — the economy: income, interest, upkeep, bankruptcy.
  const settlement = settleRound(working, {
    round: nextTurn.round,
    players: working.players,
    content: context.content,
  });
  if (settlement.settled) {
    for (const change of settlement.changes) {
      const settled: ResourceChangedEvent = {
        ...eventMetadata(),
        type: "ResourceChanged",
        payload: {
          playerId: change.playerId,
          resourceId: change.resourceId,
          previousValue: change.previousValue,
          newValue: change.newValue,
          reason: change.reason,
        },
      };
      allEvents.push(settled);
    }
    working = {
      ...working,
      players: settlement.players,
      eliminatedPlayerIds: settlement.eliminatedPlayerIds,
    };
  }

  // The hand-off ran before the settlement (it had to — the settlement needs the
  // round the hand-off produced), so a seat bankrupted out of the match this
  // instant may still be holding the turn it just granted. This is the one
  // correction, and it is deliberately not a second walk; see next-turn.ts.
  const handoff = skipEliminatedNextTurn(
    stateForHandoff,
    nextTurn,
    settlement.newlyEliminatedPlayerIds,
  );
  const nextPlayerId = handoff.nextPlayerId;
  const nextRound = handoff.round;

  // STEP 14 — objectives, measured against the table as every hook above left
  // it, so the turn that pushed a player over the line is the turn it completes
  // on.
  const objectiveProgress = advanceObjectives(working, nextRound, working.players);
  if (objectiveProgress.completed.length > 0 || objectiveProgress.changes.length > 0) {
    for (const change of objectiveProgress.changes) {
      const rewarded: ResourceChangedEvent = {
        ...eventMetadata(),
        type: "ResourceChanged",
        payload: {
          playerId: change.playerId,
          resourceId: change.resourceId,
          previousValue: change.previousValue,
          newValue: change.newValue,
          reason: "objective-reward",
        },
      };
      allEvents.push(rewarded);
    }
  }
  working = {
    ...working,
    players: objectiveProgress.players,
    objectives: objectiveProgress.objectives,
  };

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

  // =======================================================================
  // STEP 15 — the win check.
  //
  // Precedence: the race win first (it happened during this turn, not at its
  // boundary), then everything `evaluateMatchEnd` decides, then the clock deck.
  // Exactly one outcome can be produced, and whichever it is goes through
  // `concludeRoleWin`, which re-attributes it to the winning side and turns
  // every role face up — but only when `hidden.roleWinConditions` says roles are
  // playing for something. It returns the outcome untouched otherwise.
  // =======================================================================
  const scoringConfig = resolveScoringConfig(context.content, state.modeId);
  const clockDeckIds = resolveClockDeckIds(working, context.content);
  const clockExhausted = isClockDeckExhausted(working.decks, clockDeckIds);

  let outcome: MatchOutcome | null =
    raceOutcome === null
      ? null
      : { ...raceOutcome, scores: scoreMatch(working, scoringConfig) };
  if (outcome === null) {
    outcome = evaluateMatchEnd(working, context.content, {
      round: nextRound,
      endedAt: context.logicalTimestamp,
      config: scoringConfig,
    });
  }
  if (outcome === null && clockExhausted) {
    outcome = clockDeckExhaustionOutcome(working, clockDeckIds, context.logicalTimestamp);
  }

  if (clockExhausted) {
    const remaining = clockDeckRemaining(working.decks, clockDeckIds);
    const exhausted: ClockDeckExhaustedEvent = {
      ...eventMetadata(),
      type: "ClockDeckExhausted",
      payload: {
        remainingMeetingCards: remaining.remainingMeetingCards,
        remainingEventCards: remaining.remainingEventCards,
      },
    };
    allEvents.push(exhausted);
  }

  if (outcome !== null) {
    const concluded = concludeRoleWin(working, outcome);
    working = concluded.state;
    outcome = concluded.outcome;

    const matchEndedEvent: MatchEndedEvent = {
      ...eventMetadata(),
      type: "MatchEnded",
      payload: { outcome },
    };
    allEvents.push(matchEndedEvent);
  }

  // STEP 16 — turn end.
  const lastEvent = allEvents[allEvents.length - 1] ?? finalEvent;
  const openPrompts: readonly PromptState[] =
    prompt === null && boundaryPrompts.length === 0
      ? state.prompts
      : [...state.prompts, ...(prompt === null ? [] : [prompt]), ...boundaryPrompts];

  return {
    ok: true,
    value: {
      state: {
        ...working,
        revision,
        eventSequence: lastEvent.sequence,
        status: outcome !== null ? "ended" : state.status,
        outcome: outcome ?? state.outcome,
        prompts: openPrompts,
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
