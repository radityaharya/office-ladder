import { RiErrorWarningLine } from "@remixicon/react";
import type { ReactNode } from "react";

import { DiceReadout, type DiceRollFeedItem } from "./dice";

type ActionTrayProps = {
  readonly activePlayerName: string;
  readonly canRoll: boolean;
  readonly isRolling: boolean;
  readonly rollError: string | null;
  readonly onRoll: () => void;
  /** Latest committed roll, from `useDiceFeed`. Null until one is recorded. */
  readonly dice?: DiceRollFeedItem | null;
  /** Cells to show while the local roll is in flight — movement is one die. */
  readonly pendingDiceCount?: number;
  /**
   * The turn surface's command lane — `<ActionControls surface="turn" …>`.
   *
   * ## Why this is a slot and not a list of props
   *
   * Which control belongs on which surface is `actions/action-registry.ts`'s
   * answer, and the tray must not become a second place that decides. It is handed
   * a rendered lane and hosts it; a twenty-eighth command appears here because the
   * registry says `surface: "turn"`, with no change to this file.
   *
   * ## Why it REPLACES the roll button rather than sitting beside it
   *
   * `turn.roll` is a registry entry like the other eleven turn commands, and the
   * lane renders it in registry order with `primary` emphasis. Keeping the legacy
   * button as well would put two Roll controls in one bar, submitting two
   * different command ids for one intent — the precise thing idempotency by
   * `commandId` exists to prevent. So when a lane is supplied it owns the roll,
   * and the legacy button stays for callers (and tests) that pass no lane.
   *
   * Either way the tray's HEIGHT is constant: the lane is `ActionControls`'
   * fixed-height `bar` layout, which renders a resting readout when nothing is
   * legal rather than collapsing. Nothing in this region may come and go — that
   * regression cost the board a measured 32px once already.
   */
  readonly commands?: ReactNode;
};

/**
 * The shell's bottom action bar: a status lane, the turn's commands and the dice
 * instrument. Edge-to-edge with a hairline top seam and a one-step tonal move
 * off the board plane (DESIGN.md §4.1, §4.3) — deliberately not a floating pill.
 *
 * The status lane is ALWAYS rendered, at a definite height, and that is
 * load-bearing rather than decorative. It used to be a row that existed only
 * when `rollError` was set, so a rejected roll grew the bar and the board's grid
 * row shrank underneath it — the same "board jumps when a notice appears" defect
 * the shell grid exists to prevent, one region further down. Now the lane holds
 * the error when there is one and the waiting-on readout when there is not, so
 * the bar measures the same either way and the state of my turn is stated in
 * words at all times.
 */
export function ActionTray({
  activePlayerName,
  canRoll,
  isRolling,
  rollError,
  onRoll,
  dice = null,
  pendingDiceCount = 1,
  commands = null,
}: ActionTrayProps) {
  return (
    <section aria-label="Current action" className="dice-tray" data-slot="action-tray">
      <div className="hud-lane" data-slot="action-tray-lane">
        {rollError ? (
          <p
            className="hud-lane-text dice-tray-alert status-message status-message-error"
            data-slot="action-tray-error"
            role="alert"
          >
            <RiErrorWarningLine aria-hidden="true" className="dice-tray-alert-icon" />
            <span>{rollError}</span>
          </p>
        ) : canRoll ? (
          <p className="hud-lane-text" data-slot="action-tray-ready">
            <span className="hud-label">Your move</span>
            <span className="hud-sub">Roll to continue.</span>
          </p>
        ) : (
          <p className="hud-lane-text" data-slot="action-tray-wait">
            <span className="hud-label">Waiting on</span>
            <span className="hud-sub">{activePlayerName}</span>
          </p>
        )}
      </div>
      <div className="dice-tray-row">
        {commands ??
          (canRoll ? (
            <button
              aria-busy={isRolling}
              className="dice-tray-primary"
              data-slot="action-tray-roll"
              disabled={isRolling}
              onClick={onRoll}
              type="button"
            >
              {isRolling ? "Rolling" : "Roll die"}
            </button>
          ) : null)}
        <DiceReadout
          isRolling={isRolling}
          pendingDiceCount={pendingDiceCount}
          roll={dice}
        />
      </div>
    </section>
  );
}
