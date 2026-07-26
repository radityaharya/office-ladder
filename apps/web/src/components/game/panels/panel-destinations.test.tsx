import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EffectDescriptor } from "@office-ladder/content";

import { ActivityPanel, type ActivityPanelEntry } from "./activity-panel";
import { AgreementsPanel, type AgreementPanelItem } from "./agreements-panel";
import { BallotsPanel, type BallotPanelItem } from "./ballots-panel";
import { ChatPanel, type ChatMessageView } from "./chat-panel";
import { EventsPanel, type EventFeedItem } from "./events-panel";
import { HandPanel, type HandCardView, type OpponentHandCount } from "./hand-panel";
import { HeatPanel, type HeatSelfReadout } from "./heat-panel";
import { MarketPanel, type MarketLot } from "./market-panel";
import { ObjectivesPanel, type ObjectivePanelItem } from "./objectives-panel";
import { ProjectsPanel, type ProjectPanelItem } from "./projects-panel";
import { QuarterPanel, type QuarterStep } from "./quarter-panel";
import { SeatsPanel, type SeatPanelRow } from "./seats-panel";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const EFFECTS: readonly EffectDescriptor[] = [
  { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
  { type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true },
];

const HAND: readonly HandCardView[] = [
  {
    instanceId: "card-instance-1",
    definitionId: "card.work.crunch-time",
    deckId: "deck.work",
    copy: {
      name: "Crunch Time",
      nameSource: "authored",
      flavor: "The deadline moved. Again.",
      deckName: "Work",
    },
    effects: EFFECTS,
    playable: true,
    blockedReason: null,
  },
  {
    instanceId: "card-instance-2",
    definitionId: "card.event.reorg",
    deckId: "deck.event",
    copy: { name: "Reorg", nameSource: "derived", flavor: null, deckName: "Event" },
    effects: [],
    playable: false,
    blockedReason: "Only playable on another player's turn.",
  },
];

const OPPONENTS: readonly OpponentHandCount[] = [
  { seat: 2, name: "Morgan", cardCount: 3 },
  { seat: 3, name: "Contract Auditor", cardCount: 1 },
];

const SEATS: readonly SeatPanelRow[] = [
  {
    playerId: "p1",
    seat: 1,
    name: "Avery",
    rankLabel: "Analyst",
    tileLabel: "07",
    money: 1200,
    presence: "online",
    active: true,
    self: true,
  },
  {
    playerId: "p2",
    seat: 2,
    name: "Morgan",
    rankLabel: "Associate",
    tileLabel: "13",
    money: 800,
    presence: "away",
    active: false,
    self: false,
  },
  {
    playerId: "p3",
    seat: 3,
    name: "Contract Auditor",
    rankLabel: "Analyst",
    tileLabel: "02",
    money: 400,
    presence: "bot",
    active: false,
    self: false,
  },
];

const ENTRIES: readonly ActivityPanelEntry[] = [
  {
    id: "event-2",
    revision: 12,
    occurredAt: "2026-07-26T09:41:07.000Z",
    text: "Avery passed reception and collected salary.",
    delta: { amount: 300 },
    origin: "local",
    slot: 1,
    eventType: "SalaryAwarded",
  },
  {
    id: "event-1",
    revision: 11,
    occurredAt: "2026-07-26T09:40:55.000Z",
    text: "Morgan lost 2 energy.",
    delta: { amount: -2, unit: "energy" },
    origin: "remote",
    slot: 2,
    eventType: "ResourceChanged",
  },
];

const PROJECTS: readonly ProjectPanelItem[] = [
  {
    id: "project-1",
    title: "Q3 platform migration",
    leadName: "Avery",
    leadSeat: 1,
    status: "open",
    money: { committed: 500, required: 2000 },
    work: { committed: 3, required: 8 },
    deadlineRound: 9,
    contributorCount: 2,
    openToJoin: true,
    yourMoney: 500,
    revealedSabotage: [],
  },
];

describe("every destination renders at rest", () => {
  it("renders the seat roster with rank, tile, cash and presence", () => {
    // When
    const markup = renderToStaticMarkup(<SeatsPanel capacity={6} seats={SEATS} />);

    // Then
    expect(markup).toContain('data-panel-id="seats"');
    expect(markup).toContain("3/6");
    expect(markup.match(/data-slot="panel-seat-row"/g) ?? []).toHaveLength(3);
    expect(markup).toContain("Avery (you)");
    expect(markup).toContain("Analyst");
    expect(markup).toContain("Tile 07");
    expect(markup).toContain("$1,200");
    expect(markup).toContain("Online");
    expect(markup).toContain("Away");
    expect(markup).toContain("Bot");
  });

  it("renders the activity log with an origin stamp and a signed delta", () => {
    // When
    const markup = renderToStaticMarkup(<ActivityPanel entries={ENTRIES} revision={12} />);

    // Then
    expect(markup).toContain("1 you · 2 all · R12");
    expect(markup).toContain("+300");
    expect(markup).toContain("-2 energy");
    expect(markup).toContain(">You<");
    expect(markup).toContain(">S2<");
    expect(markup).toContain('data-panel-origin="local"');
    expect(markup).toContain('data-panel-origin="remote"');
  });

  it("renders the event feed as records rather than as alerts", () => {
    // Given
    const items: readonly EventFeedItem[] = [
      {
        id: "feed-1",
        kind: "card",
        audience: "mine",
        title: "Overtime Authorized",
        source: "Work deck",
        actorName: "Avery",
        actorSeat: 1,
        summary: "Gain $150.",
        occurredAt: "2026-07-26T09:41:07.000Z",
      },
      {
        id: "feed-2",
        kind: "global-event",
        audience: "office",
        title: "Budget freeze",
        source: "Q2",
        actorName: null,
        actorSeat: null,
        summary: "No promotions until the quarter closes.",
        occurredAt: "2026-07-26T09:30:00.000Z",
      },
    ];

    // When
    const markup = renderToStaticMarkup(<EventsPanel items={items} />);

    // Then
    expect(markup).toContain("Overtime Authorized");
    expect(markup).toContain("Budget freeze");
    expect(markup).toContain("Already applied when you read it.");
    expect(markup).toContain('data-panel-origin="system"');
  });

  it("renders the hand as a scrollable row of cards", () => {
    // When
    const markup = renderToStaticMarkup(
      <HandPanel cards={HAND} handLimit={5} opponents={OPPONENTS} />,
    );

    // Then — a row, not a list of rows.
    expect(markup).toContain('data-slot="panel-hand"');
    expect(markup.match(/data-slot="panel-hand-card"/g) ?? []).toHaveLength(2);
    expect(markup).toContain("2/5");
    expect(markup).toContain("Crunch Time");
    expect(markup).toContain("Work deck");
    // Effect copy comes from the card module's own readout, not a second one.
    expect(markup).toContain("Gain $200.");
    expect(markup).toContain("+200");
    expect(markup).toContain("Lose 2 energy.");
    expect(markup).toContain("MONEY");
  });

  it("states why a held card cannot be played instead of only dimming it", () => {
    // When
    const markup = renderToStaticMarkup(<HandPanel cards={HAND} opponents={[]} />);

    // Then
    expect(markup).toContain('data-playable="false"');
    expect(markup).toContain("Only playable on another player&#x27;s turn.");
    expect(markup).toContain("No mechanical effect.");
  });

  it("renders projects with both meters and their numbers", () => {
    // When
    const markup = renderToStaticMarkup(<ProjectsPanel projects={PROJECTS} round={6} />);

    // Then
    expect(markup).toContain("Q3 platform migration");
    expect(markup).toContain("$500 / $2,000");
    expect(markup).toContain("3 / 8");
    expect(markup).toContain("3 rounds left");
    expect(markup).toContain("2 backers");
  });

  it("renders the market with an open lot's standing bid", () => {
    // Given
    const lots: readonly MarketLot[] = [
      {
        id: "lot-1",
        title: "Corner office (tile 12)",
        kind: "tile",
        closesAtRound: 8,
        yourBid: 400,
        visibility: "open",
        standingBid: { seat: 2, name: "Morgan", amount: 600 },
      },
    ];

    // When
    const markup = renderToStaticMarkup(<MarketPanel lots={lots} round={6} />);

    // Then
    expect(markup).toContain("Corner office (tile 12)");
    expect(markup).toContain("$600 — Morgan");
    expect(markup).toContain("You $400");
    expect(markup).toContain("Closes in 2 rounds");
  });

  it("renders agreements and badges the ones waiting on you", () => {
    // Given
    const agreements: readonly AgreementPanelItem[] = [
      {
        id: "agreement-1",
        proposerName: "Morgan",
        proposerSeat: 2,
        recipientNames: ["Avery"],
        status: "offered",
        expiresAtRound: 8,
        awaitingYou: true,
        disclosure: "visible",
        give: [{ label: "$400", detail: "Cash up front", enforced: true }],
        receive: [
          { label: "Promise", detail: "No sabotage for two rounds", enforced: false },
        ],
      },
    ];

    // When
    const markup = renderToStaticMarkup(
      <AgreementsPanel agreements={agreements} round={6} />,
    );

    // Then
    expect(markup).toContain("Morgan → Avery");
    expect(markup).toContain("Gives $400; receives Promise (not enforced).");
    expect(markup).toContain('data-slot="panel-attention"');
    expect(markup).toContain("1 offer waiting on your answer.");
    expect(markup).toContain("Promises are not");
  });

  it("renders an open ballot's casts and badges an uncast one", () => {
    // Given
    const ballots: readonly BallotPanelItem[] = [
      {
        id: "ballot-1",
        subject: "Block Avery's promotion?",
        kind: "vote",
        closesAtRound: 7,
        audienceCount: 3,
        youMayCast: true,
        yourCast: null,
        visibility: "open",
        casts: [{ seat: 2, name: "Morgan", value: "Yes" }],
      },
    ];

    // When
    const markup = renderToStaticMarkup(<BallotsPanel ballots={ballots} round={6} />);

    // Then
    expect(markup).toContain("Morgan: Yes");
    expect(markup).toContain("You have not cast");
    expect(markup).toContain("1 ballot still waiting on your cast.");
  });

  it("renders objectives with progress and their reward", () => {
    // Given
    const objectives: readonly ObjectivePanelItem[] = [
      {
        kind: "visible",
        id: "objective-1",
        title: "Bank $5,000",
        detail: "Hold five thousand at any point before the last quarter closes.",
        progress: 1200,
        target: 5000,
        rewardPoints: 4,
        rewardMoney: 0,
        ownerName: "Avery",
        ownerSeat: 1,
        completedAtRound: null,
        secret: true,
      },
    ];

    // When
    const markup = renderToStaticMarkup(<ObjectivesPanel objectives={objectives} />);

    // Then
    expect(markup).toContain("Bank $5,000");
    expect(markup).toContain("1,200 / 5,000");
    expect(markup).toContain("4 points");
    expect(markup).toContain("Yours only");
  });

  it("renders heat as a single readout that sizes to its content", () => {
    // Given
    const self: HeatSelfReadout = {
      value: 6,
      threshold: 5,
      investigationsOpened: 1,
      lastIncrementedAtRound: 5,
    };

    // When
    const markup = renderToStaticMarkup(
      <HeatPanel
        seats={[
          { seat: 1, name: "Avery", value: 6, threshold: 5, underInvestigation: true },
          { seat: 2, name: "Morgan", value: 0, threshold: 5, underInvestigation: false },
        ]}
        self={self}
      />,
    );

    // Then
    expect(markup).toContain('data-panel-sizing="content"');
    expect(markup).toContain("At or over threshold");
    expect(markup).toContain("Under review");
    expect(markup).toContain("1 investigation open against you.");
    expect(markup).toContain('data-state="over"');
  });

  it("renders the quarter track with the current quarter marked", () => {
    // Given
    const quarters: readonly QuarterStep[] = [
      {
        index: 0,
        label: "Q1",
        startsAtRound: 1,
        endsAtRound: 4,
        state: "past",
        scheduledEventLabel: "Audit season",
        resolvedEventLabels: ["Audit season"],
      },
      {
        index: 1,
        label: "Q2",
        startsAtRound: 5,
        endsAtRound: 8,
        state: "current",
        scheduledEventLabel: "Budget freeze",
        resolvedEventLabels: [],
      },
      {
        index: 2,
        label: "Q3",
        startsAtRound: 9,
        endsAtRound: 12,
        state: "future",
        scheduledEventLabel: null,
        resolvedEventLabels: [],
      },
    ];

    // When
    const markup = renderToStaticMarkup(
      <QuarterPanel
        announcement={{
          quarterLabel: "Q3",
          title: "Layoffs",
          detail: "The lowest-ranked seat loses a rank when the quarter opens.",
          startsAtRound: 9,
        }}
        quarters={quarters}
        round={6}
      />,
    );

    // Then
    expect(markup).toContain('data-panel-state="current"');
    expect(markup).toContain("R5–8");
    expect(markup).toContain("Budget freeze");
    expect(markup).toContain("Next quarter (Q3): Layoffs.");
    // A quarter with no scheduled event still reserves the line, so gaining one
    // cannot change the track's height.
    expect(markup.match(/data-slot="panel-track-event"/g) ?? []).toHaveLength(3);
  });

  it("renders chat with a message list", () => {
    // Given
    const messages: readonly ChatMessageView[] = [
      {
        id: "message-1",
        authorName: "Morgan",
        seat: 2,
        origin: "remote",
        kind: "text",
        body: "Fund my project and I will leave your tiles alone.",
        sentAt: "2026-07-26T09:41:07.000Z",
      },
      {
        id: "message-2",
        authorName: "Avery",
        seat: 1,
        origin: "local",
        kind: "quick",
        body: "No deal",
        sentAt: "2026-07-26T09:41:40.000Z",
      },
    ];

    // When
    const markup = renderToStaticMarkup(<ChatPanel messages={messages} mode="full" />);

    // Then
    expect(markup.match(/data-slot="panel-chat-message"/g) ?? []).toHaveLength(2);
    expect(markup).toContain("Fund my project and I will leave your tiles alone.");
    expect(markup).toContain('data-panel-kind="quick"');
    expect(markup).toContain("09:41");
    expect(markup).toContain(">You<");
  });
});

describe("every destination has a real empty state", () => {
  const empties: readonly (readonly [string, string, string])[] = [
    [
      "seats",
      renderToStaticMarkup(<SeatsPanel capacity={6} seats={[]} />),
      "No seats filled",
    ],
    [
      "activity",
      renderToStaticMarkup(<ActivityPanel entries={[]} />),
      "No entries committed",
    ],
    ["events", renderToStaticMarkup(<EventsPanel items={[]} />), "Nothing issued yet"],
    [
      "hand",
      renderToStaticMarkup(<HandPanel cards={[]} opponents={[]} />),
      "Holding no cards",
    ],
    [
      "projects",
      renderToStaticMarkup(<ProjectsPanel projects={[]} round={1} />),
      "No projects on the floor",
    ],
    [
      "market",
      renderToStaticMarkup(<MarketPanel lots={[]} round={1} />),
      "Nothing on the market",
    ],
    [
      "agreements",
      renderToStaticMarkup(<AgreementsPanel agreements={[]} round={1} />),
      "No agreements on record",
    ],
    [
      "ballots",
      renderToStaticMarkup(<BallotsPanel ballots={[]} round={1} />),
      "No ballot open",
    ],
    [
      "objectives",
      renderToStaticMarkup(<ObjectivesPanel objectives={[]} />),
      "No objectives assigned",
    ],
    ["heat", renderToStaticMarkup(<HeatPanel seats={[]} self={null} />), "Heat is off in this mode"],
    [
      "chat",
      renderToStaticMarkup(<ChatPanel messages={[]} mode="quick" />),
      "No messages yet",
    ],
    [
      "quarter",
      renderToStaticMarkup(<QuarterPanel announcement={null} quarters={[]} round={1} />),
      "This mode runs no quarters",
    ],
  ];

  it("covers all twelve destinations", () => {
    expect(empties).toHaveLength(12);
  });

  for (const [id, markup, headline] of empties) {
    it(`teaches the player what ${id} is for before there is any data`, () => {
      // Then — an empty state is the first thing a new player reads, so it must
      // be real copy rather than "no data": a headline, the panel's purpose, and
      // what will appear here.
      expect(markup).toContain('data-slot="panel-empty"');
      expect(markup).toContain(headline);
      const copy = markup.match(/class="panel-empty-copy">([^<]+)</g) ?? [];
      expect(copy.length).toBeGreaterThanOrEqual(2);
      for (const line of copy) {
        expect(line.replace(/^[^>]*>/, "").length).toBeGreaterThan(40);
      }
    });
  }
});

describe("mounting into a host that draws its own panel chrome", () => {
  it("drops every destination's own header when chrome is off", () => {
    // Given — `turn-rail.tsx`'s `RailPanel` already draws a header with the
    // destination's title, so a nested second header would duplicate the title
    // and put two headings in one region.
    const hosted = [
      renderToStaticMarkup(<SeatsPanel capacity={6} chrome="none" seats={SEATS} />),
      renderToStaticMarkup(<ActivityPanel chrome="none" entries={ENTRIES} />),
      renderToStaticMarkup(<HandPanel cards={HAND} chrome="none" opponents={OPPONENTS} />),
      renderToStaticMarkup(<ChatPanel chrome="none" messages={[]} mode="quick" />),
      renderToStaticMarkup(<HeatPanel chrome="none" seats={[]} self={null} />),
    ];

    // Then — the content is there, the chrome is not.
    for (const markup of hosted) {
      expect(markup).not.toContain('data-slot="panel-head"');
      expect(markup).not.toContain('data-slot="panel"');
      expect(markup.length).toBeGreaterThan(0);
    }
    expect(hosted[0]).toContain("Avery (you)");
    expect(hosted[2]).toContain("Other seats show a count only.");
    expect(hosted[3]).toContain('data-slot="panel-chat-quick"');
  });
});

describe("hidden information is withheld at the presentation boundary", () => {
  it("shows another player's hand as a count and nothing else", () => {
    // When
    const markup = renderToStaticMarkup(<HandPanel cards={HAND} opponents={OPPONENTS} />);

    // Then
    expect(markup).toContain("Morgan · 3 cards");
    expect(markup).toContain("Contract Auditor · 1 card");
    expect(markup).toContain("Other seats show a count only.");

    // And — the props carry no card identity for an opponent, so there is
    // nothing in the tree that COULD have leaked one.
    const opponent: OpponentHandCount = {
      seat: 2,
      name: "Morgan",
      cardCount: 3,
      // @ts-expect-error an opponent's hand is a count; there is no field for a card
      cardIds: ["card.work.crunch-time"],
    };
    expect(Object.keys(opponent)).toContain("cardCount");
  });

  it("shows another player's secret objective as existence only", () => {
    // Given
    const objectives: readonly ObjectivePanelItem[] = [
      { kind: "concealed", id: "objective-9", ownerName: "Morgan", ownerSeat: 2 },
    ];

    // When
    const markup = renderToStaticMarkup(<ObjectivesPanel objectives={objectives} />);

    // Then
    expect(markup).toContain("Morgan holds a secret objective");
    expect(markup).toContain("Held in confidence.");
    expect(markup).toContain('data-slot="panel-objective-concealed"');
    // The concealed member of the union has no title, progress or target to
    // render — a later wave cannot describe it without changing the type.
    expect(markup).not.toContain('data-slot="panel-meter-row"');
  });

  it("shows a sealed ballot as a count with no cast attributable to anyone", () => {
    // Given
    const ballots: readonly BallotPanelItem[] = [
      {
        id: "ballot-2",
        subject: "Corner office lot",
        kind: "auction",
        closesAtRound: 7,
        audienceCount: 4,
        youMayCast: true,
        yourCast: "$400",
        visibility: "sealed",
        castCount: 2,
      },
    ];

    // When
    const markup = renderToStaticMarkup(<BallotsPanel ballots={ballots} round={6} />);

    // Then — §7.2 forbids leaking in-flight votes "including via castBy keys",
    // so not even the identity of who has already answered may appear.
    expect(markup).toContain("2 casts of 4 in, all hidden until close.");
    expect(markup).toContain("Sealed");
    expect(markup).toContain("You cast $400");
    expect(markup).not.toContain("Morgan");
  });

  it("shows a sealed market lot with no standing bid to reveal", () => {
    // Given
    const lots: readonly MarketLot[] = [
      {
        id: "lot-2",
        title: "Sealed contract",
        kind: "contract",
        closesAtRound: 7,
        yourBid: null,
        visibility: "sealed",
        bidCount: 3,
      },
    ];

    // When
    const markup = renderToStaticMarkup(<MarketPanel lots={lots} round={6} />);

    // Then
    expect(markup).toContain("3 bids");
    expect(markup).toContain("Bids hidden until close");
    expect(markup).toContain("No bid from you");
  });

  it("shows a parties-only agreement's existence without its terms", () => {
    // Given
    const agreements: readonly AgreementPanelItem[] = [
      {
        id: "agreement-2",
        proposerName: "Morgan",
        proposerSeat: 2,
        recipientNames: ["Contract Auditor"],
        status: "accepted",
        expiresAtRound: 9,
        awaitingYou: false,
        disclosure: "parties-only",
      },
    ];

    // When
    const markup = renderToStaticMarkup(
      <AgreementsPanel agreements={agreements} round={6} />,
    );

    // Then
    expect(markup).toContain("Morgan → Contract Auditor");
    expect(markup).toContain("Terms are between the parties.");
    expect(markup).not.toContain("Gives ");
  });

  it("has no field for hidden sabotage, so a project cannot hint at one", () => {
    // Then — spec §5.2 reveals sabotage only on resolution, so before that even
    // its existence is unprojectable. A count would give the lead exactly what
    // the mechanic exists to withhold.
    const project: ProjectPanelItem = {
      ...PROJECTS[0]!,
      // @ts-expect-error hidden sabotage is not projected until resolution
      hiddenSabotageCount: 1,
    };
    expect(project.revealedSabotage).toEqual([]);

    const markup = renderToStaticMarkup(<ProjectsPanel projects={PROJECTS} round={6} />);
    expect(markup).not.toContain("Sabotaged by");
  });
});

describe("chat modes", () => {
  it("gives full mode a free-text composer and the phrase set", () => {
    // When
    const markup = renderToStaticMarkup(<ChatPanel messages={[]} mode="full" />);

    // Then
    expect(markup).toContain('data-slot="panel-chat-composer"');
    expect(markup).toContain('data-slot="panel-chat-field"');
    expect(markup).toContain('data-slot="panel-chat-send"');
    expect(markup).toContain('data-slot="panel-chat-counter"');
    expect(markup).toContain("0/240");
    expect(markup).toContain('data-slot="panel-chat-quick"');
    expect(markup).toContain('data-phrase-id="phrase.deal"');
  });

  it("gives quick mode the phrase set and no free-text field at all", () => {
    // When — the same surface a bot seat uses (spec §8.1).
    const markup = renderToStaticMarkup(<ChatPanel messages={[]} mode="quick" />);

    // Then
    expect(markup).not.toContain('data-slot="panel-chat-field"');
    expect(markup).not.toContain('data-slot="panel-chat-composer"');
    expect(markup).toContain('data-slot="panel-chat-quick"');
    expect(markup.match(/data-slot="panel-chat-phrase"/g) ?? []).toHaveLength(8);
  });

  it("explains an off mode instead of rendering an inert box", () => {
    // When
    const markup = renderToStaticMarkup(<ChatPanel messages={[]} mode="off" />);

    // Then
    expect(markup).toContain("Chat is off in this mode");
    expect(markup).not.toContain('data-slot="panel-chat-quick"');
    expect(markup).toContain('data-panel-sizing="content"');
  });

  it("states a rate limit or mute in words and disables every control", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel
        disabledReason="You are sending messages too quickly. Try again in a moment."
        messages={[]}
        mode="full"
        onQuickSend={() => undefined}
        onSend={() => undefined}
      />,
    );

    // Then — a dead field with no explanation reads as a bug (§5's disabled
    // state: present and legible-as-inert, never silently unavailable).
    expect(markup).toContain("You are sending messages too quickly.");
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it("carries no recipient selector, because DMs are deliberately not in v1", () => {
    // When
    const markup = renderToStaticMarkup(<ChatPanel messages={[]} mode="full" />);

    // Then
    expect(markup).not.toContain("<select");
    expect(markup).toContain("Chat is not game state.");
  });
});
