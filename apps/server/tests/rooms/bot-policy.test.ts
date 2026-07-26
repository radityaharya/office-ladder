import { describe, expect, it } from "vitest";

import { createStableId, type LegalAction } from "@office-ladder/engine";
import {
  AUDIT_RELEASE_FINE,
  decideBotAction,
} from "../../src/rooms/bots/bot-policy";

const botPlayerId = createStableId("PlayerId", "bot:room-policy-test:0");
const gameId = createStableId("GameId", "game-policy-test");
const decisionPointId = createStableId("DecisionPointId", "prompt-audit-release");

function rollAction(): LegalAction {
  return {
    gameId,
    actorId: botPlayerId,
    expectedRevision: 7,
    type: "turn.roll",
    payload: {},
  };
}

function auditPromptAction(
  options: readonly string[] = ["pay-fine", "attempt-roll"],
): LegalAction {
  return {
    gameId,
    actorId: botPlayerId,
    expectedRevision: 7,
    type: "prompt.respond",
    decisionPointId,
    kind: "audit-release",
    options: options.map((option) => createStableId("PromptOptionId", option)),
  };
}

describe("decideBotAction", () => {
  it("Given the content pack, When reading the audit fine, Then it matches the authored alternativeFine", () => {
    expect(AUDIT_RELEASE_FINE).toBe(500);
  });

  it("Given an easy bot with plenty of money, When an audit prompt is open, Then it gambles on the roll", () => {
    const decision = decideBotAction({
      legalActions: [auditPromptAction()],
      difficulty: "easy",
      money: 100_000,
    });

    expect(decision).toEqual({
      kind: "respond",
      decisionPointId: "prompt-audit-release",
      optionId: "attempt-roll",
    });
  });

  it("Given a standard bot with a comfortable balance, When an audit prompt is open, Then it pays the fine", () => {
    const decision = decideBotAction({
      legalActions: [auditPromptAction()],
      difficulty: "standard",
      money: AUDIT_RELEASE_FINE * 2,
    });

    expect(decision).toMatchObject({ kind: "respond", optionId: "pay-fine" });
  });

  it("Given a standard bot one coin short of its cushion, When an audit prompt is open, Then it gambles instead", () => {
    const decision = decideBotAction({
      legalActions: [auditPromptAction()],
      difficulty: "standard",
      money: AUDIT_RELEASE_FINE * 2 - 1,
    });

    expect(decision).toMatchObject({ kind: "respond", optionId: "attempt-roll" });
  });

  it("Given a ruthless bot that can just cover the fine, When an audit prompt is open, Then it pays", () => {
    const decision = decideBotAction({
      legalActions: [auditPromptAction()],
      difficulty: "ruthless",
      money: AUDIT_RELEASE_FINE,
    });

    expect(decision).toMatchObject({ kind: "respond", optionId: "pay-fine" });
  });

  it("Given a ruthless bot that cannot afford the fine, When an audit prompt is open, Then it gambles", () => {
    const decision = decideBotAction({
      legalActions: [auditPromptAction()],
      difficulty: "ruthless",
      money: AUDIT_RELEASE_FINE - 1,
    });

    expect(decision).toMatchObject({ kind: "respond", optionId: "attempt-roll" });
  });

  it("Given a prompt that does not offer the preferred option, When deciding, Then it falls back to an offered one", () => {
    const decision = decideBotAction({
      legalActions: [auditPromptAction(["attempt-roll"])],
      difficulty: "ruthless",
      money: 100_000,
    });

    expect(decision).toEqual({
      kind: "respond",
      decisionPointId: "prompt-audit-release",
      optionId: "attempt-roll",
    });
  });

  it("Given a prompt with no options at all, When deciding, Then no action is taken", () => {
    const decision = decideBotAction({
      legalActions: [auditPromptAction([])],
      difficulty: "standard",
      money: 100_000,
    });

    expect(decision).toEqual({ kind: "none" });
  });

  it("Given only a roll is legal, When deciding, Then every difficulty rolls", () => {
    for (const difficulty of ["easy", "standard", "ruthless"] as const) {
      expect(
        decideBotAction({ legalActions: [rollAction()], difficulty, money: 0 }),
      ).toEqual({ kind: "roll" });
    }
  });

  it("Given a prompt and a roll are both legal, When deciding, Then the prompt wins", () => {
    const decision = decideBotAction({
      legalActions: [rollAction(), auditPromptAction()],
      difficulty: "standard",
      money: 100_000,
    });

    expect(decision).toMatchObject({ kind: "respond" });
  });

  it("Given no legal actions, When deciding, Then no action is taken", () => {
    expect(
      decideBotAction({ legalActions: [], difficulty: "ruthless", money: 5_000 }),
    ).toEqual({ kind: "none" });
  });
});
