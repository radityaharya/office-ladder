import { createSeededRandomSource } from "../random";
import type {
  CardState,
  DeckState,
  HeatState,
  ModeRules,
  PlayerId,
  PlayerState,
  QuarterState,
  ResourceState,
  TokenState,
  UpkeepState,
} from "../model";
import { createStableId, GAME_STATE_SCHEMA_VERSION } from "../model";
import {
  type GameSetup,
  type SetupContent,
  type SetupGameState,
  type SetupIds,
  type SetupModeContent,
  type SetupResult,
} from "./types";
import { validateSetup } from "./validation";

const REPLAY_SCHEMA_VERSION = 1;
const ENGINE_VERSION = "office-ladder-engine/1";

/** Every player starts as an Intern, which is rank index 0. */
const STARTING_RANK_INDEX = 0;

function createContentHash(content: SetupContent): string {
  const serialized = JSON.stringify(content);
  let hash = 2166136261;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * A structural copy of the ruleset rather than a reference to the content pack's
 * own object, so nothing outside the state can ever mutate a live match's rules.
 *
 * The clone is a plain JSON round-trip on purpose: it is exactly the boundary the
 * repository puts the state through anyway, so whatever survives here is
 * guaranteed to survive persistence too.
 */
function snapshotRules(rules: ModeRules): ModeRules {
  return JSON.parse(JSON.stringify(rules)) as ModeRules;
}

function createResources(
  playerId: PlayerId,
  mode: SetupModeContent,
): Readonly<Record<string, ResourceState>> {
  const resource = (
    resourceId: "money" | "reputation" | "energy" | "work-counter",
    kind: ResourceState["kind"],
    value: number,
    maximum: number | null,
  ): ResourceState => ({
    id: createStableId("ResourceId", `${playerId}:resource:${resourceId}`),
    kind,
    value,
    minimum: 0,
    maximum,
  });

  return {
    money: resource("money", "resource.money", mode.startingResources.money, null),
    reputation: resource(
      "reputation",
      "resource.reputation",
      mode.startingResources.reputation,
      null,
    ),
    energy: resource(
      "energy",
      "resource.energy",
      mode.startingResources.energy,
      mode.startingResources.energy,
    ),
    "work-counter": resource(
      "work-counter",
      "resource.work-counter",
      mode.startingResources.workCounter,
      null,
    ),
  };
}

function createTokens(
  playerId: PlayerId,
  mode: SetupModeContent,
): Readonly<Record<string, TokenState>> {
  const token = (
    tokenId: "move" | "momentum" | "reputation" | "money",
    kind: TokenState["kind"],
  ): TokenState => ({
    id: createStableId("TokenId", `${playerId}:token:${tokenId}`),
    kind,
    count: mode.startingTokens[tokenId] ?? 0,
    maximum: mode.tokenCaps[tokenId],
  });

  return {
    move: token("move", "token.move"),
    momentum: token("momentum", "token.momentum"),
    reputation: token("reputation", "token.reputation"),
    money: token("money", "token.money"),
  };
}

/**
 * Read from the ruleset, never from a constant: a mode with `upkeepEnabled`
 * false charges nothing, and one with it enabled charges whatever its ladder
 * says for the starting rank.
 */
function createUpkeep(rules: ModeRules): UpkeepState {
  return {
    perRound: rules.economy.upkeepEnabled
      ? rules.economy.upkeepByRankIndex[STARTING_RANK_INDEX]
      : 0,
    lastChargedRound: 0,
    missedPayments: 0,
  };
}

function createHeat(rules: ModeRules): HeatState {
  return {
    value: 0,
    threshold: rules.conflict.heatThreshold,
    investigationsOpened: 0,
    lastIncrementedAtRound: null,
  };
}

/**
 * The whole quarter schedule, laid out up front rather than appended as the
 * match runs, because the spec requires each quarter's event to be announced a
 * quarter ahead — you cannot announce what does not exist yet.
 *
 * Rounds are 1-based (the first round after `game.start` is round 1), so quarter
 * `i` covers rounds `i * roundsEach + 1` through `(i + 1) * roundsEach`.
 * `scheduledEventId` is null here: which global event lands in which quarter is a
 * seeded decision for the `game.start` transition, not for setup.
 */
function createQuarters(rules: ModeRules): readonly QuarterState[] {
  if (!rules.quarters.enabled) {
    return [];
  }

  return Array.from({ length: rules.quarters.count }, (_, index) => ({
    index,
    startedAtRound: index * rules.quarters.roundsEach + 1,
    endsAtRound: (index + 1) * rules.quarters.roundsEach,
    scheduledEventId: null,
    resolvedEventIds: [],
  }));
}

function createPlayer(
  player: GameSetup["players"][number],
  mode: SetupModeContent,
  ids: SetupIds,
): PlayerState {
  return {
    id: player.id,
    order: player.order,
    connected: true,
    position: 0,
    lapsCompleted: 0,
    rank: { id: ids.internRankId, kind: "rank.intern", index: STARTING_RANK_INDEX },
    role: { ...player.role, revealed: false },
    characterId: player.characterId,
    resources: createResources(player.id, mode),
    tokens: createTokens(player.id, mode),
    hand: [],
    statuses: [],
    abilities: [],
    skipTurns: 0,
    inAudit: false,
    negativeEffectsIgnoredThisLap: 0,
    upkeep: createUpkeep(mode.rules),
    loans: [],
    incomeStreams: [],
    heat: createHeat(mode.rules),
  };
}

export function createGame(
  setup: GameSetup,
  seed: string,
  content: SetupContent,
): SetupResult {
  const validated = validateSetup(setup, content);
  if ("ok" in validated) {
    return validated;
  }

  const ids: SetupIds = {
    contentReleaseId: createStableId("ContentReleaseId", `content:${content.rulesetId}`),
    internRankId: createStableId("RankId", "rank.intern"),
    rulesetId: createStableId("RulesetId", content.rulesetId),
    tileIds: content.board.spaces.map((space) =>
      createStableId("TileId", space.id),
    ),
  };
  const setupRandomSource = createSeededRandomSource(`${seed}:setup`);
  const diceRandomSource = createSeededRandomSource(`${seed}:dice`);
  const players = Object.fromEntries(
    setup.players.map((player) => [player.id, createPlayer(player, validated, ids)]),
  );
  const decks: Readonly<Record<string, DeckState>> = {};
  const cards: Readonly<Record<string, CardState>> = {};
  const state: SetupGameState = {
    gameId: setup.gameId,
    modeId: setup.modeId,
    /**
     * Snapshotted, not referenced: the ruleset is copied out of content here and
     * every later transition reads `state.rules`. Editing the content pack must
     * not change how an in-flight or replayed match behaves.
     */
    rules: snapshotRules(validated.rules),
    versions: {
      stateSchemaVersion: GAME_STATE_SCHEMA_VERSION,
      replaySchemaVersion: REPLAY_SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      rulesVersion: content.rulesetId,
      rulesetId: ids.rulesetId,
      contentReleaseId: ids.contentReleaseId,
      contentHash: createContentHash(content),
    },
    status: "setup",
    revision: 0,
    eventSequence: 0,
    playerOrder: setup.players.map((player) => player.id),
    players,
    turn: {
      number: 0,
      round: 0,
      activePlayerId: null,
      phase: "not-started",
      startedAt: null,
      deadlineAt: null,
    },
    startAuthorizedPlayerId: setup.authorizedStarterId,
    boardSize: content.board.spaces.length,
    tileIds: ids.tileIds,
    decks,
    cards,
    resolutionStack: [],
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    tileOwnership: {},
    placements: [],
    projects: [],
    agreements: [],
    objectives: [],
    ballots: [],
    quarters: createQuarters(validated.rules),
    currentQuarterIndex: 0,
    eliminatedPlayerIds: [],
    rng: {
      streams: {
        setup: setupRandomSource.getStreamState(),
        dice: diceRandomSource.getStreamState(),
      },
    },
    marathonEndgame: null,
    outcome: null,
    quarantine: null,
    lastCommandId: null,
    stateHash: null,
  };

  return { ok: true, value: state };
}
