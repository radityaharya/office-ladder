import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";
import type {
  BallotProjection,
  CallerSelfProjection,
  GameplayBootstrap,
  GameplayProjection,
  LegalActionSummary,
  PublicGameProjection,
  PublicPlayerGameplayProjection,
  RoomProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";

import { AgreementsPanel } from "./agreements-panel";
import { BallotsPanel } from "./ballots-panel";
import { EventsPanel } from "./events-panel";
import { HandPanel } from "./hand-panel";
import { HeatPanel } from "./heat-panel";
import { MarketPanel } from "./market-panel";
import { ObjectivesPanel } from "./objectives-panel";
import {
  createPanelViewerContext,
  derivePanelBallots,
  derivePanelData,
  derivePanelHand,
  derivePanelMarketLots,
  derivePanelObjectives,
} from "./panel-data";
import { ProjectsPanel } from "./projects-panel";
import { QuarterPanel } from "./quarter-panel";
import { SeatsPanel } from "./seats-panel";

/* -------------------------------------------------------------------------- */
/* Fixture                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * The ruleset comes from the real content pack rather than a hand-written literal.
 * A hand-written `ModeRules` would drift from the shipped presets silently, and
 * every switch in the derivation reads it — `heatEnabled`, `handEnabled`,
 * `projects.joinable`. Using `mode.standard` means these tests exercise the
 * ruleset a real room is actually created with.
 */
const RULES = deadlineDashContent.modes["mode.standard"].rules;

const SELF_ID = "player-avery";
const RIVAL_ID = "player-morgan";
const BOT_ID = "player-auditor";

const ROOM: RoomProjection = {
  id: "room-1",
  code: "ABC123",
  status: "active",
  mode: "mode.standard",
  capacity: 4,
  revision: 12,
  members: [
    {
      id: SELF_ID,
      displayName: "Avery",
      seat: 1,
      isHost: true,
      isReady: true,
      isConnected: true,
      isBot: false,
      botDifficulty: null,
      avatarUrl: "https://cdn.example.com/avery.png",
      characterId: "character.workaholic",
      characterLabel: "Workaholic",
    },
    {
      id: RIVAL_ID,
      displayName: "Morgan",
      seat: 2,
      isHost: false,
      isReady: true,
      isConnected: false,
      isBot: false,
      botDifficulty: null,
      avatarUrl: null,
      characterId: "character.social-butterfly",
      characterLabel: "Social Butterfly",
    },
    {
      id: BOT_ID,
      displayName: "Contract Auditor",
      seat: 3,
      isHost: false,
      isReady: true,
      isConnected: true,
      isBot: true,
      botDifficulty: "standard",
      avatarUrl: null,
      characterId: "character.office-politician",
      characterLabel: "Office Politician",
    },
  ],
};

function player(
  id: string,
  overrides: Partial<PublicGameProjection["players"][number]> = {},
): PublicGameProjection["players"][number] {
  return {
    id,
    seat: 0,
    connected: true,
    position: 6,
    lapsCompleted: 1,
    rank: { id: "rank.analyst", kind: "rank.analyst", index: 0 },
    role: { revealed: false },
    resources: { money: 1200, reputation: 4, energy: 6, "work-counter": 3 },
    tokens: { move: 1 },
    statusIds: [],
    ...overrides,
  };
}

const EVENTS: readonly SafeEventSummary[] = [
  {
    id: "event-1",
    type: "TurnStarted",
    revision: 10,
    occurredAt: "2026-07-26T09:40:00.000Z",
    actorPlayerId: SELF_ID,
  },
  {
    id: "event-2",
    type: "CardDrawn",
    revision: 11,
    occurredAt: "2026-07-26T09:40:30.000Z",
    actorPlayerId: SELF_ID,
    card: {
      definitionId: "card.work.overtime-bonus",
      deckId: "deck.work",
      nameKey: "deadlineDash.card.workOvertimeBonus.name",
    },
  },
  {
    id: "event-3",
    type: "PlayerPromoted",
    revision: 12,
    occurredAt: "2026-07-26T09:41:00.000Z",
    actorPlayerId: RIVAL_ID,
  },
];

const PUBLIC_PROJECTION: PublicGameProjection = {
  id: "game-1",
  revision: 12,
  status: "active",
  activePlayerId: SELF_ID,
  turnNumber: 17,
  round: 6,
  phase: "turn",
  deadlineAt: "2026-07-26T09:41:20.000Z",
  turnTimerDurationMs: 25_000,
  players: [
    player(SELF_ID),
    player(RIVAL_ID, {
      connected: false,
      position: 12,
      rank: { id: "rank.associate", kind: "rank.associate", index: 1 },
      resources: { money: 800, reputation: 6, energy: 4, "work-counter": 1 },
    }),
    player(BOT_ID, { position: 1, resources: { money: 400, reputation: 1, energy: 8 } }),
  ],
  eventSummaries: EVENTS,
  winnerPlayerIds: [],
};

const SELF: CallerSelfProjection = {
  playerId: SELF_ID,
  role: { id: "role-1", kind: "role.worker", revealed: false },
  characterId: "character.workaholic",
  hand: [
    { id: "instance-1", definitionId: "card.work.overtime-bonus" },
    { id: "instance-2", definitionId: "card.work.printer-jam" },
  ],
  privateStatusIds: [],
  abilityIds: [],
};

function economy(
  playerId: string,
  overrides: Partial<PublicPlayerGameplayProjection> = {},
): PublicPlayerGameplayProjection {
  return {
    playerId,
    handCount: 2,
    heat: { value: 1, threshold: 5, investigationsOpened: 0, lastIncrementedAtRound: 4 },
    upkeep: { perRound: 80, lastChargedRound: 5, missedPayments: 0 },
    loans: [],
    incomeStreams: [],
    ...overrides,
  };
}

const OPEN_VOTE: BallotProjection = {
  visibility: "open",
  id: "ballot-vote",
  kind: "vote",
  subjectId: "promotion.block-avery",
  subject: { question: "Block Avery's promotion?" },
  audience: [SELF_ID, RIVAL_ID, BOT_ID],
  castBy: { [RIVAL_ID]: "yes" },
  deadlineAt: null,
  closesAtRound: 7,
  resolution: null,
};

const SEALED_AUCTION: BallotProjection = {
  visibility: "sealed",
  id: "ballot-auction",
  kind: "auction",
  subjectId: "tile.board.corner-office",
  subject: { title: "Corner office (tile 12)", kind: "tile" },
  audience: [SELF_ID, RIVAL_ID, BOT_ID],
  castCount: 2,
  viewerHasCast: true,
  deadlineAt: null,
  closesAtRound: 8,
  resolution: null,
};

const OPEN_AUCTION: BallotProjection = {
  visibility: "open",
  id: "ballot-open-auction",
  kind: "auction",
  subjectId: "favour.parking-space",
  subject: {},
  audience: [SELF_ID, RIVAL_ID],
  castBy: { [RIVAL_ID]: 600, [SELF_ID]: 400 },
  deadlineAt: null,
  closesAtRound: 9,
  resolution: null,
};

const GAMEPLAY: GameplayProjection = {
  rules: RULES,
  tileOwnership: [
    { tileId: "tile.board.corner-office", ownerId: RIVAL_ID, level: 1, claimedAtRound: 3, tollPaidCount: 2 },
  ],
  placements: [],
  projects: [
    {
      id: "project-1",
      definitionId: "project.platform-migration",
      leadPlayerId: SELF_ID,
      tileId: "tile.board.work-1",
      status: "open",
      requiredMoney: 2000,
      requiredWork: 8,
      contributedMoney: 500,
      contributedWork: 3,
      contributions: [
        { playerId: SELF_ID, money: 400, work: 2, atRound: 4 },
        { playerId: SELF_ID, money: 100, work: 0, atRound: 5 },
        { playerId: RIVAL_ID, money: 0, work: 1, atRound: 5 },
      ],
      // Only revealed entries ever reach the client; an unresolved hidden
      // sabotage by anyone else is absent from this array by construction.
      sabotage: [],
      deadlineRound: 9,
      payout: { money: 3000, reputation: 4, objectiveProgress: 2 },
      openToJoin: true,
      leadBonusBasisPoints: 1500,
    },
  ],
  agreements: [
    {
      id: "agreement-public",
      proposerId: RIVAL_ID,
      recipientIds: [BOT_ID],
      give: [{ kind: "money", amount: 250 }],
      receive: [{ kind: "promise", text: "No sabotage for two rounds" }],
      status: "accepted",
      offeredAtRound: 4,
      expiresAtRound: 9,
      acceptedBy: [BOT_ID],
      visibility: "public",
    },
  ],
  objectives: [
    {
      visibility: "public",
      id: "objective-table",
      definitionId: "objective.first-to-supervisor",
      ownerId: null,
      progress: 1,
      target: 3,
      completedAtRound: null,
      rewardPoints: 3,
      rewardMoney: 0,
    },
    // Another seat's secret objective: existence only, and the derivation has no
    // route to anything more because the transport sent nothing more.
    { visibility: "secret", id: "objective-rival", ownerId: RIVAL_ID, completedAtRound: null },
    // The viewer's own secret objective arrives redacted here and in full below.
    { visibility: "secret", id: "objective-mine", ownerId: SELF_ID, completedAtRound: null },
  ],
  ballots: [OPEN_VOTE, SEALED_AUCTION, OPEN_AUCTION],
  quarters: [
    { index: 0, startedAtRound: 1, endsAtRound: 4, scheduledEventId: "globalEvent.bonus-season", resolvedEventIds: ["globalEvent.bonus-season"] },
    { index: 1, startedAtRound: 5, endsAtRound: 8, scheduledEventId: "globalEvent.budget-freeze", resolvedEventIds: [] },
    { index: 2, startedAtRound: 9, endsAtRound: 12, scheduledEventId: "globalEvent.layoffs", resolvedEventIds: [] },
  ],
  currentQuarterIndex: 1,
  eliminatedPlayerIds: [],
  players: [
    economy(SELF_ID, {
      loans: [
        { id: "loan-1", principal: 1000, outstanding: 1200, interestBasisPoints: 500, takenAtRound: 2 },
      ],
      incomeStreams: [
        { id: "stream-1", kind: "rent", perRound: 40, remainingRounds: null, sourceId: null },
      ],
    }),
    economy(RIVAL_ID, {
      handCount: 3,
      heat: { value: 6, threshold: 5, investigationsOpened: 1, lastIncrementedAtRound: 5 },
      upkeep: { perRound: 140, lastChargedRound: 5, missedPayments: 2 },
    }),
    economy(BOT_ID, { handCount: 1, upkeep: { perRound: 0, lastChargedRound: 0, missedPayments: 0 } }),
  ],
  self: {
    ownPlacements: [],
    agreements: [
      {
        id: "agreement-mine",
        proposerId: RIVAL_ID,
        recipientIds: [SELF_ID],
        give: [{ kind: "money", amount: 400 }],
        receive: [{ kind: "tile", tileId: "tile.board.corner-office" }],
        status: "offered",
        offeredAtRound: 6,
        expiresAtRound: 8,
        acceptedBy: [],
        visibility: "parties-only",
      },
    ],
    objectives: [
      {
        visibility: "secret",
        id: "objective-mine",
        definitionId: "objective.bank-five-thousand",
        ownerId: SELF_ID,
        progress: 1200,
        target: 5000,
        completedAtRound: null,
        rewardPoints: 4,
        rewardMoney: 0,
      },
    ],
    sabotage: [
      // The viewer's OWN unresolved hidden sabotage. It must not surface on the
      // project it targets — see the assertion below.
      { projectId: "project-1", amount: 2, hidden: true, atRound: 5 },
    ],
    ballotCasts: { "ballot-auction": 400, "ballot-open-auction": 400 },
    freeActionsRemaining: 1,
  },
  scores: [],
  winPath: null,
  endReason: null,
};

const LEGAL_ACTIONS: readonly LegalActionSummary[] = [
  { type: "turn.roll", expectedRevision: 12 },
  { type: "turn.play-card", expectedRevision: 12, cardIds: ["instance-1"] },
  {
    type: "ballot.cast",
    expectedRevision: 12,
    ballotId: "ballot-vote",
    subjectId: "promotion.block-avery",
    sealed: false,
    ballot: { kind: "vote", options: ["yes", "no"] },
  },
  {
    type: "agreement.respond",
    expectedRevision: 12,
    agreementId: "agreement-mine",
    proposerId: RIVAL_ID,
    give: [{ kind: "money", amount: 400 }],
    receive: [{ kind: "tile", tileId: "tile.board.corner-office" }],
    expiresAtRound: 8,
  },
];

const BOOTSTRAP: GameplayBootstrap = {
  room: ROOM,
  publicProjection: PUBLIC_PROJECTION,
  self: SELF,
  prompts: [],
  reactions: [],
  legalActions: LEGAL_ACTIONS,
  gameplay: GAMEPLAY,
  serverTime: "2026-07-26T09:41:05.000Z",
};

const DATA = derivePanelData({ bootstrap: BOOTSTRAP });

/* -------------------------------------------------------------------------- */
/* The projection actually reaches every destination                           */
/* -------------------------------------------------------------------------- */

describe("one bootstrap fills every destination", () => {
  it("derives props for all eleven game-state panels", () => {
    // Then — none of these may be empty for a populated projection. Eleven
    // panels rendering their empty state against real data was the whole bug.
    expect(DATA.seats.seats).toHaveLength(3);
    expect(DATA.hand.cards).toHaveLength(2);
    expect(DATA.projects.projects).toHaveLength(1);
    expect(DATA.market.lots).toHaveLength(2);
    expect(DATA.agreements.agreements).toHaveLength(2);
    expect(DATA.ballots.ballots).toHaveLength(3);
    expect(DATA.objectives.objectives).toHaveLength(3);
    expect(DATA.heat.seats).toHaveLength(3);
    expect(DATA.quarter.quarters).toHaveLength(3);
    expect(DATA.events.items.length).toBeGreaterThan(0);
    expect(DATA.round).toBe(6);
    expect(DATA.activity.revision).toBe(12);
  });

  it("renders each destination with the derived props", () => {
    // When — the exact call shape a host makes: derive once, spread eleven times.
    const markup = [
      renderToStaticMarkup(<SeatsPanel {...DATA.seats} />),
      renderToStaticMarkup(<HandPanel {...DATA.hand} />),
      renderToStaticMarkup(<ProjectsPanel {...DATA.projects} />),
      renderToStaticMarkup(<MarketPanel {...DATA.market} />),
      renderToStaticMarkup(<AgreementsPanel {...DATA.agreements} />),
      renderToStaticMarkup(<BallotsPanel {...DATA.ballots} />),
      renderToStaticMarkup(<ObjectivesPanel {...DATA.objectives} />),
      renderToStaticMarkup(<HeatPanel {...DATA.heat} />),
      renderToStaticMarkup(<QuarterPanel {...DATA.quarter} />),
      renderToStaticMarkup(<EventsPanel {...DATA.events} />),
    ].join("");

    // Then — no destination fell back to its empty state.
    expect(markup).not.toContain('data-slot="panel-empty"');
  });
});

/* -------------------------------------------------------------------------- */
/* Seats and the §12.4 economy vocabulary                                     */
/* -------------------------------------------------------------------------- */

describe("the roster", () => {
  it("derives a 1-based display slot from turn order, not from the zero-based seat field", () => {
    // Then — the server maps `seat: player.order`, which is zero-based, so
    // trusting it would render a seat-0 token and shift every identity rule.
    expect(DATA.seats.seats.map((seat) => seat.seat)).toEqual([1, 2, 3]);
    expect(PUBLIC_PROJECTION.players.every((entry) => entry.seat === 0)).toBe(true);
  });

  it("marks presence, the active seat and the viewer's own row", () => {
    const [avery, morgan, auditor] = DATA.seats.seats;

    expect(avery?.self).toBe(true);
    expect(avery?.active).toBe(true);
    expect(avery?.presence).toBe("online");
    // Disconnected human reads as away; a bot reads as a bot whatever its socket
    // is doing, because "waiting" reads as a frozen screen unless the table says
    // who it is waiting on.
    expect(morgan?.presence).toBe("away");
    expect(auditor?.presence).toBe("bot");
  });

  it("shows upkeep before it bites and debt as owed, not as negative money", () => {
    // When
    const markup = renderToStaticMarkup(<SeatsPanel {...DATA.seats} />);

    // Then — §12.4: upkeep is a recurring obligation stated in advance, debt is
    // "owed" and distinct from a cash balance, and neither is carried by colour.
    expect(markup).toContain("Upkeep $80/rd");
    expect(markup).toContain("Owed $1,200 · 1 loan");
    expect(markup).toContain("+$40/rd");
    expect(markup).toContain("2 payments missed");
    // The seat with no upkeep says so rather than showing nothing at all.
    expect(markup).toContain("No upkeep");
    expect(markup).toContain('data-slot="panel-seat-economy-note"');
  });

  it("carries the member's avatar for the board without drawing it in the rail", () => {
    // Then — identity in a 320px rail is the seat colour plus the seat NUMBER
    // (§8); the photo is carried so the board's token layer reads faces from the
    // same derivation rather than re-walking room.members.
    expect(DATA.seats.seats[0]?.avatarUrl).toBe("https://cdn.example.com/avery.png");
    expect(DATA.seats.seats[2]?.avatarUrl).toBeNull();
    expect(renderToStaticMarkup(<SeatsPanel {...DATA.seats} />)).not.toContain("<img");
  });
});

/* -------------------------------------------------------------------------- */
/* Hidden information                                                          */
/* -------------------------------------------------------------------------- */

describe("hidden information never crosses the derivation", () => {
  it("gives an opponent's hand a count and no card identity", () => {
    // When
    const hand = derivePanelHand(createPanelViewerContext(BOOTSTRAP));

    // Then — the viewer's own cards are named in full; everyone else's is a
    // number, and `OpponentHandCount` has no field a card could occupy.
    expect(hand.cards.map((card) => card.copy.name)).toEqual([
      "Overtime Authorized",
      "Printer Jam",
    ]);
    expect(hand.opponents).toEqual([
      { seat: 2, name: "Morgan", cardCount: 3 },
      { seat: 3, name: "Contract Auditor", cardCount: 1 },
    ]);
    for (const opponent of hand.opponents) {
      expect(Object.keys(opponent).sort()).toEqual(["cardCount", "name", "seat"]);
    }
  });

  it("shows a rival's secret objective as existence only, and the viewer's own in full", () => {
    // When
    const objectives = derivePanelObjectives(createPanelViewerContext(BOOTSTRAP));
    const rival = objectives.find((objective) => objective.id === "objective-rival");
    const mine = objectives.find((objective) => objective.id === "objective-mine");

    // Then
    expect(rival?.kind).toBe("concealed");
    expect(Object.keys(rival ?? {}).sort()).toEqual(["id", "kind", "ownerName", "ownerSeat"]);
    // The viewer's own secret objective arrives twice — redacted in the public
    // array, in full under `self` — and the full one must win.
    expect(mine?.kind).toBe("visible");
    expect(mine?.kind === "visible" ? mine.target : null).toBe(5000);
    expect(mine?.kind === "visible" ? mine.secret : null).toBe(true);

    const markup = renderToStaticMarkup(<ObjectivesPanel objectives={objectives} />);
    expect(markup).toContain("Morgan holds a secret objective");
    expect(markup).not.toContain("Bank five thousand — Morgan");
  });

  it("gives a sealed ballot a count and no cast attributable to anyone", () => {
    // When
    const ballots = derivePanelBallots(createPanelViewerContext(BOOTSTRAP));
    const sealed = ballots.find((ballot) => ballot.id === "ballot-auction");

    // Then — §7.2 forbids leaking in-flight casts "including via castBy keys",
    // so the sealed member has castCount and no `casts` array to iterate.
    expect(sealed?.visibility).toBe("sealed");
    expect(sealed !== undefined && "casts" in sealed).toBe(false);
    expect(sealed?.visibility === "sealed" ? sealed.castCount : null).toBe(2);
    // Your own cast is always yours to read — that is what `self.ballotCasts` is
    // for, since a sealed ballot projects no castBy at all.
    expect(sealed?.yourCast).toBe("$400");

    const markup = renderToStaticMarkup(<BallotsPanel ballots={ballots} round={6} />);
    expect(markup).toContain("2 casts of 3 in, all hidden until close.");
  });

  it("gives a sealed lot a bid count and no standing bid field", () => {
    // When
    const lots = derivePanelMarketLots(createPanelViewerContext(BOOTSTRAP));
    const sealed = lots.find((lot) => lot.id === "ballot-auction");

    // Then
    expect(sealed?.visibility).toBe("sealed");
    expect(sealed !== undefined && "standingBid" in sealed).toBe(false);
    expect(renderToStaticMarkup(<MarketPanel {...DATA.market} />)).toContain(
      "Bids hidden until close",
    );
  });

  it("keeps the viewer's own hidden sabotage off the project it targets", () => {
    // Then — spec §5.2 reveals sabotage only on resolution. The saboteur's own
    // unresolved entry arrives on `gameplay.self.sabotage` and is deliberately
    // NOT merged into the array the panel renders for the whole table: merging it
    // would be one careless map away from telling the lead who hit them.
    expect(GAMEPLAY.self.sabotage).toHaveLength(1);
    expect(DATA.projects.projects[0]?.revealedSabotage).toEqual([]);
    expect(renderToStaticMarkup(<ProjectsPanel {...DATA.projects} />)).not.toContain(
      "Sabotaged by",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Per-panel derivation                                                        */
/* -------------------------------------------------------------------------- */

describe("hand", () => {
  it("marks only the instances the server advertised as playable, and says why not", () => {
    // Then — playability is per INSTANCE, from `turn.play-card`'s opaque ids.
    expect(DATA.hand.cards[0]?.playable).toBe(true);
    expect(DATA.hand.cards[0]?.blockedReason).toBeNull();
    expect(DATA.hand.cards[1]?.playable).toBe(false);
    expect(DATA.hand.cards[1]?.blockedReason).toContain("timing or cost");
  });

  it("reads the hand cap from the room's own mode", () => {
    // Then — `handLimit` lives on the content pack's ModeConfig, not on
    // ModeRules, which carries only the on/off switch.
    expect(DATA.hand.handLimit).toBe(deadlineDashContent.modes["mode.standard"].handLimit);
    expect(renderToStaticMarkup(<HandPanel {...DATA.hand} />)).toContain("2/2");
  });

  it("holds no cards at all when the mode does not hold cards", () => {
    // Given
    const noHand = withRules({ agency: { ...RULES.agency, handEnabled: false } });

    // When
    const hand = derivePanelHand(createPanelViewerContext(noHand));

    // Then — the panel must not show a hand the mode cannot have, and the
    // opponents' counts stay because a count is a fact either way.
    expect(hand.cards).toEqual([]);
    expect(hand.handLimit).toBeNull();
    expect(hand.opponents).toHaveLength(2);
  });
});

describe("projects", () => {
  it("separates the pool from your own stake and counts distinct backers", () => {
    const project = DATA.projects.projects[0];

    expect(project?.title).toBe("Platform migration");
    expect(project?.leadName).toBe("Avery");
    expect(project?.money).toEqual({ committed: 500, required: 2000 });
    // Two contributions from Avery is ONE backer.
    expect(project?.contributorCount).toBe(2);
    expect(project?.yourMoney).toBe(500);
  });

  it("states the deadline in rounds with no countdown of its own", () => {
    const markup = renderToStaticMarkup(<ProjectsPanel {...DATA.projects} />);

    expect(markup).toContain("3 rounds left");
    expect(markup).toContain('data-panel-urgency="distant"');
  });

  it("closes a project to new backers when the mode forbids joining", () => {
    // Given
    const closed = withRules({ projects: { ...RULES.projects, joinable: false } });

    // Then — an "Open" stamp on a project nobody may join is a UI that lies.
    expect(DATA.projects.projects[0]?.openToJoin).toBe(true);
    expect(
      derivePanelData({ bootstrap: closed }).projects.projects[0]?.openToJoin,
    ).toBe(false);
  });
});

describe("market and ballots split one array", () => {
  it("reads lots from the auction ballots and shows the standing bid on an open one", () => {
    const open = DATA.market.lots.find((lot) => lot.id === "ballot-open-auction");

    expect(DATA.market.lots.map((lot) => lot.id)).toEqual([
      "ballot-auction",
      "ballot-open-auction",
    ]);
    expect(open?.visibility === "open" ? open.standingBid : null).toEqual({
      seat: 2,
      name: "Morgan",
      amount: 600,
    });
    expect(open?.yourBid).toBe(400);
  });

  it("infers a lot's kind from its subject, then from the subject id's namespace", () => {
    const [tileLot, favourLot] = DATA.market.lots;

    expect(tileLot?.kind).toBe("tile");
    // `favour.parking-space` with an empty authored subject.
    expect(favourLot?.kind).toBe("favour");
    expect(favourLot?.title).toBe("Parking space");
  });

  it("keeps both kinds in Ballots and badges only the ones waiting on you", () => {
    // Then — the destination's question is "what am I being asked to decide", and
    // an auction asks that as much as a vote does. The badge counts once, so an
    // uncast auction is not double-counted against the Market tab.
    expect(DATA.ballots.ballots.map((ballot) => ballot.kind)).toEqual([
      "vote",
      "auction",
      "auction",
    ]);
    expect(DATA.ballots.ballots.filter((ballot) => ballot.youMayCast)).toHaveLength(1);
    expect(DATA.attention.ballots).toEqual({
      count: 1,
      summary: "1 ballot still waiting on your cast.",
    });
  });

  it("formats a vote's cast as a choice and an auction's as money", () => {
    const vote = DATA.ballots.ballots[0];

    expect(vote?.visibility === "open" ? vote.casts : null).toEqual([
      { seat: 2, name: "Morgan", value: "Yes" },
    ]);
    expect(vote?.subject).toBe("Block Avery's promotion?");
  });
});

describe("agreements", () => {
  it("merges the public log with the viewer's own deals, party view winning", () => {
    const mine = DATA.agreements.agreements.find(
      (agreement) => agreement.id === "agreement-mine",
    );
    const theirs = DATA.agreements.agreements.find(
      (agreement) => agreement.id === "agreement-public",
    );

    expect(mine?.awaitingYou).toBe(true);
    expect(theirs?.awaitingYou).toBe(false);
    expect(mine?.recipientNames).toEqual(["Avery"]);
  });

  it("prints a promise as unenforceable and a transfer as enforced", () => {
    const markup = renderToStaticMarkup(<AgreementsPanel {...DATA.agreements} />);

    // §5.5: a transfer is settled by the engine, a promise is not, and a player
    // who thinks a promise binds has been misled by the UI.
    expect(markup).toContain("Promise (not enforced)");
    expect(markup).toContain("$400");
    expect(markup).toContain("Lapses in 2 rounds");
    expect(markup).toContain("1 offer waiting on your answer.");
  });
});

describe("heat", () => {
  it("reads as accumulating pressure against a threshold, for the whole table", () => {
    expect(DATA.heat.self).toEqual({
      value: 1,
      threshold: 5,
      investigationsOpened: 0,
      lastIncrementedAtRound: 4,
    });
    // Public on purpose: a deterrent nobody can see deters nobody (§5.4).
    expect(DATA.heat.seats.find((seat) => seat.name === "Morgan")?.underInvestigation).toBe(
      true,
    );
    expect(DATA.heat.seats.find((seat) => seat.name === "Avery")?.underInvestigation).toBe(
      false,
    );
  });

  it("goes null when the mode switches heat off, so the panel can explain why", () => {
    // Given
    const noHeat = withRules({ conflict: { ...RULES.conflict, heatEnabled: false } });

    // When
    const derived = derivePanelData({ bootstrap: noHeat }).heat;

    // Then — a destination that renders nothing teaches a player nothing about
    // why their attack was free.
    expect(derived.self).toBeNull();
    expect(derived.seats).toEqual([]);
    expect(renderToStaticMarkup(<HeatPanel {...derived} />)).toContain(
      "Heat is off in this mode",
    );
  });
});

describe("the quarter track", () => {
  it("marks past, current and future quarters from the projected index", () => {
    expect(DATA.quarter.quarters.map((quarter) => quarter.state)).toEqual([
      "past",
      "current",
      "future",
    ]);
    expect(DATA.quarter.quarters[1]?.label).toBe("Q2");
    expect(DATA.quarter.quarters[0]?.resolvedEventLabels).toEqual(["Bonus season"]);
  });

  it("announces next quarter's event a quarter ahead, with what it will do", () => {
    // Then — §5.7: "a known-in-advance shock that players can prepare for is a
    // decision; an unannounced one is just variance."
    expect(DATA.quarter.announcement?.quarterLabel).toBe("Q3");
    expect(DATA.quarter.announcement?.title).toBe("Layoffs");
    // Built from the authored event's own modifiers and effects rather than from
    // a translation key this app has no catalogue for.
    expect(DATA.quarter.announcement?.detail).toContain("loses a rank");
    expect(DATA.attention.quarter?.count).toBe(1);

    const markup = renderToStaticMarkup(<QuarterPanel {...DATA.quarter} />);
    expect(markup).toContain("Next quarter (Q3): Layoffs.");
    expect(markup).toContain('data-panel-state="current"');
  });

  it("has no announcement on the last quarter", () => {
    // Given — the current quarter is the last one, so there is no next.
    const last = {
      ...BOOTSTRAP,
      gameplay: { ...GAMEPLAY, currentQuarterIndex: 2 },
    } satisfies GameplayBootstrap;

    // Then
    expect(derivePanelData({ bootstrap: last }).quarter.announcement).toBeNull();
    expect(derivePanelData({ bootstrap: last }).attention.quarter).toBeNull();
  });
});

describe("the card and event feed", () => {
  it("lifts cards and notices, newest first, and leaves bookkeeping to the log", () => {
    const items = DATA.events.items;

    // Then — this feed is not a second copy of the activity log. Movement, dice
    // and turn bookkeeping stay there; putting all thirty types in both is how
    // the rail became unreadable.
    expect(items.map((item) => item.id)).toEqual(["event-3", "event-2"]);
    expect(items.map((item) => item.kind)).toEqual(["notice", "card"]);
    expect(items[1]?.title).toBe("Overtime Authorized");
    expect(items[1]?.source).toBe("Work deck");
    expect(items[1]?.summary).toBe("Gain $150.");
  });

  it("separates your own records from an opponent's structurally", () => {
    // Then — "notif kebanyakan (dipisah yang sendiri atau lawan)" answered by
    // audience rather than by reading a name.
    expect(DATA.events.items.map((item) => item.audience)).toEqual(["theirs", "mine"]);

    const markup = renderToStaticMarkup(<EventsPanel {...DATA.events} />);
    expect(markup).toContain('data-panel-origin="local"');
    expect(markup).toContain('data-panel-origin="remote"');
  });
});

describe("attention", () => {
  it("badges only the destinations that can be waiting on the viewer", () => {
    // Then — an attention affordance on a panel a player cannot act in is noise,
    // and one that is always present stops meaning anything.
    expect(DATA.attention.agreements?.count).toBe(1);
    expect(DATA.attention.ballots?.count).toBe(1);
    expect(DATA.attention.hand?.count).toBe(1);
    expect(DATA.attention.heat).toBeNull();
    expect(DATA.attention.activity).toBeUndefined();
    expect(DATA.attention.objectives).toBeUndefined();
    // The viewer has already bid on both lots in this fixture, so the Market tab
    // has nothing to raise — a badge that counted lots you had already answered
    // would be a badge that never clears.
    expect(DATA.attention.market).toBeNull();
  });

  it("badges the market once a lot is open that the viewer has not bid on", () => {
    // Given — the same two auctions with no cast of the viewer's own.
    const unbid: GameplayBootstrap = {
      ...BOOTSTRAP,
      gameplay: { ...GAMEPLAY, self: { ...GAMEPLAY.self, ballotCasts: {} } },
    };

    // Then
    expect(derivePanelData({ bootstrap: unbid }).attention.market).toEqual({
      count: 2,
      summary: "2 lots open that you have not bid on.",
    });
  });
});

describe("an empty match still teaches", () => {
  const empty: GameplayBootstrap = {
    ...BOOTSTRAP,
    self: { ...SELF, hand: [] },
    publicProjection: { ...PUBLIC_PROJECTION, eventSummaries: [] },
    legalActions: [{ type: "turn.roll", expectedRevision: 12 }],
    gameplay: {
      ...GAMEPLAY,
      projects: [],
      agreements: [],
      objectives: [],
      ballots: [],
      quarters: [],
      self: { ...GAMEPLAY.self, agreements: [], objectives: [], sabotage: [] },
    },
  };
  const emptyData = derivePanelData({ bootstrap: empty });

  it("falls back to the teaching empty state rather than to a blank body", () => {
    // When
    const markup = [
      renderToStaticMarkup(<HandPanel {...emptyData.hand} />),
      renderToStaticMarkup(<ProjectsPanel {...emptyData.projects} />),
      renderToStaticMarkup(<MarketPanel {...emptyData.market} />),
      renderToStaticMarkup(<AgreementsPanel {...emptyData.agreements} />),
      renderToStaticMarkup(<BallotsPanel {...emptyData.ballots} />),
      renderToStaticMarkup(<ObjectivesPanel {...emptyData.objectives} />),
      renderToStaticMarkup(<QuarterPanel {...emptyData.quarter} />),
      renderToStaticMarkup(<EventsPanel {...emptyData.events} />),
    ].join("");

    // Then — §12.5: an empty panel is the first thing a new player reads and this
    // game ships no onboarding, so every empty body is real teaching copy.
    expect(markup.match(/data-slot="panel-empty"/g) ?? []).toHaveLength(8);
    // A sample of the teaching, not a smoke test: each of these sentences states
    // a rule a new player has no other way to learn.
    expect(markup).toContain("Anyone may fund it for a share of the payout");
    expect(markup).toContain("sabotage stays hidden until the project resolves");
    expect(markup).toContain("no bid is visible to anyone until it closes");
    expect(markup).toContain("announces the next office-wide event a quarter ahead");
  });

  it("raises no attention badge at all when nothing is waiting", () => {
    for (const value of Object.values(emptyData.attention)) {
      expect(value).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The same bootstrap under a one-block ruleset change. */
function withRules(overrides: Partial<GameplayProjection["rules"]>): GameplayBootstrap {
  return {
    ...BOOTSTRAP,
    gameplay: { ...GAMEPLAY, rules: { ...RULES, ...overrides } },
  };
}
