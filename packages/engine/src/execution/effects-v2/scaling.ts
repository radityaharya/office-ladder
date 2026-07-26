import type { GameState, PlayerId, PlayerState } from "../../model";
import { livePlayerIds } from "./targeting";
import type { EffectScale, EffectScaleMetric, EffectV2 } from "./vocabulary";

/**
 * `scale` — the re-cut plan's §3.7, and the reason §10.6 mandate 4 is
 * satisfiable at all.
 *
 * The mandate says *"all-player must never mean identical-to-everyone"*: a
 * symmetric effect applied to every seat changes nobody's relative standing, so
 * 49 of 50 corner cards were ceremonial. `condition` can only include or exclude
 * a player; it cannot make the same instruction *worth* a different amount to
 * each of them. `scale` is that verb, and without it forty-five re-cut corner
 * cards are symmetric again.
 *
 * ```
 * effective = amount + perUnit × metric(of)      then clamped to ±|cap|
 * ```
 *
 * `of` defaults to `"target"`, deliberately and per §3.6's identical ruling for
 * `condition.of`: on an `@all-players` effect that is what makes the metric read
 * *each recipient's* rank rather than the drawer's once. The two readings produce
 * different cards, so the default is stated rather than implied.
 *
 * `cap` bounds the **magnitude** of the final amount and never flips its sign —
 * a capped penalty is a smaller penalty, not a reward.
 */

/** Reads one metric off a player. Pure; every source is canonical state. */
function metricOf(state: GameState, player: PlayerState, by: EffectScaleMetric): number {
  switch (by) {
    case "rank-tier":
      return player.rank.index;
    case "board-position":
      return player.position;
    case "laps":
      return player.lapsCompleted;
    case "heat":
      return player.heat.value;
    case "debt":
      // Outstanding principal across every live loan, not the loan count: a card
      // that scales "by debt" means how deep you are, not how many times you
      // borrowed.
      return player.loans.reduce((total, loan) => total + Math.max(0, loan.outstanding), 0);
    case "work-counter":
      return player.resources["work-counter"]?.value ?? 0;
    case "opponent-count":
      // Everyone still in the match except the player being measured. This is
      // the one metric that is a property of the table rather than of a seat,
      // and it is what lets a corner card stay balanced from three seats to six.
      return Math.max(0, livePlayerIds(state).length - 1);
    default:
      return by satisfies never;
  }
}

/** Sign-aware magnitude clamp. `cap` never turns a loss into a gain. */
function applyCap(amount: number, cap: number | undefined): number {
  if (cap === undefined || !Number.isFinite(cap)) return amount;

  const limit = Math.abs(cap);

  return amount < 0 ? Math.max(amount, -limit) : Math.min(amount, limit);
}

/**
 * The effective amount for one (actor, target) pair.
 *
 * Exported so a test — and, later, a UI that renders "you would gain 400" —
 * can ask the same question the resolver asks, rather than re-deriving it.
 */
export function scaledAmount(
  state: GameState,
  scale: EffectScale,
  amount: number,
  actorId: PlayerId,
  targetId: PlayerId,
): number {
  const subjectId = (scale.of ?? "target") === "actor" ? actorId : targetId;
  const subject = state.players[subjectId];
  if (subject === undefined) return applyCap(amount, scale.cap);

  const metric = metricOf(state, subject, scale.by);

  return applyCap(amount + scale.perUnit * metric, scale.cap);
}

/**
 * Effects whose `amount` field `scale` may rewrite.
 *
 * Deliberately a list rather than a structural `"amount" in effect` test.
 * `incrementWorkCounter.amount` is a *stride* whose `rewardEvery: 5` arithmetic
 * assumes it, `forceDiscard.count` is a card count, and `startProject`'s numbers
 * live inside `payout` — scaling any of those by accident would be a silent
 * rules change nothing would catch. Each entry here is a number a card in the
 * pack actually scales, or plausibly could.
 */
const SCALABLE_AMOUNT_TYPES: ReadonlySet<string> = new Set<string>([
  "modifyResource",
  "payResource",
  "transferResource",
  "modifyHeat",
  "modifyUpkeep",
  "sabotageProject",
]);

/** True when `scale` on this effect has something to act on. */
export function isScalable(effect: EffectV2): boolean {
  return SCALABLE_AMOUNT_TYPES.has(effect.type);
}

/**
 * Rewrites an effect's `amount` for one target, leaving everything else alone.
 *
 * Returns the effect unchanged when it carries no `scale`, so this sits on the
 * hot path for free. Applied at the moment an effect *lands* — not when it is
 * resolved — so a parked effect that resumes several commands later scales off
 * the state it actually lands in, which is the state the player can see.
 */
export function withScaledAmount(
  state: GameState,
  effect: EffectV2,
  actorId: PlayerId,
  targetId: PlayerId,
): EffectV2 {
  const scale = effect.scale;
  if (scale === undefined || !isScalable(effect)) return effect;

  const current = (effect as { readonly amount?: unknown }).amount;
  if (typeof current !== "number") return effect;

  const next = scaledAmount(state, scale, current, actorId, targetId);
  if (next === current) return effect;

  return { ...effect, amount: next } as EffectV2;
}
