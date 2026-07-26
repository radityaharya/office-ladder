import type { RoomStatus } from "@office-ladder/contracts";

import type { LobbyPlayer } from "./types";

type ReadinessSummaryProps = {
  readonly players: readonly LobbyPlayer[];
  readonly minimumPlayers?: number;
  readonly maximumPlayers?: number;
  readonly roomStatus?: RoomStatus;
};

export type StartCheck = {
  readonly level: "blocked" | "standby" | "cleared";
  readonly label: string;
  /** One sentence naming exactly what is missing, or confirming nothing is. */
  readonly detail: string;
  readonly memberCount: number;
  readonly humanCount: number;
  readonly botCount: number;
  readonly seatsToMinimum: number;
};

/**
 * The single source of truth for "can this room start, and if not, what is
 * missing". Both the summary strip and the host's requisition control read it,
 * so the lobby can never say one thing and offer another.
 */
export function evaluateStartCheck(
  players: readonly LobbyPlayer[],
  minimumPlayers: number,
  roomStatus: RoomStatus = "open",
): StartCheck {
  const memberCount = players.length;
  const botCount = players.filter((player) => player.isBot).length;
  const humanCount = memberCount - botCount;
  const seatsToMinimum = Math.max(0, minimumPlayers - memberCount);
  const notReady = players.filter((player) => !player.isReady).length;

  if (roomStatus === "starting") {
    return {
      level: "standby",
      label: "Starting",
      detail: "The host has started the match. Handing you to the floor.",
      memberCount,
      humanCount,
      botCount,
      seatsToMinimum,
    };
  }

  if (roomStatus !== "open") {
    return {
      level: "blocked",
      label: "Closed",
      detail: `This room is ${roomStatus} and can no longer be started.`,
      memberCount,
      humanCount,
      botCount,
      seatsToMinimum,
    };
  }

  if (seatsToMinimum > 0) {
    return {
      level: "blocked",
      label: "Blocked",
      detail:
        `${seatsToMinimum} more ${seatsToMinimum === 1 ? "member" : "members"} ` +
        `required — ${memberCount} of ${minimumPlayers} minimum. ` +
        "Bot seats count toward the minimum, so you can start alone.",
      memberCount,
      humanCount,
      botCount,
      seatsToMinimum,
    };
  }

  if (notReady > 0) {
    return {
      level: "standby",
      label: "Standby",
      detail: `${notReady} of ${memberCount} still on standby. The host can start anyway.`,
      memberCount,
      humanCount,
      botCount,
      seatsToMinimum,
    };
  }

  return {
    level: "cleared",
    label: "Cleared",
    detail: `Minimum headcount met with ${memberCount} members. The host can start the match.`,
    memberCount,
    humanCount,
    botCount,
    seatsToMinimum,
  };
}

const LED_CLASS: Record<StartCheck["level"], string> = {
  blocked: "shell-led shell-led-critical",
  standby: "shell-led shell-led-caution",
  cleared: "shell-led shell-led-active",
};

/**
 * Telemetry strip + one prose line. Every readout is [uppercase label] +
 * [mono tabular value] separated by 1px vertical rules, and the status light is
 * a 6px square paired with its text label (DESIGN.md §6.4).
 */
export function ReadinessSummary({
  players,
  minimumPlayers = 3,
  maximumPlayers = 6,
  roomStatus = "open",
}: ReadinessSummaryProps) {
  const check = evaluateStartCheck(players, minimumPlayers, roomStatus);
  const readyCount = players.filter((player) => player.isReady).length;
  const filledRatio =
    maximumPlayers > 0 ? Math.min(1, check.memberCount / maximumPlayers) : 0;
  const minimumMet = check.seatsToMinimum === 0;

  return (
    /*
     * The live region is the single detail sentence, NOT this whole section. The
     * lobby re-polls every 2s, and with `aria-live` on the container every
     * changed readout announced on its own — "4", "2 / 6" — with no label and no
     * context, several times per join. The detail line is the one utterance that
     * carries the whole state in words, so it announces atomically and the
     * six numeric readouts stay silent.
     */
    <section aria-label="Start check">
      <div className="shell-strip">
        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Start check</span>
          <span className="shell-strip-cell-inline">
            <span className={LED_CLASS[check.level]} aria-hidden="true" />
            <span className="shell-data shell-high">{check.label}</span>
          </span>
        </div>

        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Headcount</span>
          <span className="shell-data shell-high">
            {check.memberCount} / {minimumPlayers} min
          </span>
        </div>

        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Occupancy</span>
          <span className="shell-strip-cell-inline">
            <span className="shell-data shell-high">
              {check.memberCount} / {maximumPlayers}
            </span>
            <span
              className="shell-meter"
              style={{ width: "64px" }}
              role="img"
              aria-label={`${check.memberCount} of ${maximumPlayers} seats filled`}
            >
              <span
                className={
                  minimumMet ? "shell-meter-fill shell-meter-fill-reached" : "shell-meter-fill"
                }
                style={{ width: `${Math.round(filledRatio * 100)}%`, display: "block" }}
              />
            </span>
          </span>
        </div>

        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Human</span>
          <span className="shell-data shell-high">{check.humanCount}</span>
        </div>

        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Bot</span>
          <span className="shell-data shell-high">{check.botCount}</span>
        </div>

        <div className="shell-strip-cell">
          <span className="shell-label shell-medium">Ready</span>
          <span className="shell-data shell-high">
            {readyCount} / {check.memberCount}
          </span>
        </div>
      </div>

      <p
        aria-atomic="true"
        aria-live="polite"
        className="shell-region shell-region-sunken shell-seam-bottom shell-body shell-medium shell-prose"
        data-slot="start-check-detail"
      >
        {check.detail}
      </p>
    </section>
  );
}
