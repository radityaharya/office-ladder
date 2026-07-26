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
 * The shell's bottom action bar: one primary action, the dice instrument, and
 * the roll error as a log-style status entry. Edge-to-edge with a hairline top
 * seam and a one-step tonal move off the board plane (DESIGN.md §4.1, §4.3) —
 * deliberately not a floating pill.
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
      {rollError ? (
        <p
          className="dice-tray-alert status-message status-message-error"
          data-slot="action-tray-error"
          role="alert"
        >
          <RiErrorWarningLine aria-hidden="true" className="dice-tray-alert-icon" />
          <span>{rollError}</span>
        </p>
      ) : null}
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
        ) : (
          <p className="dice-tray-wait" data-slot="action-tray-wait">
            <span className="dice-tray-wait-label">Waiting on</span>
            <span className="dice-tray-wait-value">{activePlayerName}</span>
          </p>
        )}
        <DiceReadout
          isRolling={isRolling}
          pendingDiceCount={pendingDiceCount}
          roll={dice}
        />
      </div>
    </section>
  );
}
