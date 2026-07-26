import type { ModeSummary } from "./mode-presets";
import { ModeSystemLine, ModeTagRow } from "./mode-summary-view";

export type ModeBriefingData = {
  /** The preset the room was created under, e.g. "Standard". */
  readonly presetName: string;
  /** True when the room carries a host-authored ruleset instead of the preset. */
  readonly custom: boolean;
  readonly summary: ModeSummary;
};

/**
 * What this room is actually going to play, in the lobby.
 *
 * Contracts puts it plainly on `CreateRoomRequest.rules`: "Every player must be
 * shown the exact terms before they sit down." Somebody who joined with a code
 * never saw the create form, and the host who filled it in may have done so
 * twenty minutes ago — so the ruleset is restated here, derived by exactly the
 * same code that described it in the picker.
 *
 * Placed immediately above the start control rather than at the top of the
 * panel: this is the last thing read before a match becomes irreversible, and it
 * must not push the roster down every time the lobby re-polls.
 */
export function ModeBriefing({ presetName, custom, summary }: ModeBriefingData) {
  const on = summary.facets.filter((facet) => facet.enabled);
  const off = summary.facets.filter((facet) => !facet.enabled);

  return (
    <section
      className="shell-region shell-seam-top mode-brief"
      aria-labelledby="lobby-mode-title"
      data-slot="mode-briefing"
    >
      <div className="mode-brief-head">
        <h3 id="lobby-mode-title" className="shell-label shell-high">
          Match rules
        </h3>
        <span className="shell-tag shell-tag-strong">
          {custom ? `Custom — from ${presetName}` : presetName}
        </span>
        <span className="shell-caption shell-medium">{summary.turnClock}</span>
      </div>

      <p className="shell-body shell-medium shell-prose">
        {summary.length} — {summary.ending}. {summary.scoring} {summary.stakes}
      </p>

      <ModeSystemLine state="on" facets={on} />
      <ModeSystemLine state="off" facets={off} />
      <ModeTagRow tags={summary.tags} />
    </section>
  );
}
