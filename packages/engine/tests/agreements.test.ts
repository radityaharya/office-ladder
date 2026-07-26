import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";

import { deserializeGameState, serializeGameState } from "../src";
import type {
  AgreementId,
  AgreementState,
  CommandId,
  GameState,
  ModeRules,
  OfferAgreementCommand,
  PlayerId,
  ResourceId,
  ResourceState,
  RespondToAgreementCommand,
  TokenId,
  TokenState,
  TradeItem,
} from "../src";
import {
  canOfferAgreement,
  expireAgreements,
  offerAgreement,
  openAgreementsAwaiting,
  respondToAgreement,
} from "../src/execution/agreements";
import {
  createCanonicalGameState,
  createSharedSpaceGameState,
  fixtureIds,
  sharedSpaceIds,
  sharedSpaceRules,
} from "./fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const logicalTimestamp = "2026-07-26T09:00:00.000Z";
const context = { logicalTimestamp, content: deadlineDashContent };

const { owner, hiddenOpponent, revealedOpponent } = fixtureIds;

/**
 * Recursively freezes a value. Every engine module is strict-mode ES code, so a
 * write to a frozen object throws rather than failing silently — which is what
 * turns "a transition must not mutate the state handed to it" into something a
 * test can actually observe.
 */
function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner, seen);
  }

  return Object.freeze(value);
}

function money(playerId: string, value: number, maximum: number | null = null): ResourceState {
  return {
    id: brand<ResourceId>(`${playerId}:resource:money`),
    kind: "resource.money",
    value,
    minimum: 0,
    maximum,
  };
}

function momentum(playerId: string, count: number, maximum: number): TokenState {
  return {
    id: brand<TokenId>(`${playerId}:token:momentum`),
    kind: "token.momentum",
    count,
    maximum,
  };
}

type Wallet = {
  readonly money: number;
  readonly moneyMaximum?: number | null;
  readonly momentum?: number;
  readonly momentumCap?: number;
};

function withWallet(state: GameState, playerId: PlayerId, wallet: Wallet): GameState {
  const player = state.players[playerId];
  if (player === undefined) throw new Error(`fixture missing player ${playerId}`);

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        resources: {
          ...player.resources,
          money: money(playerId, wallet.money, wallet.moneyMaximum ?? null),
        },
        tokens: {
          ...player.tokens,
          momentum: momentum(playerId, wallet.momentum ?? 0, wallet.momentumCap ?? 4),
        },
      },
    },
  };
}

/**
 * The everything-on (`mode.standard`) table with a real wallet on every seat and
 * no agreements yet. The shared-space fixture ships two agreements of its own,
 * which are useful scenery for a projection test and pure noise here, so they
 * are cleared and each test states the offer it is about.
 */
function tradeState(): GameState {
  const base: GameState = { ...createSharedSpaceGameState(), agreements: [] };
  const withMoney = withWallet(
    withWallet(withWallet(base, owner, { money: 1000, momentum: 2 }), hiddenOpponent, {
      money: 800,
    }),
    revealedOpponent,
    { money: 600 },
  );

  return withMoney;
}

function withRules(state: GameState, rules: ModeRules): GameState {
  return { ...state, rules };
}

/** `mode.standard`, with only the named interaction switches overridden. */
function interactionRules(overrides: Partial<ModeRules["interaction"]>): ModeRules {
  return {
    ...sharedSpaceRules,
    interaction: { ...sharedSpaceRules.interaction, ...overrides },
  };
}

let commandCounter = 0;

function offerCommand(
  state: GameState,
  actorId: PlayerId,
  payload: Partial<OfferAgreementCommand["payload"]> = {},
): OfferAgreementCommand {
  commandCounter += 1;

  return {
    commandId: brand<CommandId>(`command-offer-${commandCounter}`),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
    type: "agreement.offer",
    payload: {
      recipientIds: [revealedOpponent],
      give: [{ kind: "money", amount: 100 }],
      receive: [{ kind: "money", amount: 50 }],
      expiresAtRound: state.turn.round + 2,
      visibility: "public",
      ...payload,
    },
  };
}

function respondCommand(
  state: GameState,
  actorId: PlayerId,
  payload: Partial<RespondToAgreementCommand["payload"]> = {},
): RespondToAgreementCommand {
  commandCounter += 1;

  return {
    commandId: brand<CommandId>(`command-respond-${commandCounter}`),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
    type: "agreement.respond",
    payload: {
      agreementId: state.agreements[0]?.id ?? brand<AgreementId>("agreement-missing"),
      accept: true,
      ...payload,
    },
  };
}

/** Offers `payload` from `proposerId` and returns the state carrying that offer. */
function stateWithOffer(
  state: GameState,
  proposerId: PlayerId,
  payload: Partial<OfferAgreementCommand["payload"]> = {},
): GameState {
  const result = offerAgreement(state, offerCommand(state, proposerId, payload), context);
  if (!result.ok) throw new Error(`fixture offer was rejected: ${result.error.message}`);

  return result.value.state;
}

function onlyAgreement(state: GameState): AgreementState {
  const agreement = state.agreements[0];
  if (agreement === undefined) throw new Error("state carries no agreement");

  return agreement;
}

function moneyOf(state: GameState, playerId: PlayerId): number {
  const value = state.players[playerId]?.resources.money?.value;
  if (value === undefined) throw new Error(`player ${playerId} has no money resource`);

  return value;
}

describe("agreement.offer", () => {
  it("records an offer without moving anything", () => {
    const state = deepFreeze(tradeState());
    const before = moneyOf(state, owner);

    const result = offerAgreement(state, offerCommand(state, owner), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agreement = onlyAgreement(result.value.state);
    expect(agreement.status).toBe("offered");
    expect(agreement.proposerId).toBe(owner);
    expect(agreement.recipientIds).toEqual([revealedOpponent]);
    expect(agreement.acceptedBy).toEqual([]);
    expect(agreement.offeredAtRound).toBe(state.turn.round);
    // Nothing has changed hands: an offer is a record, and the money it names is
    // only checked when somebody answers it.
    expect(moneyOf(result.value.state, owner)).toBe(before);
    expect(moneyOf(result.value.state, revealedOpponent)).toBe(600);
    expect(result.value.state.revision).toBe(state.revision + 1);
    expect(result.value.state.eventSequence).toBe(state.eventSequence);
  });

  it("mints the agreement id from server-owned revision, not from the command id", () => {
    const state = deepFreeze(tradeState());

    const first = offerAgreement(state, offerCommand(state, owner), context);
    const second = offerAgreement(state, offerCommand(state, owner), context);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Two different client-chosen command ids against the same state produce the
    // same agreement id: nothing the client sends steers canonical identity.
    expect(onlyAgreement(first.value.state).id).toBe(onlyAgreement(second.value.state).id);
    expect(onlyAgreement(first.value.state).id).toContain(String(state.revision + 1));
  });

  it("lets a proposer offer money they cannot currently afford", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, { give: [{ kind: "money", amount: 999_999 }], receive: [] }),
      context,
    );

    // Affordability belongs to accept time (spec §7.3). An offer that is merely
    // optimistic is legal; it simply cannot be settled.
    expect(result.ok).toBe(true);
  });

  it("rejects a proposer who is not a player in this game", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, brand<PlayerId>("player-stranger")),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ACTOR_NOT_FOUND");
  });

  it("rejects an offer a player makes to themselves", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, { recipientIds: [owner] }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ILLEGAL_ACTION");
  });

  it("rejects a recipient who is not a player in this game", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, { recipientIds: [brand<PlayerId>("player-stranger")] }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ACTOR_NOT_FOUND");
  });

  it("rejects a duplicated recipient", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, {
        recipientIds: [revealedOpponent, revealedOpponent],
        give: [{ kind: "promise", text: "no layoffs" }],
        receive: [],
      }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ILLEGAL_ACTION");
  });

  it("rejects an offer with no items at all", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, { give: [], receive: [] }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ILLEGAL_ACTION");
  });

  it("rejects an offer that has already expired when it is made", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, { expiresAtRound: state.turn.round - 1 }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ILLEGAL_ACTION");
  });

  it("rejects a card the proposer does not hold", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, {
        // The card is in the *revealed opponent's* hand, not the proposer's.
        give: [{ kind: "card", cardId: fixtureIds.revealedOpponentHandCard }],
        receive: [],
      }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARD_NOT_AVAILABLE");
  });

  it("rejects a tile the proposer does not own", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, {
        // `sharedSpaceIds.ownedTile` belongs to the revealed opponent.
        give: [{ kind: "tile", tileId: sharedSpaceIds.ownedTile }],
        receive: [],
      }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ILLEGAL_ACTION");
  });

  it("rejects a token the proposer does not hold", () => {
    const state = tradeState();

    const result = offerAgreement(
      state,
      offerCommand(state, owner, {
        give: [{ kind: "token", tokenId: brand<TokenId>("token.nonexistent"), quantity: 1 }],
        receive: [],
      }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ILLEGAL_ACTION");
  });

  it("accepts a card and a tile the proposer really does hold", () => {
    const state = tradeState();
    const tileOwner = revealedOpponent;

    const card = offerAgreement(
      state,
      offerCommand(state, owner, {
        give: [{ kind: "card", cardId: fixtureIds.ownerHandCard }],
        receive: [],
      }),
      context,
    );
    const tile = offerAgreement(
      state,
      offerCommand(state, tileOwner, {
        recipientIds: [owner],
        give: [{ kind: "tile", tileId: sharedSpaceIds.ownedTile }],
        receive: [{ kind: "money", amount: 300 }],
      }),
      context,
    );

    expect(card.ok).toBe(true);
    expect(tile.ok).toBe(true);
  });

  it("rejects every transferable item when the mode has trades switched off", () => {
    // `mode.quick`, which is what the base fixture carries: no trades, no
    // promises. Nothing about this is a modeId comparison — the switch is read
    // straight off `state.rules`.
    const state = createCanonicalGameState();
    expect(state.rules.interaction.tradesEnabled).toBe(false);

    const result = offerAgreement(state, offerCommand(state, owner), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ILLEGAL_ACTION");
    expect(result.error.message).toContain("Trades are disabled");
  });

  it("rejects a promise when the mode does not record promises", () => {
    const state = withRules(tradeState(), interactionRules({ promisesRecorded: false }));

    const result = offerAgreement(
      state,
      offerCommand(state, owner, {
        give: [{ kind: "promise", text: "I will not sabotage your project" }],
        receive: [],
      }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Promises are not recorded");
  });

  it("allows a promise-only pact in a mode that records promises but forbids trades", () => {
    const state = withRules(
      tradeState(),
      interactionRules({ tradesEnabled: false, promisesRecorded: true }),
    );

    const promiseOnly = offerAgreement(
      state,
      offerCommand(state, owner, {
        give: [{ kind: "promise", text: "I will not sabotage your project" }],
        receive: [{ kind: "promise", text: "and I will not bid against you" }],
      }),
      context,
    );
    const withTransfer = offerAgreement(state, offerCommand(state, owner), context);

    // The two switches are independent: promises are recordable with trading
    // off, and a money leg is still refused.
    expect(promiseOnly.ok).toBe(true);
    expect(withTransfer.ok).toBe(false);
  });

  it("rejects a card item when the mode has hands switched off", () => {
    const state = withRules(tradeState(), {
      ...sharedSpaceRules,
      agency: { ...sharedSpaceRules.agency, handEnabled: false },
    });

    const result = offerAgreement(
      state,
      offerCommand(state, owner, {
        give: [{ kind: "card", cardId: fixtureIds.ownerHandCard }],
        receive: [],
      }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Hands are disabled");
  });

  it("rejects a tile item when the mode has ownership switched off", () => {
    const state = withRules(tradeState(), {
      ...sharedSpaceRules,
      board: { ...sharedSpaceRules.board, ownershipEnabled: false },
    });

    const result = offerAgreement(
      state,
      offerCommand(state, revealedOpponent, {
        recipientIds: [owner],
        give: [{ kind: "tile", tileId: sharedSpaceIds.ownedTile }],
        receive: [],
      }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Tile ownership is disabled");
  });

  it("rejects an immunity item when the mode has defence switched off", () => {
    const state = withRules(tradeState(), {
      ...sharedSpaceRules,
      conflict: { ...sharedSpaceRules.conflict, defenceEnabled: false },
    });

    const result = offerAgreement(
      state,
      offerCommand(state, owner, { give: [{ kind: "immunity", rounds: 2 }], receive: [] }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Defensive effects are disabled");
  });

  it("refuses a multi-recipient agreement that carries a transfer, and allows a promise pact", () => {
    const state = tradeState();

    const withTransfer = offerAgreement(
      state,
      offerCommand(state, owner, {
        recipientIds: [hiddenOpponent, revealedOpponent],
        give: [{ kind: "money", amount: 100 }],
        receive: [],
      }),
      context,
    );
    const pact = offerAgreement(
      state,
      offerCommand(state, owner, {
        recipientIds: [hiddenOpponent, revealedOpponent],
        give: [{ kind: "promise", text: "nobody bids on the corner office" }],
        receive: [],
      }),
      context,
    );

    expect(withTransfer.ok).toBe(false);
    expect(pact.ok).toBe(true);
  });

  it("rejects malformed quantities", () => {
    const state = tradeState();
    const malformed: readonly TradeItem[] = [
      { kind: "money", amount: 0 },
      { kind: "money", amount: -50 },
      { kind: "money", amount: 1.5 },
      { kind: "immunity", rounds: 0 },
      { kind: "token", tokenId: brand<TokenId>("momentum"), quantity: -1 },
      { kind: "promise", text: "" },
    ];

    for (const item of malformed) {
      const result = offerAgreement(
        state,
        offerCommand(state, owner, { give: [item], receive: [] }),
        context,
      );
      expect(result.ok, `${item.kind} should be refused`).toBe(false);
    }
  });
});

describe("agreement.respond — authorisation", () => {
  it("refuses a third party who is neither proposer nor recipient", () => {
    const state = deepFreeze(stateWithOffer(tradeState(), owner));

    const accept = respondToAgreement(state, respondCommand(state, hiddenOpponent), context);
    const decline = respondToAgreement(
      state,
      respondCommand(state, hiddenOpponent, { accept: false }),
      context,
    );

    expect(accept.ok).toBe(false);
    expect(decline.ok).toBe(false);
    if (accept.ok || decline.ok) return;
    expect(accept.error.code).toBe("ACTOR_NOT_AUTHORIZED");
    expect(decline.error.code).toBe("ACTOR_NOT_AUTHORIZED");
  });

  it("refuses the proposer, who can neither accept nor cancel their own offer", () => {
    const state = deepFreeze(stateWithOffer(tradeState(), owner));

    const accept = respondToAgreement(state, respondCommand(state, owner), context);
    const cancel = respondToAgreement(
      state,
      respondCommand(state, owner, { accept: false }),
      context,
    );

    expect(accept.ok).toBe(false);
    expect(cancel.ok).toBe(false);
    if (accept.ok || cancel.ok) return;
    expect(accept.error.code).toBe("ACTOR_NOT_AUTHORIZED");
    expect(cancel.error.code).toBe("ACTOR_NOT_AUTHORIZED");
  });

  it("cannot be used to spend another player's money", () => {
    // The recipient is asked for 50; the *hidden opponent* tries to answer, which
    // is the whole shape of the attack §6.3 is about.
    const state = stateWithOffer(tradeState(), owner);
    const before = moneyOf(state, revealedOpponent);

    const result = respondToAgreement(state, respondCommand(state, hiddenOpponent), context);

    expect(result.ok).toBe(false);
    expect(moneyOf(state, revealedOpponent)).toBe(before);
  });

  it("refuses to settle an offer whose proposer has left the game", () => {
    const offered = stateWithOffer(tradeState(), owner);
    const withoutProposer: GameState = { ...offered, eliminatedPlayerIds: [owner] };

    const result = respondToAgreement(
      withoutProposer,
      respondCommand(withoutProposer, revealedOpponent),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ILLEGAL_ACTION");
    expect(openAgreementsAwaiting(withoutProposer, revealedOpponent)).toEqual([]);
  });

  it("refuses a response to an agreement that does not exist", () => {
    const state = tradeState();

    const result = respondToAgreement(
      state,
      respondCommand(state, revealedOpponent, {
        agreementId: brand<AgreementId>("agreement-nope"),
      }),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DECISION_POINT_NOT_FOUND");
  });

  it("refuses a second response from a recipient who already accepted", () => {
    const offered = stateWithOffer(tradeState(), owner, {
      recipientIds: [hiddenOpponent, revealedOpponent],
      give: [{ kind: "promise", text: "a truce" }],
      receive: [],
    });
    const once = respondToAgreement(offered, respondCommand(offered, hiddenOpponent), context);
    expect(once.ok).toBe(true);
    if (!once.ok) return;

    const twice = respondToAgreement(
      once.value.state,
      respondCommand(once.value.state, hiddenOpponent),
      context,
    );

    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.error.code).toBe("ILLEGAL_ACTION");
  });

  it("refuses a response to an agreement that is already settled", () => {
    const offered = stateWithOffer(tradeState(), owner);
    const settled = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;

    const again = respondToAgreement(
      settled.value.state,
      respondCommand(settled.value.state, revealedOpponent),
      context,
    );

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.message).toContain("no longer open");
  });
});

describe("agreement.respond — settlement", () => {
  it("moves money both ways atomically and marks the agreement settled", () => {
    const offered = deepFreeze(stateWithOffer(tradeState(), owner));

    const result = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value.state;
    expect(moneyOf(next, owner)).toBe(1000 - 100 + 50);
    expect(moneyOf(next, revealedOpponent)).toBe(600 + 100 - 50);
    const agreement = onlyAgreement(next);
    expect(agreement.status).toBe("settled");
    expect(agreement.acceptedBy).toEqual([revealedOpponent]);
    expect(next.revision).toBe(offered.revision + 1);
  });

  it("emits a ResourceChanged event for every side of every money leg", () => {
    const offered = stateWithOffer(tradeState(), owner);

    const result = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changed = result.value.events.filter((event) => event.type === "ResourceChanged");
    expect(changed).toHaveLength(4);
    expect(changed.every((event) => event.payload.reason === "agreement-settlement")).toBe(true);
    // Sequence numbers continue the game's own counter, contiguously.
    expect(changed.map((event) => event.sequence)).toEqual([
      offered.eventSequence + 1,
      offered.eventSequence + 2,
      offered.eventSequence + 3,
      offered.eventSequence + 4,
    ]);
    expect(result.value.state.eventSequence).toBe(offered.eventSequence + 4);
  });

  it("refuses a settlement the paying player cannot afford, and moves nothing", () => {
    const poor = withWallet(tradeState(), owner, { money: 10 });
    const offered = deepFreeze(stateWithOffer(poor, owner));

    const result = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INSUFFICIENT_RESOURCE");
    expect(moneyOf(offered, owner)).toBe(10);
    expect(moneyOf(offered, revealedOpponent)).toBe(600);
    expect(onlyAgreement(offered).status).toBe("offered");
  });

  it("refuses a stale offer once the state it referenced has changed", () => {
    const rich = tradeState();
    const offered = stateWithOffer(rich, owner, {
      give: [{ kind: "money", amount: 900 }],
      receive: [{ kind: "money", amount: 1 }],
    });
    // The proposer spends the money between offering and being answered. The
    // offer is still "offered" and still in date — only affordability changed.
    const drained = withWallet(offered, owner, { money: 50 });

    const result = respondToAgreement(drained, respondCommand(drained, revealedOpponent), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INSUFFICIENT_RESOURCE");
    expect(moneyOf(drained, revealedOpponent)).toBe(600);
  });

  it("refuses the whole trade when one leg fails, leaving the earlier legs undone", () => {
    const offered = stateWithOffer(tradeState(), owner, {
      give: [{ kind: "money", amount: 100 }],
      // The recipient is asked for a card that is in somebody else's hand, so the
      // second leg cannot settle after the first already "moved" money.
      receive: [{ kind: "card", cardId: fixtureIds.hiddenOpponentHandCard }],
    });

    const result = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARD_NOT_AVAILABLE");
    expect(moneyOf(offered, owner)).toBe(1000);
    expect(moneyOf(offered, revealedOpponent)).toBe(600);
    expect(onlyAgreement(offered).status).toBe("offered");
  });

  it("declines without transferring anything", () => {
    const offered = deepFreeze(stateWithOffer(tradeState(), owner));

    const result = respondToAgreement(
      offered,
      respondCommand(offered, revealedOpponent, { accept: false }),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(onlyAgreement(result.value.state).status).toBe("declined");
    expect(moneyOf(result.value.state, owner)).toBe(1000);
    expect(moneyOf(result.value.state, revealedOpponent)).toBe(600);
    expect(result.value.events).toEqual([]);
  });

  it("transfers a card, updating both hands and the card's owner", () => {
    const offered = stateWithOffer(tradeState(), owner, {
      give: [{ kind: "card", cardId: fixtureIds.ownerHandCard }],
      receive: [{ kind: "money", amount: 200 }],
    });

    const result = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value.state;
    expect(next.cards[fixtureIds.ownerHandCard]?.ownerId).toBe(revealedOpponent);
    expect(next.players[owner]?.hand).not.toContain(fixtureIds.ownerHandCard);
    expect(next.players[revealedOpponent]?.hand).toContain(fixtureIds.ownerHandCard);
    expect(moneyOf(next, owner)).toBe(1200);
    expect(result.value.events.some((event) => event.type === "CardStored")).toBe(true);
  });

  it("transfers tile ownership while preserving the tile's own record", () => {
    const base = tradeState();
    const offered = stateWithOffer(base, revealedOpponent, {
      recipientIds: [owner],
      give: [{ kind: "tile", tileId: sharedSpaceIds.ownedTile }],
      receive: [{ kind: "money", amount: 300 }],
    });

    const result = respondToAgreement(offered, respondCommand(offered, owner), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ownership = result.value.state.tileOwnership[sharedSpaceIds.ownedTile];
    expect(ownership?.ownerId).toBe(owner);
    // The improvement travels with the tile; it is the tile's history, not the
    // seller's.
    expect(ownership?.level).toBe(1);
    expect(ownership?.claimedAtRound).toBe(1);
    expect(moneyOf(result.value.state, owner)).toBe(700);
  });

  it("transfers tokens and refuses one that would breach the receiver's cap", () => {
    const base = withWallet(withWallet(tradeState(), owner, { money: 1000, momentum: 2 }), revealedOpponent, {
      money: 600,
      momentum: 4,
      momentumCap: 4,
    });
    const overCap = stateWithOffer(base, owner, {
      give: [{ kind: "token", tokenId: brand<TokenId>("momentum"), quantity: 1 }],
      receive: [],
    });

    const refused = respondToAgreement(overCap, respondCommand(overCap, revealedOpponent), context);

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("TOKEN_LIMIT_EXCEEDED");

    const room = withWallet(base, revealedOpponent, { money: 600, momentum: 1, momentumCap: 4 });
    const offered = stateWithOffer(room, owner, {
      give: [{ kind: "token", tokenId: brand<TokenId>("momentum"), quantity: 2 }],
      receive: [],
    });
    const settled = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);

    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.value.state.players[owner]?.tokens.momentum?.count).toBe(0);
    expect(settled.value.state.players[revealedOpponent]?.tokens.momentum?.count).toBe(3);
  });

  it("refuses a token transfer the giver cannot cover", () => {
    const base = withWallet(tradeState(), owner, { money: 1000, momentum: 1 });
    const offered = stateWithOffer(base, owner, {
      give: [{ kind: "token", tokenId: brand<TokenId>("momentum"), quantity: 1 }],
      receive: [],
    });
    const drained = withWallet(offered, owner, { money: 1000, momentum: 0 });

    const result = respondToAgreement(drained, respondCommand(drained, revealedOpponent), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INSUFFICIENT_RESOURCE");
  });

  it("grants immunity as a status on the receiver, private when the deal is parties-only", () => {
    const base = tradeState();
    const publicOffer = stateWithOffer(base, owner, {
      give: [{ kind: "immunity", rounds: 3 }],
      receive: [{ kind: "money", amount: 100 }],
      visibility: "public",
    });
    const privateOffer = stateWithOffer(base, owner, {
      give: [{ kind: "immunity", rounds: 3 }],
      receive: [{ kind: "money", amount: 100 }],
      visibility: "parties-only",
    });

    const open = respondToAgreement(
      publicOffer,
      respondCommand(publicOffer, revealedOpponent),
      context,
    );
    const sealed = respondToAgreement(
      privateOffer,
      respondCommand(privateOffer, revealedOpponent),
      context,
    );

    expect(open.ok && sealed.ok).toBe(true);
    if (!open.ok || !sealed.ok) return;
    const granted = open.value.state.players[revealedOpponent]?.statuses.find(
      (status) => status.id === "status.trade-immunity",
    );
    expect(granted?.visibility).toBe("public");
    expect(granted?.expiresAtRound).toBe(base.turn.round + 3);
    const hidden = sealed.value.state.players[revealedOpponent]?.statuses.find(
      (status) => status.id === "status.trade-immunity",
    );
    // A parties-only deal must not advertise itself through a public status.
    expect(hidden?.visibility).toBe("private");
    expect(open.value.events.some((event) => event.type === "StatusApplied")).toBe(true);
  });

  it("refuses to settle an agreement whose mode has since disallowed its items", () => {
    const offered = stateWithOffer(tradeState(), owner);
    const disabled = withRules(offered, interactionRules({ tradesEnabled: false }));

    const result = respondToAgreement(disabled, respondCommand(disabled, revealedOpponent), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Trades are disabled");
  });
});

describe("agreement promises", () => {
  it("records a promise and never enforces it", () => {
    const promise = "I will not bid against you on the corner office";
    const offered = stateWithOffer(tradeState(), owner, {
      give: [{ kind: "money", amount: 100 }],
      receive: [{ kind: "promise", text: promise }],
    });
    const beforeRecipient = moneyOf(offered, revealedOpponent);

    const result = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value.state;
    // The money leg is enforced; the promise leg costs the promiser exactly
    // nothing, now or ever. Betrayal is the mechanic, not a bug.
    expect(moneyOf(next, owner)).toBe(900);
    expect(moneyOf(next, revealedOpponent)).toBe(beforeRecipient + 100);
    expect(onlyAgreement(next).receive).toEqual([{ kind: "promise", text: promise }]);
    expect(next.players[revealedOpponent]?.statuses).toEqual(
      offered.players[revealedOpponent]?.statuses,
    );
  });

  it("marks a promise-only agreement accepted rather than settled", () => {
    const offered = stateWithOffer(tradeState(), owner, {
      give: [{ kind: "promise", text: "no sabotage this quarter" }],
      receive: [],
    });

    const result = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(onlyAgreement(result.value.state).status).toBe("accepted");
    expect(result.value.events).toEqual([]);
  });

  it("binds a multi-party pact only once every recipient has signed", () => {
    const offered = stateWithOffer(tradeState(), owner, {
      recipientIds: [hiddenOpponent, revealedOpponent],
      give: [{ kind: "promise", text: "nobody blocks anybody's promotion" }],
      receive: [],
    });

    const first = respondToAgreement(offered, respondCommand(offered, hiddenOpponent), context);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(onlyAgreement(first.value.state).status).toBe("offered");
    expect(onlyAgreement(first.value.state).acceptedBy).toEqual([hiddenOpponent]);

    const second = respondToAgreement(
      first.value.state,
      respondCommand(first.value.state, revealedOpponent),
      context,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(onlyAgreement(second.value.state).status).toBe("accepted");
    expect(onlyAgreement(second.value.state).acceptedBy).toEqual([
      hiddenOpponent,
      revealedOpponent,
    ]);
  });

  it("kills a multi-party pact the moment one recipient declines", () => {
    const offered = stateWithOffer(tradeState(), owner, {
      recipientIds: [hiddenOpponent, revealedOpponent],
      give: [{ kind: "promise", text: "nobody blocks anybody's promotion" }],
      receive: [],
    });

    const result = respondToAgreement(
      offered,
      respondCommand(offered, revealedOpponent, { accept: false }),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(onlyAgreement(result.value.state).status).toBe("declined");
  });
});

describe("agreement expiry", () => {
  it("refuses an acceptance after the offer's expiry round has passed", () => {
    const offered = stateWithOffer(tradeState(), owner, { expiresAtRound: 3 });
    const later: GameState = { ...offered, turn: { ...offered.turn, round: 4 } };

    const onTime = respondToAgreement(
      { ...offered, turn: { ...offered.turn, round: 3 } },
      respondCommand(offered, revealedOpponent),
      context,
    );
    const tooLate = respondToAgreement(later, respondCommand(later, revealedOpponent), context);

    expect(onTime.ok).toBe(true);
    expect(tooLate.ok).toBe(false);
    if (tooLate.ok) return;
    expect(tooLate.error.message).toContain("expired");
  });

  it("sweeps stale offers to expired, idempotently", () => {
    const offered = stateWithOffer(tradeState(), owner, { expiresAtRound: 3 });

    const untouched = expireAgreements(offered, 3);
    const swept = expireAgreements(offered, 4);
    const sweptAgain = expireAgreements(swept, 5);

    // Nothing to do returns the very same object, so a caller can tell a no-op
    // sweep from a real one without a deep compare.
    expect(untouched).toBe(offered);
    expect(onlyAgreement(swept).status).toBe("expired");
    expect(onlyAgreement(sweptAgain).status).toBe("expired");
    expect(sweptAgain).toBe(swept);
  });

  it("leaves settled and declined agreements alone when sweeping", () => {
    const offered = stateWithOffer(tradeState(), owner, { expiresAtRound: 3 });
    const settled = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;

    const swept = expireAgreements(settled.value.state, 99);

    expect(onlyAgreement(swept).status).toBe("settled");
  });
});

describe("agreement legal-action helpers", () => {
  it("lists only the offers a player may actually answer", () => {
    const offered = stateWithOffer(tradeState(), owner);

    expect(openAgreementsAwaiting(offered, revealedOpponent)).toHaveLength(1);
    // The proposer is not a recipient, and a bystander is not either.
    expect(openAgreementsAwaiting(offered, owner)).toEqual([]);
    expect(openAgreementsAwaiting(offered, hiddenOpponent)).toEqual([]);
    expect(
      openAgreementsAwaiting({ ...offered, turn: { ...offered.turn, round: 99 } }, revealedOpponent),
    ).toEqual([]);
  });

  it("hides the verb entirely in a mode with neither trades nor promises", () => {
    const enabled = tradeState();
    const disabled = withRules(
      enabled,
      interactionRules({ tradesEnabled: false, promisesRecorded: false }),
    );

    expect(canOfferAgreement(enabled, owner)).toBe(true);
    expect(canOfferAgreement(disabled, owner)).toBe(false);
    expect(canOfferAgreement(enabled, brand<PlayerId>("player-stranger"))).toBe(false);
  });
});

describe("agreement determinism", () => {
  it("survives a JSON round trip unchanged", () => {
    const offered = stateWithOffer(tradeState(), owner, {
      give: [{ kind: "money", amount: 100 }, { kind: "immunity", rounds: 2 }],
      receive: [{ kind: "promise", text: "and we never speak of it" }],
      visibility: "parties-only",
    });
    const settled = respondToAgreement(offered, respondCommand(offered, revealedOpponent), context);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;

    const restored = deserializeGameState(serializeGameState(settled.value.state));

    expect(restored).toEqual(settled.value.state);
    // The jsonb boundary the repository actually uses, too.
    expect(JSON.parse(JSON.stringify(settled.value.state))).toEqual(settled.value.state);
    expect(restored.agreements[0]?.status).toBe("settled");
  });

  it("produces the same result twice and never mutates the state handed to it", () => {
    const offered = deepFreeze(stateWithOffer(tradeState(), owner));
    const command = respondCommand(offered, revealedOpponent);

    const first = respondToAgreement(offered, command, context);
    const second = respondToAgreement(offered, command, context);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.state).toEqual(second.value.state);
    expect(first.value.events).toEqual(second.value.events);
  });

  it("refuses to negotiate in a game that is not active", () => {
    const ended: GameState = { ...tradeState(), status: "ended" };

    const result = offerAgreement(ended, offerCommand(ended, owner), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("GAME_NOT_ACTIVE");
  });

  it("refuses an eliminated player on either side", () => {
    const base = tradeState();
    const eliminatedProposer: GameState = { ...base, eliminatedPlayerIds: [owner] };
    const eliminatedRecipient: GameState = { ...base, eliminatedPlayerIds: [revealedOpponent] };

    const asProposer = offerAgreement(
      eliminatedProposer,
      offerCommand(eliminatedProposer, owner),
      context,
    );
    const asRecipient = offerAgreement(
      eliminatedRecipient,
      offerCommand(eliminatedRecipient, owner),
      context,
    );

    expect(asProposer.ok).toBe(false);
    expect(asRecipient.ok).toBe(false);
  });
});
