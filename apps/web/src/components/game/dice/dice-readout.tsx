import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

import { GAMEPLAY_SPRING, REDUCED_MOTION_TRANSITION } from "@/lib/motion";

import { useDiceSettle } from "./use-dice-settle";

/** Display-ready shape for one committed roll. Faces are always the server's own. */
export type DiceRollFeedItem = {
  readonly eventId: string;
  readonly faces: readonly number[];
  readonly total: number;
  readonly purpose: string;
  readonly rollerName: string;
  readonly isSelf: boolean;
  readonly isBot: boolean;
  /**
   * 1..6 turn-order slot, so the roller carries the same seat colour and
   * numeral the rail and the board tokens use. Optional because a system roll
   * has no seat.
   */
  readonly seat?: number | null;
};

export type DiceReadoutProps = {
  /** The latest committed roll, or null when the match has recorded none yet. */
  readonly roll: DiceRollFeedItem | null;
  /** True while the local player's own roll request is in flight. */
  readonly isRolling: boolean;
  /** Cells to show in flight. Movement rolls exactly one die, so 1 is correct. */
  readonly pendingDiceCount?: number;
  /** Purpose named while in flight. The only optimistic roll is movement. */
  readonly pendingPurpose?: string;
};

const purposeLabels: Readonly<Record<string, string>> = {
  "normal-movement": "Movement roll",
  "audit-release": "Audit release roll",
};

const statusLabels = {
  empty: "Idle",
  rolling: "Rolling",
  stepping: "Settling",
  settled: "Committed",
} as const;

/**
 * How far a cell sits above its seat while it is still stepping.
 *
 * Deliberately 3px, and deliberately in the same direction as the tonal move
 * the stylesheet already makes: a stepping cell is `surface-raised`, a locked
 * one drops to `card`. This is the seat of a mechanical part, not anticipation —
 * there is no windup away from the target and, with `GAMEPLAY_SPRING.die`'s
 * `bounce: 0`, no overshoot to rest from.
 */
const CELL_LIFT_PX = 3;

/**
 * The dice instrument: a committed roll presented as terminal telemetry.
 *
 * Pure function of its props — the settle sequence is keyed off the event id,
 * so a replayed projection cannot re-fire it, and the first synchronous render
 * is always the correct resting state, with the real committed faces in the
 * markup rather than only in the animation.
 */
export function DiceReadout({
  roll,
  isRolling,
  pendingDiceCount = 1,
  pendingPurpose = "normal-movement",
}: DiceReadoutProps) {
  const prefersReducedMotion = useReducedMotion() === true;
  const { phase, cells } = useDiceSettle({
    eventKey: roll?.eventId ?? null,
    faces: roll?.faces ?? [],
    isRolling,
    pendingCellCount: pendingDiceCount,
  });

  const faceCount = roll?.faces.length ?? 0;
  const showTotal = roll !== null && faceCount > 1;
  const purpose = isRolling ? pendingPurpose : (roll?.purpose ?? pendingPurpose);
  const lockTransition = prefersReducedMotion
    ? REDUCED_MOTION_TRANSITION
    : GAMEPLAY_SPRING.die;

  return (
    /*
     * `tabIndex={0}` is an accessibility requirement, not a nicety: the readout
     * is `overflow-x: auto` and goes full width below 768px, so on a narrow
     * viewport some fields are only reachable by scrolling. A scroll container
     * that cannot be focused cannot be scrolled by keyboard at all (WCAG 2.1.1),
     * which is why the HUD strip does the same thing. The label makes the stop
     * meaningful rather than an unexplained focus ring.
     */
    <section
      aria-label="Dice readout"
      className="dice-readout"
      data-dice-actor={actorKind(roll, isRolling)}
      data-dice-state={phase}
      data-slot="dice-readout"
      tabIndex={0}
    >
      <div className="dice-readout-field">
        <span className="dice-readout-label">{purposeLabel(purpose)}</span>
        {/* Stepping/placeholder digits are not information — keep them out of
            the accessibility tree and let the live region carry the result. */}
        <span aria-hidden={phase === "settled" ? undefined : true} className="dice-faces">
          {cells.map((cell, index) => (
            <m.span
              /*
               * The lift exists only while a cell is stepping toward a face it
               * already knows, so the drop to 0 happens exactly once per
               * committed roll — that drop *is* the lock. An idle or in-flight
               * instrument rests at 0, because a readout parked 3px above its
               * seat with nothing happening is an ambient state, and §7.2
               * forbids those.
               */
              animate={{ y: phase === "stepping" && !cell.locked ? -CELL_LIFT_PX : 0 }}
              className="dice-face"
              data-dice-cell={phase}
              data-dice-face={cell.face ?? ""}
              data-dice-locked={cell.locked ? "true" : "false"}
              /* `initial={false}` is what keeps the resting render static: the
                 target is applied without a mount animation, so a page that
                 loads mid-match shows its last committed roll seated rather
                 than dropping it in. */
              initial={false}
              key={index}
              transition={lockTransition}
            >
              <span className="dice-face-value">
                {cell.face === null ? "–" : cell.face}
              </span>
            </m.span>
          ))}
        </span>
      </div>
      {showTotal ? (
        <div className="dice-readout-field" data-slot="dice-readout-total">
          <span className="dice-readout-label">Total</span>
          <span className="dice-readout-value">{roll.total}</span>
        </div>
      ) : null}
      <div className="dice-readout-field">
        <span className="dice-readout-label">Rolled by</span>
        <span className="dice-readout-name">
          {/* Whose roll it was has to survive a glance at a moving board, so it
              is stated three ways: the seat numeral, the seat colour, and the
              name. Colour is never the only carrier (DESIGN.md §8). */}
          {roll?.seat != null ? (
            <>
              <span
                aria-hidden="true"
                className={`dice-seat dice-seat-${roll.seat}`}
                data-slot="dice-readout-seat"
              >
                {roll.seat}
              </span>
              <span className="sr-only">Seat {roll.seat}. </span>
            </>
          ) : null}
          {rollerText(roll, isRolling)}
        </span>
      </div>
      <div className="dice-readout-field">
        <span className="dice-readout-label">Status</span>
        <span className="dice-readout-name">
          <span
            aria-hidden="true"
            className="dice-led"
            data-dice-led={phase === "empty" ? "idle" : "live"}
          />
          {statusLabels[phase]}
        </span>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement(roll, phase)}
      </p>
    </section>
  );
}

export function purposeLabel(purpose: string): string {
  const authored = purposeLabels[purpose];
  if (authored !== undefined) return authored;
  const words = purpose.replaceAll(".", " ").replaceAll("-", " ").trim();
  if (words.length === 0) return "Roll";
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} roll`;
}

function actorKind(
  roll: DiceRollFeedItem | null,
  isRolling: boolean,
): "self" | "bot" | "remote" | "none" {
  if (isRolling) return "self";
  if (roll === null) return "none";
  if (roll.isSelf) return "self";
  return roll.isBot ? "bot" : "remote";
}

function rollerText(roll: DiceRollFeedItem | null, isRolling: boolean): string {
  if (isRolling) return "You";
  if (roll === null) return "—";
  if (roll.isSelf) return "You";
  return roll.isBot ? `${roll.rollerName} · Bot` : roll.rollerName;
}

function announcement(
  roll: DiceRollFeedItem | null,
  phase: ReturnType<typeof useDiceSettle>["phase"],
): string {
  if (phase !== "settled" || roll === null) return "";
  const who = roll.isSelf ? "You" : roll.rollerName;
  const faces = roll.faces.join(" and ");
  return roll.faces.length > 1
    ? `${who} rolled ${faces}. Total ${roll.total}.`
    : `${who} rolled ${faces}.`;
}
