import { describe, expect, it } from "vitest";

import type {
  LegalActionSummary,
  RoomProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";

import {
  applyEventPacingStep,
  createEventFeedbackState,
  createEventPacingState,
  drainEventPacing,
  EVENT_PACING,
  eventDwellMs,
  findLocalPromptAction,
  latestRevealedEvent,
  planEventPacing,
  reduceEventFeedback,
  revealedEventCount,
  type EventPacingState,
} from "./event-feedback-policy";

const room = {
  id: "room-1",
  code: "Q4W8ZT",
  status: "active",
  capacity: 6,
  revision: 4,
  mode: "mode.quick",
  members: [
    {
      id: "player-1",
      displayName: "Avery",
      seat: 1,
      isHost: true,
      isReady: true,
      isConnected: true,
      isBot: false,
      botDifficulty: null,
      avatarUrl: null,
      characterId: null,
      characterLabel: null,
    },
    {
      id: "player-2",
      displayName: "Morgan",
      seat: 2,
      isHost: false,
      isReady: true,
      isConnected: true,
      isBot: false,
      botDifficulty: null,
      avatarUrl: null,
      characterId: null,
      characterLabel: null,
    },
  ],
} satisfies RoomProjection;

const initialEvents = [
  event("event-1", "TurnStarted", 1, "player-1"),
  cardDrawn("event-2", 2, "player-1", "card.work.overtime-bonus"),
] as const;

function hydrate(): ReturnType<typeof reduceEventFeedback>["state"] {
  return reduceEventFeedback(
    createEventFeedbackState(),
    initialEvents,
    room,
    "player-1",
  ).state;
}

describe("event feedback policy", () => {
  it("stays silent when the first hydrated projection arrives", () => {
    // Given
    const state = createEventFeedbackState();

    // When
    const result = reduceEventFeedback(state, initialEvents, room, "player-1");

    // Then
    expect(result.notices).toEqual([]);
    expect(result.cardDraws).toEqual([]);
    expect(result.state.seenEventIds).toEqual(["event-1", "event-2"]);
  });

  it("deduplicates generic notices and card draws through one seen-event ledger", () => {
    // Given
    const hydrated = reduceEventFeedback(
      createEventFeedbackState(),
      initialEvents,
      room,
      "player-1",
    ).state;
    const events = [
      ...initialEvents,
      event("event-3", "TileResolved", 3, "player-2"),
      cardDrawn("event-4", 4, "player-2", "card.meeting.great-idea"),
    ];

    // When
    const firstRefresh = reduceEventFeedback(hydrated, events, room, "player-1");
    const repeatedRefresh = reduceEventFeedback(
      firstRefresh.state,
      events,
      room,
      "player-1",
    );

    // Then
    expect(firstRefresh.notices.map((notice) => notice.eventId)).toEqual(["event-3"]);
    expect(firstRefresh.cardDraws.map((draw) => draw.eventId)).toEqual(["event-4"]);
    expect(repeatedRefresh.notices).toEqual([]);
    expect(repeatedRefresh.cardDraws).toEqual([]);
  });

  it("returns multiple unseen card draws in server order", () => {
    // Given
    const hydrated = reduceEventFeedback(
      createEventFeedbackState(),
      initialEvents,
      room,
      "player-1",
    ).state;

    // When
    const result = reduceEventFeedback(
      hydrated,
      [
        ...initialEvents,
        cardDrawn("event-3", 3, "player-2", "card.work.printer-jam"),
        cardDrawn("event-4", 4, "player-1", "card.event.surprise-bonus"),
      ],
      room,
      "player-1",
    );

    // Then
    expect(result.cardDraws.map((draw) => draw.card.definitionId)).toEqual([
      "card.work.printer-jam",
      "card.event.surprise-bonus",
    ]);
    expect(result.notices).toEqual([]);
  });

  it("separates mixed generic and card events without changing their relative queues", () => {
    // Given
    const hydrated = reduceEventFeedback(
      createEventFeedbackState(),
      initialEvents,
      room,
      "player-1",
    ).state;

    // When
    const result = reduceEventFeedback(
      hydrated,
      [
        ...initialEvents,
        event("event-3", "PlayerMoved", 3, "player-2"),
        cardDrawn("event-4", 4, "player-2", "card.work.mentorship"),
        event("event-5", "ResourceChanged", 5, "player-2"),
        cardDrawn("event-6", 6, "player-2", "card.work.free-coffee"),
      ],
      room,
      "player-1",
    );

    // Then
    expect(result.notices.map((notice) => notice.eventId)).toEqual(["event-3", "event-5"]);
    expect(result.cardDraws.map((draw) => draw.eventId)).toEqual(["event-4", "event-6"]);
    expect(result.state.seenEventIds).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-6",
    ]);
  });

  it("uses actor identity and event type without inventing event details", () => {
    // Given
    const hydrated = reduceEventFeedback(
      createEventFeedbackState(),
      initialEvents,
      room,
      "player-1",
    ).state;

    // When
    const result = reduceEventFeedback(
      hydrated,
      [...initialEvents, event("event-3", "PlayerPromoted", 3, "player-2")],
      room,
      "player-1",
    );

    // Then
    expect(result.notices[0]).toMatchObject({
      actorKind: "remote",
      actorName: "Morgan",
      eventType: "PlayerPromoted",
    });
  });

  it("stays silent about dice already present in the first hydrated projection", () => {
    // Given
    const events = [...initialEvents, diceRolled("event-3", 3, "player-1", [4])];

    // When
    const result = reduceEventFeedback(
      createEventFeedbackState(),
      events,
      room,
      "player-1",
    );

    // Then
    expect(result.diceRolls).toEqual([]);
    expect(result.state.seenEventIds).toContain("event-3");
  });

  it("reports a newly committed roll once, with the real faces and the local actor flag", () => {
    // Given
    const hydrated = hydrate();
    const events = [...initialEvents, diceRolled("event-3", 3, "player-1", [5])];

    // When
    const firstRefresh = reduceEventFeedback(hydrated, events, room, "player-1");
    const repeatedRefresh = reduceEventFeedback(
      firstRefresh.state,
      events,
      room,
      "player-1",
    );

    // Then
    expect(firstRefresh.diceRolls).toEqual([
      {
        eventId: "event-3",
        revision: 3,
        actorKind: "local",
        actorName: "Avery",
        actorPlayerId: "player-1",
        isLocalActor: true,
        dice: [5],
        total: 5,
        purpose: "normal-movement",
      },
    ]);
    expect(repeatedRefresh.diceRolls).toEqual([]);
  });

  it("keeps a remote roll's faces and identity intact", () => {
    // Given
    const hydrated = hydrate();

    // When
    const result = reduceEventFeedback(
      hydrated,
      [...initialEvents, diceRolled("event-3", 3, "player-2", [2, 2], "audit-release")],
      room,
      "player-1",
    );

    // Then
    expect(result.diceRolls[0]).toMatchObject({
      actorKind: "remote",
      actorName: "Morgan",
      isLocalActor: false,
      dice: [2, 2],
      total: 4,
      purpose: "audit-release",
    });
  });

  it("keeps dice out of the generic notice queue so a roll is reported once", () => {
    // Given
    const hydrated = hydrate();

    // When
    const result = reduceEventFeedback(
      hydrated,
      [
        ...initialEvents,
        diceRolled("event-3", 3, "player-2", [6]),
        event("event-4", "PlayerMoved", 4, "player-2"),
      ],
      room,
      "player-1",
    );

    // Then
    expect(result.notices.map((notice) => notice.eventId)).toEqual(["event-4"]);
    expect(result.diceRolls.map((roll) => roll.eventId)).toEqual(["event-3"]);
    expect(result.cardDraws).toEqual([]);
  });

  it("returns every unseen roll in server order when a bot turn batches them", () => {
    // Given
    const hydrated = hydrate();

    // When
    const result = reduceEventFeedback(
      hydrated,
      [
        ...initialEvents,
        diceRolled("event-3", 3, "player-2", [1]),
        diceRolled("event-4", 4, "player-1", [6]),
      ],
      room,
      "player-1",
    );

    // Then
    expect(result.diceRolls.map((roll) => roll.total)).toEqual([1, 6]);
  });

  it("selects a prompt dialog only when the local legal actions include prompt.respond", () => {
    // Given
    const prompt = {
      type: "prompt.respond",
      expectedRevision: 8,
      decisionPointId: "decision-1",
      kind: "audit-release",
      options: ["pay-fine", "attempt-roll"],
    } satisfies Extract<LegalActionSummary, { readonly type: "prompt.respond" }>;

    // When
    const localAction = findLocalPromptAction([prompt]);
    const missingAction = findLocalPromptAction([
      { type: "turn.roll", expectedRevision: 8 },
    ]);

    // Then
    expect(localAction).toBe(prompt);
    expect(missingAction).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */
/* Presentation pacing.                                                      */
/* ------------------------------------------------------------------------- */

/** One committed bot turn as the engine actually emits it (see roll-events.ts). */
function botTurn(prefix: string, actorPlayerId: string): readonly SafeEventSummary[] {
  return [
    diceRolled(`${prefix}-dice`, 1, actorPlayerId, [4]),
    event(`${prefix}-moved`, "PlayerMoved", 2, actorPlayerId),
    event(`${prefix}-salary`, "SalaryAwarded", 3, actorPlayerId),
    event(`${prefix}-money`, "ResourceChanged", 4, actorPlayerId),
    event(`${prefix}-tile`, "TileResolved", 5, actorPlayerId),
    event(`${prefix}-next`, "TurnStarted", 6, actorPlayerId),
  ];
}

function filler(count: number, offset = 0): readonly SafeEventSummary[] {
  return Array.from({ length: count }, (_, index) =>
    event(`fill-${offset + index}`, "TileResolved", offset + index, "player-2"),
  );
}

function hydratedPacing(
  events: readonly SafeEventSummary[],
): EventPacingState {
  const step = planEventPacing({
    state: createEventPacingState(),
    events,
    selfPlayerId: "player-1",
    revealAll: false,
    nowMs: 0,
  });
  expect(step.mode).toBe("hydrate");
  return applyEventPacingStep(createEventPacingState(), events, step, 0);
}

describe("event presentation pacing", () => {
  it("reveals the first projection in full without replaying it", () => {
    // Given — a page loaded mid-match already has history on screen; replaying
    // it would be a slideshow of things that already happened.
    const events = [...initialEvents, ...botTurn("t1", "player-2")];

    // When
    const state = hydratedPacing(events);

    // Then
    expect(revealedEventCount(state, events)).toBe(events.length);
    expect(
      planEventPacing({
        state,
        events,
        selfPlayerId: "player-1",
        revealAll: false,
        nowMs: 0,
      }).mode,
    ).toBe("idle");
  });

  it("treats an un-hydrated cursor as fully revealed so the first render is real", () => {
    // Given — `revealedEventCount` is called during render, before any effect
    // has run. Reporting 0 there would render an empty projection: no dice
    // faces, no activity log, nothing until an effect fired.
    const events = [...initialEvents, ...botTurn("t1", "player-2")];

    // Then
    expect(revealedEventCount(createEventPacingState(), events)).toBe(events.length);
  });

  it("drains a burst one event at a time, in the server's own order", () => {
    // Given — the whole problem: a bot's turn is one command, one projection
    // update, six events with identical `occurredAt`.
    const history = [...initialEvents];
    const events = [...history, ...botTurn("t1", "player-2")];
    const hydrated = hydratedPacing(history);

    // When
    const drained = drainEventPacing(hydrated, events, { selfPlayerId: "player-1" });

    // Then — six separate ticks, each revealing exactly one event, in order.
    expect(drained.ticks).toBe(6);
    expect(drained.modes).toEqual(Array.from({ length: 6 }, () => "dwell"));
    expect(drained.state.revealedIds.slice(history.length)).toEqual([
      "t1-dice",
      "t1-moved",
      "t1-salary",
      "t1-money",
      "t1-tile",
      "t1-next",
    ]);
  });

  it("converges on the true projection, whatever the backlog", () => {
    // Given — this is the property that makes pacing safe rather than a second
    // bug. A view that ends up disagreeing with the server is worse than one
    // that snapped (DESIGN.md §7.2).
    const history = [...initialEvents];
    const backlogs = [
      botTurn("t1", "player-2"),
      [...botTurn("t1", "player-2"), ...botTurn("t2", "player-2")],
      filler(EVENT_PACING.collapseAbove * 3),
    ];

    for (const backlog of backlogs) {
      const events = [...history, ...backlog];

      // When
      const drained = drainEventPacing(hydratedPacing(history), events, {
        selfPlayerId: "player-1",
      });
      const revealed = revealedEventCount(drained.state, events);

      // Then
      expect(revealed).toBe(events.length);
      expect(events.slice(0, revealed)).toEqual(events);
    }
  });

  it("never re-reveals an event when a poll re-delivers an identical projection", () => {
    // Given — `eventSummaries` is re-sent in its entirety every 5s and on every
    // realtime invalidation, as a fresh array each time.
    const history = [...initialEvents];
    const events = [...history, ...botTurn("t1", "player-2")];
    const drained = drainEventPacing(hydratedPacing(history), events, {
      selfPlayerId: "player-1",
    });

    // When — the identical list arrives again, with a new array identity.
    const repeat = planEventPacing({
      state: drained.state,
      events: [...events],
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 10_000,
    });
    const applied = applyEventPacingStep(drained.state, [...events], repeat, 10_000);

    // Then
    expect(repeat).toMatchObject({ mode: "idle", revealCount: 0 });
    expect(applied).toBe(drained.state);
  });

  it("collapses an oversized backlog to its tail instead of replaying history", () => {
    // Given — a backgrounded tab throttles timers, so the queue comes back
    // hundreds of events behind. Replaying that is watching a recording.
    const history = [...initialEvents];
    const backlog = filler(EVENT_PACING.collapseAbove + 20);
    const events = [...history, ...backlog];

    // When
    const first = planEventPacing({
      state: hydratedPacing(history),
      events,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 0,
    });

    // Then — everything but the newest turn is revealed at once, with no hold,
    // and the kept tail still plays out so the jump is explained.
    expect(first).toMatchObject({
      mode: "collapse",
      waitMs: 0,
      revealCount: backlog.length - EVENT_PACING.tailKeep,
    });

    const drained = drainEventPacing(hydratedPacing(history), events, {
      selfPlayerId: "player-1",
    });
    expect(drained.modes).toEqual([
      "collapse",
      ...Array.from({ length: EVENT_PACING.tailKeep }, () => "dwell"),
    ]);
    expect(revealedEventCount(drained.state, events)).toBe(events.length);
  });

  it("compresses, then sprints, as the backlog grows — instead of drifting forever", () => {
    // Given — the server produces a bot turn every 900ms
    // (`DEFAULT_BOT_TURN_DELAY_MS`); full dwell for six events costs more than
    // that, so without compression the lag would grow every single turn.
    const history = [...initialEvents];
    const plan = (pending: number) =>
      planEventPacing({
        state: hydratedPacing(history),
        events: [...history, ...filler(pending)],
        selfPlayerId: "player-1",
        revealAll: false,
        nowMs: 0,
      });

    // Then
    expect(plan(EVENT_PACING.compressAbove).mode).toBe("dwell");
    expect(plan(EVENT_PACING.compressAbove + 1)).toMatchObject({
      mode: "compressed",
      holdMs: EVENT_PACING.compressedBeat,
    });
    expect(plan(EVENT_PACING.sprintAbove + 1)).toMatchObject({
      mode: "sprint",
      holdMs: EVENT_PACING.sprintBeat,
    });
    // The compressed beat has to out-run the server, or compression is theatre.
    expect(EVENT_PACING.compressedBeat * 6).toBeLessThan(900);
  });

  it("lets the local player's own committed action jump the queue", () => {
    // Given — a stale bot backlog with the local player's roll behind it. The
    // optimistic "Rolling" state clears when the fetch resolves, so leaving
    // their own dice queued shows them the *previous* roll's faces.
    const history = [...initialEvents];
    const events = [
      ...history,
      ...botTurn("t1", "player-2"),
      diceRolled("mine", 20, "player-1", [6]),
      event("mine-moved", "PlayerMoved", 21, "player-1"),
    ];

    // When
    const flush = planEventPacing({
      state: hydratedPacing(history),
      events,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 0,
    });
    const afterFlush = applyEventPacingStep(
      hydratedPacing(history),
      events,
      flush,
      0,
    );
    const next = planEventPacing({
      state: afterFlush,
      events,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 0,
    });

    // Then — the bot tail is revealed instantly, and the local roll itself
    // still gets its full dwell rather than being swallowed by the flush.
    expect(flush).toMatchObject({ mode: "local-flush", waitMs: 0, revealCount: 6 });
    expect(next).toMatchObject({ mode: "dwell", revealCount: 1 });
    expect(events[revealedEventCount(afterFlush, events)]?.id).toBe("mine");
  });

  it("does not flush when the local player's event is already at the front", () => {
    // Given — the guard has to be `> 0`, not `>= 0`: a `revealCount` of zero
    // would stall the queue permanently on the player's own turn.
    const history = [...initialEvents];
    const events = [...history, diceRolled("mine", 20, "player-1", [3])];

    // When
    const step = planEventPacing({
      state: hydratedPacing(history),
      events,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 0,
    });

    // Then
    expect(step.mode).toBe("dwell");
    expect(step.revealCount).toBe(1);
  });

  it("shows everything immediately for reduced motion or an explicit skip", () => {
    // Given — §7.2: reduced motion collapses the whole gameplay layer to
    // instant state changes, and the player must still be able to tell what
    // happened. Nothing is dropped; it is all revealed at once.
    const history = [...initialEvents];
    const events = [...history, ...botTurn("t1", "player-2")];

    // When
    const drained = drainEventPacing(hydratedPacing(history), events, {
      selfPlayerId: "player-1",
      revealAll: true,
    });

    // Then
    expect(drained.modes).toEqual(["instant"]);
    expect(drained.ticks).toBe(1);
    expect(revealedEventCount(drained.state, events)).toBe(events.length);
  });

  it("applies the same step twice without advancing twice", () => {
    // Given — a step is applied from inside a `setState` updater, whose
    // `previous` is not guaranteed to be the state the step was planned against.
    // A delta-based step would advance once per application and swallow the very
    // events it was pacing; an absolute target cursor cannot.
    const history = [...initialEvents];
    const events = [...history, ...botTurn("t1", "player-2")];
    const hydrated = hydratedPacing(history);
    const step = planEventPacing({
      state: hydrated,
      events,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 0,
    });

    // When
    const once = applyEventPacingStep(hydrated, events, step, 0);
    const twice = applyEventPacingStep(once, events, step, 0);

    // Then
    expect(step.revealThrough).toBe(history.length + 1);
    expect(revealedEventCount(once, events)).toBe(history.length + 1);
    expect(twice).toBe(once);
  });

  it("holds to an absolute deadline, so re-planning mid-hold cannot drift", () => {
    // Given — the 5s poll hands the hook a new array identity, which tears the
    // pending timer down and re-plans. If the wait restarted from scratch each
    // time, a poll-heavy client would stall the queue.
    const history = [...initialEvents];
    const events = [...history, ...botTurn("t1", "player-2")];
    const hydrated = hydratedPacing(history);
    const first = planEventPacing({
      state: hydrated,
      events,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 1_000,
    });
    const afterFirst = applyEventPacingStep(hydrated, events, first, 1_000);

    // When — the same plan is recomputed 100ms into a 420ms hold.
    const replanned = planEventPacing({
      state: afterFirst,
      events,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 1_100,
    });

    // Then
    expect(afterFirst.holdMs).toBe(eventDwellMs(events[history.length]!));
    expect(replanned.waitMs).toBe(afterFirst.holdMs - 100);
  });

  it("survives the server truncating its own event window", () => {
    // Given — `appendEventSummaries` keeps a sliding 200-event window and drops
    // from the front, so a stored index would point at the wrong event.
    const events = [...initialEvents, ...botTurn("t1", "player-2")];
    const drained = drainEventPacing(hydratedPacing([...initialEvents]), events, {
      selfPlayerId: "player-1",
    });

    // When — the window slides forward by two and gains one new event.
    const slid = [...events.slice(2), event("t2-start", "TurnStarted", 30, "player-2")];
    const step = planEventPacing({
      state: drained.state,
      events: slid,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 0,
    });

    // Then — only the genuinely new event is queued.
    expect(revealedEventCount(drained.state, slid)).toBe(slid.length - 1);
    expect(step).toMatchObject({ mode: "dwell", revealCount: 1 });
  });

  it("reports a stale, shorter projection as already revealed", () => {
    // Given — polls and realtime invalidations can answer out of order.
    const events = [...initialEvents, ...botTurn("t1", "player-2")];
    const drained = drainEventPacing(hydratedPacing([...initialEvents]), events, {
      selfPlayerId: "player-1",
    });

    // When
    const stale = events.slice(0, 4);
    const step = planEventPacing({
      state: drained.state,
      events: stale,
      selfPlayerId: "player-1",
      revealAll: false,
      nowMs: 0,
    });

    // Then — nothing replays, and nothing is queued.
    expect(revealedEventCount(drained.state, stale)).toBe(stale.length);
    expect(step.mode).toBe("idle");
  });

  it("gives an event that owns an animation its animation's budget", () => {
    // Then — every value comes from the shared §7.2 vocabulary, so the board
    // reads as one mechanism.
    expect(eventDwellMs(diceRolled("d", 1, "player-1", [4]))).toBe(420);
    expect(eventDwellMs(event("m", "PlayerMoved", 1, "player-1"))).toBe(420);
    expect(eventDwellMs(cardDrawn("c", 1, "player-1", "card.work.x"))).toBe(480);
    expect(eventDwellMs(event("p", "PlayerPromoted", 1, "player-1"))).toBe(320);
    expect(eventDwellMs(event("t", "TileResolved", 1, "player-1"))).toBe(
      EVENT_PACING.beat,
    );
  });
});

describe("latestRevealedEvent", () => {
  it("reads the newest revealed event, so a consumer animates on the paced beat", () => {
    // Given — a bootstrap already narrowed by the pacing cursor.
    const events = [...initialEvents, ...botTurn("t1", "player-2")];
    const bootstrap = {
      room,
      publicProjection: { eventSummaries: events.slice(0, 4) },
    } as unknown as Parameters<typeof latestRevealedEvent>[0];

    // Then
    expect(latestRevealedEvent(bootstrap)?.id).toBe("t1-moved");
    expect(latestRevealedEvent(bootstrap, "DiceRolled")?.id).toBe("t1-dice");
    expect(latestRevealedEvent(bootstrap, "MatchEnded")).toBeNull();
  });
});

function event(
  id: string,
  type: Exclude<SafeEventSummary["type"], "CardDrawn" | "DiceRolled">,
  revision: number,
  actorPlayerId: string | null,
): SafeEventSummary {
  return {
    id,
    type,
    revision,
    occurredAt: "2026-07-24T12:00:00.000Z",
    actorPlayerId,
  };
}

function diceRolled(
  id: string,
  revision: number,
  actorPlayerId: string | null,
  dice: readonly number[],
  purpose = "normal-movement",
): Extract<SafeEventSummary, { readonly type: "DiceRolled" }> {
  return {
    id,
    type: "DiceRolled",
    revision,
    occurredAt: "2026-07-24T12:00:00.000Z",
    actorPlayerId,
    dice,
    total: dice.reduce((sum, face) => sum + face, 0),
    purpose,
  };
}

function cardDrawn(
  id: string,
  revision: number,
  actorPlayerId: string | null,
  definitionId: string,
): Extract<SafeEventSummary, { readonly type: "CardDrawn" }> {
  return {
    id,
    type: "CardDrawn",
    revision,
    occurredAt: "2026-07-24T12:00:00.000Z",
    actorPlayerId,
    card: {
      definitionId,
      deckId: "deck.work",
      nameKey: "deadlineDash.card.test.name",
    },
  };
}
