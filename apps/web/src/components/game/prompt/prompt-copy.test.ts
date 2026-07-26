import { describe, expect, it } from "vitest";

import {
  AUDIT_FINE,
  formatMoney,
  promptCaseRef,
  resolvePrimaryOptionId,
  resolvePromptCopy,
} from "./prompt-copy";

describe("resolvePromptCopy", () => {
  it("reads the fine from the authored content pack", () => {
    // Then
    expect(AUDIT_FINE).toBe(500);
  });

  it("describes both audit-release responses in the server's own option order", () => {
    // When
    const copy = resolvePromptCopy({
      kind: "audit-release",
      optionIds: ["pay-fine", "attempt-roll"],
      money: 900,
    });

    // Then
    expect(copy.title).toBe("Audit review");
    expect(copy.options.map((option) => option.optionId)).toEqual([
      "pay-fine",
      "attempt-roll",
    ]);
    expect(copy.options[0]?.cost).toBe("-$500");
    expect(copy.options[0]?.note).toBe("On hand $900 -> $400 after settlement.");
    expect(copy.options[1]?.cost).toBe("No fee");
    expect(copy.options[1]?.outcome).toContain("keeps this notice open");
  });

  it("charges only what the player holds, because the engine clamps at zero", () => {
    // When
    const copy = resolvePromptCopy({
      kind: "audit-release",
      optionIds: ["pay-fine"],
      money: 120,
    });

    // Then
    expect(copy.options[0]?.cost).toBe("-$120");
    expect(copy.options[0]?.note).toBe(
      "Recorded fine $500; you hold $120. The balance floors at $0 and the release still stands.",
    );
  });

  it("falls back to the recorded fine when the balance is unknown", () => {
    // When
    const copy = resolvePromptCopy({
      kind: "audit-release",
      optionIds: ["pay-fine"],
      money: null,
    });

    // Then
    expect(copy.options[0]?.cost).toBe("-$500");
    expect(copy.options[0]?.note).toBe("Recorded fine $500.");
  });

  it("only offers the responses the server actually declared legal", () => {
    // When
    const copy = resolvePromptCopy({
      kind: "audit-release",
      optionIds: ["attempt-roll"],
      money: 900,
    });

    // Then
    expect(copy.options.map((option) => option.optionId)).toEqual(["attempt-roll"]);
    expect(resolvePrimaryOptionId(copy)).toBe("attempt-roll");
  });

  it("builds the authored tile decision's stakes from the content pack", () => {
    // When
    const copy = resolvePromptCopy({
      kind: "training-course",
      optionIds: ["enroll", "decline"],
      money: 900,
    });

    // Then
    expect(copy.title).toBe("Training course");
    expect(copy.options.map((option) => option.optionId)).toEqual([
      "enroll",
      "decline",
    ]);
    expect(copy.options[0]?.cost).toBe("-$300");
    expect(copy.options[0]?.outcome).toBe(
      "Pays $300 and rolls 2d6. Totals 2-6: gain 2 reputation. Totals 7-12: gain 3 reputation.",
    );
    expect(copy.options[0]?.disabledReason).toBeNull();
    expect(copy.options[1]?.cost).toBe("No fee");
    expect(copy.options[1]?.outcome).toBe(
      "Walks away and pays nothing. Gain 1 reputation.",
    );
    expect(resolvePrimaryOptionId(copy)).toBe("enroll");
  });

  it("disables an authored accept the engine would reject as unaffordable", () => {
    // When
    const copy = resolvePromptCopy({
      kind: "training-course",
      optionIds: ["enroll", "decline"],
      money: 100,
    });

    // Then
    expect(copy.options[0]?.disabledReason).toBe(
      "The server rejects a deal the acting player cannot pay for.",
    );
    expect(copy.options[0]?.note).toBe("You hold $100, short of the $300 cost.");
    expect(copy.options[1]?.disabledReason).toBeNull();
    expect(resolvePrimaryOptionId(copy)).toBe("decline");
  });

  it("derives a usable notice for a prompt kind it has never seen", () => {
    // When
    const copy = resolvePromptCopy({
      kind: "reaction.window",
      optionIds: ["reaction.play", "reaction.pass"],
      money: 900,
    });

    // Then
    expect(copy.title).toBe("Reaction window");
    expect(copy.summary.length).toBeGreaterThan(0);
    expect(copy.options.map((option) => option.label)).toEqual([
      "Reaction play",
      "Reaction pass",
    ]);
    expect(copy.options.every((option) => option.cost === "Not stated")).toBe(true);
    expect(resolvePrimaryOptionId(copy)).toBe("reaction.pass");
  });

  it("keeps an unexpected option on a known kind rather than dropping it", () => {
    // When
    const copy = resolvePromptCopy({
      kind: "audit-release",
      optionIds: ["pay-fine", "attempt-roll", "call-legal"],
      money: 900,
    });

    // Then
    expect(copy.options.map((option) => option.optionId)).toEqual([
      "pay-fine",
      "attempt-roll",
      "call-legal",
    ]);
    expect(copy.options.at(-1)?.label).toBe("Call legal");
    expect(resolvePrimaryOptionId(copy)).toBe("attempt-roll");
  });

  it("never reports more than one primary action, even with no options", () => {
    // When
    const copy = resolvePromptCopy({ kind: "mystery", optionIds: [], money: null });

    // Then
    expect(copy.options).toEqual([]);
    expect(resolvePrimaryOptionId(copy)).toBeNull();
  });
});

describe("prompt formatting", () => {
  it("shortens a decision point id into a stable case reference", () => {
    // Then
    expect(promptCaseRef("8f1c2b7a-4d5e-4f60-9a11-c3d4e5f60789:audit")).toBe(
      "#8F1C2B",
    );
    expect(promptCaseRef("")).toBe("#UNKNOWN");
  });

  it("formats money with grouped tabular digits", () => {
    // Then
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(1240)).toBe("$1,240");
  });
});
