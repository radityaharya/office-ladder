import { RiErrorWarningLine } from "@remixicon/react";

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
};

/**
 * The shell's bottom action bar: a status lane, one primary action and the dice
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
        {canRoll ? (
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
        ) : null}
        <DiceReadout
          isRolling={isRolling}
          pendingDiceCount={pendingDiceCount}
          roll={dice}
        />
      </div>
    </section>
  );
}
