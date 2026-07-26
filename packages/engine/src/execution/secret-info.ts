import type {
  AgreementState,
  BallotState,
  CardDefinitionId,
  CardInstanceId,
  CardState,
  DeckId,
  GameState,
  JsonValue,
  ObjectiveState,
  PlacementState,
  PlayerId,
  PlayerState,
  ProjectState,
  PromptState,
  RngStreamState,
  RoleId,
} from "../model";

/**
 * Hidden information, removed at the boundary rather than remembered about.
 *
 * The spec's instruction for this area is "design so that leaking is impossible
 * by construction rather than by remembering to redact", and there are two ways
 * to satisfy it. The projection types already do half: `PublicPlayerProjection`
 * has a `handCount` and *no field a card could travel in*, so a hand cannot leak
 * through it even by accident.
 *
 * This module does the other half, for everything a projection could still reach
 * into. `redactStateForViewer` produces a **viewer-scoped copy of canonical
 * state that contains no secret belonging to anybody else** — no other player's
 * role, no other player's cards, no seed material, no owner-only placement, no
 * hidden sabotage, no sealed vote. Any projection computed from that copy is
 * safe whether or not the projection itself remembers to filter, and a new
 * projection field added later is safe by default instead of dangerous by
 * default. Composition is the whole point:
 *
 * ```ts
 * projectPlayerView(redactStateForViewer(state, viewerId), viewerId)  // per socket
 * projectPublicView(redactStateForViewer(state, null))               // spectators
 * ```
 *
 * Counts are preserved wherever the game is supposed to show one: a hidden hand
 * becomes the same number of *sealed* cards, and a sealed ballot keeps the same
 * number of *anonymous* casts, so "three cards, two votes in" still renders
 * while the contents and the voters do not exist in the payload at all.
 *
 * **This is a projection-time function.** A redacted state is deliberately not a
 * playable one — its seeds are gone and its card identities are false — so it
 * must never be fed back into `applyCommand`, hashed, or persisted.
 * `isRedactedState` exists so a caller can assert that cheaply.
 */

/** The definition every sealed card reports. Names nothing about the real card. */
export const SEALED_CARD_DEFINITION_ID = "card.sealed" as CardDefinitionId;
export const SEALED_ROLE_ID = "role.sealed" as RoleId;
/**
 * Only reachable from an already-inconsistent state — a hand naming a card the
 * `cards` record does not hold. Kept so redaction stays total rather than
 * throwing on input it did not create.
 */
const FALLBACK_SEALED_DECK_ID = "deck.sealed" as DeckId;
export const SEALED_OBJECTIVE_DEFINITION_ID = "objective.sealed";
/**
 * What a redacted state carries instead of a PRNG stream's internal state.
 *
 * Load-bearing, not tidiness: `roles.ts` seeds the hidden-role draw from
 * `rng.streams`, so a projection that ever carried those strings would let any
 * recipient re-derive every player's role offline. Removing the material is a
 * second, independent barrier behind "no projection has a field for it".
 */
export const SEALED_RNG_STREAM_STATE = "sealed";

/**
 * The placeholder id standing in for one card in a hidden hand.
 *
 * Positional and owner-scoped, so it is stable across revisions (no churn in a
 * diffing client), unique across players, and carries nothing about the card. The
 * real instance id never reaches the viewer — replacing the *record* alone would
 * not be enough, because an instance id can be correlated across turns to track a
 * specific card through a hand.
 */
export function sealedHandCardId(
  ownerId: PlayerId,
  index: number,
): CardInstanceId {
  return `${ownerId}:hand:sealed:${index}` as CardInstanceId;
}

export function isSealedCardId(cardId: string): boolean {
  return cardId.includes(":hand:sealed:");
}

/**
 * The key one anonymous cast occupies in a sealed ballot's `castBy`.
 *
 * Numbered contiguously from zero over however many *other* players have cast,
 * never by seat: `sealed:cast:0..k-1` is always the same shape for a given k, so
 * the set of keys discloses the count and nothing else. Keying by seat index
 * would leak which seats had voted, which is most of what a sealed ballot exists
 * to withhold.
 */
export function sealedBallotCastKey(index: number): string {
  return `sealed:cast:${index}`;
}

function isSeated(state: GameState, viewerId: PlayerId | null): boolean {
  return viewerId !== null && state.players[viewerId] !== undefined;
}

/**
 * Whether `viewerId` may see `ownerId`'s role kind.
 *
 * Your own role is always yours to see; a revealed role is everyone's; and when
 * the ruleset has `hidden.rolesEnabled` off there is no hidden-role game to
 * protect — `assignHiddenRoles` gives that table an all-employee roster, so
 * there is provably no secret rather than merely an unenforced one.
 */
export function isRoleVisibleTo(
  state: GameState,
  ownerId: PlayerId,
  viewerId: PlayerId | null,
): boolean {
  if (!state.rules.hidden.rolesEnabled) return true;
  if (viewerId !== null && ownerId === viewerId) return true;

  return state.players[ownerId]?.role.revealed === true;
}

/**
 * Whether `viewerId` may see the *contents* of `ownerId`'s hand.
 *
 * `rules.hidden.hiddenHands` is the switch (spec §10.2 / §7.2): with it off,
 * hands are open information and everybody sees everything; with it on, a hand
 * is private to its owner and everyone else gets a count.
 */
export function isHandVisibleTo(
  state: GameState,
  ownerId: PlayerId,
  viewerId: PlayerId | null,
): boolean {
  if (!state.rules.hidden.hiddenHands) return true;

  return viewerId !== null && ownerId === viewerId;
}

/**
 * What one viewer learns about one hand.
 *
 * A discriminated union rather than an object with optional card ids: the
 * count-only case has **no field the ids could be attached to**, so a consumer
 * cannot forget to check a flag and read a property that happens to be
 * populated. Reaching card ids requires branching on `kind`, which is the point.
 */
export type HandDisclosure =
  | { readonly kind: "count"; readonly count: number }
  | {
      readonly kind: "cards";
      readonly count: number;
      readonly cardIds: readonly CardInstanceId[];
    };

export function discloseHand(
  state: GameState,
  ownerId: PlayerId,
  viewerId: PlayerId | null,
): HandDisclosure {
  const owner = state.players[ownerId];
  if (owner === undefined) return { kind: "count", count: 0 };

  if (!isHandVisibleTo(state, ownerId, viewerId)) {
    return { kind: "count", count: owner.hand.length };
  }

  return { kind: "cards", count: owner.hand.length, cardIds: [...owner.hand] };
}

/**
 * A card with its identity removed.
 *
 * `deckId` is deliberately kept. It is the one field that has to survive — the
 * serialisation contract requires every card to name a deck that exists — but it
 * is also not a secret this layer has any business inventing: `CardDrawn` is a
 * public event carrying `deckId` (and the card's name key) to the whole table, so
 * which deck a card came from is already table knowledge. What a player *holds*
 * is the secret, and that is `definitionId` and `data`, both of which go.
 */
function sealCard(card: CardState): CardState {
  return {
    id: card.id,
    definitionId: SEALED_CARD_DEFINITION_ID,
    deckId: card.deckId,
    zone: card.zone,
    ownerId: card.ownerId,
    faceUp: false,
    data: {},
  };
}

function isCardVisibleTo(
  state: GameState,
  card: CardState,
  viewerId: PlayerId | null,
): boolean {
  if (card.faceUp) return true;
  if (card.zone === "visible") return true;
  if (card.zone === "hand") {
    return card.ownerId !== null && isHandVisibleTo(state, card.ownerId, viewerId);
  }

  // Draw piles, discard piles, resolving and removed cards are all face-down as
  // far as any projection is concerned: nothing publishes their contents, so the
  // safe default is to seal them rather than to rely on that staying true.
  return false;
}

function redactPlayer(
  state: GameState,
  player: PlayerState,
  viewerId: PlayerId | null,
): PlayerState {
  const isViewer = viewerId !== null && player.id === viewerId;
  const roleVisible = isRoleVisibleTo(state, player.id, viewerId);
  const handVisible = isHandVisibleTo(state, player.id, viewerId);

  return {
    ...player,
    role: roleVisible
      ? player.role
      : { id: SEALED_ROLE_ID, kind: null, revealed: false },
    hand: handVisible
      ? player.hand
      : player.hand.map((_unused, index) => sealedHandCardId(player.id, index)),
    // A private status is private. `projectPublicPlayer` already filters on
    // visibility, so this is the second barrier, not the first.
    statuses: isViewer
      ? player.statuses
      : player.statuses.filter((status) => status.visibility === "public"),
    // Abilities are only ever projected to their own holder (`SelfProjection`),
    // and usesRemaining/cooldown is real tactical information about what an
    // opponent still has in reserve.
    abilities: isViewer ? player.abilities : [],
  };
}

function redactCards(
  state: GameState,
  viewerId: PlayerId | null,
): Readonly<Record<string, CardState>> {
  const cards: Record<string, CardState> = { ...state.cards };

  // Hidden hands first: their real ids leave the state entirely, replaced by
  // positional sealed ids that keep the count intact.
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (player === undefined) continue;
    if (isHandVisibleTo(state, playerId, viewerId)) continue;

    player.hand.forEach((cardId, index) => {
      const held = cards[cardId];
      delete cards[cardId];

      const sealedId = sealedHandCardId(playerId, index);
      cards[sealedId] = {
        id: sealedId,
        definitionId: SEALED_CARD_DEFINITION_ID,
        // Falls back to whatever the card claimed if the state is already
        // redacted, which keeps this idempotent.
        deckId: held?.deckId ?? FALLBACK_SEALED_DECK_ID,
        zone: "hand",
        ownerId: playerId,
        faceUp: false,
        data: {},
      };
    });
  }

  for (const [cardId, card] of Object.entries(cards)) {
    if (isSealedCardId(cardId)) continue;
    if (isCardVisibleTo(state, card, viewerId)) continue;
    cards[cardId] = sealCard(card);
  }

  return cards;
}

function redactPrompt(prompt: PromptState, viewerId: PlayerId | null): PromptState {
  const responses = Object.fromEntries(
    Object.entries(prompt.responses).filter(([playerId]) => playerId === viewerId),
  );

  return { ...prompt, responses };
}

function redactPlacements(
  state: GameState,
  viewerId: PlayerId | null,
): readonly PlacementState[] {
  // Omission, not blanking: a redacted placeholder would still tell the table
  // that *something* is waiting on that tile, which is the one thing an
  // owner-only placement exists to withhold.
  return state.placements.filter(
    (placement) =>
      placement.visibility === "public" || placement.ownerId === viewerId,
  );
}

function redactProjects(
  state: GameState,
  viewerId: PlayerId | null,
): readonly ProjectState[] {
  return state.projects.map((project) => ({
    ...project,
    sabotage: project.sabotage.filter(
      (entry) => !entry.hidden || entry.playerId === viewerId,
    ),
  }));
}

function redactAgreements(
  state: GameState,
  viewerId: PlayerId | null,
): readonly AgreementState[] {
  return state.agreements.filter(
    (agreement) =>
      agreement.visibility === "public" ||
      agreement.proposerId === viewerId ||
      (viewerId !== null && agreement.recipientIds.includes(viewerId)),
  );
}

function redactObjectives(
  state: GameState,
  viewerId: PlayerId | null,
): readonly ObjectiveState[] {
  return state.objectives.map((objective) => {
    if (objective.visibility !== "secret" || objective.ownerId === viewerId) {
      return objective;
    }

    // Existence-only: that a secret objective exists, whose it is, and whether
    // it has completed. Never what it asks for or how close it is.
    return {
      ...objective,
      definitionId: SEALED_OBJECTIVE_DEFINITION_ID,
      progress: 0,
      target: 0,
      rewardPoints: 0,
      rewardMoney: 0,
    };
  });
}

function redactBallots(
  state: GameState,
  viewerId: PlayerId | null,
): readonly BallotState[] {
  return state.ballots.map((ballot) => {
    const inFlight = ballot.visibility === "sealed" && ballot.resolution === null;
    if (!inFlight) return ballot;

    // Keys are voter ids and values are votes or bids, so both are replaced —
    // but the *cardinality* survives, because "two of four are in" is the part a
    // sealed ballot is meant to show.
    const own = viewerId !== null && viewerId in ballot.castBy;
    const others = Object.keys(ballot.castBy).filter(
      (playerId) => playerId !== viewerId,
    ).length;
    const castBy: Record<string, JsonValue> = {};
    for (let index = 0; index < others; index += 1) {
      castBy[sealedBallotCastKey(index)] = null;
    }
    if (own && viewerId !== null) {
      castBy[viewerId] = ballot.castBy[viewerId] as JsonValue;
    }

    return { ...ballot, castBy };
  });
}

function sealStreams(
  streams: Readonly<Record<string, RngStreamState>>,
): Readonly<Record<string, RngStreamState>> {
  return Object.fromEntries(
    Object.entries(streams).map(([name, stream]) => [
      name,
      { ...stream, state: SEALED_RNG_STREAM_STATE },
    ]),
  );
}

/**
 * A copy of canonical state holding nothing `viewerId` is not entitled to see.
 *
 * Pass `null` for a spectator or a not-yet-seated member: they are entitled to
 * the public set and nothing else, and passing an unknown id has exactly the
 * same effect (an id the caller cannot resolve to a seat must never widen
 * disclosure).
 *
 * Pure, total, and JSON-round-trippable — it produces plain state shapes, so the
 * result survives the repository boundary unchanged and can be compared,
 * serialised or diffed like any other snapshot.
 *
 * Not playable. See the module docstring.
 */
export function redactStateForViewer(
  state: GameState,
  viewerId: PlayerId | null,
): GameState {
  const viewer = isSeated(state, viewerId) ? viewerId : null;

  // Spread-then-overwrite so every player keeps its original key position: a
  // rebuilt record would reorder keys, and the JSON text of a state is compared
  // and hashed elsewhere in this repo.
  const players: Record<string, PlayerState> = { ...state.players };
  for (const [playerId, player] of Object.entries(state.players)) {
    players[playerId] = redactPlayer(state, player, viewer);
  }

  return {
    ...state,
    players,
    cards: redactCards(state, viewer),
    // Nothing projects the resolution stack or pending effects, and both carry
    // `server`-visibility internals; a viewer keeps only what is addressed to
    // them so a future projection over either cannot start leaking.
    //
    // `server` visibility is absolute and is never widened by being addressed to
    // someone: an engine-internal frame that happens to name you among its
    // affected players is still engine-internal.
    resolutionStack: state.resolutionStack.filter(
      (frame) =>
        frame.visibility === "public" ||
        (frame.visibility !== "server" &&
          viewer !== null &&
          (frame.actingPlayerId === viewer ||
            frame.affectedPlayerIds.includes(viewer))),
    ),
    prompts: state.prompts
      .filter((prompt) => viewer !== null && prompt.audience.includes(viewer))
      .map((prompt) => redactPrompt(prompt, viewer)),
    pendingEffects: state.pendingEffects.filter(
      (effect) =>
        effect.visibility === "public" ||
        (effect.visibility !== "server" &&
          viewer !== null &&
          effect.affectedPlayerIds.includes(viewer)),
    ),
    reactionWindows: state.reactionWindows.filter(
      (window) => viewer !== null && window.eligiblePlayerIds.includes(viewer),
    ),
    placements: redactPlacements(state, viewer),
    projects: redactProjects(state, viewer),
    agreements: redactAgreements(state, viewer),
    objectives: redactObjectives(state, viewer),
    ballots: redactBallots(state, viewer),
    rng: { streams: sealStreams(state.rng.streams) },
  };
}

/**
 * Best-effort check that a state has been through `redactStateForViewer`.
 *
 * Intended as an assertion at the command boundary — a redacted state applied as
 * if it were canonical would quietly replace real cards with sealed ones and
 * destroy the RNG streams. It reads the seeded-stream sentinel, so it can only
 * answer for a state that carries at least one stream; a state with none is
 * reported as not redacted rather than guessed at.
 */
export function isRedactedState(state: GameState): boolean {
  const streams = Object.values(state.rng.streams);
  if (streams.length === 0) return false;

  return streams.every((stream) => stream.state === SEALED_RNG_STREAM_STATE);
}
