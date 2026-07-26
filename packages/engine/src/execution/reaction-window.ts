import type { EffectDescriptor } from "@office-ladder/content";

import type {
  ExpireWindowCommand,
  GameCommand,
  PassReactionCommand,
  PlayReactionCommand,
} from "../commands";
import type {
  CardPlayedEvent,
  EffectPreventedEvent,
  EffectProposedEvent,
  GameEvent,
  ReactionWindowOpenedEvent,
  ResourceChangedEvent,
} from "../events";
import {
  createStableId,
  type CardState,
  type DecisionPointId,
  type DeckState,
  type GameState,
  type LogicalTimestamp,
  type PendingEffectState,
  type PlayerId,
  type PlayerState,
  type ReactionWindowState,
  type ResolutionFrame,
  type TurnPhase,
} from "../model";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import {
  applyPendingEffect,
  createPendingEffect,
  orderedPlayerIds,
  preventionRandomSource,
} from "./prevent-effect";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Reaction windows — plans/24-gameplay-v2-spec.md §7.1, §10.2, §10.3.
 *
 * The fix for the game's worst structural problem: "for five turns out of six a
 * player is a spectator by design". A `preventable` effect no longer lands where
 * it is raised. It is proposed (see prevent-effect.ts) and a window opens over
 * the players entitled to answer it; each may `reaction.play` or
 * `reaction.pass`, and the window closes when **all of them have responded** or
 * when the server injects `window.expire`.
 *
 * `ReactionWindowState` — id, frameId, kind, eligible/priority/passed/played,
 * deadlineAt, pendingEffectId — has been modelled since the first engine commit
 * and had never been populated once. So had the `"open-reaction-window"`
 * `FrameKind`. This module populates all of them.
 *
 * ## The clock
 *
 * The engine writes `deadlineAt` and takes **no further interest**. There is no
 * timer here and no clock read: the deadline is arithmetic on the
 * `logicalTimestamp` the caller already supplies, and the server owns the
 * scheduler that fires at it and submits `window.expire` through the ordinary
 * command path (§7.1). A missed fire is recoverable because
 * {@link expiredReactionWindows} lets the server find, on load, every window
 * whose deadline has already passed and drain it the same way.
 *
 * ## Determinism
 *
 * Every player walk goes through `state.playerOrder`. Response lists are stored
 * in that order rather than in arrival order, so two servers that received the
 * same responses in different orders hold byte-identical state, and the
 * repository's `JSON.parse(JSON.stringify(…))` boundary cannot reorder them into
 * a different outcome.
 */

const MS_PER_SECOND = 1_000;
const MS_PER_DAY = 86_400_000;
/** Days from 0000-03-01 (the civil-calendar epoch used below) to 1970-01-01. */
const DAYS_TO_UNIX_EPOCH = 719_468;

/**
 * Civil date from a day count since the Unix epoch (Howard Hinnant's
 * `civil_from_days`, which is exact for every date this game can reach).
 *
 * Hand-rolled on purpose. Formatting through `new Date(ms).toISOString()` would
 * be equally deterministic, but `new Date` is the exact construct AGENTS.md's
 * engine-purity rule names, and a rule that has to be argued about at every call
 * site is not a rule. This keeps the engine's `Date` surface at
 * `Date.parse(iso)` — a pure, spec-defined string-to-number function that reads
 * no clock.
 */
function civilFromDays(days: number): readonly [number, number, number] {
  const shifted = days + DAYS_TO_UNIX_EPOCH;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthProxy = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthProxy + 2) / 5) + 1;
  const month = monthProxy + (monthProxy < 10 ? 3 : -9);

  return [year + (month <= 2 ? 1 : 0), month, day];
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function utcIsoFromEpochMs(epochMs: number): string {
  const days = Math.floor(epochMs / MS_PER_DAY);
  const msOfDay = epochMs - days * MS_PER_DAY;
  const [year, month, day] = civilFromDays(days);
  const millisecond = msOfDay % MS_PER_SECOND;
  const totalSeconds = (msOfDay - millisecond) / MS_PER_SECOND;
  const second = totalSeconds % 60;
  const totalMinutes = (totalSeconds - second) / 60;
  const minute = totalMinutes % 60;
  const hour = (totalMinutes - minute) / 60;

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(millisecond, 3)}Z`;
}

/**
 * When a window opened at `from` stops accepting responses.
 *
 * A pure function of its two arguments — the caller's own logical timestamp and
 * a tunable read from `rules.interaction.reactionWindowSeconds`. Returns `null`
 * only when `from` is not a timestamp anything can parse, which leaves the
 * window with no deadline rather than inventing one; the server can still drain
 * it explicitly.
 *
 * A non-positive `reactionWindowSeconds` yields a deadline equal to `from`,
 * i.e. one that has already passed. That is deliberately *not* "no deadline": a
 * mode configured with a zero-second window means "nobody gets time to react",
 * and the recovery path resolves it on the very next pass instead of leaving it
 * open forever.
 */
export function reactionWindowDeadline(
  from: LogicalTimestamp,
  seconds: number,
): LogicalTimestamp | null {
  const fromMs = Date.parse(from);
  if (!Number.isFinite(fromMs)) return null;

  const offsetMs = Math.max(0, Math.round(seconds)) * MS_PER_SECOND;

  return utcIsoFromEpochMs(fromMs + offsetMs);
}

/**
 * Every turn phase, as a total map so a phase added to the model is a compile
 * error here rather than a silently unrestorable resume point.
 */
const TURN_PHASES: Readonly<Record<TurnPhase, true>> = {
  "not-started": true,
  "turn-start": true,
  audit: true,
  "pre-roll": true,
  roll: true,
  "post-roll": true,
  movement: true,
  "tile-resolution": true,
  prompt: true,
  reaction: true,
  promotion: true,
  "turn-end": true,
  "game-over": true,
};

/** The phase the turn returns to once the window closes. */
const RESUME_PHASE_KEY = "resumePhase";

// ---------------------------------------------------------------------------
// Reading windows
// ---------------------------------------------------------------------------

export function findReactionWindow(
  state: GameState,
  decisionPointId: DecisionPointId,
): ReactionWindowState | null {
  return state.reactionWindows.find((window) => window.id === decisionPointId) ?? null;
}

export function hasRespondedToReactionWindow(
  window: ReactionWindowState,
  playerId: PlayerId,
): boolean {
  return (
    window.passedPlayerIds.includes(playerId) || window.playedByPlayerIds.includes(playerId)
  );
}

/** Whether every eligible player has answered, which is what closes a window. */
export function isReactionWindowResolved(window: ReactionWindowState): boolean {
  return window.eligiblePlayerIds.every((playerId) =>
    hasRespondedToReactionWindow(window, playerId),
  );
}

/**
 * The windows this player still owes an answer to.
 *
 * The hook `legal-actions.ts` needs: a player with an entry here has
 * `reaction.play` / `reaction.pass` available **out of turn**, which is the
 * entire point of the mechanic. Do not gate it on `turn.activePlayerId`.
 */
export function openReactionWindowsFor(
  state: GameState,
  playerId: PlayerId,
): readonly ReactionWindowState[] {
  return state.reactionWindows.filter(
    (window) =>
      window.eligiblePlayerIds.includes(playerId) &&
      !hasRespondedToReactionWindow(window, playerId),
  );
}

/**
 * Every window whose deadline has already passed at `now`.
 *
 * The recoverable half of §7.1. `now` is the *caller's* clock — the server
 * passes its own wall clock at load — so this stays a pure function of its
 * arguments and the engine never reads a clock itself. The server turns each
 * returned window into a `window.expire` command through the ordinary command
 * path; nothing here mutates anything.
 */
export function expiredReactionWindows(
  state: GameState,
  now: LogicalTimestamp,
): readonly ReactionWindowState[] {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return [];

  return state.reactionWindows.filter((window) => {
    if (window.deadlineAt === null) return false;
    const deadlineMs = Date.parse(window.deadlineAt);

    return Number.isFinite(deadlineMs) && deadlineMs <= nowMs;
  });
}

/**
 * Which player is credited with preventing the effect when several played.
 *
 * Walks `playerOrder` starting from `priorityPlayerId`'s seat, so priority is a
 * real, deterministic tie-break rather than decoration — and never "whoever's
 * HTTP request landed first", which would make the outcome depend on network
 * timing and would not replay.
 */
export function reactionWindowPreventerId(
  state: GameState,
  window: ReactionWindowState,
): PlayerId | null {
  if (window.playedByPlayerIds.length === 0) return null;

  const order = state.playerOrder;
  const priorityIndex =
    window.priorityPlayerId === null ? -1 : order.indexOf(window.priorityPlayerId);
  const start = priorityIndex < 0 ? 0 : priorityIndex;

  for (let step = 0; step < order.length; step += 1) {
    const candidate = order[(start + step) % order.length];
    if (candidate !== undefined && window.playedByPlayerIds.includes(candidate)) {
      return candidate;
    }
  }

  return window.playedByPlayerIds[0] ?? null;
}

/**
 * Whether this actor is the server rather than a seat at the table.
 *
 * `window.expire` is server-injected only (§7.1), but `CommandEnvelope.actorId`
 * is typed as a `PlayerId`, so "not a player" is the only honest test — and it
 * is the right one: the property that matters is that no seat at the table can
 * close a window early, whatever id the server happens to inject under.
 */
export function isServerInjectedActor(state: GameState, actorId: PlayerId): boolean {
  return state.players[actorId] === undefined;
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export type OpenReactionWindowInput = {
  readonly kind: ReactionWindowState["kind"];
  /** Filtered to seated, non-eliminated players and reordered by `playerOrder`. */
  readonly eligiblePlayerIds: readonly PlayerId[];
  /** Breaks ties when several players react. `null` = start from seat 0. */
  readonly priorityPlayerId: PlayerId | null;
  readonly sourceId: string | null;
  /**
   * The effect the window guards. `null` opens a bare window (an `end-turn`
   * window, say) that resolves without applying or cancelling anything.
   */
  readonly effect: EffectDescriptor | null;
  /** Who the guarded effect lands on. Ignored when `effect` is `null`. */
  readonly affectedPlayerIds: readonly PlayerId[];
};

export type ReactionWindowOpening = {
  readonly window: ReactionWindowState;
  readonly frame: ResolutionFrame;
  readonly pendingEffect: PendingEffectState | null;
  /** `EffectProposed` (when guarding an effect) then `ReactionWindowOpened`. */
  readonly events: readonly GameEvent[];
};

/**
 * Raises a reaction window.
 *
 * Returns `null` — meaning "do not open one, resolve the effect the way you
 * would have without this mechanic" — when the mode has
 * `interaction.reactionWindows` switched off, or when nobody is eligible to
 * answer. Both are ordinary outcomes, not errors: a mechanic that cannot be
 * switched off from config is a bug (§4).
 *
 * `startingSequence` is the event sequence the first event returned here will
 * carry, i.e. `state.eventSequence + eventsAlreadyEmitted + 1` at the call site.
 * Every id below is derived from it, so ids and their announcing events always
 * agree and both re-derive identically on replay. Nothing is derived from
 * `commandId`, which is client-controlled.
 *
 * This function is *pure* and mutates nothing; feed its result to
 * {@link withReactionWindowOpened}.
 */
export function openReactionWindow(
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
  startingSequence: number,
  input: OpenReactionWindowInput,
): ReactionWindowOpening | null {
  if (!state.rules.interaction.reactionWindows) return null;

  const eligiblePlayerIds = orderedPlayerIds(state, input.eligiblePlayerIds).filter(
    (playerId) => !state.eliminatedPlayerIds.includes(playerId),
  );
  if (eligiblePlayerIds.length === 0) return null;

  const priorityPlayerId =
    input.priorityPlayerId !== null && eligiblePlayerIds.includes(input.priorityPlayerId)
      ? input.priorityPlayerId
      : null;

  const frameId = createStableId(
    "FrameId",
    `${state.gameId}:frame:reaction-window:${startingSequence}`,
  );
  const windowId = createStableId(
    "DecisionPointId",
    `${state.gameId}:reaction:${startingSequence}:${input.kind}`,
  );

  const affectedPlayerIds =
    input.effect === null ? [] : orderedPlayerIds(state, input.affectedPlayerIds);
  const pendingEffect =
    input.effect === null
      ? null
      : createPendingEffect(state, startingSequence, {
          frameId,
          sourceId: input.sourceId,
          affectedPlayerIds,
          effect: input.effect,
          preventable: true,
        });

  const frame: ResolutionFrame = {
    id: frameId,
    kind: "open-reaction-window",
    parentFrameId: state.resolutionStack[state.resolutionStack.length - 1]?.id ?? null,
    sourceId: input.sourceId,
    actingPlayerId: state.turn.activePlayerId,
    affectedPlayerIds,
    remainingOperations: [],
    // The phase to put the turn back into once the window closes. Held on the
    // frame rather than inferred later, because by the time the window resolves
    // the transition that opened it is long gone.
    capturedValues: { [RESUME_PHASE_KEY]: state.turn.phase },
    visibility: "public",
  };

  const window: ReactionWindowState = {
    id: windowId,
    frameId,
    kind: input.kind,
    eligiblePlayerIds,
    priorityPlayerId,
    passedPlayerIds: [],
    playedByPlayerIds: [],
    deadlineAt: reactionWindowDeadline(
      context.logicalTimestamp,
      state.rules.interaction.reactionWindowSeconds,
    ),
    pendingEffectId: pendingEffect?.id ?? null,
  };

  const events: GameEvent[] = [];
  const metadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      startingSequence + events.length,
    );

  if (pendingEffect !== null) {
    const proposed: EffectProposedEvent = {
      ...metadata(),
      type: "EffectProposed",
      payload: {
        effectId: pendingEffect.id,
        affectedPlayerIds: pendingEffect.affectedPlayerIds,
        effect: pendingEffect.effect,
      },
    };
    events.push(proposed);
  }

  const opened: ReactionWindowOpenedEvent = {
    ...metadata(),
    type: "ReactionWindowOpened",
    payload: { reactionWindow: window },
  };
  events.push(opened);

  return { window, frame, pendingEffect, events };
}

/**
 * Puts an opening into canonical state.
 *
 * Leaves `revision`, `eventSequence` and `lastCommandId` alone: the transition
 * that opened the window owns those, because a window is opened *inside* another
 * command rather than by one of its own.
 */
export function withReactionWindowOpened(
  state: GameState,
  opening: ReactionWindowOpening,
): GameState {
  return {
    ...state,
    resolutionStack: [...state.resolutionStack, opening.frame],
    pendingEffects:
      opening.pendingEffect === null
        ? state.pendingEffects
        : [...state.pendingEffects, opening.pendingEffect],
    reactionWindows: [...state.reactionWindows, opening.window],
    turn: { ...state.turn, phase: "reaction" },
  };
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

function resumePhase(state: GameState, window: ReactionWindowState): TurnPhase {
  // Another window still open means the table is still reacting.
  const remaining = state.reactionWindows.filter((candidate) => candidate.id !== window.id);
  if (remaining.length > 0) return state.turn.phase;
  if (state.turn.phase !== "reaction") return state.turn.phase;

  const frame = state.resolutionStack.find((candidate) => candidate.id === window.frameId);
  const captured = frame?.capturedValues[RESUME_PHASE_KEY];
  if (typeof captured !== "string" || !Object.hasOwn(TURN_PHASES, captured)) {
    // A window whose frame was lost still has to hand the turn back to somebody
    // able to act; being stuck in "reaction" forever is the worse failure.
    return "pre-roll";
  }

  return captured as TurnPhase;
}

/**
 * Closes a window and resolves whatever it was guarding.
 *
 * `state` is the working state the caller has already applied its own mutations
 * to (a played card leaving a hand, a response recorded on the window). It must
 * still carry the original `revision`/`eventSequence`, because the event
 * metadata is derived from them.
 *
 * The guarded effect is prevented when *anyone* played, and applied when nobody
 * did. Both paths remove the window, its pending effect and its frame, so the
 * close is a one-way door: a second `window.expire` finds nothing and can never
 * double-resolve.
 */
function closeReactionWindow(
  state: GameState,
  window: ReactionWindowState,
  command: GameCommand,
  context: TransitionContext,
  priorEvents: readonly GameEvent[],
): TransitionResult {
  const events: GameEvent[] = [...priorEvents];
  const metadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + events.length + 1,
    );

  const pending =
    window.pendingEffectId === null
      ? null
      : (state.pendingEffects.find((candidate) => candidate.id === window.pendingEffectId) ??
        null);
  const preventerId = reactionWindowPreventerId(state, window);

  let players = state.players;

  if (pending !== null && preventerId !== null) {
    const prevented: EffectPreventedEvent = {
      ...metadata(),
      type: "EffectPrevented",
      payload: {
        effectId: pending.id,
        preventedByPlayerId: preventerId,
        sourceId: pending.sourceId ?? `reaction:${window.kind}`,
      },
    };
    events.push(prevented);
  } else if (pending !== null) {
    const application = applyPendingEffect(
      state,
      pending,
      preventionRandomSource(state),
      context.content.decks,
    );
    players = application.players;

    for (const change of application.changes) {
      const changed: ResourceChangedEvent = {
        ...metadata(),
        type: "ResourceChanged",
        payload: {
          playerId: change.playerId,
          resourceId: change.resourceId,
          previousValue: change.previousValue,
          newValue: change.newValue,
          reason: "pending-effect",
        },
      };
      events.push(changed);
    }
  }

  const lastEvent = events[events.length - 1];

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent?.sequence ?? state.eventSequence,
        players,
        reactionWindows: state.reactionWindows.filter(
          (candidate) => candidate.id !== window.id,
        ),
        pendingEffects:
          pending === null
            ? state.pendingEffects
            : state.pendingEffects.filter((candidate) => candidate.id !== pending.id),
        resolutionStack: state.resolutionStack.filter(
          (candidate) => candidate.id !== window.frameId,
        ),
        turn: { ...state.turn, phase: resumePhase(state, window) },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}

// ---------------------------------------------------------------------------
// Responding
// ---------------------------------------------------------------------------

type ResponderCheck =
  | {
      readonly ok: true;
      readonly window: ReactionWindowState;
      readonly player: PlayerState;
    }
  | { readonly ok: false; readonly result: TransitionResult };

/**
 * The authorisation gate every reaction response passes through, in the order
 * §6.3 demands: entitlement is settled **before** anything mutates.
 *
 * Note what is deliberately *not* checked: whose turn it is. Reacting out of
 * turn is the mechanic, not a loophole in it.
 */
function checkResponder(
  state: GameState,
  command: PlayReactionCommand | PassReactionCommand,
): ResponderCheck {
  if (!state.rules.interaction.reactionWindows) {
    return {
      ok: false,
      result: rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "Reaction windows are disabled by this mode's rules",
      }),
    };
  }

  const window = findReactionWindow(state, command.decisionPointId);
  if (window === null) {
    return {
      ok: false,
      result: rejectCommand(state, command, {
        code: "DECISION_POINT_NOT_FOUND",
        message: "No matching open reaction window for this decisionPointId",
      }),
    };
  }
  if (!window.eligiblePlayerIds.includes(command.actorId)) {
    return {
      ok: false,
      result: rejectCommand(state, command, {
        code: "ACTOR_NOT_AUTHORIZED",
        message: "Actor is not eligible to answer this reaction window",
      }),
    };
  }
  if (hasRespondedToReactionWindow(window, command.actorId)) {
    return {
      ok: false,
      result: rejectCommand(state, command, {
        code: "DECISION_POINT_STALE",
        message: "Actor has already answered this reaction window",
      }),
    };
  }

  const player = state.players[command.actorId];
  if (player === undefined) {
    return {
      ok: false,
      result: rejectCommand(state, command, {
        code: "ACTOR_NOT_FOUND",
        message: "Reaction actor is missing from canonical player state",
      }),
    };
  }

  return { ok: true, window, player };
}

/** Records a response on the window, keeping both lists in `playerOrder`. */
function withResponse(
  state: GameState,
  window: ReactionWindowState,
  playerId: PlayerId,
  response: "played" | "passed",
): ReactionWindowState {
  const played =
    response === "played"
      ? orderedPlayerIds(state, [...window.playedByPlayerIds, playerId])
      : window.playedByPlayerIds;
  const passed =
    response === "passed"
      ? orderedPlayerIds(state, [...window.passedPlayerIds, playerId])
      : window.passedPlayerIds;

  return { ...window, playedByPlayerIds: played, passedPlayerIds: passed };
}

function withWindow(state: GameState, window: ReactionWindowState): GameState {
  return {
    ...state,
    reactionWindows: state.reactionWindows.map((candidate) =>
      candidate.id === window.id ? window : candidate,
    ),
  };
}

type PlayedCost = {
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly cards: Readonly<Record<string, CardState>>;
  readonly decks: Readonly<Record<string, DeckState>>;
  readonly events: readonly GameEvent[];
};

type PlayedCostResult =
  | { readonly ok: true; readonly value: PlayedCost }
  | { readonly ok: false; readonly result: TransitionResult };

/**
 * Spends whatever the reaction was played with.
 *
 * Real consumption, not bookkeeping: a card leaves the hand, becomes face-up in
 * its deck's discard pile and stops being owned; an ability burns a use. A
 * reaction that costs nothing is a reaction every player plays every window,
 * which is the same spectator problem in a louder costume.
 */
function payForReaction(
  state: GameState,
  command: PlayReactionCommand,
  context: TransitionContext,
  player: PlayerState,
): PlayedCostResult {
  const { cardId, abilityId } = command.payload;
  const reject = (
    code: Parameters<typeof rejectCommand>[2]["code"],
    message: string,
  ): PlayedCostResult => ({
    ok: false,
    result: rejectCommand(state, command, { code, message }),
  });

  // A reaction is played *with* something, and exactly one something: neither is
  // an empty command the engine would have to invent a meaning for, and both at
  // once is two reactions in one revision.
  if ((cardId === null) === (abilityId === null)) {
    return reject("INVALID_COMMAND", "A reaction names exactly one of cardId or abilityId");
  }

  for (const targetId of command.payload.targetPlayerIds) {
    if (state.players[targetId] === undefined) {
      return reject("ILLEGAL_ACTION", "Reaction targets a player who is not in this game");
    }
  }

  const events: GameEvent[] = [];
  const metadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + events.length + 1,
    );

  if (cardId !== null) {
    if (!state.rules.agency.handEnabled) {
      return reject("ILLEGAL_ACTION", "Hands are disabled by this mode's rules");
    }

    const card = state.cards[cardId];
    if (
      card === undefined ||
      card.ownerId !== player.id ||
      card.zone !== "hand" ||
      !player.hand.includes(cardId)
    ) {
      return reject("CARD_NOT_AVAILABLE", "Actor does not hold this card in hand");
    }

    const discarded: CardState = {
      ...card,
      zone: "discard-pile",
      ownerId: null,
      // Played into the open: the table has to be able to see what cancelled it.
      faceUp: true,
    };
    const deck = state.decks[card.deckId];

    const cardPlayed: CardPlayedEvent = {
      ...metadata(),
      type: "CardPlayed",
      payload: {
        playerId: player.id,
        cardId,
        targets: orderedPlayerIds(state, command.payload.targetPlayerIds),
      },
    };
    events.push(cardPlayed);

    return {
      ok: true,
      value: {
        players: {
          ...state.players,
          [player.id]: {
            ...player,
            hand: player.hand.filter((held) => held !== cardId),
          },
        },
        cards: { ...state.cards, [cardId]: discarded },
        decks:
          deck === undefined
            ? state.decks
            : {
                ...state.decks,
                [card.deckId]: {
                  ...deck,
                  discardPile: [...deck.discardPile, cardId],
                },
              },
        events,
      },
    };
  }

  const ability = player.abilities.find((candidate) => candidate.id === abilityId);
  if (ability === undefined) {
    return reject("ILLEGAL_ACTION", "Actor does not hold this ability");
  }
  if (ability.usesRemaining !== null && ability.usesRemaining <= 0) {
    return reject("INSUFFICIENT_RESOURCE", "This ability has no uses remaining");
  }
  if (ability.cooldownLapsRemaining > 0) {
    return reject("INSUFFICIENT_RESOURCE", "This ability is still on cooldown");
  }

  return {
    ok: true,
    value: {
      players: {
        ...state.players,
        [player.id]: {
          ...player,
          abilities: player.abilities.map((candidate) =>
            candidate.id === abilityId
              ? {
                  ...candidate,
                  usesRemaining:
                    candidate.usesRemaining === null ? null : candidate.usesRemaining - 1,
                }
              : candidate,
          ),
        },
      },
      cards: state.cards,
      decks: state.decks,
      events,
    },
  };
}

/**
 * `reaction.play` — answer an open window by spending a card or an ability.
 *
 * Playing does **not** close the window on its own. Every eligible player gets
 * their say (or the deadline passes), and only then is the guarded effect
 * cancelled. Two players who both react are both recorded, and
 * {@link reactionWindowPreventerId} decides deterministically which of them the
 * log credits.
 */
export function playReaction(
  state: GameState,
  command: PlayReactionCommand,
  context: TransitionContext,
): TransitionResult {
  const check = checkResponder(state, command);
  if (!check.ok) return check.result;

  const cost = payForReaction(state, command, context, check.player);
  if (!cost.ok) return cost.result;

  const window = withResponse(state, check.window, command.actorId, "played");
  const working: GameState = withWindow(
    {
      ...state,
      players: cost.value.players,
      cards: cost.value.cards,
      decks: cost.value.decks,
    },
    window,
  );

  if (isReactionWindowResolved(window)) {
    return closeReactionWindow(working, window, command, context, cost.value.events);
  }

  const lastEvent = cost.value.events[cost.value.events.length - 1];

  return {
    ok: true,
    value: {
      state: {
        ...working,
        revision: state.revision + 1,
        eventSequence: lastEvent?.sequence ?? state.eventSequence,
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: cost.value.events,
    },
  };
}

/**
 * `reaction.pass` — decline an open window.
 *
 * Emits no event: nothing happened, and a feed that announces every declined
 * reaction is a feed nobody reads. The revision still advances, so the response
 * reaches every client through the ordinary projection push.
 */
export function passReaction(
  state: GameState,
  command: PassReactionCommand,
  context: TransitionContext,
): TransitionResult {
  const check = checkResponder(state, command);
  if (!check.ok) return check.result;

  const window = withResponse(state, check.window, command.actorId, "passed");
  const working = withWindow(state, window);

  if (isReactionWindowResolved(window)) {
    return closeReactionWindow(working, window, command, context, []);
  }

  return {
    ok: true,
    value: {
      state: {
        ...working,
        revision: state.revision + 1,
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: [],
    },
  };
}

/**
 * `window.expire` — the wall-clock boundary crossing, **server-injected only**
 * (§7.1).
 *
 * Three properties this has to hold, all of them tested:
 *
 * - **Never from a player.** Any actor that is a seat at this table is refused,
 *   whatever the window's state. A player who could expire a window could close
 *   it the instant it opened and deny everyone else their say.
 * - **Idempotent.** Closing removes the window, its pending effect and its
 *   frame, so a second fire finds nothing and is refused without touching state.
 *   Firing twice cannot double-apply or double-prevent an effect.
 * - **Recoverable.** A deadline the scheduler slept through is not lost: the
 *   server finds it with {@link expiredReactionWindows} on load and submits this
 *   command then. The engine holds no timer and does not care how late it is.
 *
 * Deliberately *not* gated on `rules.interaction.reactionWindows`. Opening and
 * answering are gated; draining is the server's escape hatch, and refusing it
 * under a ruleset that has since been read as disabled would strand a window —
 * and with it the whole game, because an open window blocks every other command.
 */
export function expireWindow(
  state: GameState,
  command: ExpireWindowCommand,
  context: TransitionContext,
): TransitionResult {
  if (!isServerInjectedActor(state, command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "window.expire is server-injected and is never accepted from a player",
    });
  }

  const window = findReactionWindow(state, command.payload.decisionPointId);
  if (window === null) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_NOT_FOUND",
      message: "No matching open reaction window for this decisionPointId",
    });
  }

  return closeReactionWindow(state, window, command, context, []);
}
