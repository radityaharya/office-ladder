import { describe, expect, it } from "vitest";

import { resolveEffectsV2 } from "../src/execution/effects-v2";
import type {
  EffectV2,
  EffectsV2Options,
  EffectsV2Outcome,
} from "../src/execution/effects-v2";
import type { GameState, PlayerId } from "../src";
import {
  contentTileId,
  effectsRandom,
  effectsV2Ids,
  effectsV2State,
  moneyOf,
  roundTrip,
} from "./effects-v2-fixtures";
import { withRules } from "./turn-loop-fixtures";

const { actor, rival, leader } = effectsV2Ids;

function run(
  state: GameState,
  effects: readonly EffectV2[],
  options: EffectsV2Options = {},
  actorId: PlayerId = actor,
): EffectsV2Outcome {
  return resolveEffectsV2({
    state,
    actorId,
    effects,
    random: effectsRandom(),
    options,
  });
}

/** Every `effect-skipped` reason the batch reported, for gate assertions. */
function skips(outcome: EffectsV2Outcome): readonly { reason: string; rule: string | null }[] {
  return outcome.trace
    .filter((entry) => entry.type === "effect-skipped")
    .map((entry) => ({ reason: entry.reason, rule: entry.rule }));
}

describe("transferResource — the steal primitive", () => {
  const steal: EffectV2 = {
    type: "transferResource",
    resource: "money",
    amount: 300,
    target: "richest",
  };

  it("moves the resource from the target to the actor", () => {
    const before = effectsV2State();
    const { state } = run(before, [steal]);

    expect(moneyOf(state, leader)).toBe(moneyOf(before, leader) - 300);
    expect(moneyOf(state, actor)).toBe(moneyOf(before, actor) + 300);
  });

  it("never lets the actor push their own money onto somebody else", () => {
    const before = effectsV2State();
    // The actor is the *recipient* by construction; there is no direction flag a
    // card could flip to make a target pay into another target's pocket.
    const { state } = run(before, [{ ...steal, target: "all-opponents" }]);

    expect(moneyOf(state, actor)).toBe(moneyOf(before, actor) + 300 + 300);
    expect(moneyOf(state, rival)).toBe(moneyOf(before, rival) - 300);
    expect(moneyOf(state, leader)).toBe(moneyOf(before, leader) - 300);
  });

  it("takes only what the target has, and says so when there is nothing", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      { type: "transferResource", resource: "money", amount: 10_000, target: "poorest" },
    ]);

    expect(moneyOf(outcome.state, rival)).toBe(0);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor) + 400);
  });

  it("refuses an all-or-nothing steal the target cannot cover", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      {
        type: "transferResource",
        resource: "money",
        amount: 10_000,
        target: "poorest",
        insufficientFunds: "all-or-nothing",
      },
    ]);

    expect(moneyOf(outcome.state, rival)).toBe(moneyOf(before, rival));
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(skips(outcome)).toContainEqual({ reason: "insufficient-resources", rule: null });
  });

  it("is switched off entirely by conflict.targetedAttacks", () => {
    const before = withRules(effectsV2State(), { conflict: { targetedAttacks: false } });
    const outcome = run(before, [steal]);

    expect(moneyOf(outcome.state, leader)).toBe(moneyOf(before, leader));
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "conflict.targetedAttacks",
    });
  });
});

describe("modifyHeat — the price of aggression", () => {
  it("raises the actor's own suspicion and reports the threshold crossing", () => {
    const before = effectsV2State();
    const outcome = run(before, [{ type: "modifyHeat", amount: 3 }]);
    const heat = outcome.state.players[actor]?.heat;

    expect(heat?.value).toBe(3);
    expect(heat?.investigationsOpened).toBe(1);
    expect(heat?.lastIncrementedAtRound).toBe(before.turn.round);
    expect(outcome.heatThresholdCrossedPlayerIds).toEqual([actor]);
  });

  it("does not re-open an investigation for heat that stays above the line", () => {
    const first = run(effectsV2State(), [{ type: "modifyHeat", amount: 3 }]);
    const second = run(first.state, [{ type: "modifyHeat", amount: 1 }]);

    expect(second.state.players[actor]?.heat.value).toBe(4);
    expect(second.state.players[actor]?.heat.investigationsOpened).toBe(1);
    expect(second.heatThresholdCrossedPlayerIds).toEqual([]);
  });

  it("never goes below zero", () => {
    const outcome = run(effectsV2State(), [{ type: "modifyHeat", amount: -5 }]);

    expect(outcome.state.players[actor]?.heat.value).toBe(0);
  });

  it("is switched off by conflict.heatEnabled", () => {
    const outcome = run(withRules(effectsV2State(), { conflict: { heatEnabled: false } }), [
      { type: "modifyHeat", amount: 3 },
    ]);

    expect(outcome.state.players[actor]?.heat.value).toBe(0);
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "conflict.heatEnabled",
    });
  });
});

describe("placeObject — putting something in shared space", () => {
  const place: EffectV2 = { type: "placeObject", placementKind: "placement.rumour" };

  it("places on the actor's own tile by default, owned by the actor", () => {
    const before = effectsV2State();
    const { state } = run(before, [place]);
    const placement = state.placements[0];

    expect(state.placements).toHaveLength(1);
    expect(placement?.tileId).toBe(before.tileIds[before.players[actor].position]);
    expect(placement?.ownerId).toBe(actor);
    expect(placement?.visibility).toBe("public");
    expect(placement?.placedAtRound).toBe(before.turn.round);
  });

  it("honours board.maxPlacementsPerPlayer", () => {
    const outcome = run(effectsV2State(), [place, place, place]);

    expect(outcome.state.placements).toHaveLength(2);
    expect(skips(outcome)).toContainEqual({
      reason: "placement-cap-reached",
      rule: "board.maxPlacementsPerPlayer",
    });
  });

  it("is switched off by board.placementsEnabled", () => {
    const outcome = run(withRules(effectsV2State(), { board: { placementsEnabled: false } }), [
      place,
    ]);

    expect(outcome.state.placements).toHaveLength(0);
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "board.placementsEnabled",
    });
  });

  it("mints ids that are unique within a batch and stable across a JSON round trip", () => {
    const outcome = run(effectsV2State(), [place, place]);
    const ids = outcome.state.placements.map((placement) => placement.id);

    expect(new Set(ids).size).toBe(2);
    expect(roundTrip(outcome.state).placements).toEqual(outcome.state.placements);
  });
});

describe("claimTile / releaseTile — ownership", () => {
  it("claims an unowned tile and charges the multiplied cost", () => {
    const before = effectsV2State();
    const { state } = run(before, [
      { type: "claimTile", tileId: contentTileId(effectsV2Ids.freeTile), baseCost: 250 },
    ]);

    expect(state.tileOwnership[effectsV2Ids.freeTile]?.ownerId).toBe(actor);
    expect(state.tileOwnership[effectsV2Ids.freeTile]?.level).toBe(0);
    expect(moneyOf(state, actor)).toBe(moneyOf(before, actor) - 250);
  });

  it("reads its price from rules.board.claimCostMultiplier, not a constant", () => {
    const before = withRules(effectsV2State(), { board: { claimCostMultiplier: 2 } });
    const { state } = run(before, [
      { type: "claimTile", tileId: contentTileId(effectsV2Ids.freeTile), baseCost: 250 },
    ]);

    expect(moneyOf(state, actor)).toBe(moneyOf(before, actor) - 500);
  });

  it("refuses a claim the actor cannot afford, and charges nothing", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      { type: "claimTile", tileId: contentTileId(effectsV2Ids.freeTile), baseCost: 9_000 },
    ]);

    expect(outcome.state.tileOwnership[effectsV2Ids.freeTile]).toBeUndefined();
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(skips(outcome)).toContainEqual({ reason: "insufficient-resources", rule: null });
  });

  it("refuses to claim a tile somebody else already owns", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      { type: "claimTile", tileId: contentTileId(effectsV2Ids.takenTile), baseCost: 10 },
    ]);

    expect(outcome.state.tileOwnership[effectsV2Ids.takenTile]?.ownerId).toBe(leader);
    expect(moneyOf(outcome.state, actor)).toBe(moneyOf(before, actor));
    expect(skips(outcome)).toContainEqual({ reason: "tile-already-owned", rule: null });
  });

  it("releases only a tile the target actually owns", () => {
    const owned = run(effectsV2State(), [
      { type: "claimTile", tileId: contentTileId(effectsV2Ids.freeTile), baseCost: 100 },
    ]).state;

    const released = run(owned, [
      { type: "releaseTile", tileId: contentTileId(effectsV2Ids.freeTile) },
    ]).state;
    expect(released.tileOwnership[effectsV2Ids.freeTile]).toBeUndefined();

    const foreign = run(owned, [{ type: "releaseTile", tileId: contentTileId(effectsV2Ids.takenTile) }]);
    expect(foreign.state.tileOwnership[effectsV2Ids.takenTile]?.ownerId).toBe(leader);
    expect(skips(foreign)).toContainEqual({ reason: "tile-not-owned", rule: null });
  });

  it("is switched off by board.ownershipEnabled", () => {
    const outcome = run(withRules(effectsV2State(), { board: { ownershipEnabled: false } }), [
      { type: "claimTile", tileId: contentTileId(effectsV2Ids.freeTile), baseCost: 10 },
    ]);

    expect(outcome.state.tileOwnership[effectsV2Ids.freeTile]).toBeUndefined();
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "board.ownershipEnabled",
    });
  });
});

describe("project verbs", () => {
  const start: EffectV2 = {
    type: "startProject",
    definitionId: "project.rebrand",
    requiredMoney: 900,
    requiredWork: 6,
    payout: { money: 1500, reputation: 3, objectiveProgress: 1 },
  };

  it("starts a project led by the target, with a deadline read from the rules", () => {
    const before = effectsV2State();
    const { state } = run(before, [start]);
    const project = state.projects[0];

    expect(project?.leadPlayerId).toBe(actor);
    expect(project?.status).toBe("open");
    expect(project?.deadlineRound).toBe(
      before.turn.round + before.rules.projects.deadlineRounds,
    );
    expect(project?.openToJoin).toBe(true);
  });

  it("honours projects.maxConcurrentPerPlayer", () => {
    const outcome = run(effectsV2State(), [start, start, start]);

    expect(outcome.state.projects).toHaveLength(2);
    expect(skips(outcome)).toContainEqual({
      reason: "project-cap-reached",
      rule: "projects.maxConcurrentPerPlayer",
    });
  });

  it("cannot be opened to joiners in a mode where projects.joinable is off", () => {
    const outcome = run(withRules(effectsV2State(), { projects: { joinable: false } }), [
      { ...start, openToJoin: true },
    ]);

    expect(outcome.state.projects[0]?.openToJoin).toBe(false);
  });

  it("contributes money and work, and refuses a contribution the player cannot cover", () => {
    const started = run(effectsV2State(), [start]).state;
    const projectId = started.projects[0]?.id ?? "";

    const funded = run(started, [
      { type: "contributeToProject", projectId, money: 200, work: 2 },
    ]);
    expect(funded.state.projects[0]?.contributions).toEqual([
      { playerId: actor, money: 200, work: 2, atRound: started.turn.round },
    ]);
    expect(moneyOf(funded.state, actor)).toBe(moneyOf(started, actor) - 200);

    const broke = run(started, [
      { type: "contributeToProject", projectId, money: 200, work: 99 },
    ]);
    expect(broke.state.projects[0]?.contributions).toEqual([]);
    expect(moneyOf(broke.state, actor)).toBe(moneyOf(started, actor));
    expect(skips(broke)).toContainEqual({ reason: "insufficient-resources", rule: null });
  });

  it("records sabotage against the actor, hidden when the card says so", () => {
    const started = run(effectsV2State(), [start], {}, leader).state;
    const outcome = run(started, [
      { type: "sabotageProject", amount: 150, hidden: true },
    ]);

    expect(outcome.state.projects[0]?.sabotage).toEqual([
      { playerId: actor, amount: 150, hidden: true, atRound: started.turn.round },
    ]);
  });

  it("never lets a saboteur pick their own project when no id is given", () => {
    const own = run(effectsV2State(), [start]).state;
    const outcome = run(own, [{ type: "sabotageProject", amount: 50 }]);

    expect(outcome.state.projects[0]?.sabotage).toEqual([]);
    expect(skips(outcome)).toContainEqual({ reason: "project-not-found", rule: null });
  });

  it("is switched off by projects.enabled and by projects.sabotageable", () => {
    const noProjects = run(withRules(effectsV2State(), { projects: { enabled: false } }), [start]);
    expect(noProjects.state.projects).toHaveLength(0);
    expect(skips(noProjects)).toContainEqual({
      reason: "mode-disabled",
      rule: "projects.enabled",
    });

    const started = run(effectsV2State(), [start], {}, leader).state;
    const noSabotage = run(withRules(started, { projects: { sabotageable: false } }), [
      { type: "sabotageProject", amount: 150 },
    ]);
    expect(noSabotage.state.projects[0]?.sabotage).toEqual([]);
    expect(skips(noSabotage)).toContainEqual({
      reason: "mode-disabled",
      rule: "projects.sabotageable",
    });
  });
});

describe("openBallot", () => {
  const vote: EffectV2 = {
    type: "openBallot",
    ballotKind: "vote",
    subjectId: "vote.block-promotion",
    subject: { targetPlayerId: "player-owner" },
    visibility: "sealed",
  };

  it("opens one ballot for the table, not one per opponent", () => {
    const outcome = run(effectsV2State(), [{ ...vote, target: "all-players" }]);

    expect(outcome.state.ballots).toHaveLength(1);
    expect(outcome.state.ballots[0]?.audience).toEqual([actor, rival, leader]);
    expect(outcome.state.ballots[0]?.castBy).toEqual({});
    expect(outcome.state.ballots[0]?.visibility).toBe("sealed");
  });

  it("leaves deadlineAt null unless the caller supplies one — the engine has no clock", () => {
    const withoutDeadline = run(effectsV2State(), [vote]);
    expect(withoutDeadline.state.ballots[0]?.deadlineAt).toBeNull();

    const withDeadline = run(effectsV2State(), [vote], {
      deadlineAt: "2026-07-26T10:00:30.000Z",
    });
    expect(withDeadline.state.ballots[0]?.deadlineAt).toBe("2026-07-26T10:00:30.000Z");
  });

  it("gates votes and auctions on their own rules independently", () => {
    const noVotes = run(withRules(effectsV2State(), { interaction: { votesEnabled: false } }), [
      vote,
    ]);
    expect(noVotes.state.ballots).toHaveLength(0);
    expect(skips(noVotes)).toContainEqual({
      reason: "mode-disabled",
      rule: "interaction.votesEnabled",
    });

    const auctionOnly = run(
      withRules(effectsV2State(), { interaction: { auctionsEnabled: false } }),
      [{ ...vote, ballotKind: "auction", subjectId: "auction.corner-office" }],
    );
    expect(auctionOnly.state.ballots).toHaveLength(0);
    expect(skips(auctionOnly)).toContainEqual({
      reason: "mode-disabled",
      rule: "interaction.auctionsEnabled",
    });
  });
});

describe("grantImmunity", () => {
  it("stacks charges rather than replacing them", () => {
    const outcome = run(effectsV2State(), [
      { type: "grantImmunity", count: 1, scope: {} },
      { type: "grantImmunity", count: 2, scope: {} },
    ]);
    const immunity = outcome.state.players[actor]?.statuses.find(
      (status) => status.id === "status.immunity",
    );

    expect(immunity?.stacks).toBe(3);
  });

  it("is switched off by conflict.defenceEnabled", () => {
    const outcome = run(withRules(effectsV2State(), { conflict: { defenceEnabled: false } }), [
      { type: "grantImmunity", count: 1, scope: {} },
    ]);

    expect(outcome.state.players[actor]?.statuses).toEqual([]);
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "conflict.defenceEnabled",
    });
  });
});

describe("forceDiscard", () => {
  const discard: EffectV2 = { type: "forceDiscard", count: 1, target: "right-neighbour" };

  it("moves the card out of the hand and onto its own deck's discard pile", () => {
    const before = effectsV2State();
    const { state } = run(before, [discard]);

    expect(state.players[rival]?.hand).toEqual([effectsV2Ids.rivalCardB]);
    expect(state.cards[effectsV2Ids.rivalCardA]?.zone).toBe("discard-pile");
    expect(state.cards[effectsV2Ids.rivalCardA]?.ownerId).toBeNull();
    const deckId = before.cards[effectsV2Ids.rivalCardA].deckId;
    expect(state.decks[deckId]?.discardPile).toContain(effectsV2Ids.rivalCardA);
  });

  it("says so when there is nothing to discard", () => {
    const outcome = run(effectsV2State(), [{ ...discard, target: "highest-rank" }]);

    expect(skips(outcome)).toContainEqual({ reason: "no-cards-to-discard", rule: null });
  });

  it("is switched off by agency.handEnabled", () => {
    const before = withRules(effectsV2State(), { agency: { handEnabled: false } });
    const outcome = run(before, [discard]);

    expect(outcome.state.players[rival]?.hand).toHaveLength(2);
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "agency.handEnabled",
    });
  });
});

describe("swapBoardPositions / teleport", () => {
  it("swaps the actor with the target and traverses nothing", () => {
    const before = effectsV2State();
    const { state } = run(before, [{ type: "swapBoardPositions", target: "right-neighbour" }]);

    expect(state.players[actor]?.position).toBe(before.players[rival].position);
    expect(state.players[rival]?.position).toBe(before.players[actor].position);
    // No traversal means no lap, and therefore no salary anybody has to unwind.
    expect(state.players[actor]?.lapsCompleted).toBe(before.players[actor].lapsCompleted);
  });

  it("teleports to an index and refuses one off the board", () => {
    const before = effectsV2State();
    const moved = run(before, [
      { type: "teleport", destination: { kind: "tileIndex", index: 11 } },
    ]);
    expect(moved.state.players[actor]?.position).toBe(11);

    const offBoard = run(before, [
      { type: "teleport", destination: { kind: "tileIndex", index: 9_999 } },
    ]);
    expect(offBoard.state.players[actor]?.position).toBe(before.players[actor].position);
    expect(skips(offBoard)).toContainEqual({ reason: "tile-unknown", rule: null });
  });

  it("resolves a teleport destination given by tile id", () => {
    const before = effectsV2State();
    const target = before.tileIds[7];
    const { state } = run(before, [
      { type: "teleport", destination: { kind: "tileId", tileId: contentTileId(target) } },
    ]);

    expect(state.players[actor]?.position).toBe(7);
  });

  it("blocks a cross-player swap when conflict.targetedAttacks is off", () => {
    const before = withRules(effectsV2State(), { conflict: { targetedAttacks: false } });
    const outcome = run(before, [{ type: "swapBoardPositions", target: "right-neighbour" }]);

    expect(outcome.state.players[actor]?.position).toBe(before.players[actor].position);
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "conflict.targetedAttacks",
    });
  });

  it("still allows a self-teleport with attacks switched off — it is not an attack", () => {
    const before = withRules(effectsV2State(), { conflict: { targetedAttacks: false } });
    const { state } = run(before, [
      { type: "teleport", destination: { kind: "tileIndex", index: 11 } },
    ]);

    expect(state.players[actor]?.position).toBe(11);
  });
});

describe("modifyUpkeep / grantIncomeStream", () => {
  it("moves upkeep and floors it at zero", () => {
    const before = effectsV2State();
    const raised = run(before, [{ type: "modifyUpkeep", amount: 50 }]);
    expect(raised.state.players[actor]?.upkeep.perRound).toBe(150);

    const relieved = run(before, [{ type: "modifyUpkeep", amount: -500 }]);
    expect(relieved.state.players[actor]?.upkeep.perRound).toBe(0);
  });

  it("is switched off by economy.upkeepEnabled", () => {
    const before = withRules(effectsV2State(), { economy: { upkeepEnabled: false } });
    const outcome = run(before, [{ type: "modifyUpkeep", amount: 50 }]);

    expect(outcome.state.players[actor]?.upkeep.perRound).toBe(100);
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "economy.upkeepEnabled",
    });
  });

  it("grants an income stream and is switched off by economy.incomeStreamsEnabled", () => {
    const granted = run(effectsV2State(), [
      {
        type: "grantIncomeStream",
        streamKind: "rent",
        perRound: 25,
        remainingRounds: null,
      },
    ]);
    expect(granted.state.players[actor]?.incomeStreams).toHaveLength(1);
    expect(granted.state.players[actor]?.incomeStreams[0]?.perRound).toBe(25);

    const off = run(withRules(effectsV2State(), { economy: { incomeStreamsEnabled: false } }), [
      {
        type: "grantIncomeStream",
        streamKind: "rent",
        perRound: 25,
        remainingRounds: null,
      },
    ]);
    expect(off.state.players[actor]?.incomeStreams).toHaveLength(0);
    expect(skips(off)).toContainEqual({
      reason: "mode-disabled",
      rule: "economy.incomeStreamsEnabled",
    });
  });
});

describe("openReactionWindow", () => {
  it("raises one window for the table, with the actor excluded and priority in turn order", () => {
    const outcome = run(effectsV2State(), [
      { type: "openReactionWindow", windowKind: "end-turn" },
    ]);
    const window = outcome.state.reactionWindows[0];

    expect(outcome.state.reactionWindows).toHaveLength(1);
    expect(window?.eligiblePlayerIds).toEqual([rival, leader]);
    expect(window?.priorityPlayerId).toBe(rival);
    expect(window?.pendingEffectId).toBeNull();
    expect(outcome.openedReactionWindows).toEqual([window]);
  });

  it("is switched off by interaction.reactionWindows", () => {
    const outcome = run(
      withRules(effectsV2State(), { interaction: { reactionWindows: false } }),
      [{ type: "openReactionWindow", windowKind: "end-turn" }],
    );

    expect(outcome.state.reactionWindows).toHaveLength(0);
    expect(skips(outcome)).toContainEqual({
      reason: "mode-disabled",
      rule: "interaction.reactionWindows",
    });
  });
});

describe("v1 effects keep working, and now work on somebody else", () => {
  it("applies an authored v1 effect to a derived target", () => {
    const before = effectsV2State();
    const { state } = run(before, [
      { type: "modifyResource", resource: "reputation", amount: -2, target: "highest-rank" },
    ]);

    expect(state.players[leader]?.resources["reputation"]?.value).toBe(7);
    expect(state.players[actor]?.resources["reputation"]?.value).toBe(5);
  });

  it("defaults to the actor, exactly as v1 did", () => {
    const before = effectsV2State();
    const { state, changes } = run(before, [
      { type: "modifyResource", resource: "money", amount: 100 },
    ]);

    expect(moneyOf(state, actor)).toBe(moneyOf(before, actor) + 100);
    expect(changes).toEqual([
      { playerId: actor, resource: "money", previousValue: 1000, newValue: 1100 },
    ]);
  });

  it("reports skipTurns and audit confinement per affected player", () => {
    const outcome = run(effectsV2State(), [
      { type: "skipTurns", count: 1, source: "tile", target: "right-neighbour" },
    ]);

    expect(outcome.state.players[rival]?.skipTurns).toBe(1);
    expect(outcome.state.players[actor]?.skipTurns).toBe(0);
  });
});

describe("the whole batch stays JSON-clean", () => {
  it("round-trips every collection it wrote, byte for byte", () => {
    const before = effectsV2State();
    const outcome = run(before, [
      { type: "placeObject", placementKind: "placement.surveillance", visibility: "owner-only" },
      {
        type: "startProject",
        definitionId: "project.rebrand",
        requiredMoney: 900,
        requiredWork: 6,
        payout: { money: 1500, reputation: 3, objectiveProgress: 1 },
      },
      { type: "openBallot", ballotKind: "auction", subjectId: "auction.corner-office" },
      { type: "grantIncomeStream", streamKind: "asset", perRound: 10, remainingRounds: 3 },
      { type: "claimTile", tileId: contentTileId(effectsV2Ids.freeTile), baseCost: 100 },
      { type: "grantImmunity", count: 2, scope: {} },
      { type: "modifyHeat", amount: 1 },
    ]);

    expect(roundTrip(outcome.state)).toEqual(outcome.state);
  });

  it("carries no undefined anywhere in the state it produced", () => {
    const outcome = run(effectsV2State(), [
      { type: "placeObject", placementKind: "placement.favour" },
      { type: "openBallot", ballotKind: "vote", subjectId: "vote.anything" },
    ]);

    const hasUndefined = (value: unknown, seen = new Set<unknown>()): boolean => {
      if (value === undefined) return true;
      if (value === null || typeof value !== "object" || seen.has(value)) return false;
      seen.add(value);

      return Object.values(value as Record<string, unknown>).some((inner) =>
        hasUndefined(inner, seen),
      );
    };

    expect(hasUndefined(outcome.state.placements)).toBe(false);
    expect(hasUndefined(outcome.state.ballots)).toBe(false);
  });

  it("leaves the caller's bookkeeping fields untouched", () => {
    const before = effectsV2State();
    const { state } = run(before, [{ type: "modifyHeat", amount: 1 }]);

    expect(state.revision).toBe(before.revision);
    expect(state.eventSequence).toBe(before.eventSequence);
    expect(state.turn).toEqual(before.turn);
    expect(state.lastCommandId).toBe(before.lastCommandId);
  });

  it("is deterministic: the same batch against the same state twice is identical", () => {
    const batch: readonly EffectV2[] = [
      { type: "modifyHeat", amount: 2 },
      { type: "placeObject", placementKind: "placement.sabotage" },
      { type: "transferResource", resource: "money", amount: 250, target: "richest" },
      { type: "openBallot", ballotKind: "vote", subjectId: "vote.reorg" },
      {
        type: "startProject",
        definitionId: "project.rebrand",
        requiredMoney: 900,
        requiredWork: 6,
        payout: { money: 1500, reputation: 3, objectiveProgress: 1 },
      },
    ];

    const first = run(effectsV2State(), batch);
    const second = run(effectsV2State(), batch);
    expect(second.state).toEqual(first.state);
    expect(second.trace).toEqual(first.trace);

    // …and identical again when the state it started from came back off disk.
    const third = run(roundTrip(effectsV2State()), batch);
    expect(third.state).toEqual(first.state);
  });

  it("does not mutate the state it was given", () => {
    const before = effectsV2State();
    const snapshot = JSON.stringify(before);
    run(before, [
      { type: "modifyHeat", amount: 2 },
      { type: "placeObject", placementKind: "placement.rumour" },
      { type: "transferResource", resource: "money", amount: 50, target: "richest" },
    ]);

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
