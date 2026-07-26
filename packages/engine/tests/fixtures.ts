import { deadlineDashModes } from "@office-ladder/content";

import { GAME_STATE_SCHEMA_VERSION } from "../src";
import type {
  AbilityId,
  AgreementId,
  BallotId,
  CardDefinitionId,
  CardInstanceId,
  CharacterId,
  ContentReleaseId,
  DecisionPointId,
  DeckId,
  EffectId,
  FrameId,
  GameId,
  GameState,
  HeatState,
  IncomeStreamId,
  LoanId,
  ModeId,
  ModeRules,
  ObjectiveId,
  PlacementId,
  PlayerId,
  ProjectId,
  PromptOptionId,
  QuarterState,
  RankId,
  ResourceId,
  RoleId,
  RulesetId,
  StatusId,
  TileId,
  TokenId,
  UpkeepState,
} from "../src";

const branded = <Id extends string>(value: string) => value as Id;

/**
 * The base fixture plays under the **Quick** preset's ruleset — the one with
 * ownership, projects, loans, quarters and heat all switched off.
 *
 * That is deliberate and load-bearing. Every v2 mechanic is gated on
 * `state.rules`, so whichever preset this fixture carries silently becomes the
 * precondition of the ~300 turn-loop tests built on it. Quick is the preset those
 * tests were actually written against (`setup.test.ts` and `game-scenario.test.ts`
 * both name `mode.quick`), and it keeps them meaning what they mean today once
 * wave 2 starts reading `rules` inside the roll transition.
 *
 * A test about a v2 mechanic should opt in — `withRules` in
 * `turn-loop-fixtures.ts` for one flag, or `createSharedSpaceGameState` below for
 * a whole table with everything on.
 */
export const fixtureRules: ModeRules = deadlineDashModes["mode.quick"].rules;

/** The everything-on counterpart, used by `createSharedSpaceGameState`. */
export const sharedSpaceRules: ModeRules =
  deadlineDashModes["mode.standard"].rules;

const upkeep = (perRound: number): UpkeepState => ({
  perRound,
  lastChargedRound: 0,
  missedPayments: 0,
});

const heat = (value: number, rules: ModeRules = fixtureRules): HeatState => ({
  value,
  threshold: rules.conflict.heatThreshold,
  investigationsOpened: 0,
  lastIncrementedAtRound: null,
});

export const fixtureIds = {
  owner: branded<PlayerId>("player-owner"),
  hiddenOpponent: branded<PlayerId>("player-hidden-opponent"),
  revealedOpponent: branded<PlayerId>("player-revealed-opponent"),
  deck: branded<DeckId>("deck-work"),
  ownerHandCard: branded<CardInstanceId>("card-owner-hand-secret"),
  hiddenOpponentHandCard: branded<CardInstanceId>(
    "card-hidden-opponent-hand-secret",
  ),
  revealedOpponentHandCard: branded<CardInstanceId>(
    "card-revealed-opponent-hand-secret",
  ),
  drawCardFirst: branded<CardInstanceId>("card-draw-order-first-secret"),
  drawCardSecond: branded<CardInstanceId>("card-draw-order-second-secret"),
  discardCard: branded<CardInstanceId>("card-discard-secret"),
  visibleCard: branded<CardInstanceId>("card-visible-public"),
} as const;

export const secretSentinels = {
  ownerRoleId: "role-owner-secret",
  hiddenOpponentRoleId: "role-hidden-opponent-secret",
  ownerCharacter: "character-owner-secret",
  hiddenOpponentCharacter: "character-hidden-opponent-secret",
  revealedOpponentCharacter: "character-revealed-opponent-secret",
  ownerHandDefinition: "definition-owner-hand-secret",
  hiddenOpponentHandDefinition: "definition-hidden-opponent-hand-secret",
  revealedOpponentHandDefinition: "definition-revealed-opponent-hand-secret",
  ownerPrivateStatus: "status-owner-private-secret",
  hiddenOpponentPrivateStatus: "status-hidden-opponent-private-secret",
  rng: "rng-state-secret-7f3d",
  internalStack: "resolution-stack-secret-92aa",
  pendingEffect: "pending-effect-secret-31bc",
  drawFirstDefinition: "definition-draw-first-secret",
  drawSecondDefinition: "definition-draw-second-secret",
  discardDefinition: "definition-discard-secret",
  hiddenOpponentPrompt: "prompt-hidden-opponent-secret",
} as const;

const card = (
  id: CardInstanceId,
  definitionId: string,
  zone: "draw-pile" | "discard-pile" | "hand" | "visible",
  ownerId: PlayerId | null = null,
) => ({
  id,
  definitionId: branded<CardDefinitionId>(definitionId),
  deckId: fixtureIds.deck,
  zone,
  ownerId,
  faceUp: zone === "visible",
  data: { marker: definitionId },
});

const publicStatus = (value: string) => ({
  id: branded<StatusId>(value),
  sourceId: "public-source",
  stacks: 2,
  remainingTurns: 1,
  expiresAtRound: null,
  visibility: "public" as const,
  data: { marker: value },
});

const privateStatus = (value: string) => ({
  id: branded<StatusId>(value),
  sourceId: "private-source",
  stacks: 1,
  remainingTurns: null,
  expiresAtRound: 5,
  visibility: "private" as const,
  data: { marker: value },
});

export function createCanonicalGameState(): GameState {
  const ownerRoleId = branded<RoleId>(secretSentinels.ownerRoleId);
  const hiddenOpponentRoleId = branded<RoleId>(
    secretSentinels.hiddenOpponentRoleId,
  );
  const revealedRoleId = branded<RoleId>("role-revealed-public");

  return {
    gameId: branded<GameId>("game-canonical-fixture"),
    modeId: branded<ModeId>("mode-deadline-dash"),
    rules: fixtureRules,
    versions: {
      stateSchemaVersion: GAME_STATE_SCHEMA_VERSION,
      replaySchemaVersion: 1,
      engineVersion: "engine-test-1",
      rulesVersion: "rules-test-1",
      rulesetId: branded<RulesetId>("ruleset-test"),
      contentReleaseId: branded<ContentReleaseId>("content-test"),
      contentHash: "content-hash-test",
    },
    status: "active",
    revision: 17,
    eventSequence: 29,
    startAuthorizedPlayerId: fixtureIds.owner,
    playerOrder: [
      fixtureIds.owner,
      fixtureIds.hiddenOpponent,
      fixtureIds.revealedOpponent,
    ],
    players: {
      [fixtureIds.owner]: {
        id: fixtureIds.owner,
        order: 0,
        connected: true,
        position: 3,
        lapsCompleted: 1,
        rank: {
          id: branded<RankId>("rank-owner"),
          kind: "rank.staff",
          index: 1,
        },
        role: { id: ownerRoleId, kind: "role.worker", revealed: false },
        characterId: branded<CharacterId>(secretSentinels.ownerCharacter),
        resources: {
          money: {
            id: branded<ResourceId>("resource-owner-money"),
            kind: "resource.money",
            value: 12,
            minimum: 0,
            maximum: null,
          },
        },
        tokens: {
          momentum: {
            id: branded<TokenId>("token-owner-momentum"),
            kind: "token.momentum",
            count: 1,
            maximum: 3,
          },
        },
        hand: [fixtureIds.ownerHandCard],
        statuses: [
          publicStatus("status-owner-public"),
          privateStatus(secretSentinels.ownerPrivateStatus),
        ],
        abilities: [
          {
            id: branded<AbilityId>("ability-owner-secret"),
            usesRemaining: 1,
            cooldownLapsRemaining: 0,
            data: { marker: "ability-owner-data-secret" },
          },
        ],
        skipTurns: 0,
        inAudit: false,
        negativeEffectsIgnoredThisLap: 0,
        upkeep: upkeep(0),
        loans: [],
        incomeStreams: [],
        heat: heat(0),
      },
      [fixtureIds.hiddenOpponent]: {
        id: fixtureIds.hiddenOpponent,
        order: 1,
        connected: true,
        position: 8,
        lapsCompleted: 0,
        rank: {
          id: branded<RankId>("rank-hidden-opponent"),
          kind: "rank.intern",
          index: 0,
        },
        role: {
          id: hiddenOpponentRoleId,
          kind: "role.management",
          revealed: false,
        },
        characterId: branded<CharacterId>(
          secretSentinels.hiddenOpponentCharacter,
        ),
        resources: {},
        tokens: {},
        hand: [fixtureIds.hiddenOpponentHandCard],
        statuses: [
          privateStatus(secretSentinels.hiddenOpponentPrivateStatus),
        ],
        abilities: [
          {
            id: branded<AbilityId>("ability-hidden-opponent-secret"),
            usesRemaining: null,
            cooldownLapsRemaining: 2,
            data: { marker: "ability-hidden-opponent-data-secret" },
          },
        ],
        skipTurns: 1,
        inAudit: true,
        negativeEffectsIgnoredThisLap: 0,
        upkeep: upkeep(0),
        loans: [],
        incomeStreams: [],
        heat: heat(0),
      },
      [fixtureIds.revealedOpponent]: {
        id: fixtureIds.revealedOpponent,
        order: 2,
        connected: false,
        position: 13,
        lapsCompleted: 2,
        rank: {
          id: branded<RankId>("rank-revealed-opponent"),
          kind: "rank.supervisor",
          index: 3,
        },
        role: {
          id: revealedRoleId,
          kind: "role.management",
          revealed: true,
        },
        characterId: branded<CharacterId>(
          secretSentinels.revealedOpponentCharacter,
        ),
        resources: {},
        tokens: {},
        hand: [fixtureIds.revealedOpponentHandCard],
        statuses: [publicStatus("status-revealed-opponent-public")],
        abilities: [],
        skipTurns: 0,
        inAudit: false,
        negativeEffectsIgnoredThisLap: 0,
        upkeep: upkeep(0),
        loans: [],
        incomeStreams: [],
        heat: heat(0),
      },
    },
    turn: {
      number: 4,
      round: 2,
      activePlayerId: fixtureIds.owner,
      phase: "prompt",
      startedAt: "2026-07-18T10:00:00.000Z",
      deadlineAt: "2026-07-18T10:00:30.000Z",
    },
    boardSize: 28,
    tileIds: Array.from({ length: 28 }, (_, index) =>
      branded<TileId>(`tile-${index}`),
    ),
    decks: {
      [fixtureIds.deck]: {
        id: fixtureIds.deck,
        kind: "deck.work",
        drawPile: [fixtureIds.drawCardFirst, fixtureIds.drawCardSecond],
        discardPile: [fixtureIds.discardCard],
        visibleCards: [fixtureIds.visibleCard],
        reshufflesWhenEmpty: true,
        managementShuffleEligible: true,
        shuffleCount: 2,
      },
    },
    cards: {
      [fixtureIds.ownerHandCard]: card(
        fixtureIds.ownerHandCard,
        secretSentinels.ownerHandDefinition,
        "hand",
        fixtureIds.owner,
      ),
      [fixtureIds.hiddenOpponentHandCard]: card(
        fixtureIds.hiddenOpponentHandCard,
        secretSentinels.hiddenOpponentHandDefinition,
        "hand",
        fixtureIds.hiddenOpponent,
      ),
      [fixtureIds.revealedOpponentHandCard]: card(
        fixtureIds.revealedOpponentHandCard,
        secretSentinels.revealedOpponentHandDefinition,
        "hand",
        fixtureIds.revealedOpponent,
      ),
      [fixtureIds.drawCardFirst]: card(
        fixtureIds.drawCardFirst,
        secretSentinels.drawFirstDefinition,
        "draw-pile",
      ),
      [fixtureIds.drawCardSecond]: card(
        fixtureIds.drawCardSecond,
        secretSentinels.drawSecondDefinition,
        "draw-pile",
      ),
      [fixtureIds.discardCard]: card(
        fixtureIds.discardCard,
        secretSentinels.discardDefinition,
        "discard-pile",
      ),
      [fixtureIds.visibleCard]: card(
        fixtureIds.visibleCard,
        "definition-visible-public",
        "visible",
      ),
    },
    resolutionStack: [
      {
        id: branded<FrameId>("frame-internal-secret"),
        kind: "resolve-card",
        parentFrameId: null,
        sourceId: "internal-source-secret",
        actingPlayerId: fixtureIds.hiddenOpponent,
        affectedPlayerIds: [fixtureIds.owner],
        remainingOperations: [{ marker: secretSentinels.internalStack }],
        capturedValues: { marker: secretSentinels.internalStack },
        visibility: "server",
      },
    ],
    prompts: [
      {
        id: branded<DecisionPointId>("prompt-owner"),
        frameId: branded<FrameId>("frame-owner-prompt"),
        kind: "owner-choice",
        audience: [fixtureIds.owner],
        legalResponses: [
          {
            id: branded<PromptOptionId>("option-owner"),
            value: "owner-option-private",
          },
        ],
        deadlineAt: "2026-07-18T10:00:25.000Z",
        defaultResponse: {
          optionId: branded<PromptOptionId>("option-owner"),
          value: "owner-default-private",
        },
        visibility: "private",
        responses: {},
      },
      {
        id: branded<DecisionPointId>("prompt-hidden-opponent"),
        frameId: branded<FrameId>("frame-hidden-opponent-prompt"),
        kind: secretSentinels.hiddenOpponentPrompt,
        audience: [fixtureIds.hiddenOpponent],
        legalResponses: [
          {
            id: branded<PromptOptionId>("option-hidden-opponent"),
            value: secretSentinels.hiddenOpponentPrompt,
          },
        ],
        deadlineAt: null,
        defaultResponse: {
          optionId: branded<PromptOptionId>("option-hidden-opponent"),
          value: secretSentinels.hiddenOpponentPrompt,
        },
        visibility: "sealed",
        responses: {},
      },
    ],
    pendingEffects: [
      {
        id: branded<EffectId>("effect-pending-secret"),
        frameId: branded<FrameId>("frame-internal-secret"),
        sourceId: "pending-source-secret",
        affectedPlayerIds: [fixtureIds.owner],
        effect: { marker: secretSentinels.pendingEffect },
        preventionEligible: true,
        visibility: "server",
      },
    ],
    reactionWindows: [
      {
        id: branded<DecisionPointId>("reaction-owner"),
        frameId: branded<FrameId>("frame-reaction-owner"),
        kind: "prevention",
        eligiblePlayerIds: [fixtureIds.owner],
        priorityPlayerId: fixtureIds.owner,
        passedPlayerIds: [],
        playedByPlayerIds: [],
        deadlineAt: "2026-07-18T10:00:20.000Z",
        pendingEffectId: branded<EffectId>("effect-pending-secret"),
      },
    ],
    rng: {
      streams: {
        dice: {
          algorithm: "test-prng",
          version: "1",
          state: secretSentinels.rng,
          cursor: 41,
        },
      },
    },
    tileOwnership: {},
    placements: [],
    projects: [],
    agreements: [],
    objectives: [],
    ballots: [],
    quarters: fixtureQuarters(),
    currentQuarterIndex: 0,
    eliminatedPlayerIds: [],
    marathonEndgame: null,
    outcome: null,
    quarantine: null,
    lastCommandId: null,
    stateHash: "state-hash-test",
  };
}

/**
 * The quarter schedule implied by a ruleset, laid out exactly the way
 * `createGame` lays it out: 1-based rounds, contiguous, no scheduled events yet.
 * Empty when the ruleset has quarters switched off, which is the Quick preset the
 * base fixture uses.
 */
function fixtureQuarters(rules: ModeRules = fixtureRules): readonly QuarterState[] {
  if (!rules.quarters.enabled) {
    return [];
  }

  const { count, roundsEach } = rules.quarters;

  return Array.from({ length: count }, (_, index) => ({
    index,
    startedAtRound: index * roundsEach + 1,
    endsAtRound: (index + 1) * roundsEach,
    scheduledEventId: null,
    resolvedEventIds: [],
  }));
}

/**
 * Sentinels for the v2 shared-space fixture below. Kept separate from
 * `secretSentinels` so a test can assert on the hidden-information shapes that
 * did not exist before gameplay v2 without pulling in the card/role set.
 */
export const sharedSpaceSentinels = {
  ownerOnlyPlacement: "placement-owner-only-secret",
  secretObjective: "objective-secret-definition-secret",
  partiesOnlyPromise: "agreement-parties-only-promise-secret",
  sealedBallotCast: "ballot-sealed-cast-secret",
} as const;

/**
 * Hidden sabotage has no free-text field to hide a sentinel in, so it is the one
 * §7.2 case that has to be asserted structurally: no viewer other than
 * `fixtureIds.hiddenOpponent` may see a `sabotage` entry with `hidden: true`, and
 * the leaked amount (150) must not appear in their payload either.
 */
export const hiddenSabotageAmount = 150;

export const sharedSpaceIds = {
  ownedTile: branded<TileId>("tile-5"),
  placedTile: branded<TileId>("tile-9"),
  publicPlacement: branded<PlacementId>("placement-public"),
  ownerOnlyPlacement: branded<PlacementId>("placement-owner-only"),
  project: branded<ProjectId>("project-rebrand"),
  publicAgreement: branded<AgreementId>("agreement-public"),
  partiesOnlyAgreement: branded<AgreementId>("agreement-parties-only"),
  publicObjective: branded<ObjectiveId>("objective-public"),
  secretObjective: branded<ObjectiveId>("objective-secret"),
  sealedBallot: branded<BallotId>("ballot-sealed"),
  openBallot: branded<BallotId>("ballot-open"),
} as const;

/**
 * The canonical state with every gameplay-v2 shared-space collection populated,
 * including one instance of each hidden-information case the spec's §7.2 calls
 * out: an `owner-only` placement, a `hidden` sabotage entry, a `secret`
 * objective, a `parties-only` agreement, and a `sealed` ballot with a cast still
 * in flight. Every one of those carries a `sharedSpaceSentinels` string, so a
 * projection leak shows up as a substring match rather than as a shape mismatch.
 *
 * Deliberately *not* folded into `createCanonicalGameState`: the base fixture
 * feeds several hundred existing turn-loop tests, and quietly handing them a
 * table full of projects and ballots would change what those tests are about.
 * Opt in from the tests that are about shared space.
 */
export function createSharedSpaceGameState(): GameState {
  const state = createCanonicalGameState();
  const { owner, hiddenOpponent, revealedOpponent } = fixtureIds;
  const rules = sharedSpaceRules;

  return {
    ...state,
    rules,
    quarters: fixtureQuarters(rules),
    players: {
      ...state.players,
      [owner]: {
        ...state.players[owner],
        upkeep: upkeep(rules.economy.upkeepByRankIndex[1]),
        heat: heat(0, rules),
      },
      [hiddenOpponent]: {
        ...state.players[hiddenOpponent],
        upkeep: upkeep(rules.economy.upkeepByRankIndex[0]),
        loans: [
          {
            id: branded<LoanId>("loan-hidden-opponent"),
            principal: 500,
            outstanding: 500,
            interestBasisPoints: rules.economy.interestBasisPoints,
            takenAtRound: 1,
          },
        ],
        /** Non-zero on purpose: heat is public, so a projection must carry it. */
        heat: heat(2, rules),
      },
      [revealedOpponent]: {
        ...state.players[revealedOpponent],
        upkeep: upkeep(rules.economy.upkeepByRankIndex[3]),
        incomeStreams: [
          {
            id: branded<IncomeStreamId>("income-revealed-opponent-rent"),
            kind: "rent",
            perRound: 25,
            remainingRounds: null,
            sourceId: sharedSpaceIds.ownedTile,
          },
        ],
        heat: heat(0, rules),
      },
    },
    tileOwnership: {
      [sharedSpaceIds.ownedTile]: {
        tileId: sharedSpaceIds.ownedTile,
        ownerId: revealedOpponent,
        level: 1,
        claimedAtRound: 1,
        tollPaidCount: 2,
      },
    },
    placements: [
      {
        id: sharedSpaceIds.publicPlacement,
        kind: "placement.rumour",
        tileId: sharedSpaceIds.placedTile,
        ownerId: owner,
        charges: 1,
        visibility: "public",
        placedAtRound: 2,
        data: { marker: "placement-public-marker" },
      },
      {
        id: sharedSpaceIds.ownerOnlyPlacement,
        kind: "placement.surveillance",
        tileId: sharedSpaceIds.placedTile,
        ownerId: hiddenOpponent,
        charges: 1,
        visibility: "owner-only",
        placedAtRound: 2,
        data: { marker: sharedSpaceSentinels.ownerOnlyPlacement },
      },
    ],
    projects: [
      {
        id: sharedSpaceIds.project,
        definitionId: "project.rebrand",
        leadPlayerId: owner,
        tileId: sharedSpaceIds.placedTile,
        status: "open",
        requiredMoney: 900,
        requiredWork: 6,
        contributions: [
          { playerId: owner, money: 300, work: 2, atRound: 1 },
          { playerId: revealedOpponent, money: 100, work: 1, atRound: 2 },
        ],
        sabotage: [
          { playerId: revealedOpponent, amount: 50, hidden: false, atRound: 2 },
          { playerId: hiddenOpponent, amount: 150, hidden: true, atRound: 2 },
        ],
        deadlineRound: 6,
        payout: { money: 1500, reputation: 3, objectiveProgress: 1 },
        openToJoin: true,
        leadBonusBasisPoints: 2500,
      },
    ],
    agreements: [
      {
        id: sharedSpaceIds.publicAgreement,
        proposerId: owner,
        recipientIds: [revealedOpponent],
        give: [{ kind: "money", amount: 200 }],
        receive: [{ kind: "tile", tileId: sharedSpaceIds.ownedTile }],
        status: "offered",
        offeredAtRound: 2,
        expiresAtRound: 4,
        acceptedBy: [],
        visibility: "public",
      },
      {
        id: sharedSpaceIds.partiesOnlyAgreement,
        proposerId: hiddenOpponent,
        recipientIds: [revealedOpponent],
        give: [{ kind: "immunity", rounds: 2 }],
        receive: [
          { kind: "promise", text: sharedSpaceSentinels.partiesOnlyPromise },
        ],
        status: "accepted",
        offeredAtRound: 1,
        expiresAtRound: 5,
        acceptedBy: [revealedOpponent],
        visibility: "parties-only",
      },
    ],
    objectives: [
      {
        id: sharedSpaceIds.publicObjective,
        definitionId: "objective.ship-two-projects",
        ownerId: null,
        progress: 1,
        target: 2,
        completedAtRound: null,
        visibility: "public",
        rewardPoints: 500,
        rewardMoney: 0,
      },
      {
        id: sharedSpaceIds.secretObjective,
        definitionId: sharedSpaceSentinels.secretObjective,
        ownerId: hiddenOpponent,
        progress: 2,
        target: 3,
        completedAtRound: null,
        visibility: "secret",
        rewardPoints: 750,
        rewardMoney: 250,
      },
    ],
    ballots: [
      {
        id: sharedSpaceIds.openBallot,
        kind: "vote",
        subjectId: "vote.block-promotion",
        subject: { targetPlayerId: owner },
        audience: [owner, hiddenOpponent, revealedOpponent],
        castBy: { [revealedOpponent]: "against" },
        deadlineAt: "2026-07-18T10:00:45.000Z",
        closesAtRound: 3,
        visibility: "open",
        resolution: null,
      },
      {
        id: sharedSpaceIds.sealedBallot,
        kind: "auction",
        subjectId: "auction.corner-office",
        subject: { tileId: sharedSpaceIds.ownedTile },
        audience: [owner, hiddenOpponent, revealedOpponent],
        castBy: { [hiddenOpponent]: sharedSpaceSentinels.sealedBallotCast },
        deadlineAt: "2026-07-18T10:00:50.000Z",
        closesAtRound: 3,
        visibility: "sealed",
        resolution: null,
      },
    ],
  };
}
