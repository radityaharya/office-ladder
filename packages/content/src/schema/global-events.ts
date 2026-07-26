import type { EffectDescriptor } from "./effects";
import type { GlobalEventId } from "./ids";

/**
 * Who a global event's one-shot `effects` land on when its quarter resolves.
 *
 * Deliberately a coarse, authored *predicate name* rather than a query: content
 * must not be able to express "the player in seat 3", and the engine resolves
 * the set from canonical state at resolution time.
 */
export type GlobalEventScope =
  | "all-players"
  | "leader"
  | "trailing-players"
  | "players-with-heat"
  | "players-in-debt";

/**
 * A rule change that holds for the whole quarter, as opposed to `effects`,
 * which resolve once when the quarter turns over.
 *
 * This is a separate vocabulary from `EffectDescriptor` on purpose: an
 * `EffectDescriptor` is something that happens *to a player*, while these
 * suspend or scale a rule for *everyone*. Reusing the effect union for them
 * would let a deck card author "no promotions this quarter", which it must
 * never be able to do.
 */
export type GlobalEventModifier =
  | { readonly type: "blockPromotions" }
  | { readonly type: "blockLoans" }
  | { readonly type: "blockTileClaims" }
  | { readonly type: "suspendUpkeep" }
  | { readonly type: "multiplySalary"; readonly multiplier: number }
  | { readonly type: "multiplyProjectPayout"; readonly multiplier: number }
  /** Signed: negative tightens scrutiny by lowering the heat threshold. */
  | { readonly type: "adjustHeatThreshold"; readonly delta: number }
  | {
      readonly type: "demoteLowest";
      readonly resource: "money" | "reputation";
    };

export type GlobalEventConfig = {
  readonly id: GlobalEventId;
  readonly displayNameKey: `deadlineDash.globalEvent.${string}.name`;
  readonly descriptionKey: `deadlineDash.globalEvent.${string}.description`;
  /** Who `effects` are applied to. `modifiers` always apply table-wide. */
  readonly scope: GlobalEventScope;
  /** Resolved once, per player in `scope`, when the quarter turns over. */
  readonly effects: readonly EffectDescriptor[];
  /** Held for the whole quarter. */
  readonly modifiers: readonly GlobalEventModifier[];
  /**
   * Per spec §5.7 this is `true` for every shipped event, and the content
   * validator enforces that: a shock the table knows about a quarter early is a
   * decision to position for, an unannounced one is just variance. The field
   * exists so the *rule* is stated in data rather than assumed by the engine,
   * and so a future authored event can opt out explicitly and visibly.
   */
  readonly announcedQuarterAhead: boolean;
  readonly sourceNotes?: readonly string[];
};
