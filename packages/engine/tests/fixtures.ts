import type {
  AbilityId,
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
  ModeId,
  PlayerId,
  PromptOptionId,
  RankId,
  ResourceId,
  RoleId,
  RulesetId,
  StatusId,
  TileId,
  TokenId,
} from "../src";

const branded = <Id extends string>(value: string) => value as Id;

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
    versions: {
      stateSchemaVersion: 1,
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
    marathonEndgame: null,
    outcome: null,
    quarantine: null,
    lastCommandId: null,
    stateHash: "state-hash-test",
  };
}
