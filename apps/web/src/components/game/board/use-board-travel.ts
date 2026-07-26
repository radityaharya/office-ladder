import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { GAMEPLAY_MOTION_MS, shouldSnapTravel } from "../../../lib/motion";

import type { PlayerTokenView } from "./types";

/**
 * Token travel, as a discrete state machine (DESIGN.md §7.2).
 *
 * The projection is the only source of truth. Each token therefore carries two
 * numbers: the space the server says it is on (`truth`) and the space the view
 * is currently drawing it on (`render`). The token element positions itself at
 * `truth` in plain CSS and Motion animates only the *delta* between the two —
 * so a delta of zero is a token at its real space, and the very first
 * synchronous render (and `renderToStaticMarkup`) is always a correct resting
 * board with no animation and no measurement.
 *
 * That framing is what makes the three hard cases fall out rather than needing
 * special-casing:
 *
 * - **Wrap.** `render` advances `+1 (mod spaceCount)`, so 42 → 43 → 0 → 1 walks
 *   forward through the corner. Consecutive board indices are always adjacent
 *   grid cells, so hopping index-by-index traces the track instead of cutting
 *   across the interior. There is no path-finding here at all.
 * - **Interruption.** A newer projection re-targets from wherever the token is
 *   *currently drawn*, not from where the old move started, and re-checks the
 *   travel budget. Nothing can be left stranded: if the machine is torn down at
 *   any point the delta collapses to zero, which is the truth.
 * - **Simultaneity.** Every token advances on one shared beat, so a burst of
 *   bot moves reads as one mechanism instead of several racing timers.
 *
 * Long moves snap instead of exceeding the budget (`shouldSnapTravel`), and
 * `prefers-reduced-motion` collapses the whole thing to instant state changes —
 * read through Motion's `useReducedMotion`, never at module scope.
 */

export type BoardTravelEntry = {
  /** Space the projection says this token is on. */
  readonly truth: number;
  /** Space the view is drawing this token on right now. */
  readonly render: number;
  /**
   * Bumped every time `render` reaches `truth` after a real move. Used as a
   * React key so the one-shot landing acknowledgement replays per arrival
   * without a timer, and stays a one-shot rather than an ambient loop.
   */
  readonly arrival: number;
  /**
   * Hops taken since this travel began. 0 is the commit where the projection
   * moved `truth` forward while `render` stayed behind — the token's offset
   * jumps a whole edge in that single commit, and animating it is what made the
   * token appear to shoot to its destination and then slide backwards before
   * hopping. Step 0 must be applied instantly; every step after it is one real
   * hop and animates. Also 0 at rest and after a snap, where the offset is
   * already zero and "instant" is a no-op.
   */
  readonly step: number;
};

export type BoardTravel = {
  /** Space to draw `playerId` on. Equals the projection unless mid-travel. */
  readonly renderPosition: (playerId: string) => number | null;
  /**
   * Hop index for `playerId` — 0 means "place this offset without animating".
   * See `BoardTravelEntry.step`.
   */
  readonly travelStep: (playerId: string) => number;
  /** Arrival serial for `playerId`; 0 means it has never moved in this view. */
  readonly arrival: (playerId: string) => number;
  /** True while any token is still catching up to the projection. */
  readonly isTravelling: boolean;
  /** True when the viewer asked for reduced motion. */
  readonly isReduced: boolean;
};

export function useBoardTravel({
  players,
  spaceCount,
}: {
  readonly players: readonly PlayerTokenView[];
  readonly spaceCount: number;
}): BoardTravel {
  const isReduced = useReducedMotion() === true;
  const [entries, setEntries] = useState<ReadonlyMap<string, BoardTravelEntry>>(() =>
    seed(players),
  );

  // Reconciling during render (rather than in an effect) is deliberate: the
  // token's true cell and its travel delta have to land in the SAME commit, or
  // the token would paint one frame at its destination before hopping there.
  // This is the documented "adjust state when props change" pattern — no
  // browser API, no effect, and the first render of a fresh board is at rest.
  const reconciled = reconcileTravel(entries, players, spaceCount, isReduced);
  if (reconciled) setEntries(reconciled);
  const current = reconciled ?? entries;

  const isTravelling = [...current.values()].some(
    (entry) => entry.render !== entry.truth,
  );

  useEffect(() => {
    if (isReduced || !isTravelling || spaceCount <= 0) return;

    // One timeout per hop, re-armed by the state change it causes. A single
    // beat for every token, and it stops on its own the moment the view agrees
    // with the projection.
    const timer = window.setTimeout(() => {
      setEntries((previous) => advanceTravel(previous, spaceCount) ?? previous);
    }, GAMEPLAY_MOTION_MS.hopPerTile);

    return () => window.clearTimeout(timer);
  }, [current, isReduced, isTravelling, spaceCount]);

  return {
    arrival: (playerId) => current.get(playerId)?.arrival ?? 0,
    isReduced,
    isTravelling,
    renderPosition: (playerId) => current.get(playerId)?.render ?? null,
    travelStep: (playerId) => current.get(playerId)?.step ?? 0,
  };
}

function seed(players: readonly PlayerTokenView[]): ReadonlyMap<string, BoardTravelEntry> {
  return new Map(
    players.map((player) => [
      player.id,
      { arrival: 0, render: player.position, step: 0, truth: player.position },
    ]),
  );
}

/**
 * Folds a fresh projection into the machine. Returns `null` when nothing
 * changed, which is what keeps the render-phase update from looping.
 */
export function reconcileTravel(
  previous: ReadonlyMap<string, BoardTravelEntry>,
  players: readonly PlayerTokenView[],
  spaceCount: number,
  isReduced: boolean,
): ReadonlyMap<string, BoardTravelEntry> | null {
  const next = new Map<string, BoardTravelEntry>();
  let changed = false;

  for (const player of players) {
    const before = previous.get(player.id);
    const entry = resolveEntry(before, player.position, spaceCount, isReduced);
    next.set(player.id, entry);
    if (
      !before ||
      before.truth !== entry.truth ||
      before.render !== entry.render ||
      before.arrival !== entry.arrival
    ) {
      changed = true;
    }
  }

  // Compared after the fact rather than against `players.length`, so a
  // duplicated id cannot make this report "changed" on every single render.
  return changed || previous.size !== next.size ? next : null;
}

function resolveEntry(
  before: BoardTravelEntry | undefined,
  truth: number,
  spaceCount: number,
  isReduced: boolean,
): BoardTravelEntry {
  // A token this view has never drawn starts at rest on its real space: joining
  // a match in progress must never animate a lap of catch-up.
  if (!before) return { arrival: 0, render: truth, step: 0, truth };

  const snapped = { arrival: before.arrival + 1, render: truth, step: 0, truth };
  if (isReduced) {
    return before.render === truth && before.truth === truth
      ? before
      : { ...snapped, arrival: before.arrival };
  }
  if (before.truth === truth) return before;

  // Re-target from where the token is *drawn*, so an interrupted move measures
  // the distance it actually still has to cover.
  const distance = forwardDistance(before.render, truth, spaceCount);
  if (distance === 0) return { ...before, truth };
  if (shouldSnapTravel(distance)) return snapped;

  // Step 0: the offset jumps a whole edge in this one commit, so the token
  // must be PLACED at its origin, not animated to it.
  return { arrival: before.arrival, render: before.render, step: 0, truth };
}

/** Advances every travelling token by exactly one space along the ring. */
export function advanceTravel(
  previous: ReadonlyMap<string, BoardTravelEntry>,
  spaceCount: number,
): ReadonlyMap<string, BoardTravelEntry> | null {
  let changed = false;
  const next = new Map<string, BoardTravelEntry>();

  for (const [id, entry] of previous) {
    if (entry.render === entry.truth) {
      next.set(id, entry);
      continue;
    }

    changed = true;
    const render = (entry.render + 1) % spaceCount;
    next.set(id, {
      arrival: render === entry.truth ? entry.arrival + 1 : entry.arrival,
      render,
      step: entry.step + 1,
      truth: entry.truth,
    });
  }

  return changed ? next : null;
}

/** Spaces travelled going clockwise from `from` to `to`. Never negative. */
export function forwardDistance(from: number, to: number, spaceCount: number): number {
  if (spaceCount <= 0) return 0;

  return (((to - from) % spaceCount) + spaceCount) % spaceCount;
}
