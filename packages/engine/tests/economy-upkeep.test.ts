import { describe, expect, it } from "vitest";

import { deserializeGameState, serializeGameState, stableStringify } from "../src";
import type { GameState, PlayerId } from "../src";
import {
  economyActive,
  findMoney,
  grantIncomeStream,
  incomeStreamId,
  revokeIncomeStreams,
  settleIncomeStreams,
} from "../src/execution/economy";
import {
  chargeUpkeep,
  forecastEconomy,
  refreshUpkeepForRank,
  resolveBankruptcy,
  settleRound,
  upkeepPerRoundForRankIndex,
} from "../src/execution/upkeep";
import {
  deepFreeze,
  economyContent,
  economyIds,
  economyRules,
  economyState,
  incomeStream,
  loan,
  rankAtIndex,
} from "./economy-fixtures";

const { owner, hiddenOpponent, revealedOpponent } = economyIds;

function settle(state: GameState, round = state.turn.round) {
  return settleRound(state, {
    round,
    players: state.players,
    content: economyContent,
  });
}

function moneyOf(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (player === undefined) throw new Error(`no player ${playerId}`);

  return findMoney(player)?.resource.value ?? 0;
}

describe("upkeep ladder", () => {
  it("Given a ruleset with upkeep enabled, When a rank index is looked up, Then the charge comes from the ladder and never from a constant", () => {
    const ladder = economyRules.economy.upkeepByRankIndex;

    expect(upkeepPerRoundForRankIndex(economyRules, 0)).toBe(ladder[0]);
    expect(upkeepPerRoundForRankIndex(economyRules, 3)).toBe(ladder[3]);
    // Clamped rather than undefined: a rank index outside the ladder is a
    // content or custom-mode bug, not a reason to charge NaN.
    expect(upkeepPerRoundForRankIndex(economyRules, 99)).toBe(ladder[ladder.length - 1]);
    expect(upkeepPerRoundForRankIndex(economyRules, -4)).toBe(ladder[0]);
  });

  it("Given a ruleset with upkeep disabled, When any rank index is looked up, Then the charge is zero", () => {
    const disabled = { ...economyRules, economy: { ...economyRules.economy, upkeepEnabled: false } };

    for (let index = 0; index < 9; index += 1) {
      expect(upkeepPerRoundForRankIndex(disabled, index)).toBe(0);
    }
  });
});

describe("promotion raising upkeep", () => {
  it("Given promotionRaisesUpkeep is on, When a player's rank index rises, Then refreshing re-derives the standing charge from the new rank", () => {
    const state = economyState({ players: { [owner]: { rankIndex: 1, perRound: economyRules.economy.upkeepByRankIndex[1] ?? 0 } } });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const promoted = { ...player, rank: rankAtIndex(2) };
    const refreshed = refreshUpkeepForRank(promoted, state.rules);

    expect(state.rules.agency.promotionRaisesUpkeep).toBe(true);
    expect(refreshed.upkeep.perRound).toBe(economyRules.economy.upkeepByRankIndex[2]);
    expect(refreshed.upkeep.perRound).toBeGreaterThan(player.upkeep.perRound);
  });

  it("Given promotionRaisesUpkeep is off, When a player's rank index rises, Then the standing charge does not move", () => {
    const state = economyState({
      rules: { agency: { promotionRaisesUpkeep: false } },
      players: { [owner]: { rankIndex: 1, perRound: 50 } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const promoted = { ...player, rank: rankAtIndex(4) };
    const refreshed = refreshUpkeepForRank(promoted, state.rules);

    expect(refreshed.upkeep.perRound).toBe(50);
    // Returned untouched, not rebuilt: climbing costs nothing extra in a mode
    // that says so.
    expect(refreshed).toBe(promoted);
  });

  it("Given upkeep is disabled entirely, When a rank rises, Then refreshing is a no-op", () => {
    const state = economyState({
      rules: { economy: { upkeepEnabled: false } },
      players: { [owner]: { rankIndex: 0, perRound: 0 } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    expect(refreshUpkeepForRank({ ...player, rank: rankAtIndex(5) }, state.rules).upkeep.perRound).toBe(0);
  });
});

describe("charging upkeep", () => {
  it("Given a player who can cover the charge, When upkeep is charged, Then the money leaves, the round is stamped and nothing is missed", () => {
    const state = economyState({ players: { [owner]: { money: 1000, perRound: 150 } } });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const charge = chargeUpkeep(player, state.rules, 4);

    expect(charge.amountDue).toBe(150);
    expect(charge.amountPaid).toBe(150);
    expect(charge.missed).toBe(false);
    expect(findMoney(charge.player)?.resource.value).toBe(850);
    expect(charge.player.upkeep.lastChargedRound).toBe(4);
    expect(charge.player.upkeep.missedPayments).toBe(0);
    expect(charge.change).toEqual(
      expect.objectContaining({ previousValue: 1000, newValue: 850, reason: "upkeep" }),
    );
  });

  it("Given a player short of the charge, When upkeep is charged, Then they pay what they have and the miss is recorded rather than silently succeeding", () => {
    const state = economyState({ players: { [owner]: { money: 40, perRound: 150 } } });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const charge = chargeUpkeep(player, state.rules, 2);

    expect(charge.amountDue).toBe(150);
    expect(charge.amountPaid).toBe(40);
    expect(charge.missed).toBe(true);
    expect(findMoney(charge.player)?.resource.value).toBe(0);
    expect(charge.player.upkeep.missedPayments).toBe(1);
  });

  it("Given a temporary relief written onto perRound, When upkeep is charged, Then the reduced amount is what is taken", () => {
    // `modifyUpkeep` (spec §10.3) writes `upkeep.perRound`; the charge has to
    // read that field rather than re-deriving from the rank, or relief is a lie.
    const state = economyState({ players: { [owner]: { money: 1000, rankIndex: 4, perRound: 25 } } });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    expect(chargeUpkeep(player, state.rules, 1).amountPaid).toBe(25);
  });

  it("Given a mode with upkeep disabled, When upkeep is charged, Then no money moves", () => {
    const state = economyState({
      rules: { economy: { upkeepEnabled: false } },
      players: { [owner]: { money: 1000, perRound: 150 } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const charge = chargeUpkeep(player, state.rules, 1);

    expect(charge.amountDue).toBe(0);
    expect(charge.change).toBeNull();
    expect(findMoney(charge.player)?.resource.value).toBe(1000);
  });
});

describe("bankruptcy", () => {
  it("Given bankruptcy is none, When a payment is missed, Then the rank holds and nobody is eliminated", () => {
    const state = economyState({
      rules: { economy: { bankruptcy: "none" } },
      players: { [owner]: { money: 0, rankIndex: 3, perRound: 150 } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const resolution = resolveBankruptcy(player, state.rules, economyContent);

    expect(resolution.applied).toBeNull();
    expect(resolution.eliminated).toBe(false);
    expect(resolution.player.rank.index).toBe(3);
  });

  it("Given bankruptcy is demote, When a payment is missed, Then the player drops a rung and their standing charge drops with it", () => {
    const state = economyState({
      players: { [owner]: { money: 0, rankIndex: 3, perRound: economyRules.economy.upkeepByRankIndex[3] ?? 0 } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const resolution = resolveBankruptcy(player, state.rules, economyContent);

    expect(state.rules.economy.bankruptcy).toBe("demote");
    expect(resolution.applied).toBe("demote");
    expect(resolution.demotedToRankIndex).toBe(2);
    expect(resolution.player.rank).toEqual(rankAtIndex(2));
    expect(resolution.player.upkeep.perRound).toBe(economyRules.economy.upkeepByRankIndex[2]);
  });

  it("Given a player already on the bottom rung, When demotion is resolved, Then nothing happens and they are not eliminated", () => {
    const state = economyState({ players: { [owner]: { money: 0, rankIndex: 0, perRound: 100 } } });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const resolution = resolveBankruptcy(player, state.rules, economyContent);

    expect(resolution.applied).toBeNull();
    expect(resolution.eliminated).toBe(false);
    expect(resolution.player.rank.index).toBe(0);
  });

  it("Given bankruptcy is eliminate, When a payment is missed, Then the player is reported as out", () => {
    const state = economyState({
      rules: { economy: { bankruptcy: "eliminate" } },
      players: { [owner]: { money: 0, rankIndex: 2, perRound: 150 } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const resolution = resolveBankruptcy(player, state.rules, economyContent);

    expect(resolution.applied).toBe("eliminate");
    expect(resolution.eliminated).toBe(true);
    // Elimination is the caller's write to `eliminatedPlayerIds`, not a rank change.
    expect(resolution.player.rank.index).toBe(2);
  });
});

describe("granting income streams", () => {
  it("Given income streams are enabled, When one is granted, Then it is recorded with an id derived from server-owned state alone", () => {
    const state = economyState({ players: { [owner]: { money: 0 } } });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const granted = grantIncomeStream(state, player, {
      kind: "asset",
      perRound: 60,
      remainingRounds: 4,
      sourceId: "tile-5",
    });

    expect(granted.incomeStreams).toHaveLength(1);
    expect(granted.incomeStreams[0]).toEqual(
      expect.objectContaining({ kind: "asset", perRound: 60, remainingRounds: 4, sourceId: "tile-5" }),
    );
    expect(granted.incomeStreams[0]?.id).toBe(incomeStreamId(state, player));
  });

  it("Given a mode with income streams disabled, When one is granted, Then nothing is banked for a later flag flip to start paying", () => {
    const state = economyState({
      rules: { economy: { incomeStreamsEnabled: false } },
      players: { [owner]: { money: 0 } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const granted = grantIncomeStream(state, player, {
      kind: "rent",
      perRound: 60,
      remainingRounds: null,
      sourceId: null,
    });

    expect(granted).toBe(player);
  });

  it.each([0, -10, Number.NaN])(
    "Given a stream worth %p per round, When it is granted, Then it is refused rather than recorded",
    (perRound) => {
      const state = economyState();
      const player = state.players[owner];
      if (player === undefined) throw new Error("fixture missing owner");

      expect(
        grantIncomeStream(state, player, { kind: "rent", perRound, remainingRounds: null, sourceId: null })
          .incomeStreams,
      ).toEqual([]);
    },
  );

  it("Given streams from several sources, When one source is revoked, Then only its streams go", () => {
    const state = economyState({
      players: {
        [owner]: {
          incomeStreams: [
            incomeStream("stream-tile", { sourceId: "tile-5" }),
            incomeStream("stream-project", { kind: "project", sourceId: "project-rebrand" }),
          ],
        },
      },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const revoked = revokeIncomeStreams(player, "tile-5");

    expect(revoked.incomeStreams.map((stream) => stream.id)).toEqual(["stream-project"]);
    expect(revokeIncomeStreams(revoked, "tile-nothing")).toBe(revoked);
  });
});

describe("income streams", () => {
  it("Given a perpetual stream, When a round is settled, Then it pays and does not age out", () => {
    const state = economyState({
      players: { [owner]: { money: 100, incomeStreams: [incomeStream("stream-rent", { perRound: 40 })] } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const settled = settleIncomeStreams(player, state.rules);

    expect(settled.credited).toBe(40);
    expect(findMoney(settled.player)?.resource.value).toBe(140);
    expect(settled.player.incomeStreams).toHaveLength(1);
    expect(settled.expiredStreamIds).toEqual([]);
  });

  it("Given a stream with one round left, When it pays, Then it pays that round and is then gone", () => {
    const state = economyState({
      players: { [owner]: { money: 0, incomeStreams: [incomeStream("stream-gig", { kind: "side-gig", perRound: 75, remainingRounds: 1 })] } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const settled = settleIncomeStreams(player, state.rules);

    expect(settled.credited).toBe(75);
    expect(settled.player.incomeStreams).toEqual([]);
    expect(settled.expiredStreamIds).toEqual(["stream-gig"]);
  });

  it("Given a mode with income streams disabled, When a round is settled, Then a stream on the record pays nothing and does not age", () => {
    const state = economyState({
      rules: { economy: { incomeStreamsEnabled: false } },
      players: { [owner]: { money: 0, incomeStreams: [incomeStream("stream-rent", { remainingRounds: 3 })] } },
    });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");

    const settled = settleIncomeStreams(player, state.rules);

    expect(settled.credited).toBe(0);
    expect(settled.player.incomeStreams[0]?.remainingRounds).toBe(3);
    expect(findMoney(settled.player)?.resource.value).toBe(0);
  });
});

describe("round settlement", () => {
  it("Given a table entering a new round, When the round is settled, Then every seat is charged exactly once, in playerOrder", () => {
    const state = economyState({
      round: 2,
      players: {
        [owner]: { money: 1000, perRound: 100 },
        [hiddenOpponent]: { money: 1000, perRound: 50 },
        [revealedOpponent]: { money: 1000, perRound: 200 },
      },
    });

    const settlement = settle(state);

    expect(settlement.settled).toBe(true);
    expect(settlement.entries.map((entry) => entry.playerId)).toEqual(state.playerOrder);
    expect(settlement.changes.map((change) => change.playerId)).toEqual(state.playerOrder);
    expect(settlement.players[owner]?.resources.money?.value).toBe(900);
    expect(settlement.players[hiddenOpponent]?.resources.money?.value).toBe(950);
    expect(settlement.players[revealedOpponent]?.resources.money?.value).toBe(800);
    for (const playerId of state.playerOrder) {
      expect(settlement.players[playerId]?.upkeep.lastChargedRound).toBe(2);
    }
  });

  it("Given a round already settled, When the same round is settled again, Then nothing moves", () => {
    const state = economyState({ round: 3, players: { [owner]: { money: 1000, perRound: 100 } } });

    const first = settle(state);
    const second = settleRound(
      { ...state, players: first.players },
      { round: 3, players: first.players, content: economyContent },
    );

    expect(first.settled).toBe(true);
    expect(second.settled).toBe(false);
    expect(second.changes).toEqual([]);
    expect(stableStringify(second.players)).toBe(stableStringify(first.players));
  });

  it("Given a mode with the whole economy switched off, When a round is settled, Then the settlement is inert and does not even stamp the watermark", () => {
    const state = economyState({
      rules: { economy: { upkeepEnabled: false, loansEnabled: false, incomeStreamsEnabled: false } },
      round: 5,
      players: { [owner]: { money: 1000, perRound: 100 } },
    });

    const settlement = settle(state);

    expect(economyActive(state.rules)).toBe(false);
    expect(settlement.settled).toBe(false);
    expect(settlement.players).toBe(state.players);
    expect(settlement.entries).toEqual([]);
    // Not even the watermark moves, which is what keeps a Quick-preset match
    // byte-identical to the pre-economy engine.
    expect(settlement.players[owner]?.upkeep.lastChargedRound).toBe(
      state.players[owner]?.upkeep.lastChargedRound,
    );
  });

  it("Given upkeep off but lending on, When a round is settled, Then interest still accrues and no upkeep is taken", () => {
    const state = economyState({
      rules: { economy: { upkeepEnabled: false } },
      round: 1,
      players: { [owner]: { money: 500, perRound: 100, loans: [loan("loan-owner", { outstanding: 1000, interestBasisPoints: 1000 })] } },
    });

    const settlement = settle(state);

    expect(settlement.settled).toBe(true);
    expect(settlement.players[owner]?.resources.money?.value).toBe(500);
    expect(settlement.players[owner]?.loans[0]?.outstanding).toBe(1100);
    expect(settlement.entries[0]?.upkeepDue).toBe(0);
  });

  it("Given income and upkeep in the same round, When the round is settled, Then income lands first and can cover the bill", () => {
    const state = economyState({
      players: {
        [owner]: { money: 20, perRound: 100, incomeStreams: [incomeStream("stream-rent", { perRound: 90 })] },
      },
    });

    const settlement = settle(state);
    const entry = settlement.entries.find((candidate) => candidate.playerId === owner);

    expect(entry?.incomeCredited).toBe(90);
    expect(entry?.upkeepPaid).toBe(100);
    expect(entry?.missedPayments).toBe(0);
    expect(settlement.players[owner]?.resources.money?.value).toBe(10);
    expect(settlement.changes.map((change) => change.reason)).toEqual(["income-stream", "upkeep"]);
  });

  it("Given a player who cannot cover the bill, When the round is settled, Then the balance empties, the miss is recorded and the bankruptcy rule fires", () => {
    const state = economyState({
      round: 2,
      players: { [owner]: { money: 30, rankIndex: 2, perRound: 100 } },
    });

    const settlement = settle(state);
    const entry = settlement.entries.find((candidate) => candidate.playerId === owner);

    expect(entry?.upkeepDue).toBe(100);
    expect(entry?.upkeepPaid).toBe(30);
    expect(entry?.missedPayments).toBe(1);
    expect(entry?.bankruptcy).toBe("demote");
    expect(entry?.demotedToRankIndex).toBe(1);
    expect(settlement.players[owner]?.resources.money?.value).toBe(0);
    expect(settlement.players[owner]?.upkeep.missedPayments).toBe(1);
    expect(settlement.players[owner]?.rank.index).toBe(1);
  });

  it("Given bankruptcy set to eliminate, When a player misses, Then they join eliminatedPlayerIds and are skipped by later settlements", () => {
    const state = economyState({
      rules: { economy: { bankruptcy: "eliminate" } },
      round: 2,
      players: {
        [owner]: { money: 0, perRound: 100 },
        [hiddenOpponent]: { money: 1000, perRound: 100 },
        [revealedOpponent]: { money: 1000, perRound: 100 },
      },
    });

    const settlement = settle(state);
    expect(settlement.newlyEliminatedPlayerIds).toEqual([owner]);
    expect(settlement.eliminatedPlayerIds).toEqual([owner]);

    const next = settleRound(
      { ...state, players: settlement.players, eliminatedPlayerIds: settlement.eliminatedPlayerIds },
      { round: 3, players: settlement.players, content: economyContent },
    );

    expect(next.entries.map((entry) => entry.playerId)).toEqual([hiddenOpponent, revealedOpponent]);
    expect(next.players[owner]?.upkeep.lastChargedRound).toBe(2);
  });

  it("Given elimination empties the table down to one, When the round is settled, Then the survivor is reported as last standing", () => {
    const state = economyState({
      rules: { economy: { bankruptcy: "eliminate" } },
      round: 4,
      eliminatedPlayerIds: [revealedOpponent],
      players: {
        [owner]: { money: 0, perRound: 100 },
        [hiddenOpponent]: { money: 5000, perRound: 100 },
      },
    });

    const settlement = settle(state);

    expect(settlement.eliminatedPlayerIds).toEqual([revealedOpponent, owner]);
    expect(settlement.lastStandingPlayerId).toBe(hiddenOpponent);
  });

  it("Given nobody has been eliminated, When the round is settled, Then no last-standing player is claimed", () => {
    const state = economyState({ players: { [owner]: { money: 1000, perRound: 100 } } });

    expect(settle(state).lastStandingPlayerId).toBeNull();
  });

  it("Given a watermark several rounds behind, When the round is settled, Then every skipped round is caught up in order", () => {
    const state = economyState({
      round: 3,
      players: { [owner]: { money: 1000, perRound: 100, lastChargedRound: 0 } },
    });

    const settlement = settle(state);
    const entry = settlement.entries.find((candidate) => candidate.playerId === owner);

    expect(entry?.roundsSettled).toEqual([1, 2, 3]);
    expect(entry?.upkeepPaid).toBe(300);
    expect(settlement.players[owner]?.resources.money?.value).toBe(700);
    expect(settlement.players[owner]?.upkeep.lastChargedRound).toBe(3);
  });

  it("Given a corrupt watermark far in the past, When the round is settled, Then the catch-up is capped and still lands on the current round", () => {
    const state = economyState({
      round: 500,
      players: { [owner]: { money: 1_000_000, perRound: 10, lastChargedRound: -9_000 } },
    });

    const entry = settle(state).entries.find((candidate) => candidate.playerId === owner);

    expect(entry?.roundsSettled).toHaveLength(64);
    expect(entry?.roundsSettled.at(-1)).toBe(500);
  });

  it("Given a player absent from playerOrder, When the round is settled, Then they are never charged", () => {
    const state = economyState({ players: { [owner]: { money: 1000, perRound: 100 } } });
    const trimmed: GameState = { ...state, playerOrder: [owner] };

    const settlement = settle(trimmed);

    expect(settlement.entries.map((entry) => entry.playerId)).toEqual([owner]);
    expect(settlement.players[hiddenOpponent]?.upkeep.lastChargedRound).toBe(0);
  });

  it("Given a settled round, When the state carrying it is serialized, Then it round-trips unchanged", () => {
    const state = economyState({
      round: 2,
      players: {
        [owner]: { money: 30, rankIndex: 2, perRound: 100, loans: [loan("loan-owner")], incomeStreams: [incomeStream("stream-owner", { remainingRounds: 2 })] },
        [hiddenOpponent]: { money: 900, perRound: 75 },
        [revealedOpponent]: { money: 900, perRound: 75 },
      },
    });

    const settlement = settle(state);
    const next: GameState = {
      ...state,
      players: settlement.players,
      eliminatedPlayerIds: settlement.eliminatedPlayerIds,
      revision: state.revision + 1,
      stateHash: null,
    };

    const serialized = serializeGameState(next);
    expect(deserializeGameState(serialized)).toEqual(next);
    expect(serializeGameState(deserializeGameState(serialized))).toBe(serialized);
  });

  it("Given a settlement replayed against a state that has been through the snapshot boundary, When both are settled, Then the results are byte-identical", () => {
    const state = economyState({
      round: 2,
      players: {
        [owner]: { money: 130, rankIndex: 2, perRound: 100, loans: [loan("loan-owner")] },
        [hiddenOpponent]: { money: 10, perRound: 100 },
        [revealedOpponent]: { money: 4000, perRound: 100, incomeStreams: [incomeStream("stream-x", { remainingRounds: 1 })] },
      },
    });
    const restored = deserializeGameState(serializeGameState(state));

    const live = settle(state);
    const resumed = settleRound(restored, {
      round: restored.turn.round,
      players: restored.players,
      content: economyContent,
    });

    expect(stableStringify(resumed)).toBe(stableStringify(live));
  });

  it("Given a deeply frozen state, When it is settled twice, Then the input is untouched and both results agree", () => {
    const source = economyState({
      round: 2,
      players: {
        [owner]: { money: 30, rankIndex: 2, perRound: 100, loans: [loan("loan-owner")] },
        [hiddenOpponent]: { money: 1000, perRound: 100, incomeStreams: [incomeStream("stream-y", { remainingRounds: 2 })] },
      },
    });
    const frozen = deepFreeze(structuredClone(source));

    const first = settleRound(frozen, { round: 2, players: frozen.players, content: economyContent });
    const second = settleRound(frozen, { round: 2, players: frozen.players, content: economyContent });

    expect(stableStringify(second)).toBe(stableStringify(first));
    expect(stableStringify(frozen)).toBe(stableStringify(source));
  });

  it("Given a player with no money resource at all, When the round is settled, Then the charge is missed rather than crashing", () => {
    const state = economyState({ players: { [owner]: { money: 0, perRound: 100 } } });
    const player = state.players[owner];
    if (player === undefined) throw new Error("fixture missing owner");
    const penniless: GameState = {
      ...state,
      playerOrder: [owner],
      players: { [owner]: { ...player, resources: {} } },
    };

    const entry = settle(penniless).entries[0];

    expect(entry?.upkeepDue).toBe(100);
    expect(entry?.upkeepPaid).toBe(0);
    expect(entry?.missedPayments).toBe(1);
  });
});

describe("economy forecast", () => {
  it("Given a player who will be short next round, When the forecast is read, Then the shortfall is visible before the charge bites", () => {
    const state = economyState({
      round: 3,
      players: { [owner]: { money: 40, perRound: 150, lastChargedRound: 2, incomeStreams: [incomeStream("stream-rent", { perRound: 30 })] } },
    });

    const forecast = forecastEconomy(state, owner);

    expect(forecast?.enabled).toBe(true);
    expect(forecast?.upkeepPerRound).toBe(150);
    expect(forecast?.incomePerRound).toBe(30);
    expect(forecast?.netPerRound).toBe(-120);
    expect(forecast?.nextChargeRound).toBe(3);
    expect(forecast?.shortfall).toBe(80);
    expect(forecast?.willMissNextCharge).toBe(true);
  });

  it("Given a player who can cover the coming charge, When the forecast is read, Then no miss is predicted", () => {
    const state = economyState({ round: 3, players: { [owner]: { money: 900, perRound: 150, lastChargedRound: 2 } } });

    const forecast = forecastEconomy(state, owner);

    expect(forecast?.willMissNextCharge).toBe(false);
    expect(forecast?.shortfall).toBe(0);
  });

  it("Given debt outstanding, When the forecast is read, Then this round's interest and the remaining borrowing headroom are both reported", () => {
    const state = economyState({
      players: { [owner]: { money: 200, perRound: 100, loans: [loan("loan-owner", { outstanding: 1000, interestBasisPoints: 1000 })] } },
    });

    const forecast = forecastEconomy(state, owner);

    expect(forecast?.outstandingDebt).toBe(1000);
    expect(forecast?.interestPerRound).toBe(100);
    expect(forecast?.loanCapacity).toBe(economyRules.economy.maxLoanPrincipal - 1000);
  });

  it("Given a mode with the economy switched off, When the forecast is read, Then it reports nothing owed", () => {
    const state = economyState({
      rules: { economy: { upkeepEnabled: false, loansEnabled: false, incomeStreamsEnabled: false } },
      players: { [owner]: { money: 100, perRound: 999, loans: [loan("loan-owner")], incomeStreams: [incomeStream("stream-rent")] } },
    });

    const forecast = forecastEconomy(state, owner);

    expect(forecast?.enabled).toBe(false);
    expect(forecast?.upkeepPerRound).toBe(0);
    expect(forecast?.incomePerRound).toBe(0);
    expect(forecast?.interestPerRound).toBe(0);
    expect(forecast?.loanCapacity).toBe(0);
    expect(forecast?.willMissNextCharge).toBe(false);
  });

  it("Given a player id that is not in the game, When the forecast is read, Then nothing is returned", () => {
    expect(forecastEconomy(economyState(), "player-nobody" as PlayerId)).toBeNull();
  });

  it("Given a settled round, When money is compared before and after, Then the forecast's net matches what actually moved", () => {
    const state = economyState({
      players: { [owner]: { money: 1000, perRound: 100, incomeStreams: [incomeStream("stream-rent", { perRound: 40 })] } },
    });
    const forecast = forecastEconomy(state, owner);

    const settlement = settle(state);
    const after = settlement.players[owner]?.resources.money?.value ?? 0;

    expect(after - moneyOf(state, owner)).toBe(forecast?.netPerRound);
  });
});
