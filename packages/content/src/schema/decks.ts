import type { EffectDescriptor } from "./effects";
import type { DeckId } from "./ids";

export type DeckCard = {
  readonly id: string;
  /** Flavor text/title, matching the displayNameKey i18n-key convention used elsewhere in content. */
  readonly nameKey: `deadlineDash.card.${string}.name`;
  readonly effects: readonly EffectDescriptor[];
};

export type DeckConfig = {
  readonly id: DeckId;
  readonly cards: readonly DeckCard[];
};
