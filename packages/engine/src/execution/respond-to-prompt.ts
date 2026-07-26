import type { BoardTile, TileDecisionConfig } from "@office-ladder/content";

import type { RespondToPromptCommand } from "../commands";
import { createEventMetadata } from "./events";
import type {
  DiceRolledEvent,
  EffectProposedEvent,
  GameEvent,
  ResourceChangedEvent,
  TurnStartedEvent,
} from "../events";
import type { GameState, PlayerState, PromptResponse, PromptState } from "../model";
import { createStableId } from "../model";
import { rollDie } from "../random";
import { createEphemeralRandom, ephemeralRandomStreamName } from "./ephemeral-random";
import { rejectCommand } from "./errors";
import {
  HEAT_INVESTIGATION_PROMPT_KIND,
  resolveInvestigationResponse,
} from "./heat";
import { resolveNextTurn, withBurnoutRecoveries } from "./next-turn";
import { applyEffectDescriptors, matchRollOutcome } from "./resolve-tile-effects";
import type { TransitionContext, TransitionResult } from "./types";

const AUDIT_FINE = 500;

/** The confinement-release choice opened by the board's audit corner tile. */
const AUDIT_RELEASE_PROMPT_KIND = "audit-release";

type EventMetadata = () => Omit<GameEvent, "type" | "payload">;

type Resolution = {
  readonly player: PlayerState;
  /**
   * A prompt that stays open leaves the player facing the same question on
   * their next turn — a failed audit-release attempt, never a decision the
   * player actually answered.
   */
  readonly keepPromptOpen: boolean;
  /**
   * Answering this prompt is what the responder's turn was *for*, so the turn
   * hands off once they have answered.
   *
   * Only ever acted on when the responder actually holds the turn: a prompt
   * addressed to somebody who is not the active player (spec §7.3 — reactions,
   * ballots, trades and the chosen-opponent prompt all land on other seats) has
   * no turn of its own to end, and ending the *active* player's turn on their
   * behalf would let any audience member burn a turn that is not theirs.
   */
  readonly endsTurn: boolean;
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
      endsTurn: true,
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
    return {
      ok: true,
      value: { player: declined.player, keepPromptOpen: false, endsTurn: true },
    };
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

  return {
    ok: true,
    value: { player: applied.player, keepPromptOpen: false, endsTurn: true },
  };
}

/**
 * The `heat-investigation` prompt raised when an aggressor crosses
 * `conflict.heatThreshold` (see heat.ts, which owns both branches).
 *
 * The first prompt kind wired here that is **not** turn-bound. Its producers are
 * `attack.target`, `project.sabotage` and — the case that matters — the
 * round-boundary project resolution inside `roll-turn.ts`, which raises it on
 * whoever authored a sabotage that just came due. That author is almost never
 * the player whose turn it is, so under the old active-player check the prompt
 * was unanswerable and, because `applyCommand`'s pending-work guard blocks every
 * non-exempt command while a prompt is addressed to you, it sat on that seat.
 */
function resolveHeatInvestigation(
  state: GameState,
  player: PlayerState,
  optionId: string,
  events: GameEvent[],
  eventMetadata: EventMetadata,
): ResolutionResult {
  const resolved = resolveInvestigationResponse(state, player, optionId);
  if (resolved === null) {
    return {
      ok: false,
      error: {
        code: "ILLEGAL_ACTION",
        message: "Option is not one of this investigation's branches",
      },
    };
  }

  emitResourceEvents(
    resolved.player,
    resolved.changes,
    "heat-investigation",
    events,
    eventMetadata,
  );

  return {
    ok: true,
    value: {
      player: resolved.player,
      keepPromptOpen: resolved.keepPromptOpen,
      // Answering still costs the attacker the turn they are holding when they
      // hold one; raised on a seat that is not active, both branches already
      // carry their own price (a skipped turn, or the reputation the reprimand
      // docks) and no turn of anybody else's is spent.
      endsTurn: true,
    },
  };
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

/**
 * Whether a prompt kind may only be answered by the player holding the turn.
 *
 * This is **not** the authorisation check — `prompt.audience` is (see
 * `respondToPrompt`). It is a rules check about two specific kinds whose whole
 * cost is the turn they consume:
 *
 * - `audit-release`. The prompt outlives the turn it opened on (the roll that
 *   landed on the audit tile hands off while the prompt stays open), so without
 *   this a confined player could pay the fine — or, far worse, re-roll
 *   `attempt-roll` over and over, since a failed attempt deliberately leaves the
 *   prompt open — during somebody else's turn and buy their way out for free.
 * - an authored tile decision. `roll-turn.ts` holds the roller's turn open at
 *   phase `"prompt"` precisely so answering *is* that turn.
 *
 * Every other kind — reactions, ballots, trades, the chosen-opponent prompt, the
 * heat investigation raised at a round boundary — is by design something a
 * player answers while it is not their turn, which is what `PromptState.audience`
 * being a list has always meant.
 */
function promptIsTurnBound(promptKind: string, tileDecision: TileDecisionConfig | null): boolean {
  return promptKind === AUDIT_RELEASE_PROMPT_KIND || tileDecision?.kind === promptKind;
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
  // **The authorisation check.** `PromptState.audience` is a list because a
  // prompt is not a single-audience thing (spec §7.3): every reaction window,
  // vote, trade offer and chosen-opponent prompt is raised on somebody who is
  // not the active player, and an active-player check forbade all of them.
  if (!prompt.audience.includes(command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Actor is not part of this prompt's audience",
    });
  }
  // One answer each. Without this a multi-audience prompt could be carried by
  // one player answering N times, which is the ballot-stuffing shape of the
  // same attack §6.3 names.
  if (Object.hasOwn(prompt.responses, command.actorId)) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_STALE",
      message: "The actor has already answered this prompt",
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

  const decision = findTileDecision(state, context, player);
  const holdsTurn = state.turn.activePlayerId === command.actorId;
  if (!holdsTurn && promptIsTurnBound(prompt.kind, decision)) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "This prompt is answered on the actor's own turn",
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

  const resolution: ResolutionResult =
    prompt.kind === AUDIT_RELEASE_PROMPT_KIND
      ? resolveAuditRelease(state, player, String(option.id), allEvents, eventMetadata)
      : prompt.kind === HEAT_INVESTIGATION_PROMPT_KIND
        ? resolveHeatInvestigation(state, player, String(option.id), allEvents, eventMetadata)
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

  // A response only ever hands the turn on when the responder is the one holding
  // it. Answering from the audience of somebody else's prompt must not move the
  // active player, reset the turn counter, or spend a turn that is not the
  // responder's to spend.
  const handsOff = resolution.value.endsTurn && holdsTurn;
  const turnPatch = handsOff
    ? endTurn(state, command, context, resolution.value.player, allEvents, eventMetadata)
    : answerInPlace(state, command, resolution.value.player, allEvents, eventMetadata, option.id);

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
        ...turnPatch,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        prompts: settlePrompt(state, prompt, command, option.id, resolution.value.keepPromptOpen),
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: allEvents,
    },
  };
}

/**
 * The prompt list after this answer.
 *
 * Three cases, and the first is why the responses map is not written
 * unconditionally: a failed `attempt-roll` deliberately leaves the *same*
 * question open, so recording it as answered would lock the player in
 * confinement permanently against the duplicate-response guard above. A prompt
 * with more than one audience member survives until every one of them has
 * answered, which is what makes `responses` a map rather than a flag.
 */
function settlePrompt(
  state: GameState,
  prompt: PromptState,
  command: RespondToPromptCommand,
  optionId: PromptState["legalResponses"][number]["id"],
  keepPromptOpen: boolean,
): readonly PromptState[] {
  if (keepPromptOpen) return state.prompts;

  const response: PromptResponse = { optionId, value: command.payload.value };
  const responses = { ...prompt.responses, [command.actorId]: response };
  if (prompt.audience.every((playerId) => Object.hasOwn(responses, playerId))) {
    return state.prompts.filter((candidate) => candidate.id !== prompt.id);
  }

  return state.prompts.map((candidate) =>
    candidate.id === prompt.id ? { ...candidate, responses } : candidate,
  );
}

/** The hand-off half of a response that was the responder's turn. */
function endTurn(
  state: GameState,
  command: RespondToPromptCommand,
  context: TransitionContext,
  resolved: PlayerState,
  allEvents: GameEvent[],
  eventMetadata: EventMetadata,
): Partial<GameState> {
  const currentOrderIndex = state.playerOrder.indexOf(command.actorId);
  // As in roll-turn.ts, the walk gets the actor's record as this response leaves
  // it — an answer can move money and can release confinement, and the walk is
  // able to reach the actor themselves (see next-turn.ts).
  const nextTurn = resolveNextTurn(
    state,
    currentOrderIndex,
    false,
    command.actorId,
    resolved,
  );
  const updatedPlayer = nextTurn.players[command.actorId] ?? resolved;

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

  return {
    players: withBurnoutRecoveries(
      { ...nextTurn.players, [command.actorId]: updatedPlayer },
      nextTurn.burnoutRecoveries,
    ),
    turn: {
      number: nextTurn.turnNumber,
      round: nextTurn.round,
      activePlayerId: nextTurn.nextPlayerId,
      phase: "pre-roll",
      startedAt: context.logicalTimestamp,
      deadlineAt: null,
    },
  };
}

/**
 * An answer from somebody who is not holding the turn.
 *
 * The turn is left exactly as it was, and a marker event carries the answer so
 * the response is on the wire even when it moved no resource — every transition
 * has to emit at least one event, and silently succeeding would leave the feed
 * unable to say the prompt was answered at all.
 */
function answerInPlace(
  state: GameState,
  command: RespondToPromptCommand,
  resolved: PlayerState,
  allEvents: GameEvent[],
  eventMetadata: EventMetadata,
  optionId: PromptState["legalResponses"][number]["id"],
): Partial<GameState> {
  const sequence = state.eventSequence + allEvents.length + 1;
  const answered: EffectProposedEvent = {
    ...eventMetadata(),
    type: "EffectProposed",
    payload: {
      effectId: createStableId("EffectId", `${state.gameId}:effect:${sequence}`),
      affectedPlayerIds: [command.actorId],
      effect: {
        kind: "prompt.respond",
        decisionPointId: command.decisionPointId as string,
        optionId: optionId as string,
      },
    },
  };
  allEvents.push(answered);

  return { players: { ...state.players, [command.actorId]: resolved } };
}
