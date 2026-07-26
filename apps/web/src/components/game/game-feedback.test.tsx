// @vitest-environment jsdom

import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GameBootstrap,
  LegalActionSummary,
  PublicPlayerProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import {
  CardDrawDialog,
  resolveAuthoredCardDraw,
  type AuthoredCardDraw,
} from "./card-draw-dialog";
import type { CardDrawNotice } from "./event-feedback-policy";
import { CARD_HOLD_MS, cardHoldMs, CardDrawFeed, GameFeedback } from "./game-feedback";

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: toastMock }));

const renderedRoots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  /*
   * Motion's own testing switch. Nothing here asserts an animation — the point
   * of these tests is the opposite, that every fact is in the MARKUP and the
   * queue behaves the same whether or not anything moved. Skipping animations
   * makes `AnimatePresence` resolve its exits immediately, so "the notice is
   * gone" means gone rather than mid-transition.
   */
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(() => {
  for (const root of renderedRoots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
  MotionGlobalConfig.skipAnimations = false;
});

/* ------------------------------------------------------------------------- */
/* The blocking rule: a prompt may cover the board; nothing else may.        */
/* ------------------------------------------------------------------------- */

describe("card draws are never blocking", () => {
  it("renders a newly committed draw as a docked notice, not a dialog or backdrop", async () => {
    // Given
    const view = renderCardFeed({
      bootstrap: bootstrap([event("event-1", "TurnStarted", 1)]),
    });

    // When
    await view.render({
      bootstrap: bootstrap([
        event("event-1", "TurnStarted", 1),
        cardDrawn("event-2", 2, overtimeBonus),
      ]),
    });

    // Then
    expect(cardNotice()?.getAttribute("data-card-definition-id")).toBe(
      overtimeBonus.definitionId,
    );
    expect(cardNotice()?.getAttribute("data-blocking")).toBe("false");
    expect(openDialog()).toBeNull();
    expect(document.body.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("does not block on a draw by an opponent either, and labels it as theirs", async () => {
    // Given
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([cardDrawn("event-1", 1, printerJam, "player-2")]),
    });

    // Then
    expect(openDialog()).toBeNull();
    expect(cardNotice()?.getAttribute("data-card-audience")).toBe("theirs");
    expect(cardNoticeText()).toContain("Opponent card");
    expect(cardNoticeText()).toContain("Bo");
  });

  it("labels the local player's own draw as theirs to distinguish it in markup", async () => {
    // Given
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([cardDrawn("event-1", 1, printerJam)]),
    });

    // Then
    expect(cardNotice()?.getAttribute("data-card-audience")).toBe("mine");
    expect(cardNoticeText()).toContain("Your card");
    expect(cardNoticeText()).toContain("You");
  });

  it("suppresses hydrated history so a reload does not replay old draws", async () => {
    // Given — the first read is history, whoever it belonged to.
    const view = renderCardFeed({
      bootstrap: bootstrap([cardDrawn("event-1", 1, overtimeBonus)]),
    });

    // Then
    expect(cardNotice()).toBeNull();

    // When — the same events arrive again on the next poll.
    await view.render({
      bootstrap: bootstrap([cardDrawn("event-1", 1, overtimeBonus)]),
    });

    // Then
    expect(cardNotice()).toBeNull();
  });
});

describe("card draw queue", () => {
  it("shows multiple draws one at a time in server order and loses none", async () => {
    // Given
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([
        cardDrawn("event-1", 1, printerJam),
        cardDrawn("event-2", 2, surpriseBonus),
      ]),
    });

    // Then
    expect(cardNotice()?.getAttribute("data-card-definition-id")).toBe(
      printerJam.definitionId,
    );
    expect(queuedLine()).toContain("1 more card");

    // When
    await dismissCardNotice();

    // Then
    expect(cardNotice()?.getAttribute("data-card-definition-id")).toBe(
      surpriseBonus.definitionId,
    );
    expect(queuedLine()).toBeNull();

    // When
    await dismissCardNotice();

    // Then
    expect(cardNotice()).toBeNull();
  });

  it("clears the notice on its own, with no click, once the hold elapses", async () => {
    // Given
    vi.useFakeTimers();
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([cardDrawn("event-1", 1, overtimeBonus)]),
    });

    // Then
    expect(cardNotice()).not.toBeNull();

    // When
    await act(async () => {
      vi.advanceTimersByTime(CARD_HOLD_MS.mine + 1);
    });

    // Then
    expect(cardNotice()).toBeNull();
  });

  it("holds a draw rather than dropping it while a decision prompt owns the screen", async () => {
    // Given
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When — a card and an actionable prompt land in the same projection.
    await view.render({
      bootstrap: bootstrap([cardDrawn("event-1", 1, overtimeBonus)], [auditPrompt]),
    });

    // Then
    expect(cardNotice()).toBeNull();

    // When — the prompt is answered and the projection no longer offers it.
    await view.render({
      bootstrap: bootstrap([cardDrawn("event-1", 1, overtimeBonus)]),
    });

    // Then
    expect(cardNotice()?.getAttribute("data-card-definition-id")).toBe(
      overtimeBonus.definitionId,
    );
  });

  it("does not invent a notice for an unknown card definition", async () => {
    // Given
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([
        cardDrawn("event-1", 1, {
          definitionId: "card.unknown",
          deckId: "deck.work",
          nameKey: "deadlineDash.card.unknown.name",
        }),
      ]),
    });

    // Then
    expect(cardNotice()).toBeNull();
    expect(openDialog()).toBeNull();
  });

  it("rejects a card when its authored deck does not match the payload", async () => {
    // Given
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([
        cardDrawn("event-1", 1, { ...overtimeBonus, deckId: "deck.event" }),
      ]),
    });

    // Then
    expect(cardNotice()).toBeNull();
  });

  it("rejects a card when its authored name key does not match the payload", async () => {
    // Given
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([
        cardDrawn("event-1", 1, {
          ...overtimeBonus,
          nameKey: "deadlineDash.card.workPrinterJam.name",
        }),
      ]),
    });

    // Then
    expect(cardNotice()).toBeNull();
  });

  it("announces every draw politely, so the notice is not the only evidence", async () => {
    // Given
    const view = renderCardFeed({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([cardDrawn("event-1", 1, overtimeBonus)]),
    });

    // Then
    const spoken = liveRegions().at(-1) ?? "";
    expect(spoken).toContain("You drew Overtime Authorized from the Work deck.");
    expect(spoken).toContain("Gain $150.");
  });

  it("compresses the hold when draws pile up instead of dropping any of them", () => {
    // Given
    const mine = authoredDraw("local", "Avery");
    const theirs = authoredDraw("remote", "Bo");

    // Then
    expect(cardHoldMs(mine, 1)).toBe(CARD_HOLD_MS.mine);
    expect(cardHoldMs(theirs, 2)).toBe(CARD_HOLD_MS.theirs);
    expect(cardHoldMs(mine, 4)).toBe(CARD_HOLD_MS.catchUp);
    expect(cardHoldMs(theirs, 4)).toBe(CARD_HOLD_MS.catchUp);
    expect(cardHoldMs(mine, 9)).toBe(CARD_HOLD_MS.minimum);
  });
});

describe("card notice markup", () => {
  it("carries the authored name, flavor and signed effect deltas on the first render", () => {
    // Given — no browser, no effects, no animation frame: exactly what a
    // reduced-motion player must still be able to read.
    const draw = authoredDraw("local", "Avery");

    // When
    const markup = renderToStaticMarkup(
      <CardDrawDialog blocked={false} draw={draw} onContinue={noop} />,
    );

    // Then
    expect(markup).toContain("Overtime Authorized");
    expect(markup).toContain("Payroll processed the extra hours without comment.");
    expect(markup).toContain("Work deck");
    expect(markup).toContain("+150");
    expect(markup).toContain("MONEY");
    expect(markup).toContain("Gain $150.");
    expect(markup).toContain('data-blocking="false"');
    expect(markup).toContain('data-card-audience="mine"');
    expect(markup).not.toContain('role="dialog"');
  });

  it("renders nothing at all while a decision prompt owns the screen", () => {
    // When
    const markup = renderToStaticMarkup(
      <CardDrawDialog blocked draw={authoredDraw("local", "Avery")} onContinue={noop} />,
    );

    // Then
    expect(markup).toBe("");
  });
});

describe("GameFeedback overlays versus the activity log", () => {
  it("routes routine committed events to the log instead of a toast, but still announces them", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([
        event("event-1", "PlayerMoved", 1),
        event("event-2", "ResourceChanged", 2),
      ]),
    });

    // Then
    expect(toastMock).not.toHaveBeenCalled();
    expect(announcement()).toBe("2 updates committed. Latest: Avery · ResourceChanged");
  });

  it("interrupts with a toast when the caller's own automatic promotion commits", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({ bootstrap: bootstrap([event("event-1", "PlayerPromoted", 1)]) });

    // Then
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      "Promotion committed",
      expect.objectContaining({
        description:
          "You met the next rank's cost, so the promotion was applied automatically.",
        id: "event-1",
      }),
    );
  });

  it("does not interrupt for another seat's promotion", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([event("event-1", "PlayerPromoted", 1, "player-2")]),
    });

    // Then
    expect(toastMock).not.toHaveBeenCalled();
    expect(announcement()).toBe("Bo · PlayerPromoted");
  });
});

describe("GameFeedback idle reporting (the winner gate)", () => {
  it("reports idle as soon as the processed revision owes the server no decision", async () => {
    // Given — a card draw in the closing projection. It self-dismisses, so it
    // must NOT hold the match report back.
    const onIdleChange = vi.fn();
    const view = renderFeedback({ bootstrap: bootstrap([]), onIdleChange });

    // When
    await view.render({
      bootstrap: bootstrap([cardDrawn("event-1", 1, overtimeBonus)], [], "ended"),
    });

    // Then
    expect(onIdleChange).toHaveBeenLastCalledWith(true);
  });

  it("reports not-idle while the local player still owes a decision", async () => {
    // Given
    const onIdleChange = vi.fn();
    const view = renderFeedback({ bootstrap: bootstrap([]), onIdleChange });

    // When
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "ended", { money: 1000 }),
    });

    // Then
    expect(onIdleChange).toHaveBeenLastCalledWith(false);

    // When — the prompt is filed and the projection stops offering it.
    await view.render({ bootstrap: bootstrap([], [], "ended", { money: 500 }) });

    // Then
    expect(onIdleChange).toHaveBeenLastCalledWith(true);
  });
});

describe("GameFeedback decision prompt", () => {
  it("states both audit-release responses, their real cost, and the failure case", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "active", { money: 1000 }),
    });

    // Then
    expect(dialogTitle()).toBe("Audit review");
    expect(openDialog()?.getAttribute("data-prompt-kind")).toBe("audit-release");
    expect(openDialog()?.getAttribute("data-decision-point-id")).toBe("decision-1");

    const text = dialogText();
    expect(text).toContain("Pay the fine");
    expect(text).toContain("-$500");
    expect(text).toContain("released immediately");
    expect(text).toContain("Attempt release roll");
    expect(text).toContain("No fee");
    expect(text).toContain("Matching faces release you");
    expect(text).toContain("keeps this notice open and asks you again next turn");
    expect(text).toContain("On hand $1,000 -> $500 after settlement.");
  });

  it("shows the caller's money in the notice header so paying is an informed choice", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "active", { money: 1000 }),
    });

    // Then
    expect(
      document.body.querySelector('[data-slot="prompt-money"]')?.textContent,
    ).toBe("$1,000");
  });

  it("reflects that the engine clamps an unaffordable fine instead of rejecting it", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "active", { money: 320 }),
    });

    // Then
    const payFine = optionButton("pay-fine");
    expect(payFine?.disabled).toBe(false);
    expect(dialogText()).toContain("-$320");
    expect(dialogText()).toContain(
      "Recorded fine $500; you hold $320. The balance floors at $0 and the release still stands.",
    );
  });

  it("reports the balance as unavailable rather than guessing at zero", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({ bootstrap: bootstrap([], [auditPrompt]) });

    // Then
    expect(
      document.body.querySelector('[data-slot="prompt-money"]')?.textContent,
    ).toBe("Unavailable");
  });

  it("marks exactly one primary action and keeps every response keyboard operable", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "active", { money: 1000 }),
    });

    // Then
    const buttons = optionButtons();
    expect(buttons.map((button) => button.getAttribute("data-option-id"))).toEqual([
      "pay-fine",
      "attempt-roll",
    ]);
    expect(
      buttons.filter((button) => button.className.includes("overlay-action-primary")),
    ).toHaveLength(1);
    expect(optionButton("attempt-roll")?.className).toContain(
      "overlay-action-primary",
    );
    for (const button of buttons) {
      expect(button.type).toBe("button");
    }
  });

  it("sends the option id the server offered", async () => {
    // Given
    const onRespond = vi.fn();
    const view = renderFeedback({ bootstrap: bootstrap([]), onRespond });

    // When
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "active", { money: 1000 }),
    });
    await click(optionButton("pay-fine"));

    // Then
    expect(onRespond).toHaveBeenCalledWith("pay-fine");
  });

  it("locks both responses and reports progress while the response is in flight", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "active", { money: 1000 }),
      isResponding: true,
    });

    // Then
    expect(openDialog()?.getAttribute("aria-busy")).toBe("true");
    expect(optionButtons().every((button) => button.disabled)).toBe(true);
    expect(dialogText()).toContain("Filing response with the server.");
  });

  it("surfaces a rejected response as an alert without closing the notice", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "active", { money: 1000 }),
      error: "That response was not accepted.",
    });

    // Then
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "That response was not accepted.",
    );
    expect(dialogTitle()).toBe("Audit review");
  });

  it("renders the authored tile decision and disables an accept the engine would reject", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap([], [trainingPrompt], "active", { money: 100 }),
    });

    // Then
    expect(dialogTitle()).toBe("Training course");
    expect(dialogText()).toContain("-$300");
    expect(dialogText()).toContain("Totals 7-12: gain 3 reputation.");
    expect(optionButton("enroll")?.disabled).toBe(true);
    expect(optionButton("decline")?.disabled).toBe(false);
    expect(optionButton("decline")?.className).toContain("overlay-action-primary");
    expect(dialogText()).toContain(
      "The server rejects a deal the acting player cannot pay for.",
    );
  });

  it("renders a correct generic notice for a prompt kind it has never seen", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({ bootstrap: bootstrap([], [unknownPrompt]) });

    // Then
    expect(dialogTitle()).toBe("Reaction window");
    const text = dialogText();
    expect(text).toContain("Reaction play");
    expect(text).toContain("Reaction pass");
    expect(text).toContain("Not stated");
    expect(
      optionButtons().map((button) => button.getAttribute("data-option-id")),
    ).toEqual(["reaction.play", "reaction.pass"]);
    expect(optionButton("reaction.pass")?.className).toContain(
      "overlay-action-primary",
    );
  });

  it("always leaves at least one enabled response, so the notice is never a dead end", async () => {
    // Given — the notice refuses escape, refuses an outside press and hides its
    // close button, so a keyboard user is only safe if something in it is
    // actionable (§8).
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    for (const prompt of [auditPrompt, trainingPrompt, unknownPrompt]) {
      await view.render({
        bootstrap: bootstrap([], [prompt], "active", { money: 100 }),
      });

      // Then
      expect(openDialog()).not.toBeNull();
      expect(optionButtons().filter((button) => !button.disabled).length).toBeGreaterThan(0);
    }
  });

  it("shows the board instead of an unanswerable notice when no response is offered", async () => {
    // Given — a prompt with no options cannot be filed, and a non-dismissable
    // modal with no focusable control would trap a keyboard user with nothing to
    // do. The board's floor plate already reports "Decision required".
    const view = renderFeedback({ bootstrap: bootstrap([]) });

    // When
    await view.render({
      bootstrap: bootstrap(
        [],
        [{ ...auditPrompt, options: [] }],
        "active",
        { money: 1000 },
      ),
    });

    // Then
    expect(openDialog()).toBeNull();
  });

  it("refuses escape while a decision is pending", async () => {
    // Given
    const view = renderFeedback({ bootstrap: bootstrap([]) });
    await view.render({
      bootstrap: bootstrap([], [auditPrompt], "active", { money: 1000 }),
    });

    // When
    await pressEscape();

    // Then
    expect(dialogTitle()).toBe("Audit review");
  });
});

describe("Dialog primitive", () => {
  it("closes a dismissable dialog on escape, proving the prompt's refusal is real", async () => {
    // Given
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    renderedRoots.push(root);

    // When
    act(() => {
      root.render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Dismissable</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
    });

    // Then
    expect(dialogTitle()).toBe("Dismissable");

    // When
    await pressEscape();

    // Then
    expect(openDialog()).toBeNull();
  });
});

const auditPrompt = {
  type: "prompt.respond",
  expectedRevision: 1,
  decisionPointId: "decision-1",
  kind: "audit-release",
  options: ["pay-fine", "attempt-roll"],
} satisfies Extract<LegalActionSummary, { readonly type: "prompt.respond" }>;

const trainingPrompt = {
  type: "prompt.respond",
  expectedRevision: 1,
  decisionPointId: "decision-3",
  kind: "training-course",
  options: ["enroll", "decline"],
} satisfies Extract<LegalActionSummary, { readonly type: "prompt.respond" }>;

const unknownPrompt = {
  type: "prompt.respond",
  expectedRevision: 1,
  decisionPointId: "decision-2",
  kind: "reaction-window",
  options: ["reaction.play", "reaction.pass"],
} satisfies Extract<LegalActionSummary, { readonly type: "prompt.respond" }>;

type FeedbackProps = {
  readonly bootstrap: GameBootstrap;
  readonly error?: string | null;
  readonly isResponding?: boolean;
  readonly onIdleChange?: (idle: boolean) => void;
  readonly onRespond?: (optionId: string) => void;
};

function renderFeedback(initialProps: FeedbackProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  renderedRoots.push(root);
  const element = (props: FeedbackProps) => (
    <GameFeedback
      bootstrap={props.bootstrap}
      error={props.error ?? null}
      isResponding={props.isResponding ?? false}
      onIdleChange={props.onIdleChange ?? noop}
      onRespond={props.onRespond ?? noop}
    />
  );

  act(() => {
    root.render(element(initialProps));
  });

  return {
    render: async (nextProps: FeedbackProps): Promise<void> => {
      await act(async () => {
        root.render(element({ ...initialProps, ...nextProps }));
      });
    },
  };
}

function renderCardFeed(initialProps: { readonly bootstrap: GameBootstrap }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  renderedRoots.push(root);

  act(() => {
    root.render(<CardDrawFeed bootstrap={initialProps.bootstrap} />);
  });

  return {
    render: async (next: { readonly bootstrap: GameBootstrap }): Promise<void> => {
      await act(async () => {
        root.render(<CardDrawFeed bootstrap={next.bootstrap} />);
      });
    },
  };
}

function noop(): void {
  // Intentionally empty: the default callback for props a test does not assert.
}

function bootstrap(
  events: readonly SafeEventSummary[],
  legalActions: readonly LegalActionSummary[] = [],
  status: GameBootstrap["publicProjection"]["status"] = "active",
  options: { readonly money?: number } = {},
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
          isBot: false,
          botDifficulty: null,
          avatarUrl: null,
          characterId: null,
          characterLabel: null,
        },
        {
          id: "player-2",
          displayName: "Bo",
          seat: 2,
          isHost: false,
          isReady: true,
          isConnected: true,
          isBot: true,
          botDifficulty: "standard",
          avatarUrl: null,
          characterId: null,
          characterLabel: null,
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
      turnTimerDurationMs: null,
      players: options.money === undefined ? [] : [selfPlayer(options.money)],
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

function selfPlayer(money: number): PublicPlayerProjection {
  return {
    id: "player-1",
    seat: 1,
    connected: true,
    position: 22,
    lapsCompleted: 0,
    rank: { id: "rank.intern", kind: "rank.intern", index: 0 },
    role: { revealed: true, kind: "role.worker" },
    resources: { money, reputation: 4, energy: 6 },
    tokens: {},
    statusIds: [],
  };
}

function event(
  id: string,
  type: Exclude<SafeEventSummary["type"], "CardDrawn" | "DiceRolled">,
  revision: number,
  actorPlayerId = "player-1",
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
  card: Extract<SafeEventSummary, { readonly type: "CardDrawn" }>["card"],
  actorPlayerId = "player-1",
): Extract<SafeEventSummary, { readonly type: "CardDrawn" }> {
  return {
    id,
    type: "CardDrawn",
    revision,
    occurredAt: "2026-07-24T12:00:00.000Z",
    actorPlayerId,
    card,
  };
}

/**
 * A resolved draw built straight from the authored content pack, for the tests
 * that render the notice on its own rather than driving it through a projection.
 */
function authoredDraw(
  actorKind: CardDrawNotice["actorKind"],
  actorName: string,
): AuthoredCardDraw {
  const draw = resolveAuthoredCardDraw({
    eventId: "event-1",
    revision: 7,
    actorKind,
    actorName,
    card: overtimeBonus,
  });
  if (draw === null) throw new Error("Expected the authored overtime-bonus card.");

  return draw;
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

function openDialog(): Element | null {
  return document.body.querySelector('[role="dialog"]');
}

function dialogTitle(): string | null {
  return (
    document.body.querySelector('[data-slot="dialog-title"]')?.textContent ?? null
  );
}

function dialogText(): string {
  return document.body.querySelector('[data-slot="dialog-content"]')?.textContent ?? "";
}

function announcement(): string {
  return document.body.querySelector('[aria-live="polite"]')?.textContent ?? "";
}

function liveRegions(): readonly string[] {
  return [...document.body.querySelectorAll('[aria-live="polite"]')].map(
    (node) => node.textContent ?? "",
  );
}

function cardNotice(): Element | null {
  return document.body.querySelector('[data-slot="card-notice"]');
}

function cardNoticeText(): string {
  return cardNotice()?.textContent ?? "";
}

function queuedLine(): string | null {
  return (
    document.body.querySelector('[data-slot="card-feed-queued"]')?.textContent ?? null
  );
}

function optionButtons(): readonly HTMLButtonElement[] {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '[data-slot="dialog-content"] button[data-option-id]',
    ),
  ];
}

function optionButton(optionId: string): HTMLButtonElement | null {
  return (
    optionButtons().find(
      (button) => button.getAttribute("data-option-id") === optionId,
    ) ?? null
  );
}

async function click(button: HTMLButtonElement | null): Promise<void> {
  if (button === null) throw new TypeError("Expected a rendered button.");
  await act(async () => button.click());
}

async function dismissCardNotice(): Promise<void> {
  const button = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="card-notice-dismiss"]',
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError("Expected the card notice's dismiss control.");
  }
  await click(button);
}

async function pressEscape(): Promise<void> {
  const target = document.body.querySelector('[data-slot="dialog-content"]') ?? document;
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  });
}
