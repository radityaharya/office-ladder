import type { EffectDescriptor } from "./effects";
import type { DeckId } from "./ids";

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
};

export type DeckConfig = {
  readonly id: DeckId;
  readonly cards: readonly DeckCard[];
};
