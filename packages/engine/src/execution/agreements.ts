import type { OfferAgreementCommand, RespondToAgreementCommand } from "../commands";
import type {
  CardStoredEvent,
  GameEvent,
  ResourceChangedEvent,
  StatusAppliedEvent,
} from "../events";
import type {
  AgreementState,
  CardState,
  EngineErrorCode,
  GameState,
  ModeRules,
  PlayerId,
  PlayerState,
  PlayerStatusState,
  TileOwnershipState,
  TradeItem,
} from "../model";
import { createStableId } from "../model";
import { createEventMetadata } from "./events";
import { rejectCommand } from "./errors";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Agreements: `agreement.offer` and `agreement.respond` (spec §5.5, §6.2, §7.3).
 *
 * These are the first transitions whose effects land on somebody who is not the
 * actor, so almost all of the code below is authorisation and revalidation
 * rather than mechanics. Three rules shape the whole module:
 *
 * 1. **Transfers are enforced; promises are not.** A `kind: "promise"` item is
 *    written into the agreement log and never touched again. Betrayal is the
 *    point of the mechanic — engineering it away removes the only reason table
 *    talk matters (spec §5.5). Nothing here reads a promise back.
 * 2. **Affordability is validated at accept time, not offer time.** A stale
 *    offer must not be cashable after the state it referenced has changed, so
 *    every quantity is re-checked against the state the *acceptance* is applied
 *    to. Ownership of the things being offered is checked at *both* ends: you
 *    may only offer what you actually hold (spec §7.3, §6.3).
 * 3. **Settlement is atomic.** The whole transfer is computed into a ledger and
 *    validated end to end before anything is committed; a single failing leg
 *    rejects the command and leaves canonical state untouched. There is no
 *    partial trade.
 *
 * Everything is gated on `state.rules` — `interaction.tradesEnabled` for the
 * transferable item kinds and `interaction.promisesRecorded` for promises, plus
 * the per-kind gates listed on `validateTradeItem`. No `modeId` comparison and
 * no hardcoded tunable appears anywhere in this file.
 *
 * Purity: no clock, no randomness, no content lookup. `context` is used only for
 * the logical timestamp stamped onto the events a settlement emits.
 */

/** The canonical key of the money resource on `PlayerState.resources`. */
const MONEY_RESOURCE_KEY = "money";

/**
 * The status a settled `immunity` item grants its receiver.
 *
 * An identifier, not a tunable: how *long* the immunity lasts comes from the
 * traded item, and whether immunity may be traded at all comes from
 * `rules.conflict.defenceEnabled`.
 */
const IMMUNITY_STATUS_ID = "status.trade-immunity";

/**
 * A structural bound on free text entering canonical state, not a game rule.
 * Promises are unenforced flavour that still has to round-trip through the
 * repository's jsonb column and render in a panel, so an unbounded string is a
 * storage and layout hazard rather than a balance question.
 */
const MAX_PROMISE_LENGTH = 280;

type Rejection = {
  readonly code: EngineErrorCode;
  readonly message: string;
};

type Check<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Rejection };

function fail(code: EngineErrorCode, message: string): { readonly ok: false; readonly error: Rejection } {
  return { ok: false, error: { code, message } };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Every item on both sides of an agreement, in a stable order. */
function allItems(give: readonly TradeItem[], receive: readonly TradeItem[]): readonly TradeItem[] {
  return [...give, ...receive];
}

/** A promise is recorded; everything else actually moves something. */
function isTransfer(item: TradeItem): boolean {
  return item.kind !== "promise";
}

/**
 * Structural validation plus the mode gate for one item.
 *
 * Each kind is gated on the rule that owns it, so a mode can enable trading
 * without enabling the board ownership or hand that some item kinds depend on:
 *
 * - every transferable kind requires `interaction.tradesEnabled`
 * - `card` additionally requires `agency.handEnabled`
 * - `tile` additionally requires `board.ownershipEnabled`
 * - `immunity` additionally requires `conflict.defenceEnabled`
 * - `promise` requires `interaction.promisesRecorded` and nothing else, so a
 *   promise-only pact is legal in a mode that has trading switched off
 */
function validateTradeItem(item: TradeItem, rules: ModeRules): Check<null> {
  if (isTransfer(item) && !rules.interaction.tradesEnabled) {
    return fail("ILLEGAL_ACTION", "Trades are disabled by this mode's rules");
  }

  switch (item.kind) {
    case "money":
      if (!isPositiveInteger(item.amount)) {
        return fail("ILLEGAL_ACTION", "A money item must carry a positive whole amount");
      }

      return { ok: true, value: null };
    case "card":
      if (!rules.agency.handEnabled) {
        return fail("ILLEGAL_ACTION", "Hands are disabled by this mode's rules");
      }
      if (!isNonEmptyString(item.cardId)) {
        return fail("ILLEGAL_ACTION", "A card item must name a card");
      }

      return { ok: true, value: null };
    case "token":
      if (!isNonEmptyString(item.tokenId)) {
        return fail("ILLEGAL_ACTION", "A token item must name a token");
      }
      if (!isPositiveInteger(item.quantity)) {
        return fail("ILLEGAL_ACTION", "A token item must carry a positive whole quantity");
      }

      return { ok: true, value: null };
    case "tile":
      if (!rules.board.ownershipEnabled) {
        return fail("ILLEGAL_ACTION", "Tile ownership is disabled by this mode's rules");
      }
      if (!isNonEmptyString(item.tileId)) {
        return fail("ILLEGAL_ACTION", "A tile item must name a tile");
      }

      return { ok: true, value: null };
    case "immunity":
      if (!rules.conflict.defenceEnabled) {
        return fail("ILLEGAL_ACTION", "Defensive effects are disabled by this mode's rules");
      }
      if (!isPositiveInteger(item.rounds)) {
        return fail("ILLEGAL_ACTION", "An immunity item must last a positive whole number of rounds");
      }

      return { ok: true, value: null };
    case "promise":
      if (!rules.interaction.promisesRecorded) {
        return fail("ILLEGAL_ACTION", "Promises are not recorded by this mode's rules");
      }
      if (!isNonEmptyString(item.text)) {
        return fail("ILLEGAL_ACTION", "A promise item must carry text");
      }
      if (item.text.length > MAX_PROMISE_LENGTH) {
        return fail("ILLEGAL_ACTION", "Promise text is too long to record");
      }

      return { ok: true, value: null };
    default:
      return fail(
        "ILLEGAL_ACTION",
        `Unsupported trade item kind: ${String((item as TradeItem).kind)}`,
      );
  }
}

/**
 * The key under which `player.tokens` holds `tokenId`.
 *
 * Token records are keyed by their short content name ("momentum") while
 * `TokenState.id` is a per-player instance id, and a client may legitimately
 * name either. Ids are unique within a player, so the scan returns the same
 * answer regardless of key order — this is a lookup, not an ordered fold.
 */
function findTokenKey(player: PlayerState, tokenId: string): string | null {
  if (player.tokens[tokenId] !== undefined) {
    return tokenId;
  }
  for (const [key, token] of Object.entries(player.tokens)) {
    if (token.id === tokenId) {
      return key;
    }
  }

  return null;
}

/**
 * Whether `player` currently holds the thing `item` promises to hand over.
 *
 * Deliberately checks *ownership*, never *sufficiency*: a proposer may offer
 * more money than they have and simply fail to settle later, but may not offer a
 * card, token or tile that was never theirs. Quantities are re-checked when the
 * agreement settles.
 */
function ownsOfferedItem(state: GameState, player: PlayerState, item: TradeItem): Check<null> {
  switch (item.kind) {
    case "money":
      if (player.resources[MONEY_RESOURCE_KEY] === undefined) {
        return fail("ILLEGAL_ACTION", "Offering player has no money resource to trade");
      }

      return { ok: true, value: null };
    case "card": {
      const card = state.cards[item.cardId];
      if (card === undefined || card.ownerId !== player.id || card.zone !== "hand") {
        return fail("CARD_NOT_AVAILABLE", "Offering player does not hold that card");
      }

      return { ok: true, value: null };
    }
    case "token":
      if (findTokenKey(player, item.tokenId) === null) {
        return fail("ILLEGAL_ACTION", "Offering player has no such token");
      }

      return { ok: true, value: null };
    case "tile": {
      const ownership = state.tileOwnership[item.tileId];
      if (ownership === undefined || ownership.ownerId !== player.id) {
        return fail("ILLEGAL_ACTION", "Offering player does not own that tile");
      }

      return { ok: true, value: null };
    }
    // Immunity is minted by the agreement rather than moved off the giver, and a
    // promise is words. Neither is something the proposer can fail to own.
    case "immunity":
    case "promise":
      return { ok: true, value: null };
    default:
      return fail(
        "ILLEGAL_ACTION",
        `Unsupported trade item kind: ${String((item as TradeItem).kind)}`,
      );
  }
}

/**
 * The mutable working copy a settlement builds up. Nothing here is committed
 * until every leg of the trade has validated, which is what makes settlement
 * atomic: a rejection simply drops the ledger and returns the untouched state.
 */
type Ledger = {
  players: Record<string, PlayerState>;
  cards: Record<string, CardState>;
  tileOwnership: Record<string, TileOwnershipState>;
  readonly events: GameEvent[];
};

type EventMetadata = () => Omit<GameEvent, "type" | "payload">;

function moveMoney(
  ledger: Ledger,
  from: PlayerState,
  to: PlayerState,
  amount: number,
  eventMetadata: EventMetadata,
): Check<null> {
  const fromMoney = from.resources[MONEY_RESOURCE_KEY];
  const toMoney = to.resources[MONEY_RESOURCE_KEY];
  if (fromMoney === undefined || toMoney === undefined) {
    return fail("ILLEGAL_ACTION", "Both parties need a money resource to trade money");
  }

  const fromValue = fromMoney.value - amount;
  if (fromValue < (fromMoney.minimum ?? 0)) {
    return fail("INSUFFICIENT_RESOURCE", "Paying player cannot cover this agreement");
  }

  const toValue = toMoney.value + amount;
  if (toMoney.maximum !== null && toValue > toMoney.maximum) {
    // Clamping would silently destroy part of a trade the table agreed to, and
    // a partially-honoured trade is exactly what atomicity forbids.
    return fail("ILLEGAL_ACTION", "Receiving player cannot hold this much money");
  }

  ledger.players[from.id] = {
    ...from,
    resources: { ...from.resources, [MONEY_RESOURCE_KEY]: { ...fromMoney, value: fromValue } },
  };
  ledger.players[to.id] = {
    ...to,
    resources: { ...to.resources, [MONEY_RESOURCE_KEY]: { ...toMoney, value: toValue } },
  };

  const paid: ResourceChangedEvent = {
    ...eventMetadata(),
    type: "ResourceChanged",
    payload: {
      playerId: from.id,
      resourceId: fromMoney.id,
      previousValue: fromMoney.value,
      newValue: fromValue,
      reason: "agreement-settlement",
    },
  };
  ledger.events.push(paid);
  const received: ResourceChangedEvent = {
    ...eventMetadata(),
    type: "ResourceChanged",
    payload: {
      playerId: to.id,
      resourceId: toMoney.id,
      previousValue: toMoney.value,
      newValue: toValue,
      reason: "agreement-settlement",
    },
  };
  ledger.events.push(received);

  return { ok: true, value: null };
}

function moveCard(
  ledger: Ledger,
  from: PlayerState,
  to: PlayerState,
  cardId: string,
  eventMetadata: EventMetadata,
): Check<null> {
  const card = ledger.cards[cardId];
  if (card === undefined || card.ownerId !== from.id || card.zone !== "hand") {
    return fail("CARD_NOT_AVAILABLE", "That card is no longer in the giving player's hand");
  }

  ledger.cards[cardId] = { ...card, ownerId: to.id };
  ledger.players[from.id] = {
    ...from,
    hand: from.hand.filter((held) => held !== card.id),
  };
  ledger.players[to.id] = { ...to, hand: [...to.hand, card.id] };

  const stored: CardStoredEvent = {
    ...eventMetadata(),
    type: "CardStored",
    payload: { playerId: to.id, cardId: card.id },
  };
  ledger.events.push(stored);

  return { ok: true, value: null };
}

function moveToken(
  ledger: Ledger,
  from: PlayerState,
  to: PlayerState,
  tokenId: string,
  quantity: number,
): Check<null> {
  const fromKey = findTokenKey(from, tokenId);
  const fromToken = fromKey === null ? undefined : from.tokens[fromKey];
  if (fromKey === null || fromToken === undefined) {
    return fail("ILLEGAL_ACTION", "Giving player has no such token");
  }
  if (fromToken.count < quantity) {
    return fail("INSUFFICIENT_RESOURCE", "Giving player does not hold that many tokens");
  }

  const toToken = to.tokens[fromKey];
  if (toToken === undefined) {
    return fail("ILLEGAL_ACTION", "Receiving player has no such token to receive into");
  }
  if (toToken.count + quantity > toToken.maximum) {
    return fail("TOKEN_LIMIT_EXCEEDED", "Receiving player is at their token cap");
  }

  ledger.players[from.id] = {
    ...from,
    tokens: { ...from.tokens, [fromKey]: { ...fromToken, count: fromToken.count - quantity } },
  };
  ledger.players[to.id] = {
    ...to,
    tokens: { ...to.tokens, [fromKey]: { ...toToken, count: toToken.count + quantity } },
  };

  return { ok: true, value: null };
}

function moveTile(
  ledger: Ledger,
  from: PlayerState,
  to: PlayerState,
  tileId: string,
): Check<null> {
  const ownership = ledger.tileOwnership[tileId];
  if (ownership === undefined || ownership.ownerId !== from.id) {
    return fail("ILLEGAL_ACTION", "Giving player no longer owns that tile");
  }

  // Level, claim round and toll history are the tile's record, not the owner's,
  // so a sale hands the improved tile over exactly as it stands.
  ledger.tileOwnership[tileId] = { ...ownership, ownerId: to.id };

  return { ok: true, value: null };
}

function grantImmunity(
  ledger: Ledger,
  to: PlayerState,
  rounds: number,
  round: number,
  visibility: AgreementState["visibility"],
  eventMetadata: EventMetadata,
): Check<null> {
  const status: PlayerStatusState = {
    id: createStableId("StatusId", IMMUNITY_STATUS_ID),
    sourceId: "agreement",
    stacks: 1,
    remainingTurns: null,
    expiresAtRound: round + rounds,
    // A public agreement's immunity is a public deterrent; a parties-only one
    // must not leak that a deal happened, so it stays private.
    visibility: visibility === "public" ? "public" : "private",
    data: { rounds },
  };

  ledger.players[to.id] = {
    ...to,
    statuses: [...to.statuses.filter((existing) => existing.id !== status.id), status],
  };

  const applied: StatusAppliedEvent = {
    ...eventMetadata(),
    type: "StatusApplied",
    payload: { playerId: to.id, statusId: status.id, stacks: status.stacks, data: status.data },
  };
  ledger.events.push(applied);

  return { ok: true, value: null };
}

function transferItem(
  ledger: Ledger,
  item: TradeItem,
  fromId: PlayerId,
  toId: PlayerId,
  round: number,
  visibility: AgreementState["visibility"],
  eventMetadata: EventMetadata,
): Check<null> {
  const from = ledger.players[fromId];
  const to = ledger.players[toId];
  if (from === undefined || to === undefined) {
    return fail("INVARIANT_VIOLATION", "An agreement party is missing from canonical state");
  }

  switch (item.kind) {
    case "money":
      return moveMoney(ledger, from, to, item.amount, eventMetadata);
    case "card":
      return moveCard(ledger, from, to, item.cardId, eventMetadata);
    case "token":
      return moveToken(ledger, from, to, item.tokenId, item.quantity);
    case "tile":
      return moveTile(ledger, from, to, item.tileId);
    case "immunity":
      return grantImmunity(ledger, to, item.rounds, round, visibility, eventMetadata);
    case "promise":
      // Recorded, never enforced. This is the whole point of the mechanic.
      return { ok: true, value: null };
    default:
      return fail(
        "ILLEGAL_ACTION",
        `Unsupported trade item kind: ${String((item as TradeItem).kind)}`,
      );
  }
}

/** Whether the actor is a live participant who may act at all. */
function requireActivePlayer(state: GameState, actorId: PlayerId): Check<PlayerState> {
  if (state.status !== "active") {
    return fail("GAME_NOT_ACTIVE", "Agreements can only be negotiated in an active game");
  }
  const player = state.players[actorId];
  if (player === undefined) {
    return fail("ACTOR_NOT_FOUND", "Actor is not a player in this game");
  }
  if (state.eliminatedPlayerIds.includes(actorId)) {
    return fail("ACTOR_NOT_AUTHORIZED", "An eliminated player cannot negotiate");
  }

  return { ok: true, value: player };
}

/**
 * An offer's id, minted from server-owned state.
 *
 * `revision` is strictly monotonic and every accepted command advances it
 * exactly once, so this is unique within the match and identical on replay —
 * and, unlike anything derived from `commandId`, it is not client-chosen.
 */
function nextAgreementId(state: GameState): string {
  return `${state.gameId}:agreement:${state.revision + 1}`;
}

/**
 * `agreement.offer` — record a multi-party offer.
 *
 * Records only. Nothing moves here: the state an offer refers to is free to
 * change before anybody answers it, which is exactly why every quantity is
 * re-validated in `respondToAgreement` instead.
 */
export function offerAgreement(
  state: GameState,
  command: OfferAgreementCommand,
  context: TransitionContext,
): TransitionResult {
  // Taken for uniformity with every other transition so `apply-command.ts` can
  // dispatch without a special case. An offer genuinely needs nothing from it:
  // it moves nothing and therefore emits no events to stamp a timestamp onto.
  void context;

  const actor = requireActivePlayer(state, command.actorId);
  if (!actor.ok) {
    return rejectCommand(state, command, actor.error);
  }

  const { recipientIds, give, receive, expiresAtRound, visibility } = command.payload;

  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An offer needs at least one recipient",
    });
  }
  if (!Array.isArray(give) || !Array.isArray(receive)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An offer needs a give and a receive list",
    });
  }
  if (visibility !== "public" && visibility !== "parties-only") {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An offer's visibility must be public or parties-only",
    });
  }
  if (!Number.isSafeInteger(expiresAtRound) || expiresAtRound < state.turn.round) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An offer must expire in the current round or later",
    });
  }

  const seen = new Set<string>();
  for (const recipientId of recipientIds) {
    if (state.players[recipientId] === undefined) {
      return rejectCommand(state, command, {
        code: "ACTOR_NOT_FOUND",
        message: "An offer recipient is not a player in this game",
      });
    }
    if (recipientId === command.actorId) {
      return rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "A player cannot offer an agreement to themselves",
      });
    }
    if (state.eliminatedPlayerIds.includes(recipientId)) {
      return rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "An eliminated player cannot be offered an agreement",
      });
    }
    if (seen.has(recipientId)) {
      return rejectCommand(state, command, {
        code: "ILLEGAL_ACTION",
        message: "An offer lists the same recipient twice",
      });
    }
    seen.add(recipientId);
  }

  const items = allItems(give, receive);
  if (items.length === 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An offer must contain at least one item",
    });
  }
  for (const item of items) {
    const validated = validateTradeItem(item, state.rules);
    if (!validated.ok) {
      return rejectCommand(state, command, validated.error);
    }
  }

  /**
   * Who owes what in an N-way transfer is not defined anywhere in the spec —
   * splitting a money leg across recipients would be an invented rounding rule —
   * so a transferable agreement is bilateral and a multi-party agreement is a
   * promise-only pact. See the return notes for the follow-up this leaves open.
   */
  if (recipientIds.length > 1 && items.some(isTransfer)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An agreement with more than one recipient may only record promises",
    });
  }

  // Authorisation, before anything is written: you may only offer what you hold.
  for (const item of give) {
    const owned = ownsOfferedItem(state, actor.value, item);
    if (!owned.ok) {
      return rejectCommand(state, command, owned.error);
    }
  }

  const agreement: AgreementState = {
    id: createStableId("AgreementId", nextAgreementId(state)),
    proposerId: command.actorId,
    recipientIds: [...recipientIds],
    give: [...give],
    receive: [...receive],
    status: "offered",
    offeredAtRound: state.turn.round,
    expiresAtRound,
    acceptedBy: [],
    visibility,
  };

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        agreements: [...state.agreements, agreement],
        lastCommandId: command.commandId,
        stateHash: null,
      },
      // No event type describes an offer yet (see the module's follow-ups), so
      // an offer changes state and emits nothing rather than borrowing an event
      // that means something else.
      events: [],
    },
  };
}

/**
 * `agreement.respond` — accept or decline an open offer.
 *
 * Only a named recipient may answer: the proposer cannot accept their own offer
 * and a third party can neither accept nor decline one. Acceptance is what
 * validates affordability, and the final acceptance settles every transfer at
 * once or rejects the command outright.
 */
export function respondToAgreement(
  state: GameState,
  command: RespondToAgreementCommand,
  context: TransitionContext,
): TransitionResult {
  const actor = requireActivePlayer(state, command.actorId);
  if (!actor.ok) {
    return rejectCommand(state, command, actor.error);
  }

  const { agreementId, accept } = command.payload;
  const agreement = state.agreements.find((candidate) => candidate.id === agreementId);
  if (agreement === undefined) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_NOT_FOUND",
      message: "No matching agreement for this agreementId",
    });
  }
  if (typeof accept !== "boolean") {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "A response must accept or decline",
    });
  }

  // Authorisation first, and before any read that could confirm the offer's
  // contents to somebody who is not party to it.
  if (!agreement.recipientIds.includes(command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Only a recipient of this agreement can respond to it",
    });
  }
  if (agreement.status !== "offered") {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This agreement is no longer open",
    });
  }
  if (state.turn.round > agreement.expiresAtRound) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This agreement has expired",
    });
  }
  if (agreement.acceptedBy.includes(command.actorId)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This player has already accepted this agreement",
    });
  }

  const items = allItems(agreement.give, agreement.receive);
  // Re-checked rather than trusted: an agreement can outlive the rules check
  // that admitted it (a legacy snapshot, a hand-built state), and honouring a
  // trade a mode has switched off would be exactly the bug the gate exists for.
  for (const item of items) {
    const validated = validateTradeItem(item, state.rules);
    if (!validated.ok) {
      return rejectCommand(state, command, validated.error);
    }
  }

  const proposer = state.players[agreement.proposerId];
  if (proposer === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Agreement proposer is missing from canonical player state",
    });
  }
  if (state.eliminatedPlayerIds.includes(agreement.proposerId)) {
    // The other half of the authorisation check: an offer is only as live as the
    // player who made it, and a knocked-out proposer cannot still be paying out.
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "The player who offered this agreement is no longer in the game",
    });
  }

  if (!accept) {
    return {
      ok: true,
      value: {
        state: {
          ...state,
          revision: state.revision + 1,
          agreements: replaceAgreement(state.agreements, { ...agreement, status: "declined" }),
          lastCommandId: command.commandId,
          stateHash: null,
        },
        events: [],
      },
    };
  }

  const acceptedBy = [...agreement.acceptedBy, command.actorId];
  if (acceptedBy.length < agreement.recipientIds.length) {
    // A multi-party pact binds only once everybody has signed; until then the
    // offer stays open and nothing has been transferred.
    return {
      ok: true,
      value: {
        state: {
          ...state,
          revision: state.revision + 1,
          agreements: replaceAgreement(state.agreements, { ...agreement, acceptedBy }),
          lastCommandId: command.commandId,
          stateHash: null,
        },
        events: [],
      },
    };
  }

  const transfers = items.filter(isTransfer);
  if (transfers.length === 0) {
    return {
      ok: true,
      value: {
        state: {
          ...state,
          revision: state.revision + 1,
          agreements: replaceAgreement(state.agreements, {
            ...agreement,
            acceptedBy,
            // Recorded, not settled: nothing changed hands, and nothing ever
            // will. A broken promise is a social fact, not an engine event.
            status: "accepted",
          }),
          lastCommandId: command.commandId,
          stateHash: null,
        },
        events: [],
      },
    };
  }

  const recipientId = agreement.recipientIds[0];
  if (recipientId === undefined || agreement.recipientIds.length !== 1) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An agreement with more than one recipient may only record promises",
    });
  }

  const ledger: Ledger = {
    players: { ...state.players },
    cards: { ...state.cards },
    tileOwnership: { ...state.tileOwnership },
    events: [],
  };
  const eventMetadata: EventMetadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + ledger.events.length + 1,
    );

  // Give first, then receive, each in authored order. Sequential rather than
  // netted so a party who can only afford their side *after* being paid still
  // fails: an agreement has to be affordable as written.
  const legs: readonly { readonly item: TradeItem; readonly from: PlayerId; readonly to: PlayerId }[] = [
    ...agreement.give.map((item) => ({
      item,
      from: agreement.proposerId,
      to: recipientId,
    })),
    ...agreement.receive.map((item) => ({
      item,
      from: recipientId,
      to: agreement.proposerId,
    })),
  ];

  for (const leg of legs) {
    const moved = transferItem(
      ledger,
      leg.item,
      leg.from,
      leg.to,
      state.turn.round,
      agreement.visibility,
      eventMetadata,
    );
    if (!moved.ok) {
      // Atomic: the ledger is discarded whole and canonical state is untouched.
      return rejectCommand(state, command, moved.error);
    }
  }

  const lastEvent = ledger.events[ledger.events.length - 1];

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent?.sequence ?? state.eventSequence,
        players: ledger.players,
        cards: ledger.cards,
        tileOwnership: ledger.tileOwnership,
        agreements: replaceAgreement(state.agreements, {
          ...agreement,
          acceptedBy,
          status: "settled",
        }),
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: ledger.events,
    },
  };
}

function replaceAgreement(
  agreements: readonly AgreementState[],
  updated: AgreementState,
): readonly AgreementState[] {
  return agreements.map((candidate) => (candidate.id === updated.id ? updated : candidate));
}

/**
 * Flips every open offer whose `expiresAtRound` is behind `round` to `expired`.
 *
 * Pure and idempotent — running it twice on the same round changes nothing —
 * and it returns the *same* state object when there is nothing to expire, so a
 * caller can cheaply tell whether a sweep did anything. Intended to be called by
 * whoever advances the round, since the engine has no clock of its own and an
 * offer must not stay acceptable forever.
 */
export function expireAgreements(state: GameState, round: number): GameState {
  const stale = state.agreements.some(
    (agreement) => agreement.status === "offered" && round > agreement.expiresAtRound,
  );
  if (!stale) {
    return state;
  }

  return {
    ...state,
    agreements: state.agreements.map((agreement) =>
      agreement.status === "offered" && round > agreement.expiresAtRound
        ? { ...agreement, status: "expired" }
        : agreement,
    ),
  };
}

/**
 * The offers `actorId` may answer right now: still open, still in date, and
 * addressed to them without their signature already on it.
 *
 * For `legal-actions.ts`, so the action list never advertises a response that
 * `respondToAgreement` would refuse.
 */
export function openAgreementsAwaiting(
  state: GameState,
  actorId: PlayerId,
): readonly AgreementState[] {
  if (state.status !== "active" || state.players[actorId] === undefined) {
    return [];
  }
  if (state.eliminatedPlayerIds.includes(actorId)) {
    return [];
  }

  return state.agreements.filter(
    (agreement) =>
      agreement.status === "offered" &&
      agreement.recipientIds.includes(actorId) &&
      !agreement.acceptedBy.includes(actorId) &&
      state.turn.round <= agreement.expiresAtRound &&
      !state.eliminatedPlayerIds.includes(agreement.proposerId),
  );
}

/**
 * Whether `actorId` could offer anything at all under the active ruleset — a
 * live player, in a live game, in a mode that records either trades or promises,
 * with somebody left to offer to.
 *
 * Whether a *particular* offer is legal is still `offerAgreement`'s decision;
 * this only keeps `legal-actions.ts` from advertising the verb in a mode that
 * has no use for it.
 */
export function canOfferAgreement(state: GameState, actorId: PlayerId): boolean {
  if (state.status !== "active" || state.players[actorId] === undefined) {
    return false;
  }
  if (state.eliminatedPlayerIds.includes(actorId)) {
    return false;
  }
  if (!state.rules.interaction.tradesEnabled && !state.rules.interaction.promisesRecorded) {
    return false;
  }

  return state.playerOrder.some(
    (playerId) => playerId !== actorId && !state.eliminatedPlayerIds.includes(playerId),
  );
}
