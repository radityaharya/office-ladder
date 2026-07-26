import { describe, expect, it } from "vitest";

import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";

import { applyCommand, stableStringify } from "../src";
import type {
  CommandId,
  GameState,
  ModeRules,
  QuarterState,
  RollTurnCommand,
  TakeTurnActionCommand,
} from "../src";
import {
  resolveFreeActionPrices,
  takeTurnAction,
} from "../src/execution/free-action";
import type { TransitionContent } from "../src/execution/types";
import { agencyState, commandBase } from "./agency-fixtures";
import { fixtureIds } from "./fixtures";
import { marathonRules, quickRules, tableState } from "./quarter-objective-fixtures";
import { logicalTimestamp, withRules } from "./turn-loop-fixtures";

const branded = <Id extends string>(value: string) => value as Id;

/**
 * The guarantee this file exists for — plans/24-gameplay-v2-spec.md §5.9:
 *
 * > `rules` is **snapshotted into the state at `game.start`**, not read live from
 * > content. A match must replay identically after the content pack changes.
 *
 * Everything else about the snapshot is an argument; this is the proof. A match
 * is played to a scored ending against the shipped pack, then the *same* command
 * sequence is replayed against a pack whose mode entry has been rewritten —
 * rescored, repriced, rehanded, its clock removed — and the two outcomes have to
 * be the same bytes.
 *
 * Deliberately not a unit test of any one resolver: a per-mode read added
 * anywhere in the roll path is caught here, whether or not anybody thought to
 * write a test for it.
 */

/**
 * The shipped pack with every **per-mode** value rewritten, and nothing else
 * touched.
 *
 * What is mutated is exactly the set a match must be immune to: the mode's
 * ruleset, its scoring weights, its hand limit, its clock decks, and the
 * per-mode column of the rank ladder's promotion costs. Each of those was, at
 * some point, read live by a transition.
 *
 * What is deliberately *not* mutated is static content — board geometry, card
 * text, character passives, rank salaries and reputation thresholds. Those are
 * identified by `VersionState.contentHash` rather than snapshotted, so a replay
 * against a pack that changed them is a replay against a different content
 * release and is expected to differ. Mutating them here would test the wrong
 * claim.
 */
function repricedPack(): TransitionContent {
  const modes = Object.fromEntries(
    Object.entries(deadlineDashContent.modes).map(([key, mode]) => [
      key,
      {
        ...mode,
        // Read live by `resolveHandLimit` until this round.
        handLimit: 9,
        // Read live by `resolveClockDeckIds` until this round.
        clockDeck: { ...mode.clockDeck, deckIds: [] },
        // Read live by `resolveScoringConfig` until this round.
        endgame: {
          type: "additional-rounds",
          rounds: 3,
          clockExhaustionStillEndsMatch: true,
          scoring: { rankTierPoints: 7, moneyMultiplier: 9.5, reputationPoints: 3 },
        },
        // Never read by a transition, and the point of the snapshot: a mode's
        // ruleset can be rewritten wholesale without touching a running match.
        rules: {
          ...mode.rules,
          winShape: "survival",
          winPaths: { promotion: true, wealth: true, influence: true, survival: true },
          endgame: {
            rankTierPoints: 7,
            moneyMultiplier: 9.5,
            reputationPoints: 3,
            clockDecksEndMatch: false,
          },
          agency: { ...mode.rules.agency, handLimit: 9 },
          economy: {
            ...mode.rules.economy,
            promotionCostByRankIndex: mode.rules.economy.promotionCostByRankIndex.map(
              () => 1,
            ),
          },
        },
      },
    ]),
  );

  const ranks = deadlineDashContent.ranks.map((rank) =>
    rank.promotionFromPrevious === null
      ? rank
      : {
          ...rank,
          promotionFromPrevious: {
            ...rank.promotionFromPrevious,
            // The per-mode column `resolvePromotion` used to index by modeId.
            moneyCost: {
              "mode.quick": 1,
              "mode.standard": 1,
              "mode.marathon": 1,
              "mode.campaign": 1,
            },
          },
        },
  );

  return { ...deadlineDashContent, modes, ranks } as unknown as TransitionContent;
}

function pack(content: TransitionContent) {
  return { logicalTimestamp, content };
}

/** A quarter track that runs out at `endsAtRound`, so the match is scored there. */
function shortTrack(endsAtRound: number): readonly QuarterState[] {
  return [
    {
      index: 0,
      startedAtRound: 1,
      endsAtRound,
      scheduledEventId: null,
      resolvedEventIds: [],
    },
  ];
}

/**
 * A three-seat marathon table with one quarter left, on the real board.
 *
 * Money and reputation differ per seat so the score sheet has something to rank:
 * a table where every column ties would pass this test for the wrong reason.
 */
function endgameTable(): GameState {
  const base = tableState(marathonRules, {
    [fixtureIds.owner]: { rankIndex: 2, rankKind: "rank.senior-staff", wallet: { money: 4_000, reputation: 6 } },
    [fixtureIds.hiddenOpponent]: { rankIndex: 1, rankKind: "rank.staff", wallet: { money: 2_500, reputation: 3 } },
    [fixtureIds.revealedOpponent]: { rankIndex: 1, rankKind: "rank.staff", wallet: { money: 900, reputation: 1 } },
  });

  return {
    ...withRules(base, { quarters: { enabled: true, count: 1, roundsEach: 1 } }),
    boardSize: deadlineDashContent.board.spaces.length,
    tileIds: deadlineDashContent.board.spaces.map((tile) =>
      branded<GameState["tileIds"][number]>(tile.id),
    ),
    modeId: branded("mode.marathon"),
    quarters: shortTrack(1),
    currentQuarterIndex: 0,
  };
}

function rollFor(state: GameState, commandId: string): RollTurnCommand {
  const actorId = state.turn.activePlayerId;
  if (actorId === null) throw new Error("no active player to roll for");

  return {
    commandId: branded<CommandId>(commandId),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
    type: "turn.roll",
    payload: {},
  };
}

type Run = {
  readonly state: GameState;
  readonly commands: readonly RollTurnCommand[];
};

/**
 * Rolls until the match ends, and records the exact command sequence it took.
 *
 * The commands are captured rather than pre-written because `expectedRevision`
 * and `actorId` are functions of the state — and then replayed verbatim, so the
 * second run is genuinely the same sequence and not a second improvisation that
 * happened to end the same way.
 */
function playToEnd(start: GameState, content: TransitionContent, limit = 12): Run {
  let state = start;
  const commands: RollTurnCommand[] = [];

  for (let index = 0; index < limit && state.outcome === null; index += 1) {
    const command = rollFor(state, `command-replay-${String(index)}`);
    const result = applyCommand(state, command, pack(content));
    if (!result.ok) throw new Error(`${command.commandId}: ${result.error.message}`);
    commands.push(command);
    state = result.value.state;
  }

  return { state, commands };
}

function replay(
  start: GameState,
  commands: readonly RollTurnCommand[],
  content: TransitionContent,
): GameState {
  let state = start;
  for (const command of commands) {
    const result = applyCommand(state, command, pack(content));
    if (!result.ok) throw new Error(`${command.commandId}: ${result.error.message}`);
    state = result.value.state;
  }

  return state;
}

describe("replay guarantee — a finished match is immune to a content-pack edit", () => {
  it("Given a match played to a scored ending, When the same commands are replayed against a rewritten mode entry, Then the outcome is byte-identical", () => {
    const start = endgameTable();

    const original = playToEnd(start, deadlineDashContent);
    // The match really did end, and really was scored — a test that replayed two
    // null outcomes would be vacuous.
    expect(original.state.outcome).not.toBeNull();
    expect(original.state.outcome?.reason).toBe("quarters-elapsed");
    expect(original.state.outcome?.scores.length).toBe(start.playerOrder.length);
    expect(original.state.outcome?.scores.some((score) => score.total !== 0)).toBe(true);

    const rewritten = replay(start, original.commands, repricedPack());

    expect(stableStringify(rewritten.outcome)).toBe(
      stableStringify(original.state.outcome),
    );
    // Not just the outcome: the whole canonical state the replay lands on.
    expect(stableStringify(rewritten)).toBe(stableStringify(original.state));
  });

  it("Given the rewritten pack, When the ruleset in it is compared with the one the match was played under, Then they really do disagree", () => {
    // Guards the test above from passing because the mutation was a no-op.
    const played = deadlineDashModes["mode.marathon"];
    const edited = repricedPack().modes["mode.marathon"];

    expect(edited.handLimit).not.toBe(played.handLimit);
    expect(edited.clockDeck.deckIds).not.toEqual(played.clockDeck.deckIds);
    expect(stableStringify(edited.rules)).not.toBe(stableStringify(played.rules));
    if (edited.endgame.type === "additional-rounds" && played.endgame.type === "additional-rounds") {
      expect(edited.endgame.scoring.rankTierPoints).not.toBe(
        played.endgame.scoring.rankTierPoints,
      );
    }
  });

  it("Given a repriced rank ladder, When a player is promoted, Then they are charged the price snapshotted into their match", () => {
    // The race win runs through `resolvePromotion`, whose money cost used to be
    // indexed out of the live rank table by `modeId`. Under the repriced pack
    // every rung costs 1, so a promotion charged live would be nearly free.
    const affordable = withRules(
      {
        ...tableState(quickRules, {
          [fixtureIds.owner]: {
            rankIndex: 0,
            rankKind: "rank.intern",
            wallet: { money: 5_000, reputation: 20 },
          },
        }),
        boardSize: deadlineDashContent.board.spaces.length,
        tileIds: deadlineDashContent.board.spaces.map((tile) =>
          branded<GameState["tileIds"][number]>(tile.id),
        ),
        modeId: branded("mode.quick"),
      },
      { agency: { promotionIsChoice: false } },
    );

    const original = applyCommand(
      affordable,
      rollFor(affordable, "command-promote"),
      pack(deadlineDashContent),
    );
    const replayed = applyCommand(
      affordable,
      rollFor(affordable, "command-promote"),
      pack(repricedPack()),
    );

    expect(original.ok).toBe(true);
    expect(replayed.ok).toBe(true);
    if (!original.ok || !replayed.ok) return;

    const promoted = original.value.state.players[fixtureIds.owner];
    expect(promoted?.rank.index).toBe(1);
    expect(stableStringify(replayed.value.state)).toBe(
      stableStringify(original.value.state),
    );
  });

  it("Given a repriced rank ladder, When a networking action is replayed, Then a point of reputation still costs what it cost during the match", () => {
    // `network` prices reputation off the ladder's money cost per required point,
    // which is the second consumer of the per-mode promotion column. Under the
    // repriced pack every rung costs 1, so a live read would make reputation
    // essentially free.
    const state = agencyState({ owner: { money: 1_000, reputation: 2 } });
    const actor = state.players[fixtureIds.owner];
    if (actor === undefined) throw new Error("fixture missing owner");
    const command: TakeTurnActionCommand = {
      ...commandBase(state, "action-network"),
      type: "turn.action",
      payload: { action: "network", targetPlayerIds: [], choice: null },
    };

    const original = takeTurnAction(state, command, pack(deadlineDashContent));
    const replayed = takeTurnAction(state, command, pack(repricedPack()));

    expect(original.ok).toBe(true);
    expect(replayed.ok).toBe(true);
    if (!original.ok || !replayed.ok) return;

    // 250 money and 3 reputation to reach Staff in quick: ceil(250 / 3) = 84.
    expect(
      resolveFreeActionPrices(state, actor, deadlineDashContent).reputationPrice,
    ).toBe(84);
    expect(stableStringify(replayed.value.state)).toBe(
      stableStringify(original.value.state),
    );
  });

  it("Given a legacy snapshot whose ruleset predates these fields, When it is scored, Then it still produces a score sheet rather than nothing", () => {
    // Spec §5.10: a stored game from before this change must still open. Its
    // `rules` has no `endgame` block and no `agency.handLimit`, and the answer to
    // that is a documented fallback, not a crash and not a silent zero.
    const legacy = {
      ...marathonRules,
      endgame: undefined,
      agency: { ...marathonRules.agency, handLimit: undefined },
    } as unknown as ModeRules;
    const state: GameState = { ...endgameTable(), rules: legacy };

    const run = playToEnd(state, deadlineDashContent);

    expect(run.state.outcome).not.toBeNull();
    expect(run.state.outcome?.scores.some((score) => score.total !== 0)).toBe(true);
  });
});
