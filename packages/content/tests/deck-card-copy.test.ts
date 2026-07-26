import { describe, expect, it } from "vitest";

import { deadlineDashDecks } from "../src/deadline-dash";
import type { DeckConfig } from "../src/schema/decks";

/**
 * Read the authored pack through its *public* type rather than its `as const`
 * literal type, so `displayName`/`flavorText` are seen exactly as a consumer
 * sees them — optional, therefore `string | undefined`. That makes the
 * assertions below real runtime coverage checks instead of tautologies the
 * literal type would already have guaranteed.
 */
const decks: readonly DeckConfig[] = deadlineDashDecks;

/** Fits the card-draw modal's title line without wrapping. */
const maxDisplayNameLength = 40;
/** One clause: long enough to read as a logged note, short enough to stay one line. */
const maxFlavorTextLength = 80;

/** Authored copy coverage per deck, asserted exactly so dropping copy fails loudly. */
const expectedCardCounts: Readonly<Record<string, number>> = {
  "deck.work": 47,
  "deck.meeting": 48,
  "deck.event": 51,
  "deck.networking": 49,
  "deck.board-meeting": 23,
  "deck.annual-event": 24,
};

function collectCopyProblems(
  check: (card: DeckConfig["cards"][number], deck: DeckConfig) => string | null,
): readonly string[] {
  const problems: string[] = [];
  for (const deck of decks) {
    for (const card of deck.cards) {
      const problem = check(card, deck);
      if (problem !== null) problems.push(`${card.id}: ${problem}`);
    }
  }
  return problems;
}

describe("Deadline Dash deck card display copy", () => {
  it("authors a display name and a flavor line for every card in every deck", () => {
    expect(
      collectCopyProblems((card) => {
        if (typeof card.displayName !== "string") return "missing displayName";
        if (typeof card.flavorText !== "string") return "missing flavorText";
        return null;
      }),
    ).toEqual([]);
  });

  it("covers exactly the authored card catalog, deck by deck", () => {
    const covered = Object.fromEntries(
      decks.map((deck) => [
        deck.id,
        deck.cards.filter(
          (card) =>
            typeof card.displayName === "string" && typeof card.flavorText === "string",
        ).length,
      ]),
    );

    expect(covered).toEqual(expectedCardCounts);
    expect(
      decks.map((deck) => [deck.id, deck.cards.length] as const),
    ).toEqual(Object.entries(expectedCardCounts));
  });

  it("keeps every authored string non-empty and trimmed", () => {
    expect(
      collectCopyProblems((card) => {
        for (const [field, value] of [
          ["displayName", card.displayName],
          ["flavorText", card.flavorText],
        ] as const) {
          if (value === undefined) return `missing ${field}`;
          if (value.length === 0) return `empty ${field}`;
          if (value !== value.trim()) return `untrimmed ${field}: ${JSON.stringify(value)}`;
          if (value.includes("  ")) return `double-spaced ${field}: ${JSON.stringify(value)}`;
          if (/[\n\r\t]/.test(value)) return `multi-line ${field}: ${JSON.stringify(value)}`;
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("keeps the copy short enough to render on one line in a modal", () => {
    expect(
      collectCopyProblems((card) => {
        if (card.displayName !== undefined && card.displayName.length > maxDisplayNameLength) {
          return `displayName is ${card.displayName.length} chars (max ${maxDisplayNameLength})`;
        }
        if (card.flavorText !== undefined && card.flavorText.length > maxFlavorTextLength) {
          return `flavorText is ${card.flavorText.length} chars (max ${maxFlavorTextLength})`;
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("writes the flavor line as a single terminated statement, not a paragraph", () => {
    expect(
      collectCopyProblems((card) => {
        if (card.flavorText === undefined) return "missing flavorText";
        if (!card.flavorText.endsWith(".")) {
          return `flavorText is unterminated: ${JSON.stringify(card.flavorText)}`;
        }
        if (card.flavorText.slice(0, -1).includes(".")) {
          return `flavorText runs past one statement: ${JSON.stringify(card.flavorText)}`;
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("never hardcodes a numeral in copy, so copy cannot contradict the card's effects", () => {
    expect(
      collectCopyProblems((card) => {
        for (const [field, value] of [
          ["displayName", card.displayName],
          ["flavorText", card.flavorText],
        ] as const) {
          if (value !== undefined && /\d/.test(value)) {
            return `${field} states a numeral, which can drift from effects: ${JSON.stringify(value)}`;
          }
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("gives no two cards in a deck the same display name", () => {
    for (const deck of decks) {
      const names = deck.cards.map((card) => card.displayName);
      expect(new Set(names).size, `duplicate displayName within ${deck.id}`).toBe(
        deck.cards.length,
      );
    }
  });

  it("gives no two cards in the whole pack the same display name or flavor line", () => {
    const allCards = decks.flatMap((deck) => deck.cards);

    expect(new Set(allCards.map((card) => card.displayName)).size).toBe(allCards.length);
    expect(new Set(allCards.map((card) => card.flavorText)).size).toBe(allCards.length);
  });

  it("adds copy without disturbing the ids, name keys, or effects the engine reads", () => {
    const identity = decks.flatMap((deck) =>
      deck.cards.map((card) => ({
        deckId: deck.id,
        id: card.id,
        nameKey: card.nameKey,
        effectTypes: card.effects.map((effect) => effect.type),
      })),
    );

    expect(identity).toEqual([
      {
        deckId: "deck.work",
        id: "card.work.overtime-bonus",
        nameKey: "deadlineDash.card.workOvertimeBonus.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.printer-jam",
        nameKey: "deadlineDash.card.workPrinterJam.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.mentorship",
        nameKey: "deadlineDash.card.workMentorship.name",
        effectTypes: ["modifyResource", "incrementWorkCounter"],
      },
      {
        deckId: "deck.work",
        id: "card.work.expense-report-rejected",
        nameKey: "deadlineDash.card.workExpenseReportRejected.name",
        effectTypes: ["payResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.free-coffee",
        nameKey: "deadlineDash.card.workFreeCoffee.name",
        effectTypes: ["restoreResourceToMaximum"],
      },
      {
        deckId: "deck.work",
        id: "card.work.crunch-time",
        nameKey: "deadlineDash.card.workCrunchTime.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.complete-daily-task",
        nameKey: "deadlineDash.card.workCompleteDailyTask.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.project-milestone",
        nameKey: "deadlineDash.card.workProjectMilestone.name",
        effectTypes: ["modifyResource", "incrementWorkCounter"],
      },
      {
        deckId: "deck.work",
        id: "card.work.fast-delivery",
        nameKey: "deadlineDash.card.workFastDelivery.name",
        effectTypes: ["chooseOne"],
      },
      {
        deckId: "deck.work",
        id: "card.work.quality-work",
        nameKey: "deadlineDash.card.workQualityWork.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.client-compliment",
        nameKey: "deadlineDash.card.workClientCompliment.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.positive-performance-review",
        nameKey: "deadlineDash.card.workPositivePerformanceReview.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.process-improvement",
        nameKey: "deadlineDash.card.workProcessImprovement.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.knowledge-sharing",
        nameKey: "deadlineDash.card.workKnowledgeSharing.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.cross-team-collaboration",
        nameKey: "deadlineDash.card.workCrossTeamCollaboration.name",
        effectTypes: ["transferResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.work",
        id: "card.work.innovation-idea",
        nameKey: "deadlineDash.card.workInnovationIdea.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.performance-bonus",
        nameKey: "deadlineDash.card.workPerformanceBonus.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.kpi-achieved",
        nameKey: "deadlineDash.card.workKpiAchieved.name",
        effectTypes: ["incrementWorkCounter", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.employee-spotlight",
        nameKey: "deadlineDash.card.workEmployeeSpotlight.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.work",
        id: "card.work.spot-bonus",
        nameKey: "deadlineDash.card.workSpotBonus.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.coffee-break",
        nameKey: "deadlineDash.card.workCoffeeBreak.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.lunch-break",
        nameKey: "deadlineDash.card.workLunchBreak.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.efficient-workflow",
        nameKey: "deadlineDash.card.workEfficientWorkflow.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.work",
        id: "card.work.mentoring-session",
        nameKey: "deadlineDash.card.workMentoringSession.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.successful-presentation",
        nameKey: "deadlineDash.card.workSuccessfulPresentation.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.overtime-pay",
        nameKey: "deadlineDash.card.workOvertimePay.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.weekend-support",
        nameKey: "deadlineDash.card.workWeekendSupport.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.workload-spike",
        nameKey: "deadlineDash.card.workWorkloadSpike.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.work",
        id: "card.work.tight-deadline",
        nameKey: "deadlineDash.card.workTightDeadline.name",
        effectTypes: ["modifyResource", "incrementWorkCounter", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.work",
        id: "card.work.minor-mistake",
        nameKey: "deadlineDash.card.workMinorMistake.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.rework-required",
        nameKey: "deadlineDash.card.workReworkRequired.name",
        effectTypes: ["applyStatus", "modifyHeat"],
      },
      {
        deckId: "deck.work",
        id: "card.work.missed-deadline",
        nameKey: "deadlineDash.card.workMissedDeadline.name",
        effectTypes: ["payResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.work",
        id: "card.work.burnout",
        nameKey: "deadlineDash.card.workBurnout.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.performance-warning",
        nameKey: "deadlineDash.card.workPerformanceWarning.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.work",
        id: "card.work.outstanding-achievement",
        nameKey: "deadlineDash.card.workOutstandingAchievement.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.company-recognition",
        nameKey: "deadlineDash.card.workCompanyRecognition.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.annual-bonus",
        nameKey: "deadlineDash.card.workAnnualBonus.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.expense-claim",
        nameKey: "deadlineDash.card.workExpenseClaim.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.work",
        id: "card.work.coffee-voucher",
        nameKey: "deadlineDash.card.workCoffeeVoucher.name",
        effectTypes: ["chooseOne"],
      },
      {
        deckId: "deck.work",
        id: "card.work.recognition-letter",
        nameKey: "deadlineDash.card.workRecognitionLetter.name",
        effectTypes: ["modifyResource", "applyStatus"],
      },
      {
        deckId: "deck.work",
        id: "card.work.project-template",
        nameKey: "deadlineDash.card.workProjectTemplate.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.work",
        id: "card.work.performance-report",
        nameKey: "deadlineDash.card.workPerformanceReport.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.work",
        id: "card.work.productivity-toolkit",
        nameKey: "deadlineDash.card.workProductivityToolkit.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.work",
        id: "card.work.time-management-course",
        nameKey: "deadlineDash.card.workTimeManagementCourse.name",
        effectTypes: ["modifyResource", "removeStatuses"],
      },
      {
        deckId: "deck.work",
        id: "card.work.employee-assistance-program",
        nameKey: "deadlineDash.card.workEmployeeAssistanceProgram.name",
        effectTypes: ["removeStatuses"],
      },
      {
        deckId: "deck.work",
        id: "card.work.promotion-portfolio",
        nameKey: "deadlineDash.card.workPromotionPortfolio.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.work",
        id: "card.work.excellence-certificate",
        nameKey: "deadlineDash.card.workExcellenceCertificate.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.great-idea",
        nameKey: "deadlineDash.card.meetingGreatIdea.name",
        effectTypes: ["modifyResource", "drawCards"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.ran-long",
        nameKey: "deadlineDash.card.meetingRanLong.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.executive-endorsement",
        nameKey: "deadlineDash.card.meetingExecutiveEndorsement.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.awkward-silence",
        nameKey: "deadlineDash.card.meetingAwkwardSilence.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.free-lunch",
        nameKey: "deadlineDash.card.meetingFreeLunch.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.productive-meeting",
        nameKey: "deadlineDash.card.meetingProductiveMeeting.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.weekly-sync",
        nameKey: "deadlineDash.card.meetingWeeklySync.name",
        effectTypes: ["incrementWorkCounter", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.great-presentation",
        nameKey: "deadlineDash.card.meetingGreatPresentation.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.client-approval",
        nameKey: "deadlineDash.card.meetingClientApproval.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.decision-made",
        nameKey: "deadlineDash.card.meetingDecisionMade.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.clear-direction",
        nameKey: "deadlineDash.card.meetingClearDirection.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.cross-department-support",
        nameKey: "deadlineDash.card.meetingCrossDepartmentSupport.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.successful-negotiation",
        nameKey: "deadlineDash.card.meetingSuccessfulNegotiation.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.project-greenlight",
        nameKey: "deadlineDash.card.meetingProjectGreenlight.name",
        effectTypes: ["modifyResource", "grantExtraRoll"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.new-opportunity",
        nameKey: "deadlineDash.card.meetingNewOpportunity.name",
        effectTypes: ["drawCards", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.client-expansion",
        nameKey: "deadlineDash.card.meetingClientExpansion.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.meeting-ends-early",
        nameKey: "deadlineDash.card.meetingMeetingEndsEarly.name",
        effectTypes: ["grantExtraRoll"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.efficient-agenda",
        nameKey: "deadlineDash.card.meetingEfficientAgenda.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.scope-creep",
        nameKey: "deadlineDash.card.meetingScopeCreep.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.meeting-overrun",
        nameKey: "deadlineDash.card.meetingMeetingOverrun.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.quick-stand-up",
        nameKey: "deadlineDash.card.meetingQuickStandUp.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.brainstorm-session",
        nameKey: "deadlineDash.card.meetingBrainstormSession.name",
        effectTypes: ["drawCards", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.strategic-planning",
        nameKey: "deadlineDash.card.meetingStrategicPlanning.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.performance-review-development",
        nameKey: "deadlineDash.card.meetingPerformanceReviewDevelopment.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.follow-up-required",
        nameKey: "deadlineDash.card.meetingFollowUpRequired.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.meeting-master",
        nameKey: "deadlineDash.card.meetingMeetingMaster.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.manager-recognition",
        nameKey: "deadlineDash.card.meetingManagerRecognition.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.executive-praise",
        nameKey: "deadlineDash.card.meetingExecutivePraise.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.approved-budget",
        nameKey: "deadlineDash.card.meetingApprovedBudget.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.performance-review-commendation",
        nameKey: "deadlineDash.card.meetingPerformanceReviewCommendation.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.promotion-discussion",
        nameKey: "deadlineDash.card.meetingPromotionDiscussion.name",
        effectTypes: ["chooseOne"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.mentorship-session",
        nameKey: "deadlineDash.card.meetingMentorshipSession.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.tough-questions",
        nameKey: "deadlineDash.card.meetingToughQuestions.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.proposal-rejected",
        nameKey: "deadlineDash.card.meetingProposalRejected.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.budget-cut",
        nameKey: "deadlineDash.card.meetingBudgetCut.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.miscommunication",
        nameKey: "deadlineDash.card.meetingMiscommunication.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.executive-alignment",
        nameKey: "deadlineDash.card.meetingExecutiveAlignment.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.town-hall",
        nameKey: "deadlineDash.card.meetingTownHall.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.meeting-cancelled",
        nameKey: "deadlineDash.card.meetingMeetingCancelled.name",
        effectTypes: ["removeStatuses"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.reschedule",
        nameKey: "deadlineDash.card.meetingReschedule.name",
        effectTypes: ["noEffect"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.decision-deferred",
        nameKey: "deadlineDash.card.meetingDecisionDeferred.name",
        effectTypes: ["noEffect"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.action-items",
        nameKey: "deadlineDash.card.meetingActionItems.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.calendar-priority",
        nameKey: "deadlineDash.card.meetingCalendarPriority.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.approval-letter",
        nameKey: "deadlineDash.card.meetingApprovalLetter.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.meeting-minutes",
        nameKey: "deadlineDash.card.meetingMeetingMinutes.name",
        effectTypes: ["grantImmunity"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.presentation-slides-ready",
        nameKey: "deadlineDash.card.meetingPresentationSlidesReady.name",
        effectTypes: ["grantImmunity"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.budget-approval-memo",
        nameKey: "deadlineDash.card.meetingBudgetApprovalMemo.name",
        effectTypes: ["modifyResource", "incrementWorkCounter"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.leadership-coaching",
        nameKey: "deadlineDash.card.meetingLeadershipCoaching.name",
        effectTypes: ["restoreResourceToMaximum"],
      },
      {
        deckId: "deck.event",
        id: "card.event.jackpot",
        nameKey: "deadlineDash.card.eventJackpot.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.office-fire-drill",
        nameKey: "deadlineDash.card.eventOfficeFireDrill.name",
        effectTypes: ["skipTurns"],
      },
      {
        deckId: "deck.event",
        id: "card.event.surprise-bonus",
        nameKey: "deadlineDash.card.eventSurpriseBonus.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.data-breach",
        nameKey: "deadlineDash.card.eventDataBreach.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.headhunter-call",
        nameKey: "deadlineDash.card.eventHeadhunterCall.name",
        effectTypes: ["grantExtraRoll"],
      },
      {
        deckId: "deck.event",
        id: "card.event.lucky-day",
        nameKey: "deadlineDash.card.eventLuckyDay.name",
        effectTypes: ["rollCheck"],
      },
      {
        deckId: "deck.event",
        id: "card.event.hidden-opportunity",
        nameKey: "deadlineDash.card.eventHiddenOpportunity.name",
        effectTypes: ["modifyResource", "drawCards"],
      },
      {
        deckId: "deck.event",
        id: "card.event.employee-discount",
        nameKey: "deadlineDash.card.eventEmployeeDiscount.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.wellness-program",
        nameKey: "deadlineDash.card.eventWellnessProgram.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.side-hustle",
        nameKey: "deadlineDash.card.eventSideHustle.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.lucky-draw-winner",
        nameKey: "deadlineDash.card.eventLuckyDrawWinner.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.laptop-crash",
        nameKey: "deadlineDash.card.eventLaptopCrash.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.payroll-error",
        nameKey: "deadlineDash.card.eventPayrollError.name",
        effectTypes: ["payResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.parking-ticket",
        nameKey: "deadlineDash.card.eventParkingTicket.name",
        effectTypes: ["payResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.reimbursement-declined",
        nameKey: "deadlineDash.card.eventReimbursementDeclined.name",
        effectTypes: ["payResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.secret-investor",
        nameKey: "deadlineDash.card.eventSecretInvestor.name",
        effectTypes: ["modifyResource", "drawCards"],
      },
      {
        deckId: "deck.event",
        id: "card.event.buy-coffee",
        nameKey: "deadlineDash.card.eventBuyCoffee.name",
        effectTypes: ["modifyResource", "payResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.recommend-colleague",
        nameKey: "deadlineDash.card.eventRecommendColleague.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.cover-my-shift",
        nameKey: "deadlineDash.card.eventCoverMyShift.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.office-prank",
        nameKey: "deadlineDash.card.eventOfficePrank.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.borrow-supplies",
        nameKey: "deadlineDash.card.eventBorrowSupplies.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.credit-taken",
        nameKey: "deadlineDash.card.eventCreditTaken.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.helping-hand",
        nameKey: "deadlineDash.card.eventHelpingHand.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.lunch-buddy",
        nameKey: "deadlineDash.card.eventLunchBuddy.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.team-collaboration",
        nameKey: "deadlineDash.card.eventTeamCollaboration.name",
        effectTypes: ["modifyResource", "modifyResource", "incrementWorkCounter"],
      },
      {
        deckId: "deck.event",
        id: "card.event.birthday-collection",
        nameKey: "deadlineDash.card.eventBirthdayCollection.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.baby-shower",
        nameKey: "deadlineDash.card.eventBabyShower.name",
        effectTypes: ["transferResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.wedding-collection",
        nameKey: "deadlineDash.card.eventWeddingCollection.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.promotion-celebration",
        nameKey: "deadlineDash.card.eventPromotionCelebration.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.charity-drive",
        nameKey: "deadlineDash.card.eventCharityDrive.name",
        effectTypes: ["payResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.profit-sharing",
        nameKey: "deadlineDash.card.eventProfitSharing.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.office-flu",
        nameKey: "deadlineDash.card.eventOfficeFlu.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.surprise-audit",
        nameKey: "deadlineDash.card.eventSurpriseAudit.name",
        effectTypes: ["auditConfinement", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.coffee-treat",
        nameKey: "deadlineDash.card.eventCoffeeTreat.name",
        effectTypes: ["transferResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.pizza-friday",
        nameKey: "deadlineDash.card.eventPizzaFriday.name",
        effectTypes: ["transferResource", "modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.career-opportunity",
        nameKey: "deadlineDash.card.eventCareerOpportunity.name",
        effectTypes: ["chooseOne"],
      },
      {
        deckId: "deck.event",
        id: "card.event.work-life-balance",
        nameKey: "deadlineDash.card.eventWorkLifeBalance.name",
        effectTypes: ["chooseOne"],
      },
      {
        deckId: "deck.event",
        id: "card.event.helping-hand-choice",
        nameKey: "deadlineDash.card.eventHelpingHandChoice.name",
        effectTypes: ["chooseOne"],
      },
      {
        deckId: "deck.event",
        id: "card.event.office-bet",
        nameKey: "deadlineDash.card.eventOfficeBet.name",
        effectTypes: ["opposedRoll", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.lucky-coin",
        nameKey: "deadlineDash.card.eventLuckyCoin.name",
        effectTypes: ["modifyResource", "grantExtraRoll"],
      },
      {
        deckId: "deck.event",
        id: "card.event.emergency-fund",
        nameKey: "deadlineDash.card.eventEmergencyFund.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.chocolate-bar",
        nameKey: "deadlineDash.card.eventChocolateBar.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.thank-you-card",
        nameKey: "deadlineDash.card.eventThankYouCard.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.insurance-claim",
        nameKey: "deadlineDash.card.eventInsuranceClaim.name",
        effectTypes: ["grantImmunity"],
      },
      {
        deckId: "deck.event",
        id: "card.event.pr-statement",
        nameKey: "deadlineDash.card.eventPrStatement.name",
        effectTypes: ["grantImmunity"],
      },
      {
        deckId: "deck.event",
        id: "card.event.skip-queue-pass",
        nameKey: "deadlineDash.card.eventSkipQueuePass.name",
        effectTypes: ["grantImmunity"],
      },
      {
        deckId: "deck.event",
        id: "card.event.energy-booster",
        nameKey: "deadlineDash.card.eventEnergyBooster.name",
        effectTypes: ["grantImmunity"],
      },
      {
        deckId: "deck.event",
        id: "card.event.office-access-pass",
        nameKey: "deadlineDash.card.eventOfficeAccessPass.name",
        effectTypes: ["grantImmunity"],
      },
      {
        deckId: "deck.event",
        id: "card.event.online-course",
        nameKey: "deadlineDash.card.eventOnlineCourse.name",
        effectTypes: ["incrementWorkCounter"],
      },
      {
        deckId: "deck.event",
        id: "card.event.company-merchandise",
        nameKey: "deadlineDash.card.eventCompanyMerchandise.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.event",
        id: "card.event.coffee-voucher",
        nameKey: "deadlineDash.card.eventCoffeeVoucher.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.lets-circle-back",
        nameKey: "deadlineDash.card.networkingLetsCircleBack.name",
        effectTypes: ["drawCards"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.linkedin-endorsement",
        nameKey: "deadlineDash.card.networkingLinkedinEndorsement.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.free-swag",
        nameKey: "deadlineDash.card.networkingFreeSwag.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.awkward-elevator-ride",
        nameKey: "deadlineDash.card.networkingAwkwardElevatorRide.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.restricted-floor-pass",
        nameKey: "deadlineDash.card.networkingRestrictedFloorPass.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.linkedin-influencer",
        nameKey: "deadlineDash.card.networkingLinkedinInfluencer.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.coffee-chat",
        nameKey: "deadlineDash.card.networkingCoffeeChat.name",
        effectTypes: ["modifyResource", "drawCards"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.free-buffet",
        nameKey: "deadlineDash.card.networkingFreeBuffet.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.lucky-door-prize",
        nameKey: "deadlineDash.card.networkingLuckyDoorPrize.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.industry-connection",
        nameKey: "deadlineDash.card.networkingIndustryConnection.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.elevator-pitch",
        nameKey: "deadlineDash.card.networkingElevatorPitch.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.guest-speaker-inspiration",
        nameKey: "deadlineDash.card.networkingGuestSpeakerInspiration.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.business-card-master",
        nameKey: "deadlineDash.card.networkingBusinessCardMaster.name",
        effectTypes: ["drawCards"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.new-mentor",
        nameKey: "deadlineDash.card.networkingNewMentor.name",
        effectTypes: ["modifyResource", "applyStatus"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.seminar-certificate",
        nameKey: "deadlineDash.card.networkingSeminarCertificate.name",
        effectTypes: ["modifyResource", "drawCards"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.coffee-sponsor",
        nameKey: "deadlineDash.card.networkingCoffeeSponsor.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.great-introduction",
        nameKey: "deadlineDash.card.networkingGreatIntroduction.name",
        effectTypes: ["modifyResource", "drawCards"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.recruiter-notice",
        nameKey: "deadlineDash.card.networkingRecruiterNotice.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.vip-pass",
        nameKey: "deadlineDash.card.networkingVipPass.name",
        effectTypes: ["grantImmunity"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.networking-jackpot",
        nameKey: "deadlineDash.card.networkingNetworkingJackpot.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.office-gossip",
        nameKey: "deadlineDash.card.networkingOfficeGossip.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.wrong-name-tag",
        nameKey: "deadlineDash.card.networkingWrongNameTag.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.endless-small-talk",
        nameKey: "deadlineDash.card.networkingEndlessSmallTalk.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.forced-icebreaker",
        nameKey: "deadlineDash.card.networkingForcedIcebreaker.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.sales-pitch-trap",
        nameKey: "deadlineDash.card.networkingSalesPitchTrap.name",
        effectTypes: ["payResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.cringe-linkedin-post",
        nameKey: "deadlineDash.card.networkingCringeLinkedinPost.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.oversharing",
        nameKey: "deadlineDash.card.networkingOversharing.name",
        effectTypes: ["transferResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.forgot-their-name",
        nameKey: "deadlineDash.card.networkingForgotTheirName.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.boring-seminar",
        nameKey: "deadlineDash.card.networkingBoringSeminar.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.office-rumor",
        nameKey: "deadlineDash.card.networkingOfficeRumor.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.coffee-spill",
        nameKey: "deadlineDash.card.networkingCoffeeSpill.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.stolen-spotlight",
        nameKey: "deadlineDash.card.networkingStolenSpotlight.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.recruiter-poached",
        nameKey: "deadlineDash.card.networkingRecruiterPoached.name",
        effectTypes: ["payResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.embarrassing-story",
        nameKey: "deadlineDash.card.networkingEmbarrassingStory.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.loud-speaker",
        nameKey: "deadlineDash.card.networkingLoudSpeaker.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.reply-all",
        nameKey: "deadlineDash.card.networkingReplyAll.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.camera-still-on",
        nameKey: "deadlineDash.card.networkingCameraStillOn.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.mute-button",
        nameKey: "deadlineDash.card.networkingMuteButton.name",
        effectTypes: ["applyStatus", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.passive-aggressive-email",
        nameKey: "deadlineDash.card.networkingPassiveAggressiveEmail.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.buzzword-overload",
        nameKey: "deadlineDash.card.networkingBuzzwordOverload.name",
        effectTypes: ["chooseOne"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.open-to-work",
        nameKey: "deadlineDash.card.networkingOpenToWork.name",
        effectTypes: ["chooseOne"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.coffee-machine-gossip",
        nameKey: "deadlineDash.card.networkingCoffeeMachineGossip.name",
        effectTypes: ["chooseOne", "modifyHeat"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.team-building-games",
        nameKey: "deadlineDash.card.networkingTeamBuildingGames.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.conference-selfie",
        nameKey: "deadlineDash.card.networkingConferenceSelfie.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.networking-overload",
        nameKey: "deadlineDash.card.networkingNetworkingOverload.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.hr-takes-attendance",
        nameKey: "deadlineDash.card.networkingHrTakesAttendance.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.after-party",
        nameKey: "deadlineDash.card.networkingAfterParty.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.corporate-bingo-champion",
        nameKey: "deadlineDash.card.networkingCorporateBingoChampion.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.can-everyone-hear-me",
        nameKey: "deadlineDash.card.networkingCanEveryoneHearMe.name",
        effectTypes: ["skipTurns", "modifyHeat"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.budget-freeze",
        nameKey: "deadlineDash.card.boardMeetingBudgetFreeze.name",
        effectTypes: ["payResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.company-restructuring",
        nameKey: "deadlineDash.card.boardMeetingCompanyRestructuring.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.annual-bonus-approved",
        nameKey: "deadlineDash.card.boardMeetingAnnualBonusApproved.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.extra-leave-approved",
        nameKey: "deadlineDash.card.boardMeetingExtraLeaveApproved.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.promotion-season",
        nameKey: "deadlineDash.card.boardMeetingPromotionSeason.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.record-profit-sharing",
        nameKey: "deadlineDash.card.boardMeetingRecordProfitSharing.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.four-day-work-week-pilot",
        nameKey: "deadlineDash.card.boardMeetingFourDayWorkWeekPilot.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.cost-optimization",
        nameKey: "deadlineDash.card.boardMeetingCostOptimization.name",
        effectTypes: ["payResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.hiring-freeze",
        nameKey: "deadlineDash.card.boardMeetingHiringFreeze.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.mandatory-overtime",
        nameKey: "deadlineDash.card.boardMeetingMandatoryOvertime.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.new-kpi",
        nameKey: "deadlineDash.card.boardMeetingNewKpi.name",
        effectTypes: ["incrementWorkCounter", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.parking-fee",
        nameKey: "deadlineDash.card.boardMeetingParkingFee.name",
        effectTypes: ["payResource", "payResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.budget-reallocation",
        nameKey: "deadlineDash.card.boardMeetingBudgetReallocation.name",
        effectTypes: ["payResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.office-relocation",
        nameKey: "deadlineDash.card.boardMeetingOfficeRelocation.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.mandatory-training",
        nameKey: "deadlineDash.card.boardMeetingMandatoryTraining.name",
        effectTypes: ["modifyResource", "incrementWorkCounter"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.monthly-reporting",
        nameKey: "deadlineDash.card.boardMeetingMonthlyReporting.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.cost-saving-initiative",
        nameKey: "deadlineDash.card.boardMeetingCostSavingInitiative.name",
        effectTypes: ["transferResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.ai-transformation",
        nameKey: "deadlineDash.card.boardMeetingAiTransformation.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.matrix-organization",
        nameKey: "deadlineDash.card.boardMeetingMatrixOrganization.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.return-to-office",
        nameKey: "deadlineDash.card.boardMeetingReturnToOffice.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.performance-calibration",
        nameKey: "deadlineDash.card.boardMeetingPerformanceCalibration.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.approval-workflow",
        nameKey: "deadlineDash.card.boardMeetingApprovalWorkflow.name",
        effectTypes: ["modifyResource", "payResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.executive-offsite",
        nameKey: "deadlineDash.card.boardMeetingExecutiveOffsite.name",
        effectTypes: ["payResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.performance-bonus",
        nameKey: "deadlineDash.card.annualEventPerformanceBonus.name",
        effectTypes: ["gainSalary"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.raffle-jackpot",
        nameKey: "deadlineDash.card.annualEventRaffleJackpot.name",
        effectTypes: ["rollCheck"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.employee-appreciation-awards",
        nameKey: "deadlineDash.card.annualEventEmployeeAppreciationAwards.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.company-trip",
        nameKey: "deadlineDash.card.annualEventCompanyTrip.name",
        effectTypes: ["restoreResourceToMaximum", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.holiday-bonus",
        nameKey: "deadlineDash.card.annualEventHolidayBonus.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.karaoke-disaster",
        nameKey: "deadlineDash.card.annualEventKaraokeDisaster.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.grand-lucky-draw",
        nameKey: "deadlineDash.card.annualEventGrandLuckyDraw.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.annual-dinner",
        nameKey: "deadlineDash.card.annualEventAnnualDinner.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.company-anniversary",
        nameKey: "deadlineDash.card.annualEventCompanyAnniversary.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.family-day",
        nameKey: "deadlineDash.card.annualEventFamilyDay.name",
        effectTypes: ["modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.sports-day-champion",
        nameKey: "deadlineDash.card.annualEventSportsDayChampion.name",
        effectTypes: ["rollCheck"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.ceo-treat",
        nameKey: "deadlineDash.card.annualEventCeoTreat.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.karaoke-night",
        nameKey: "deadlineDash.card.annualEventKaraokeNight.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.best-costume-award",
        nameKey: "deadlineDash.card.annualEventBestCostumeAward.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.secret-santa",
        nameKey: "deadlineDash.card.annualEventSecretSanta.name",
        effectTypes: ["transferResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.team-building-success",
        nameKey: "deadlineDash.card.annualEventTeamBuildingSuccess.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.free-merchandise",
        nameKey: "deadlineDash.card.annualEventFreeMerchandise.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.fireworks-celebration",
        nameKey: "deadlineDash.card.annualEventFireworksCelebration.name",
        effectTypes: ["modifyResource", "modifyResource", "modifyHeat"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.appreciation-speech",
        nameKey: "deadlineDash.card.annualEventAppreciationSpeech.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.buffet-food-poisoning",
        nameKey: "deadlineDash.card.annualEventBuffetFoodPoisoning.name",
        effectTypes: ["rollCheck"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.lucky-draw-mix-up",
        nameKey: "deadlineDash.card.annualEventLuckyDrawMixUp.name",
        effectTypes: ["transferResource", "modifyHeat"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.rainy-outdoor-event",
        nameKey: "deadlineDash.card.annualEventRainyOutdoorEvent.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.budget-overrun",
        nameKey: "deadlineDash.card.annualEventBudgetOverrun.name",
        effectTypes: ["payResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.holiday-bonus-deferred",
        nameKey: "deadlineDash.card.annualEventHolidayBonusDeferred.name",
        effectTypes: ["applyStatus"],
      },
    ]);
  });
});
