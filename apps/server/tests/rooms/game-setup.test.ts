import { describe, expect, it } from "vitest";

import {
  createStableId,
  type CardDrawnEvent,
  type GameStartedEvent,
} from "@office-ladder/engine";
import { eventSummaries } from "../../src/rooms/service/game-setup";

const actorId = createStableId("PlayerId", "command-actor");
const drawnByPlayerId = createStableId("PlayerId", "card-recipient");

describe("eventSummaries", () => {
  it("Given CardDrawn and non-card events, When creating summaries, Then only CardDrawn retains its safe card metadata and payload actor", () => {
    const cardDrawn = {
      eventId: createStableId("EventId", "event-card-drawn"),
      gameId: createStableId("GameId", "game-event-summary"),
      sequence: 4,
      revision: 2,
      causationCommandId: createStableId("CommandId", "command-event-summary"),
      correlationFrameId: null,
      logicalTimestamp: "2026-07-24T12:00:00.000Z",
      schemaVersion: 1,
      visibility: { kind: "public" },
      type: "CardDrawn",
      payload: {
        playerId: drawnByPlayerId,
        cardId: createStableId("CardDefinitionId", "card.event.jackpot"),
        deckId: createStableId("DeckId", "deck.event"),
        nameKey: "deadlineDash.card.eventJackpot.name",
      },
    } satisfies CardDrawnEvent;
    const gameStarted = {
      ...cardDrawn,
      eventId: createStableId("EventId", "event-game-started"),
      type: "GameStarted",
      payload: { playerOrder: [actorId] },
    } satisfies GameStartedEvent;

    const summaries = eventSummaries([cardDrawn, gameStarted], actorId);

    expect(summaries).toEqual([
      {
        id: "event-card-drawn",
        type: "CardDrawn",
        revision: 2,
        occurredAt: "2026-07-24T12:00:00.000Z",
        actorPlayerId: "card-recipient",
        card: {
          definitionId: "card.event.jackpot",
          deckId: "deck.event",
          nameKey: "deadlineDash.card.eventJackpot.name",
        },
      },
      {
        id: "event-game-started",
        type: "GameStarted",
        revision: 2,
        occurredAt: "2026-07-24T12:00:00.000Z",
        actorPlayerId: "command-actor",
      },
    ]);
  });
});
