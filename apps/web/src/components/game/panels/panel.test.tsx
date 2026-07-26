import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Panel } from "./panel";
import {
  formatPanelMoney,
  formatPanelSigned,
  panelClock,
  panelDeltaSign,
  panelMeterPercent,
  panelMeterState,
  pluralise,
} from "./panel-format";
import {
  PanelDef,
  PanelDefs,
  PanelEmpty,
  PanelFacts,
  PanelList,
  PanelMeter,
  PanelNote,
  PanelRow,
  PanelSeatGlyph,
  PanelStamp,
  panelSeatClass,
} from "./panel-parts";

const PANELS_CSS = readFileSync(
  fileURLToPath(new URL("../../../styles/panels.css", import.meta.url)),
  "utf8",
);

/**
 * The same sheet with its comments removed. The comments in panels.css talk
 * ABOUT `@media` and about motion budgets, so a naive scan of the raw file finds
 * prose rather than declarations.
 */
const PANELS_CSS_RULES = PANELS_CSS.replaceAll(/\/\*[\s\S]*?\*\//g, "");

describe("panel primitive", () => {
  it("renders a header, a scrollable body and no footer by default", () => {
    // When
    const markup = renderToStaticMarkup(
      <Panel panelId="projects" title="Projects">
        <p>Body</p>
      </Panel>,
    );

    // Then
    expect(markup).toContain('data-slot="panel"');
    expect(markup).toContain('data-panel-id="projects"');
    expect(markup).toContain('data-panel-sizing="fill"');
    expect(markup).toContain('data-slot="panel-head"');
    expect(markup).toContain('data-slot="panel-body"');
    expect(markup).toContain('data-panel-scroll="true"');
    expect(markup).not.toContain('data-slot="panel-foot"');
  });

  it("labels itself by its own heading so the region has an accessible name", () => {
    // When
    const markup = renderToStaticMarkup(
      <Panel panelId="ballots" title="Ballots">
        <p>Body</p>
      </Panel>,
    );

    // Then — the section's aria-labelledby and the h2's id must be the same
    // string, or the panel announces as an unnamed region.
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(markup)?.[1];
    expect(labelledBy).toBe("panel-heading-rail-ballots");
    expect(markup).toContain(`id="${labelledBy ?? ""}"`);
    expect(markup).toContain(">Ballots</h2>");
  });

  it("keeps DOM ids distinct when two hosts mount the same panel", () => {
    // When
    const rail = renderToStaticMarkup(
      <Panel panelId="chat" title="Chat">
        <p>Body</p>
      </Panel>,
    );
    const dock = renderToStaticMarkup(
      <Panel panelId="chat" scope="dock" title="Chat">
        <p>Body</p>
      </Panel>,
    );

    // Then
    expect(rail).toContain('id="panel-heading-rail-chat"');
    expect(dock).toContain('id="panel-heading-dock-chat"');
  });

  it("renders a footer and a header action when it is given them", () => {
    // When
    const markup = renderToStaticMarkup(
      <Panel
        action={<button type="button">Filter</button>}
        footer={<p>Footer</p>}
        meta="3/6"
        panelId="seats"
        title="Seats"
      >
        <p>Body</p>
      </Panel>,
    );

    // Then
    expect(markup).toContain('data-slot="panel-head-action"');
    expect(markup).toContain("Filter");
    expect(markup).toContain('data-slot="panel-head-meta"');
    expect(markup).toContain("3/6");
    expect(markup).toContain('data-slot="panel-foot"');
    expect(markup).toContain("Footer");
  });

  it("sizes to content and drops the tab stop when the body cannot scroll", () => {
    // When
    const markup = renderToStaticMarkup(
      <Panel panelId="heat" scrollBody={false} sizing="content" title="Heat">
        <p>One readout</p>
      </Panel>,
    );

    // Then
    expect(markup).toContain('data-panel-sizing="content"');
    expect(markup).toContain('data-panel-scroll="false"');
    // A single readout that cannot overflow must not cost a keyboard player a
    // tab stop on the way past it.
    expect(markup).not.toContain('tabindex="0"');
  });

  it("draws no chrome at all when the host already draws a panel header", () => {
    // When — the seam that makes this kit mountable into `turn-rail.tsx`'s own
    // `RailPanel` rather than being a competing shell.
    const markup = renderToStaticMarkup(
      <Panel chrome="none" footer={<p>Footer</p>} panelId="chat" title="Chat">
        <p>Body</p>
      </Panel>,
    );

    // Then — content and footer survive; the header, the title and the wrappers
    // do not, so the host's own heading is the only heading in the region.
    expect(markup).toBe("<p>Body</p><p>Footer</p>");
    expect(markup).not.toContain("Chat");
  });

  it("makes a scrollable body a tab stop so its overflow is not pointer-only", () => {
    // When
    const markup = renderToStaticMarkup(
      <Panel panelId="activity" title="Activity">
        <p>Body</p>
      </Panel>,
    );

    // Then
    expect(markup).toContain('tabindex="0"');
  });

  /*
   * The anti-collapse contract. A markup test cannot measure a box, so this
   * asserts the DECLARATIONS that carry the floor are present in the stylesheet
   * the components ship with: the rail's seat roster once lost every pixel of
   * height while its header still read "SEATS 3/6", and deleting either floor
   * below re-opens exactly that failure for all twelve panels at once.
   */
  it("declares a height floor on the panel and on its body", () => {
    // Then
    expect(PANELS_CSS_RULES).toMatch(/--panel-min-height:\s*84px/);
    expect(PANELS_CSS_RULES).toMatch(/--panel-body-floor:\s*56px/);
    expect(PANELS_CSS_RULES).toMatch(
      /\.panel\s*\{[^}]*min-height:\s*var\(--panel-min-height\)/,
    );
    expect(PANELS_CSS_RULES).toMatch(
      /\.panel-body\s*\{[^}]*min-height:\s*var\(--panel-body-floor\)/,
    );
  });

  it("never lets the content variant shrink out of the layout", () => {
    // Then — `flex: 0 0 auto` is what stops a sibling on `flex: 1 1 auto` from
    // taking a content-sized panel's height away from it.
    expect(PANELS_CSS_RULES).toMatch(
      /\.panel\[data-panel-sizing="content"\]\s*\{[^}]*flex:\s*0\s+0\s+auto/,
    );
  });

  it("answers the rail's width with container queries, never the viewport's", () => {
    // Then — the rail is a narrow column inside a wide viewport, so a viewport
    // media query is the wrong signal and answering it has already produced one
    // bug here. The only @media in this sheet is the reduced-motion collapse.
    const mediaQueries = PANELS_CSS_RULES.match(/@media[^{]+/g) ?? [];
    expect(mediaQueries).toHaveLength(1);
    expect(mediaQueries[0]).toContain("prefers-reduced-motion");
    expect(PANELS_CSS_RULES).toContain("container-type: inline-size");
    expect(PANELS_CSS_RULES).toContain("@container panel-host");
  });

  it("keeps chrome motion inside DESIGN.md §7.1's budget with no springs", () => {
    // Then — every transition duration in the sheet is one of 80/120/160ms, no
    // keyframe animation exists, and the only easing curves are easing-standard
    // and the linear one §7 reserves for literal progress meters.
    const durations = PANELS_CSS_RULES.match(/\b\d+ms\b/g) ?? [];
    expect(durations.length).toBeGreaterThan(0);
    expect([...new Set(durations)].sort()).toEqual(["120ms", "160ms", "80ms"]);
    expect(PANELS_CSS_RULES).not.toMatch(/animation:/);
    expect(PANELS_CSS_RULES).not.toMatch(/@keyframes/);
    const curves = PANELS_CSS_RULES.match(/cubic-bezier\([^)]*\)/g) ?? [];
    expect([...new Set(curves)]).toEqual(["cubic-bezier(0.2, 0, 0, 1)"]);
  });
});

describe("attention badge", () => {
  it("prints the count and a sentence for assistive tech", () => {
    // When
    const markup = renderToStaticMarkup(
      <Panel
        attention={{ count: 2, summary: "2 offers are waiting on your answer." }}
        panelId="agreements"
        title="Agreements"
      >
        <p>Body</p>
      </Panel>,
    );

    // Then
    expect(markup).toContain('data-slot="panel-attention"');
    expect(markup).toContain(">2<");
    expect(markup).toContain("2 offers are waiting on your answer.");
  });

  it("renders nothing at all for a zero or absent count", () => {
    // When
    const zero = renderToStaticMarkup(
      <Panel attention={{ count: 0, summary: "Nothing." }} panelId="hand" title="Hand">
        <p>Body</p>
      </Panel>,
    );
    const absent = renderToStaticMarkup(
      <Panel panelId="hand" title="Hand">
        <p>Body</p>
      </Panel>,
    );

    // Then — an affordance that is always present stops meaning anything.
    expect(zero).not.toContain('data-slot="panel-attention"');
    expect(absent).not.toContain('data-slot="panel-attention"');
  });
});

describe("panel parts", () => {
  it("renders an empty state as real copy, not as filler", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelEmpty
        detail="Anyone may fund it, and anyone may sabotage it."
        headline="No projects on the floor"
        summary="Public commitments with a stake."
      />,
    );

    // Then
    expect(markup).toContain('data-slot="panel-empty"');
    expect(markup).toContain("No projects on the floor");
    expect(markup).toContain("Public commitments with a stake.");
    expect(markup).toContain("Anyone may fund it, and anyone may sabotage it.");
  });

  it("renders a row with identity, facts, a trailing value and actions", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelList label="Seats">
        <PanelRow
          actions={<button type="button">Contribute</button>}
          facts={["Analyst", "Tile 07", "$1,200"]}
          key="row"
          origin="local"
          seat={3}
          stamps={<PanelStamp tone="accent">Active</PanelStamp>}
          state="active"
          title="Avery"
          trailing={<span>Online</span>}
        />
      </PanelList>,
    );

    // Then
    expect(markup).toContain('data-slot="panel-list"');
    expect(markup).toContain('data-slot="panel-row"');
    expect(markup).toContain('data-panel-origin="local"');
    expect(markup).toContain('data-panel-state="active"');
    expect(markup).toContain("panel-seat-3");
    expect(markup).toContain("Seat 3.");
    expect(markup).toContain("Analyst");
    expect(markup).toContain("Tile 07");
    expect(markup).toContain("Contribute");
  });

  it("keeps each fact unbreakable while letting the line wrap between them", () => {
    // When
    const markup = renderToStaticMarkup(<PanelFacts facts={["Analyst", "Tile 07"]} />);

    // Then — "Tile / 07" across a wrap reads as two facts instead of one.
    expect(markup).toContain('class="panel-fact"');
    expect(markup).toContain(" · ");
  });

  it("echoes a meter's value as text beside the bar", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelMeter label="Cash" max={2000} value={500} valueText="$500 / $2,000" />,
    );

    // Then — the bar illustrates, the number confirms (§6.4); the bar itself is
    // aria-hidden so the value is not announced twice.
    expect(markup).toContain('data-slot="panel-meter-value"');
    expect(markup).toContain("$500 / $2,000");
    expect(markup).toContain("width:25%");
    expect(markup).toContain('data-state="below"');
  });

  it("renders a definition readout and a note line", () => {
    // When
    const markup = renderToStaticMarkup(
      <>
        <PanelDefs label="Your heat">
          <PanelDef hint="Below threshold" label="Heat" value="4" />
        </PanelDefs>
        <PanelNote tone="caution">Crossing the threshold opens an investigation.</PanelNote>
      </>,
    );

    // Then
    expect(markup).toContain('data-slot="panel-def"');
    expect(markup).toContain("Below threshold");
    expect(markup).toContain('data-slot="panel-note"');
    expect(markup).toContain("Crossing the threshold opens an investigation.");
  });

  it("pairs a seat colour with the seat number and a spoken label", () => {
    // When
    const markup = renderToStaticMarkup(<PanelSeatGlyph seat={5} />);

    // Then — identity is never colour alone (§8).
    expect(markup).toContain("panel-seat-5");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Seat 5.");
  });

  it("refuses a seat colour for an out-of-range or absent seat", () => {
    // Then — a row painted in seat 1's colour for a player who is not in seat 1
    // would be a lie about identity, so no class is better than a wrong one.
    expect(panelSeatClass(1)).toBe("panel-seat-1");
    expect(panelSeatClass(7)).toBeNull();
    expect(panelSeatClass(0)).toBeNull();
    expect(panelSeatClass(null)).toBeNull();
    expect(panelSeatClass(undefined)).toBeNull();
  });
});

describe("panel formatting", () => {
  it("keeps the sign as a character so gain and loss are never colour alone", () => {
    expect(formatPanelSigned(120)).toBe("+120");
    expect(formatPanelSigned(-40)).toBe("-40");
    expect(formatPanelSigned(0)).toBe("+0");
    expect(panelDeltaSign(3)).toBe("gain");
    expect(panelDeltaSign(-3)).toBe("loss");
    expect(panelDeltaSign(0)).toBe("flat");
  });

  it("formats cash with the minus leading the unit", () => {
    expect(formatPanelMoney(1200)).toBe("$1,200");
    expect(formatPanelMoney(-300)).toBe("-$300");
  });

  it("clamps a meter and survives a zero or negative maximum", () => {
    expect(panelMeterPercent(500, 2000)).toBe(25);
    expect(panelMeterPercent(4000, 2000)).toBe(100);
    expect(panelMeterPercent(-5, 2000)).toBe(0);
    expect(panelMeterPercent(5, 0)).toBe(0);
    expect(panelMeterState(4, 4)).toBe("met");
    expect(panelMeterState(4, 4, true)).toBe("over");
    expect(panelMeterState(1, 4)).toBe("below");
  });

  it("reads a clock out of the ISO string rather than through Date", () => {
    // Then — this renders on a server and in a test too, so it must not depend
    // on the host's timezone.
    expect(panelClock("2026-07-26T09:41:07.000Z")).toBe("09:41");
    expect(panelClock("not-a-timestamp")).toBe("--:--");
  });

  it("pluralises with the count in front", () => {
    expect(pluralise(1, "round")).toBe("1 round");
    expect(pluralise(3, "round")).toBe("3 rounds");
    expect(pluralise(2, "party", "parties")).toBe("2 parties");
  });
});
