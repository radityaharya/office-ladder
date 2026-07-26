import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { panelHeadingDomId } from "./panel-registry";

/**
 * How many things in this panel need the player, and a sentence saying what.
 *
 * The count is what the badge prints; `summary` is what assistive tech reads,
 * because a bare "3" beside a heading is noise. A count of `0` renders no badge
 * at all — an attention affordance that is always present stops meaning
 * anything.
 */
export type PanelAttention = {
  readonly count: number;
  /** Sentence case, e.g. "2 offers are waiting on you." */
  readonly summary: string;
};

/**
 * Whether the panel takes the height it is given or the height it needs.
 *
 * `fill` is for lists (activity, chat, projects): the body scrolls inside itself
 * and the panel absorbs whatever the rail hands it. `content` is for single
 * readouts (heat, quarter): the panel is exactly as tall as its content and
 * refuses to shrink, because in a flex column anything shrinkable loses every
 * fight for space against a sibling that fills — that is precisely how the seat
 * roster was squeezed to zero height once already.
 */
export type PanelSizing = "fill" | "content";

/**
 * Whether this component draws its own panel chrome.
 *
 * `"panel"` (the default) is the full primitive: header, scrollable body,
 * optional footer. `"none"` renders the body content and then the footer content
 * with **no wrapper at all**, for a host that already draws a panel header
 * around whatever it is given — `turn-rail.tsx`'s own `RailPanel` does exactly
 * that, and nesting one panel's header inside another's is a visible defect
 * rather than a stylistic one.
 *
 * This is the seam that makes the kit mountable into a shell instead of being a
 * replacement for one: the same destination component serves both hosts, so the
 * content, the copy and the hidden-information guarantees are written once.
 */
export type PanelChrome = "panel" | "none";

type PanelProps = {
  /** Registry id (or any stable string). Drives the heading's DOM id + data attrs. */
  readonly panelId: string;
  readonly title: string;
  /** Optional attention badge in the header. Omit or pass a 0 count for none. */
  readonly attention?: PanelAttention | null;
  /**
   * A short mono readout beside the heading — a count, a revision, a round.
   * Separate from {@link PanelProps.action} on purpose: a count is not a control,
   * and the rail's existing headers already carry one ("SEATS 3/6").
   */
  readonly meta?: ReactNode;
  /** Header action slot. One control — a header with two actions is two panels. */
  readonly action?: ReactNode;
  /** Optional footer: a composer, a total, a cap note. Never a second heading. */
  readonly footer?: ReactNode;
  readonly sizing?: PanelSizing;
  /** See {@link PanelChrome}. Defaults to drawing this component's own chrome. */
  readonly chrome?: PanelChrome;
  /**
   * Whether the body is its own scroll container. True (the default) makes it a
   * tab stop so its overflow is reachable without a pointer (DESIGN.md §8).
   * Pass false for a body that cannot overflow — a spurious tab stop on a single
   * readout is a worse outcome than no scrollbar.
   */
  readonly scrollBody?: boolean;
  /** Disambiguates DOM ids when a page mounts more than one panel host. */
  readonly scope?: string;
  readonly className?: string;
  readonly children: ReactNode;
};

/**
 * The panel primitive: header, scrollable body, optional footer.
 *
 * Every rail destination is one of these, so the twelve surfaces §8.5 asks for
 * are twelve sets of content rather than twelve layouts. Flat by construction —
 * regions are separated by a hairline and one tonal step (DESIGN.md §4.1), never
 * by shadow or radius, and the panel runs edge-to-edge inside its parent (§4.3)
 * rather than floating as a card.
 *
 * **It cannot collapse to zero.** `.panel` carries an 84px floor and
 * `.panel-body` a 56px floor (see styles/panels.css); `min-height` is applied
 * after `max-height` and beats `flex-shrink`, so a header can never end up
 * describing content that has no pixels. This is not a precaution — the rail's
 * seat roster lost every pixel of height while its header still read "SEATS 3/6"
 * (hud.css records it), and this primitive exists partly so that cannot recur
 * once per surface.
 *
 * Renders its full resting state on the first synchronous pass: no effect, no
 * measurement, no browser API, so `renderToStaticMarkup` sees exactly what a
 * player sees before hydration.
 */
export function Panel({
  panelId,
  title,
  attention = null,
  meta,
  action,
  footer,
  sizing = "fill",
  chrome = "panel",
  scrollBody = true,
  scope = "rail",
  className,
  children,
}: PanelProps) {
  const headingId = panelHeadingDomId(panelId, scope);

  /*
   * Chromeless: the host's own panel header is already above this content, so
   * drawing a second one would duplicate the title and put two headings in one
   * region (§2.2 allows exactly one). The footer content follows the body,
   * because a host with no footer slot still has to show it.
   */
  if (chrome === "none") {
    return (
      <>
        {children}
        {footer}
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn("panel", className)}
      data-panel-id={panelId}
      data-panel-sizing={sizing}
      data-slot="panel"
    >
      <header className="panel-head" data-slot="panel-head">
        {/* Exactly one heading per panel (§2.2). Uppercased in CSS so assistive
            tech reads a word rather than shouted letters. */}
        <h2 className="panel-heading" id={headingId}>
          {title}
        </h2>
        <PanelAttentionBadge attention={attention} />
        {meta === undefined || meta === null ? null : (
          <span className="panel-sub" data-slot="panel-head-meta">
            {meta}
          </span>
        )}
        <span aria-hidden="true" className="panel-head-spacer" />
        {action === undefined || action === null ? null : (
          <div className="panel-head-action" data-slot="panel-head-action">
            {action}
          </div>
        )}
      </header>
      <div
        className="panel-body"
        data-panel-scroll={scrollBody ? "true" : "false"}
        data-slot="panel-body"
        /* A scroll container with no tab stop hides its own overflow from
           keyboard users (§8). Carries no ARIA role: its content already sits
           inside this section's labelled region, and adding a nested group here
           would make every panel announce its name twice. */
        tabIndex={scrollBody ? 0 : undefined}
      >
        {children}
      </div>
      {footer === undefined || footer === null ? null : (
        <footer className="panel-foot" data-slot="panel-foot">
          {footer}
        </footer>
      )}
    </section>
  );
}

/**
 * The attention affordance: a caution LED, a mono count, and a sentence for
 * assistive tech.
 *
 * Deliberately `status-caution` rather than `accent`. §1.5 spends `accent` on
 * exactly one thing per view and the active tab rule already has it; §1.6 makes
 * caution the signal colour for "this needs you" and forbids it as a button
 * fill, which is exactly what a badge is not. Colour is never the only carrier
 * (§8): the count is text and the summary is read aloud.
 *
 * Exported so the tab strip can print the same badge on a tab.
 */
export function PanelAttentionBadge({
  attention,
}: {
  readonly attention: PanelAttention | null | undefined;
}) {
  if (attention === null || attention === undefined) return null;
  if (attention.count <= 0) return null;

  return (
    <span className="panel-badge" data-slot="panel-attention">
      <span aria-hidden="true" className="panel-led" data-tone="caution" />
      <span aria-hidden="true">{attention.count}</span>
      <span className="sr-only">{attention.summary}</span>
    </span>
  );
}
