// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GameBootstrap,
  LegalActionSummary,
  SafeEventSummary,
} from "@office-ladder/contracts";

import { GameFeedback } from "./game-feedback";

const toastInfo = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { info: toastInfo },
}));

const renderedRoots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  for (const root of renderedRoots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GameFeedback", () => {
  it("suppresses hydrated history and opens a newly committed authored card", async () => {
    // Given
    const view = renderFeedback(bootstrap([event("event-1", "TurnStarted", 1)]));

    // When
    await view.render(
      bootstrap([
        event("event-1", "TurnStarted", 1),
        cardDrawn("event-2", 2, overtimeBonus),
      ]),
    );

    // Then
    expect(dialogTitle()).toBe("Overtime bonus");
    expect(document.body.textContent).toContain("Gain $150.");
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("shows multiple card draws one at a time in server order", async () => {
    // Given
    const view = renderFeedback(bootstrap([]));

    // When
    await view.render(
      bootstrap([
        cardDrawn("event-1", 1, printerJam),
        cardDrawn("event-2", 2, surpriseBonus),
      ]),
    );

    // Then
    expect(dialogTitle()).toBe("Printer jam");
    await clickButton("Continue");
    expect(dialogTitle()).toBe("Surprise bonus");
    await clickButton("Continue");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps generic activity toasts while excluding card draws from their copy", async () => {
    // Given
    const view = renderFeedback(bootstrap([]));

    // When
    await view.render(
      bootstrap([
        event("event-1", "PlayerMoved", 1),
        cardDrawn("event-2", 2, mentorship),
      ]),
    );

    // Then
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith(
      "Activity updated",
      expect.objectContaining({ id: "event-1" }),
    );
    expect(dialogTitle()).toBe("Mentorship");
  });

  it("gives an actionable audit prompt priority and resumes the card queue afterward", async () => {
    // Given
    const view = renderFeedback(bootstrap([]));
    const events = [cardDrawn("event-1", 1, freeCoffee)];

    // When
    await view.render(bootstrap(events, [auditPrompt]));

    // Then
    expect(dialogTitle()).toBe("Audit review");

    // When
    await view.render(bootstrap(events));

    // Then
    expect(dialogTitle()).toBe("Free coffee");
    expect(document.body.textContent).toContain("Restore energy to maximum.");
  });

  it("does not invent a fallback dialog for an unknown card definition", async () => {
    // Given
    const view = renderFeedback(bootstrap([]));

    // When
    await view.render(
      bootstrap([
        cardDrawn("event-1", 1, {
          definitionId: "card.unknown",
          deckId: "deck.work",
          nameKey: "deadlineDash.card.unknown.name",
        }),
      ]),
    );

    // Then
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("rejects a card when its authored deck does not match the payload", async () => {
    // Given
    const view = renderFeedback(bootstrap([]));

    // When
    await view.render(
      bootstrap([
        cardDrawn("event-1", 1, { ...overtimeBonus, deckId: "deck.event" }),
      ]),
    );

    // Then
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("rejects a card when its authored name key does not match the payload", async () => {
    // Given
    const view = renderFeedback(bootstrap([]));

    // When
    await view.render(
      bootstrap([
        cardDrawn("event-1", 1, {
          ...overtimeBonus,
          nameKey: "deadlineDash.card.workPrinterJam.name",
        }),
      ]),
    );

    // Then
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("reports queued card feedback while an ended projection waits for completion", async () => {
    // Given
    const onIdleChange = vi.fn();
    const view = renderFeedback(bootstrap([]), onIdleChange);

    // When
    await view.render(
      bootstrap([cardDrawn("event-1", 1, overtimeBonus)], [], "ended"),
    );

    // Then
    expect(dialogTitle()).toBe("Overtime bonus");
    expect(onIdleChange).toHaveBeenLastCalledWith(false);

    // When
    await clickButton("Continue");

    // Then
    expect(onIdleChange).toHaveBeenLastCalledWith(true);
  });
});

const auditPrompt = {
  type: "prompt.respond",
  expectedRevision: 1,
  decisionPointId: "decision-1",
  kind: "audit-release",
  options: ["pay-fine", "attempt-roll"],
} satisfies Extract<LegalActionSummary, { readonly type: "prompt.respond" }>;

function renderFeedback(
  initialBootstrap: GameBootstrap,
  onIdleChange: (idle: boolean) => void = vi.fn(),
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  renderedRoots.push(root);
  act(() => {
    root.render(
      <GameFeedback
        bootstrap={initialBootstrap}
        error={null}
        isResponding={false}
        onIdleChange={onIdleChange}
        onRespond={vi.fn()}
      />,
    );
  });
  return {
    render: async (nextBootstrap: GameBootstrap): Promise<void> => {
      await act(async () => {
        root.render(
          <GameFeedback
            bootstrap={nextBootstrap}
            error={null}
            isResponding={false}
            onIdleChange={onIdleChange}
            onRespond={vi.fn()}
          />,
        );
      });
    },
  };
}

function bootstrap(
  events: readonly SafeEventSummary[],
  legalActions: readonly LegalActionSummary[] = [],
  status: GameBootstrap["publicProjection"]["status"] = "active",
): GameBootstrap {
  return {
    room: {
      id: "room-1",
      code: "Q4W8ZT",
      status: status === "ended" ? "completed" : "active",
      mode: "mode.quick",
      capacity: 6,
      revision: events.at(-1)?.revision ?? 0,
      members: [
        {
          id: "player-1",
          displayName: "Avery",
          seat: 1,
          isHost: true,
          isReady: true,
          isConnected: true,
        },
      ],
    },
    publicProjection: {
      id: "game-1",
      revision: events.at(-1)?.revision ?? 0,
      status,
      activePlayerId: "player-1",
      turnNumber: 1,
      round: 1,
      phase: "awaiting-roll",
      deadlineAt: null,
      players: [],
      eventSummaries: events,
      winnerPlayerIds: [],
    },
    self: {
      playerId: "player-1",
      role: { id: "role-1", kind: "role.worker", revealed: true },
      characterId: "character.workaholic",
      hand: [],
      privateStatusIds: [],
      abilityIds: [],
    },
    prompts: [],
    reactions: [],
    legalActions,
    serverTime: "2026-07-24T12:00:00.000Z",
  };
}

function event(
  id: string,
  type: Exclude<SafeEventSummary["type"], "CardDrawn">,
  revision: number,
): SafeEventSummary {
  return {
    id,
    type,
    revision,
    occurredAt: "2026-07-24T12:00:00.000Z",
    actorPlayerId: "player-1",
  };
}

function cardDrawn(
  id: string,
  revision: number,
  card: Extract<SafeEventSummary, { readonly type: "CardDrawn" }>["card"],
): Extract<SafeEventSummary, { readonly type: "CardDrawn" }> {
  return {
    id,
    type: "CardDrawn",
    revision,
    occurredAt: "2026-07-24T12:00:00.000Z",
    actorPlayerId: "player-1",
    card,
  };
}

const overtimeBonus = {
  definitionId: "card.work.overtime-bonus",
  deckId: "deck.work",
  nameKey: "deadlineDash.card.workOvertimeBonus.name",
} as const;

const printerJam = {
  definitionId: "card.work.printer-jam",
  deckId: "deck.work",
  nameKey: "deadlineDash.card.workPrinterJam.name",
} as const;

const surpriseBonus = {
  definitionId: "card.event.surprise-bonus",
  deckId: "deck.event",
  nameKey: "deadlineDash.card.eventSurpriseBonus.name",
} as const;

const mentorship = {
  definitionId: "card.work.mentorship",
  deckId: "deck.work",
  nameKey: "deadlineDash.card.workMentorship.name",
} as const;

const freeCoffee = {
  definitionId: "card.work.free-coffee",
  deckId: "deck.work",
  nameKey: "deadlineDash.card.workFreeCoffee.name",
} as const;

function dialogTitle(): string | null {
  return document.body.querySelector('[data-slot="dialog-title"]')?.textContent ?? null;
}

async function clickButton(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Expected button labeled ${label}.`);
  }
  await act(async () => button.click());
}
