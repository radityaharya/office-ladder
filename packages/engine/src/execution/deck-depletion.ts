import type { DeckCard, DeckConfig, ModeRules } from "@office-ladder/content";

import type {
  CardDefinitionId,
  CardInstanceId,
  CardState,
  DeckId,
  DeckKind,
  DeckState,
  GameId,
  GameState,
  LogicalTimestamp,
  MatchOutcome,
  PlayerId,
  PlayerState,
  WinPath,
} from "../model";
import { createStableId } from "../model";
import { randomInt, type RandomSource, createSeededRandomSource, type SeededRandomSource } from "../random";

/**
 * When a drawn card resolves.
 *
 * A local narrowing of the spec's §10.2 `EffectTiming`, which belongs in
 * `packages/content/src/schema/effects.ts` and has not landed there yet. Reading
 * it structurally (see `cardTiming`) rather than importing it means this module
 * already behaves correctly for authored `timing` the day the content vocabulary
 * ships, and behaves exactly like today's engine until then — every existing
 * card is untagged and therefore `"immediate"`.
 */
export type CardTiming = "immediate" | "stored" | "reaction";

const CARD_TIMINGS: readonly string[] = ["immediate", "stored", "reaction"];

const DECK_KINDS: readonly string[] = [
  "deck.work",
  "deck.meeting",
  "deck.event",
  "deck.networking",
  "deck.board-meeting",
  "deck.annual-event",
];

/**
 * Which sub-resolution inside this mechanic is asking for randomness.
 *
 * Deliberately disjoint from `EphemeralRandomPurpose` in `ephemeral-random.ts`:
 * that union is owned by another module and cannot be extended from here, and two
 * sources built from the same canonical state must never share a domain separator
 * or their outcomes correlate perfectly. Once `EphemeralRandomPurpose` gains
 * `"deck-reshuffle"` and `"card-play"` this type and `createCardRandom` should be
 * deleted in favour of `createEphemeralRandom` — the seed fields are identical by
 * construction, only the purpose string differs.
 */
export type CardRandomPurpose = "deck-reshuffle" | "card-play";

const SEED_FIELD_SEPARATOR = "|";
const ABSENT_FIELD = "-";

function streamFields(state: GameState, streamName: string): readonly string[] {
  const stream = state.rng.streams[streamName];
  if (stream === undefined) return [ABSENT_FIELD, ABSENT_FIELD, ABSENT_FIELD];

  return [stream.algorithm, stream.state, String(stream.cursor)];
}

/**
 * The seed for a single-command random source owned by this mechanic.
 *
 * Every field is server-owned canonical state. The command id is deliberately
 * absent: it is client-chosen, and seeding from it once let a client enumerate
 * candidate ids offline against this 32-bit PRNG until one produced the outcome
 * it wanted. Because the seed is a pure function of `state`, replaying the same
 * command against the same state re-derives the same stream — and a client cannot
 * resubmit against the same state to shop for a better one, since the first
 * accepted command advances `revision`.
 */
export function cardRandomSeed(state: GameState, purpose: CardRandomPurpose): string {
  return [
    "ephemeral",
    purpose,
    state.gameId,
    String(state.revision),
    String(state.eventSequence),
    ...streamFields(state, "dice"),
    ...streamFields(state, "setup"),
  ].join(SEED_FIELD_SEPARATOR);
}

/**
 * A fresh, ephemeral random source for one purpose inside one command. Never
 * written back to `state.rng.streams`, so the persisted "dice" stream's cursor
 * still advances exactly once per movement die.
 *
 * Exactly one source per purpose per command: the seed does not change while a
 * command resolves, so a second source for the same purpose would repeat the
 * first source's draws rather than continue them.
 */
export function createCardRandom(
  state: GameState,
  purpose: CardRandomPurpose,
): SeededRandomSource {
  return createSeededRandomSource(cardRandomSeed(state, purpose));
}

function readTiming(value: unknown): CardTiming | null {
  return typeof value === "string" && CARD_TIMINGS.includes(value)
    ? (value as CardTiming)
    : null;
}

/**
 * When an authored card resolves: on draw, from the hand, or into a reaction
 * window.
 *
 * Read structurally so an untagged card — which is every card in the pack today —
 * is `"immediate"`, exactly the behaviour the engine already has. A card-level
 * `timing` wins; otherwise the first non-immediate effect timing decides, because
 * a card carrying one stored effect cannot resolve on draw. An unrecognised value
 * degrades to `"immediate"` rather than removing the card from play: a content
 * typo should not silently shrink a deck.
 */
export function cardTiming(card: DeckCard): CardTiming {
  const authored = readTiming((card as { readonly timing?: unknown }).timing);
  if (authored !== null) return authored;

  for (const effect of card.effects) {
    const timing = readTiming((effect as { readonly timing?: unknown }).timing);
    if (timing !== null && timing !== "immediate") return timing;
  }

  return "immediate";
}

/**
 * Whether a mode's ruleset admits a card of this timing at all.
 *
 * Spec §10.2: a card whose timing is disabled by the active mode must not enter
 * its deck at setup — filter at construction, never draw-then-discard, or the
 * deck's real size (and therefore the clock) depends on which cards happened to
 * be drawn.
 *
 * `"reaction"` requires a hand as well as reaction windows: a reaction card is
 * held until a window opens, and with `handEnabled` false there is nowhere to
 * hold it.
 */
export function timingAllowed(timing: CardTiming, rules: ModeRules): boolean {
  switch (timing) {
    case "immediate":
      return true;
    case "stored":
      return rules.agency.handEnabled;
    case "reaction":
      return rules.interaction.reactionWindows && rules.agency.handEnabled;
    default:
      return timing satisfies never;
  }
}

export type DeckPiles = {
  readonly decks: Readonly<Record<string, DeckState>>;
  readonly cards: Readonly<Record<string, CardState>>;
};

export type BuildDecksInput = {
  readonly gameId: GameId;
  /** Authored decks, in content order. */
  readonly decks: readonly DeckConfig[];
  /** `ModeConfig.deckQuantities` — how many physical cards each deck holds. */
  readonly quantities: Readonly<Record<string, number>>;
  readonly rules: ModeRules;
  /**
   * `ModeConfig.clockDeck.deckIds`. These decks do **not** reshuffle when empty:
   * that is what makes the clock a clock. An empty list switches the whole
   * depletion win condition off for the mode.
   */
  readonly clockDeckIds: readonly string[];
  readonly random: RandomSource;
};

/** Fisher-Yates, drawing from the caller's deterministic source. */
function shuffle<T>(values: readonly T[], random: RandomSource): readonly T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(random, 0, index);
    const current = shuffled[index];
    const other = shuffled[swapIndex];
    if (current === undefined || other === undefined) continue;
    shuffled[index] = other;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

function deckKindOf(deckId: string): DeckKind | null {
  return DECK_KINDS.includes(deckId) ? (deckId as DeckKind) : null;
}

/**
 * Builds every deck and every card instance for a new game.
 *
 * Three things this fixes, all of which the engine got wrong by simply never
 * populating `GameState.decks`/`cards`:
 *
 * - **Decks have a size.** `deckQuantities` is honoured by repeating the authored
 *   pool up to the mode's card count, so a 6-card authored pool becomes the 25
 *   physical cards `mode.quick` asks for. Without a size, nothing can deplete.
 * - **Timing is filtered here.** A stored card in a mode with no hand, or a
 *   reaction card in a mode with no windows, never enters the deck (spec §10.2).
 * - **Clock decks do not reshuffle.** `reshufflesWhenEmpty` is false for every
 *   deck named by `clockDeckIds`, which is the entire mechanism behind the
 *   `clock-deck-exhausted` end condition.
 *
 * Card instance ids are derived from `gameId`, the deck id and the card's index,
 * so they are stable across a replay and unique within the game.
 */
export function buildDecks(input: BuildDecksInput): DeckPiles {
  const decks: Record<string, DeckState> = {};
  const cards: Record<string, CardState> = {};

  for (const deck of input.decks) {
    const playable = deck.cards.filter((card) => timingAllowed(cardTiming(card), input.rules));
    const requested = input.quantities[deck.id];
    const quantity =
      playable.length === 0
        ? 0
        : typeof requested === "number" && Number.isSafeInteger(requested) && requested > 0
          ? requested
          : playable.length;

    const instanceIds: CardInstanceId[] = [];
    for (let index = 0; index < quantity; index += 1) {
      const definition = playable[index % playable.length];
      if (definition === undefined) continue;

      const cardId = createStableId(
        "CardInstanceId",
        `${input.gameId}:card:${deck.id}:${index}`,
      );
      instanceIds.push(cardId);
      cards[cardId] = {
        id: cardId,
        definitionId: createStableId("CardDefinitionId", definition.id),
        deckId: createStableId("DeckId", deck.id),
        zone: "draw-pile",
        ownerId: null,
        faceUp: false,
        data: {},
      };
    }

    const isClockDeck = input.clockDeckIds.includes(deck.id);
    decks[deck.id] = {
      id: createStableId("DeckId", deck.id),
      kind: deckKindOf(deck.id),
      drawPile: shuffle(instanceIds, input.random),
      discardPile: [],
      visibleCards: [],
      // The clock only counts down if its cards do not come back.
      reshufflesWhenEmpty: !isClockDeck,
      // A management shuffle of a clock deck would fold the discard pile back in
      // and un-count the clock, so clock decks are not eligible for one.
      managementShuffleEligible: !isClockDeck,
      shuffleCount: 1,
    };
  }

  return { decks, cards };
}

/** A deck that cannot produce another card: empty, with nothing left to recycle. */
export function isDeckDepleted(deck: DeckState): boolean {
  if (deck.drawPile.length > 0) return false;

  return !deck.reshufflesWhenEmpty || deck.discardPile.length === 0;
}

export type DrawnCard = {
  readonly cardId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly deckId: DeckId;
};

export type DrawCardsInput = {
  readonly decks: Readonly<Record<string, DeckState>>;
  readonly cards: Readonly<Record<string, CardState>>;
  readonly deckId: string;
  readonly count: number;
  /** Who the drawn cards belong to while they resolve; null for a table draw. */
  readonly drawnBy: PlayerId | null;
  readonly random: RandomSource;
};

export type DrawCardsOutcome = DeckPiles & {
  readonly drawn: readonly DrawnCard[];
  /** How many times the discard pile was recycled to satisfy this draw. */
  readonly reshuffles: number;
  /** True when the deck ran out before `count` cards had been produced. */
  readonly depleted: boolean;
};

/**
 * Draws **without replacement** — the single behavioural change this mechanic
 * exists for.
 *
 * `resolve-tile-effects.ts` currently picks a random authored card and leaves the
 * deck untouched, which is why `clock-deck-exhausted` has no producer anywhere in
 * the engine: an infinite deck cannot run out. Here a card leaves `drawPile` for
 * good, a deck with `reshufflesWhenEmpty` recycles its discard pile (bumping
 * `shuffleCount`), and a deck without it simply runs dry and reports `depleted`.
 *
 * Drawn cards land in the `"resolving"` zone owned by `drawnBy`; the caller then
 * either resolves and discards them (`discardCard`) or stores them
 * (`storeCardInHand` in hand.ts). Leaving the disposition to the caller is what
 * lets one draw path serve both immediate and stored cards.
 */
export function drawCards(input: DrawCardsInput): DrawCardsOutcome {
  const deck = input.decks[input.deckId];
  if (deck === undefined || input.count <= 0) {
    return {
      decks: input.decks,
      cards: input.cards,
      drawn: [],
      reshuffles: 0,
      depleted: deck === undefined ? true : isDeckDepleted(deck),
    };
  }

  let drawPile = [...deck.drawPile];
  let discardPile = [...deck.discardPile];
  let shuffleCount = deck.shuffleCount;
  let reshuffles = 0;
  let depleted = false;
  const cards: Record<string, CardState> = { ...input.cards };
  const drawn: DrawnCard[] = [];

  for (let index = 0; index < input.count; index += 1) {
    if (drawPile.length === 0) {
      if (!deck.reshufflesWhenEmpty || discardPile.length === 0) {
        depleted = true;
        break;
      }
      drawPile = [...shuffle(discardPile, input.random)];
      discardPile = [];
      shuffleCount += 1;
      reshuffles += 1;
    }

    const cardId = drawPile.shift();
    if (cardId === undefined) {
      depleted = true;
      break;
    }
    const card = cards[cardId];
    if (card === undefined) continue;

    cards[cardId] = {
      ...card,
      zone: "resolving",
      ownerId: input.drawnBy,
    };
    drawn.push({
      cardId,
      definitionId: card.definitionId,
      deckId: card.deckId,
    });
  }

  const updatedDeck: DeckState = {
    ...deck,
    drawPile,
    discardPile,
    shuffleCount,
  };

  return {
    decks: { ...input.decks, [input.deckId]: updatedDeck },
    cards,
    drawn,
    reshuffles,
    depleted: depleted || isDeckDepleted(updatedDeck),
  };
}

export type DiscardCardInput = {
  readonly decks: Readonly<Record<string, DeckState>>;
  readonly cards: Readonly<Record<string, CardState>>;
  readonly cardId: CardInstanceId;
};

/**
 * Sends one card to its own deck's discard pile, face down and unowned.
 *
 * A card whose deck is not in state (a fixture, or a deck removed from the pack)
 * still leaves the zone it was in: the card map is canonical, and leaving a
 * played card in `"hand"` would let it be played twice.
 */
export function discardCard(input: DiscardCardInput): DeckPiles {
  const card = input.cards[input.cardId];
  if (card === undefined) {
    return { decks: input.decks, cards: input.cards };
  }

  const cards: Record<string, CardState> = {
    ...input.cards,
    [input.cardId]: { ...card, zone: "discard-pile", ownerId: null, faceUp: false },
  };
  const deck = input.decks[card.deckId];
  if (deck === undefined) {
    return { decks: input.decks, cards };
  }

  return {
    decks: {
      ...input.decks,
      [card.deckId]: {
        ...deck,
        drawPile: deck.drawPile.filter((candidate) => candidate !== input.cardId),
        visibleCards: deck.visibleCards.filter((candidate) => candidate !== input.cardId),
        discardPile: [...deck.discardPile, input.cardId],
      },
    },
    cards,
  };
}

type ClockDeckContent = {
  readonly modes: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly clockDeck: { readonly deckIds: readonly string[] };
      }
    >
  >;
};

/**
 * The decks whose exhaustion ends the match, read from the mode the game was
 * created under.
 *
 * Config-driven both ways: a mode that names no clock decks has no clock, and
 * therefore no `clock-deck-exhausted` end condition. An unknown mode returns an
 * empty list — failing closed, because inventing a clock for a mode the pack has
 * never heard of would end matches nobody asked to be timed.
 */
export function resolveClockDeckIds(
  state: GameState,
  content: ClockDeckContent,
): readonly string[] {
  const mode = Object.values(content.modes).find((candidate) => candidate.id === state.modeId);

  return mode?.clockDeck.deckIds ?? [];
}

export type ClockDeckRemaining = {
  readonly remainingMeetingCards: number;
  readonly remainingEventCards: number;
  readonly total: number;
};

function deckRemaining(deck: DeckState | undefined): number {
  if (deck === undefined) return 0;

  return deck.reshufflesWhenEmpty
    ? deck.drawPile.length + deck.discardPile.length
    : deck.drawPile.length;
}

/**
 * How much clock is left, shaped to drop straight into `ClockDeckExhausted`'s
 * payload. Decks other than meeting and event count towards `total` only — the
 * event's two named fields are the shipped `clockDeck.deckIds` and a mode is free
 * to name others.
 */
export function clockDeckRemaining(
  decks: Readonly<Record<string, DeckState>>,
  clockDeckIds: readonly string[],
): ClockDeckRemaining {
  let total = 0;
  for (const deckId of clockDeckIds) {
    total += deckRemaining(decks[deckId]);
  }

  return {
    remainingMeetingCards: clockDeckIds.includes("deck.meeting")
      ? deckRemaining(decks["deck.meeting"])
      : 0,
    remainingEventCards: clockDeckIds.includes("deck.event")
      ? deckRemaining(decks["deck.event"])
      : 0,
    total,
  };
}

/**
 * Whether the clock has run out: every named clock deck exists and can no longer
 * produce a card. An empty `clockDeckIds` is never exhausted, which is how a mode
 * switches the condition off.
 */
export function isClockDeckExhausted(
  decks: Readonly<Record<string, DeckState>>,
  clockDeckIds: readonly string[],
): boolean {
  if (clockDeckIds.length === 0) return false;

  return clockDeckIds.every((deckId) => {
    const deck = decks[deckId];

    return deck === undefined ? false : isDeckDepleted(deck);
  });
}

function resourceValue(player: PlayerState, key: string): number {
  return player.resources[key]?.value ?? 0;
}

/**
 * The ordering used to settle a clock-deck ending when roles do not decide it.
 *
 * Read from `rules.winPaths` rather than hardcoded, so a wealth-only mode is
 * settled on money and a promotion mode on rank. The remaining keys are
 * tie-breakers, and `playerOrder` is the final one — never object key order,
 * which is not stable across the repository's JSON round trip.
 */
function scoreVector(player: PlayerState, winPath: WinPath): readonly number[] {
  const rank = player.rank.index;
  const money = resourceValue(player, "money");
  const reputation = resourceValue(player, "reputation");

  switch (winPath) {
    case "wealth":
      return [money, rank, reputation];
    case "influence":
      return [reputation, rank, money];
    case "survival":
      return [rank, money, reputation];
    case "promotion":
    default:
      return [rank, money, reputation];
  }
}

function compareVectors(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

function enabledWinPath(rules: GameState["rules"]): WinPath | null {
  if (rules.winPaths.promotion) return "promotion";
  if (rules.winPaths.wealth) return "wealth";
  if (rules.winPaths.influence) return "influence";
  if (rules.winPaths.survival) return "survival";

  return null;
}

/**
 * The outcome for a match that ended because the Clock Deck ran out.
 *
 * Who wins is entirely mode-driven:
 *
 * - With `hidden.rolesEnabled` **and** `hidden.roleWinConditions`, Management wins
 *   — the GDD's own reason for a clock existing at all.
 * - Otherwise the first enabled entry in `winPaths` decides the ordering, and
 *   every player tied at the top wins. Ties are listed in `playerOrder`.
 * - With no win path enabled at all the match still ends, with no winner, rather
 *   than inventing one.
 *
 * `scores` is left empty: `ScoreBreakdown` (spec §5.6) has no producer yet, and a
 * fabricated breakdown would be worse than an honest absence.
 */
export function clockDeckExhaustionOutcome(
  state: GameState,
  clockDeckIds: readonly string[],
  endedAt: LogicalTimestamp,
): MatchOutcome {
  const contenders = state.playerOrder
    .filter((playerId) => !state.eliminatedPlayerIds.includes(playerId))
    .map((playerId) => state.players[playerId])
    .filter((player): player is PlayerState => player !== undefined);

  if (state.rules.hidden.rolesEnabled && state.rules.hidden.roleWinConditions) {
    const management = contenders
      .filter((player) => player.role.kind === "role.management")
      .map((player) => player.id);

    return {
      reason: "clock-deck-exhausted",
      winnerPlayerIds: management,
      winningRole: management.length > 0 ? "role.management" : null,
      endedAt,
      scores: [],
      winPath: null,
      data: { clockDeckIds: [...clockDeckIds], settledBy: "role" },
    };
  }

  const winPath = enabledWinPath(state.rules);
  const winners: PlayerId[] = [];
  if (winPath !== null) {
    let best: readonly number[] | null = null;
    for (const player of contenders) {
      const vector = scoreVector(player, winPath);
      const comparison = best === null ? 1 : compareVectors(vector, best);
      if (comparison > 0) {
        best = vector;
        winners.length = 0;
        winners.push(player.id);
      } else if (comparison === 0) {
        winners.push(player.id);
      }
    }
  }

  return {
    reason: "clock-deck-exhausted",
    winnerPlayerIds: winners,
    winningRole: null,
    endedAt,
    scores: [],
    winPath: winners.length > 0 ? winPath : null,
    data: { clockDeckIds: [...clockDeckIds], settledBy: winPath ?? "none" },
  };
}
