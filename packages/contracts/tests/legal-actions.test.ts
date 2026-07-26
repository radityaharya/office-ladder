import { describe, expect, it } from "vitest";

import {
  MAX_MONEY_AMOUNT,
  MAX_PIP_ADJUST,
  MAX_TOKEN_QUANTITY,
  MAX_WORK_AMOUNT,
  PLAYER_COMMAND_TYPES,
  SERVER_INJECTED_COMMAND_TYPES,
  parseAdjustRollRequest,
  parseCastBallotRequest,
  parseContributeToProjectRequest,
  parseRepayLoanRequest,
  parseSabotageProjectRequest,
  parseTakeLoanRequest,
  type PlayerCommandType,
} from "../src/commands";
import {
  LEGAL_ACTIONS_COVER_EVERY_PLAYER_COMMAND,
  toLegalActionSummaries,
  toLegalActionSummary,
  type EnumeratedLegalAction,
  type LegalActionContext,
  type LegalActionSummary,
} from "../src/legal-actions";
import type { ModeRules } from "../src/mode-rules";

/**
 * Like `gameplay-projections.test.ts`, these are **compile-time** assertions as
 * much as runtime ones: this package's `typecheck` script covers `tests/`, so a
 * `@ts-expect-error` below fails `tsc` the moment the field it guards becomes
 * assignable. If one of them stops erroring, a leak has become possible even if
 * no server ever populates it.
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

const REVISION = 12;

const context: LegalActionContext = {
  rules,
  spendable: { money: 800, energy: 5, work: 6 },
  ballots: [
    {
      ballotId: "ballot-vote",
      sealed: false,
      options: ["player-b", "player-c", "abstain"],
      minBid: null,
    },
    { ballotId: "ballot-auction", sealed: true, options: null, minBid: 100 },
  ],
  agreements: [
    {
      agreementId: "agreement-1",
      give: [{ kind: "money", amount: 250 }],
      receive: [{ kind: "tile", tileId: "tile.desk-4" }],
      expiresAtRound: 7,
    },
  ],
  otherPlayerIds: ["player-b", "player-c"],
};

/**
 * One enumerated action of every player command type.
 *
 * The mapped-type annotation is the coverage test: omitting a command is a
 * compile error here, and `Extract` resolves to `never` for a command
 * `EnumeratedLegalAction` has no member for — so this fixture cannot be built
 * unless the enumerator's shape and the command allow-list agree.
 */
const ENUMERATED: {
  readonly [Type in PlayerCommandType]: Extract<
    EnumeratedLegalAction,
    { readonly type: Type }
  >;
} = {
  "game.start": { type: "game.start", expectedRevision: REVISION },
  "turn.roll": { type: "turn.roll", expectedRevision: REVISION },
  "prompt.respond": {
    type: "prompt.respond",
    expectedRevision: REVISION,
    decisionPointId: "decision-1",
    kind: "audit-release",
    options: ["pay-fine", "attempt-roll"],
  },
  "reaction.play": {
    type: "reaction.play",
    expectedRevision: REVISION,
    decisionPointId: "window-1",
    kind: "prevention",
    cardIds: ["card-own-1", "card-own-2"],
    abilityIds: ["ability.tech-genius"],
  },
  "reaction.pass": {
    type: "reaction.pass",
    expectedRevision: REVISION,
    decisionPointId: "window-1",
    kind: "prevention",
  },
  "management.block-promotion": {
    type: "management.block-promotion",
    expectedRevision: REVISION,
    decisionPointId: "window-2",
  },
  "ballot.cast": {
    type: "ballot.cast",
    expectedRevision: REVISION,
    ballotId: "ballot-vote",
    kind: "vote",
    subjectId: "player-b",
  },
  "agreement.respond": {
    type: "agreement.respond",
    expectedRevision: REVISION,
    agreementId: "agreement-1",
    proposerId: "player-b",
  },
  "agreement.offer": { type: "agreement.offer", expectedRevision: REVISION },
  "turn.adjust-roll": {
    type: "turn.adjust-roll",
    expectedRevision: REVISION,
    maxPips: 2,
    energyPerPip: 1,
  },
  "turn.action": {
    type: "turn.action",
    expectedRevision: REVISION,
    actions: ["work", "network", "scheme", "rest", "role.reveal"],
    remaining: 1,
  },
  "turn.play-card": {
    type: "turn.play-card",
    expectedRevision: REVISION,
    cardIds: ["card-own-1"],
  },
  "turn.spend-token": {
    type: "turn.spend-token",
    expectedRevision: REVISION,
    tokens: [{ tokenId: "token.favour", use: "reroll", maxQuantity: 2 }],
  },
  "turn.activate-character": {
    type: "turn.activate-character",
    expectedRevision: REVISION,
    abilityId: "ability.office-politician",
  },
  "promotion.attempt": {
    type: "promotion.attempt",
    expectedRevision: REVISION,
    toRankId: "rank.manager",
    cost: 1_500,
    declined: false,
  },
  "promotion.decline": { type: "promotion.decline", expectedRevision: REVISION },
  "audit.pay-fine": { type: "audit.pay-fine", expectedRevision: REVISION },
  "management.shuffle-deck": {
    type: "management.shuffle-deck",
    expectedRevision: REVISION,
    deckIds: ["deck.work", "deck.event"],
  },
  "tile.claim": {
    type: "tile.claim",
    expectedRevision: REVISION,
    tileId: "tile.desk-4",
    cost: 300,
  },
  "tile.upgrade": {
    type: "tile.upgrade",
    expectedRevision: REVISION,
    tileId: "tile.desk-4",
    level: 2,
    cost: 450,
  },
  "placement.place": {
    type: "placement.place",
    expectedRevision: REVISION,
    kinds: [
      { kind: "placement.rumour", cost: 120 },
      { kind: "placement.favour", cost: 200 },
    ],
  },
  "project.start": {
    type: "project.start",
    expectedRevision: REVISION,
    definitionIds: ["project.migration"],
  },
  "project.contribute": {
    type: "project.contribute",
    expectedRevision: REVISION,
    projectIds: ["project-1", "project-2"],
  },
  "project.sabotage": {
    type: "project.sabotage",
    expectedRevision: REVISION,
    projectIds: ["project-2"],
  },
  "attack.target": {
    type: "attack.target",
    expectedRevision: REVISION,
    targetPlayerIds: ["player-b", "player-c"],
    vectors: ["attack.rumour", "attack.poach"],
  },
  "loan.take": { type: "loan.take", expectedRevision: REVISION, capacity: 1_200 },
  "loan.repay": {
    type: "loan.repay",
    expectedRevision: REVISION,
    loans: [{ loanId: "loan-1", outstanding: 550 }],
  },
};

const ALL_ACTIONS: readonly EnumeratedLegalAction[] = Object.values(ENUMERATED);

function summarise(type: PlayerCommandType): LegalActionSummary {
  const summary = toLegalActionSummary(ENUMERATED[type], context);
  if (summary === null) {
    throw new Error(`Expected ${type} to cross the transport`);
  }

  return summary;
}

function extract<Type extends PlayerCommandType>(
  type: Type,
): Extract<LegalActionSummary, { readonly type: Type }> {
  return summarise(type) as Extract<LegalActionSummary, { readonly type: Type }>;
}

describe("legal action coverage", () => {
  it("Given the command allow-list, When enumerating the summary union, Then every player command can cross the transport", () => {
    // The real guarantee is the compile error on this constant's declaration when
    // the two sets drift; asserting it here is what makes that line load-bearing.
    expect(LEGAL_ACTIONS_COVER_EVERY_PLAYER_COMMAND).toBe(true);

    const summarised = toLegalActionSummaries(ALL_ACTIONS, context).map(
      (action) => action.type,
    );

    expect([...summarised].sort()).toEqual([...PLAYER_COMMAND_TYPES].sort());
    expect(summarised).toHaveLength(27);
  });

  it("Given a server-injected command, When something tries to advertise it as legal, Then it does not typecheck", () => {
    // §7.1: `window.expire` is server-injected only. A player who could see it
    // offered could expire their own reaction window the instant it opened.
    const leak: LegalActionSummary = {
      // @ts-expect-error window.expire is not a player command and has no member
      type: "window.expire",
      expectedRevision: REVISION,
    };
    const quarter: LegalActionSummary = {
      // @ts-expect-error quarter.advance is engine-internal or server-injected
      type: "quarter.advance",
      expectedRevision: REVISION,
    };

    expect(leak.expectedRevision).toBe(REVISION);
    expect(quarter.expectedRevision).toBe(REVISION);
    // And the two vocabularies stay disjoint at runtime, so no summary type can
    // ever name one of them.
    for (const injected of SERVER_INJECTED_COMMAND_TYPES) {
      expect(PLAYER_COMMAND_TYPES).not.toContain(injected);
    }
  });

  it("Given the three pre-v2 members, When mapping them, Then their shape is byte-for-byte what apps/web already renders", () => {
    // apps/web is not being migrated in this wave: `game.start`, `turn.roll` and
    // `prompt.respond` must keep the exact shape its components destructure.
    expect(summarise("game.start")).toEqual({ type: "game.start", expectedRevision: 12 });
    expect(summarise("turn.roll")).toEqual({ type: "turn.roll", expectedRevision: 12 });
    expect(summarise("prompt.respond")).toEqual({
      type: "prompt.respond",
      expectedRevision: 12,
      decisionPointId: "decision-1",
      kind: "audit-release",
      options: ["pay-fine", "attempt-roll"],
    });
  });
});

describe("legal action payloads — the happy path", () => {
  it("Given a claimable tile, When mapping it, Then the payload says what the button will spend", () => {
    expect(extract("tile.claim")).toEqual({
      type: "tile.claim",
      expectedRevision: 12,
      tileId: "tile.desk-4",
      cost: 300,
    });
    expect(extract("tile.upgrade")).toEqual({
      type: "tile.upgrade",
      expectedRevision: 12,
      tileId: "tile.desk-4",
      level: 2,
      cost: 450,
    });
    expect(extract("placement.place").kinds).toEqual([
      { kind: "placement.rumour", cost: 120 },
      { kind: "placement.favour", cost: 200 },
    ]);
  });

  it("Given fundable projects, When mapping the contribution, Then the payload carries the projects, the minimum and the actor's affordable maximum", () => {
    expect(extract("project.contribute")).toEqual({
      type: "project.contribute",
      expectedRevision: 12,
      projectIds: ["project-1", "project-2"],
      minTotal: 1,
      maxMoney: 800,
      maxWork: 6,
    });
  });

  it("Given an open offer, When mapping the response, Then the payload carries the offer's terms", () => {
    expect(extract("agreement.respond")).toEqual({
      type: "agreement.respond",
      expectedRevision: 12,
      agreementId: "agreement-1",
      proposerId: "player-b",
      give: [{ kind: "money", amount: 250 }],
      receive: [{ kind: "tile", tileId: "tile.desk-4" }],
      expiresAtRound: 7,
    });
  });

  it("Given an open vote, When mapping the cast, Then the payload carries the ballot, its options and that it is not sealed", () => {
    expect(extract("ballot.cast")).toEqual({
      type: "ballot.cast",
      expectedRevision: 12,
      ballotId: "ballot-vote",
      subjectId: "player-b",
      sealed: false,
      ballot: { kind: "vote", options: ["player-b", "player-c", "abstain"] },
    });
  });

  it("Given a sealed auction, When mapping the cast, Then the payload carries the bid range and no tally of any kind", () => {
    const auction = toLegalActionSummary(
      {
        type: "ballot.cast",
        expectedRevision: REVISION,
        ballotId: "ballot-auction",
        kind: "auction",
        subjectId: "tile.desk-9",
      },
      context,
    );

    expect(auction).toEqual({
      type: "ballot.cast",
      expectedRevision: 12,
      ballotId: "ballot-auction",
      subjectId: "tile.desk-9",
      sealed: true,
      // Bounded by the *bidder's own* money, which is the only balance in scope.
      ballot: { kind: "auction", minBid: 100, maxBid: 800 },
    });
    expect(JSON.stringify(auction)).not.toContain("castBy");
  });

  it("Given dice adjustment, When mapping it, Then the payload carries the pip range, the price per pip and what the actor can afford", () => {
    expect(extract("turn.adjust-roll")).toEqual({
      type: "turn.adjust-roll",
      expectedRevision: 12,
      minPips: -2,
      maxPips: 2,
      energyPerPip: 1,
      // 5 energy at 1/pip buys more than the mode's 2-pip ceiling.
      affordablePips: 2,
    });
  });

  it("Given a thin energy balance, When mapping dice adjustment, Then the affordable range shrinks below the mode's ceiling", () => {
    const summary = toLegalActionSummary(ENUMERATED["turn.adjust-roll"], {
      ...context,
      spendable: { ...context.spendable, energy: 1 },
    });

    expect(summary).toMatchObject({ maxPips: 2, affordablePips: 1 });
  });

  it("Given reachable targets, When mapping an attack, Then the payload carries the eligible seats and the heat it will cost the actor", () => {
    expect(extract("attack.target")).toEqual({
      type: "attack.target",
      expectedRevision: 12,
      targetPlayerIds: ["player-b", "player-c"],
      vectors: ["attack.rumour", "attack.poach"],
      heatCost: 2,
    });
    expect(extract("project.sabotage")).toEqual({
      type: "project.sabotage",
      expectedRevision: 12,
      projectIds: ["project-2"],
      maxAmount: 6,
      heatCost: 2,
    });
  });

  it("Given borrowing capacity, When mapping the loan verbs, Then the payload prices the debt from the mode's own ruleset", () => {
    expect(extract("loan.take")).toEqual({
      type: "loan.take",
      expectedRevision: 12,
      // The engine offered 1,200 and the mode caps a principal at 2,000.
      maxPrincipal: 1_200,
      interestBasisPoints: 1_000,
    });
    expect(extract("loan.repay")).toEqual({
      type: "loan.repay",
      expectedRevision: 12,
      loans: [{ loanId: "loan-1", outstanding: 550 }],
      maxAmount: 800,
    });
  });

  it("Given an offerable table, When mapping the offer verb, Then the payload carries who may be offered to and the form's own limits", () => {
    expect(extract("agreement.offer")).toEqual({
      type: "agreement.offer",
      expectedRevision: 12,
      recipientIds: ["player-b", "player-c"],
      itemKinds: ["money", "card", "token", "tile", "immunity", "promise"],
      maxRecipients: 2,
      maxItemsPerSide: 8,
      promiseTextMaxLength: 200,
    });
  });

  it("Given the remaining turn verbs, When mapping them, Then each carries what a control needs and nothing more", () => {
    expect(extract("turn.action")).toEqual({
      type: "turn.action",
      expectedRevision: 12,
      actions: ["work", "network", "scheme", "rest", "role.reveal"],
      remaining: 1,
    });
    expect(extract("turn.play-card").cardIds).toEqual(["card-own-1"]);
    expect(extract("turn.spend-token").tokens).toEqual([
      { tokenId: "token.favour", use: "reroll", maxQuantity: 2 },
    ]);
    expect(extract("turn.activate-character").abilityId).toBe("ability.office-politician");
    expect(extract("promotion.attempt")).toEqual({
      type: "promotion.attempt",
      expectedRevision: 12,
      toRankId: "rank.manager",
      cost: 1_500,
      declined: false,
    });
    expect(extract("management.shuffle-deck").deckIds).toEqual(["deck.work", "deck.event"]);
    expect(extract("reaction.play")).toEqual({
      type: "reaction.play",
      expectedRevision: 12,
      decisionPointId: "window-1",
      kind: "prevention",
      cardIds: ["card-own-1", "card-own-2"],
      abilityIds: ["ability.tech-genius"],
    });
    expect(extract("reaction.pass")).toEqual({
      type: "reaction.pass",
      expectedRevision: 12,
      decisionPointId: "window-1",
      kind: "prevention",
    });
    expect(extract("management.block-promotion")).toEqual({
      type: "management.block-promotion",
      expectedRevision: 12,
      decisionPointId: "window-2",
    });
  });
});

describe("legal actions and the unauthorised actor", () => {
  it("Given an enumeration that names its actor, When mapping it, Then the actor and game never reach the payload", () => {
    // The engine's `LegalAction` carries `gameId` and `actorId`. Neither is
    // declared on the transport input, so neither can be copied: a viewer's
    // identity is resolved from the authenticated session, never from a payload,
    // and a summary that named its actor would invite exactly the opposite.
    const hostile = {
      ...ENUMERATED["turn.roll"],
      gameId: "game-1",
      actorId: "player-b",
    } as EnumeratedLegalAction;

    const summary = summariseUnknown(hostile);

    expect(Object.keys(summary).sort()).toEqual(["expectedRevision", "type"]);
    expect(JSON.stringify(summary)).not.toContain("player-b");
    expect(JSON.stringify(summary)).not.toContain("game-1");
  });

  it("Given the summary union, When something tries to attach an actor to it, Then it does not typecheck", () => {
    const leak: LegalActionSummary = {
      type: "turn.roll",
      expectedRevision: REVISION,
      // @ts-expect-error a legal action never names its actor
      actorId: "player-b",
    };

    expect(leak.type).toBe("turn.roll");
  });

  it("Given a stale revision on the action, When mapping it, Then the revision is carried through untouched", () => {
    // The optimistic-concurrency envelope is the server's guard against a client
    // acting on state it has not seen. Rewriting it here would defeat it.
    const summary = toLegalActionSummary(
      { type: "turn.roll", expectedRevision: 3 },
      context,
    );

    expect(summary).toEqual({ type: "turn.roll", expectedRevision: 3 });
  });
});

function summariseUnknown(action: EnumeratedLegalAction): LegalActionSummary {
  const summary = toLegalActionSummary(action, context);
  if (summary === null) throw new Error("Expected a summary");

  return summary;
}

describe("legal actions and a mode that has the mechanic switched off", () => {
  function withRules(patch: Partial<ModeRules>): LegalActionContext {
    return { ...context, rules: { ...rules, ...patch } };
  }

  it("Given a mode with no dice adjustment, When the enumerator still offers it, Then it does not cross the transport", () => {
    const disabled = withRules({
      agency: { ...rules.agency, diceAdjustEnabled: false, maxPipAdjust: 0 },
    });

    expect(toLegalActionSummary(ENUMERATED["turn.adjust-roll"], disabled)).toBeNull();
  });

  it("Given a mode with a tighter pip ceiling than the enumerator offered, When mapping it, Then the mode's ceiling wins", () => {
    const tight = withRules({ agency: { ...rules.agency, maxPipAdjust: 1 } });

    expect(toLegalActionSummary(ENUMERATED["turn.adjust-roll"], tight)).toMatchObject({
      minPips: -1,
      maxPips: 1,
    });
  });

  it("Given a mode with heat switched off, When mapping the aggressive verbs, Then they advertise no price", () => {
    const noHeat = withRules({ conflict: { ...rules.conflict, heatEnabled: false } });

    expect(toLegalActionSummary(ENUMERATED["attack.target"], noHeat)).toMatchObject({
      heatCost: 0,
    });
    expect(toLegalActionSummary(ENUMERATED["project.sabotage"], noHeat)).toMatchObject({
      heatCost: 0,
    });
  });

  it("Given a mode that does not record promises, When mapping an offer, Then a promise is not an offerable item", () => {
    const noPromises = withRules({
      interaction: { ...rules.interaction, promisesRecorded: false },
    });
    const summary = toLegalActionSummary(ENUMERATED["agreement.offer"], noPromises);

    expect(summary).toMatchObject({
      itemKinds: ["money", "card", "token", "tile", "immunity"],
    });
  });

  it("Given a mode that caps loans below the offered capacity, When mapping it, Then the cap wins, and a zero cap withdraws the verb", () => {
    const capped = withRules({ economy: { ...rules.economy, maxLoanPrincipal: 400 } });
    const none = withRules({ economy: { ...rules.economy, maxLoanPrincipal: 0 } });

    expect(toLegalActionSummary(ENUMERATED["loan.take"], capped)).toMatchObject({
      maxPrincipal: 400,
    });
    expect(toLegalActionSummary(ENUMERATED["loan.take"], none)).toBeNull();
  });

  it("Given an action with an empty option set, When mapping it, Then no control is advertised for it", () => {
    // A button with nothing behind it is worse than no button: the player presses
    // it and the engine refuses. Every list-shaped action withdraws when empty.
    expect(
      toLegalActionSummary(
        { type: "attack.target", expectedRevision: 1, targetPlayerIds: [], vectors: ["x"] },
        context,
      ),
    ).toBeNull();
    expect(
      toLegalActionSummary(
        { type: "turn.play-card", expectedRevision: 1, cardIds: [] },
        context,
      ),
    ).toBeNull();
    expect(
      toLegalActionSummary(
        { type: "project.contribute", expectedRevision: 1, projectIds: [] },
        context,
      ),
    ).toBeNull();
    expect(
      toLegalActionSummary({ type: "agreement.offer", expectedRevision: 1 }, {
        ...context,
        otherPlayerIds: [],
      }),
    ).toBeNull();
  });
});

describe("legal actions and hostile input", () => {
  it("Given a non-finite or negative balance, When pricing an action from it, Then the advertised ceiling collapses to zero rather than to NaN", () => {
    const broken: LegalActionContext = {
      ...context,
      spendable: { money: Number.NaN, energy: Number.POSITIVE_INFINITY, work: -40 },
    };

    expect(toLegalActionSummary(ENUMERATED["project.contribute"], broken)).toMatchObject({
      maxMoney: 0,
      maxWork: 0,
    });
    expect(toLegalActionSummary(ENUMERATED["loan.repay"], broken)).toMatchObject({
      maxAmount: 0,
    });
    // A non-finite balance is treated as no balance, not as an unlimited one:
    // contracts may only ever tighten an advertisement. The mode's own 2-pip
    // ceiling still stands, but nothing is advertised as affordable.
    expect(toLegalActionSummary(ENUMERATED["turn.adjust-roll"], broken)).toMatchObject({
      maxPips: 2,
      affordablePips: 0,
    });
  });

  it("Given balances beyond the transport ceiling, When advertising a maximum, Then the maximum is one the request parser would accept", () => {
    const rich: LegalActionContext = {
      ...context,
      spendable: {
        money: Number.MAX_SAFE_INTEGER,
        energy: 9_999,
        work: Number.MAX_SAFE_INTEGER,
      },
    };
    const contribute = toLegalActionSummary(ENUMERATED["project.contribute"], rich);
    const sabotage = toLegalActionSummary(ENUMERATED["project.sabotage"], rich);
    const repay = toLegalActionSummary(ENUMERATED["loan.repay"], rich);

    expect(contribute).toMatchObject({
      maxMoney: MAX_MONEY_AMOUNT,
      maxWork: MAX_WORK_AMOUNT,
    });
    expect(sabotage).toMatchObject({ maxAmount: MAX_WORK_AMOUNT });
    expect(repay).toMatchObject({ maxAmount: MAX_MONEY_AMOUNT });

    // The property that matters: an advertised ceiling always parses. A UI that
    // offers a maximum the parser then refuses is a UI that lies.
    expect(() =>
      parseContributeToProjectRequest({
        commandId: "cmd-1",
        expectedRevision: 12,
        projectId: "project-1",
        money: MAX_MONEY_AMOUNT,
        work: MAX_WORK_AMOUNT,
      }),
    ).not.toThrow();
    expect(() =>
      parseSabotageProjectRequest({
        commandId: "cmd-2",
        expectedRevision: 12,
        projectId: "project-2",
        amount: MAX_WORK_AMOUNT,
        hidden: false,
      }),
    ).not.toThrow();
    expect(() =>
      parseRepayLoanRequest({
        commandId: "cmd-3",
        expectedRevision: 12,
        loanId: "loan-1",
        amount: MAX_MONEY_AMOUNT,
      }),
    ).not.toThrow();
  });

  it("Given an enumerator that offers more pips or money than the parser allows, When mapping it, Then the advertisement is tightened, never widened", () => {
    const summary = toLegalActionSummary(
      {
        type: "turn.adjust-roll",
        expectedRevision: 12,
        maxPips: 9_999,
        energyPerPip: 0,
      },
      { ...context, rules: { ...rules, agency: { ...rules.agency, maxPipAdjust: 9_999 } } },
    );

    expect(summary).toMatchObject({ maxPips: MAX_PIP_ADJUST, minPips: -MAX_PIP_ADJUST });
    expect(() =>
      parseAdjustRollRequest({
        commandId: "cmd-4",
        expectedRevision: 12,
        pips: MAX_PIP_ADJUST,
      }),
    ).not.toThrow();

    const loan = toLegalActionSummary(
      { type: "loan.take", expectedRevision: 12, capacity: Number.MAX_SAFE_INTEGER },
      {
        ...context,
        rules: {
          ...rules,
          economy: { ...rules.economy, maxLoanPrincipal: Number.MAX_SAFE_INTEGER },
        },
      },
    );

    expect(loan).toMatchObject({ maxPrincipal: MAX_MONEY_AMOUNT });
    expect(() =>
      parseTakeLoanRequest({
        commandId: "cmd-5",
        expectedRevision: 12,
        principal: MAX_MONEY_AMOUNT,
      }),
    ).not.toThrow();
  });

  it("Given a token quantity beyond the transport ceiling, When mapping it, Then the advertised quantity is clamped", () => {
    const summary = toLegalActionSummary(
      {
        type: "turn.spend-token",
        expectedRevision: 12,
        tokens: [{ tokenId: "token.favour", use: "reroll", maxQuantity: 10_000 }],
      },
      context,
    );

    expect(summary).toMatchObject({
      tokens: [{ tokenId: "token.favour", use: "reroll", maxQuantity: MAX_TOKEN_QUANTITY }],
    });
  });

  it("Given a ballot the caller failed to describe, When mapping the cast, Then it is treated as sealed", () => {
    const unknown = toLegalActionSummary(
      {
        type: "ballot.cast",
        expectedRevision: 12,
        ballotId: "ballot-unknown",
        kind: "vote",
        subjectId: "player-c",
      },
      context,
    );

    // Sealed is the safe direction to be wrong in: an undescribed ballot renders
    // without a tally rather than with somebody else's votes.
    expect(unknown).toMatchObject({ sealed: true, ballot: { kind: "vote", options: null } });
  });

  it("Given a negative minimum bid, When mapping an auction, Then the range stays inside what the parser accepts", () => {
    const summary = toLegalActionSummary(
      {
        type: "ballot.cast",
        expectedRevision: 12,
        ballotId: "ballot-hostile",
        kind: "auction",
        subjectId: "tile.desk-9",
      },
      {
        ...context,
        ballots: [
          {
            ballotId: "ballot-hostile",
            sealed: true,
            options: null,
            minBid: Number.NEGATIVE_INFINITY,
          },
        ],
      },
    );

    expect(summary).toMatchObject({ ballot: { kind: "auction", minBid: 0, maxBid: 800 } });
    expect(() =>
      parseCastBallotRequest({
        commandId: "cmd-6",
        expectedRevision: 12,
        ballotId: "ballot-hostile",
        value: 800,
      }),
    ).not.toThrow();
  });

  it("Given an agreement the caller failed to describe, When mapping the response, Then the terms are empty rather than invented", () => {
    const summary = toLegalActionSummary(
      {
        type: "agreement.respond",
        expectedRevision: 12,
        agreementId: "agreement-unknown",
        proposerId: "player-c",
      },
      context,
    );

    expect(summary).toMatchObject({ give: [], receive: [], expiresAtRound: 0 });
  });

  it("Given mutable arrays on the input, When mapping them, Then the summary owns its own copies", () => {
    const cardIds = ["card-own-1"];
    const summary = toLegalActionSummary(
      { type: "turn.play-card", expectedRevision: 12, cardIds },
      context,
    );
    cardIds.push("card-own-2");

    expect(summary).toMatchObject({ cardIds: ["card-own-1"] });
  });
});

describe("legal actions as a redaction boundary", () => {
  it("Given a full enumeration and a table full of secrets, When serialising the payload, Then no secret appears in it", () => {
    // Everything a hostile caller might have in scope when it builds the context:
    // another player's hand, their secret objective, a sealed ballot's tally.
    const payload = JSON.stringify(toLegalActionSummaries(ALL_ACTIONS, context));

    // The actor's own card *instances* are present — they are how the actor names
    // a card they already hold — but nothing describes any card's identity. The
    // quoted key is what is asserted against, because `project.start` carries
    // `definitionIds`: a project definition is authored, public content, and not
    // the same fact as which card is in whose hand.
    expect(payload).toContain("card-own-1");
    expect(payload).not.toContain('"definitionId"');
    expect(payload).not.toContain("card.overtime");
    expect(payload).not.toContain("nameKey");
    // No ballot state beyond the shape of the cast.
    expect(payload).not.toContain("castBy");
    expect(payload).not.toContain("tally");
    // No objective reaches a legal action at all: there is no objective command,
    // so a secret objective has no route through this boundary.
    expect(payload).not.toContain("objective");
    // Targets are named as seats; nothing about their balances travels with them.
    expect(payload).toContain("player-b");
    expect(payload).not.toContain("resources");
    expect(payload).not.toContain("hand");
  });

  it("Given a card-bearing action, When something tries to describe the card, Then it does not typecheck", () => {
    type PlayCard = Extract<LegalActionSummary, { readonly type: "turn.play-card" }>;

    const leak: PlayCard = {
      type: "turn.play-card",
      expectedRevision: REVISION,
      // @ts-expect-error a playable card is an opaque id, never a described card
      cardIds: [{ id: "card-own-1", definitionId: "card.overtime" }],
    };
    const withHand: PlayCard = {
      type: "turn.play-card",
      expectedRevision: REVISION,
      cardIds: ["card-own-1"],
      // @ts-expect-error a legal action has no shape that can carry a hand
      hand: [{ id: "card-rival-1", definitionId: "card.overtime" }],
    };

    expect(leak.type).toBe("turn.play-card");
    expect(withHand.cardIds).toEqual(["card-own-1"]);
  });

  it("Given a ballot cast, When something tries to attach the in-flight votes to it, Then it does not typecheck", () => {
    type Cast = Extract<LegalActionSummary, { readonly type: "ballot.cast" }>;

    const leak: Cast = {
      type: "ballot.cast",
      expectedRevision: REVISION,
      ballotId: "ballot-auction",
      subjectId: "tile.desk-9",
      sealed: true,
      ballot: { kind: "auction", minBid: 100, maxBid: 800 },
      // @ts-expect-error §7.2: sealed casts must not leak, including via castBy keys
      castBy: { "player-b": 900 },
    };
    const withCount: Cast = {
      type: "ballot.cast",
      expectedRevision: REVISION,
      ballotId: "ballot-auction",
      subjectId: "tile.desk-9",
      sealed: true,
      ballot: { kind: "auction", minBid: 100, maxBid: 800 },
      // @ts-expect-error a running total of a sealed ballot is the thing being hidden
      castCount: 2,
    };
    const votesAsAuction: Cast = {
      type: "ballot.cast",
      expectedRevision: REVISION,
      ballotId: "ballot-vote",
      subjectId: "player-b",
      sealed: false,
      // @ts-expect-error a vote has no bid range and an auction has no option list
      ballot: { kind: "vote", options: ["player-b"], maxBid: 800 },
    };

    expect(leak.ballotId).toBe("ballot-auction");
    expect(withCount.sealed).toBe(true);
    expect(votesAsAuction.sealed).toBe(false);
  });

  it("Given a targeted attack, When something tries to describe the target, Then it does not typecheck", () => {
    type Attack = Extract<LegalActionSummary, { readonly type: "attack.target" }>;

    const leak: Attack = {
      type: "attack.target",
      expectedRevision: REVISION,
      targetPlayerIds: ["player-b"],
      vectors: ["attack.rumour"],
      heatCost: 2,
      // @ts-expect-error a target's balances are not part of the offer to attack them
      targetResources: { "player-b": { money: 4_000 } },
    };
    const withObjective: Attack = {
      type: "attack.target",
      expectedRevision: REVISION,
      targetPlayerIds: ["player-b"],
      vectors: ["attack.rumour"],
      heatCost: 2,
      // @ts-expect-error a secret objective has no route through a legal action
      targetObjectiveId: "objective.hoard-cash-rival",
    };

    expect(leak.heatCost).toBe(2);
    expect(withObjective.targetPlayerIds).toEqual(["player-b"]);
  });

  it("Given the context type, When something tries to put another player's private state in it, Then it does not typecheck", () => {
    const leak: LegalActionContext = {
      ...context,
      // @ts-expect-error the context carries the actor's own balances, nobody else's
      opponentSpendable: { "player-b": { money: 4_000, energy: 3, work: 2 } },
    };
    const withTally: LegalActionContext = {
      ...context,
      ballots: [
        {
          ballotId: "ballot-auction",
          sealed: true,
          options: null,
          minBid: 100,
          // @ts-expect-error a ballot's in-flight casts have no home on the context
          castBy: { "player-b": 900 },
        },
      ],
    };

    expect(leak.otherPlayerIds).toEqual(["player-b", "player-c"]);
    expect(withTally.ballots).toHaveLength(1);
  });

  it("Given a summary, When round-tripping it through JSON, Then it survives unchanged", () => {
    // Legal actions travel in the bootstrap and over the WS fan-out, both of which
    // go through `JSON.stringify`. Anything that does not survive that is silently
    // dropped between the server deciding an action is legal and the UI drawing it.
    const summaries = toLegalActionSummaries(ALL_ACTIONS, context);

    expect(JSON.parse(JSON.stringify(summaries))).toEqual(summaries);
  });
});
