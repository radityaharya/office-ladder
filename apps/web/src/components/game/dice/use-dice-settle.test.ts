import { describe, expect, it } from "vitest";

import { GAMEPLAY_MOTION_MS } from "@/lib/motion";

import {
  DICE_LOCK_MS,
  DICE_MAX_LOCK_STAGGER_FRAMES,
  DICE_SETTLE_FRAMES,
  DICE_SETTLE_MS,
  DICE_STEP_MS,
  diceCellView,
  diceLockFrame,
  diceStepFace,
  diceStepFrameCount,
} from "./use-dice-settle";

/*
 * The settle sequence is a hook, and this suite runs in a node environment with
 * no DOM, so what is tested here is the *pure* state machine the hook drives —
 * which is deliberately where all the logic lives. Anything that needs a browser
 * to be correct would be untestable in this repo, so nothing does.
 */
describe("dice settle budget", () => {
  it("fits inside the gameplay-settle ceiling, worst case", () => {
    // Given — DESIGN.md §7.2 budgets dice arriving at their committed faces at
    // ≤700ms. That is a hard ceiling, not a target.

    // Then
    expect(DICE_SETTLE_MS).toBeLessThanOrEqual(GAMEPLAY_MOTION_MS.settleMax);
    expect(DICE_SETTLE_MS).toBe(
      (DICE_SETTLE_FRAMES + DICE_MAX_LOCK_STAGGER_FRAMES) * DICE_STEP_MS + DICE_LOCK_MS,
    );
  });

  it("takes its lock duration from the shared spring rather than restating it", () => {
    // Given — four agents are animating in parallel; a locally invented
    // stiffness would make the board read as several mechanisms.

    // Then
    expect(DICE_LOCK_MS).toBe(180);
  });

  it("keeps the whole sequence stepped, not eased", () => {
    // Given — a d6 movement roll.

    // Then — six discrete frames, each a whole state change.
    expect(DICE_STEP_MS).toBe(70);
    expect(DICE_SETTLE_FRAMES).toBe(6);
    expect(diceStepFrameCount(1)).toBe(6);
  });

  it("staggers a 2d6 lock by one step, and clamps the stagger to the budget", () => {
    // Given — only an audit-release attempt rolls a pair, but the clamp has to
    // hold for any width, or a wider roll would silently blow the ceiling.

    // Then
    expect(diceLockFrame(0)).toBe(DICE_SETTLE_FRAMES);
    expect(diceLockFrame(1)).toBe(DICE_SETTLE_FRAMES + 1);
    expect(diceLockFrame(5)).toBe(DICE_SETTLE_FRAMES + DICE_MAX_LOCK_STAGGER_FRAMES);
    expect(
      diceStepFrameCount(6) * DICE_STEP_MS + DICE_LOCK_MS,
    ).toBeLessThanOrEqual(GAMEPLAY_MOTION_MS.settleMax);
  });
});

describe("diceStepFace", () => {
  it("is deterministic and always a legal face", () => {
    // Given — no RNG anywhere: the same roll must look the same every time, and
    // a stepped digit must never be a number a d6 cannot show.

    // Then
    for (let frame = 0; frame < 24; frame += 1) {
      for (let index = 0; index < 2; index += 1) {
        const face = diceStepFace(frame, index);
        expect(face).toBeGreaterThanOrEqual(1);
        expect(face).toBeLessThanOrEqual(6);
      }
    }
    expect(diceStepFace(0, 0)).toBe(1);
    expect(diceStepFace(0, 1)).toBe(3);
  });

  it("keeps adjacent cells out of lockstep", () => {
    // Then — two dice stepping through identical faces reads as one number.
    expect(diceStepFace(3, 0)).not.toBe(diceStepFace(3, 1));
  });
});

describe("diceCellView", () => {
  it("shows the committed face, locked, once the sequence is over", () => {
    // Given — `frame: null` is the resting state, which is also the very first
    // synchronous render.

    // Then
    expect(diceCellView({ frame: null, index: 0, committed: 4 })).toEqual({
      face: 4,
      locked: true,
    });
  });

  it("reports an unresolved cell rather than fabricating a face", () => {
    // Then
    expect(diceCellView({ frame: null, index: 0, committed: null })).toEqual({
      face: null,
      locked: false,
    });
  });

  it("locks each cell at its own frame, so a pair settles in sequence", () => {
    // Given — mid-sequence, one step before the second die locks.
    const frame = diceLockFrame(0);

    // Then
    expect(diceCellView({ frame, index: 0, committed: 2 })).toEqual({
      face: 2,
      locked: true,
    });
    expect(diceCellView({ frame, index: 1, committed: 5 }).locked).toBe(false);
  });

  it("never shows the committed face on the frame before the lock", () => {
    // Given — a lock that changes nothing is indistinguishable from a die that
    // never moved, so the last stepped frame is nudged off the result.
    for (let index = 0; index < 2; index += 1) {
      const frame = diceLockFrame(index) - 1;
      const committed = diceStepFace(frame, index);

      // When
      const cell = diceCellView({ frame, index, committed });

      // Then
      expect(cell.locked).toBe(false);
      expect(cell.face).not.toBe(committed);
      expect(cell.face).toBeGreaterThanOrEqual(1);
      expect(cell.face).toBeLessThanOrEqual(6);
    }
  });
});
