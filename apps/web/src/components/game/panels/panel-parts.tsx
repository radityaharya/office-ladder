import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { panelMeterPercent, panelMeterState } from "./panel-format";

/**
 * The row/readout grammar every panel is assembled from.
 *
 * Twelve destinations, one vocabulary: a hairline-separated row list, a
 * definition readout, a meter, a stamp, a seat glyph, a note line and an empty
 * state. §8.5's failure mode is twelve surfaces each inventing its own layout —
 * these parts are how that is prevented, and why a later wave filling a panel
 * with real data does not get to choose a new visual.
 *
 * Everything here is a pure function of its props with no effects and no browser
 * API, so a panel's resting state is what the first synchronous render produces.
 */

/**
 * Who a row belongs to — the same three words `event-feedback-policy.ts` uses
 * for `EventActorKind` and the activity log uses for its origin, so the panels,
 * the log and the notice layer can be matched without a translation table.
 *
 * "notif kebanyakan (dipisah yang sendiri atau lawan)" is answered structurally:
 * `local` rows are visually separated from `remote` ones by a tonal step, a seat
 * rule and a text stamp — three carriers, never colour alone (§8).
 */
export type PanelOrigin = "local" | "remote" | "system" | "unknown";

/** `active` draws the 2px accent top rule; `muted` recedes an inert row. */
export type PanelRowState = "default" | "active" | "muted";

export type PanelTone = "neutral" | "accent" | "caution" | "critical";

/* -------------------------------------------------------------------------- */
/* Empty states                                                               */
/* -------------------------------------------------------------------------- */

type PanelEmptyProps = {
  /** Command-voice line, e.g. "No projects on the floor". */
  readonly headline: string;
  /** What this panel is for. One sentence. */
  readonly summary: string;
  /** What will appear here, and any rule a player needs to know up front. */
  readonly detail?: string;
};

/**
 * The empty state.
 *
 * Not "no data" filler. This is the first thing a new player reads in a panel
 * they have never opened, so it is real copy: what the panel is for, and what
 * will appear in it. A panel whose empty state says "Nothing here" has spent a
 * teaching opportunity on a shrug — and "i genuinely cant follow the game" is
 * the complaint this kit exists to answer.
 */
export function PanelEmpty({ headline, summary, detail }: PanelEmptyProps) {
  return (
    <div className="panel-empty" data-slot="panel-empty">
      <p className="panel-empty-headline">
        <span aria-hidden="true" className="panel-led" data-tone="idle" />
        {headline}
      </p>
      <p className="panel-empty-copy">{summary}</p>
      {detail === undefined ? null : <p className="panel-empty-copy">{detail}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Row lists                                                                  */
/* -------------------------------------------------------------------------- */

export function PanelList({
  children,
  label,
  className,
}: {
  readonly children: ReactNode;
  /** Accessible name for the list, e.g. "Open projects". */
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <ul aria-label={label} className={cn("panel-list", className)} data-slot="panel-list">
      {children}
    </ul>
  );
}

type PanelRowProps = {
  /** Display seat 1..6 of whoever the row is about. Drives the identity rule. */
  readonly seat?: number | null;
  readonly origin?: PanelOrigin;
  readonly state?: PanelRowState;
  /** The row's own sentence or name — one line, wraps rather than truncating. */
  readonly title: ReactNode;
  /** Stamps rendered inline after the title (status, kind, "awaiting you"). */
  readonly stamps?: ReactNode;
  /** Mono facts joined by breakable separators, e.g. rank / tile / cash. */
  readonly facts?: readonly string[];
  /** Sentence-case prose under the title. */
  readonly note?: ReactNode;
  /** Extra body content under the title — a meter, a nested list. */
  readonly children?: ReactNode;
  /** Right-hand column: a value, a delta, a deadline. */
  readonly trailing?: ReactNode;
  /** Controls, on their own line: 320px of rail has no room beside a value. */
  readonly actions?: ReactNode;
  readonly slot?: string;
};

/**
 * One row. Two columns — [ identity + prose + facts ] [ trailing value ] — with
 * a third full-width line for controls when a row has any.
 *
 * The trailing column is `auto`, so a row with no value reserves no lane. That
 * matters more than it looks: "the popup event notification is causing the board
 * to jump up and down" is the same bug class as a lane that appears and
 * disappears, and the fix is the same everywhere in this kit — either reserve
 * the space permanently or take the element out of flow. Rules and badges here
 * are drawn as inset pseudo-elements for exactly that reason.
 */
export function PanelRow({
  seat = null,
  origin,
  state = "default",
  title,
  stamps,
  facts,
  note,
  children,
  trailing,
  actions,
  slot = "panel-row",
}: PanelRowProps) {
  return (
    <li
      className={cn("panel-row", panelSeatClass(seat))}
      data-panel-origin={origin ?? "unknown"}
      data-panel-state={state}
      data-slot={slot}
    >
      <div className="panel-row-main">
        <div className="panel-row-head">
          {seat === null ? null : <PanelSeatGlyph seat={seat} />}
          <span className="panel-row-title">{title}</span>
          {stamps}
        </div>
        {facts === undefined || facts.length === 0 ? null : <PanelFacts facts={facts} />}
        {note === undefined ? null : <span className="panel-row-note">{note}</span>}
        {children}
      </div>
      {trailing === undefined ? null : <div className="panel-row-trailing">{trailing}</div>}
      {actions === undefined ? null : <div className="panel-row-actions">{actions}</div>}
    </li>
  );
}

/**
 * A run of mono facts joined by breakable separators. Each fact is `nowrap`, so
 * the line may wrap between facts but never inside one — "Tile / 13" reads as
 * two facts instead of one, which is the bug the rail's seat row already fixed.
 */
export function PanelFacts({ facts }: { readonly facts: readonly string[] }) {
  return (
    <span className="panel-row-meta" data-slot="panel-facts">
      {facts.map((fact, index) => (
        <span key={fact}>
          {index === 0 ? null : " · "}
          <span className="panel-fact">{fact}</span>
        </span>
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Identity, stamps, lights                                                   */
/* -------------------------------------------------------------------------- */

/** `panel-seat-3` for seat 3, or null for an unseated actor (the office). */
export function panelSeatClass(seat: number | null | undefined): string | null {
  if (seat === null || seat === undefined) return null;
  if (!Number.isInteger(seat) || seat < 1 || seat > 6) return null;
  return `panel-seat-${seat}`;
}

/**
 * Identity is seat colour + the seat NUMBER, never colour alone (§8). The glyph
 * itself is `aria-hidden` — a bare "3" announces as noise — so the number
 * reaches assistive tech through the adjacent `sr-only` sentence instead.
 */
export function PanelSeatGlyph({ seat }: { readonly seat: number }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn("panel-seat", panelSeatClass(seat))}
        data-slot="panel-seat"
      >
        {seat}
      </span>
      <span className="sr-only">Seat {seat}.</span>
    </>
  );
}

/** Flat bordered tag, 0 radius — a stencilled stamp, not a pill. */
export function PanelStamp({
  children,
  tone = "neutral",
  slot = "panel-stamp",
}: {
  readonly children: ReactNode;
  readonly tone?: PanelTone;
  readonly slot?: string;
}) {
  return (
    <span className="panel-stamp" data-slot={slot} data-tone={tone}>
      {children}
    </span>
  );
}

/**
 * 6px square indicator (§6.4) with its mandatory text label. There is no way to
 * render this without a label, which is the point: status is never colour alone.
 */
export function PanelLed({
  tone,
  children,
}: {
  readonly tone: "idle" | "active" | "caution" | "critical" | "info";
  readonly children: ReactNode;
}) {
  return (
    <span className="panel-label" data-slot="panel-led">
      <span aria-hidden="true" className="panel-led" data-tone={tone} /> {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Meters and definition readouts                                             */
/* -------------------------------------------------------------------------- */

type PanelMeterProps = {
  readonly value: number;
  readonly max: number;
  /** The same quantity as text — the bar illustrates, the number confirms. */
  readonly valueText: string;
  /** True when exceeding `max` is BAD (heat past threshold) rather than done. */
  readonly ceiling?: boolean;
  readonly label?: string;
};

/**
 * A sunken track with a flat fill, no gradient and no glow (§6.4). The bar is
 * `aria-hidden` because `valueText` beside it carries the same fact in mono —
 * duplicating it into an ARIA progressbar would announce the value twice.
 */
export function PanelMeter({ value, max, valueText, ceiling = false, label }: PanelMeterProps) {
  const percent = panelMeterPercent(value, max);
  const state = panelMeterState(value, max, ceiling);

  return (
    <span className="panel-meter-row" data-slot="panel-meter-row">
      {label === undefined ? null : <span className="panel-label">{label}</span>}
      <span aria-hidden="true" className="panel-meter" data-state={state}>
        <span className="panel-meter-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="panel-sub" data-slot="panel-meter-value">
        {valueText}
      </span>
    </span>
  );
}

export function PanelDefs({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label?: string;
}) {
  return (
    <dl aria-label={label} className="panel-defs" data-slot="panel-defs">
      {children}
    </dl>
  );
}

export function PanelDef({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
}) {
  return (
    <div className="panel-def" data-slot="panel-def">
      <dt className="panel-label">{label}</dt>
      <dd className="panel-value">{value}</dd>
      {hint === undefined ? null : <dd className="panel-sub">{hint}</dd>}
    </div>
  );
}

/**
 * A line in which the panel states a rule about itself — a redaction, a cap, a
 * mode gate. Recessed onto `surface-sunken` so it reads as chrome rather than as
 * data, and always present rather than conditional: a note that appears and
 * vanishes is one more thing that reflows the column.
 */
export function PanelNote({
  children,
  tone = "idle",
  slot = "panel-note",
}: {
  readonly children: ReactNode;
  readonly tone?: "idle" | "active" | "caution" | "critical" | "info";
  readonly slot?: string;
}) {
  return (
    <p className="panel-note" data-slot={slot}>
      <span aria-hidden="true" className="panel-led" data-tone={tone} />
      <span>{children}</span>
    </p>
  );
}
