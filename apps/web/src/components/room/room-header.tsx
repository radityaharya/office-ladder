import type { RoomStatus } from "@office-ladder/contracts";

import { RoomCodeCopyButton } from "./room-code-copy-button";

type RoomHeaderProps = {
  readonly roomCode: string;
  readonly playerCount: number;
  readonly capacity?: number;
  readonly minimumPlayers?: number;
  readonly status?: RoomStatus;
  readonly title?: string;
  readonly description?: string;
};

const STATUS_COPY: Record<RoomStatus, { readonly led: string; readonly label: string }> = {
  open: { led: "shell-led shell-led-active", label: "Open" },
  starting: { led: "shell-led shell-led-caution", label: "Starting" },
  active: { led: "shell-led shell-led-info", label: "In progress" },
  completed: { led: "shell-led shell-led-idle", label: "Completed" },
  abandoned: { led: "shell-led shell-led-critical", label: "Abandoned" },
};

/**
 * Room identity as terminal chrome: a 48px bar, then a telemetry strip whose
 * readouts are label + mono value separated by 1px vertical rules — no pills,
 * no icon standing in for a label (DESIGN.md §6.4).
 */
export function RoomHeader({
  roomCode,
  playerCount,
  capacity = 6,
  minimumPlayers = 3,
  status = "open",
  title = "Room assembly",
  description = "Seat the roster, then the host starts the match. Bot seats count toward the minimum, so a solo host can start with two of them.",
}: RoomHeaderProps) {
  const statusCopy = STATUS_COPY[status] ?? STATUS_COPY.open;

  return (
    <header>
      <div className="shell-bar">
        <div className="shell-bar-group">
          <span className="shell-label shell-high">Office Ladder</span>
          <span className="shell-caption shell-medium">/ Facilities &mdash; room assembly</span>
        </div>
        <div className="shell-bar-group">
          <span className="shell-status">
            <span className={statusCopy.led} aria-hidden="true" />
            <span className="shell-label shell-medium">
              <span className="shell-sr-only">Room status: </span>
              {statusCopy.label}
            </span>
          </span>
          <a className="shell-btn shell-btn-ghost shell-btn-sm" href="/">
            Exit room
          </a>
        </div>
      </div>

      <div className="shell-strip">
        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Room code</span>
          <span className="shell-strip-cell-inline">
            <code className="shell-data shell-high shell-input-code">{roomCode}</code>
            <RoomCodeCopyButton roomCode={roomCode} />
          </span>
        </div>

        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Seats</span>
          <span className="shell-data shell-high">
            {playerCount} / {capacity}
          </span>
        </div>

        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Minimum</span>
          <span className="shell-data shell-high">{minimumPlayers} to start</span>
        </div>

        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Supported</span>
          <span className="shell-data shell-high">
            {minimumPlayers}&ndash;{capacity} players
          </span>
        </div>
      </div>

      <div className="shell-region shell-region-surface shell-stack shell-seam-bottom">
        <h1 className="shell-display shell-high">{title}</h1>
        <p className="shell-body shell-medium shell-prose">{description}</p>
      </div>
    </header>
  );
}
