import { describe, expect, it } from "vitest";

import {
  deadlineDashContent,
  deadlineDashGlobalEventOrder,
  deadlineDashGlobalEvents,
} from "../src/deadline-dash";
import type { GlobalEventConfig, GlobalEventId } from "../src/schema";
import { validateDeadlineDashContent } from "../src/validation";
import type { DeadlineDashContentValidationInput } from "../src/validation";

const EVENT_IDS = [
  "globalEvent.audit-season",
  "globalEvent.layoffs",
  "globalEvent.budget-freeze",
  "globalEvent.reorg",
  "globalEvent.merger-rumour",
  "globalEvent.bonus-season",
] as const satisfies readonly GlobalEventId[];

const events: Readonly<Record<GlobalEventId, GlobalEventConfig>> = deadlineDashGlobalEvents;

type MutableEvent = {
  id: string;
  displayNameKey: string;
  descriptionKey: string;
  scope: string;
  effects: unknown[];
  modifiers: Array<Record<string, unknown>>;
  announcedQuarterAhead: boolean;
};

type MutableContent = {
  globalEvents: Record<string, MutableEvent>;
  globalEventOrder: string[];
};

function validateMutation(mutate: (content: MutableContent) => void) {
  const content = structuredClone(deadlineDashContent) as unknown as MutableContent;
  mutate(content);
  return validateDeadlineDashContent(
    content as unknown as DeadlineDashContentValidationInput,
  );
}

function expectIssue(
  result: ReturnType<typeof validateDeadlineDashContent>,
  code: string,
  path: string,
): void {
  expect(result.valid).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code, path })]),
  );
}

/** Every `type` discriminant in an authored effect tree, including nested outcomes. */
function collectEffectTypes(effects: readonly unknown[], found: string[]): void {
  for (const effect of effects) {
    if (typeof effect !== "object" || effect === null) continue;
    const record = effect as Record<string, unknown>;
    if (typeof record.type === "string") found.push(record.type);
    if (Array.isArray(record.outcomes)) {
      for (const outcome of record.outcomes) {
        if (typeof outcome !== "object" || outcome === null) continue;
        const nested = (outcome as Record<string, unknown>).effects;
        if (Array.isArray(nested)) collectEffectTypes(nested, found);
      }
    }
  }
}

describe("authored global events", () => {
  it("ships the six spec'd events, each keyed by its own id", () => {
    expect(Object.keys(deadlineDashGlobalEvents).sort()).toEqual([...EVENT_IDS].sort());
    for (const eventId of EVENT_IDS) {
      expect(events[eventId].id).toBe(eventId);
    }
  });

  it("follows the deadlineDash.* display-name key convention", () => {
    for (const eventId of EVENT_IDS) {
      const event = events[eventId];
      expect(event.displayNameKey).toMatch(
        /^deadlineDash\.globalEvent\.[a-z][A-Za-z0-9]*\.name$/,
      );
      expect(event.descriptionKey).toMatch(
        /^deadlineDash\.globalEvent\.[a-z][A-Za-z0-9]*\.description$/,
      );
      // The key's camelCase segment is derived from the id's slug, so a renamed
      // event cannot keep a stale translation key.
      const slug = eventId.slice("globalEvent.".length);
      const camel = slug.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
      expect(event.displayNameKey).toBe(`deadlineDash.globalEvent.${camel}.name`);
    }
  });

  it("announces every event a quarter ahead", () => {
    // Spec §5.7: a known shock is a decision, an unannounced one is variance.
    for (const eventId of EVENT_IDS) {
      expect(events[eventId].announcedQuarterAhead).toBe(true);
    }
  });

  it("gives every event something to do, from the shared effect vocabulary", () => {
    const known = new Set([
      "drawCards",
      "modifyResource",
      "restoreResourceToMaximum",
      "payResource",
      "incrementWorkCounter",
      "rollCheck",
      "applyStatus",
      "skipTurns",
      "gainSalary",
      "grantExtraRoll",
      "attemptPromotion",
      "auditConfinement",
    ]);

    for (const eventId of EVENT_IDS) {
      const event = events[eventId];
      expect(event.effects.length + event.modifiers.length).toBeGreaterThan(0);

      const types: string[] = [];
      collectEffectTypes(event.effects, types);
      expect(types.length).toBeGreaterThan(0);
      for (const type of types) {
        expect(known).toContain(type);
      }
    }
  });

  it("keeps the modifier vocabulary fully exercised by the shipped events", () => {
    const used = new Set(
      EVENT_IDS.flatMap((eventId) =>
        events[eventId].modifiers.map((modifier) => modifier.type),
      ),
    );
    expect([...used].sort()).toEqual([
      "adjustHeatThreshold",
      "blockLoans",
      "blockPromotions",
      "blockTileClaims",
      "demoteLowest",
      "multiplyProjectPayout",
      "multiplySalary",
      "suspendUpkeep",
    ]);
  });

  it("keeps every roll-check outcome inside the range its dice can produce", () => {
    for (const eventId of EVENT_IDS) {
      for (const effect of events[eventId].effects) {
        if (effect.type !== "rollCheck") continue;
        const minimum = effect.dice.count;
        const maximum = effect.dice.count * effect.dice.sides;
        const covered = new Set<number>();
        for (const outcome of effect.outcomes) {
          expect(outcome.when).toHaveProperty("total");
          if (!("total" in outcome.when)) continue;
          const [start, end] = outcome.when.total;
          expect(start).toBeGreaterThanOrEqual(minimum);
          expect(end).toBeLessThanOrEqual(maximum);
          for (let total = start; total <= end; total += 1) {
            expect(covered.has(total)).toBe(false);
            covered.add(total);
          }
        }
        // Total coverage: an unmatched roll would silently do nothing.
        expect(covered.size).toBe(maximum - minimum + 1);
      }
    }
  });

  it("orders every event exactly once in the default quarter rotation", () => {
    expect([...deadlineDashGlobalEventOrder].sort()).toEqual([...EVENT_IDS].sort());
    expect(new Set(deadlineDashGlobalEventOrder).size).toBe(
      deadlineDashGlobalEventOrder.length,
    );
    // The table's first taste of the quarter track should be something to aim
    // at rather than a punishment.
    expect(deadlineDashGlobalEventOrder[0]).toBe("globalEvent.bonus-season");
    // The two harshest events must never land back to back.
    const freeze = deadlineDashGlobalEventOrder.indexOf("globalEvent.budget-freeze");
    const layoffs = deadlineDashGlobalEventOrder.indexOf("globalEvent.layoffs");
    expect(Math.abs(freeze - layoffs)).toBeGreaterThan(1);
  });

  it("scopes each event to a real audience predicate", () => {
    const scopes = new Set([
      "all-players",
      "leader",
      "trailing-players",
      "players-with-heat",
      "players-in-debt",
    ]);
    for (const eventId of EVENT_IDS) {
      expect(scopes).toContain(events[eventId].scope);
    }
    expect(events["globalEvent.audit-season"].scope).toBe("players-with-heat");
    expect(events["globalEvent.layoffs"].scope).toBe("trailing-players");
  });

  it("never drives a player negative with a mandatory money charge", () => {
    // An event cannot be declined, so a charge it cannot cover must clamp.
    for (const eventId of EVENT_IDS) {
      for (const effect of events[eventId].effects) {
        if (effect.type === "payResource") {
          expect(effect.insufficientFunds).toBe("pay-up-to-available");
        }
        if (effect.type === "modifyResource" && effect.amount < 0) {
          expect(effect.clampAtZero).toBe(true);
        }
      }
    }
  });
});

describe("global event validation", () => {
  it("rejects an event whose id does not match its key", () => {
    const result = validateMutation((content) => {
      content.globalEvents["globalEvent.reorg"].id = "globalEvent.layoffs";
    });
    expectIssue(result, "globalEvent.id", "globalEvents.globalEvent.reorg.id");
  });

  it("rejects missing, extra, and misnamed events", () => {
    const missing = validateMutation((content) => {
      delete content.globalEvents["globalEvent.reorg"];
      content.globalEventOrder = content.globalEventOrder.filter(
        (eventId) => eventId !== "globalEvent.reorg",
      );
    });
    expectIssue(missing, "globalEvent.ids", "globalEvents.keys");

    const nameKey = validateMutation((content) => {
      content.globalEvents["globalEvent.merger-rumour"].displayNameKey =
        "deadlineDash.globalEvent.merger-rumour.name";
      content.globalEvents["globalEvent.merger-rumour"].descriptionKey = "mergerRumour";
    });
    expectIssue(
      nameKey,
      "globalEvent.name-key",
      "globalEvents.globalEvent.merger-rumour.displayNameKey",
    );
    expectIssue(
      nameKey,
      "globalEvent.name-key",
      "globalEvents.globalEvent.merger-rumour.descriptionKey",
    );
  });

  it("rejects an effect shape the engine's resolver could not interpret", () => {
    const unknownType = validateMutation((content) => {
      content.globalEvents["globalEvent.bonus-season"].effects = [
        { type: "printMoney", amount: 999 },
      ];
    });
    expectIssue(
      unknownType,
      "board.effect-shape",
      "globalEvents.globalEvent.bonus-season.effects[0]",
    );

    const badDeck = validateMutation((content) => {
      content.globalEvents["globalEvent.bonus-season"].effects = [
        { type: "drawCards", deckId: "deck.nonexistent", count: 1 },
      ];
    });
    expectIssue(
      badDeck,
      "board.effect-deck-id",
      "globalEvents.globalEvent.bonus-season.effects[0].deckId",
    );

    const badStatus = validateMutation((content) => {
      content.globalEvents["globalEvent.bonus-season"].effects = [
        {
          type: "applyStatus",
          statusId: "status.invented",
          duration: { kind: "uses", count: 1 },
        },
      ];
    });
    expectIssue(
      badStatus,
      "board.effect-status-id",
      "globalEvents.globalEvent.bonus-season.effects[0].statusId",
    );

    const badOutcome = validateMutation((content) => {
      content.globalEvents["globalEvent.reorg"].effects = [
        {
          type: "rollCheck",
          dice: { count: 1, sides: 6 },
          rerollEligible: false,
          outcomes: [{ when: { total: [1, 12] }, effects: [] }],
        },
      ];
    });
    expectIssue(
      badOutcome,
      "board.effect-outcome",
      "globalEvents.globalEvent.reorg.effects[0].outcomes[0].when.total",
    );
  });

  it("rejects an unknown modifier type, a malformed payload, and a stray field", () => {
    const result = validateMutation((content) => {
      content.globalEvents["globalEvent.budget-freeze"].modifiers = [
        { type: "cancelTheQuarter" },
        { type: "multiplySalary", multiplier: -1 },
        { type: "demoteLowest", resource: "energy" },
        { type: "suspendUpkeep", forever: true },
      ];
    });

    expectIssue(
      result,
      "globalEvent.modifier",
      "globalEvents.globalEvent.budget-freeze.modifiers[0].type",
    );
    expectIssue(
      result,
      "globalEvent.modifier",
      "globalEvents.globalEvent.budget-freeze.modifiers[1].multiplier",
    );
    expectIssue(
      result,
      "globalEvent.modifier",
      "globalEvents.globalEvent.budget-freeze.modifiers[2].resource",
    );
    expectIssue(
      result,
      "globalEvent.modifier",
      "globalEvents.globalEvent.budget-freeze.modifiers[3].forever",
    );
  });

  it("rejects an event that neither resolves an effect nor changes a rule", () => {
    const result = validateMutation((content) => {
      content.globalEvents["globalEvent.reorg"].effects = [];
      content.globalEvents["globalEvent.reorg"].modifiers = [];
    });
    expectIssue(result, "globalEvent.empty", "globalEvents.globalEvent.reorg");
  });

  it("rejects an unannounced event", () => {
    const result = validateMutation((content) => {
      content.globalEvents["globalEvent.layoffs"].announcedQuarterAhead = false;
    });
    expectIssue(
      result,
      "globalEvent.announcement",
      "globalEvents.globalEvent.layoffs.announcedQuarterAhead",
    );
  });

  it("rejects an unknown scope", () => {
    const result = validateMutation((content) => {
      content.globalEvents["globalEvent.layoffs"].scope = "the-host";
    });
    expectIssue(result, "globalEvent.scope", "globalEvents.globalEvent.layoffs.scope");
  });

  it("rejects a rotation with an unknown, duplicated, or missing entry", () => {
    const unknown = validateMutation((content) => {
      content.globalEventOrder[0] = "globalEvent.hackathon";
    });
    expectIssue(unknown, "globalEvent.order", "globalEventOrder[0]");

    const duplicate = validateMutation((content) => {
      content.globalEventOrder[1] = content.globalEventOrder[0];
    });
    expectIssue(duplicate, "globalEvent.order", "globalEventOrder[1]");

    const incomplete = validateMutation((content) => {
      content.globalEventOrder.pop();
    });
    expectIssue(incomplete, "globalEvent.order", "globalEventOrder");
  });
});
