/**
 * Display copy for an authored deck card.
 *
 * `packages/content` is authoring OPTIONAL display-name and flavor fields onto
 * every deck card (see `packages/content/src/schema/decks.ts`). Those fields may
 * not exist yet, and when they do exist they are optional per card, so every
 * read goes through {@link readAuthoredString}: it probes a small set of
 * plausible field names, accepts only non-empty strings, and otherwise falls
 * back to the title-cased card id this UI has always derived. The fallback is
 * mandatory — never render an empty name.
 */
export type AuthoredCardCopy = {
  /** Authored display name when present, otherwise the derived title-cased id. */
  readonly name: string;
  /** Which of the two paths produced {@link name}. Surfaced as a data attribute. */
  readonly nameSource: "authored" | "derived";
  /** Authored flavor line, or null when the card has none (most cards today). */
  readonly flavor: string | null;
  /** Deck display name, e.g. "Board meeting" — authored when present. */
  readonly deckName: string;
};

/** The structural minimum this module needs from a content deck card. */
export type AuthoredCardLike = {
  readonly id: string;
  readonly nameKey: string;
};

/** The structural minimum this module needs from a content deck. */
export type AuthoredDeckLike = {
  readonly id: string;
};

/**
 * Field names an authored display name may arrive under. Ordered by preference;
 * the first non-empty string wins. Kept deliberately wider than the single name
 * the content workflow is expected to land so a near-miss still renders.
 */
const NAME_FIELDS = ["displayName", "name", "title"] as const;

/** Field names an authored flavor line may arrive under. */
const FLAVOR_FIELDS = ["flavor", "flavorText", "flavourText", "flavour"] as const;

export function resolveAuthoredCardCopy(
  card: AuthoredCardLike,
  deck: AuthoredDeckLike,
): AuthoredCardCopy {
  const authoredName = readAuthoredString(card, NAME_FIELDS);
  return {
    name: authoredName ?? derivedCardName(card.id),
    nameSource: authoredName === null ? "derived" : "authored",
    flavor: readAuthoredString(card, FLAVOR_FIELDS),
    deckName: deckDisplayName(deck),
  };
}

/** Deck display name: authored when present, otherwise derived from the id. */
export function deckDisplayName(deck: AuthoredDeckLike): string {
  return readAuthoredString(deck, NAME_FIELDS) ?? sentenceCase(deckPhrase(deck.id));
}

/** Lowercase deck words for use inside a sentence, e.g. "board meeting". */
export function deckPhrase(deckId: string): string {
  return deckId.replace("deck.", "").replaceAll("-", " ");
}

/** Title-cased last id segment — the fallback name this UI has always used. */
export function derivedCardName(cardId: string): string {
  const idPart = cardId.split(".").at(-1);
  if (idPart === undefined || idPart.length === 0) return cardId;
  return sentenceCase(idPart.replaceAll("-", " "));
}

/**
 * Reads the first non-empty string among `fields`. Written against `object`
 * rather than a concrete content type on purpose: the fields are optional and
 * may be absent from the compiled type entirely, so this must not depend on
 * them existing.
 */
function readAuthoredString(source: object, fields: readonly string[]): string | null {
  const record = source as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function sentenceCase(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
