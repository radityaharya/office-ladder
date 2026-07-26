/**
 * Formatting the panel kit shares, kept as pure functions so they are testable
 * without a render and identical across all twelve destinations.
 *
 * Every numeric string produced here is meant for the `data`/`caption` mono
 * family with tabular figures (DESIGN.md §2.1), and every signed value keeps its
 * sign as a CHARACTER — gain and loss are never carried by colour alone (§8).
 *
 * No `Date`, no `Intl` locale guessing beyond `en-US` grouping, no browser API:
 * these run during `renderToStaticMarkup` in a bare Node process too.
 */

/** Grouped integer, e.g. `1,200`. */
export function formatPanelNumber(value: number): string {
  return value.toLocaleString("en-US");
}

/** Cash, e.g. `$1,200` / `-$300`. The minus leads the unit, as on a statement. */
export function formatPanelMoney(value: number): string {
  const magnitude = formatPanelNumber(Math.abs(value));
  return value < 0 ? `-$${magnitude}` : `$${magnitude}`;
}

/** Explicitly signed integer, e.g. `+120`, `-40`, `+0`. */
export function formatPanelSigned(value: number): string {
  return `${value < 0 ? "-" : "+"}${formatPanelNumber(Math.abs(value))}`;
}

/** Explicitly signed cash, e.g. `+$120`, `-$40`. */
export function formatPanelSignedMoney(value: number): string {
  return `${value < 0 ? "-" : "+"}$${formatPanelNumber(Math.abs(value))}`;
}

/**
 * `gain` / `loss` / `flat`, for the `data-sign` attribute on `.panel-delta`.
 * The attribute is what colours the value; the sign in the text is what MEANS
 * it.
 */
export function panelDeltaSign(value: number): "gain" | "loss" | "flat" {
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "flat";
}

/**
 * Wall clock in UTC, parsed straight out of the ISO string rather than through
 * `Date`, so the same instant renders identically on a server, in a test and in
 * a browser in any timezone. Same derivation as the activity log's own clock.
 */
export function panelClock(occurredAt: string): string {
  return /T(\d{2}:\d{2})/.exec(occurredAt)?.[1] ?? "--:--";
}

/** Percentage 0–100 for a meter fill, clamped and rounded. `max <= 0` reads 0. */
export function panelMeterPercent(value: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  const ratio = (value / max) * 100;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(100, Math.round(ratio)));
}

/**
 * `met` once a target is reached, `over` when a ceiling is exceeded (heat past
 * its threshold), otherwise `below`. Drives the meter fill's token — always
 * beside the number itself, never instead of it (§6.4).
 */
export function panelMeterState(
  value: number,
  target: number,
  ceiling = false,
): "below" | "met" | "over" {
  if (value < target) return "below";
  return ceiling ? "over" : "met";
}

/** `1,200 / 2,000` — a committed-against-required pair in one mono token. */
export function formatPanelProgress(value: number, target: number): string {
  return `${formatPanelNumber(value)} / ${formatPanelNumber(target)}`;
}

/** `$1,200 / $2,000`. */
export function formatPanelMoneyProgress(value: number, target: number): string {
  return `${formatPanelMoney(value)} / ${formatPanelMoney(target)}`;
}

/**
 * "Round 7" / "Closes round 7" style copy is written at the call site; this only
 * supplies the number so no panel invents its own rounding or padding.
 */
export function formatPanelRound(round: number): string {
  return `R${formatPanelNumber(round)}`;
}

/**
 * Singular/plural without a template-literal at every call site. English only,
 * and deliberately dumb: localisation is `plans/08-accessibility-localization.md`
 * work, not something to half-do here.
 */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  const amount = formatPanelNumber(count);
  return count === 1 ? `${amount} ${singular}` : `${amount} ${plural}`;
}
