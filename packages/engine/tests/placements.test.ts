import { describe, expect, it } from "vitest";

import {
  deserializeGameState,
  projectPlayerView,
  projectPublicView,
  serializeGameState,
  type CommandId,
  type GameState,
  type ModeRules,
  type PlacementId,
  type PlacementKind,
  type PlacePlacementCommand,
  type PlacementState,
  type PlayerId,
  type PlayerState,
  type ResourceId,
  type TileId,
} from "../src";
import {
  activePlacementCount,
  isPlacementKind,
  placePlacement,
  placementCost,
  placementMoneyAmount,
  PLACEMENT_KINDS,
  PLACEMENT_SPECS,
  resolveLandingTriggers,
  resolvePlacementLanding,
  SURVEILLANCE_REPORT_STATUS,
} from "../src/execution/placements";
import { fixtureIds, secretSentinels } from "./fixtures";
import { boardIndexOfKind, context, rollState, withRules } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const WORK_INDEX = boardIndexOfKind("work");
const MEETING_INDEX = boardIndexOfKind("meeting");

type BoardRules = ModeRules["board"];
type ConflictRules = ModeRules["conflict"];

const BOARD_ON: Partial<BoardRules> = {
  ownershipEnabled: true,
  upgradesEnabled: true,
  claimCostMultiplier: 1,
  tollMultiplier: 1,
  placementsEnabled: true,
  maxPlacementsPerPlayer: 2,
};

const HEAT_ON: Partial<ConflictRules> = {
  targetedAttacks: true,
  heatEnabled: true,
  heatPerAttack: 1,
  heatThreshold: 3,
};

type BoardOverrides = Partial<BoardRules>;
type ConflictOverrides = Partial<ConflictRules>;

function withResource(
  state: GameState,
  playerId: PlayerId,
  key: "money" | "reputation",
  value: number,
): GameState {
  const player = state.players[playerId];
  if (player === undefined) throw new Error(`fixture missing player ${playerId}`);

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        resources: {
          ...player.resources,
          [key]: {
            id: brand<ResourceId>(`resource-${playerId}-${key}`),
            kind: key === "money" ? "resource.money" : "resource.reputation",
            value,
            minimum: 0,
            maximum: null,
          },
        },
      },
    },
  };
}

/**
 * The active player is standing on a work tile with money and reputation, the
 * other two are solvent, and placements are on.
 */
function placementState(
  board: BoardOverrides = {},
  conflict: ConflictOverrides = {},
): GameState {
  const base = rollState(WORK_INDEX);
  const funded = [
    fixtureIds.owner,
    fixtureIds.hiddenOpponent,
    fixtureIds.revealedOpponent,
  ].reduce(
    (state, playerId) =>
      withResource(withResource(state, playerId, "money", 1000), playerId, "reputation", 4),
    base,
  );

  return withRules(funded, {
    board: { ...BOARD_ON, ...board },
    conflict: { ...HEAT_ON, ...conflict },
  });
}

function tileAt(state: GameState, index: number): TileId {
  const tileId = state.tileIds[index];
  if (tileId === undefined) throw new Error(`no tile at board index ${index}`);

  return tileId;
}

function placeCommand(
  state: GameState,
  kind: PlacementKind,
  tileId: TileId,
  overrides: Partial<PlacePlacementCommand> = {},
): PlacePlacementCommand {
  return {
    commandId: brand<CommandId>("command-place"),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    type: "placement.place",
    payload: { kind, tileId },
    ...overrides,
  };
}

function existingPlacement(
  kind: PlacementKind,
  tileId: TileId,
  ownerId: PlayerId,
  overrides: Partial<PlacementState> = {},
): PlacementState {
  return {
    id: brand<PlacementId>(`placement-${kind}-${ownerId}`),
    kind,
    tileId,
    ownerId,
    charges: PLACEMENT_SPECS[kind].charges,
    visibility: PLACEMENT_SPECS[kind].visibility,
    placedAtRound: 1,
    data: {},
    ...overrides,
  };
}

function withPlacements(state: GameState, placements: readonly PlacementState[]): GameState {
  return { ...state, placements };
}

function landerOf(state: GameState): PlayerState {
  const lander = state.players[fixtureIds.owner];
  if (lander === undefined) throw new Error("fixture missing lander");

  return lander;
}

function landingOn(state: GameState, index = WORK_INDEX) {
  return { state, lander: landerOf(state), tileId: tileAt(state, index) };
}

function accept(result: ReturnType<typeof placePlacement>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value;
}

function expectRejected(result: ReturnType<typeof placePlacement>, code: string): void {
  expect(result).toEqual(
    expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code }),
    }),
  );
}

function moneyOf(player: PlayerState | undefined): number {
  const money = player?.resources["money"];
  if (money === undefined) throw new Error("player has no money");

  return money.value;
}

describe("placement pricing and vocabulary", () => {
  it("knows exactly the five kinds the spec declares", () => {
    expect([...PLACEMENT_KINDS].sort()).toEqual(
      [
        "placement.favour",
        "placement.meeting-invite",
        "placement.rumour",
        "placement.sabotage",
        "placement.surveillance",
      ].sort(),
    );
    expect(isPlacementKind("placement.sabotage")).toBe(true);
    expect(isPlacementKind("placement.bribery")).toBe(false);
  });

  it("hides exactly the two kinds that only work unseen", () => {
    const hidden = PLACEMENT_KINDS.filter(
      (kind) => PLACEMENT_SPECS[kind].visibility === "owner-only",
    );

    expect(hidden).toEqual(["placement.sabotage", "placement.surveillance"]);
  });

  it("scales costs and payouts off the mode's own board multipliers", () => {
    const rules = placementState({ claimCostMultiplier: 2, tollMultiplier: 0.5 }).rules;

    expect(placementCost(rules, "placement.sabotage")).toBe(300);
    expect(placementMoneyAmount(rules, "placement.sabotage")).toBe(100);
    expect(placementMoneyAmount(rules, "placement.favour")).toBe(75);
  });
});

describe("placement.place", () => {
  it("puts an owner-only placement on the board and charges for it", () => {
    const state = placementState();
    const tileId = tileAt(state, MEETING_INDEX);

    const { state: next, events } = accept(
      placePlacement(state, placeCommand(state, "placement.sabotage", tileId), context([])),
    );

    expect(next.placements).toHaveLength(1);
    expect(next.placements[0]).toEqual(
      expect.objectContaining({
        kind: "placement.sabotage",
        tileId,
        ownerId: fixtureIds.owner,
        charges: 1,
        visibility: "owner-only",
        placedAtRound: state.turn.round,
        data: {},
      }),
    );
    expect(moneyOf(next.players[fixtureIds.owner])).toBe(850);
    expect(next.revision).toBe(state.revision + 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: "ResourceChanged",
        payload: expect.objectContaining({ reason: "placement-cost" }),
      }),
    );
  });

  it("never names the kind or the tile in the public cost event", () => {
    const state = placementState();
    const { events } = accept(
      placePlacement(
        state,
        placeCommand(state, "placement.surveillance", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
    );

    expect(JSON.stringify(events)).not.toContain("surveillance");
    expect(JSON.stringify(events)).not.toContain(tileAt(state, MEETING_INDEX));
  });

  it("raises the actor's heat for a hostile placement", () => {
    const state = placementState();
    const { state: next } = accept(
      placePlacement(
        state,
        placeCommand(state, "placement.rumour", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
    );

    expect(next.players[fixtureIds.owner]?.heat.value).toBe(1);
    expect(next.players[fixtureIds.owner]?.heat.lastIncrementedAtRound).toBe(state.turn.round);
  });

  it("leaves heat alone for a favour, which helps whoever finds it", () => {
    const state = placementState();
    const { state: next } = accept(
      placePlacement(
        state,
        placeCommand(state, "placement.favour", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
    );

    expect(next.players[fixtureIds.owner]?.heat.value).toBe(0);
  });

  it("leaves heat alone when the mode has heat switched off", () => {
    const state = placementState({}, { heatEnabled: false, heatPerAttack: 0 });
    const { state: next } = accept(
      placePlacement(
        state,
        placeCommand(state, "placement.rumour", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
    );

    expect(next.players[fixtureIds.owner]?.heat.value).toBe(0);
  });

  it("rejects a placement from a player whose turn it is not", () => {
    const state = placementState();

    expectRejected(
      placePlacement(
        state,
        placeCommand(state, "placement.sabotage", tileAt(state, MEETING_INDEX), {
          actorId: fixtureIds.hiddenOpponent,
        }),
        context([]),
      ),
      "NOT_ACTOR_TURN",
    );
  });

  it("rejects a placement from somebody who is not in the game at all", () => {
    const state = placementState();

    expectRejected(
      placePlacement(
        state,
        placeCommand(state, "placement.sabotage", tileAt(state, MEETING_INDEX), {
          actorId: brand<PlayerId>("player-not-seated"),
        }),
        context([]),
      ),
      "ACTOR_NOT_FOUND",
    );
  });

  it("rejects every placement when the mode has them switched off", () => {
    const state = placementState({ placementsEnabled: false });

    expectRejected(
      placePlacement(
        state,
        placeCommand(state, "placement.sabotage", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
      "ILLEGAL_ACTION",
    );
  });

  it("rejects a placement the actor cannot pay for", () => {
    const state = withResource(placementState(), fixtureIds.owner, "money", 149);

    expectRejected(
      placePlacement(
        state,
        placeCommand(state, "placement.sabotage", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("rejects a placement past the mode's per-player cap", () => {
    const base = placementState({ maxPlacementsPerPlayer: 1 });
    const state = withPlacements(base, [
      existingPlacement("placement.rumour", tileAt(base, WORK_INDEX), fixtureIds.owner),
    ]);

    expectRejected(
      placePlacement(
        state,
        placeCommand(state, "placement.sabotage", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
      "ILLEGAL_ACTION",
    );
    expect(activePlacementCount(state.placements, fixtureIds.owner)).toBe(1);
  });

  it("rejects every placement when the mode caps them at zero", () => {
    const state = placementState({ maxPlacementsPerPlayer: 0 });

    expectRejected(
      placePlacement(
        state,
        placeCommand(state, "placement.favour", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
      "ILLEGAL_ACTION",
    );
  });

  it("rejects a second placement by the same player on one tile", () => {
    const base = placementState();
    const tileId = tileAt(base, MEETING_INDEX);
    const state = withPlacements(base, [
      existingPlacement("placement.rumour", tileId, fixtureIds.owner),
    ]);

    expectRejected(
      placePlacement(state, placeCommand(state, "placement.sabotage", tileId), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("allows two different players to place on the same tile", () => {
    const base = placementState();
    const tileId = tileAt(base, MEETING_INDEX);
    const state = withPlacements(base, [
      existingPlacement("placement.rumour", tileId, fixtureIds.hiddenOpponent),
    ]);

    const { state: next } = accept(
      placePlacement(state, placeCommand(state, "placement.sabotage", tileId), context([])),
    );

    expect(next.placements).toHaveLength(2);
  });

  it("rejects a kind this game does not know", () => {
    const state = placementState();

    expectRejected(
      placePlacement(
        state,
        placeCommand(state, "placement.bribery" as PlacementKind, tileAt(state, MEETING_INDEX)),
        context([]),
      ),
      "INVALID_COMMAND",
    );
  });

  it("rejects a tileId that is not on this board", () => {
    const state = placementState();

    expectRejected(
      placePlacement(
        state,
        placeCommand(state, "placement.sabotage", brand<TileId>("tile.elsewhere")),
        context([]),
      ),
      "INVALID_COMMAND",
    );
  });

  it("derives the placement id from canonical state, never from the command id", () => {
    const state = placementState();
    const tileId = tileAt(state, MEETING_INDEX);

    const first = accept(
      placePlacement(state, placeCommand(state, "placement.sabotage", tileId), context([])),
    );
    const second = accept(
      placePlacement(
        state,
        placeCommand(state, "placement.sabotage", tileId, {
          commandId: brand<CommandId>("command-chosen-by-a-client"),
        }),
        context([]),
      ),
    );

    expect(first.state.placements[0]?.id).toBe(second.state.placements[0]?.id);
    expect(first.state.placements[0]?.id).not.toContain("command");
  });

  it("round-trips the placed board through JSON unchanged", () => {
    const state = placementState();
    const { state: next } = accept(
      placePlacement(
        state,
        placeCommand(state, "placement.sabotage", tileAt(state, MEETING_INDEX)),
        context([]),
      ),
    );

    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
  });
});

describe("the placement landing trigger", () => {
  function withOpponentPlacement(
    kind: PlacementKind,
    ownerId: PlayerId = fixtureIds.hiddenOpponent,
    index = WORK_INDEX,
  ): GameState {
    const base = placementState();

    return withPlacements(base, [existingPlacement(kind, tileAt(base, index), ownerId)]);
  }

  it("costs the lander their next turn for a meeting invite", () => {
    const state = withOpponentPlacement("placement.meeting-invite");
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(outcome.lander.skipTurns).toBe(landerOf(state).skipTurns + 1);
    expect(outcome.placements).toEqual([]);
    expect(outcome.triggers).toEqual([
      expect.objectContaining({
        kind: "placement.meeting-invite",
        ownerId: fixtureIds.hiddenOpponent,
        visibility: "public",
        amount: 1,
        chargesRemaining: 0,
      }),
    ]);
  });

  it("moves money from the lander to the owner for a sabotage", () => {
    const state = withOpponentPlacement("placement.sabotage");
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(moneyOf(outcome.lander)).toBe(800);
    expect(moneyOf(outcome.owners[fixtureIds.hiddenOpponent])).toBe(1200);
    expect(outcome.changes.map((change) => change.reason)).toEqual([
      "placement:placement.sabotage",
      "placement:placement.sabotage:payout",
    ]);
    expect(outcome.triggers[0]?.visibility).toBe("owner-only");
  });

  it("takes what a broke lander has for a sabotage", () => {
    const state = withResource(
      withOpponentPlacement("placement.sabotage"),
      fixtureIds.owner,
      "money",
      70,
    );
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(moneyOf(outcome.lander)).toBe(0);
    expect(moneyOf(outcome.owners[fixtureIds.hiddenOpponent])).toBe(1070);
    expect(outcome.triggers[0]?.amount).toBe(70);
  });

  it("scales the sabotage payout with the mode's toll multiplier", () => {
    const base = withOpponentPlacement("placement.sabotage");
    const state = withRules(base, { board: { tollMultiplier: 1.5 } });

    expect(resolvePlacementLanding(landingOn(state)).triggers[0]?.amount).toBe(300);
  });

  it("costs the lander reputation for a rumour", () => {
    const state = withOpponentPlacement("placement.rumour");
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(outcome.lander.resources["reputation"]?.value).toBe(3);
    expect(outcome.changes).toHaveLength(1);
    expect(outcome.triggers[0]?.amount).toBe(1);
  });

  it("spends a rumour's charge even on a lander with no reputation left", () => {
    const state = withResource(
      withOpponentPlacement("placement.rumour"),
      fixtureIds.owner,
      "reputation",
      0,
    );
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(outcome.triggers).toHaveLength(1);
    expect(outcome.triggers[0]?.amount).toBe(0);
    expect(outcome.changes).toEqual([]);
    expect(outcome.placements).toEqual([]);
  });

  it("pays the lander for a favour and leaves the owner alone", () => {
    const state = withOpponentPlacement("placement.favour");
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(moneyOf(outcome.lander)).toBe(1150);
    expect(outcome.owners).toEqual({});
    expect(outcome.triggers[0]?.amount).toBe(150);
  });

  it("writes a private report to the watcher for surveillance", () => {
    const state = withOpponentPlacement("placement.surveillance");
    const outcome = resolvePlacementLanding(landingOn(state));
    const watcher = outcome.owners[fixtureIds.hiddenOpponent];
    const report = watcher?.statuses.find(
      (status) => status.id === SURVEILLANCE_REPORT_STATUS,
    );

    expect(outcome.lander).toEqual(landerOf(state));
    expect(outcome.changes).toEqual([]);
    expect(report?.visibility).toBe("private");
    expect(report?.data).toEqual(
      expect.objectContaining({
        observedPlayerId: fixtureIds.owner,
        handDefinitionIds: [secretSentinels.ownerHandDefinition],
        roleKind: "role.worker",
        roleRevealed: false,
      }),
    );
  });

  it("round-trips a surveillance report through JSON unchanged", () => {
    const state = withOpponentPlacement("placement.surveillance");
    const outcome = resolvePlacementLanding(landingOn(state));
    const watcher = outcome.owners[fixtureIds.hiddenOpponent];
    if (watcher === undefined) throw new Error("expected a watcher record");

    const next: GameState = {
      ...state,
      players: { ...state.players, [watcher.id]: watcher },
      placements: outcome.placements,
    };

    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
  });

  it("keeps a surveillance report out of every projection but the watcher's", () => {
    const state = withOpponentPlacement("placement.surveillance");
    const outcome = resolvePlacementLanding(landingOn(state));
    const watcher = outcome.owners[fixtureIds.hiddenOpponent];
    if (watcher === undefined) throw new Error("expected a watcher record");

    const next: GameState = {
      ...state,
      players: { ...state.players, [watcher.id]: watcher },
      placements: outcome.placements,
    };

    const secret = secretSentinels.ownerHandDefinition;
    expect(JSON.stringify(projectPlayerView(next, fixtureIds.hiddenOpponent))).toContain(secret);
    expect(JSON.stringify(projectPlayerView(next, fixtureIds.revealedOpponent))).not.toContain(secret);
    expect(JSON.stringify(projectPublicView(next))).not.toContain(secret);
  });

  /**
   * Only the no-leak direction is asserted. `projections/player.ts` does not yet
   * merge a viewer's *own* hidden rows back in (it says so in a NOTE, and until
   * this transition existed nothing populated `placements` at all), so an owner
   * currently cannot see their own trap either. That under-discloses rather than
   * leaks, it belongs to the projection owner, and asserting today's behaviour
   * here would turn their fix into a test failure.
   */
  it("keeps an owner-only placement out of every other player's view", () => {
    const base = withOpponentPlacement("placement.sabotage");
    const hiddenId = base.placements[0]?.id;
    if (hiddenId === undefined) throw new Error("expected a placement");

    expect(JSON.stringify(projectPublicView(base))).not.toContain(hiddenId);
    expect(JSON.stringify(projectPlayerView(base, fixtureIds.owner))).not.toContain(hiddenId);
    expect(JSON.stringify(projectPlayerView(base, fixtureIds.revealedOpponent))).not.toContain(
      hiddenId,
    );
  });

  it("puts a public placement in everybody's view", () => {
    const base = withOpponentPlacement("placement.rumour");
    const publicId = base.placements[0]?.id;
    if (publicId === undefined) throw new Error("expected a placement");

    expect(JSON.stringify(projectPublicView(base))).toContain(publicId);
    expect(JSON.stringify(projectPlayerView(base, fixtureIds.owner))).toContain(publicId);
  });

  it("never fires a placement for its own owner", () => {
    const state = withOpponentPlacement("placement.sabotage", fixtureIds.owner);
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(outcome.triggers).toEqual([]);
    expect(outcome.placements).toBe(state.placements);
    expect(outcome.lander).toBe(landerOf(state));
  });

  it("ignores placements sitting on some other tile", () => {
    const state = withOpponentPlacement("placement.sabotage", fixtureIds.hiddenOpponent, MEETING_INDEX);
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(outcome.triggers).toEqual([]);
    expect(outcome.placements).toBe(state.placements);
  });

  it("fires nothing when the mode has placements switched off", () => {
    const base = withOpponentPlacement("placement.sabotage");
    const state = withRules(base, { board: { placementsEnabled: false } });
    const outcome = resolvePlacementLanding(landingOn(state));

    expect(outcome.triggers).toEqual([]);
    expect(outcome.changes).toEqual([]);
    expect(outcome.placements).toBe(state.placements);
    expect(outcome.lander).toBe(landerOf(state));
  });

  it("fires several placements on one tile in array order", () => {
    const base = placementState();
    const tileId = tileAt(base, WORK_INDEX);
    const state = withPlacements(base, [
      existingPlacement("placement.rumour", tileId, fixtureIds.hiddenOpponent),
      existingPlacement("placement.sabotage", tileId, fixtureIds.revealedOpponent),
    ]);

    const outcome = resolvePlacementLanding(landingOn(state));

    expect(outcome.triggers.map((trigger) => trigger.kind)).toEqual([
      "placement.rumour",
      "placement.sabotage",
    ]);
    expect(outcome.lander.resources["reputation"]?.value).toBe(3);
    expect(moneyOf(outcome.lander)).toBe(800);
    // Only the sabotage's owner: a rumour costs its own owner nothing, so their
    // record is not in the patch at all.
    expect(Object.keys(outcome.owners)).toEqual([fixtureIds.revealedOpponent]);
  });

  it("keeps a multi-charge placement on the board with one charge spent", () => {
    const base = placementState();
    const tileId = tileAt(base, WORK_INDEX);
    const state = withPlacements(base, [
      existingPlacement("placement.rumour", tileId, fixtureIds.hiddenOpponent, { charges: 2 }),
    ]);

    const outcome = resolvePlacementLanding(landingOn(state));

    expect(outcome.placements).toHaveLength(1);
    expect(outcome.placements[0]?.charges).toBe(1);
    expect(outcome.triggers[0]?.chargesRemaining).toBe(1);
  });

  it("round-trips a state carrying a fired placement through JSON unchanged", () => {
    const state = withOpponentPlacement("placement.sabotage");
    const outcome = resolvePlacementLanding(landingOn(state));

    const next: GameState = {
      ...state,
      players: {
        ...state.players,
        ...outcome.owners,
        [outcome.lander.id]: outcome.lander,
      },
      placements: outcome.placements,
    };

    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
  });
});

describe("resolveLandingTriggers", () => {
  it("charges the toll before the traps fire", () => {
    const base = placementState();
    const tileId = tileAt(base, WORK_INDEX);
    const state: GameState = {
      ...withPlacements(base, [
        existingPlacement("placement.sabotage", tileId, fixtureIds.hiddenOpponent),
      ]),
      tileOwnership: {
        [tileId]: {
          tileId,
          ownerId: fixtureIds.revealedOpponent,
          level: 0,
          claimedAtRound: 1,
          tollPaidCount: 0,
        },
      },
    };

    const outcome = resolveLandingTriggers(landingOn(state));

    expect(outcome.changes.map((change) => change.reason)).toEqual([
      "tile-toll",
      "tile-toll-received",
      "placement:placement.sabotage",
      "placement:placement.sabotage:payout",
    ]);
    expect(moneyOf(outcome.lander)).toBe(700);
    expect(moneyOf(outcome.players[fixtureIds.revealedOpponent])).toBe(1100);
    expect(moneyOf(outcome.players[fixtureIds.hiddenOpponent])).toBe(1200);
    expect(outcome.toll).toEqual({
      ownerId: fixtureIds.revealedOpponent,
      assessed: 100,
      paid: 100,
    });
    expect(outcome.tileOwnership[tileId]?.tollPaidCount).toBe(1);
    expect(outcome.placements).toEqual([]);
  });

  it("composes both halves onto one owner record when the same player owns both", () => {
    const base = placementState();
    const tileId = tileAt(base, WORK_INDEX);
    const state: GameState = {
      ...withPlacements(base, [
        existingPlacement("placement.sabotage", tileId, fixtureIds.revealedOpponent),
      ]),
      tileOwnership: {
        [tileId]: {
          tileId,
          ownerId: fixtureIds.revealedOpponent,
          level: 0,
          claimedAtRound: 1,
          tollPaidCount: 0,
        },
      },
    };

    const outcome = resolveLandingTriggers(landingOn(state));

    // 1000 + 100 toll + 200 sabotage, not one of them lost to the other's copy
    // of the player record.
    expect(moneyOf(outcome.players[fixtureIds.revealedOpponent])).toBe(1300);
    expect(moneyOf(outcome.lander)).toBe(700);
  });

  it("reports no toll on an unowned tile and still fires the traps", () => {
    const base = placementState();
    const state = withPlacements(base, [
      existingPlacement("placement.favour", tileAt(base, WORK_INDEX), fixtureIds.hiddenOpponent),
    ]);

    const outcome = resolveLandingTriggers(landingOn(state));

    expect(outcome.toll).toBeNull();
    expect(moneyOf(outcome.lander)).toBe(1150);
  });

  it("does nothing at all when both halves are switched off", () => {
    const base = placementState({ ownershipEnabled: false, placementsEnabled: false });
    const tileId = tileAt(base, WORK_INDEX);
    const state: GameState = {
      ...withPlacements(base, [
        existingPlacement("placement.sabotage", tileId, fixtureIds.hiddenOpponent),
      ]),
      tileOwnership: {
        [tileId]: {
          tileId,
          ownerId: fixtureIds.revealedOpponent,
          level: 3,
          claimedAtRound: 1,
          tollPaidCount: 0,
        },
      },
    };

    const outcome = resolveLandingTriggers(landingOn(state));

    expect(outcome.changes).toEqual([]);
    expect(outcome.players).toEqual({});
    expect(outcome.toll).toBeNull();
    expect(outcome.triggers).toEqual([]);
    expect(outcome.lander).toBe(landerOf(state));
    expect(outcome.tileOwnership).toBe(state.tileOwnership);
    expect(outcome.placements).toBe(state.placements);
  });
});
