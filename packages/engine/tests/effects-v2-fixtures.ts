import { deadlineDashModes } from "@office-ladder/content";
import type { TileId as ContentTileId } from "@office-ladder/content";

import { createSeededRandomSource } from "../src";
import type {
  CardDefinitionId,
  CardInstanceId,
  CardState,
  GameState,
  ModeRules,
  PlayerId,
  PlayerState,
  ResourceId,
  ResourceState,
  TileId,
} from "../src";
import { createCanonicalGameState, fixtureIds } from "./fixtures";

const branded = <Id extends string>(value: string) => value as Id;

/**
 * The everything-on preset. Every v2 effect is gated on `state.rules`, so the
 * effects-v2 suite starts from the ruleset where nothing is switched off and
 * turns individual flags *down* with `withRules` to prove each gate. Starting
 * from a restrictive preset would make a passing test ambiguous: it would not
 * distinguish "the effect is disabled" from "the effect does nothing".
 */
export const effectsV2Rules: ModeRules = deadlineDashModes["mode.standard"].rules;

type ResourceSeed = {
  readonly money: number;
  readonly reputation: number;
  readonly energy: number;
  readonly work: number;
};

function resources(playerId: string, seed: ResourceSeed): Record<string, ResourceState> {
  return {
    money: {
      id: branded<ResourceId>(`${playerId}-money`),
      kind: "resource.money",
      value: seed.money,
      minimum: 0,
      maximum: null,
    },
    reputation: {
      id: branded<ResourceId>(`${playerId}-reputation`),
      kind: "resource.reputation",
      value: seed.reputation,
      minimum: 0,
      maximum: null,
    },
    energy: {
      id: branded<ResourceId>(`${playerId}-energy`),
      kind: "resource.energy",
      value: seed.energy,
      minimum: 0,
      maximum: 10,
    },
    "work-counter": {
      id: branded<ResourceId>(`${playerId}-work-counter`),
      kind: "resource.work-counter",
      value: seed.work,
      minimum: 0,
      maximum: null,
    },
  };
}

export const effectsV2Ids = {
  actor: fixtureIds.owner,
  rival: fixtureIds.hiddenOpponent,
  leader: fixtureIds.revealedOpponent,
  actorCardA: branded<CardInstanceId>("card-actor-a"),
  actorCardB: branded<CardInstanceId>("card-actor-b"),
  rivalCardA: branded<CardInstanceId>("card-rival-a"),
  rivalCardB: branded<CardInstanceId>("card-rival-b"),
  freeTile: branded<TileId>("tile-4"),
  takenTile: branded<TileId>("tile-6"),
} as const;

function handCard(id: CardInstanceId, ownerId: PlayerId): CardState {
  return {
    id,
    definitionId: branded<CardDefinitionId>(`definition-${id}`),
    deckId: fixtureIds.deck,
    zone: "hand",
    ownerId,
    faceUp: false,
    data: {},
  };
}

/**
 * A three-seat table with every resource present on every player, no shared
 * space occupied, and a ruleset with everything switched on.
 *
 * The seeded values are chosen so the derived targets of spec §10.1 all resolve
 * to *different* players, which is what makes a targeting test able to fail:
 *
 * | target | resolves to |
 * | --- | --- |
 * | `highest-rank`, `richest` | `leader` (rank 3, 2000 money) |
 * | `lowest-rank`, `poorest` | `rival` (rank 0, 400 money) |
 * | `right-neighbour` | `rival` (next in `playerOrder`) |
 * | `left-neighbour` | `leader` (previous, wrapping) |
 */
export function effectsV2State(): GameState {
  const base = createCanonicalGameState();
  const { actor, rival, leader } = effectsV2Ids;

  const withSeed = (
    player: PlayerState,
    seed: ResourceSeed,
    rankIndex: number,
    position: number,
    hand: readonly CardInstanceId[],
  ): PlayerState => ({
    ...player,
    position,
    rank: { ...player.rank, index: rankIndex },
    resources: resources(player.id, seed),
    hand,
    statuses: [],
    skipTurns: 0,
    inAudit: false,
    negativeEffectsIgnoredThisLap: 0,
    upkeep: { perRound: 100, lastChargedRound: 1, missedPayments: 0 },
    loans: [],
    incomeStreams: [],
    heat: {
      value: 0,
      threshold: effectsV2Rules.conflict.heatThreshold,
      investigationsOpened: 0,
      lastIncrementedAtRound: null,
    },
  });

  return {
    ...base,
    rules: effectsV2Rules,
    status: "active",
    turn: { ...base.turn, number: 4, round: 2, activePlayerId: actor, phase: "tile-resolution" },
    players: {
      [actor]: withSeed(
        base.players[actor],
        { money: 1000, reputation: 5, energy: 5, work: 4 },
        1,
        3,
        [effectsV2Ids.actorCardA, effectsV2Ids.actorCardB],
      ),
      [rival]: withSeed(
        base.players[rival],
        { money: 400, reputation: 2, energy: 3, work: 1 },
        0,
        8,
        [effectsV2Ids.rivalCardA, effectsV2Ids.rivalCardB],
      ),
      [leader]: withSeed(
        base.players[leader],
        { money: 2000, reputation: 9, energy: 4, work: 0 },
        3,
        13,
        [],
      ),
    },
    cards: {
      [effectsV2Ids.actorCardA]: handCard(effectsV2Ids.actorCardA, actor),
      [effectsV2Ids.actorCardB]: handCard(effectsV2Ids.actorCardB, actor),
      [effectsV2Ids.rivalCardA]: handCard(effectsV2Ids.rivalCardA, rival),
      [effectsV2Ids.rivalCardB]: handCard(effectsV2Ids.rivalCardB, rival),
    },
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    resolutionStack: [],
    tileOwnership: {
      [effectsV2Ids.takenTile]: {
        tileId: effectsV2Ids.takenTile,
        ownerId: leader,
        level: 0,
        claimedAtRound: 1,
        tollPaidCount: 0,
      },
    },
    placements: [],
    projects: [],
    agreements: [],
    objectives: [],
    ballots: [],
    eliminatedPlayerIds: [],
    lastCommandId: null,
  };
}

/**
 * The engine's branded `TileId`, read as content's authored tile-id shape.
 *
 * Content types a tile id as the template literal `` `tile.board.${string}` ``;
 * the engine mints an opaque branded string. They are the same bytes and neither
 * is assignable to the other, and `tests/fixtures.ts` (not this agent's file)
 * seeds the canonical board with `tile-0…tile-27`. Rather than restate the board
 * here just to satisfy a template literal, the crossing is made once.
 */
export function contentTileId(tileId: TileId): ContentTileId {
  return tileId as unknown as ContentTileId;
}

/** A deterministic source. No v2 effect draws from it; the v1 ones still can. */
export function effectsRandom() {
  return createSeededRandomSource("effects-v2-test");
}

export function moneyOf(state: GameState, playerId: PlayerId): number {
  return state.players[playerId]?.resources["money"]?.value ?? 0;
}

export function reputationOf(state: GameState, playerId: PlayerId): number {
  return state.players[playerId]?.resources["reputation"]?.value ?? 0;
}

/**
 * Round-trips a state through JSON exactly the way `PostgresRoomRepository`
 * does, so a test can assert that a shape survives persistence — the §5
 * invariant every v2 collection has to hold.
 */
export function roundTrip(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
