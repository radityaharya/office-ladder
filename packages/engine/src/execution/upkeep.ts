import type { BankruptcyRule, ModeRules } from "@office-ladder/content";

import type { GameState, PlayerId, PlayerState, RankState } from "../model";
import { createStableId } from "../model";
import {
  economyActive,
  findMoney,
  incomePerRound,
  moveMoney,
  settleIncomeStreams,
  spendableMoney,
  type EconomyResourceChange,
} from "./economy";
import {
  accrueLoanInterest,
  interestPerRound,
  loanCapacity,
  totalOutstandingDebt,
} from "./loans";
import type { TransitionContent } from "./types";

/**
 * Upkeep, the per-round money sink, and the round settlement that ties the whole
 * economy together.
 *
 * The diagnosis in the spec's §1 is that money is a score that only goes up:
 * nothing consumes it but promotion, so there is never a reason to hold any.
 * Charging `economy.upkeepByRankIndex[rank]` every round is the single change
 * that makes a balance tense — and, with `agency.promotionRaisesUpkeep`, turns
 * climbing the ladder from a strictly-good move into a decision, because each
 * rung raises the standing bill.
 *
 * Three properties this file is built around:
 *
 * - **Deterministic, at a well-defined point.** The charge is keyed on the round
 *   number in canonical state, never on a clock, and `settleRound` is idempotent
 *   per round, so it can be called at every turn hand-off and fires exactly once
 *   per round however the caller is later rearranged.
 * - **Visible before it bites.** `forecastEconomy` is a pure read that answers
 *   "what is coming, and can I cover it" from state alone, so the UI can warn a
 *   player a round ahead rather than reporting a demotion after the fact.
 * - **A miss is recorded, never silently forgiven.** Short of the full charge,
 *   the player pays what they have, `missedPayments` increments, and
 *   `economy.bankruptcy` decides what follows.
 */

/**
 * How many rounds one settlement will catch up on.
 *
 * Normal play settles exactly one round per call. The loop exists for the
 * recovery path — a game resumed after a round advanced without a settlement —
 * and the cap is here so a corrupt persisted `lastChargedRound` (or a round
 * number from a future mechanic) cannot turn one command into an unbounded walk.
 * The same reasoning, and the same shape, as `MAX_SKIP_DEBT_LAPS` in
 * `next-turn.ts`.
 */
const MAX_ROUNDS_PER_SETTLEMENT = 64;

/**
 * The standing charge for a rank, read from the ruleset and never from a
 * constant.
 *
 * The ladder is validated at setup to be exactly as long as the rank ladder
 * (`setup/validation.ts`), so the clamp only ever matters for a lobby-authored
 * custom mode that slipped through, or a rank index outside the ladder entirely.
 */
export function upkeepPerRoundForRankIndex(
  rules: ModeRules,
  rankIndex: number,
): number {
  if (!rules.economy.upkeepEnabled) return 0;

  const ladder = rules.economy.upkeepByRankIndex;
  if (ladder.length === 0) return 0;

  const clamped = Math.min(
    Math.max(0, Math.trunc(rankIndex)),
    ladder.length - 1,
  );

  return Math.max(0, ladder[clamped] ?? 0);
}

/**
 * Re-derives `upkeep.perRound` from the player's **current** rank index.
 *
 * This is the seam between promotion and the economy, and the reason
 * `agency.promotionRaisesUpkeep` exists: call it immediately after any transition
 * changes `player.rank` (the automatic promotion in `roll-turn.ts`,
 * `promotion.attempt`, and the demotion below all qualify) and the standing bill
 * follows the rank. With the flag off, the charge is rank-independent and this is
 * a no-op, which is what a mode wanting a flat cost of living gets.
 *
 * Deliberately reads `player.rank.index` rather than taking a target index, so a
 * caller cannot raise somebody's upkeep without actually promoting them.
 */
export function refreshUpkeepForRank(
  player: PlayerState,
  rules: ModeRules,
): PlayerState {
  if (!rules.economy.upkeepEnabled) return player;
  if (!rules.agency.promotionRaisesUpkeep) return player;

  const perRound = upkeepPerRoundForRankIndex(rules, player.rank.index);
  if (perRound === player.upkeep.perRound) return player;

  return { ...player, upkeep: { ...player.upkeep, perRound } };
}

export type UpkeepCharge = {
  readonly player: PlayerState;
  readonly amountDue: number;
  readonly amountPaid: number;
  /** True when the player could not cover the full charge. */
  readonly missed: boolean;
  readonly change: EconomyResourceChange | null;
};

/**
 * Charges one round of upkeep and stamps `lastChargedRound`.
 *
 * The amount comes from `upkeep.perRound` in canonical state rather than being
 * recomputed from the rank here, because that field is also where a temporary
 * `modifyUpkeep` effect (spec §10.3) lands — relief has to actually reduce the
 * bill, not be overwritten by the charge that reads it.
 *
 * A player short of the full amount **pays what they have** and takes a missed
 * payment. Part-paying rather than refusing the charge is what makes the spiral
 * real: the balance is emptied, the shortfall is on the record, and the only ways
 * out are income, a loan, or whatever `economy.bankruptcy` does next.
 */
export function chargeUpkeep(
  player: PlayerState,
  rules: ModeRules,
  round: number,
): UpkeepCharge {
  const stamped: PlayerState = {
    ...player,
    upkeep: { ...player.upkeep, lastChargedRound: round },
  };
  if (!rules.economy.upkeepEnabled) {
    return {
      player: stamped,
      amountDue: 0,
      amountPaid: 0,
      missed: false,
      change: null,
    };
  }

  const amountDue = Math.max(0, Math.trunc(player.upkeep.perRound));
  if (amountDue === 0) {
    return {
      player: stamped,
      amountDue: 0,
      amountPaid: 0,
      missed: false,
      change: null,
    };
  }

  const money = findMoney(stamped);
  const available = money === null ? 0 : spendableMoney(money);
  const amountPaid = Math.min(amountDue, available);
  const missed = amountPaid < amountDue;
  const debited = moveMoney(stamped, -amountPaid, "upkeep");

  return {
    player: {
      ...debited.player,
      upkeep: {
        ...debited.player.upkeep,
        missedPayments: player.upkeep.missedPayments + (missed ? 1 : 0),
      },
    },
    amountDue,
    amountPaid,
    missed,
    change: debited.change,
  };
}

export type BankruptcyResolution = {
  readonly player: PlayerState;
  /** The rule that actually did something; `null` when nothing applied. */
  readonly applied: Exclude<BankruptcyRule, "none"> | null;
  readonly demotedToRankIndex: number | null;
  readonly eliminated: boolean;
};

/**
 * What a missed payment costs, per `economy.bankruptcy`.
 *
 * - `none` — the miss is recorded and nothing else happens. `missedPayments` is
 *   still a real signal: it is the natural producer for `ScoreBreakdown.penaltyPoints`.
 * - `demote` — one rung down the ladder, and (when `promotionRaisesUpkeep` is on)
 *   a correspondingly smaller bill, which is what makes demotion a real escape
 *   from the spiral rather than a cosmetic punishment. A player already at the
 *   bottom rung has nothing to lose, so this degrades to `none` for them.
 * - `eliminate` — the player is out. The caller adds them to
 *   `GameState.eliminatedPlayerIds`; this function does not reach into the state.
 *
 * `missedPayments` is **not** reset by any of these. It is the cumulative audit
 * record of how the match went, not a countdown that a punishment clears.
 */
export function resolveBankruptcy(
  player: PlayerState,
  rules: ModeRules,
  content: TransitionContent,
): BankruptcyResolution {
  switch (rules.economy.bankruptcy) {
    case "none":
      return {
        player,
        applied: null,
        demotedToRankIndex: null,
        eliminated: false,
      };
    case "eliminate":
      return {
        player,
        applied: "eliminate",
        demotedToRankIndex: null,
        eliminated: true,
      };
    case "demote": {
      const toIndex = player.rank.index - 1;
      if (toIndex < 0) {
        return {
          player,
          applied: null,
          demotedToRankIndex: null,
          eliminated: false,
        };
      }
      // Rank index i is tier i + 1 (Intern is tier 1 at index 0), so the rung
      // below index `player.rank.index` is the one whose tier equals it.
      const target = content.ranks.find((rank) => rank.tier === player.rank.index);
      if (target === undefined) {
        return {
          player,
          applied: null,
          demotedToRankIndex: null,
          eliminated: false,
        };
      }

      const rank: RankState = {
        id: createStableId("RankId", target.id),
        kind: target.id as RankState["kind"],
        index: toIndex,
      };

      return {
        player: refreshUpkeepForRank({ ...player, rank }, rules),
        applied: "demote",
        demotedToRankIndex: toIndex,
        eliminated: false,
      };
    }
    default:
      return {
        player,
        applied: null,
        demotedToRankIndex: null,
        eliminated: false,
      };
  }
}

export type RoundSettlementInput = {
  /** The round the game is now in — `GameState.turn.round` after the hand-off. */
  readonly round: number;
  /**
   * The player map as the calling transition has it *so far*, which is not
   * always `state.players`: `roll-turn.ts` has already run the turn-order walk
   * and holds records the state does not. Passing it explicitly is the same
   * discipline `resolveNextTurn` uses for the acting player.
   */
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly content: TransitionContent;
};

export type RoundSettlementEntry = {
  readonly playerId: PlayerId;
  /** The rounds this settlement actually charged, in order. */
  readonly roundsSettled: readonly number[];
  readonly incomeCredited: number;
  readonly interestAccrued: number;
  readonly upkeepDue: number;
  readonly upkeepPaid: number;
  /** Misses incurred by *this* settlement, not the player's lifetime total. */
  readonly missedPayments: number;
  readonly bankruptcy: Exclude<BankruptcyRule, "none"> | null;
  readonly demotedToRankIndex: number | null;
  readonly eliminated: boolean;
};

export type RoundSettlement = {
  /** False when nothing was owed — every economy switch off, or already settled. */
  readonly settled: boolean;
  readonly throughRound: number;
  readonly players: Readonly<Record<string, PlayerState>>;
  /** The complete replacement for `GameState.eliminatedPlayerIds`. */
  readonly eliminatedPlayerIds: readonly PlayerId[];
  readonly newlyEliminatedPlayerIds: readonly PlayerId[];
  /** In application order, ready to be turned into `ResourceChanged` events. */
  readonly changes: readonly EconomyResourceChange[];
  readonly entries: readonly RoundSettlementEntry[];
  /**
   * The only player left standing, if elimination has emptied the table down to
   * one. The match-end owner decides what to do with it — this file does not
   * write `GameState.outcome`.
   */
  readonly lastStandingPlayerId: PlayerId | null;
};

/**
 * Settles every player's economy through `round`: income in, interest on, upkeep
 * out, bankruptcy if the bill went unpaid.
 *
 * **Call it unconditionally at every turn hand-off**, passing the round the
 * hand-off is entering. It is idempotent per player per round —
 * `upkeep.lastChargedRound` is the watermark — so it charges exactly once per
 * round no matter how often it is asked, and returns `settled: false` having
 * touched nothing when there is no work.
 *
 * Order within a round is fixed and load-bearing: **income, then interest, then
 * upkeep.** Income first because a stream is meant to be able to cover the bill
 * it was bought to cover; interest before upkeep because it capitalises into the
 * debt rather than competing for the same cash, so the player's balance faces
 * exactly one demand per round and the shortfall is unambiguous.
 *
 * Players are walked in `playerOrder`, never in record-key order — key order is
 * not a stable contract across the repository's JSON round trip, and a
 * settlement that eliminates somebody must not depend on it.
 */
export function settleRound(
  state: GameState,
  input: RoundSettlementInput,
): RoundSettlement {
  const { rules } = state;
  const idle: RoundSettlement = {
    settled: false,
    throughRound: input.round,
    players: input.players,
    eliminatedPlayerIds: state.eliminatedPlayerIds,
    newlyEliminatedPlayerIds: [],
    changes: [],
    entries: [],
    lastStandingPlayerId: null,
  };
  if (!economyActive(rules) || !Number.isInteger(input.round) || input.round < 1) {
    return idle;
  }

  let players = input.players;
  const changes: EconomyResourceChange[] = [];
  const entries: RoundSettlementEntry[] = [];
  const eliminated: PlayerId[] = [...state.eliminatedPlayerIds];
  const newlyEliminated: PlayerId[] = [];

  for (const playerId of state.playerOrder) {
    if (eliminated.includes(playerId)) continue;

    const start = players[playerId];
    if (start === undefined) continue;

    // The oldest round still owed, floored so a wildly stale watermark settles
    // the most recent window rather than walking the whole match.
    const firstOwed = Math.max(
      start.upkeep.lastChargedRound + 1,
      input.round - MAX_ROUNDS_PER_SETTLEMENT + 1,
    );
    if (firstOwed > input.round) continue;

    let player = start;
    const roundsSettled: number[] = [];
    let incomeCredited = 0;
    let interestAccrued = 0;
    let upkeepDue = 0;
    let upkeepPaid = 0;
    let missedPayments = 0;
    let bankruptcy: Exclude<BankruptcyRule, "none"> | null = null;
    let demotedToRankIndex: number | null = null;
    let wasEliminated = false;

    for (let round = firstOwed; round <= input.round; round += 1) {
      roundsSettled.push(round);

      const income = settleIncomeStreams(player, rules);
      player = income.player;
      incomeCredited += income.credited;
      if (income.change !== null) changes.push(income.change);

      const interest = accrueLoanInterest(player, rules);
      player = interest.player;
      interestAccrued += interest.accrued;

      const charge = chargeUpkeep(player, rules, round);
      player = charge.player;
      upkeepDue += charge.amountDue;
      upkeepPaid += charge.amountPaid;
      if (charge.change !== null) changes.push(charge.change);

      if (!charge.missed) continue;

      missedPayments += 1;
      const resolution = resolveBankruptcy(player, rules, input.content);
      player = resolution.player;
      if (resolution.applied !== null) bankruptcy = resolution.applied;
      if (resolution.demotedToRankIndex !== null) {
        demotedToRankIndex = resolution.demotedToRankIndex;
      }
      if (resolution.eliminated) {
        wasEliminated = true;
        eliminated.push(playerId);
        newlyEliminated.push(playerId);
        // Nothing further is charged to a player who is out: the remaining
        // rounds of a catch-up would be billing a seat that no longer exists.
        break;
      }
    }

    players = { ...players, [playerId]: player };
    entries.push({
      playerId,
      roundsSettled,
      incomeCredited,
      interestAccrued,
      upkeepDue,
      upkeepPaid,
      missedPayments,
      bankruptcy,
      demotedToRankIndex,
      eliminated: wasEliminated,
    });
  }

  const survivors = state.playerOrder.filter((id) => !eliminated.includes(id));
  const lastStandingPlayerId =
    state.playerOrder.length > 1 && survivors.length === 1
      ? (survivors[0] ?? null)
      : null;

  return {
    settled: entries.length > 0,
    throughRound: input.round,
    players,
    eliminatedPlayerIds: eliminated,
    newlyEliminatedPlayerIds: newlyEliminated,
    changes,
    entries,
    lastStandingPlayerId,
  };
}

export type EconomyForecast = {
  readonly playerId: PlayerId;
  /** False when this mode has the whole economy switched off. */
  readonly enabled: boolean;
  readonly upkeepPerRound: number;
  /** The round whose charge is still owed — what the UI counts down to. */
  readonly nextChargeRound: number;
  readonly incomePerRound: number;
  readonly interestPerRound: number;
  readonly outstandingDebt: number;
  readonly money: number;
  /** Income minus upkeep: negative is a player living beyond their rank. */
  readonly netPerRound: number;
  /** What the next charge will leave unpaid, given today's balance and income. */
  readonly shortfall: number;
  readonly willMissNextCharge: boolean;
  readonly loanCapacity: number;
  readonly missedPayments: number;
};

/**
 * Everything a player needs to see the bill coming, derived from state alone.
 *
 * This is the "visible before it bites" half of the mechanic. An upkeep charge
 * that a player only learns about by losing a rank is variance; the same charge
 * announced a round ahead, next to the balance that will or will not cover it, is
 * a decision — borrow, sell, or take the demotion. Pure, so a projection can call
 * it per viewer without any risk to replay.
 */
export function forecastEconomy(
  state: GameState,
  playerId: PlayerId,
): EconomyForecast | null {
  const player = state.players[playerId];
  if (player === undefined) return null;

  const { rules } = state;
  const money = findMoney(player);
  const balance = money?.resource.value ?? 0;
  const upkeep = rules.economy.upkeepEnabled
    ? Math.max(0, Math.trunc(player.upkeep.perRound))
    : 0;
  const income = incomePerRound(player, rules);
  const shortfall = Math.max(0, upkeep - (balance + income));

  return {
    playerId,
    enabled: economyActive(rules),
    upkeepPerRound: upkeep,
    nextChargeRound: Math.max(state.turn.round, player.upkeep.lastChargedRound + 1),
    incomePerRound: income,
    interestPerRound: interestPerRound(player, rules),
    outstandingDebt: totalOutstandingDebt(player),
    money: balance,
    netPerRound: income - upkeep,
    shortfall,
    willMissNextCharge: shortfall > 0,
    loanCapacity: loanCapacity(player, rules),
    missedPayments: player.upkeep.missedPayments,
  };
}
