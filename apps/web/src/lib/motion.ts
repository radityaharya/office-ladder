/**
 * The sanctioned gameplay-motion vocabulary — see DESIGN.md §7.2.
 *
 * This system has two motion layers. §7.1 chrome (controls, panels, rails, HUD
 * frames, dialogs) stays severe: 80/120/160ms, `easing-standard`, and no spring
 * of any kind. §7.2 gameplay motion — player tokens, dice, cards, resource
 * readouts, promotion, turn hand-off — is the one expressive layer, because a
 * board game whose pieces teleport is not legible.
 *
 * Every value a component animates with should come from here rather than being
 * invented at the call site, so the whole board reads as one mechanism.
 *
 * Two rules this module cannot enforce for you, and which reviewers check:
 * - Motion never gates input. The roll control is live the instant the server
 *   says the action is legal, no matter what is still animating.
 * - Motion never becomes the source of truth. The canonical projection wins;
 *   an animated view must converge on it.
 */

/** Milliseconds. DESIGN.md §7.2's budget table, in one place. */
export const GAMEPLAY_MOTION_MS = {
  /** One tile of token travel. A 6-space move is six of these, not one glide. */
  hopPerTile: 140,
  /** Dice stepping through faces and locking. Hard ceiling, not a target. */
  settleMax: 700,
  /** A card, prompt or notice entering. */
  reveal: 240,
  /** A numeric readout counting to its new value. */
  tick: 400,
  /** One-shot acknowledgement of a discrete event (promotion, salary, audit). */
  emphasis: 320,
} as const;

/** Milliseconds. DESIGN.md §7.1 — chrome only. Never spring these. */
export const CHROME_MOTION_MS = {
  instant: 80,
  fast: 120,
  base: 160,
} as const;

/** DESIGN.md's `easing-standard`, as a Motion cubic-bezier array. */
export const EASING_STANDARD = [0.2, 0, 0, 1] as const;

/**
 * The same curve, typed as the MUTABLE 4-tuple Motion's `Transition.ease` and
 * `animate()`'s options actually accept.
 *
 * `EASING_STANDARD` is `as const`, so it is a readonly tuple; some of Motion's
 * overloads reject that, and `[...EASING_STANDARD]` widens to `number[]`, which
 * they also reject. Three components had independently restated this curve
 * locally to get past it — one typed export is the point of a shared vocabulary.
 * Prefer this wherever a value is handed to Motion; `EASING_STANDARD` stays for
 * CSS-string and non-Motion consumers.
 */
export const EASING_STANDARD_BEZIER: [number, number, number, number] = [
  0.2, 0, 0, 1,
];

/**
 * Tight, near-critically-damped springs. DESIGN.md §7.2 permits springs here but
 * requires they not wobble: a token that oscillates to rest reads as a toy, and
 * anticipation/overshoot is banned outright. `bounce: 0` is doing the real work —
 * keep it there when tuning `duration`.
 */
export const GAMEPLAY_SPRING = {
  /**
   * A token *settling* — the plate re-slotting inside its tile's occupancy dock
   * when a neighbour arrives or leaves. NOT the per-tile hop: see
   * `GAMEPLAY_TRANSITION.tokenHop`.
   */
  token: { type: "spring", duration: 0.24, bounce: 0 },
  /** A die locking to its committed face. */
  die: { type: "spring", duration: 0.18, bounce: 0 },
  /** A card or notice arriving. */
  surface: { type: "spring", duration: 0.28, bounce: 0 },
} as const;

/**
 * Non-spring gameplay transitions — the cases where §7.2's "DISCRETE over
 * continuous" rule wants a step that *ends*, not a spring that settles.
 */
export const GAMEPLAY_TRANSITION = {
  /**
   * One tile of token travel.
   *
   * Deliberately a tween whose duration is exactly `hopPerTile`, the same beat
   * the travel machine re-arms on. A 240ms spring chained every 140ms overlaps by
   * ~100ms, so the token decelerates into a tile and accelerates out without ever
   * coming to rest — six of those read as one glide with velocity ripples, which
   * is precisely what §7.2 forbids ("a token moving six spaces HOPS tile-to-tile
   * (six steps), it does not glide"). Matching the tween to the beat makes each
   * hop land and stop, so the movement says what the game state is: discrete.
   */
  tokenHop: {
    duration: GAMEPLAY_MOTION_MS.hopPerTile / 1_000,
    ease: EASING_STANDARD_BEZIER,
  },
};

/**
 * Reduced-motion equivalents. Not "a shorter animation" — a state change. Per
 * §7.2 a reduced-motion player must still be able to tell what happened, so
 * components must carry the information in markup rather than only in movement.
 */
export const REDUCED_MOTION_TRANSITION = { duration: 0 } as const;

/** A ≤80ms crossfade, the one fade §7.2 still allows under reduced motion. */
export const REDUCED_MOTION_FADE = { duration: 0.08, ease: EASING_STANDARD } as const;

/**
 * Total travel time for a move of `tiles` spaces, clamped so a lap-length move
 * cannot stall the game. Callers pace per-tile hops; this is for deciding
 * whether to hop at all or to snap.
 */
export const MAX_TRAVEL_MS = 1200;

export function travelDurationMs(tiles: number): number {
  const steps = Math.max(0, Math.trunc(tiles));
  return Math.min(steps * GAMEPLAY_MOTION_MS.hopPerTile, MAX_TRAVEL_MS);
}

/**
 * True when a move is long enough that hopping every tile would exceed the
 * travel budget, so the caller should snap (or hop a subset) instead of
 * animating past MAX_TRAVEL_MS. Movement rolls one d6, so this is reachable
 * only via bonus movement.
 */
export function shouldSnapTravel(tiles: number): boolean {
  return tiles * GAMEPLAY_MOTION_MS.hopPerTile > MAX_TRAVEL_MS;
}
