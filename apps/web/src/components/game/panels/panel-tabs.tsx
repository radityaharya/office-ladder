import { useCallback, useRef, type KeyboardEvent } from "react";

import { PanelAttentionBadge, type PanelAttention } from "./panel";
import { panelDomId, panelTabDomId } from "./panel-registry";

/**
 * One destination in the strip.
 *
 * A destination the current mode has switched off is ABSENT, not disabled — the
 * host builds the tab list from `ModeRules`, so a mode with `projects.enabled:
 * false` simply has no Projects tab. `disabled` is for a destination that exists
 * but cannot be entered right now.
 */
export type PanelTab = {
  readonly id: string;
  /** Short, sentence case in source; uppercased in CSS (DESIGN.md §2.2). */
  readonly label: string;
  readonly attention?: PanelAttention | null;
  readonly disabled?: boolean;
};

type PanelTabsProps = {
  readonly tabs: readonly PanelTab[];
  readonly activeTabId: string;
  readonly onSelect: (tabId: string) => void;
  /** Accessible name for the strip. */
  readonly label?: string;
  /** Disambiguates DOM ids when a page mounts more than one panel host. */
  readonly scope?: string;
};

/**
 * The tab strip.
 *
 * Full ARIA tabs contract: `role="tablist"` on the strip, `role="tab"` +
 * `aria-selected` + `aria-controls` on each tab, and a roving tabindex so the
 * strip is ONE tab stop rather than twelve. Arrow keys move between tabs
 * (horizontal and vertical, because the strip wraps into rows when its container
 * is wide), Home/End jump to the ends, and disabled tabs are skipped rather than
 * focused-and-refused.
 *
 * Activation is automatic — moving focus selects — which is the APG's own
 * default for tabs whose panels are cheap to render, and all twelve of these are
 * local projections rather than fetches.
 *
 * **Motion is chrome, so it stays severe (DESIGN.md §7.1).** The active
 * indicator is a 2px accent rule that CHANGES COLOUR over 120ms; there is no
 * sliding shared indicator, no spring and no overshoot. It is drawn as an
 * always-present pseudo-element (styles/panels.css), so selecting a tab cannot
 * reflow the strip.
 *
 * There is one browser API in this component — `focus()` inside a key handler —
 * and it is never called during render, so the strip's resting state is fully
 * produced by the first synchronous pass and `renderToStaticMarkup` sees it.
 */
export function PanelTabs({
  tabs,
  activeTabId,
  onSelect,
  label = "Rail panels",
  scope = "rail",
}: PanelTabsProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());

  const move = useCallback(
    (from: number, step: number, absolute: "first" | "last" | null) => {
      const target = absolute === null ? seekEnabled(tabs, from, step) : seekEdge(tabs, absolute);
      if (target === null) return;
      onSelect(target.id);
      buttons.current.get(target.id)?.focus();
    },
    [onSelect, tabs],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, index: number) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          move(index, 1, null);
          return;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          move(index, -1, null);
          return;
        case "Home":
          event.preventDefault();
          move(index, 0, "first");
          return;
        case "End":
          event.preventDefault();
          move(index, 0, "last");
          return;
        default:
          return;
      }
    },
    [move],
  );

  return (
    <div
      aria-label={label}
      aria-orientation="horizontal"
      className="panel-tablist"
      data-slot="panel-tablist"
      role="tablist"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === activeTabId;
        return (
          <button
            /*
             * Only the SELECTED tab names a panel. The host mounts one panel at
             * a time (twelve live projections, twelve scroll regions and a chat
             * composer per rail is not a trade worth making), so an
             * `aria-controls` on the other eleven would point at an element that
             * does not exist — a dangling IDREF that assistive tech and every
             * automated audit both treat as a defect. The attribute is optional
             * in the tabs pattern; a resolvable reference on the one real panel
             * is the correct reading of it.
             */
            aria-controls={selected ? panelDomId(tab.id, scope) : undefined}
            aria-selected={selected}
            className="panel-tab"
            data-panel-id={tab.id}
            data-slot="panel-tab"
            disabled={tab.disabled === true}
            id={panelTabDomId(tab.id, scope)}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            ref={(node) => {
              buttons.current.set(tab.id, node);
            }}
            role="tab"
            /*
             * Roving tabindex. Exactly one tab is reachable with Tab; the rest
             * are reached with the arrow keys, which is what keeps a twelve-item
             * strip from costing a keyboard player twelve presses to get past
             * (§8: all core flows keyboard-operable, focus order follows DOM).
             */
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <span>{tab.label}</span>
            <PanelAttentionBadge attention={tab.attention} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The next enabled tab in `step` direction, wrapping. Returns null when no tab
 * is enabled — a strip of entirely disabled tabs must not trap focus in a loop.
 */
function seekEnabled(
  tabs: readonly PanelTab[],
  from: number,
  step: number,
): PanelTab | null {
  const count = tabs.length;
  if (count === 0) return null;

  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + step * offset) % count) + count) % count;
    const candidate = tabs[index];
    if (candidate !== undefined && candidate.disabled !== true) return candidate;
  }
  return null;
}

/** The first or last enabled tab. */
function seekEdge(tabs: readonly PanelTab[], edge: "first" | "last"): PanelTab | null {
  const ordered = edge === "first" ? tabs : [...tabs].reverse();
  return ordered.find((tab) => tab.disabled !== true) ?? null;
}
