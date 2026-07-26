import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";
import {
  applyCommand,
  createDeadlineDashGame,
  createStableId,
  enumerateLegalActions,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PromptOptionId,
} from "../src";

/**
 * Whole-match invariants that only a long game can break.
 *
 * `purity-replay.test.ts` proves a *single* command is deterministic, replays
 * byte-identically and survives the jsonb boundary. What it cannot see is drift
 * that only accumulates: an id minted twice thirty turns apart, a sequence that
 * skips, or a resource mutation that canonical state performs and the event
 * stream never mentions. `game_events` is the table the planned event-sourced
 * read model is built on (see AGENTS.md), so "fold every ResourceChanged over
 * the previous state and land exactly on the next one" is the property that
 * makes such a read model possible at all — and it is the property that was
 * actually broken: the automatic promotion charged its money in canonical state
 * and emitted no ResourceChanged, so a folded balance ended every match too high
 * by the sum of every promotion paid.
 */

const CHARACTERS = [
  // Tech Genius exercises the ignoreNegativeEffect shield and EffectPrevented;
  // Sales Star exercises the salary multiplier; the rest cover the landing and
  // doubles passives, so one match touches every implemented passive.
  "character.tech-genius",
  "character.workaholic",
  "character.office-politician",
  "character.social-butterfly",
  "character.lucky-employee",
  "character.sales-star",
] as const;

function setupFor(gameId: string, playerCount: number) {
  const ids = Array.from({ length: playerCount }, (_, index) =>
    createStableId("PlayerId", `consistency-p${index}`),
  );

  return {
    gameId: createStableId("GameId", gameId),
    modeId: createStableId("ModeId", "mode.quick"),
    players: ids.map((id, index) => ({
      id,
      order: index,
      characterId: createStableId("CharacterId", CHARACTERS[index] ?? CHARACTERS[0]),
      role: {
        id: createStableId("RoleId", `role.consistency.${index}`),
        kind: index === 1 ? ("role.management" as const) : ("role.worker" as const),
      },
    })),
    authorizedStarterId: ids[0] as PlayerId,
  };
}

type ResourceChangedPayload = {
  readonly playerId: string;
  readonly resourceId: string;
  readonly previousValue: number;
  readonly newValue: number;
  readonly reason: string;
};

/** Every player resource's current value, keyed by `playerId|resourceKey`. */
function balances(state: GameState): Map<string, number> {
  const values = new Map<string, number>();
  for (const [playerId, player] of Object.entries(state.players)) {
    for (const [key, resource] of Object.entries(player.resources)) {
      values.set(`${playerId}|${key}`, resource.value);
    }
  }

  return values;
}

/** The `playerId|resourceKey` a ResourceChanged event's resource id refers to. */
function keyOf(state: GameState, playerId: string, resourceId: string): string | null {
  const player = state.players[playerId];
  if (player === undefined) return null;
  for (const [key, resource] of Object.entries(player.resources)) {
    if (resource.id === resourceId) return `${playerId}|${key}`;
  }

  return null;
}

type Divergence = {
  readonly kind: "stale-previous" | "unreported-change";
  readonly resource: string;
  readonly reason: string;
  readonly fromEvents: number;
  readonly fromState: number;
};

/**
 * Folds one command's ResourceChanged events over the pre-command balances and
 * checks the result against the post-command canonical balances — exactly what a
 * read model rebuilt from `game_events` would compute.
 */
function foldResourceEvents(
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
): readonly Divergence[] {
  const divergences: Divergence[] = [];
  const folded = balances(before);

  for (const event of events) {
    if (event.type !== "ResourceChanged") continue;
    const payload = event.payload as ResourceChangedPayload;
    const key = keyOf(after, payload.playerId, payload.resourceId);
    if (key === null) continue;

    const running = folded.get(key);
    if (running !== undefined && running !== payload.previousValue) {
      divergences.push({
        kind: "stale-previous",
        resource: key,
        reason: payload.reason,
        fromEvents: payload.previousValue,
        fromState: running,
      });
    }
    folded.set(key, payload.newValue);
  }

  for (const [key, canonical] of balances(after)) {
    const fromEvents = folded.get(key);
    if (fromEvents !== undefined && fromEvents !== canonical) {
      divergences.push({
        kind: "unreported-change",
        resource: key,
        reason: "-",
        fromEvents,
        fromState: canonical,
      });
    }
  }

  return divergences;
}

/**
 * The option a consumer with no opinion takes. Every prompt the engine opens
 * offers its no-cost branch first (see roll-turn.ts's buildDecisionPrompt), so
 * this needs no per-kind knowledge.
 */
function firstOption(options: readonly PromptOptionId[]): PromptOptionId {
  const option = options[0];
  if (option === undefined) throw new Error("a prompt was opened with no legal response");

  return option;
}

type MatchLog = {
  readonly events: readonly GameEvent[];
  readonly divergences: readonly Divergence[];
  readonly commands: number;
  readonly finalState: GameState;
};

/**
 * Plays a real match to its natural end (or `maxCommands`), always taking the
 * first legal option so the walk is deterministic and needs no bot policy.
 */
function playMatch(
  gameId: string,
  seed: string,
  playerCount: number,
  maxCommands: number,
  prepare: (state: GameState) => GameState = (state) => state,
): MatchLog {
  const created = createDeadlineDashGame(setupFor(gameId, playerCount), seed);
  if (!created.ok) throw new Error(created.error.message);

  // Time never reaches an outcome (asserted in purity-replay.test.ts), so a
  // fixed timestamp keeps this walk readable.
  const transitionContext = {
    logicalTimestamp: "2026-07-26T12:00:00.000Z",
    content: deadlineDashContent,
  };

  const events: GameEvent[] = [];
  const divergences: Divergence[] = [];
  let state: GameState = created.value;

  const start = applyCommand(
    state,
    {
      commandId: createStableId("CommandId", "consistency.start"),
      gameId: state.gameId,
      actorId: created.value.playerOrder[0] as PlayerId,
      expectedRevision: state.revision,
      type: "game.start",
      payload: {},
    },
    transitionContext,
  );
  if (!start.ok) throw new Error(start.error.message);
  events.push(...start.value.events);
  state = prepare(start.value.state);

  let commands = 0;
  for (let step = 0; step < maxCommands; step += 1) {
    if (state.status !== "active") break;
    const actorId = state.turn.activePlayerId;
    if (actorId === null) break;
    const legal = enumerateLegalActions(state, actorId);
    const action = legal[0];
    if (action === undefined) break;

    const commandId = createStableId("CommandId", `consistency.${step}`);
    const result = applyCommand(
      state,
      action.type === "prompt.respond"
        ? {
            commandId,
            gameId: state.gameId,
            actorId,
            expectedRevision: state.revision,
            decisionPointId: action.decisionPointId,
            type: "prompt.respond",
            payload: { optionId: firstOption(action.options), value: null },
          }
        : {
            commandId,
            gameId: state.gameId,
            actorId,
            expectedRevision: state.revision,
            type: "turn.roll",
            payload: {},
          },
      transitionContext,
    );
    if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.message}`);

    divergences.push(...foldResourceEvents(state, result.value.state, result.value.events));
    events.push(...result.value.events);
    state = result.value.state;
    commands += 1;
  }

  return { events, divergences, commands, finalState: state };
}

/** Empties everyone's energy so the start-of-turn burnout rule fires repeatedly. */
function exhaustEveryone(state: GameState): GameState {
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, player]) => {
        const energy = player.resources.energy;
        return [
          id,
          energy === undefined
            ? player
            : {
                ...player,
                resources: { ...player.resources, energy: { ...energy, value: 0 } },
              },
        ];
      }),
    ),
  };
}

/** Charges every seat skipped turns so the hand-off walk has to lap the table. */
function indebtEveryone(state: GameState): GameState {
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, player]) => [id, { ...player, skipTurns: 3 }]),
    ),
  };
}

const asIs = (state: GameState) => state;

const scenarios = [
  { name: "three seats", slug: "3-plain", players: 3, prepare: asIs },
  { name: "six seats", slug: "6-plain", players: 6, prepare: asIs },
  { name: "three seats, all exhausted", slug: "3-exhausted", players: 3, prepare: exhaustEveryone },
  {
    name: "six seats, all owing skipped turns",
    slug: "6-indebted",
    players: 6,
    prepare: indebtEveryone,
  },
  {
    name: "three seats, exhausted and owing skipped turns",
    slug: "3-both",
    players: 3,
    prepare: (state: GameState) => indebtEveryone(exhaustEveryone(state)),
  },
] as const;

describe("a whole match's events and canonical state never diverge", () => {
  it.each(scenarios)(
    "Given $name, When the match is played out, Then folding every ResourceChanged lands exactly on canonical state",
    ({ slug, players, prepare }) => {
      const match = playMatch(`game.consistency.${slug}`, "consistency-seed", players, 400, prepare);

      expect(match.commands).toBeGreaterThan(40);
      // Named divergences rather than a bare count: the message has to say which
      // resource drifted and by how much, or the next failure is unreadable.
      expect(match.divergences).toEqual([]);
    },
  );

  it.each(scenarios)(
    "Given $name, When the match is played out, Then no event id is ever minted twice and sequences stay contiguous",
    ({ slug, players, prepare }) => {
      const match = playMatch(`game.ids.${slug}`, "consistency-seed", players, 400, prepare);

      const eventIds = match.events.map((event) => event.eventId);
      expect(eventIds.filter((id, index) => eventIds.indexOf(id) !== index)).toEqual([]);
      expect(match.events.map((event) => event.sequence)).toEqual(
        Array.from({ length: match.events.length }, (_, index) => index + 1),
      );
      expect(match.finalState.eventSequence).toBe(match.events.length);

      // Prompt, frame and prevented-effect ids are minted from the same counter,
      // so they inherit the same uniqueness — but only if nothing reuses a
      // sequence, which is what this pins.
      const prompts = match.events
        .filter((event) => event.type === "PromptOpened")
        .map((event) => (event.payload as { prompt: { id: string; frameId: string } }).prompt);
      const promptIds = prompts.map((prompt) => prompt.id);
      const frameIds = prompts.map((prompt) => prompt.frameId);
      expect(promptIds.filter((id, index) => promptIds.indexOf(id) !== index)).toEqual([]);
      expect(frameIds.filter((id, index) => frameIds.indexOf(id) !== index)).toEqual([]);

      const effectIds = match.events
        .filter((event) => event.type === "EffectPrevented")
        .map((event) => (event.payload as { effectId: string }).effectId);
      expect(effectIds.filter((id, index) => effectIds.indexOf(id) !== index)).toEqual([]);
    },
  );

  it("Given a match that promotes, When the promotion is charged, Then the money it spends is reported as a ResourceChanged", () => {
    // The regression this file exists for. Without the paired ResourceChanged the
    // fold above drifts by exactly the promotion cost, which is why the
    // divergence assertion is not vacuous.
    // Promotion is automatic only under a ruleset with `agency.promotionIsChoice`
    // off. The shipped Quick preset this walk is created under makes it a player
    // decision, and no bot answers `promotion.attempt` here, so the ruleset is
    // switched to the automatic one for this walk — the pairing being pinned is
    // between `PlayerPromoted` and its charge, whichever verb promoted.
    const match = playMatch("game.promotion-charge", "consistency-seed", 3, 400, (state) => ({
      ...state,
      rules: { ...state.rules, agency: { ...state.rules.agency, promotionIsChoice: false } },
    }));

    const promotions = match.events.filter((event) => event.type === "PlayerPromoted");
    expect(promotions.length).toBeGreaterThan(0);

    const charges = match.events.filter(
      (event) =>
        event.type === "ResourceChanged" &&
        (event.payload as ResourceChangedPayload).reason === "promotion-cost",
    );
    // Every promotion with a non-zero cost is charged, and none is charged twice.
    const paidPromotions = promotions.filter(
      (event) => (event.payload as { cost: number }).cost > 0,
    );
    expect(charges).toHaveLength(paidPromotions.length);

    for (const [index, promotion] of paidPromotions.entries()) {
      const charge = charges[index];
      if (charge === undefined) throw new Error("expected a matching promotion charge");
      const payload = charge.payload as ResourceChangedPayload;
      expect(payload.playerId).toBe((promotion.payload as { playerId: string }).playerId);
      expect(payload.previousValue - payload.newValue).toBe(
        (promotion.payload as { cost: number }).cost,
      );
      // Reported immediately after the promotion it pays for, so a log reads in
      // causal order.
      expect(charge.sequence).toBe(promotion.sequence + 1);
    }
  });
});
