import { createSeededRandomSource } from "../random";
import type {
  CardState,
  DeckState,
  PlayerId,
  PlayerState,
  ResourceState,
  TokenState,
} from "../model";
import { createStableId } from "../model";
import {
  type GameSetup,
  type SetupContent,
  type SetupGameState,
  type SetupIds,
  type SetupModeContent,
  type SetupResult,
} from "./types";
import { validateSetup } from "./validation";

const STATE_SCHEMA_VERSION = 1;
const REPLAY_SCHEMA_VERSION = 1;
const ENGINE_VERSION = "office-ladder-engine/1";

function createContentHash(content: SetupContent): string {
  const serialized = JSON.stringify(content);
  let hash = 2166136261;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
    rank: { id: ids.internRankId, kind: "rank.intern", index: 0 },
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
    versions: {
      stateSchemaVersion: STATE_SCHEMA_VERSION,
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
