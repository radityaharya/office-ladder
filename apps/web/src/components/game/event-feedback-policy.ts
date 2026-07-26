import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";

import type {
  GameBootstrap,
  LegalActionSummary,
  RoomProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";

import { GAMEPLAY_MOTION_MS } from "@/lib/motion";

export type EventFeedbackState = {
  readonly hydrated: boolean;
  readonly seenEventIds: readonly string[];
};

export type EventActorKind = "local" | "remote" | "system";

export type EventNotice = {
  readonly eventId: string;
  readonly eventType: string;
  readonly revision: number;
  readonly actorKind: EventActorKind;
  readonly actorName: string;
};

export type CardDrawNotice = {
  readonly eventId: string;
  readonly revision: number;
  readonly actorKind: EventActorKind;
  readonly actorName: string;
  readonly card: Extract<SafeEventSummary, { readonly type: "CardDrawn" }>["card"];
};

/**
 * A single committed dice roll, surfaced exactly once per event id so the dice
 * instrument settles on real faces without re-firing on every 5s poll.
 * `dice` is the server's own face list — never assume a pair: movement rolls
 * one die, only an audit-release attempt rolls 2d6.
 */
export type DiceRollNotice = {
  readonly eventId: string;
  readonly revision: number;
  readonly actorKind: EventActorKind;
  readonly actorName: string;
  readonly actorPlayerId: string | null;
  readonly isLocalActor: boolean;
  readonly dice: readonly number[];
  readonly total: number;
  readonly purpose: string;
};

export type EventFeedbackResult = {
  readonly state: EventFeedbackState;
  readonly notices: readonly EventNotice[];
  readonly cardDraws: readonly CardDrawNotice[];
  readonly diceRolls: readonly DiceRollNotice[];
};

type CardDrawnEvent = Extract<SafeEventSummary, { readonly type: "CardDrawn" }>;
type DiceRolledEvent = Extract<SafeEventSummary, { readonly type: "DiceRolled" }>;
type GenericEvent = Exclude<SafeEventSummary, CardDrawnEvent | DiceRolledEvent>;

type PromptAction = Extract<
  LegalActionSummary,
  { readonly type: "prompt.respond" }
>;

/**
 * Upper bound on the seen-event ledger.
 *
 * `PublicGameProjection.eventSummaries` is not append-only forever: the server
 * keeps a sliding window (`MAX_PERSISTED_EVENT_SUMMARIES = 200` in
 * apps/server/src/rooms/room-snapshot.ts) and truncates from the front. Without
 * a cap this ledger grows for the whole match; with a cap of exactly the window
 * size an out-of-order poll answering with a slightly older window could
 * re-surface an event as unseen. Three windows of slack is far more than any
 * plausible response reordering and still bounds the array.
 */
const SEEN_EVENT_LEDGER_LIMIT = 600;

export function createEventFeedbackState(): EventFeedbackState {
  return { hydrated: false, seenEventIds: [] };
}

export function reduceEventFeedback(
  state: EventFeedbackState,
  events: readonly SafeEventSummary[],
  room: RoomProjection,
  selfPlayerId: string,
): EventFeedbackResult {
  const seenEventIds = new Set(state.seenEventIds);
  const unseenEvents = events.filter((event) => !seenEventIds.has(event.id));
  const nextState = {
    hydrated: true,
    seenEventIds: capLedger([
      ...state.seenEventIds,
      ...unseenEvents.map((event) => event.id),
    ]),
  } satisfies EventFeedbackState;

  if (!state.hydrated) {
    return { state: nextState, notices: [], cardDraws: [], diceRolls: [] };
  }

  return {
    state: nextState,
    notices: unseenEvents
      .filter(isGenericEvent)
      .map((event) => toEventNotice(event, room, selfPlayerId)),
    cardDraws: unseenEvents
      .filter(isCardDrawnEvent)
      .map((event) => toCardDrawNotice(event, room, selfPlayerId)),
    diceRolls: unseenEvents
      .filter(isDiceRolledEvent)
      .map((event) => toDiceRollNotice(event, room, selfPlayerId)),
  };
}

export function findLocalPromptAction(
  actions: readonly LegalActionSummary[],
): PromptAction | null {
  return actions.find((action) => action.type === "prompt.respond") ?? null;
}

function capLedger(ids: readonly string[]): readonly string[] {
  return ids.length <= SEEN_EVENT_LEDGER_LIMIT
    ? ids
    : ids.slice(ids.length - SEEN_EVENT_LEDGER_LIMIT);
}

function isCardDrawnEvent(event: SafeEventSummary): event is CardDrawnEvent {
  return event.type === "CardDrawn";
}

function isDiceRolledEvent(event: SafeEventSummary): event is DiceRolledEvent {
  return event.type === "DiceRolled";
}

function isGenericEvent(event: SafeEventSummary): event is GenericEvent {
  return !isCardDrawnEvent(event) && !isDiceRolledEvent(event);
}

function toEventNotice(
  event: GenericEvent,
  room: RoomProjection,
  selfPlayerId: string,
): EventNotice {
  const actor = eventActor(event, room, selfPlayerId);
  return {
    eventId: event.id,
    eventType: event.type,
    revision: event.revision,
    actorKind: actor.kind,
    actorName: actor.name,
  };
}

function toCardDrawNotice(
  event: CardDrawnEvent,
  room: RoomProjection,
  selfPlayerId: string,
): CardDrawNotice {
  const actor = eventActor(event, room, selfPlayerId);
  return {
    eventId: event.id,
    revision: event.revision,
    actorKind: actor.kind,
    actorName: actor.name,
    card: event.card,
  };
}

function toDiceRollNotice(
  event: DiceRolledEvent,
  room: RoomProjection,
  selfPlayerId: string,
): DiceRollNotice {
  const actor = eventActor(event, room, selfPlayerId);
  return {
    eventId: event.id,
    revision: event.revision,
    actorKind: actor.kind,
    actorName: actor.name,
    actorPlayerId: event.actorPlayerId,
    isLocalActor: actor.kind === "local",
    dice: event.dice,
    total: event.total,
    purpose: event.purpose,
  };
}

function eventActor(
  event: SafeEventSummary,
  room: RoomProjection,
  selfPlayerId: string,
): { readonly kind: EventActorKind; readonly name: string } {
  if (event.actorPlayerId === null) return { kind: "system", name: "System" };
  const member = room.members.find((candidate) => candidate.id === event.actorPlayerId);
  return {
    kind: event.actorPlayerId === selfPlayerId ? "local" : "remote",
    name: member?.displayName ?? `Seat ${member?.seat ?? "?"}`,
  };
}

/* ------------------------------------------------------------------------- */
/* Presentation pacing.                                                      */
/* ------------------------------------------------------------------------- */

/**
 * The server commits a bot's **entire** turn as one engine command and
 * publishes one projection update, so five to ten events land at the same
 * instant carrying identical `occurredAt`. Measured in the live app: one ROLL
 * DIE click drove the activity list 37 → 42 → 44 in three bursts inside 2.74s,
 * and the turn was back to the local player before any of it could be read.
 * Raising the server's `BOT_TURN_DELAY_MS` does not fix that — it produces
 * burst, pause, burst. The events of one committed turn have to *play out* on
 * the client.
 *
 * This layer paces **presentation only**, and DESIGN.md §7.2's last rule is the
 * whole contract: "Bot turns and committed event streams may be played out over
 * time so a human can follow them, but the underlying state is already
 * committed and must never be delayed, reordered, or withheld."
 *
 * Concretely:
 * - `legalActions`, `activePlayerId`, `players`, `status` and `revision` are
 *   never touched. The roll control is live the instant the server says the
 *   action is legal, whatever is still playing back.
 * - Only `eventSummaries` is truncated, to a **leading prefix** of the server's
 *   own order. Nothing is reordered and nothing is dropped from that prefix.
 * - The terminal state always converges: once the queue drains, the paced
 *   bootstrap is the canonical bootstrap, by object identity.
 */
export const EVENT_PACING = {
  /**
   * The default beat: one bookkeeping event revealed, then hold.
   *
   * Below ~150ms consecutive activity-log lines stop reading as separate
   * events — they arrive as a block again, which is the bug. Above ~250ms a
   * median five-event bot turn needs over 1.25s of playback against the
   * server's own 900ms bot cadence (`DEFAULT_BOT_TURN_DELAY_MS`), so the
   * backlog grows every single turn and compression never gets to rest. 190ms
   * is the middle of that window and reads as a deliberate tick.
   */
  beat: 190,
  /**
   * Beat once the backlog passes `compressAbove`. Six events at 110ms is 660ms,
   * comfortably inside the 900ms the server takes to produce the next bot turn,
   * so the queue provably catches up rather than drifting forever.
   */
  compressedBeat: 110,
  /** Beat once the backlog passes `sprintAbove`. Still sequential, but hurrying. */
  sprintBeat: 60,
  /** One bot turn's worth of events. Under this, every event gets its full dwell. */
  compressAbove: 8,
  /** Three to four bot turns behind. */
  sprintAbove: 24,
  /**
   * Eight bot turns ≈ one full round of a six-seat table, plus slack. Past a
   * whole round behind you are no longer following a game, you are watching a
   * recording — so jump instead of replaying. This is also the backgrounded-tab
   * case: browsers throttle timers in hidden tabs, so a backlog of hundreds is
   * normal on refocus.
   */
  collapseAbove: 48,
  /**
   * Events kept at the tail of a collapse, so a jump still plays out the most
   * recent turn instead of hard-snapping to "now" with no explanation.
   */
  tailKeep: 6,
} as const;

export type EventPacingState = {
  /**
   * False until the first projection has been absorbed. History is never
   * replayed: the first projection reveals in full, silently.
   */
  readonly hydrated: boolean;
  /** Ids already shown. Kept as ids, not an index, because the window slides. */
  readonly revealedIds: readonly string[];
  /** `Date.now()` of the most recent reveal. */
  readonly revealedAtMs: number;
  /** Dwell still owed to the most recently revealed event. */
  readonly holdMs: number;
};

export type EventPacingMode =
  /** Nothing queued; the view is the projection. */
  | "idle"
  /** First projection — reveal all of history without animating it. */
  | "hydrate"
  /** Reduced motion, or an explicit skip. */
  | "instant"
  /** The local player's own committed action is never queued behind others'. */
  | "local-flush"
  /** Too far behind to replay; jump, keeping `tailKeep` to play out. */
  | "collapse"
  /** One event, full per-type dwell. */
  | "dwell"
  /** One event, compressed beat. */
  | "compressed"
  /** One event, sprint beat. */
  | "sprint";

export type EventPacingStep = {
  /** Events to reveal, in server order. Zero means the queue is at rest. */
  readonly revealCount: number;
  /**
   * The cursor this step targets, as an absolute leading-run length rather than
   * a delta — which is what makes applying a step **idempotent**.
   *
   * A step is applied from inside a `setState` updater, so the `previous` state
   * it receives is not guaranteed to be the state the step was planned against:
   * a queued synchronous reveal and a firing timer can both land before either
   * re-renders, and StrictMode double-invokes the mount effect. A delta would
   * advance the cursor once per application and silently swallow the very events
   * it was pacing; an absolute target simply does nothing the second time.
   */
  readonly revealThrough: number;
  /** Hold before revealing them. Derived from absolute timestamps, so a caller
   *  may cancel and re-plan at any moment without drifting or losing a reveal. */
  readonly waitMs: number;
  /** Dwell owed once they land. */
  readonly holdMs: number;
  readonly mode: EventPacingMode;
};

export type EventPacingPlanInput = {
  readonly state: EventPacingState;
  readonly events: readonly SafeEventSummary[];
  /** The caller's own player id, so their action can jump the queue. */
  readonly selfPlayerId: string | null;
  /** `prefers-reduced-motion`, or an explicit skip request. */
  readonly revealAll: boolean;
  readonly nowMs: number;
};

export function createEventPacingState(): EventPacingState {
  return { hydrated: false, revealedIds: [], revealedAtMs: 0, holdMs: 0 };
}

/**
 * How many leading events have been revealed.
 *
 * A **leading run**, not a stored index, and not a set intersection. Reveal is
 * strictly in server order, so the revealed events are always a prefix — and
 * computing the prefix fresh on every projection is what makes this correct
 * across the two things that actually happen to `eventSummaries`:
 *
 * - The server truncates from the front at 200 events. A stored index would
 *   silently point at the wrong event; the run just gets shorter.
 * - Polls and realtime invalidations can answer out of order. A stale, shorter
 *   window is entirely revealed already, so the run covers all of it and the
 *   queue reports "at rest" rather than replaying anything.
 */
export function revealedEventCount(
  state: EventPacingState,
  events: readonly SafeEventSummary[],
): number {
  // Un-hydrated means "the player has already seen whatever history exists".
  // This is what makes the very first *synchronous* render show real state —
  // committed dice faces, a full activity log — instead of an empty projection
  // that only fills in once an effect has run. The ledger itself is still empty
  // at that point, which is why the pacing plan works off `ledgerRun` below
  // rather than off this function.
  if (!state.hydrated) return events.length;

  return ledgerRun(state, events);
}

/**
 * The leading run actually recorded in the ledger, with no un-hydrated
 * shortcut. This is the cursor the pacing plan advances; `revealedEventCount`
 * is what the view renders from. Conflating the two makes hydration a no-op
 * that records nothing and then paces the whole of history on the next poll.
 */
function ledgerRun(
  state: EventPacingState,
  events: readonly SafeEventSummary[],
): number {
  const revealed = new Set(state.revealedIds);
  let count = 0;
  while (count < events.length) {
    const event = events[count];
    if (event === undefined || !revealed.has(event.id)) break;
    count += 1;
  }

  return count;
}

/** Decides the next presentation tick. Pure — inject `nowMs`. */
export function planEventPacing({
  state,
  events,
  selfPlayerId,
  revealAll,
  nowMs,
}: EventPacingPlanInput): EventPacingStep {
  const revealed = ledgerRun(state, events);
  const pending = events.slice(revealed);
  const step = (
    revealCount: number,
    waitMs: number,
    holdMs: number,
    mode: EventPacingMode,
  ): EventPacingStep => ({
    revealCount,
    revealThrough: revealed + revealCount,
    waitMs,
    holdMs,
    mode,
  });

  if (!state.hydrated) return step(pending.length, 0, 0, "hydrate");
  if (pending.length === 0) return step(0, 0, 0, "idle");
  if (revealAll) return step(pending.length, 0, 0, "instant");

  // The local player's own committed action never waits behind another seat's
  // playback. Without this the optimistic "Rolling" state clears (the fetch
  // resolved) while the dice instrument is still showing the *previous* roll,
  // which reads as the board disagreeing with itself. Only the tail of the last
  // bot's turn is ever skipped this way, because a local action is only legal
  // once every earlier turn has already committed.
  if (selfPlayerId !== null) {
    const localIndex = pending.findIndex(
      (event) => event.actorPlayerId === selfPlayerId,
    );
    if (localIndex > 0) return step(localIndex, 0, 0, "local-flush");
  }

  if (pending.length > EVENT_PACING.collapseAbove) {
    return step(pending.length - EVENT_PACING.tailKeep, 0, 0, "collapse");
  }

  const head = pending[0];
  const mode: EventPacingMode =
    pending.length > EVENT_PACING.sprintAbove
      ? "sprint"
      : pending.length > EVENT_PACING.compressAbove
        ? "compressed"
        : "dwell";
  const holdMs =
    mode === "sprint"
      ? EVENT_PACING.sprintBeat
      : mode === "compressed"
        ? EVENT_PACING.compressedBeat
        : head === undefined
          ? EVENT_PACING.beat
          : eventDwellMs(head);

  return step(1, Math.max(0, state.revealedAtMs + state.holdMs - nowMs), holdMs, mode);
}

/**
 * Applies a planned step. Pure — inject `nowMs`.
 *
 * Idempotent: the step names an absolute target cursor, so applying the same
 * step twice reveals nothing the second time. That is what makes it safe to call
 * from a `setState` updater, which may be handed a newer state than the one the
 * step was planned against.
 */
export function applyEventPacingStep(
  state: EventPacingState,
  events: readonly SafeEventSummary[],
  step: EventPacingStep,
  nowMs: number,
): EventPacingState {
  const revealed = ledgerRun(state, events);
  const added = events
    .slice(revealed, Math.max(revealed, step.revealThrough))
    .map((event) => event.id);

  if (added.length === 0 && state.hydrated) return state;

  return {
    hydrated: true,
    revealedIds: capLedger([...state.revealedIds, ...added]),
    revealedAtMs: added.length === 0 ? state.revealedAtMs : nowMs,
    holdMs: added.length === 0 ? state.holdMs : step.holdMs,
  };
}

/**
 * Dwell after an event is revealed.
 *
 * Events that own a DESIGN.md §7.2 animation of their own get that animation's
 * budget, so the next thing does not start on top of it. Everything else gets
 * the default beat. Note this is a *presentation* hold, not a lock: an
 * animation may overrun its dwell harmlessly, because the cursor is not the
 * source of truth for anything.
 */
export function eventDwellMs(event: SafeEventSummary): number {
  switch (event.type) {
    // The die's stepped settle needs to be readable before the token starts
    // moving, and a d6 move averages three-and-a-half hops.
    case "DiceRolled":
    case "PlayerMoved":
      return GAMEPLAY_MOTION_MS.hopPerTile * 3;
    // A card has to be read, not glimpsed — two reveal budgets.
    case "CardDrawn":
      return GAMEPLAY_MOTION_MS.reveal * 2;
    case "SalaryAwarded":
    case "StatusApplied":
    case "PromptOpened":
    case "PromotionAttempted":
    case "PromotionBlocked":
    case "PlayerPromoted":
    case "ManagementRevealed":
    case "MatchEnded":
      return GAMEPLAY_MOTION_MS.emphasis;
    default:
      return EVENT_PACING.beat;
  }
}

/**
 * Replays a whole plan/apply loop to its resting point.
 *
 * Exported because it is the honest way to assert the one property that makes
 * pacing safe rather than a second bug: whatever the backlog, whatever the
 * collapse, the terminal state is the true projection.
 */
export function drainEventPacing(
  state: EventPacingState,
  events: readonly SafeEventSummary[],
  options: {
    readonly selfPlayerId?: string | null;
    readonly revealAll?: boolean;
    /** Guards against a policy bug turning a test into an infinite loop. */
    readonly maxTicks?: number;
  } = {},
): { readonly state: EventPacingState; readonly ticks: number; readonly modes: readonly EventPacingMode[] } {
  const maxTicks = options.maxTicks ?? 5_000;
  const modes: EventPacingMode[] = [];
  let current = state;
  let nowMs = 0;

  for (let tick = 0; tick < maxTicks; tick += 1) {
    const step = planEventPacing({
      state: current,
      events,
      selfPlayerId: options.selfPlayerId ?? null,
      revealAll: options.revealAll ?? false,
      nowMs,
    });
    if (step.mode === "idle") return { state: current, ticks: tick, modes };
    modes.push(step.mode);
    nowMs += step.waitMs;
    current = applyEventPacingStep(current, events, step, nowMs);
  }

  throw new Error("Event pacing did not reach a resting state");
}

const NO_EVENTS: readonly SafeEventSummary[] = [];

export type PacedGameFeed = {
  /**
   * The projection **as the player has been shown it**: `eventSummaries`
   * truncated to the presentation cursor, everything else canonical and
   * untouched. Object-identical to the input bootstrap once the queue is at
   * rest, which is both the convergence guarantee and a free memo signal.
   */
  readonly bootstrap: GameBootstrap | null;
  /** Committed events not yet revealed. */
  readonly pendingCount: number;
  /** True while events remain queued. */
  readonly isPlayingBack: boolean;
  /**
   * True once the backlog is far enough behind to be worth *offering* a skip.
   *
   * The threshold lives here rather than at the call site because a control that
   * appears and vanishes on every bot turn is worse chrome than no control at
   * all: `isPlayingBack` is true for a second or two of every single turn, which
   * is normal operation, not a condition to surface.
   */
  readonly isBehind: boolean;
  /** Reveal everything committed at the current revision, now. Idempotent. */
  readonly skip: () => void;
};

/**
 * Paces a committed projection into something a human can follow.
 *
 * Call this **once**, in the component that owns the projection, and thread
 * `feed.bootstrap` everywhere the un-paced bootstrap used to go. Every consumer
 * then works unchanged — the activity log, the card-draw queue, the dice
 * instrument and the board plate all already derive from `eventSummaries`.
 * Calling it in two places would give you two cursors drifting apart.
 *
 * What must **not** be threaded from here: anything that decides what the
 * player may do. `legalActions` and `activePlayerId` come off the canonical
 * bootstrap, so the roll control is never gated on playback.
 */
export function useEventPacing(bootstrap: GameBootstrap | null): PacedGameFeed {
  const prefersReducedMotion = useReducedMotion() === true;
  const [state, setState] = useState<EventPacingState>(createEventPacingState);
  const [skipRevision, setSkipRevision] = useState<number | null>(null);

  const events = bootstrap?.publicProjection.eventSummaries ?? NO_EVENTS;
  const selfPlayerId = bootstrap?.self.playerId ?? null;
  const revision = bootstrap?.publicProjection.revision ?? null;
  // A skip applies to the revision it was pressed at. Anything committed after
  // it paces normally again — "catch me up" is a one-shot, not a mode.
  const revealAll =
    prefersReducedMotion || (skipRevision !== null && skipRevision === revision);

  useEffect(() => {
    if (bootstrap === null) return;
    if (typeof window === "undefined") return;

    const step = planEventPacing({
      state,
      events,
      selfPlayerId,
      revealAll,
      nowMs: Date.now(),
    });
    if (step.mode === "idle") return;

    if (step.waitMs === 0) {
      setState((previous) =>
        applyEventPacingStep(previous, events, step, Date.now()),
      );
      return;
    }

    /*
     * Re-planning is free. `waitMs` is derived from `revealedAtMs + holdMs`, an
     * absolute deadline, so tearing this timer down and rebuilding it — which
     * happens on every 5s poll, because a fresh fetch hands us a new array
     * identity — resumes the same countdown instead of restarting it. That is
     * what stops a poll-heavy client from either stalling the queue or
     * double-revealing.
     */
    const timer = window.setTimeout(() => {
      setState((previous) => applyEventPacingStep(previous, events, step, Date.now()));
    }, step.waitMs);

    return () => window.clearTimeout(timer);
  }, [bootstrap, events, revealAll, selfPlayerId, state]);

  const revealedCount = revealedEventCount(state, events);
  const pendingCount = events.length - revealedCount;

  const paced = useMemo(() => {
    if (bootstrap === null) return null;
    if (revealedCount >= events.length) return bootstrap;

    return {
      ...bootstrap,
      publicProjection: {
        ...bootstrap.publicProjection,
        eventSummaries: events.slice(0, revealedCount),
      },
    } satisfies GameBootstrap;
  }, [bootstrap, events, revealedCount]);

  const skip = useCallback(() => setSkipRevision(revision), [revision]);

  return {
    bootstrap: paced,
    pendingCount,
    isPlayingBack: pendingCount > 0,
    isBehind: pendingCount > EVENT_PACING.compressAbove,
    skip,
  };
}

/**
 * The newest revealed event, optionally of one type.
 *
 * The consumption contract for anything that animates a *change* rather than
 * rendering a value: pass the **paced** bootstrap and animate when this
 * changes, not when the projection arrives. A token that hops the moment the
 * projection lands, while the log is still four events behind, is the same
 * unfollowable burst in a different costume.
 */
export function latestRevealedEvent(
  bootstrap: GameBootstrap,
  type?: SafeEventSummary["type"],
): SafeEventSummary | null {
  const events = bootstrap.publicProjection.eventSummaries;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (type === undefined || event.type === type) return event;
  }

  return null;
}
