/**
 * The rail's twelve destinations, named once.
 *
 * `plans/24-gameplay-v2-spec.md` §8.5 states the problem: the rail already had
 * three stacked blocks and v2 needs nine more surfaces, which "does not fit the
 * existing shell — the layout needs a tabbed or dockable rail, not nine more
 * stacked blocks". This module is the single list of what those surfaces are, so
 * the tab strip, the panel host, the shell and any later wave all agree on the
 * ids, the labels and the DOM ids that wire `aria-controls` to `aria-labelledby`.
 *
 * Nothing here imports `@office-ladder/contracts`. Every panel's props are
 * declared as a local view model in its own module for the same reason: a panel
 * must be handed exactly what a viewer may see (spec §7.2), which is a narrower
 * shape than any transport DTO, and narrowing at the presentation boundary is
 * what makes an accidental leak a type error rather than a screenshot.
 */

/** Every rail destination. Order is the tab strip's order. */
export const PANEL_IDS = [
  "seats",
  "activity",
  "events",
  "hand",
  "projects",
  "market",
  "agreements",
  "ballots",
  "objectives",
  "heat",
  "chat",
  "quarter",
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

/**
 * What a panel is called and what it is for.
 *
 * `tabLabel` is short because twelve of them share one strip; `title` is the
 * panel header's own heading. Both are written in sentence case in source and
 * uppercased in CSS — DESIGN.md §2.2 forbids shouting in the source string.
 *
 * `summary` is the one-line answer to "what is this panel for". Empty states
 * open with it, so it is authored here rather than restated per panel.
 */
export type PanelDefinition = {
  readonly id: PanelId;
  readonly tabLabel: string;
  readonly title: string;
  readonly summary: string;
};

export const PANEL_DEFINITIONS: Readonly<Record<PanelId, PanelDefinition>> = {
  seats: {
    id: "seats",
    tabLabel: "Seats",
    title: "Seats",
    summary: "Who is at the table, what they hold, and whose move it is.",
  },
  activity: {
    id: "activity",
    tabLabel: "Log",
    title: "Activity",
    summary: "Every command the server has accepted, newest first.",
  },
  events: {
    id: "events",
    tabLabel: "Events",
    title: "Events",
    summary: "Cards issued and office-wide events, as records of what already happened.",
  },
  hand: {
    id: "hand",
    tabLabel: "Hand",
    title: "Hand",
    summary: "The cards you are holding, and how many cards everyone else holds.",
  },
  projects: {
    id: "projects",
    tabLabel: "Projects",
    title: "Projects",
    summary: "Public commitments with a stake: what they need, who is funding them, when they are due.",
  },
  market: {
    id: "market",
    tabLabel: "Market",
    title: "Market",
    summary: "Lots for sale or under auction, and the round each one closes on.",
  },
  agreements: {
    id: "agreements",
    tabLabel: "Deals",
    title: "Agreements",
    summary: "Offers, trades and recorded promises, and what each side owes.",
  },
  ballots: {
    id: "ballots",
    tabLabel: "Ballots",
    title: "Ballots",
    summary: "Votes and auction bids the table is collecting.",
  },
  objectives: {
    id: "objectives",
    tabLabel: "Goals",
    title: "Objectives",
    summary: "Scoring targets outside the promotion ladder.",
  },
  heat: {
    id: "heat",
    tabLabel: "Heat",
    title: "Heat",
    summary: "What your aggression has cost you in HR suspicion.",
  },
  chat: {
    id: "chat",
    tabLabel: "Chat",
    title: "Chat",
    summary: "Table talk. Nothing said here is enforced by the office.",
  },
  quarter: {
    id: "quarter",
    tabLabel: "Quarter",
    title: "Quarter",
    summary: "The fiscal calendar and the office-wide events scheduled on it.",
  },
};

/** Definitions in tab-strip order. */
export const PANEL_DEFINITION_LIST: readonly PanelDefinition[] = PANEL_IDS.map(
  (id) => PANEL_DEFINITIONS[id],
);

/**
 * DOM id of a tab button. Paired with {@link panelDomId} to satisfy the ARIA
 * tabs contract in both directions: the tab's `aria-controls` names the panel
 * and the panel's `aria-labelledby` names the tab.
 *
 * `scope` exists because a page may hold more than one panel host (a rail and,
 * later, a docked panel), and duplicate DOM ids would silently mis-wire both.
 */
export function panelTabDomId(panelId: string, scope = "rail"): string {
  return `panel-tab-${scope}-${panelId}`;
}

export function panelDomId(panelId: string, scope = "rail"): string {
  return `panel-body-${scope}-${panelId}`;
}

/** DOM id for a panel's own heading, used as the panel section's accessible name. */
export function panelHeadingDomId(panelId: string, scope = "rail"): string {
  return `panel-heading-${scope}-${panelId}`;
}

/** Type guard, for reading a persisted or URL-supplied tab selection. */
export function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && (PANEL_IDS as readonly string[]).includes(value);
}
