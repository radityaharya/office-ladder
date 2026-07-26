import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Panel } from "./panel";
import { PanelHost } from "./panel-host";
import {
  PANEL_DEFINITION_LIST,
  PANEL_IDS,
  isPanelId,
  panelDomId,
  panelTabDomId,
} from "./panel-registry";
import { PanelTabs, type PanelTab } from "./panel-tabs";

const TABS: readonly PanelTab[] = PANEL_DEFINITION_LIST.map((definition) => ({
  id: definition.id,
  label: definition.tabLabel,
}));

function noop() {
  /* the strip is controlled; the host owns selection */
}

describe("panel registry", () => {
  it("names all twelve rail destinations §8.5 asks for", () => {
    // Then
    expect(PANEL_IDS).toEqual([
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
    ]);
    expect(PANEL_DEFINITION_LIST).toHaveLength(12);
  });

  it("gives every destination a title and a one-line purpose", () => {
    // Then — the empty states open with `summary`, so a blank one would ship a
    // panel that cannot explain itself.
    for (const definition of PANEL_DEFINITION_LIST) {
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.tabLabel.length).toBeGreaterThan(0);
      expect(definition.summary).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("recognises a stored or deep-linked panel id and rejects anything else", () => {
    expect(isPanelId("ballots")).toBe(true);
    expect(isPanelId("nonsense")).toBe(false);
    expect(isPanelId(null)).toBe(false);
  });
});

describe("tab strip ARIA", () => {
  it("exposes a tablist of tabs with a single selected tab", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelTabs activeTabId="projects" onSelect={noop} tabs={TABS} />,
    );

    // Then
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Rail panels"');
    expect(markup).toContain('aria-orientation="horizontal"');
    expect(markup.match(/role="tab"/g) ?? []).toHaveLength(12);
    expect(markup.match(/aria-selected="true"/g) ?? []).toHaveLength(1);
    expect(markup.match(/aria-selected="false"/g) ?? []).toHaveLength(11);
  });

  it("gives every tab a stable DOM id and the selected one an aria-controls", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelTabs activeTabId="chat" onSelect={noop} tabs={TABS} />,
    );

    // Then — only the selected tab names a panel, because only that panel is
    // mounted; the other eleven would be dangling IDREFs.
    expect(markup).toContain(`id="${panelTabDomId("chat")}"`);
    expect(markup).toContain(`aria-controls="${panelDomId("chat")}"`);
    expect(markup.match(/aria-controls="/g) ?? []).toHaveLength(1);
  });

  it("rovingly keeps exactly one tab in the tab order", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelTabs activeTabId="heat" onSelect={noop} tabs={TABS} />,
    );

    // Then — twelve tab stops would cost a keyboard player twelve presses to
    // reach the board's action bar (§8).
    expect(markup.match(/tabindex="0"/g) ?? []).toHaveLength(1);
    expect(markup.match(/tabindex="-1"/g) ?? []).toHaveLength(11);
  });

  it("carries an attention badge on a tab without colour being the only carrier", () => {
    // Given
    const tabs: readonly PanelTab[] = [
      { id: "seats", label: "Seats" },
      {
        id: "agreements",
        label: "Deals",
        attention: { count: 3, summary: "3 offers are waiting on your answer." },
      },
    ];

    // When
    const markup = renderToStaticMarkup(
      <PanelTabs activeTabId="seats" onSelect={noop} tabs={tabs} />,
    );

    // Then
    expect(markup).toContain('data-slot="panel-attention"');
    expect(markup).toContain(">3<");
    expect(markup).toContain("3 offers are waiting on your answer.");
  });

  it("renders a disabled destination as present and inert rather than missing", () => {
    // Given — a destination that exists but cannot be entered right now. One the
    // MODE has switched off is absent from the list entirely, not disabled.
    const tabs: readonly PanelTab[] = [
      { id: "seats", label: "Seats" },
      { id: "market", label: "Market", disabled: true },
    ];

    // When
    const markup = renderToStaticMarkup(
      <PanelTabs activeTabId="seats" onSelect={noop} tabs={tabs} />,
    );

    // Then
    expect(markup).toContain('data-panel-id="market"');
    expect(markup).toContain("disabled");
  });

  it("renders a tab strip's resting state with no tabs at all", () => {
    // When — a mode with every optional destination off still has to render.
    const markup = renderToStaticMarkup(
      <PanelTabs activeTabId="seats" onSelect={noop} tabs={[]} />,
    );

    // Then
    expect(markup).toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
  });
});

describe("panel host", () => {
  it("wires the selected tab to the one mounted tab panel in both directions", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelHost activeTabId="ballots" onSelect={noop} tabs={TABS}>
        <Panel panelId="ballots" title="Ballots">
          <p>Body</p>
        </Panel>
      </PanelHost>,
    );

    // Then — the tab's aria-controls and the panel's id are the same string, and
    // the panel's aria-labelledby is the tab's id.
    expect(markup).toContain(`aria-controls="${panelDomId("ballots")}"`);
    expect(markup).toContain(`id="${panelDomId("ballots")}"`);
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain(`aria-labelledby="${panelTabDomId("ballots")}"`);
  });

  it("keeps the tab panel out of the tab order because the panel body is in it", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelHost activeTabId="activity" onSelect={noop} tabs={TABS}>
        <Panel panelId="activity" title="Activity">
          <p>Body</p>
        </Panel>
      </PanelHost>,
    );

    // Then — one tab stop for the strip, one for the panel body. The tabpanel
    // wrapper is -1: programmatically focusable, not a stop of its own.
    const tabpanel = /role="tabpanel"[^>]*/.exec(markup)?.[0] ?? "";
    expect(tabpanel).toContain('tabindex="-1"');
  });

  it("scopes its DOM ids so two hosts on one page cannot mis-wire each other", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelHost activeTabId="hand" onSelect={noop} scope="dock" tabs={TABS}>
        <Panel panelId="hand" scope="dock" title="Hand">
          <p>Body</p>
        </Panel>
      </PanelHost>,
    );

    // Then
    expect(markup).toContain(`id="${panelDomId("hand", "dock")}"`);
    expect(markup).toContain(`id="${panelTabDomId("hand", "dock")}"`);
    expect(markup).not.toContain(panelDomId("hand", "rail"));
  });

  it("marks which destination is open for the shell to read back", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelHost activeTabId="quarter" onSelect={noop} tabs={TABS}>
        <Panel panelId="quarter" title="Quarter">
          <p>Body</p>
        </Panel>
      </PanelHost>,
    );

    // Then
    expect(markup).toContain('data-slot="panel-host"');
    expect(markup).toContain('data-panel-active="quarter"');
  });
});
