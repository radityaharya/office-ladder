import { describe, expect, it } from "vitest";

import { deadlineDashModes } from "@office-ladder/content";
import type { ModeRules } from "@office-ladder/engine";
import { botThinkingLine, botDecisionLine } from "../../src/rooms/bots/bot-chat";
import { botThinkMs, INSTANT_THINK_MS } from "../../src/rooms/bots/think-time";
import {
  MAXIMUM_BOT_TURN_DELAY_MS,
  isBotTurnDelayConfigured,
} from "../../src/rooms/bots/turn-delay";

/**
 * Pacing, from the room's own ruleset rather than from one process-wide number.
 *
 * The complaint these rules answer was "the bots stuff is too instantaneous, I
 * genuinely can't follow the game", and the previous fix — a single
 * `BOT_TURN_DELAY_MS` — left `ModeRules.bots.pacing` and `thinkMsRange` as dead
 * configuration: a mode, or a lobby-authored custom ruleset, could set them and
 * nothing would change. These assert that the mode is now the default authority,
 * that an operator can still override it, and that a hostile range cannot hang a
 * room.
 */

function rulesWith(bots: Partial<ModeRules["bots"]>): ModeRules {
  const preset = deadlineDashModes["mode.quick"]?.rules;
  if (preset === undefined) throw new Error("mode.quick is missing from the content pack");
  return { ...preset, bots: { ...preset.bots, ...bots } };
}

describe("botThinkMs", () => {
  it("Given a mode that paces its bots, When nothing is configured, Then the pause comes from the mode's own range", () => {
    const rules = rulesWith({ pacing: "paced", thinkMsRange: [400, 1_200] });

    for (const seed of ["a", "b", "c", "bot:g:1:roll", "bot:g:2:act"]) {
      const thinkMs = botThinkMs({ rules, configuredDelayMs: null, seed });
      expect(thinkMs).toBeGreaterThanOrEqual(400);
      expect(thinkMs).toBeLessThanOrEqual(1_200);
    }
  });

  it("Given the same seed, When the pause is resolved twice, Then it is the same number", () => {
    // No Math.random anywhere in the pacing path: two servers replaying one match
    // pace it identically, and these tests can assert exact values.
    const rules = rulesWith({ pacing: "paced", thinkMsRange: [400, 1_200] });
    const seed = "bot:game-1:7:promote";

    expect(botThinkMs({ rules, configuredDelayMs: null, seed })).toBe(
      botThinkMs({ rules, configuredDelayMs: null, seed }),
    );
  });

  it("Given two different commands in one chain, When each resolves its pause, Then they are not forced to be identical", () => {
    const rules = rulesWith({ pacing: "paced", thinkMsRange: [400, 1_200] });
    const spread = new Set(
      ["roll", "act", "adjust", "promote", "card", "vote", "trade", "pass"].map((slug) =>
        botThinkMs({ rules, configuredDelayMs: null, seed: `bot:game-1:7:${slug}` }),
      ),
    );

    // A hash that collapsed to one value would make every bot in a chain pause
    // for exactly the same beat, which reads as a machine rather than a table.
    expect(spread.size).toBeGreaterThan(1);
  });

  it("Given a mode that asks for instant bots, When a pause is resolved, Then there is none — even with a delay configured", () => {
    // The mode is the room's ruleset; a deployment-wide default must not override
    // a rule the match is being played under.
    const rules = rulesWith({ pacing: "instant" });

    expect(botThinkMs({ rules, configuredDelayMs: null, seed: "s" })).toBe(INSTANT_THINK_MS);
    expect(botThinkMs({ rules, configuredDelayMs: 5_000, seed: "s" })).toBe(INSTANT_THINK_MS);
  });

  it("Given an explicitly configured delay, When the mode also paces, Then the operator's number wins", () => {
    const rules = rulesWith({ pacing: "paced", thinkMsRange: [400, 1_200] });

    expect(botThinkMs({ rules, configuredDelayMs: 2_500, seed: "s" })).toBe(2_500);
  });

  it("Given the delay configured to zero, When a pause is resolved, Then pacing is off rather than defaulted", () => {
    // The distinction this whole nullable exists for: `0` is "switch it off", and
    // a resolver that could not tell it from "unset" would silently hand the room
    // back to the mode's range.
    const rules = rulesWith({ pacing: "paced", thinkMsRange: [400, 1_200] });

    expect(botThinkMs({ rules, configuredDelayMs: 0, seed: "s" })).toBe(0);
    expect(isBotTurnDelayConfigured("0")).toBe(true);
    expect(isBotTurnDelayConfigured(undefined)).toBe(false);
    expect(isBotTurnDelayConfigured("   ")).toBe(false);
  });

  it("Given a lobby-authored range that would hang the room, When a pause is resolved, Then it is clamped rather than honoured", () => {
    // A custom ruleset (§8.4) is attacker-controlled input. The pause is taken
    // inside the driver's per-room drain slot and the turn-timeout driver awaits
    // that slot, so an unbounded value parks two server-side actors for the whole
    // bot chain.
    const rules = rulesWith({ pacing: "paced", thinkMsRange: [10_000_000, 99_000_000] });

    expect(botThinkMs({ rules, configuredDelayMs: null, seed: "s" })).toBe(
      MAXIMUM_BOT_TURN_DELAY_MS,
    );
    expect(botThinkMs({ rules, configuredDelayMs: 10_000_000, seed: "s" })).toBe(
      MAXIMUM_BOT_TURN_DELAY_MS,
    );
  });

  it.each([
    ["inverted", [1_200, 400] as const],
    ["negative", [-500, -100] as const],
    ["not a number", [Number.NaN, Number.NaN] as const],
    ["fractional", [400.7, 400.9] as const],
    ["a single point", [700, 700] as const],
  ])(
    "Given a %s think range, When a pause is resolved, Then it is a usable non-negative integer",
    (_label, range) => {
      const rules = rulesWith({ pacing: "paced", thinkMsRange: range });
      const thinkMs = botThinkMs({ rules, configuredDelayMs: null, seed: "s" });

      expect(Number.isSafeInteger(thinkMs)).toBe(true);
      expect(thinkMs).toBeGreaterThanOrEqual(0);
      expect(thinkMs).toBeLessThanOrEqual(MAXIMUM_BOT_TURN_DELAY_MS);
    },
  );

  it("Given a negative configured delay, When a pause is resolved, Then it floors at zero instead of going backwards", () => {
    const rules = rulesWith({ pacing: "paced" });

    expect(botThinkMs({ rules, configuredDelayMs: -1_000, seed: "s" })).toBe(0);
  });

  it("Given every shipped preset, When a pause is resolved, Then it is inside that preset's own range", () => {
    for (const [modeId, mode] of Object.entries(deadlineDashModes)) {
      const [low, high] = mode.rules.bots.thinkMsRange;
      const thinkMs = botThinkMs({
        rules: mode.rules,
        configuredDelayMs: null,
        seed: `bot:${modeId}:1:roll`,
      });

      // Every shipped preset paces its bots, so every one of them must produce a
      // pause inside its own authored range — no preset silently falls back to a
      // deployment default.
      expect(mode.rules.bots.pacing).toBe("paced");
      expect(thinkMs).toBeGreaterThanOrEqual(low);
      expect(thinkMs).toBeLessThanOrEqual(high);
    }
  });
});

describe("what a bot says while it thinks", () => {
  it("Given quick chat, When a bot is about to act, Then it emits the fixed thinking phrase", () => {
    // The beat is what turns a pause into a visible decision. Without it a
    // deciding bot and a frozen server look the same from the outside.
    expect(botThinkingLine("quick")).toEqual({
      phraseId: "chat.phrase.thinking",
      messageKind: "quick",
    });
  });

  it("Given full chat, When a bot is about to act, Then it stays silent", () => {
    // Deliberate: in a room where humans are free-typing, anything a bot writes
    // is indistinguishable from a person writing it. Filling a seat is not the
    // same product decision as generating text on somebody's behalf.
    expect(botThinkingLine("full")).toBeNull();
    expect(botDecisionLine("full", "promote")).toBeNull();
  });

  it("Given chat switched off, When a bot acts, Then it says nothing at all", () => {
    expect(botThinkingLine("off")).toBeNull();
    expect(botDecisionLine("off", "attack")).toBeNull();
  });

  it("Given quick chat, When a bot makes a remark-worthy move, Then the phrase comes from the fixed set", () => {
    expect(botDecisionLine("quick", "promote")).toMatchObject({
      messageKind: "quick",
      phraseId: "chat.phrase.well-played",
    });
    expect(botDecisionLine("quick", "trade")).toMatchObject({
      phraseId: "chat.phrase.deal",
    });
  });

  it("Given an ordinary roll, When it commits, Then the bot does not comment on it", () => {
    // Six lines a round is the same unreadable feed the pacing work exists to
    // fix, so only moves a human would actually remark on get one.
    expect(botDecisionLine("quick", "roll")).toBeNull();
    expect(botDecisionLine("quick", "act")).toBeNull();
    expect(botDecisionLine("quick", "adjust")).toBeNull();
  });
});
