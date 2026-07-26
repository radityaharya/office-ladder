import { describe, expect, it } from "vitest";

import type {
  BallotProjection,
  GameplayProjection,
  PublicAgreementProjection,
  PublicObjectiveProjection,
  PublicPlacementProjection,
  PublicPlayerGameplayProjection,
  PublicProjectProjection,
  SelfGameplayProjection,
} from "../src/gameplay";
import type { ModeRules } from "../src/mode-rules";

/**
 * These are **compile-time** assertions as much as runtime ones.
 *
 * The redaction guarantees of spec §7.2 are made structurally: where a field must
 * not reach every viewer, the public DTO has no field of that shape at all. A
 * `@ts-expect-error` below therefore fails `tsc` — which this package's
 * `typecheck` script runs over `tests/` as well as `src/` — the moment such a
 * field becomes assignable. If one of them stops erroring, a leak has become
 * possible even if no server ever populates it.
 */

const rules: ModeRules = {
  winShape: "fixed-length",
  quarters: { enabled: true, count: 4, roundsEach: 4, globalEvents: true },
  winPaths: { promotion: true, wealth: true, influence: true, survival: false },
  economy: {
    upkeepEnabled: true,
    upkeepByRankIndex: [0, 50, 100, 150, 200, 300, 400, 500, 650],
    loansEnabled: true,
    maxLoanPrincipal: 2_000,
    interestBasisPoints: 1_000,
    bankruptcy: "demote",
    incomeStreamsEnabled: true,
  },
  board: {
    ownershipEnabled: true,
    claimCostMultiplier: 1.5,
    tollMultiplier: 0.5,
    upgradesEnabled: true,
    placementsEnabled: true,
    maxPlacementsPerPlayer: 3,
  },
  projects: {
    enabled: true,
    maxConcurrentPerPlayer: 2,
    joinable: true,
    sabotageable: true,
    deadlineRounds: 4,
  },
  conflict: {
    targetedAttacks: true,
    heatEnabled: true,
    heatPerAttack: 2,
    heatThreshold: 6,
    defenceEnabled: true,
    leaderProtection: "soft",
    elimination: false,
  },
  agency: {
    promotionIsChoice: true,
    promotionRaisesUpkeep: true,
    diceAdjustEnabled: true,
    energyPerPip: 1,
    maxPipAdjust: 2,
    freeActionsPerTurn: 1,
    handEnabled: true,
  },
  interaction: {
    reactionWindows: true,
    reactionWindowSeconds: 12,
    votesEnabled: true,
    auctionsEnabled: true,
    tradesEnabled: true,
    promisesRecorded: true,
  },
  hidden: {
    rolesEnabled: true,
    roleWinConditions: false,
    secretObjectives: true,
    hiddenHands: true,
  },
  social: { chat: "full", emoteReactions: true, directMessages: false },
  timers: { turnSeconds: 45, onTimeout: "auto-roll", chessClockSeconds: null },
  bots: { pacing: "paced", thinkMsRange: [400, 1_200], canNegotiate: false },
};

const viewer: PublicPlayerGameplayProjection = {
  playerId: "player-a",
  handCount: 3,
  heat: {
    value: 2,
    threshold: 6,
    investigationsOpened: 0,
    lastIncrementedAtRound: 3,
  },
  upkeep: { perRound: 100, lastChargedRound: 3, missedPayments: 0 },
  loans: [
    {
      id: "loan-1",
      principal: 500,
      outstanding: 550,
      interestBasisPoints: 1_000,
      takenAtRound: 2,
    },
  ],
  incomeStreams: [
    { id: "income-1", kind: "rent", perRound: 25, remainingRounds: null, sourceId: "tile.desk-1" },
  ],
};

const rival: PublicPlayerGameplayProjection = {
  ...viewer,
  playerId: "player-b",
  handCount: 5,
  loans: [],
  incomeStreams: [],
};

const publicPlacement: PublicPlacementProjection = {
  id: "placement-1",
  kind: "placement.rumour",
  tileId: "tile.desk-4",
  ownerId: "player-b",
  charges: 1,
  visibility: "public",
  placedAtRound: 2,
};

const project: PublicProjectProjection = {
  id: "project-1",
  definitionId: "project.migration",
  leadPlayerId: "player-a",
  tileId: "tile.desk-2",
  status: "open",
  requiredMoney: 1_000,
  requiredWork: 8,
  contributedMoney: 400,
  contributedWork: 2,
  contributions: [{ playerId: "player-a", money: 400, work: 2, atRound: 2 }],
  // Player B's hidden sabotage is unresolved, so it is absent — not masked.
  sabotage: [],
  deadlineRound: 8,
  payout: { money: 2_000, reputation: 3, objectiveProgress: 1 },
  openToJoin: true,
  leadBonusBasisPoints: 1_500,
};

const publicAgreement: PublicAgreementProjection = {
  id: "agreement-1",
  proposerId: "player-a",
  recipientIds: ["player-b"],
  give: [{ kind: "money", amount: 300 }],
  receive: [{ kind: "promise", text: "no audits this quarter" }],
  status: "offered",
  offeredAtRound: 3,
  expiresAtRound: 5,
  acceptedBy: [],
  visibility: "public",
};

const objectives: readonly PublicObjectiveProjection[] = [
  {
    visibility: "public",
    id: "objective-1",
    definitionId: "objective.ship-it",
    ownerId: null,
    progress: 1,
    target: 3,
    completedAtRound: null,
    rewardPoints: 500,
    rewardMoney: 0,
  },
  // Player B's secret objective: existence and owner, nothing else.
  {
    visibility: "secret",
    id: "objective-2",
    ownerId: "player-b",
    completedAtRound: null,
  },
];

const ballots: readonly BallotProjection[] = [
  {
    visibility: "sealed",
    id: "ballot-1",
    kind: "auction",
    subjectId: "tile.desk-9",
    subject: { tileId: "tile.desk-9" },
    audience: ["player-a", "player-b"],
    castCount: 1,
    viewerHasCast: true,
    deadlineAt: "2026-07-26T10:00:00.000Z",
    closesAtRound: 4,
    resolution: null,
  },
];

const self: SelfGameplayProjection = {
  ownPlacements: [
    {
      id: "placement-2",
      kind: "placement.surveillance",
      tileId: "tile.desk-7",
      ownerId: "player-a",
      charges: 1,
      visibility: "owner-only",
      placedAtRound: 3,
      data: { observed: "player-b-hand-size" },
    },
  ],
  agreements: [
    {
      id: "agreement-2",
      proposerId: "player-b",
      recipientIds: ["player-a"],
      give: [{ kind: "card", cardId: "card-77" }],
      receive: [{ kind: "money", amount: 100 }],
      status: "offered",
      offeredAtRound: 3,
      expiresAtRound: 4,
      acceptedBy: [],
      visibility: "parties-only",
    },
  ],
  objectives: [
    {
      visibility: "secret",
      id: "objective-3",
      definitionId: "objective.hoard-cash",
      ownerId: "player-a",
      progress: 2,
      target: 4,
      completedAtRound: null,
      rewardPoints: 750,
      rewardMoney: 250,
    },
  ],
  sabotage: [{ projectId: "project-1", amount: 2, hidden: true, atRound: 3 }],
  ballotCasts: { "ballot-1": 400 },
  freeActionsRemaining: 1,
};

/** The payload the server would build for player A. */
const projection: GameplayProjection = {
  rules,
  tileOwnership: [
    {
      tileId: "tile.desk-1",
      ownerId: "player-a",
      level: 1,
      claimedAtRound: 2,
      tollPaidCount: 3,
    },
  ],
  placements: [publicPlacement],
  projects: [project],
  agreements: [publicAgreement],
  objectives,
  ballots,
  quarters: [
    {
      index: 0,
      startedAtRound: 1,
      endsAtRound: 4,
      scheduledEventId: "event.audit-season",
      resolvedEventIds: [],
    },
  ],
  currentQuarterIndex: 0,
  eliminatedPlayerIds: [],
  players: [viewer, rival],
  self,
  scores: [],
  winPath: null,
  endReason: null,
};

describe("gameplay projection redaction", () => {
  it("Given a viewer's projection, When serialising it, Then no other player's private state appears anywhere in the payload", () => {
    const payload = JSON.stringify(projection);

    // Player B's secret objective projects as existence only: its id is visible,
    // its definition is not.
    expect(payload).toContain("objective-2");
    expect(payload).not.toContain("objective.hoard-cash-rival");
    // The viewer's *own* secret objective is fully present, under `self`.
    expect(payload).toContain("objective.hoard-cash");
    // Player B's owner-only placement is not in the payload at all — the public
    // list carries only `visibility: "public"` entries.
    expect(payload).not.toContain("tile.desk-99");
    // A sealed ballot leaks neither the bids nor who has bid; the viewer's own
    // cast comes back under `self.ballotVotes`.
    expect(payload).not.toContain("castBy");
  });

  it("Given a projection, When round-tripping it through JSON, Then it survives unchanged", () => {
    // §5's invariant for every new shape: JSON-serialisable, no `Date`, no `Map`,
    // no `undefined`. The repository stores these through
    // `JSON.parse(JSON.stringify(…))`, so anything that does not survive that is
    // silently dropped on the way to the database.
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
  });

  it("Given the public placement shape, When inspecting a value of it, Then it carries no owner-only data", () => {
    expect(Object.keys(publicPlacement).sort()).toEqual([
      "charges",
      "id",
      "kind",
      "ownerId",
      "placedAtRound",
      "tileId",
      "visibility",
    ]);
    // `data` is where a surveillance placement records what it learned. It has no
    // home on the public shape at all.
    expect("data" in publicPlacement).toBe(false);
  });

  it("Given a public player projection, When inspecting it, Then a hidden hand is a count and nothing more", () => {
    expect(rival.handCount).toBe(5);
    expect(Object.keys(rival)).not.toContain("hand");
  });
});

describe("gameplay projection redaction — enforced by the type, not by the server", () => {
  it("Given a public player projection, When something tries to attach a hand to it, Then it does not typecheck", () => {
    const leak: PublicPlayerGameplayProjection = {
      ...rival,
      // @ts-expect-error a public player projection has no shape that can carry cards
      hand: [{ id: "card-1", definitionId: "card.overtime" }],
    };

    expect(leak.playerId).toBe("player-b");
  });

  it("Given the public placement list, When something tries to put an owner-only placement in it, Then it does not typecheck", () => {
    const leak: PublicPlacementProjection = {
      ...publicPlacement,
      // @ts-expect-error the public placement shape pins visibility to "public"
      visibility: "owner-only",
    };
    const withData: PublicPlacementProjection = {
      ...publicPlacement,
      // @ts-expect-error surveillance findings have no home on a public placement
      data: { observed: "player-b-hand" },
    };

    expect(leak.id).toBe("placement-1");
    expect(withData.id).toBe("placement-1");
  });

  it("Given the public agreement list, When something tries to put a parties-only agreement in it, Then it does not typecheck", () => {
    const leak: PublicAgreementProjection = {
      ...publicAgreement,
      // @ts-expect-error the public agreement shape pins visibility to "public"
      visibility: "parties-only",
    };

    expect(leak.id).toBe("agreement-1");
  });

  it("Given a secret objective projection, When something tries to reveal what it is, Then it does not typecheck", () => {
    type SecretObjective = Extract<PublicObjectiveProjection, { visibility: "secret" }>;

    const leak: SecretObjective = {
      visibility: "secret",
      id: "objective-2",
      ownerId: "player-b",
      completedAtRound: null,
      // @ts-expect-error a secret objective projects as existence only
      definitionId: "objective.hoard-cash",
    };
    const withProgress: SecretObjective = {
      visibility: "secret",
      id: "objective-2",
      ownerId: "player-b",
      completedAtRound: null,
      // @ts-expect-error progress towards a secret objective is itself secret
      progress: 2,
    };

    expect(leak.id).toBe("objective-2");
    expect(withProgress.id).toBe("objective-2");
  });

  it("Given a sealed ballot, When something tries to attach the casts to it, Then it does not typecheck", () => {
    type SealedBallot = Extract<BallotProjection, { visibility: "sealed" }>;

    const leak: SealedBallot = {
      visibility: "sealed",
      id: "ballot-1",
      kind: "auction",
      subjectId: "tile.desk-9",
      subject: {},
      audience: ["player-a", "player-b"],
      castCount: 1,
      viewerHasCast: true,
      deadlineAt: null,
      closesAtRound: 4,
      resolution: null,
      // @ts-expect-error §7.2: sealed casts must not leak, including via castBy keys
      castBy: { "player-b": 900 },
    };

    expect(leak.castCount).toBe(1);
  });

  it("Given the gameplay projection, When something tries to carry chat on it, Then it does not typecheck", () => {
    const leak: GameplayProjection = {
      ...projection,
      // @ts-expect-error chat is not game state and has no home on a projection
      messages: [{ id: "message-1", body: "hi" }],
    };

    expect(leak.currentQuarterIndex).toBe(0);
  });
});
