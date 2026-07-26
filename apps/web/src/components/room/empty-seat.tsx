import { seatLabel } from "./types";

type EmptySeatProps = {
  /** One-based seat number, matching the roster's mono seat column. */
  readonly seatNumber: number;
  readonly required: boolean;
};

/**
 * A vacancy on the roster. It keeps the roster's column grid exactly so the
 * eye reads one continuous table rather than a gap (DESIGN.md §4.5), and states
 * in words whether the seat is required — not by colour.
 */
export function EmptySeat({ seatNumber, required }: EmptySeatProps) {
  return (
    <div role="listitem" className="shell-seat shell-seat-open" data-open-seat={seatNumber}>
      {/* role="img" so the aria-label is not dropped as a prohibited attribute
          on the generic role — see the same note in player-dossier.tsx. */}
      <span className="shell-seat-num" role="img" aria-label={`Seat ${seatNumber}`}>
        {seatLabel(seatNumber - 1)}
      </span>

      <div className="shell-seat-cell shell-seat-name">
        <span className="shell-body shell-medium">Open seat {seatNumber}</span>
      </div>

      <div className="shell-seat-cell" data-label="Type">
        <span className="shell-status">
          <span
            className={required ? "shell-led shell-led-caution" : "shell-led shell-led-idle"}
            aria-hidden="true"
          />
          <span className="shell-label shell-medium">
            {required ? "Required" : "Optional"}
          </span>
        </span>
      </div>

      <div className="shell-seat-cell" data-label="Assignment">
        <span className="shell-body shell-medium">Vacant</span>
      </div>

      <div className="shell-seat-actions" data-label="Status">
        <span className="shell-label shell-medium">
          {required ? "Blocks start" : "Not required"}
        </span>
      </div>
    </div>
  );
}
