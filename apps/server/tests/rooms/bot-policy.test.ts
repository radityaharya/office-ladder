import { describe, expect, it } from "vitest";

import { createStableId, type LegalAction, type PlayerId } from "@office-ladder/engine";
import {
  AUDIT_RELEASE_FINE,
  decideBotAction,
  type BotDecision,
} from "../../src/rooms/bots/bot-policy";
import type { BotSelfView, BotTableView } from "../../src/rooms/bots/bot-view";

const botPlayerId = createStableId("PlayerId", "bot:room-policy-test:0");
const leaderId = createStableId("PlayerId", "user-leader");
const underdogId = createStableId("PlayerId", "user-underdog");
const gameId = createStableId("GameId", "game-policy-test");
const decisionPointId = createStableId("DecisionPointId", "prompt-audit-release");

const base = { gameId, actorId: botPlayerId, expectedRevision: 7 } as const;

/**
 * A table with nothing going on: no money pressure, no obligations, nobody
 * ahead. Every test below states only the fields its rule depends on, so a rule
 * that starts reading something new fails the tests that never set it.
 */
type TableOverrides = Omit<Partial<BotTableView>, "self"> & {
  readonly self?: Partial<BotSelfView>;
};

function table(overrides: TableOverrides = {}): BotTableView {
  return {
    self: {
      playerId: botPlayerId,
      money: 1_000,
      energy: 10,
      energyMaximum: 10,
      workCounter: 0,
      reputation: 5,
      rankIndex: 1,
      heat: 0,
      heatThreshold: 3,
      upkeepPerRound: 0,
      outstandingDebt: 0,
      inAudit: false,
      handSize: 0,
      pendingRollPips: 0,
      ...overrides.self,
    },
    rivals: overrides.rivals ?? [],
    round: overrides.round ?? 3,
    leaderId: overrides.leaderId ?? null,
    reactionWindows: overrides.reactionWindows ?? [],
    ballots: overrides.ballots ?? [],
    agreements: overrides.agreements ?? [],
    projects: overrides.projects ?? [],
    canNegotiate: overrides.canNegotiate ?? true,
    heatEnabled: overrides.heatEnabled ?? true,
    freeActionEnergyCost: overrides.freeActionEnergyCost ?? 1,
  };
}

function rollAction(): LegalAction {
  return { ...base, type: "turn.roll", payload: {} };
}

function auditPromptAction(
  options: readonly string[] = ["pay-fine", "attempt-roll"],
): LegalAction {
  return {
    ...base,
    type: "prompt.respond",
    decisionPointId,
    kind: "audit-release",
    options: options.map((option) => createStableId("PromptOptionId", option)),
  };
}

function promotionActions(
  cost: number,
  declined = false,
): readonly [LegalAction, LegalAction] {
  return [
    { ...base, type: "promotion.attempt", toRankId: "rank.manager", cost, declined },
    { ...base, type: "promotion.decline", payload: {} },
  ];
}

/** Narrows away the `none` arm so a test can read `.command` without a cast. */
function acted(decision: BotDecision): Extract<BotDecision, { command: unknown }> {
  if (decision.kind === "none") throw new Error("expected the bot to act");
  return decision;
}

describe("decideBotAction — the audit prompt", () => {
  it("Given the content pack, When reading the audit fine, Then it matches the authored alternativeFine", () => {
    expect(AUDIT_RELEASE_FINE).toBe(500);
  });

  it("Given an easy bot with plenty of money, When an audit prompt is open, Then it gambles on the roll", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [auditPromptAction()],
        difficulty: "easy",
        table: table({ self: { money: 100_000 } }),
      }),
    );

    expect(decision.command).toEqual({
      type: "prompt.respond",
      decisionPointId: "prompt-audit-release",
      payload: { optionId: "attempt-roll", value: null },
    });
  });

  it("Given a standard bot with a comfortable balance, When an audit prompt is open, Then it pays the fine", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [auditPromptAction()],
        difficulty: "standard",
        table: table({ self: { money: AUDIT_RELEASE_FINE * 2 } }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { optionId: "pay-fine" } });
  });

  it("Given a standard bot one coin short of its cushion, When an audit prompt is open, Then it gambles instead", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [auditPromptAction()],
        difficulty: "standard",
        table: table({
          self: { money: AUDIT_RELEASE_FINE * 2 - 1 },
        }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { optionId: "attempt-roll" } });
  });

  it("Given a ruthless bot that can just cover the fine, When an audit prompt is open, Then it pays", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [auditPromptAction()],
        difficulty: "ruthless",
        table: table({ self: { money: AUDIT_RELEASE_FINE } }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { optionId: "pay-fine" } });
  });

  it("Given a ruthless bot that cannot afford the fine, When an audit prompt is open, Then it gambles", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [auditPromptAction()],
        difficulty: "ruthless",
        table: table({ self: { money: AUDIT_RELEASE_FINE - 1 } }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { optionId: "attempt-roll" } });
  });

  it("Given a prompt that does not offer the preferred option, When deciding, Then it falls back to an offered one", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [auditPromptAction(["attempt-roll"])],
        difficulty: "ruthless",
        table: table({ self: { money: 100_000 } }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { optionId: "attempt-roll" } });
  });

  it("Given a prompt with no options at all, When deciding, Then no action is taken", () => {
    expect(
      decideBotAction({
        legalActions: [auditPromptAction([])],
        difficulty: "standard",
        table: table(),
      }),
    ).toEqual({ kind: "none" });
  });

  it("Given a prompt and a roll are both legal, When deciding, Then the prompt wins", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), auditPromptAction()],
        difficulty: "standard",
        table: table(),
      }),
    );

    expect(decision.kind).toBe("respond");
  });
});

describe("decideBotAction — the roll", () => {
  it("Given only a roll is legal, When deciding, Then every difficulty rolls", () => {
    for (const difficulty of ["easy", "standard", "ruthless"] as const) {
      expect(
        decideBotAction({ legalActions: [rollAction()], difficulty, table: table() }),
      ).toMatchObject({ kind: "roll", command: { type: "turn.roll" }, expectedRevision: 7 });
    }
  });

  it("Given no legal actions, When deciding, Then no action is taken", () => {
    expect(
      decideBotAction({ legalActions: [], difficulty: "ruthless", table: table() }),
    ).toEqual({ kind: "none" });
  });
});

describe("decideBotAction — promotion, the rung that ends a match", () => {
  it("Given an affordable promotion and no upkeep, When deciding, Then it takes the rung ahead of rolling", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), ...promotionActions(600)],
        difficulty: "standard",
        table: table({ self: { money: 1_000, upkeepPerRound: 0 } }),
      }),
    );

    expect(decision.kind).toBe("promote");
    expect(decision.command).toEqual({ type: "promotion.attempt", payload: {} });
  });

  it("Given a promotion it cannot pay for, When deciding, Then it rolls instead of asking", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), ...promotionActions(5_000)],
        difficulty: "standard",
        table: table({ self: { money: 1_000 } }),
      }),
    );

    expect(decision.kind).toBe("roll");
  });

  it("Given upkeep it could not sustain afterwards, When deciding, Then it declines the rung once", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), ...promotionActions(600)],
        difficulty: "standard",
        table: table({
          self: { money: 1_000, upkeepPerRound: 100 },
        }),
      }),
    );

    expect(decision.kind).toBe("hold");
    expect(decision.command).toEqual({ type: "promotion.decline", payload: {} });
  });

  it("Given it already declined this rung, When deciding again, Then it does not re-decline and rolls on", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), ...promotionActions(600, true)],
        difficulty: "standard",
        table: table({
          self: { money: 1_000, upkeepPerRound: 100 },
        }),
      }),
    );

    expect(decision.kind).toBe("roll");
  });

  it("Given a ruthless bot, When the rung is merely affordable, Then it takes the bet regardless of upkeep", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), ...promotionActions(600)],
        difficulty: "ruthless",
        table: table({
          self: { money: 1_000, upkeepPerRound: 900 },
        }),
      }),
    );

    expect(decision.kind).toBe("promote");
  });
});

describe("decideBotAction — obligations the table is blocked on", () => {
  function reactionActions(kind: "prevention" | "end-turn"): readonly LegalAction[] {
    return [
      {
        ...base,
        type: "reaction.play",
        decisionPointId,
        kind,
        cardIds: [createStableId("CardInstanceId", "card-1")],
        abilityIds: [],
      },
      { ...base, type: "reaction.pass", decisionPointId, kind },
    ];
  }

  it("Given a window aimed at the bot, When it holds a card, Then it defends itself", () => {
    const decision = acted(
      decideBotAction({
        legalActions: reactionActions("prevention"),
        difficulty: "standard",
        table: table({
          reactionWindows: [
            {
              decisionPointId: "prompt-audit-release",
              kind: "prevention",
              aimedAtSelf: true,
            },
          ],
        }),
      }),
    );

    expect(decision.kind).toBe("react");
    expect(decision.command).toMatchObject({
      type: "reaction.play",
      payload: { cardId: "card-1", targetPlayerIds: [botPlayerId] },
    });
  });

  it("Given somebody else's fight, When the bot could still play a card, Then it passes rather than intervening", () => {
    const decision = acted(
      decideBotAction({
        legalActions: reactionActions("prevention"),
        difficulty: "ruthless",
        table: table({
          reactionWindows: [
            {
              decisionPointId: "prompt-audit-release",
              kind: "prevention",
              aimedAtSelf: false,
            },
          ],
        }),
      }),
    );

    expect(decision.kind).toBe("pass");
  });

  it("Given an open window and a roll both legal, When deciding, Then the window is answered first", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), ...reactionActions("end-turn")],
        difficulty: "standard",
        table: table(),
      }),
    );

    expect(decision.kind).toBe("pass");
  });
});

describe("decideBotAction — trades", () => {
  const agreementId = "agreement-1";
  const respond: LegalAction = {
    ...base,
    type: "agreement.respond",
    agreementId: createStableId("AgreementId", agreementId),
    proposerId: leaderId,
  };

  function offer(overrides: Record<string, number> = {}): BotTableView["agreements"] {
    return [
      {
        agreementId,
        proposerId: leaderId,
        givesMoney: 100,
        receivesMoney: 400,
        givesOtherCount: 0,
        receivesPromiseCount: 0,
        ...overrides,
      },
    ];
  }

  it("Given an offer that pays and costs only money it has, When negotiation is on, Then it accepts", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [respond],
        difficulty: "standard",
        table: table({ agreements: offer() }),
      }),
    );

    expect(decision.command).toEqual({
      type: "agreement.respond",
      payload: { agreementId, accept: true },
    });
  });

  it("Given the same offer in a mode where bots cannot negotiate, When deciding, Then it declines", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [respond],
        difficulty: "standard",
        table: table({ agreements: offer(), canNegotiate: false }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { accept: false } });
  });

  it("Given an offer resting on an unenforceable promise, When deciding, Then it declines", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [respond],
        difficulty: "standard",
        table: table({ agreements: offer({ receivesPromiseCount: 1 }) }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { accept: false } });
  });

  it("Given an offer it cannot afford at accept time, When deciding, Then it declines", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [respond],
        difficulty: "standard",
        table: table({
          self: { money: 50 },
          agreements: offer({ givesMoney: 100, receivesMoney: 400 }),
        }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { accept: false } });
  });

  it("Given an offer the table view has no record of, When deciding, Then it declines rather than guessing", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [respond],
        difficulty: "standard",
        table: table({ agreements: [] }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { accept: false } });
  });

  it("Given no offer at all, When deciding, Then it never proposes one of its own", () => {
    const decision = decideBotAction({
      legalActions: [
        rollAction(),
        { ...base, type: "agreement.offer", payload: {} } satisfies LegalAction,
      ],
      difficulty: "ruthless",
      table: table(),
    });

    expect(decision.kind).toBe("roll");
  });
});

describe("decideBotAction — ballots", () => {
  const ballotId = "ballot-1";

  function castAction(kind: "vote" | "auction"): LegalAction {
    return {
      ...base,
      type: "ballot.cast",
      ballotId: createStableId("BallotId", ballotId),
      kind,
      subjectId: "subject-1",
    };
  }

  it("Given a vote it is a candidate in, When deciding, Then it votes for itself", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [castAction("vote")],
        difficulty: "standard",
        table: table({
          ballots: [
            { ballotId, kind: "vote", subjectId: "subject-1", candidateIds: [botPlayerId, leaderId] },
          ],
          rivals: [{ playerId: leaderId, rankIndex: 4, money: 9_000, reputation: 20 }],
        }),
      }),
    );

    expect(decision.command).toEqual({
      type: "ballot.cast",
      payload: { ballotId, value: String(botPlayerId) },
    });
  });

  it("Given a vote between two rivals, When deciding, Then it backs the one furthest behind rather than the leader", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [castAction("vote")],
        difficulty: "standard",
        table: table({
          ballots: [
            {
              ballotId,
              kind: "vote",
              subjectId: "subject-1",
              candidateIds: [leaderId, underdogId],
            },
          ],
          rivals: [
            { playerId: leaderId, rankIndex: 4, money: 9_000, reputation: 20 },
            { playerId: underdogId, rankIndex: 0, money: 100, reputation: 1 },
          ],
        }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { value: String(underdogId) } });
  });

  it("Given an auction, When it has surplus, Then it bids a bounded share and never its whole balance", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [castAction("auction")],
        difficulty: "ruthless",
        table: table({ self: { money: 1_000, upkeepPerRound: 0 } }),
      }),
    );

    expect(decision.command).toEqual({
      type: "ballot.cast",
      payload: { ballotId, value: 250 },
    });
  });

  it("Given an auction it cannot afford, When deciding, Then it still answers, at zero", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [castAction("auction")],
        difficulty: "ruthless",
        table: table({ self: { money: 0, upkeepPerRound: 400 } }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { value: 0 } });
  });
});

describe("decideBotAction — aggression", () => {
  const attackAction: LegalAction = {
    ...base,
    type: "attack.target",
    targetPlayerIds: [leaderId, underdogId],
    vectors: ["vector.smear"],
  };

  function behindTheLeader(overrides: TableOverrides = {}): BotTableView {
    return table({
      leaderId,
      rivals: [
        { playerId: leaderId, rankIndex: 3, money: 9_000, reputation: 30 },
        { playerId: underdogId, rankIndex: 0, money: 10, reputation: 0 },
      ],
      ...overrides,
    });
  }

  it("Given a ruthless bot well behind the leader, When it has heat to spare, Then it attacks the leader and nobody else", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), attackAction],
        difficulty: "ruthless",
        table: behindTheLeader(),
      }),
    );

    expect(decision.command).toEqual({
      type: "attack.target",
      payload: { targetPlayerId: leaderId, vector: "vector.smear", cardId: null },
    });
  });

  it("Given a standard bot in the same position, When deciding, Then it never attacks", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), attackAction],
        difficulty: "standard",
        table: behindTheLeader(),
      }),
    );

    expect(decision.kind).toBe("roll");
  });

  it("Given the leader is barely ahead, When deciding, Then a ruthless bot leaves them alone", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), attackAction],
        difficulty: "ruthless",
        table: behindTheLeader({
          rivals: [{ playerId: leaderId, rankIndex: 1, money: 9_000, reputation: 30 }],
        }),
      }),
    );

    expect(decision.kind).toBe("roll");
  });

  it("Given heat already at the threshold, When deciding, Then it stops attacking", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), attackAction],
        difficulty: "ruthless",
        table: behindTheLeader({
          self: { heat: 3, heatThreshold: 3 },
        }),
      }),
    );

    expect(decision.kind).toBe("roll");
  });
});

describe("decideBotAction — hostile and malformed input", () => {
  /**
   * The list a bot acts on is produced by this server, but the *state* behind it
   * round-trips through a jsonb column and, under a custom ruleset (§8.4), was
   * partly authored in a lobby. A policy that threw on a shape it did not expect
   * would wedge a match, so these assert the ladder degrades instead.
   */
  it("Given a claim whose cost is negative, When deciding, Then it still produces a legal command rather than throwing", () => {
    const decision = decideBotAction({
      legalActions: [
        rollAction(),
        {
          ...base,
          type: "tile.claim",
          tileId: createStableId("TileId", "tile-3"),
          cost: -1_000,
        },
      ],
      difficulty: "standard",
      table: table(),
    });

    expect(decision.kind).toBe("claim");
  });

  it("Given an attack action naming a target that is not on the table, When deciding, Then it does not attack", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [
          rollAction(),
          {
            ...base,
            type: "attack.target",
            targetPlayerIds: [createStableId("PlayerId", "ghost")],
            vectors: ["vector.smear"],
          },
        ],
        difficulty: "ruthless",
        table: table({
          leaderId,
          rivals: [{ playerId: leaderId, rankIndex: 4, money: 1, reputation: 1 }],
        }),
      }),
    );

    expect(decision.kind).toBe("roll");
  });

  it("Given an attack action with no vectors, When deciding, Then it does not attack", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [
          rollAction(),
          { ...base, type: "attack.target", targetPlayerIds: [leaderId], vectors: [] },
        ],
        difficulty: "ruthless",
        table: table({
          leaderId,
          rivals: [{ playerId: leaderId, rankIndex: 4, money: 1, reputation: 1 }],
        }),
      }),
    );

    expect(decision.kind).toBe("roll");
  });

  it("Given a ballot whose candidates are all unknown players, When deciding, Then it votes for itself rather than for a stranger", () => {
    const strangerId = "not-a-seat" as unknown as PlayerId;
    const decision = acted(
      decideBotAction({
        legalActions: [
          {
            ...base,
            type: "ballot.cast",
            ballotId: createStableId("BallotId", "ballot-9"),
            kind: "vote",
            subjectId: "subject-9",
          },
        ],
        difficulty: "standard",
        table: table({
          ballots: [
            {
              ballotId: "ballot-9",
              kind: "vote",
              subjectId: "subject-9",
              candidateIds: [strangerId],
            },
          ],
        }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { value: String(strangerId) } });
  });

  it("Given a loan action offering more capacity than the bot needs, When deciding, Then it borrows only the shortfall", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), { ...base, type: "loan.take", capacity: 100_000 }],
        difficulty: "standard",
        table: table({ self: { money: 0, upkeepPerRound: 200 } }),
      }),
    );

    expect(decision.command).toEqual({
      type: "loan.take",
      payload: { principal: 600 },
    });
  });
});

describe("decideBotAction — contributing to a project", () => {
  /**
   * The exact failure a live match reported:
   *
   * ```text
   * bot.drain.finished actions=0 stop=command-rejected decision=contribute
   *   code=INSUFFICIENT_RESOURCE expected=false
   * ```
   *
   * The contribute branch offered one unit of work whenever a project still
   * wanted work, and never asked whether the bot held any — `BotSelfView` did not
   * expose the work counter at all. `execution/projects.ts` checks money and work
   * *independently*, so the ask was refused even though the money half was
   * affordable; the driver classifies that refusal as unexpected, which stops the
   * drain, and a stopped drain freezes the match for every seat rather than just
   * costing this bot its turn.
   *
   * The fixture above defaults `workCounter: 0` on purpose, so a test that wants
   * a work contribution has to opt in — which is what the second case here does.
   */
  const projectId = "project-1";

  function contributeAction(): LegalAction {
    return {
      ...base,
      type: "project.contribute",
      projectIds: [createStableId("ProjectId", projectId)],
    };
  }

  function leadingOwnProject(overrides: TableOverrides = {}): BotTableView {
    return table({
      projects: [
        {
          projectId,
          leadPlayerId: botPlayerId,
          isOwn: true,
          outstandingMoney: 500,
          outstandingWork: 4,
        },
      ],
      ...overrides,
    });
  }

  it("Given a bot leading a project that still wants work, When it holds no work counter, Then it offers none", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), contributeAction()],
        difficulty: "standard",
        table: leadingOwnProject({ self: { money: 10_000, workCounter: 0 } }),
      }),
    );

    expect(decision.kind).toBe("contribute");
    expect(decision.command).toMatchObject({
      type: "project.contribute",
      payload: { projectId, work: 0 },
    });
  });

  it("Given a bot with no money and no work, When the project still wants both, Then it does not contribute at all", () => {
    // Not merely "offers zero": a contribution of nothing is refused by the
    // parser (`minTotal` is 1), so an empty offer stalls the drain exactly the
    // way an unaffordable one does. Rolling on is the only correct answer.
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), contributeAction()],
        difficulty: "standard",
        table: leadingOwnProject({ self: { money: 0, workCounter: 0 } }),
      }),
    );

    expect(decision.kind).toBe("roll");
  });

  it("Given a bot that does hold work, When it contributes, Then it offers work but never more than it has", () => {
    // The mirror of the regression, and the reason the default has to be opted
    // out of rather than removed: a policy that hardcoded `work: 0` would pass
    // the test above and still be wrong.
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), contributeAction()],
        difficulty: "standard",
        table: leadingOwnProject({ self: { money: 10_000, workCounter: 3 } }),
      }),
    );

    expect(decision.kind).toBe("contribute");
    if (decision.command.type !== "project.contribute") return;
    expect(decision.command.payload.work).toBeGreaterThan(0);
    expect(decision.command.payload.work).toBeLessThanOrEqual(3);
  });

  it("Given a project that wants no more work, When the bot holds plenty, Then it offers none of it", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [rollAction(), contributeAction()],
        difficulty: "standard",
        table: table({
          self: { money: 10_000, workCounter: 9 },
          projects: [
            {
              projectId,
              leadPlayerId: botPlayerId,
              isOwn: true,
              outstandingMoney: 500,
              outstandingWork: 0,
            },
          ],
        }),
      }),
    );

    expect(decision.command).toMatchObject({ payload: { work: 0 } });
  });
});

describe("decideBotAction — verbs it deliberately never uses", () => {
  it("Given it holds Management and a deck is shuffleable, When deciding, Then it does not out itself by shuffling", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [
          rollAction(),
          { ...base, type: "management.shuffle-deck", deckIds: ["deck.work"] },
        ],
        difficulty: "ruthless",
        table: table(),
      }),
    );

    expect(decision.kind).toBe("roll");
  });

  it("Given a free action is available, When deciding, Then it never schemes", () => {
    const decision = acted(
      decideBotAction({
        legalActions: [
          rollAction(),
          { ...base, type: "turn.action", actions: ["scheme"], remaining: 1 },
        ],
        difficulty: "ruthless",
        table: table(),
      }),
    );

    expect(decision.kind).toBe("roll");
  });
});
