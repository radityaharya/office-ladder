import type { DeckConfig } from "@office-ladder/content";

import { createSeededRandomSource } from "../random";
import type {
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
import { buildDecks } from "../execution/deck-depletion";
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
      // The ceiling is its own number, not the starting value. Passing `energy`
      // twice pinned maximum to start, so every `+energy` grant and every
      // `restoreResourceToMaximum` was a guaranteed no-op for a rested player
      // and `rank.supervisor`'s `increaseMaximumEnergy` had nothing to widen.
      mode.startingResources.energyMaximum,
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

/**
 * Everything `buildDecks` needs, pulled off the content pack for one mode.
 *
 * Read **structurally**, and deliberately so: `SetupContent` declares neither
 * `decks` nor a mode's `deckQuantities`/`clockDeck`, and widening it belongs to
 * whoever owns `setup/types.ts`. Narrowing a locally declared minimal shape off
 * the content object is the convention this module family already uses for
 * exactly that reason.
 *
 * Every field degrades to empty rather than throwing, which is what keeps the
 * hand-built `SetupContent` fixtures in `setup-v2-state.test.ts` working: a
 * content pack with no authored decks produces a game with no decks — exactly
 * the state every caller had before this landed — instead of failing setup.
 */
type DeckSetupSlice = {
  readonly decks: readonly DeckConfig[];
  readonly quantities: Readonly<Record<string, number>>;
  readonly clockDeckIds: readonly string[];
};

function isDeckConfig(value: unknown): value is DeckConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly id?: unknown; readonly cards?: unknown };

  return typeof candidate.id === "string" && Array.isArray(candidate.cards);
}

function readNumberRecord(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null) return {};

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Whether the clock-deck ending is switched on for this ruleset.
 *
 * The distinction being enforced: *which* decks are the clock is content
 * (`ModeConfig.clockDeck.deckIds`), but *whether the clock exists* is a rule.
 *
 * Fail-closed on anything but an explicit `true`, and read defensively even though
 * `ModeRules.endgame` is a required field: a ruleset can also arrive from a
 * pre-v2 snapshot, which predates the field entirely. This has to match
 * `resolveClockDeckIds` (deck-depletion.ts) exactly, because the two are
 * independent readings of the same rule — if they disagreed, a mode could end up
 * with meeting and event decks that permanently run dry (they were built as clock
 * decks) while nothing ever ended the match, which is the cost of a clock with
 * none of the payoff. `deck-materialization.test.ts` asserts they agree for every
 * shipped mode.
 */
function clockEndingEnabled(rules: ModeRules): boolean {
  const endgame = (
    rules as { readonly endgame?: { readonly clockDecksEndMatch?: unknown } }
  ).endgame;

  return endgame?.clockDecksEndMatch === true;
}

function readDeckSetup(
  content: SetupContent,
  modeId: string,
  rules: ModeRules,
): DeckSetupSlice {
  const authored = (content as { readonly decks?: unknown }).decks;
  const mode = content.modes[modeId] as
    | (SetupModeContent & {
        readonly deckQuantities?: unknown;
        readonly clockDeck?: { readonly deckIds?: unknown };
      })
    | undefined;

  return {
    decks: Array.isArray(authored) ? authored.filter(isDeckConfig) : [],
    quantities: readNumberRecord(mode?.deckQuantities),
    /**
     * Resolved **once, here**, and then baked into each `DeckState`'s
     * `reshufflesWhenEmpty`. That is the point: after setup no transition has to
     * re-read the content pack to learn which decks are the clock, so editing
     * `clockDeck.deckIds` cannot change how an in-flight or replayed match
     * counts down (spec §5.9).
     */
    clockDeckIds: clockEndingEnabled(rules)
      ? readStringArray(mode?.clockDeck?.deckIds)
      : [],
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
  /**
   * The deal gets its **own** persisted stream rather than drawing from `setup`
   * or `dice`.
   *
   * Two reasons, and both matter. Sharing `dice` would make the shuffle and the
   * first movement rolls two slices of one sequence, so anyone who learned the
   * deck order would have learned the dice; and sharing `setup` would advance a
   * cursor that `quarters.ts` and `agency.ts` both read as *seed material*,
   * coupling the quarter schedule to how many cards the mode happens to deal.
   * A third stream keyed off the same match seed keeps the deal reproducible —
   * the same seed always deals the same cards, which is what a replay needs —
   * while leaving both existing streams untouched at cursor zero.
   */
  const deckRandomSource = createSeededRandomSource(`${seed}:decks`);
  const players = Object.fromEntries(
    setup.players.map((player) => [player.id, createPlayer(player, validated, ids)]),
  );
  /**
   * The ruleset the piles are built against is the **snapshot**, not
   * `validated.rules`, for the same reason the state carries one at all: which
   * cards a mode's timing rules admit is part of how the match plays, so it has
   * to be decided by the frozen copy rather than by whatever the content pack
   * says later (spec §5.9).
   */
  const rules = snapshotRules(validated.rules);
  const deckSetup = readDeckSetup(content, setup.modeId, rules);
  /**
   * Decks are materialised **here**, at creation, rather than inside the
   * `game.start` transition.
   *
   * The two are the same instant from the outside — the room service calls
   * `createGame` and then immediately applies `game.start` — but setup is where
   * the seed and the content pack are both in hand, and `startGame` has neither.
   * The consequence worth stating: `GameState.decks` is populated while the game
   * is still `"setup"`, so a lobby projection can already report deck sizes.
   */
  const { decks, cards } = buildDecks({
    decks: deckSetup.decks,
    quantities: deckSetup.quantities,
    rules,
    clockDeckIds: deckSetup.clockDeckIds,
    random: deckRandomSource,
  });
  const state: SetupGameState = {
    gameId: setup.gameId,
    modeId: setup.modeId,
    /**
     * Snapshotted, not referenced: the ruleset is copied out of content here and
     * every later transition reads `state.rules`. Editing the content pack must
     * not change how an in-flight or replayed match behaves.
     */
    rules,
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
        // Read *after* the deal, so the persisted cursor records how much of the
        // stream the shuffle consumed and a later reshuffle cannot re-issue the
        // numbers that dealt the opening piles.
        decks: deckRandomSource.getStreamState(),
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
