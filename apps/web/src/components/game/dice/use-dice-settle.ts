import { useEffect, useRef, useState } from "react";

import { GAMEPLAY_MOTION_MS, GAMEPLAY_SPRING } from "@/lib/motion";

const FACE_COUNT = 6;

/**
 * The dice settle, budgeted against DESIGN.md §7.2's `gameplay-settle` ceiling.
 *
 * A die is a discrete object arriving at a discrete result, so the motion is a
 * mechanical counter stepping through faces and then seating — never a
 * continuous spin, never a 3D cube, never a bounce. Nothing here eases: the
 * stepping is a state machine ticking, and the only eased moment is the lock,
 * which uses the shared `GAMEPLAY_SPRING.die`.
 *
 * - `DICE_STEP_MS` 70ms per stepped face — ~14 face changes a second, fast
 *   enough to read as motion and slow enough to read as *discrete* motion.
 * - `DICE_SETTLE_FRAMES` 6 stepped frames = 420ms.
 * - Cells lock in sequence, one step apart, so 2d6 reads as two dice settling
 *   rather than one two-digit number appearing. The stagger is clamped by
 *   `DICE_MAX_LOCK_STAGGER_FRAMES` so a wider roll can never blow the budget.
 * - `DICE_LOCK_MS` is `GAMEPLAY_SPRING.die`'s own duration, not a second
 *   opinion about it.
 *
 * Worst case `DICE_SETTLE_MS` = 670ms, inside `GAMEPLAY_MOTION_MS.settleMax`.
 */
export const DICE_STEP_MS = 70;
export const DICE_SETTLE_FRAMES = 6;
export const DICE_LOCK_MS = Math.round(GAMEPLAY_SPRING.die.duration * 1000);
export const DICE_MAX_LOCK_STAGGER_FRAMES = Math.max(
  0,
  Math.floor(
    (GAMEPLAY_MOTION_MS.settleMax - DICE_SETTLE_FRAMES * DICE_STEP_MS - DICE_LOCK_MS) /
      DICE_STEP_MS,
  ),
);
export const DICE_SETTLE_MS =
  (DICE_SETTLE_FRAMES + DICE_MAX_LOCK_STAGGER_FRAMES) * DICE_STEP_MS + DICE_LOCK_MS;

export type DiceSettlePhase = "empty" | "rolling" | "stepping" | "settled";

export type DiceCellView = {
  /** `null` renders an unresolved placeholder — never a fabricated face. */
  readonly face: number | null;
  /** True once this cell shows its committed face and has seated. */
  readonly locked: boolean;
};

export type UseDiceSettleInput = {
  /** Event id of the committed roll, or null when nothing is committed yet. */
  readonly eventKey: string | null;
  /** The real committed faces. Never synthesised. */
  readonly faces: readonly number[];
  /** True while the local player's roll request is in flight. */
  readonly isRolling: boolean;
  /** How many cells to show while in flight — movement rolls exactly one die. */
  readonly pendingCellCount: number;
};

export type UseDiceSettleResult = {
  readonly phase: DiceSettlePhase;
  readonly cells: readonly DiceCellView[];
};

/** The frame at which cell `index` stops stepping and locks. */
export function diceLockFrame(index: number): number {
  const stagger = Math.min(Math.max(0, index), DICE_MAX_LOCK_STAGGER_FRAMES);
  return DICE_SETTLE_FRAMES + stagger;
}

/** Total stepped frames needed for `cellCount` cells. */
export function diceStepFrameCount(cellCount: number): number {
  return diceLockFrame(Math.max(1, cellCount) - 1);
}

/**
 * The stepped face for a frame. Deterministic, never random: offsetting by cell
 * index keeps adjacent cells out of lockstep without any RNG, so the same roll
 * always looks the same and a test can assert it.
 */
export function diceStepFace(frame: number, index: number): number {
  return ((frame + index * 2) % FACE_COUNT) + 1;
}

/**
 * One cell's view for a frame.
 *
 * The frame immediately before a lock is nudged off the committed face when it
 * would otherwise coincide with it, because a lock that changes nothing is
 * indistinguishable from a die that never moved.
 */
export function diceCellView({
  frame,
  index,
  committed,
}: {
  readonly frame: number | null;
  readonly index: number;
  readonly committed: number | null;
}): DiceCellView {
  const lockAt = diceLockFrame(index);
  if (frame === null || frame >= lockAt) {
    return { face: committed, locked: committed !== null };
  }

  const stepped = diceStepFace(frame, index);
  const face =
    frame === lockAt - 1 && stepped === committed
      ? (stepped % FACE_COUNT) + 1
      : stepped;

  return { face, locked: false };
}

/**
 * Drives the stepped settle sequence.
 *
 * The first synchronous render is always a correct resting state: committed
 * faces render immediately (so SSR and `renderToStaticMarkup` tests see real
 * markup) and the stepping sequence only ever runs for a roll that arrives
 * *after* mount. `prefers-reduced-motion` is read inside the effect — never at
 * module scope and never during render.
 */
export function useDiceSettle({
  eventKey,
  faces,
  isRolling,
  pendingCellCount,
}: UseDiceSettleInput): UseDiceSettleResult {
  const [frame, setFrame] = useState<number | null>(null);
  /*
   * Seeded with the mount-time key, which is what keeps pre-existing history
   * from being replayed: a board loaded mid-match renders its last committed
   * roll already seated. StrictMode double-invokes this effect on mount, and
   * that is harmless precisely because the seed makes both invocations agree
   * there is nothing new to animate.
   */
  const settledKey = useRef<string | null>(eventKey);
  /*
   * The face *count* is a dependency; the face *values* are not. A committed
   * roll's faces are immutable, so the count is the only thing about them that
   * could legitimately change the sequence's shape, and depending on the array
   * would re-fire the settle on every poll that re-delivers the same projection.
   */
  const faceCount = faces.length;

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Reduced motion collapses the whole sequence to an instant state change.
    // The faces are in the markup either way, so what was rolled is still
    // legible — the animation is never the only evidence of the event.
    if (prefersReducedMotion()) {
      setFrame(null);
      return;
    }

    /*
     * (a) Optimistic in-flight roll.
     *
     * A **one-shot** burst, not a loop. §7.2 forbids ambient motion outright,
     * and the previous implementation cycled faces on an interval for as long as
     * the request was in flight, which is exactly that. After the burst the
     * cells hold an unresolved placeholder — honest, because the face genuinely
     * is not known yet. This terminates purely on the `isRolling` prop, so a 409
     * or a network failure stops it exactly like a success does.
     */
    if (isRolling) return runFrames(Math.max(1, pendingCellCount), setFrame);

    // (b) A committed roll — local, remote, or bot — settles the same way. A
    // request that terminated *without* a new roll leaves the previous faces
    // seated rather than clearing them.
    const isNewRoll = eventKey !== null && eventKey !== settledKey.current;
    settledKey.current = eventKey;
    if (!isNewRoll || faceCount === 0) {
      setFrame(null);
      return;
    }

    return runFrames(faceCount, setFrame);
  }, [eventKey, faceCount, isRolling, pendingCellCount]);

  const committed = faces.length > 0 ? faces : null;

  if (isRolling) {
    const count = Math.max(1, pendingCellCount);
    return {
      phase: "rolling",
      cells: Array.from({ length: count }, (_, index) =>
        frame === null
          ? { face: null, locked: false }
          : { face: diceStepFace(frame, index), locked: false },
      ),
    };
  }

  if (committed === null) {
    return { phase: "empty", cells: [{ face: null, locked: false }] };
  }

  const cells = committed.map((face, index) =>
    diceCellView({ frame, index, committed: face }),
  );

  return {
    phase: frame === null ? "settled" : "stepping",
    cells,
  };
}

/**
 * Runs `0..n-1` stepped frames on an interval, then clears to `null`.
 * Returns the teardown, so every caller path is cancel-safe.
 */
function runFrames(
  cellCount: number,
  setFrame: (frame: number | null) => void,
): () => void {
  const total = diceStepFrameCount(cellCount);
  let index = 0;
  setFrame(index);
  const interval = window.setInterval(() => {
    index += 1;
    if (index >= total) {
      window.clearInterval(interval);
      setFrame(null);
      return;
    }
    setFrame(index);
  }, DICE_STEP_MS);

  return () => window.clearInterval(interval);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
