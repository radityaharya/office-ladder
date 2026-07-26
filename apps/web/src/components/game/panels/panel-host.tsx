import type { ReactNode } from "react";

import { panelDomId, panelTabDomId } from "./panel-registry";
import { PanelTabs, type PanelTab } from "./panel-tabs";

type PanelHostProps = {
  readonly tabs: readonly PanelTab[];
  /** Which destination is open. The host is controlled — it owns no state. */
  readonly activeTabId: string;
  readonly onSelect: (tabId: string) => void;
  /** Accessible name for the tab strip. */
  readonly label?: string;
  /** Disambiguates DOM ids when a page mounts more than one host. */
  readonly scope?: string;
  /** The active panel. Exactly one — see the note on `aria-controls` in panel-tabs.tsx. */
  readonly children: ReactNode;
};

/**
 * The mountable seam: a tab strip over one live panel.
 *
 * This is what the shell puts in the rail column. It is deliberately
 * **controlled and stateless** — `activeTabId` and `onSelect` come from the
 * shell, so the shell can persist the selection, deep-link it, or switch the
 * rail to a destination in response to a game event (an offer arriving should be
 * able to raise the Deals tab's badge without this component knowing what an
 * offer is).
 *
 * It renders no data itself. `children` is the active `Panel`, which the shell or
 * a later wave supplies. That keeps the seam one prop wide instead of twelve.
 *
 * Sizing: `.panel-host` is a two-row grid — strip (auto) over panel
 * (`minmax(0, 1fr)`) — with a floor of strip + a whole panel, so it can be
 * dropped into a flex column or a grid cell and will neither collapse nor
 * overflow its parent. Height comes from the parent; the panel body scrolls
 * inside itself.
 */
export function PanelHost({
  tabs,
  activeTabId,
  onSelect,
  label,
  scope = "rail",
  children,
}: PanelHostProps) {
  return (
    <div className="panel-host" data-panel-active={activeTabId} data-slot="panel-host">
      <PanelTabs
        activeTabId={activeTabId}
        label={label}
        onSelect={onSelect}
        scope={scope}
        tabs={tabs}
      />
      <div
        aria-labelledby={panelTabDomId(activeTabId, scope)}
        className="panel-host-body"
        data-slot="panel-host-body"
        id={panelDomId(activeTabId, scope)}
        role="tabpanel"
        /*
         * NOT a tab stop. The panel's own body is the scroll container and is
         * already focusable, so a tabindex of 0 here would cost a keyboard player
         * two presses to reach the same content. -1 keeps it programmatically
         * focusable, which is what a later wave needs if it wants to move focus
         * into the panel after a tab is chosen.
         */
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
