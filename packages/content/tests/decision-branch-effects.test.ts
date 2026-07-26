import { describe, expect, it } from "vitest";

import { deadlineDashBoard, deadlineDashContent } from "../src/deadline-dash";
import type { BoardTile } from "../src/schema";
import { validateDeadlineDashContent } from "../src/validation";
import type { DeadlineDashContentValidationInput } from "../src/validation";

/**
 * The authored pack is `as const`, so the optional `decision` property is not
 * visible on the 44-member tile-literal union without widening.
 */
const spaces: readonly BoardTile[] = deadlineDashBoard.spaces;

/** Derived from the pack, so the workbook board order can be reordered safely. */
const TRAINING_INDEX = spaces.findIndex((tile) => tile.kind === "training");

type MutableDecisionBranches = {
  accept: { outcomes: Array<{ effects: unknown[] }> };
  decline: { effects: unknown[] };
};

type MutableContent = {
  board: { spaces: Array<{ decision?: MutableDecisionBranches }> };
};

function mutateDecision(mutate: (decision: MutableDecisionBranches) => void) {
  const content = structuredClone(deadlineDashContent) as unknown as MutableContent;
  const decision = content.board.spaces[TRAINING_INDEX]?.decision;
  if (decision === undefined) throw new Error("expected the training decision");
  mutate(decision);

  return validateDeadlineDashContent(
    content as unknown as DeadlineDashContentValidationInput,
  );
}

function expectDecisionShapeIssue(
  result: ReturnType<typeof validateDeadlineDashContent>,
  path: string,
): void {
  expect(result.valid).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "board.decision-shape", path }),
    ]),
  );
}

/**
 * A decision response resolves authored effects through
 * `applyEffectDescriptors`, which returns only the updated player, its resource
 * changes and a trace nobody reads. Three effect kinds therefore change
 * canonical state with no event to match: `drawCards` (no `CardDrawn`, so the
 * snapshot and the event stream disagree), `auditConfinement` (sets `inAudit`
 * with no releasing prompt), and `grantExtraRoll` (dropped outright). Tile
 * resolution handles all three; a decision response cannot, so authoring them
 * inside a branch has to be rejected rather than silently half-applied.
 */
const UNSUPPORTED_EFFECTS = [
  [
    "drawCards",
    { type: "drawCards", deckId: "deck.work", count: 1 },
  ],
  [
    "auditConfinement",
    {
      type: "auditConfinement",
      release: {
        roll: { count: 2, sides: 6 },
        requiresTrueDoubles: true,
        rerollEligible: false,
        alternativeFine: 500,
      },
    },
  ],
  ["grantExtraRoll", { type: "grantExtraRoll", count: 1 }],
] as const;

describe("tile decision branch effects", () => {
  it("Given the authored pack, When it is validated, Then no decision branch carries an effect the response path cannot report", () => {
    const result = validateDeadlineDashContent(
      deadlineDashContent as unknown as DeadlineDashContentValidationInput,
    );

    expect(result.valid).toBe(true);
    expect(
      result.issues.filter((issue) => issue.code === "board.decision-shape"),
    ).toEqual([]);
    // And the guard is not vacuous only because nothing is authored: the
    // training decision really does carry effects to walk.
    const decision = spaces[TRAINING_INDEX]?.decision;
    if (decision === undefined) throw new Error("expected the training decision");
    expect(decision.decline.effects.length).toBeGreaterThan(0);
    expect(decision.accept.outcomes.every((outcome) => outcome.effects.length > 0)).toBe(true);
  });

  it.each(UNSUPPORTED_EFFECTS)(
    "Given %s authored directly in the accept branch, When the pack is validated, Then it is rejected",
    (_label, effect) => {
      const result = mutateDecision((decision) => {
        decision.accept.outcomes[0]?.effects.push(effect);
      });

      expectDecisionShapeIssue(
        result,
        `board.spaces[${TRAINING_INDEX}].decision.accept.outcomes[0].effects[1]`,
      );
    },
  );

  it.each(UNSUPPORTED_EFFECTS)(
    "Given %s authored directly in the decline branch, When the pack is validated, Then it is rejected",
    (_label, effect) => {
      const result = mutateDecision((decision) => {
        decision.decline.effects.push(effect);
      });

      expectDecisionShapeIssue(
        result,
        `board.spaces[${TRAINING_INDEX}].decision.decline.effects[1]`,
      );
    },
  );

  it.each(UNSUPPORTED_EFFECTS)(
    "Given %s nested inside a branch's rollCheck outcome, When the pack is validated, Then it is still rejected",
    (_label, effect) => {
      const result = mutateDecision((decision) => {
        decision.decline.effects.push({
          type: "rollCheck",
          dice: { count: 2, sides: 6 },
          rerollEligible: false,
          outcomes: [{ when: { total: [2, 12] }, effects: [effect] }],
        });
      });

      expectDecisionShapeIssue(
        result,
        `board.spaces[${TRAINING_INDEX}].decision.decline.effects[1].outcomes[0].effects[0]`,
      );
    },
  );

  it("Given effects the response path does resolve faithfully, When they are authored in a branch, Then they are allowed", () => {
    const result = mutateDecision((decision) => {
      decision.accept.outcomes[0]?.effects.push(
        { type: "restoreResourceToMaximum", resource: "energy" },
        {
          type: "applyStatus",
          statusId: "status.next-salary-multiplier",
          duration: { kind: "uses", count: 1 },
          parameters: { multiplier: 2 },
        },
      );
    });

    expect(
      result.issues.filter((issue) => issue.code === "board.decision-shape"),
    ).toEqual([]);
  });
});

type MutableTile = {
  effects: unknown[];
  decision?: MutableDecisionBranches;
};

function mutateDecisionTileEffects(effect: unknown) {
  const content = structuredClone(deadlineDashContent) as unknown as {
    board: { spaces: MutableTile[] };
  };
  const tile = content.board.spaces[TRAINING_INDEX];
  if (tile?.decision === undefined) throw new Error("expected the training decision tile");
  tile.effects.push(effect);

  return validateDeadlineDashContent(
    content as unknown as DeadlineDashContentValidationInput,
  );
}

/**
 * A tile can only hold the turn one way at a time. `rollTurn` builds at most one
 * prompt per landing and resolves audit confinement first, so a decision on the
 * same tile is dropped while the turn still waits in the `prompt` phase for an
 * answer to it; and a held decision hands the turn to `respondToPrompt`, which
 * advances turn order unconditionally, so a `grantExtraRoll` on that tile is
 * forfeited. Both are legal no-ops at runtime and therefore invisible, which is
 * why they have to be refused at authoring time.
 */
const TURN_HOLDING_EFFECTS = [
  [
    "auditConfinement",
    {
      type: "auditConfinement",
      release: {
        roll: { count: 2, sides: 6 },
        requiresTrueDoubles: true,
        rerollEligible: false,
        alternativeFine: 500,
      },
    },
  ],
  ["grantExtraRoll", { type: "grantExtraRoll", count: 1 }],
] as const;

describe("a decision tile's own effects", () => {
  it("Given the authored pack, When it is validated, Then no tile both asks a question and holds the turn another way", () => {
    const result = validateDeadlineDashContent(
      deadlineDashContent as unknown as DeadlineDashContentValidationInput,
    );

    expect(result.valid).toBe(true);
    // The audit corner and the Receptionist are the two tiles that hold the turn
    // today; neither carries a decision, which is what makes the pack legal here
    // rather than the rule being unreachable.
    const holders = spaces.filter((tile) =>
      tile.effects.some(
        (effect) => effect.type === "auditConfinement" || effect.type === "grantExtraRoll",
      ),
    );
    expect(holders.length).toBeGreaterThan(0);
    expect(holders.every((tile) => tile.decision === undefined)).toBe(true);
  });

  it.each(TURN_HOLDING_EFFECTS)(
    "Given %s authored on the tile that also opens a decision, When the pack is validated, Then it is rejected",
    (_label, effect) => {
      const result = mutateDecisionTileEffects(effect);

      expectDecisionShapeIssue(result, `board.spaces[${TRAINING_INDEX}].effects[0]`);
    },
  );

  it("Given an ordinary effect on the decision tile, When the pack is validated, Then it is allowed", () => {
    // The rule is about turn control, not about decision tiles being inert: a
    // decision tile may still pay, charge or buff on landing.
    const result = mutateDecisionTileEffects({
      type: "modifyResource",
      resource: "reputation",
      amount: 1,
      clampAtZero: true,
    });

    expect(
      result.issues.filter((issue) => issue.code === "board.decision-shape"),
    ).toEqual([]);
  });
});
