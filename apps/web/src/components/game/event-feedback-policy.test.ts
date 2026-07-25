import { describe, expect, it } from "vitest";

import type {
  LegalActionSummary,
  RoomProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";

import {
  createEventFeedbackState,
  findLocalPromptAction,
  reduceEventFeedback,
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
    },
    {
      id: "player-2",
      displayName: "Morgan",
      seat: 2,
      isHost: false,
      isReady: true,
      isConnected: true,
    },
  ],
} satisfies RoomProjection;

const initialEvents = [
  event("event-1", "TurnStarted", 1, "player-1"),
  cardDrawn("event-2", 2, "player-1", "card.work.overtime-bonus"),
] as const;

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

function event(
  id: string,
  type: Exclude<SafeEventSummary["type"], "CardDrawn">,
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
