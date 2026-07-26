import type { EffectDescriptor, EffectPolarity, EffectTiming } from "./effects";
import type { DeckId } from "./ids";

/**
 * Polarity of a whole card, as opposed to of a single status.
 *
 * Needed in two places that have nothing to evaluate without it: a card that
 * says "ignore one negative Event card" has to be able to ask a *drawn card*
 * whether it was negative, and `rank.senior-manager`'s
 * `multiplyAnnualEventReward` has to know whether an annual-event card was a
 * reward at all — after the re-cut `deck.annual-event` holds five negative
 * cards, so "is this a reward?" stops being rhetorical.
 */
export type CardPolarity = EffectPolarity | "mixed";

export type DeckCard = {
  readonly id: string;
  /** Flavor text/title, matching the displayNameKey i18n-key convention used elsewhere in content. */
  readonly nameKey: `deadlineDash.card.${string}.name`;
  /**
   * Authored, human-readable card title. Optional: consumers that predate authored
   * copy derive a title from the last segment of `id` instead, so omitting this
   * degrades to the derived name rather than breaking.
   */
  readonly displayName?: string;
  /**
   * Authored one-clause in-fiction incident note shown beneath the title. Optional
   * for the same backward-compatible reason as `displayName`; it is never required
   * to explain the mechanics, which are rendered from `effects`.
   */
  readonly flavorText?: string;
  readonly effects: readonly EffectDescriptor[];
  /**
   * When this card resolves. Default `"immediate"`. Spec §10.5.
   *
   * **On the card, not on the effect.** Per-effect timing makes
   * `[{stored}, {immediate}]` representable, and such a card has no defined
   * answer for which zone it ends up in. A card whose timing is disabled by the
   * active mode (`stored` needs `agency.handEnabled`, `reaction` needs
   * `interaction.reactionWindows`) is excluded at deck construction rather than
   * drawn and discarded.
   */
  readonly timing?: EffectTiming;
  /**
   * How many copies of this card enter the deck. Default `1`, expanded at deck
   * construction. Spec §10.5.
   *
   * The design workbook encodes **rarity as multiplicity** — a handful of common
   * rows are flagged as duplicates and nothing tagged Uncommon or rarer ever is.
   * One instance per definition silently inverts the rarity curve, making the
   * Legendary card exactly as likely as the Common one. Do not fake this with
   * `-2`/`-3` id suffixes: pack-wide `displayName` uniqueness is a real
   * invariant and duplicate-by-id breaks it.
   */
  readonly copies?: number;
  /**
   * Whether this card is, on balance, good or bad for whoever draws it.
   *
   * Authored rather than derived: a card that trades money for reputation is not
   * mechanically classifiable, and `grantImmunity`'s `scope.sourceDeckId` has
   * nothing to test against without it.
   */
  readonly polarity?: CardPolarity;
};

export type DeckConfig = {
  readonly id: DeckId;
  readonly cards: readonly DeckCard[];
};
