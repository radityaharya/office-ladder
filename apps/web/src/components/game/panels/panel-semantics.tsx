/**
 * The semantic language for v2's new state (`plans/24-gameplay-v2-spec.md` §12.4).
 *
 * §12.4 exists because eleven panels each inventing a vocabulary for the same
 * concept is how "i genuinely cant follow the game" happens a second time. It
 * names four concepts and, for each, what it must read as and what it must never
 * read as:
 *
 * | Concept | Reads as | Never |
 * | --- | --- | --- |
 * | Heat / suspicion | accumulating pressure, warning register | a score to maximise |
 * | Upkeep | a recurring obligation, visible *before* it bites | a surprise deduction |
 * | Debt | owed, distinct from negative money | red text alone |
 * | Project progress | a filling commitment with a visible deadline | a bare percentage |
 * | Sealed ballot | visibly sealed — "nobody knows yet" | an empty result |
 *
 * This module is the single implementation of that table. Every string a panel
 * prints about heat, upkeep, debt or a deadline comes from here, so the words
 * cannot drift between the roster, the projects list and the market — and a
 * change of register is one edit rather than eleven.
 *
 * Three rules held throughout:
 *
 * 1. **A number is never the only carrier.** Heat is "Pressure 3/5" beside a
 *    ceiling meter, not a bare 3; debt is "Owed $1,200", not `-1200` in red
 *    (§8 forbids colour-only meaning, and §12.4 forbids red text alone for debt
 *    specifically). Where a tone attribute exists it is a *third* carrier behind
 *    the noun and the figure.
 * 2. **Deadlines are stated in rounds, not animated.** §12.3's one sanctioned
 *    continuous animation is the wall-clock timer bar in the shell's attention
 *    region. A rail panel counting down would be the ambient motion §12.6 bans,
 *    so a deadline here is a word and a number that change when the round does.
 * 3. **No `Date`, no `Intl` beyond `en-US` grouping, no browser API** — the same
 *    constraint `panel-format.ts` carries, because these run inside
 *    `renderToStaticMarkup` in a bare Node process.
 */
import { formatPanelMoney, formatPanelNumber, formatPanelProgress, pluralise } from "./panel-format";

/**
 * How close a deadline is, as a word rather than a colour.
 *
 * Rendered onto `data-panel-urgency`, which `styles/panels.css` reads to escalate
 * the deadline's own token from muted through caution to critical. The escalation
 * is deliberately the *last* carrier: the label already says "Due now", so a
 * player who cannot see the colour has lost nothing.
 */
export type PanelUrgency = "distant" | "soon" | "now";

/**
 * Which clock a row is on. Three phrasings rather than one, because "3 rounds
 * left" and "Closes in 3 rounds" and "Lapses in 3 rounds" are three different
 * facts about three different kinds of commitment, and flattening them into one
 * sentence is how a player mistakes an auction for a project.
 *
 * - `due` — a commitment *you* must finish (a project's deadline).
 * - `closes` — a window the table is collecting into (a lot, a ballot).
 * - `lapses` — an offer that expires unanswered (an agreement).
 */
export type PanelDeadlinePhrasing = "due" | "closes" | "lapses";

/** Rounds remaining, floored at zero. A past deadline is "now", never negative. */
export function panelRoundsLeft(targetRound: number, round: number): number {
  const remaining = targetRound - round;
  return remaining <= 0 ? 0 : remaining;
}

/**
 * The deadline as a sentence fragment.
 *
 * Exact strings matter: these are the labels the destinations already print, and
 * this function is where the four hand-rolled copies of the same arithmetic in
 * `projects-panel`, `market-panel`, `ballots-panel` and `agreements-panel` were
 * consolidated. Consolidating them is the point of §12.4 — the *same* clock must
 * not read three ways.
 */
export function panelDeadlineLabel(
  targetRound: number,
  round: number,
  phrasing: PanelDeadlinePhrasing,
): string {
  const remaining = panelRoundsLeft(targetRound, round);

  if (phrasing === "due") {
    return remaining === 0 ? "Due now" : `${pluralise(remaining, "round")} left`;
  }
  if (phrasing === "closes") {
    return remaining === 0 ? "Closing" : `Closes in ${pluralise(remaining, "round")}`;
  }
  return remaining === 0 ? "Lapses now" : `Lapses in ${pluralise(remaining, "round")}`;
}

/** `now` at or past the round, `soon` with one round to go, else `distant`. */
export function panelDeadlineUrgency(targetRound: number, round: number): PanelUrgency {
  const remaining = panelRoundsLeft(targetRound, round);
  if (remaining === 0) return "now";
  return remaining <= 1 ? "soon" : "distant";
}

/**
 * A row's deadline readout.
 *
 * One component for every time-limited row in the kit, so a project, a lot, a
 * ballot and an offer all state their clock in the same place, at the same
 * measure, with the same escalation. `slot` keeps each destination's existing
 * `data-slot` so a host or a test can still address one kind of deadline.
 */
export function PanelDeadline({
  targetRound,
  round,
  phrasing,
  slot,
}: {
  readonly targetRound: number;
  readonly round: number;
  readonly phrasing: PanelDeadlinePhrasing;
  readonly slot?: string;
}) {
  return (
    <span
      className="panel-row-deadline"
      data-panel-urgency={panelDeadlineUrgency(targetRound, round)}
      data-slot={slot ?? "panel-deadline"}
    >
      {panelDeadlineLabel(targetRound, round, phrasing)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Heat — accumulating pressure, never a score                                */
/* -------------------------------------------------------------------------- */

/**
 * "Pressure 3/5".
 *
 * The noun is deliberately *pressure* and never *score*, *points* or *rating*:
 * §12.4's one prohibition on heat is that it must not read as something to
 * maximise, and a bare number beside a name is exactly a leaderboard. The pair
 * form carries the threshold, so 3 reads as "most of the way to something bad"
 * rather than as an achievement.
 */
export function panelPressureFact(value: number, threshold: number): string {
  return `Pressure ${formatPanelProgress(value, threshold)}`;
}

/* -------------------------------------------------------------------------- */
/* Upkeep — a recurring obligation, visible BEFORE it bites                   */
/* -------------------------------------------------------------------------- */

/** The public upkeep facts about one seat. Mirrors `UpkeepProjection`. */
export type PanelUpkeepReadout = {
  readonly perRound: number;
  readonly lastChargedRound: number;
  readonly missedPayments: number;
};

/**
 * "Upkeep $80/rd" — the charge, per round, as a standing obligation.
 *
 * A charge of zero is stated rather than omitted ("No upkeep"): §12.4's rule is
 * that upkeep is visible *before* it bites, and a row that shows nothing until
 * the first deduction has already failed that. A promotion raising upkeep is the
 * case this exists for — the number moves a round before the money does.
 */
export function panelUpkeepFact(upkeep: PanelUpkeepReadout): string {
  if (upkeep.perRound <= 0) return "No upkeep";
  return `Upkeep ${formatPanelMoney(upkeep.perRound)}/rd`;
}

/**
 * "2 payments missed", or null when nothing has been missed.
 *
 * Separate from {@link panelUpkeepFact} because a missed payment is a different
 * kind of fact from a standing charge, and a row should not have to print the
 * clean case to keep its shape — the facts run wraps rather than reserving lanes.
 */
export function panelUpkeepArrearsFact(upkeep: PanelUpkeepReadout): string | null {
  if (upkeep.missedPayments <= 0) return null;
  return `${pluralise(upkeep.missedPayments, "payment")} missed`;
}

/* -------------------------------------------------------------------------- */
/* Debt — owed, and distinct from negative money                              */
/* -------------------------------------------------------------------------- */

/**
 * "Owed $1,200 · 2 loans", or "No debt".
 *
 * The verb is what makes this not a balance. §12.4: debt reads as *owed* and is
 * distinct from negative money — a player at `-$300` cash and a player carrying a
 * $1,200 loan are in different trouble, and one red figure cannot say which. The
 * loan count rides along because a single large loan and three small ones repay
 * differently.
 */
export function panelDebtFact(outstanding: number, loanCount: number): string {
  if (loanCount <= 0 || outstanding <= 0) return "No debt";
  return `Owed ${formatPanelMoney(outstanding)} · ${pluralise(loanCount, "loan")}`;
}

/** "+$40/rd" — a net income stream, signed so a negative stream is legible. */
export function panelIncomeFact(perRound: number): string | null {
  if (perRound === 0) return null;
  const magnitude = formatPanelMoney(Math.abs(perRound));
  return `${perRound < 0 ? "-" : "+"}${magnitude}/rd`;
}

/* -------------------------------------------------------------------------- */
/* Shared teaching copy                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The sentences §12.5 asks each panel's empty state to teach, authored once.
 *
 * §12.5's whole argument is that an empty panel is the first thing a new player
 * reads and this game ships no onboarding, so the copy is real teaching rather
 * than "no data". Holding the shared clauses here stops eleven panels each
 * explaining heat slightly differently — which would be worse than one of them
 * not explaining it at all, because a player who reads two versions trusts
 * neither.
 */
export const PANEL_SEMANTIC_COPY = {
  heat: "Heat is suspicion you accumulate by attacking other players. It is not a score — crossing the threshold opens an HR investigation against you, not against whoever you hit.",
  upkeep:
    "Upkeep is charged every round and rises with your rank, so a promotion is an ongoing cost as well as a win condition. The charge is shown a round before it is taken.",
  debt: "A loan is money you owe, tracked separately from your cash balance: repaying it is a choice you make, while upkeep is taken from you.",
  projectProgress:
    "A project fills towards the money and work it needs and dies on its deadline round. A failed project pays nobody, including its lead.",
  sealed:
    "A sealed ballot reveals every cast at once when it closes. Nothing is visible while it is running — not the tally, and not who has already answered.",
} as const;

/**
 * "Upkeep $80 a round at this rank." — the one line a panel prints about the
 * viewer's own standing obligation, or the mode's own off-switch.
 */
export function panelUpkeepSentence(
  upkeep: PanelUpkeepReadout | null,
  round: number,
): string {
  if (upkeep === null) {
    return "This mode charges no upkeep, so cash you hold is cash you keep.";
  }
  const charge =
    upkeep.perRound <= 0
      ? "Your rank carries no upkeep yet; it rises as you are promoted."
      : `Your rank costs ${formatPanelMoney(upkeep.perRound)} every round.`;
  const last =
    upkeep.lastChargedRound <= 0
      ? " Nothing has been charged yet."
      : ` Last charged in round ${formatPanelNumber(upkeep.lastChargedRound)}; the next charge lands in round ${formatPanelNumber(Math.max(round, upkeep.lastChargedRound) + 1)}.`;
  const arrears =
    upkeep.missedPayments <= 0
      ? ""
      : ` ${pluralise(upkeep.missedPayments, "payment")} already missed.`;

  return `${charge}${last}${arrears}`;
}
