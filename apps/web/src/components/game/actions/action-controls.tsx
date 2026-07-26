/**
 * `ActionControls` — the one component a host mounts, three times.
 *
 * The integrator does not assemble twenty-seven controls; it mounts this once per
 * surface and hands it the legal actions the server sent:
 *
 * ```tsx
 * <ActionControls surface="turn"     … />   // the command lane under the board
 * <ActionControls surface="decision" … />   // the open decision, never behind a tab
 * <ActionControls surface="rail" panelId="projects" … />  // inside each panel
 * ```
 *
 * Which control goes where is `action-registry.ts`'s answer, not this file's, and
 * not the host's. That is the whole architecture: a twenty-eighth command becomes
 * legal, the server advertises it, a registry entry names its surface, and it
 * appears — with no change here and none in the shell.
 *
 * ## The two rules this component enforces
 *
 * 1. **Not enumerated ⇒ not rendered.** The only actions drawn are the ones in
 *    `actions`. There is no code path that renders a control for an action the
 *    server did not advertise, because a disabled button for a rule that does not
 *    exist invents one. (The complementary half — enumerated but unaffordable
 *    renders DISABLED with its price — lives in `ActionDescription.blocked`.)
 * 2. **A definite track cannot change size.** The `bar` layout is a fixed-height
 *    region that renders whether or not anything is legal, with a resting readout
 *    when nothing is: `.game-shell-action`'s own stylesheet records that a
 *    conditional row there re-sized the board by 32px, and "nothing that appears
 *    or disappears may move the board" has been reported twice. Controls scroll
 *    horizontally inside the lane; the lane never wraps and never grows.
 */
import type { LegalActionSummary, LegalActionSummaryType } from "@office-ladder/contracts";

import { cn } from "@/lib/utils";

import {
  type ActionContext,
  type ActionDescription,
  type ActionSubmit,
  type ActionSurface,
  type PanelId,
} from "./action-model";
import { ACTION_REGISTRY, actionEntry } from "./action-registry";

export type ActionControlsLayout = "bar" | "inline";

export type ActionControlsProps = {
  /** Exactly what the server advertised. Never a superset, never a guess. */
  readonly actions: readonly LegalActionSummary[];
  readonly surface: ActionSurface;
  /** Required in practice when `surface === "rail"`: which panel is mounting. */
  readonly panelId?: PanelId | null;
  readonly context: ActionContext;
  readonly onSubmit: ActionSubmit;
  /** The command in flight, so its own control reads busy and nothing else does. */
  readonly pending?: LegalActionSummaryType | null;
  /** A refusal from the last submit. Rendered inside the track, never above it. */
  readonly error?: string | null;
  /**
   * `bar` is a fixed-height track with a resting state; `inline` is a wrapping
   * cluster that renders nothing when empty. Defaults by surface — pass it
   * explicitly to host the decision controls inside an existing 40px row (the
   * attention band already reserves one).
   */
  readonly layout?: ActionControlsLayout;
  /** What the resting `bar` says. Sentence case. */
  readonly resting?: string;
  readonly scope?: string;
  /** Accessible name for the region. */
  readonly label?: string;
};

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The actions one surface owns, in registry order.
 *
 * Stable within an order tie: `Array.prototype.sort` is stable in every engine
 * this ships to, so two ballots keep the order the server enumerated them in —
 * which is the only order that means anything.
 */
export function actionsForSurface(
  actions: readonly LegalActionSummary[],
  surface: ActionSurface,
  panelId: PanelId | null = null,
): readonly LegalActionSummary[] {
  return actions
    .filter((action) => {
      const entry = ACTION_REGISTRY[action.type];
      if (entry === undefined || entry.surface !== surface) return false;

      return surface === "rail" ? entry.panelId === panelId : true;
    })
    .sort((left, right) => ACTION_REGISTRY[left.type].order - ACTION_REGISTRY[right.type].order);
}

/**
 * How many legal actions each panel is holding — one badge count per rail tab
 * (§12.3), computed from the same registry that decides placement, so a badge can
 * never disagree with what is behind the tab.
 */
export function panelActionCounts(
  actions: readonly LegalActionSummary[],
): Readonly<Partial<Record<PanelId, number>>> {
  const counts: Partial<Record<PanelId, number>> = {};
  for (const action of actions) {
    const entry = ACTION_REGISTRY[action.type];
    if (entry === undefined || entry.surface !== "rail" || entry.panelId === null) continue;
    counts[entry.panelId] = (counts[entry.panelId] ?? 0) + 1;
  }

  return counts;
}

/** True when something is waiting on this player right now. */
export function hasOpenDecision(actions: readonly LegalActionSummary[]): boolean {
  return actions.some((action) => ACTION_REGISTRY[action.type]?.surface === "decision");
}

/** The copy for one action, for a host that needs a label or a price of its own. */
export function describeAction(
  action: LegalActionSummary,
  context: ActionContext,
): ActionDescription {
  return actionEntry(action.type).describe(action, context);
}

/**
 * A key that survives reordering.
 *
 * Several actions can share a type — one `ballot.cast` per open ballot, one
 * `agreement.respond` per offer — so the type alone is not a key. The first id
 * field present is used, which is field-agnostic on purpose: a new action type
 * with a new id field keys itself correctly without touching this list, and falls
 * back to its position if it has no id at all.
 */
const KEY_FIELDS = [
  "ballotId",
  "agreementId",
  "decisionPointId",
  "tileId",
  "abilityId",
  "toRankId",
] as const;

export function actionKey(action: LegalActionSummary, index: number): string {
  const record = action as unknown as Record<string, unknown>;
  for (const field of KEY_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return `${action.type}:${value}`;
  }

  return `${action.type}:${String(index)}`;
}

/* -------------------------------------------------------------------------- */
/* The component                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_RESTING: Readonly<Record<ActionSurface, string>> = {
  turn: "Nothing is yours to do yet. The lane fills when it is your move.",
  decision: "Nothing is waiting on your answer.",
  rail: "No action here yet.",
};

export function ActionControls({
  actions,
  surface,
  panelId = null,
  context,
  onSubmit,
  pending = null,
  error = null,
  layout,
  resting,
  scope,
  label,
}: ActionControlsProps) {
  const selected = actionsForSurface(actions, surface, panelId);
  const shape: ActionControlsLayout = layout ?? (surface === "rail" ? "inline" : "bar");
  const baseScope = scope ?? (surface === "rail" ? (panelId ?? "rail") : surface);

  /*
   * Two controls of the same type in one surface would otherwise share every DOM
   * id — and a popover whose id is duplicated opens the wrong sheet. The first of
   * a type keeps the clean scope so ids stay readable in the common case; each
   * duplicate gets a suffix.
   */
  const seen = new Map<LegalActionSummaryType, number>();
  const controls = selected.map((action, index) => {
    const entry = actionEntry(action.type);
    const sequence = seen.get(action.type) ?? 0;
    seen.set(action.type, sequence + 1);
    const controlScope = sequence === 0 ? baseScope : `${baseScope}-${String(sequence + 1)}`;
    const Control = entry.Control;

    return (
      <Control
        action={action}
        context={context}
        description={entry.describe(action, context)}
        key={actionKey(action, index)}
        onSubmit={onSubmit}
        pending={pending === action.type}
        scope={controlScope}
      />
    );
  });

  const alert =
    error === null ? null : (
      <p className="actions-alert" data-slot="action-controls-error" role="alert">
        <span aria-hidden="true" className="actions-led" data-tone="critical" />
        <span>{error}</span>
      </p>
    );

  if (shape === "inline") {
    // A panel with no legal action shows no control cluster at all. The rail is a
    // definite grid track and each panel body scrolls, so nothing above or below
    // moves when a cluster appears — and an always-present empty cluster would be
    // one more thing to read in a twelve-destination interface.
    if (controls.length === 0 && alert === null) return null;

    return (
      <div
        aria-label={label}
        className="actions-group"
        data-panel={panelId ?? undefined}
        data-slot="action-controls"
        data-surface={surface}
        role="group"
      >
        {alert}
        {controls}
      </div>
    );
  }

  return (
    <section
      aria-label={label ?? (surface === "decision" ? "Open decision" : "Your commands")}
      className={cn("actions-bar")}
      data-empty={controls.length === 0 ? "true" : "false"}
      data-slot="action-controls"
      data-surface={surface}
    >
      <div
        className="actions-lane"
        data-slot="action-lane"
        /* A suppressed-scrollbar overflow region: without a tab stop its trailing
           controls would be pointer-only on a narrow viewport (§8). */
        tabIndex={0}
      >
        {alert}
        {controls.length === 0 && alert === null ? (
          <p className="actions-rest" data-slot="action-controls-rest">
            <span aria-hidden="true" className="actions-led" data-tone="idle" />
            <span>{resting ?? DEFAULT_RESTING[surface]}</span>
          </p>
        ) : (
          controls
        )}
      </div>
    </section>
  );
}
