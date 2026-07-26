import { Panel, type PanelChrome } from "./panel";
import { formatPanelSigned, panelClock, panelDeltaSign } from "./panel-format";
import { PanelEmpty, PanelList, PanelRow, type PanelOrigin } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

/**
 * One committed line of the match record.
 *
 * The field names are deliberately those of `ActivityLogEntry` in
 * `turn-rail.tsx`, so an entry built by that module's `buildActivityLog` is
 * assignable to this type without a mapping layer — a structural seam rather
 * than an import, because the rail and the panel kit are separately owned and
 * neither should be able to break the other's build.
 */
export type ActivityPanelEntry = {
  readonly id: string;
  readonly revision: number;
  /** ISO-8601 instant. */
  readonly occurredAt: string;
  /** Sentence-case prose. Never uppercase (DESIGN.md §2.2). */
  readonly text: string;
  readonly delta: { readonly amount: number; readonly unit?: string } | null;
  readonly origin?: PanelOrigin;
  /** Display seat 1..6 of the actor, for the identity rule and the `S2` stamp. */
  readonly slot?: number;
  /** Raw event type, used only to mark turn boundaries. */
  readonly eventType?: string;
};

type ActivityPanelProps = {
  /** Newest first. The panel does not sort — the caller owns the order. */
  readonly entries: readonly ActivityPanelEntry[];
  readonly revision?: number;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * The activity log.
 *
 * This panel is the answer to "i genuinely cant follow the game", so legibility
 * here is a requirement rather than polish. Three things carry it, and all three
 * are in the markup rather than in motion — a reduced-motion player must be able
 * to tell what happened:
 *   1. the origin stamp (`You` / `S2` / `Ops`), so a line's owner is a WORD;
 *   2. the seat-coloured identity rule and one tonal step on the viewer's own
 *      rows, which is "dipisah yang sendiri atau lawan" done by separation
 *      rather than by suppression;
 *   3. an explicitly signed mono delta, so a gain is a `+` and not a colour.
 *
 * Row arrival motion is NOT declared here. The rail's existing `ActivityLog`
 * owns that (a 160ms opacity + 4px transform, arrivals only), and a second
 * implementation would double-animate the same event. If this panel becomes the
 * live log, move that behaviour in — do not re-invent it.
 */
export function ActivityPanel({ entries, revision, scope, chrome }: ActivityPanelProps) {
  const definition = PANEL_DEFINITIONS.activity;
  const mine = entries.filter((entry) => entry.origin === "local").length;

  return (
    <Panel
      chrome={chrome}
      meta={
        entries.length === 0
          ? undefined
          : `${mine} you · ${entries.length} all${revision === undefined ? "" : ` · R${revision}`}`
      }
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {entries.length === 0 ? (
        <PanelEmpty
          detail="Every roll, payment, promotion and prompt the server accepts is recorded here, newest first. Your own lines are marked separately from your opponents'."
          headline="No entries committed"
          summary={definition.summary}
        />
      ) : (
        <PanelList label="Activity log">
          {entries.map((entry) => (
            <PanelRow
              facts={[panelClock(entry.occurredAt), originStamp(entry)]}
              key={entry.id}
              origin={entry.origin ?? "unknown"}
              seat={entry.slot ?? null}
              slot="panel-activity-row"
              title={entry.text}
              trailing={
                entry.delta === null ? undefined : (
                  <span
                    className="panel-delta"
                    data-sign={panelDeltaSign(entry.delta.amount)}
                    data-slot="panel-activity-delta"
                  >
                    {formatPanelSigned(entry.delta.amount)}
                    {entry.delta.unit === undefined ? "" : ` ${entry.delta.unit}`}
                  </span>
                )
              }
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}

/**
 * The scannable origin stamp: `You` on the viewer's own rows, `S2` on another
 * seat's (the same number the board token carries), `Ops` when the office acted
 * with no actor at all.
 */
function originStamp(entry: ActivityPanelEntry): string {
  if (entry.origin === "local") return "You";
  if (entry.origin === "system") return "Ops";
  if (entry.origin === "remote") return entry.slot === undefined ? "Opp" : `S${entry.slot}`;
  return "—";
}
