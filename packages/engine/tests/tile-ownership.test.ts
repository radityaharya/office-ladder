import { describe, expect, it } from "vitest";

import {
  deserializeGameState,
  serializeGameState,
  type ClaimTileCommand,
  type CommandId,
  type GameState,
  type ModeRules,
  type PlayerId,
  type ResourceId,
  type TileId,
  type UpgradeTileCommand,
} from "../src";
import {
  claimTile,
  isClaimableTile,
  MAX_TILE_LEVEL,
  resolveTileToll,
  tileClaimCost,
  tileTollAmount,
  tileUpgradeCost,
  upgradeTile,
} from "../src/execution/tile-ownership";
import { fixtureIds } from "./fixtures";
import { boardIndexOfKind, context, rollState, withRules } from "./turn-loop-fixtures";
import { deadlineDashContent } from "@office-ladder/content";

const brand = <Id extends string>(value: string) => value as Id;

const WORK_INDEX = boardIndexOfKind("work");
const MEETING_INDEX = boardIndexOfKind("meeting");
const RECEPTIONIST_INDEX = boardIndexOfKind("receptionist");

type BoardRules = ModeRules["board"];

/** Ownership on, both multipliers at 1, so every expected number is the base. */
const OWNERSHIP_ON: Partial<BoardRules> = {
  ownershipEnabled: true,
  upgradesEnabled: true,
  claimCostMultiplier: 1,
  tollMultiplier: 1,
};

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

function moneyOf(state: GameState, playerId: PlayerId): number {
  const resource = state.players[playerId]?.resources["money"];
  if (resource === undefined) throw new Error(`player ${playerId} has no money`);

  return resource.value;
}

function movedTo(state: GameState, playerId: PlayerId, position: number): GameState {
  const player = state.players[playerId];
  if (player === undefined) throw new Error(`fixture missing player ${playerId}`);

  return {
    ...state,
    players: { ...state.players, [playerId]: { ...player, position } },
  };
}

/** The active player is standing on a claimable work tile with 1000 money. */
function ownershipState(boardOverrides: Partial<BoardRules> = {}): GameState {
  const base = withResource(rollState(WORK_INDEX), fixtureIds.owner, "money", 1000);

  return withRules(base, { board: { ...OWNERSHIP_ON, ...boardOverrides } });
}

function tileAt(state: GameState, index: number): TileId {
  const tileId = state.tileIds[index];
  if (tileId === undefined) throw new Error(`no tile at board index ${index}`);

  return tileId;
}

function claimCommand(
  state: GameState,
  tileId: TileId,
  overrides: Partial<ClaimTileCommand> = {},
): ClaimTileCommand {
  return {
    commandId: brand<CommandId>("command-claim"),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    type: "tile.claim",
    payload: { tileId },
    ...overrides,
  };
}

function upgradeCommand(
  state: GameState,
  tileId: TileId,
  overrides: Partial<UpgradeTileCommand> = {},
): UpgradeTileCommand {
  return {
    commandId: brand<CommandId>("command-upgrade"),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    type: "tile.upgrade",
    payload: { tileId },
    ...overrides,
  };
}

function ownedBy(
  state: GameState,
  tileId: TileId,
  ownerId: PlayerId,
  level = 0,
  tollPaidCount = 0,
): GameState {
  return {
    ...state,
    tileOwnership: {
      ...state.tileOwnership,
      [tileId]: { tileId, ownerId, level, claimedAtRound: 1, tollPaidCount },
    },
  };
}

function accept(result: ReturnType<typeof claimTile>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value;
}

function expectRejected(result: ReturnType<typeof claimTile>, code: string): void {
  expect(result).toEqual(
    expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code }),
    }),
  );
}

describe("tile pricing", () => {
  it("scales every price off the mode's own multipliers", () => {
    const rules = ownershipState({ claimCostMultiplier: 1.25, tollMultiplier: 2 }).rules;

    expect(tileClaimCost(rules)).toBe(500);
    expect(tileUpgradeCost(rules, 0)).toBe(500);
    expect(tileUpgradeCost(rules, 1)).toBe(1000);
    expect(tileTollAmount(rules, 0)).toBe(200);
    expect(tileTollAmount(rules, 2)).toBe(600);
  });

  it("prices everything at zero when a mode zeroes the multipliers", () => {
    const rules = ownershipState({ claimCostMultiplier: 0, tollMultiplier: 0 }).rules;

    expect(tileClaimCost(rules)).toBe(0);
    expect(tileTollAmount(rules, 3)).toBe(0);
  });

  it("treats side tiles as claimable and corners as public infrastructure", () => {
    const spaces = deadlineDashContent.board.spaces;
    const state = ownershipState();

    expect(isClaimableTile(spaces, tileAt(state, WORK_INDEX))).toBe(true);
    expect(isClaimableTile(spaces, tileAt(state, RECEPTIONIST_INDEX))).toBe(false);
    expect(isClaimableTile(spaces, brand<TileId>("tile.not-on-this-board"))).toBe(false);
  });
});

describe("tile.claim", () => {
  it("buys the unowned tile the actor is standing on", () => {
    const state = ownershipState();
    const tileId = tileAt(state, WORK_INDEX);
    const before = moneyOf(state, fixtureIds.owner);

    const { state: next, events } = accept(
      claimTile(state, claimCommand(state, tileId), context([])),
    );

    expect(next.tileOwnership[tileId]).toEqual({
      tileId,
      ownerId: fixtureIds.owner,
      level: 0,
      claimedAtRound: state.turn.round,
      tollPaidCount: 0,
    });
    expect(moneyOf(next, fixtureIds.owner)).toBe(before - 400);
    expect(next.revision).toBe(state.revision + 1);
    expect(next.lastCommandId).toBe("command-claim");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: "ResourceChanged",
        payload: expect.objectContaining({
          playerId: fixtureIds.owner,
          previousValue: before,
          newValue: before - 400,
          reason: "tile-claim",
        }),
      }),
    );
  });

  it("leaves the turn exactly where it was", () => {
    const state = ownershipState();
    const { state: next } = accept(
      claimTile(state, claimCommand(state, tileAt(state, WORK_INDEX)), context([])),
    );

    expect(next.turn).toEqual(state.turn);
  });

  it("rejects a claim from a player whose turn it is not", () => {
    const state = ownershipState();

    expectRejected(
      claimTile(
        state,
        claimCommand(state, tileAt(state, WORK_INDEX), {
          actorId: fixtureIds.hiddenOpponent,
        }),
        context([]),
      ),
      "NOT_ACTOR_TURN",
    );
  });

  it("rejects a claim from somebody who is not in the game at all", () => {
    const state = ownershipState();

    expectRejected(
      claimTile(
        state,
        claimCommand(state, tileAt(state, WORK_INDEX), {
          actorId: brand<PlayerId>("player-not-seated"),
        }),
        context([]),
      ),
      "ACTOR_NOT_FOUND",
    );
  });

  it("rejects every claim when the mode has ownership switched off", () => {
    const state = ownershipState({ ownershipEnabled: false });

    expectRejected(
      claimTile(state, claimCommand(state, tileAt(state, WORK_INDEX)), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("rejects a claim the actor cannot pay for", () => {
    const state = withResource(ownershipState(), fixtureIds.owner, "money", 399);

    expectRejected(
      claimTile(state, claimCommand(state, tileAt(state, WORK_INDEX)), context([])),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("rejects a claim on a tile the actor is not standing on", () => {
    const state = ownershipState();

    expectRejected(
      claimTile(state, claimCommand(state, tileAt(state, MEETING_INDEX)), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("rejects a claim on a corner tile", () => {
    const state = movedTo(ownershipState(), fixtureIds.owner, RECEPTIONIST_INDEX);

    expectRejected(
      claimTile(state, claimCommand(state, tileAt(state, RECEPTIONIST_INDEX)), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("rejects a claim on a tileId that is not on this board", () => {
    const state = ownershipState();

    expectRejected(
      claimTile(state, claimCommand(state, brand<TileId>("tile.elsewhere")), context([])),
      "INVALID_COMMAND",
    );
  });

  it("rejects a second claim on an already-owned tile", () => {
    const state = ownedBy(
      ownershipState(),
      tileAt(ownershipState(), WORK_INDEX),
      fixtureIds.revealedOpponent,
    );

    expectRejected(
      claimTile(state, claimCommand(state, tileAt(state, WORK_INDEX)), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("emits no event when the mode prices claims at nothing", () => {
    const state = ownershipState({ claimCostMultiplier: 0 });
    const { state: next, events } = accept(
      claimTile(state, claimCommand(state, tileAt(state, WORK_INDEX)), context([])),
    );

    expect(events).toEqual([]);
    expect(next.eventSequence).toBe(state.eventSequence);
    expect(next.tileOwnership[tileAt(state, WORK_INDEX)]?.ownerId).toBe(fixtureIds.owner);
  });

  it("round-trips the claimed board through JSON unchanged", () => {
    const state = ownershipState();
    const { state: next } = accept(
      claimTile(state, claimCommand(state, tileAt(state, WORK_INDEX)), context([])),
    );

    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
  });
});

describe("tile.upgrade", () => {
  function ownedState(level = 0): GameState {
    const base = ownershipState();

    return ownedBy(base, tileAt(base, WORK_INDEX), fixtureIds.owner, level);
  }

  it("raises the level of a tile the actor owns and stands on", () => {
    const state = ownedState(0);
    const tileId = tileAt(state, WORK_INDEX);
    const before = moneyOf(state, fixtureIds.owner);

    const { state: next, events } = accept(
      upgradeTile(state, upgradeCommand(state, tileId), context([])),
    );

    expect(next.tileOwnership[tileId]?.level).toBe(1);
    expect(next.tileOwnership[tileId]?.claimedAtRound).toBe(1);
    expect(moneyOf(next, fixtureIds.owner)).toBe(before - 400);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: "ResourceChanged",
        payload: expect.objectContaining({ reason: "tile-upgrade" }),
      }),
    );
  });

  it("charges more for each level reached", () => {
    const state = ownedState(1);
    const before = moneyOf(state, fixtureIds.owner);
    const { state: next } = accept(
      upgradeTile(state, upgradeCommand(state, tileAt(state, WORK_INDEX)), context([])),
    );

    expect(moneyOf(next, fixtureIds.owner)).toBe(before - 800);
    expect(next.tileOwnership[tileAt(state, WORK_INDEX)]?.level).toBe(2);
  });

  it("refuses to let a player upgrade somebody else's tile", () => {
    const base = ownershipState();
    const tileId = tileAt(base, WORK_INDEX);
    // The thief is the active player and is standing on the tile: the only thing
    // stopping them is that they do not own it.
    const owned = ownedBy(base, tileId, fixtureIds.owner);
    const state: GameState = {
      ...movedTo(owned, fixtureIds.hiddenOpponent, WORK_INDEX),
      turn: { ...owned.turn, activePlayerId: fixtureIds.hiddenOpponent },
    };
    const withCash = withResource(state, fixtureIds.hiddenOpponent, "money", 5000);

    expectRejected(
      upgradeTile(
        withCash,
        upgradeCommand(withCash, tileId, { actorId: fixtureIds.hiddenOpponent }),
        context([]),
      ),
      "ACTOR_NOT_AUTHORIZED",
    );
  });

  it("rejects an upgrade from a player whose turn it is not", () => {
    const state = ownedState(0);

    expectRejected(
      upgradeTile(
        state,
        upgradeCommand(state, tileAt(state, WORK_INDEX), {
          actorId: fixtureIds.revealedOpponent,
        }),
        context([]),
      ),
      "NOT_ACTOR_TURN",
    );
  });

  it("rejects every upgrade when the mode has upgrades switched off", () => {
    const base = withRules(ownedState(0), { board: { upgradesEnabled: false } });

    expectRejected(
      upgradeTile(base, upgradeCommand(base, tileAt(base, WORK_INDEX)), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("rejects an upgrade the actor cannot pay for", () => {
    const state = withResource(ownedState(0), fixtureIds.owner, "money", 399);

    expectRejected(
      upgradeTile(state, upgradeCommand(state, tileAt(state, WORK_INDEX)), context([])),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("rejects an upgrade past the level cap", () => {
    const state = withResource(
      ownedState(MAX_TILE_LEVEL),
      fixtureIds.owner,
      "money",
      100000,
    );

    expectRejected(
      upgradeTile(state, upgradeCommand(state, tileAt(state, WORK_INDEX)), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("rejects an upgrade on an unowned tile", () => {
    const state = ownershipState();

    expectRejected(
      upgradeTile(state, upgradeCommand(state, tileAt(state, WORK_INDEX)), context([])),
      "ILLEGAL_ACTION",
    );
  });

  it("round-trips the upgraded board through JSON unchanged", () => {
    const state = ownedState(0);
    const { state: next } = accept(
      upgradeTile(state, upgradeCommand(state, tileAt(state, WORK_INDEX)), context([])),
    );

    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
  });
});

describe("the toll landing trigger", () => {
  /** The owner is standing on a tile the revealed opponent owns. */
  function tollState(level = 0, landerMoney = 1000): GameState {
    const base = withResource(
      withResource(ownershipState(), fixtureIds.owner, "money", landerMoney),
      fixtureIds.revealedOpponent,
      "money",
      50,
    );

    return ownedBy(base, tileAt(base, WORK_INDEX), fixtureIds.revealedOpponent, level);
  }

  function landing(state: GameState) {
    const lander = state.players[fixtureIds.owner];
    if (lander === undefined) throw new Error("fixture missing lander");

    return { state, lander, tileId: tileAt(state, WORK_INDEX) };
  }

  it("moves money from the lander to the tile's owner", () => {
    const state = tollState();
    const outcome = resolveTileToll(landing(state));

    expect(outcome.assessed).toBe(100);
    expect(outcome.paid).toBe(100);
    expect(outcome.ownerId).toBe(fixtureIds.revealedOpponent);
    expect(outcome.lander.resources["money"]?.value).toBe(900);
    expect(outcome.owner?.resources["money"]?.value).toBe(150);
    expect(outcome.tileOwnership[tileAt(state, WORK_INDEX)]?.tollPaidCount).toBe(1);
    expect(outcome.changes.map((change) => change.reason)).toEqual([
      "tile-toll",
      "tile-toll-received",
    ]);
  });

  it("charges more on an upgraded tile", () => {
    expect(resolveTileToll(landing(tollState(2))).paid).toBe(300);
  });

  it("charges nothing when the mode has ownership switched off", () => {
    const state = withRules(tollState(), { board: { ownershipEnabled: false } });
    const outcome = resolveTileToll(landing(state));

    expect(outcome.paid).toBe(0);
    expect(outcome.ownerId).toBeNull();
    expect(outcome.owner).toBeNull();
    expect(outcome.changes).toEqual([]);
    expect(outcome.lander).toBe(landing(state).lander);
  });

  it("never charges an owner for landing on their own tile", () => {
    const base = ownershipState();
    const state = ownedBy(base, tileAt(base, WORK_INDEX), fixtureIds.owner);
    const outcome = resolveTileToll(landing(state));

    expect(outcome.paid).toBe(0);
    expect(outcome.ownerId).toBeNull();
    expect(outcome.changes).toEqual([]);
  });

  it("charges nothing on an unowned tile", () => {
    const outcome = resolveTileToll(landing(ownershipState()));

    expect(outcome.paid).toBe(0);
    expect(outcome.ownerId).toBeNull();
  });

  it("takes what a broke lander has and reports the shortfall", () => {
    const state = tollState(0, 30);
    const outcome = resolveTileToll(landing(state));

    expect(outcome.assessed).toBe(100);
    expect(outcome.paid).toBe(30);
    expect(outcome.lander.resources["money"]?.value).toBe(0);
    expect(outcome.owner?.resources["money"]?.value).toBe(80);
  });

  it("leaves a penniless lander, the owner and the tile untouched", () => {
    const state = tollState(0, 0);
    const outcome = resolveTileToll(landing(state));

    expect(outcome.assessed).toBe(100);
    expect(outcome.paid).toBe(0);
    // The owner is still named, so a caller can say who went unpaid.
    expect(outcome.ownerId).toBe(fixtureIds.revealedOpponent);
    expect(outcome.owner).toBeNull();
    expect(outcome.tileOwnership).toBe(state.tileOwnership);
  });

  it("round-trips a state carrying a collected toll through JSON unchanged", () => {
    const state = tollState();
    const outcome = resolveTileToll(landing(state));
    if (outcome.owner === null) throw new Error("expected a paid toll");

    const next: GameState = {
      ...state,
      players: {
        ...state.players,
        [outcome.lander.id]: outcome.lander,
        [outcome.owner.id]: outcome.owner,
      },
      tileOwnership: outcome.tileOwnership,
    };

    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
  });
});
