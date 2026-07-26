import { Panel, type PanelChrome } from "./panel";
import { formatPanelNumber, pluralise } from "./panel-format";
import { PanelEmpty, PanelList, PanelNote, PanelRow, PanelStamp } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

export type QuarterState = "past" | "current" | "future";

export type QuarterStep = {
  readonly index: number;
  /** "Q1", "Q2" — authored by the caller so a mode can name its periods. */
  readonly label: string;
  readonly startsAtRound: number;
  readonly endsAtRound: number;
  readonly state: QuarterState;
  /**
   * The office-wide event scheduled for this quarter, announced a quarter ahead
   * (spec §5.7). Null when nothing is scheduled.
   */
  readonly scheduledEventLabel: string | null;
  readonly resolvedEventLabels: readonly string[];
};

/** The announcement for the NEXT quarter's event — a decision, not a surprise. */
export type QuarterAnnouncement = {
  readonly quarterLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly startsAtRound: number;
};

type QuarterPanelProps = {
  readonly quarters: readonly QuarterStep[];
  readonly round: number;
  readonly announcement: QuarterAnnouncement | null;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * The fiscal calendar and the event track.
 *
 * The announcement is the whole point of this panel. Spec §5.7: "**Announce them
 * one quarter ahead** — a known-in-advance shock that players can prepare for is
 * a decision; an unannounced one is just variance." A docked panel is how an
 * announcement stays available for a whole quarter instead of being a toast a
 * player blinked past — and it is the answer to "notif gak modal yang nutupin"
 * for the one class of notification that genuinely needs to persist.
 *
 * The track is a schedule read left to right, with the current quarter carrying a
 * 2px accent top rule (drawn as an inset pseudo-element, so switching quarters
 * cannot reflow it) and past quarters recessed one tonal step.
 */
export function QuarterPanel({
  quarters,
  round,
  announcement,
  scope,
  chrome,
}: QuarterPanelProps) {
  const definition = PANEL_DEFINITIONS.quarter;
  const current = quarters.find((quarter) => quarter.state === "current") ?? null;

  return (
    <Panel
      chrome={chrome}
      footer={
        <PanelNote tone={announcement === null ? "idle" : "caution"}>
          {announcement === null
            ? "Nothing scheduled for the next quarter yet."
            : `Next quarter (${announcement.quarterLabel}): ${announcement.title}. ${announcement.detail}`}
        </PanelNote>
      }
      meta={`R${formatPanelNumber(round)}${current === null ? "" : ` · ${current.label}`}`}
      panelId={definition.id}
      scope={scope}
      sizing="content"
      title={definition.title}
    >
      {quarters.length === 0 ? (
        <PanelEmpty
          detail="When quarters are on, this track shows the round each one closes on and announces the next office-wide event a quarter ahead, so you can position for it instead of being surprised by it."
          headline="This mode runs no quarters"
          summary={definition.summary}
        />
      ) : (
        <>
          <ol aria-label="Quarters" className="panel-track" data-slot="panel-track">
            {quarters.map((quarter) => (
              <li
                className="panel-track-step"
                data-panel-state={quarter.state}
                data-slot="panel-track-step"
                key={quarter.index}
              >
                <span className="panel-label">{quarter.label}</span>
                <span className="panel-sub">
                  R{formatPanelNumber(quarter.startsAtRound)}–
                  {formatPanelNumber(quarter.endsAtRound)}
                </span>
                {/* Reserved in the markup even when empty, so a quarter gaining
                    an event never changes the track's height. */}
                <span className="panel-sub" data-slot="panel-track-event">
                  {quarter.scheduledEventLabel ?? "—"}
                </span>
              </li>
            ))}
          </ol>
          {quarters.every((quarter) => quarter.resolvedEventLabels.length === 0) ? (
            <div className="panel-block" data-slot="panel-quarter-no-events">
              <p className="panel-empty-copy">
                No office-wide event has fired yet. Each one is announced a quarter
                before it lands.
              </p>
            </div>
          ) : (
            <PanelList label="Resolved events">
              {quarters.flatMap((quarter) =>
                quarter.resolvedEventLabels.map((label) => (
                  <PanelRow
                    key={`${quarter.index}-${label}`}
                    origin="system"
                    slot="panel-quarter-event"
                    stamps={<PanelStamp>{quarter.label}</PanelStamp>}
                    title={label}
                  />
                )),
              )}
            </PanelList>
          )}
        </>
      )}
    </Panel>
  );
}

/** "3 rounds left in Q2" — the one sentence a player needs from the calendar. */
export function quarterSummary(quarters: readonly QuarterStep[], round: number): string {
  const current = quarters.find((quarter) => quarter.state === "current");
  if (current === undefined) return "No quarter is running.";
  const remaining = Math.max(0, current.endsAtRound - round);
  return `${pluralise(remaining, "round")} left in ${current.label}.`;
}
