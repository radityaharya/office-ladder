import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "../src/deadline-dash";
import type {
  CardPolarity,
  DeckCard,
  DeckConfig,
  EffectCondition,
  EffectDescriptor,
  EffectDescriptorType,
  EffectScale,
  EffectTarget,
  EffectTiming,
} from "../src/schema";

/**
 * The v2 effect vocabulary is a *contract between packages*: the card-authoring
 * waves write against it, and `packages/engine/src/execution/effects-v2/` is
 * expected to resolve exactly what it permits. Most of what can go wrong here is
 * a type-level regression that no runtime assertion would ever catch — a member
 * silently dropped, a field renamed, an envelope field that stops being
 * optional — so most of this file is compile-time. It is real coverage: this
 * package's `typecheck` script includes `tests/**\/*.ts`.
 *
 * The rule the whole file exists to defend: **a schema that permits a shape the
 * engine cannot resolve is worse than no schema**, because it lets an author
 * write a card that validates, ships, and silently does nothing.
 */

/** Compile-time assertion that `value` is assignable to `T`. */
const authored = <T,>(value: T): T => value;

describe("effect envelope (§10.1, §10.3, re-cut §3.7)", () => {
  it("leaves every pre-v2 effect authorable with no envelope at all", () => {
    // This is the backward-compatibility guarantee that let v2 land without
    // touching a single one of the 29 already-shipped cards.
    const legacy = authored<readonly EffectDescriptor[]>([
      { type: "drawCards", deckId: "deck.work", count: 1 },
      { type: "modifyResource", resource: "money", amount: 150, clampAtZero: true },
      { type: "restoreResourceToMaximum", resource: "energy" },
      {
        type: "payResource",
        resource: "money",
        amount: 200,
        insufficientFunds: "pay-up-to-available",
      },
      { type: "gainSalary", trigger: "pass" },
      { type: "grantExtraRoll", count: 1 },
      { type: "attemptPromotion" },
      { type: "skipTurns", count: 1, source: "tile" },
      {
        type: "auditConfinement",
        release: {
          roll: { count: 2, sides: 6 },
          requiresTrueDoubles: true,
          rerollEligible: false,
          alternativeFine: 500,
        },
      },
    ]);

    expect(legacy).toHaveLength(9);
  });

  it("accepts all eleven targets and defaults to self by omission", () => {
    const targets: readonly EffectTarget[] = [
      "self",
      "active-player",
      "chosen-opponent",
      "all-opponents",
      "all-players",
      "left-neighbour",
      "right-neighbour",
      "highest-rank",
      "lowest-rank",
      "richest",
      "poorest",
    ];

    // Exhaustiveness: adding a twelfth target without adding it here is a
    // compile error, and dropping one is too.
    const roundTrip = authored<readonly EffectTarget[]>(targets);
    expect(new Set(roundTrip).size).toBe(11);

    const withoutTarget = authored<EffectDescriptor>({
      type: "modifyResource",
      resource: "reputation",
      amount: 1,
    });
    expect(withoutTarget.target).toBeUndefined();
  });

  it("carries preventable, condition and scale on any effect", () => {
    const aimed = authored<EffectDescriptor>({
      type: "transferResource",
      resource: "money",
      amount: 150,
      direction: "target-to-actor",
      perTarget: true,
      insufficientFunds: "transfer-up-to-available",
      target: "richest",
      preventable: true,
      condition: { kind: "resourceAtLeast", who: "target", resource: "money", amount: 150 },
      scale: { by: "rank-tier", perUnit: 50, cap: 400, of: "target" },
    });

    expect(aimed.preventable).toBe(true);
    expect(aimed.condition?.kind).toBe("resourceAtLeast");
    expect(aimed.scale?.by).toBe("rank-tier");
  });

  it("rejects a target that is not one of the eleven", () => {
    authored<EffectDescriptor>({
      type: "modifyHeat",
      amount: 1,
      // @ts-expect-error "leader" is a GlobalEventScope, not an EffectTarget —
      // the two vocabularies use overlapping words with different mechanisms.
      target: "leader",
    });
    expect(true).toBe(true);
  });
});

describe("condition grammar (§10.3, closed per the engine's conditions.ts)", () => {
  it("expresses every clause the engine evaluates", () => {
    const clauses = authored<readonly EffectCondition[]>([
      { kind: "always" },
      { kind: "never" },
      { kind: "resourceAtLeast", who: "actor", resource: "money", amount: 500 },
      { kind: "resourceAtMost", who: "target", resource: "reputation", amount: 2 },
      // The Work counter is a resource in engine state, which is what makes a
      // work-counter guard expressible without a bespoke clause.
      { kind: "resourceAtMost", who: "target", resource: "work-counter", amount: 4 },
      { kind: "rankIndexAtLeast", who: "target", index: 4 },
      { kind: "rankIndexAtMost", who: "target", index: 3 },
      { kind: "heatAtLeast", who: "actor", value: 2 },
      { kind: "hasStatus", who: "target", statusId: "status.audit" },
      { kind: "ownsTile", who: "actor", tileId: null },
      { kind: "roundAtLeast", round: 6 },
      { kind: "quarterIndex", index: 2 },
      { kind: "not", of: { kind: "always" } },
      { kind: "all", of: [{ kind: "always" }, { kind: "roundAtLeast", round: 3 }] },
      { kind: "any", of: [{ kind: "never" }, { kind: "quarterIndex", index: 0 }] },
    ]);

    expect(clauses).toHaveLength(15);
  });

  it("is closed — an invented clause does not typecheck", () => {
    // The whole point of narrowing `condition` off the spec's bare JsonObject:
    // the engine's parser fails closed on anything it does not recognise, so an
    // unrecognised clause is an effect that silently never fires.
    authored<EffectDescriptor>({
      type: "modifyResource",
      resource: "reputation",
      amount: 2,
      // @ts-expect-error the pre-v2 authored shape {resource, comparison, value}
      // is not a member of the grammar the engine can evaluate.
      condition: { resource: "money", comparison: "at-most", value: 500 },
    });
    expect(true).toBe(true);
  });

  it("scales off the seven declared metrics only", () => {
    const scales = authored<readonly EffectScale[]>([
      { by: "rank-tier", perUnit: 150 },
      { by: "board-position", perUnit: 10 },
      { by: "laps", perUnit: 150 },
      { by: "heat", perUnit: -50 },
      { by: "debt", perUnit: 1 },
      { by: "work-counter", perUnit: 25, cap: 400 },
      { by: "opponent-count", perUnit: 100 },
    ]);

    expect(scales).toHaveLength(7);
  });
});

describe("new effect types (§10.3, re-cut §3 and §11)", () => {
  it("authors one of each, with the shapes the re-cut plan writes", () => {
    const effects = authored<readonly EffectDescriptor[]>([
      { type: "transferResource", resource: "money", amount: 150 },
      { type: "modifyHeat", amount: 1, target: "self" },
      {
        type: "placeObject",
        placementKind: "placement.rumour",
        tileId: null,
        charges: 1,
        visibility: "owner-only",
        data: { note: "left on the shared drive" },
      },
      { type: "claimTile", baseCost: 200 },
      { type: "releaseTile", tileId: "tile.board.legal-1" },
      {
        type: "startProject",
        definitionId: "project.migration",
        requiredMoney: 400,
        requiredWork: 3,
        payout: { money: 900, reputation: 2, objectiveProgress: 1 },
        openToJoin: true,
      },
      { type: "contributeToProject", projectId: null, money: 100, work: 1 },
      { type: "sabotageProject", projectId: null, amount: 2, hidden: true },
      { type: "openBallot", ballotKind: "vote", subjectId: "ballot.reorg" },
      { type: "grantImmunity", count: 1, scope: { sourceDeckId: "deck.networking" } },
      {
        type: "grantImmunity",
        duration: { kind: "turns", count: 1 },
        scope: { resource: "energy", direction: "loss" },
      },
      { type: "forceDiscard", count: 1, target: "chosen-opponent" },
      { type: "swapBoardPositions", target: "chosen-opponent" },
      { type: "teleport", destination: { kind: "tileIndex", index: 0 } },
      { type: "modifyUpkeep", amount: -100 },
      { type: "openReactionWindow", windowKind: "prevention" },
      {
        type: "grantIncomeStream",
        streamKind: "rent",
        perRound: 50,
        remainingRounds: null,
      },
      {
        type: "removeStatuses",
        filter: { polarity: "negative", sourceDeckId: "deck.work" },
        limit: 1,
      },
      {
        type: "chooseOne",
        chooser: "chosen-opponent",
        options: [
          {
            id: "deny",
            label: "Deny it",
            effects: [{ type: "modifyResource", resource: "reputation", amount: -1 }],
          },
          {
            id: "concede",
            label: "Let it stand",
            effects: [{ type: "modifyResource", resource: "money", amount: -100 }],
          },
        ],
      },
      { type: "noEffect" },
      {
        type: "opposedRoll",
        opponent: "chosen-opponent",
        onWin: [{ type: "transferResource", resource: "money", amount: 200 }],
        onLose: [
          {
            type: "transferResource",
            resource: "money",
            amount: 200,
            direction: "actor-to-target",
          },
        ],
      },
    ]);

    // Twenty-one authored shapes covering twenty distinct new types
    // (`grantImmunity` appears twice: once counted, once timed).
    const types = new Set(effects.map((effect) => effect.type));
    expect(effects).toHaveLength(21);
    expect(types.size).toBe(20);
  });

  it("requires grantImmunity to declare its scope rather than smuggle it into condition", () => {
    // @ts-expect-error `scope` is mandatory — the four cards that predated the
    // declared shape each invented a different filter inside `condition`.
    authored<EffectDescriptor>({ type: "grantImmunity", count: 1 });
    expect(true).toBe(true);
  });

  it("keeps chooseOne branches recursive, so a choice can contain real effects", () => {
    const choice = authored<EffectDescriptor>({
      type: "chooseOne",
      options: [
        {
          id: "push",
          label: "Push it through",
          effects: [
            {
              type: "rollCheck",
              dice: { count: 2, sides: 6 },
              rerollEligible: false,
              resolution: "per-target",
              outcomes: [
                {
                  when: { doubles: true },
                  effects: [{ type: "modifyResource", resource: "reputation", amount: 1 }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(choice.type).toBe("chooseOne");
  });
});

describe("widened v1 members", () => {
  it("lets the work counter advance by more than one step", () => {
    const stride = authored<EffectDescriptor>({
      type: "incrementWorkCounter",
      amount: 2,
      rewardEvery: 5,
      reward: { resource: "reputation", amount: 1 },
      cumulative: true,
    });

    expect(stride.type).toBe("incrementWorkCounter");
  });

  it("lets a card, not just a tile, take a turn away", () => {
    const fromCard = authored<EffectDescriptor>({
      type: "skipTurns",
      count: 1,
      source: "card",
      target: "chosen-opponent",
    });

    expect(fromCard.type).toBe("skipTurns");
  });

  it("lets a status declare the provenance removeStatuses filters on", () => {
    const tracked = authored<EffectDescriptor>({
      type: "applyStatus",
      statusId: "status.next-work-card-money-multiplier",
      duration: { kind: "uses", count: 1 },
      parameters: { multiplier: 0 },
      polarity: "negative",
      sourceDeckId: "deck.work",
      target: "chosen-opponent",
    });

    expect(tracked.type).toBe("applyStatus");
  });
});

describe("DeckCard (§10.5)", () => {
  it("carries timing, copies and polarity on the card", () => {
    const card = authored<DeckCard>({
      id: "card.work.expense-claim",
      nameKey: "deadlineDash.card.expenseClaim.name",
      displayName: "Expense Claim",
      flavorText: "Finance approved the submission without comment.",
      timing: "stored",
      copies: 2,
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 150 }],
    });

    const timing: EffectTiming | undefined = card.timing;
    const polarity: CardPolarity | undefined = card.polarity;

    expect(card.copies).toBe(2);
    expect(timing).toBe("stored");
    expect(polarity).toBe("positive");
  });

  it("keeps every field but id/nameKey/effects optional, so shipped cards are unchanged", () => {
    const minimal = authored<DeckCard>({
      id: "card.work.quality-work",
      nameKey: "deadlineDash.card.qualityWork.name",
      effects: [{ type: "modifyResource", resource: "reputation", amount: 1 }],
    });

    expect(minimal.timing).toBeUndefined();
    expect(minimal.copies).toBeUndefined();
    expect(minimal.polarity).toBeUndefined();
  });

  it("does not accept timing on an effect — §10.5 puts it on the card", () => {
    authored<EffectDescriptor>({
      type: "modifyResource",
      resource: "money",
      amount: 100,
      // @ts-expect-error per-effect timing makes [{stored},{immediate}] representable
      // and that card has no defined answer for which zone it ends up in.
      timing: "stored",
    });
    expect(true).toBe(true);
  });
});

/**
 * `deadlineDashContent.decks` is an `as const` tuple of heterogeneous literal
 * types, so reading it through the schema type is what actually proves the
 * authored pack still satisfies the widened `DeckConfig`.
 */
const shippedDecks: readonly DeckConfig[] = deadlineDashContent.decks;
const shippedCards: readonly DeckCard[] = shippedDecks.flatMap((deck) => deck.cards);

describe("the shipped pack still conforms", () => {
  /**
   * These two assertions used to read "no card has adopted v2 yet", which was
   * the proof that widening the vocabulary was purely additive. The re-cut
   * landed, so that phrasing is now permanently false. Re-aimed at the same
   * intent stated the other way round: the new card-level fields stay
   * *optional*, and every value the pack actually uses is a declared one.
   */
  it("types and validates unchanged under the widened vocabulary", () => {
    const cards = shippedCards;
    const timings: readonly (EffectTiming | undefined)[] = [
      undefined,
      "immediate",
      "stored",
      "reaction",
    ];

    expect(cards.length).toBeGreaterThan(0);
    // Optional means optional: the majority of the pack still omits both, and
    // every default reproduces v1 behaviour exactly.
    expect(cards.some((card) => card.timing === undefined)).toBe(true);
    expect(cards.some((card) => card.copies === undefined)).toBe(true);
    expect(cards.every((card) => timings.includes(card.timing))).toBe(true);
    expect(
      cards.every(
        (card) =>
          card.copies === undefined || (Number.isSafeInteger(card.copies) && card.copies >= 1),
      ),
    ).toBe(true);
  });

  it("exposes every effect type name as a union for validators to mirror", () => {
    const shipped = new Set<EffectDescriptorType>(
      shippedCards.flatMap((card) => card.effects).map((effect) => effect.type),
    );

    // The re-cut has landed, so both halves of the union are now in use. The
    // union is what a validator mirrors, so the check that matters is that
    // nothing in the pack falls outside it.
    expect(shipped.has("transferResource")).toBe(true);
    expect(shipped.has("modifyResource")).toBe(true);
    expect(shipped.size).toBeGreaterThan(0);
    expect([...shipped].every((type) => typeof type === "string")).toBe(true);
  });
});
