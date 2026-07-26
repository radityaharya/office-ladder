import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PANEL_SEMANTIC_COPY,
  PanelDeadline,
  panelDeadlineLabel,
  panelDeadlineUrgency,
  panelDebtFact,
  panelIncomeFact,
  panelPressureFact,
  panelRoundsLeft,
  panelUpkeepArrearsFact,
  panelUpkeepFact,
  panelUpkeepSentence,
} from "./panel-semantics";

describe("deadlines read one way across the whole kit", () => {
  it("phrases the three kinds of clock differently and counts down in rounds", () => {
    // Then — a project you must finish, a window the table is collecting into and
    // an offer that expires unanswered are three different facts. §12.4's point is
    // that the same clock must not read three ways; it is not that three different
    // clocks must read the same.
    expect(panelDeadlineLabel(9, 6, "due")).toBe("3 rounds left");
    expect(panelDeadlineLabel(7, 6, "due")).toBe("1 round left");
    expect(panelDeadlineLabel(8, 6, "closes")).toBe("Closes in 2 rounds");
    expect(panelDeadlineLabel(8, 6, "lapses")).toBe("Lapses in 2 rounds");
  });

  it("says the deadline has arrived rather than printing a negative number", () => {
    expect(panelDeadlineLabel(6, 6, "due")).toBe("Due now");
    expect(panelDeadlineLabel(2, 6, "due")).toBe("Due now");
    expect(panelDeadlineLabel(6, 6, "closes")).toBe("Closing");
    expect(panelDeadlineLabel(1, 9, "lapses")).toBe("Lapses now");
    expect(panelRoundsLeft(1, 9)).toBe(0);
  });

  it("escalates urgency as a word, with the label carrying the fact regardless", () => {
    // Then — colour is the third carrier here (§8): the text already says which
    // of the three states this is, so the attribute only chooses a token.
    expect(panelDeadlineUrgency(12, 6)).toBe("distant");
    expect(panelDeadlineUrgency(7, 6)).toBe("soon");
    expect(panelDeadlineUrgency(6, 6)).toBe("now");
  });

  it("renders as a static readout with no countdown of its own", () => {
    // When
    const markup = renderToStaticMarkup(
      <PanelDeadline phrasing="closes" round={6} slot="panel-market-closes" targetRound={7} />,
    );

    // Then — §12.3 sanctions exactly one continuous animation in the system, the
    // wall-clock timer bar in the shell's attention region. A rail row that
    // animated would be the ambient motion §12.6 bans.
    expect(markup).toContain('data-slot="panel-market-closes"');
    expect(markup).toContain('data-panel-urgency="soon"');
    expect(markup).toContain("Closes in 1 round");
    expect(markup).not.toContain("animation");
  });
});

describe("heat reads as pressure, never as a score", () => {
  it("states the value against its threshold with a warning-register noun", () => {
    // Then — §12.4's one prohibition on heat: it must not read as something to
    // maximise, and a bare number beside a name is a leaderboard.
    expect(panelPressureFact(3, 5)).toBe("Pressure 3 / 5");
    expect(panelPressureFact(0, 5)).toBe("Pressure 0 / 5");
    for (const word of ["score", "points", "rating", "rank"]) {
      expect(panelPressureFact(3, 5).toLowerCase()).not.toContain(word);
    }
  });
});

describe("upkeep is visible before it bites", () => {
  it("states the standing charge even when nothing has been taken yet", () => {
    expect(panelUpkeepFact({ perRound: 80, lastChargedRound: 0, missedPayments: 0 })).toBe(
      "Upkeep $80/rd",
    );
    // A seat with no charge says so rather than showing nothing: a row that stays
    // blank until the first deduction has already been a surprise.
    expect(panelUpkeepFact({ perRound: 0, lastChargedRound: 0, missedPayments: 0 })).toBe(
      "No upkeep",
    );
  });

  it("keeps arrears as a separate fact from the standing charge", () => {
    expect(
      panelUpkeepArrearsFact({ perRound: 80, lastChargedRound: 5, missedPayments: 0 }),
    ).toBeNull();
    expect(
      panelUpkeepArrearsFact({ perRound: 80, lastChargedRound: 5, missedPayments: 1 }),
    ).toBe("1 payment missed");
  });

  it("names the round the next charge lands in", () => {
    // Then — "before it bites" is a *when*, not just a *how much*.
    const sentence = panelUpkeepSentence(
      { perRound: 80, lastChargedRound: 5, missedPayments: 0 },
      6,
    );
    expect(sentence).toContain("$80 every round");
    expect(sentence).toContain("next charge lands in round 7");

    expect(panelUpkeepSentence(null, 6)).toContain("charges no upkeep");
  });
});

describe("debt is owed, and distinct from negative money", () => {
  it("uses a verb rather than a balance, and never colour alone", () => {
    // Then — §12.4 forbids "red text alone" for debt specifically. A seat at
    // -$300 cash and a seat carrying a $1,200 loan are in different trouble.
    expect(panelDebtFact(1200, 1)).toBe("Owed $1,200 · 1 loan");
    expect(panelDebtFact(1200, 3)).toBe("Owed $1,200 · 3 loans");
    expect(panelDebtFact(0, 0)).toBe("No debt");
    // A stale outstanding with no loan behind it is not debt.
    expect(panelDebtFact(400, 0)).toBe("No debt");
  });

  it("signs an income stream so a negative one is legible as a character", () => {
    expect(panelIncomeFact(40)).toBe("+$40/rd");
    expect(panelIncomeFact(-40)).toBe("-$40/rd");
    expect(panelIncomeFact(0)).toBeNull();
  });
});

describe("the shared teaching copy", () => {
  it("explains each new concept in a full sentence rather than a label", () => {
    // Then — §12.5: an empty panel is the first thing a new player reads, and this
    // game ships no onboarding. Holding the shared clauses in one place is what
    // stops eleven panels each explaining heat slightly differently.
    for (const [concept, copy] of Object.entries(PANEL_SEMANTIC_COPY)) {
      expect(copy.length, concept).toBeGreaterThan(80);
      expect(copy.endsWith("."), concept).toBe(true);
    }
    expect(PANEL_SEMANTIC_COPY.heat).toContain("not a score");
    expect(PANEL_SEMANTIC_COPY.debt).toContain("owe");
    expect(PANEL_SEMANTIC_COPY.upkeep).toContain("every round");
    expect(PANEL_SEMANTIC_COPY.sealed).toContain("who has already answered");
  });
});
