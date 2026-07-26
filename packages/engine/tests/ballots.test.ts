import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";

import {
  deserializeGameState,
  projectPlayerView,
  projectPublicView,
  serializeGameState,
  stableStringify,
} from "../src";
import type {
  BallotId,
  BallotState,
  CastBallotCommand,
  CommandId,
  DecisionPointId,
  ExpireWindowCommand,
  GameState,
  JsonValue,
  PlayerId,
  ResourceId,
  TransitionResult,
} from "../src";
import {
  ballotKindEnabled,
  castBallot,
  entitledVoters,
  expireBallot,
  findBallot,
  isBallotDecisionPoint,
  isSeatedActor,
  openBallot,
  openBallotsForPlayer,
  resolveBallot,
  validateBallotCast,
} from "../src/execution/ballots";
import { createSharedSpaceGameState, fixtureIds } from "./fixtures";
import { logicalTimestamp, withRules } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const VOTE_ID = brand<BallotId>("ballot-under-test-vote");
const AUCTION_ID = brand<BallotId>("ballot-under-test-auction");

/**
 * The scheduler's identity. `window.expire` is server-injected (spec §7.1) and
 * the only handle a pure engine has on "not a player" is that no seat owns the
 * id, so every legitimate expiry in these tests arrives under one that isn't in
 * `state.players`.
 */
const SERVER_ACTOR = brand<PlayerId>("server-scheduler");

const { owner, hiddenOpponent, revealedOpponent } = fixtureIds;

function context(timestamp = logicalTimestamp) {
  return { logicalTimestamp: timestamp, content: deadlineDashContent };
}

/**
 * The shared-space fixture with the two pre-baked ballots removed and every
 * player given real money, so an auction has something to move. The fixture
 * carries `mode.standard`, which has both ballot switches on.
 */
function ballotState(
  money: Readonly<Partial<Record<PlayerId, number>>> = {},
): GameState {
  const state = createSharedSpaceGameState();
  const withMoney = Object.fromEntries(
    state.playerOrder.map((playerId) => {
      const player = state.players[playerId];

      return [
        playerId,
        {
          ...player,
          resources: {
            ...player.resources,
            money: {
              id: brand<ResourceId>(`resource-${String(playerId)}-money`),
              kind: "resource.money" as const,
              value: money[playerId] ?? 1000,
              minimum: 0,
              maximum: null,
            },
          },
        },
      ];
    }),
  );

  return { ...state, players: withMoney, ballots: [] };
}

function vote(overrides: Partial<BallotState> = {}): BallotState {
  return {
    id: VOTE_ID,
    kind: "vote",
    subjectId: "vote.block-promotion",
    subject: { targetPlayerId: owner, options: ["for", "against"] },
    audience: [owner, hiddenOpponent, revealedOpponent],
    castBy: {},
    deadlineAt: "2026-07-18T10:05:00.000Z",
    closesAtRound: 4,
    visibility: "open",
    resolution: null,
    ...overrides,
  };
}

function auction(overrides: Partial<BallotState> = {}): BallotState {
  return {
    id: AUCTION_ID,
    kind: "auction",
    subjectId: "auction.corner-office",
    subject: { tileId: "tile-5", minBid: 100 },
    audience: [owner, hiddenOpponent, revealedOpponent],
    castBy: {},
    deadlineAt: "2026-07-18T10:05:00.000Z",
    closesAtRound: 4,
    visibility: "sealed",
    resolution: null,
    ...overrides,
  };
}

function withBallot(state: GameState, ballot: BallotState): GameState {
  return { ...state, ballots: [ballot] };
}

function castCommand(
  state: GameState,
  actorId: PlayerId,
  ballotId: BallotId,
  value: JsonValue,
  commandId = `command-cast-${String(actorId)}`,
): CastBallotCommand {
  return {
    commandId: brand<CommandId>(commandId),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
    type: "ballot.cast",
    payload: { ballotId, value },
  };
}

function expireCommand(
  state: GameState,
  decisionPointId: string,
  actorId: PlayerId = SERVER_ACTOR,
  commandId = "command-expire",
): ExpireWindowCommand {
  return {
    commandId: brand<CommandId>(commandId),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
    type: "window.expire",
    payload: { decisionPointId: brand<DecisionPointId>(decisionPointId) },
  };
}

function accepted(result: TransitionResult): {
  readonly state: GameState;
  readonly events: readonly { readonly type: string }[];
} {
  if (!result.ok) throw new Error(`expected acceptance, got ${result.error.message}`);

  return { state: result.value.state, events: result.value.events };
}

function rejection(result: TransitionResult): string {
  if (result.ok) throw new Error("expected the command to be rejected");

  return result.error.code;
}

function money(state: GameState, playerId: PlayerId): number {
  return state.players[playerId].resources.money.value;
}

function resolutionOf(state: GameState, ballotId: BallotId): Record<string, JsonValue> {
  const ballot = findBallot(state, ballotId);
  if (ballot === null || ballot.resolution === null) {
    throw new Error("expected a closed ballot");
  }

  return ballot.resolution as Record<string, JsonValue>;
}

/**
 * Recursively freezes, so that any in-place write throws (every engine module is
 * an ES module and therefore strict-mode code) rather than silently succeeding.
 * Mirrors `purity-replay.test.ts`.
 */
function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner, seen);
  }

  return Object.freeze(value);
}

describe("ballot.cast — votes", () => {
  it("Given an open vote, When every voter has cast, Then the ballot closes on the last cast and records the winning option", () => {
    const state = withBallot(ballotState(), vote());

    const first = accepted(castBallot(state, castCommand(state, owner, VOTE_ID, "for"), context()));
    expect(findBallot(first.state, VOTE_ID)?.resolution).toBeNull();

    const second = accepted(
      castBallot(first.state, castCommand(first.state, hiddenOpponent, VOTE_ID, "against"), context()),
    );
    expect(findBallot(second.state, VOTE_ID)?.resolution).toBeNull();

    const third = accepted(
      castBallot(second.state, castCommand(second.state, revealedOpponent, VOTE_ID, "against"), context()),
    );

    const resolution = resolutionOf(third.state, VOTE_ID);
    expect(resolution.kind).toBe("vote");
    expect(resolution.closedBy).toBe("all-cast");
    expect(resolution.winningOption).toBe("against");
    expect(resolution.tieBrokenBy).toBeNull();
    expect(resolution.abstainedPlayerIds).toEqual([]);
    expect(resolution.tally).toEqual([
      { option: "against", count: 2, firstCastByPlayerId: hiddenOpponent },
      { option: "for", count: 1, firstCastByPlayerId: owner },
    ]);
    // A vote moves no money.
    expect(money(third.state, owner)).toBe(1000);
  });

  it("Given a tied vote, When it closes, Then the tie is broken by playerOrder and the resolution says so", () => {
    // owner votes "for", hiddenOpponent votes "against": 1–1. owner sits first
    // in playerOrder, so "for" takes it.
    const state = withBallot(
      ballotState(),
      vote({ audience: [owner, hiddenOpponent] }),
    );

    const first = accepted(castBallot(state, castCommand(state, owner, VOTE_ID, "for"), context()));
    const closed = accepted(
      castBallot(first.state, castCommand(first.state, hiddenOpponent, VOTE_ID, "against"), context()),
    );

    const resolution = resolutionOf(closed.state, VOTE_ID);
    expect(resolution.winningOption).toBe("for");
    expect(resolution.tieBrokenBy).toBe("player-order");
  });

  it("Given the same tie cast in the opposite order, When it closes, Then playerOrder still decides it — not who cast first", () => {
    const state = withBallot(ballotState(), vote({ audience: [owner, hiddenOpponent] }));

    const first = accepted(
      castBallot(state, castCommand(state, hiddenOpponent, VOTE_ID, "against"), context()),
    );
    const closed = accepted(
      castBallot(first.state, castCommand(first.state, owner, VOTE_ID, "for"), context()),
    );

    expect(resolutionOf(closed.state, VOTE_ID).winningOption).toBe("for");
  });

  it("Given a vote nobody answered, When the deadline expires, Then it closes with no winner and everyone recorded as abstaining", () => {
    const state = withBallot(ballotState(), vote());

    const closed = accepted(expireBallot(state, expireCommand(state, VOTE_ID), context()));

    const resolution = resolutionOf(closed.state, VOTE_ID);
    expect(resolution.winningOption).toBeNull();
    expect(resolution.closedBy).toBe("expired");
    expect(resolution.tally).toEqual([]);
    expect(resolution.abstainedPlayerIds).toEqual([owner, hiddenOpponent, revealedOpponent]);
  });
});

describe("ballot.cast — authorisation (spec §6.3)", () => {
  it("Given a player outside the audience, When they cast, Then it is rejected and no cast is recorded", () => {
    const state = withBallot(ballotState(), vote({ audience: [owner, hiddenOpponent] }));

    const result = castBallot(
      state,
      castCommand(state, revealedOpponent, VOTE_ID, "for"),
      context(),
    );

    expect(rejection(result)).toBe("ACTOR_NOT_AUTHORIZED");
    expect(findBallot(state, VOTE_ID)?.castBy).toEqual({});
  });

  it("Given an eliminated player still listed in the audience, When they cast, Then it is rejected", () => {
    const base = ballotState();
    const state = withBallot(
      { ...base, eliminatedPlayerIds: [hiddenOpponent] },
      vote(),
    );

    expect(
      rejection(castBallot(state, castCommand(state, hiddenOpponent, VOTE_ID, "for"), context())),
    ).toBe("ACTOR_NOT_AUTHORIZED");
  });

  it("Given an eliminated audience member, When the remaining voters all cast, Then the ballot still closes rather than waiting for them", () => {
    const base = ballotState();
    const state = withBallot({ ...base, eliminatedPlayerIds: [revealedOpponent] }, vote());

    const first = accepted(castBallot(state, castCommand(state, owner, VOTE_ID, "for"), context()));
    const closed = accepted(
      castBallot(first.state, castCommand(first.state, hiddenOpponent, VOTE_ID, "for"), context()),
    );

    expect(resolutionOf(closed.state, VOTE_ID).closedBy).toBe("all-cast");
  });

  it("Given a cast, When it is recorded, Then it is filed under the actor and no other player's slot is written", () => {
    // The structural half of "a ballot must not let me cast your vote": the
    // payload carries no player id at all, so there is no field an attacker
    // could aim at someone else's slot.
    const state = withBallot(ballotState(), vote());

    const cast = accepted(castBallot(state, castCommand(state, hiddenOpponent, VOTE_ID, "for"), context()));

    expect(Object.keys(findBallot(cast.state, VOTE_ID)?.castBy ?? {})).toEqual([hiddenOpponent]);
  });

  it("Given a player who has already cast, When they cast again, Then it is rejected and their first answer stands", () => {
    const state = withBallot(ballotState(), vote());

    const first = accepted(castBallot(state, castCommand(state, owner, VOTE_ID, "for"), context()));
    const second = castBallot(
      first.state,
      castCommand(first.state, owner, VOTE_ID, "against", "command-cast-again"),
      context(),
    );

    expect(rejection(second)).toBe("ILLEGAL_ACTION");
    expect(findBallot(first.state, VOTE_ID)?.castBy[owner]).toBe("for");
  });

  it("Given a closed ballot, When someone casts into it, Then it is rejected as stale", () => {
    const state = withBallot(
      ballotState(),
      vote({ castBy: { [owner]: "for" }, resolution: { kind: "vote", winningOption: "for" } }),
    );

    expect(
      rejection(castBallot(state, castCommand(state, hiddenOpponent, VOTE_ID, "for"), context())),
    ).toBe("DECISION_POINT_STALE");
  });

  it("Given a ballotId that names nothing, When it is cast into, Then it is rejected as not found", () => {
    const state = withBallot(ballotState(), vote());

    expect(
      rejection(
        castBallot(state, castCommand(state, owner, brand<BallotId>("ballot-missing"), "for"), context()),
      ),
    ).toBe("DECISION_POINT_NOT_FOUND");
  });

  it("Given a value outside the authored options, When it is cast, Then it is rejected", () => {
    const state = withBallot(ballotState(), vote());

    expect(
      rejection(castBallot(state, castCommand(state, owner, VOTE_ID, "abstain"), context())),
    ).toBe("ILLEGAL_ACTION");
  });

  it("Given a vote with no authored options, When a free-form string is cast, Then it is accepted", () => {
    const state = withBallot(ballotState(), vote({ subject: { targetPlayerId: owner } }));

    const cast = accepted(castBallot(state, castCommand(state, owner, VOTE_ID, "anything"), context()));

    expect(findBallot(cast.state, VOTE_ID)?.castBy[owner]).toBe("anything");
  });

  it("Given a non-string vote value, When it is cast, Then it is rejected", () => {
    const state = withBallot(ballotState(), vote({ subject: { targetPlayerId: owner } }));

    expect(rejection(castBallot(state, castCommand(state, owner, VOTE_ID, 7), context()))).toBe(
      "ILLEGAL_ACTION",
    );
  });

  it("Given a game that is not active, When a ballot is cast, Then it is rejected", () => {
    const state = { ...withBallot(ballotState(), vote()), status: "ended" as const };

    expect(rejection(castBallot(state, castCommand(state, owner, VOTE_ID, "for"), context()))).toBe(
      "GAME_NOT_ACTIVE",
    );
  });
});

describe("ballot.cast — mode gating (spec §4)", () => {
  it("Given a mode with votes disabled, When a vote is cast, Then it is rejected and the ballot is untouched", () => {
    const state = withRules(withBallot(ballotState(), vote()), {
      interaction: { votesEnabled: false },
    });

    expect(rejection(castBallot(state, castCommand(state, owner, VOTE_ID, "for"), context()))).toBe(
      "ILLEGAL_ACTION",
    );
    expect(findBallot(state, VOTE_ID)?.castBy).toEqual({});
  });

  it("Given a mode with auctions disabled, When a bid is cast, Then it is rejected", () => {
    const state = withRules(withBallot(ballotState(), auction()), {
      interaction: { auctionsEnabled: false },
    });

    expect(rejection(castBallot(state, castCommand(state, owner, AUCTION_ID, 200), context()))).toBe(
      "ILLEGAL_ACTION",
    );
  });

  it("Given votes disabled but auctions enabled, When each kind is checked, Then only the matching switch answers", () => {
    const rules = withRules(ballotState(), {
      interaction: { votesEnabled: false, auctionsEnabled: true },
    }).rules;

    expect(ballotKindEnabled(rules, "vote")).toBe(false);
    expect(ballotKindEnabled(rules, "auction")).toBe(true);
  });

  it("Given the Quick preset, which has both switches off, When a ballot is cast, Then it is rejected — no modeId comparison anywhere", () => {
    const quick = withRules(withBallot(ballotState(), vote()), {
      interaction: { votesEnabled: false, auctionsEnabled: false },
    });

    expect(rejection(castBallot(quick, castCommand(quick, owner, VOTE_ID, "for"), context()))).toBe(
      "ILLEGAL_ACTION",
    );
  });

  it("Given a disabled ballot kind, When its deadline expires, Then it still closes — closing is cleanup, not play", () => {
    const state = withRules(withBallot(ballotState(), vote({ castBy: { [owner]: "for" } })), {
      interaction: { votesEnabled: false },
    });

    const closed = accepted(expireBallot(state, expireCommand(state, VOTE_ID), context()));

    expect(resolutionOf(closed.state, VOTE_ID).winningOption).toBe("for");
  });
});

describe("ballot.cast — auctions", () => {
  it("Given a sealed auction, When every bid is in, Then the highest bidder wins and is charged exactly their bid", () => {
    const state = withBallot(ballotState({ [hiddenOpponent]: 900 }), auction());

    const a = accepted(castBallot(state, castCommand(state, owner, AUCTION_ID, 300), context()));
    const b = accepted(
      castBallot(a.state, castCommand(a.state, hiddenOpponent, AUCTION_ID, 750), context()),
    );
    const closed = accepted(
      castBallot(b.state, castCommand(b.state, revealedOpponent, AUCTION_ID, 0), context()),
    );

    const resolution = resolutionOf(closed.state, AUCTION_ID);
    expect(resolution.kind).toBe("auction");
    expect(resolution.closedBy).toBe("all-cast");
    expect(resolution.winnerPlayerId).toBe(hiddenOpponent);
    expect(resolution.winningBid).toBe(750);
    expect(resolution.defaultedPlayerIds).toEqual([]);
    // A pass is not a bid, so it never appears in the ranking.
    expect(resolution.bids).toEqual([
      { playerId: hiddenOpponent, amount: 750 },
      { playerId: owner, amount: 300 },
    ]);

    expect(money(closed.state, hiddenOpponent)).toBe(150);
    expect(money(closed.state, owner)).toBe(1000);
    const settled = closed.events.filter((event) => event.type === "ResourceChanged");
    expect(settled).toHaveLength(1);
  });

  it("Given tied top bids, When the auction closes, Then the earlier seat in playerOrder wins and pays", () => {
    const state = withBallot(ballotState(), auction({ audience: [owner, hiddenOpponent] }));

    const a = accepted(castBallot(state, castCommand(state, hiddenOpponent, AUCTION_ID, 400), context()));
    const closed = accepted(
      castBallot(a.state, castCommand(a.state, owner, AUCTION_ID, 400), context()),
    );

    const resolution = resolutionOf(closed.state, AUCTION_ID);
    expect(resolution.winnerPlayerId).toBe(owner);
    expect(resolution.tieBrokenBy).toBe("player-order");
    expect(money(closed.state, owner)).toBe(600);
    expect(money(closed.state, hiddenOpponent)).toBe(1000);
  });

  it("Given a bid larger than the bidder's money, When it is cast, Then it is rejected for insufficient resources", () => {
    const state = withBallot(ballotState({ [owner]: 300 }), auction());

    const result = castBallot(state, castCommand(state, owner, AUCTION_ID, 400), context());

    expect(rejection(result)).toBe("INSUFFICIENT_RESOURCE");
    expect(findBallot(state, AUCTION_ID)?.castBy).toEqual({});
  });

  it("Given a bid below the authored minimum, When it is cast, Then it is rejected — but a pass of zero is not", () => {
    const state = withBallot(ballotState(), auction());

    expect(rejection(castBallot(state, castCommand(state, owner, AUCTION_ID, 50), context()))).toBe(
      "ILLEGAL_ACTION",
    );
    expect(
      accepted(castBallot(state, castCommand(state, owner, AUCTION_ID, 0), context())).state,
    ).toBeDefined();
  });

  it("Given a fractional or negative bid, When it is cast, Then it is rejected", () => {
    const state = withBallot(ballotState(), auction());

    expect(rejection(castBallot(state, castCommand(state, owner, AUCTION_ID, 200.5), context()))).toBe(
      "ILLEGAL_ACTION",
    );
    expect(rejection(castBallot(state, castCommand(state, owner, AUCTION_ID, -100), context()))).toBe(
      "ILLEGAL_ACTION",
    );
    expect(rejection(castBallot(state, castCommand(state, owner, AUCTION_ID, "300"), context()))).toBe(
      "ILLEGAL_ACTION",
    );
  });

  it("Given the top bidder can no longer pay at close, When the auction resolves, Then they default and the next affordable bid wins at its own price", () => {
    // Bids were affordable when cast; the fixture then drains the top bidder, as
    // a toll or a fine would between the cast and the close.
    const state = withBallot(
      ballotState({ [hiddenOpponent]: 100, [revealedOpponent]: 600 }),
      auction({ castBy: { [hiddenOpponent]: 900, [revealedOpponent]: 500 } }),
    );

    const closed = accepted(expireBallot(state, expireCommand(state, AUCTION_ID), context()));

    const resolution = resolutionOf(closed.state, AUCTION_ID);
    expect(resolution.winnerPlayerId).toBe(revealedOpponent);
    expect(resolution.winningBid).toBe(500);
    expect(resolution.defaultedPlayerIds).toEqual([hiddenOpponent]);
    // The defaulter forfeits the lot but is not fined: there is no ModeRules
    // field for a penalty, so the sanction is the public record.
    expect(money(closed.state, hiddenOpponent)).toBe(100);
    expect(money(closed.state, revealedOpponent)).toBe(100);
  });

  it("Given nobody who bid can still pay, When the auction resolves, Then it closes with no winner and moves nothing", () => {
    const state = withBallot(
      ballotState({ [owner]: 10, [hiddenOpponent]: 10 }),
      auction({ castBy: { [owner]: 400, [hiddenOpponent]: 300 } }),
    );

    const closed = accepted(expireBallot(state, expireCommand(state, AUCTION_ID), context()));

    const resolution = resolutionOf(closed.state, AUCTION_ID);
    expect(resolution.winnerPlayerId).toBeNull();
    expect(resolution.winningBid).toBe(0);
    expect(resolution.defaultedPlayerIds).toEqual([owner, hiddenOpponent]);
    expect(closed.events.filter((event) => event.type === "ResourceChanged")).toEqual([]);
    expect(money(closed.state, owner)).toBe(10);
  });

  it("Given every bidder passes, When the auction closes, Then there is no winner and no charge", () => {
    const state = withBallot(ballotState(), auction());

    const a = accepted(castBallot(state, castCommand(state, owner, AUCTION_ID, 0), context()));
    const b = accepted(
      castBallot(a.state, castCommand(a.state, hiddenOpponent, AUCTION_ID, 0), context()),
    );
    const closed = accepted(
      castBallot(b.state, castCommand(b.state, revealedOpponent, AUCTION_ID, 0), context()),
    );

    const resolution = resolutionOf(closed.state, AUCTION_ID);
    expect(resolution.winnerPlayerId).toBeNull();
    expect(resolution.bids).toEqual([]);
    expect(money(closed.state, owner)).toBe(1000);
  });

  it("Given a bidder with no money resource at all, When they bid above zero, Then it is rejected", () => {
    const base = ballotState();
    const state = withBallot(
      {
        ...base,
        players: {
          ...base.players,
          [owner]: { ...base.players[owner], resources: {} },
        },
      },
      auction(),
    );

    expect(rejection(castBallot(state, castCommand(state, owner, AUCTION_ID, 100), context()))).toBe(
      "INSUFFICIENT_RESOURCE",
    );
  });
});

describe("sealed ballots leak nothing in flight (spec §7.2)", () => {
  it("Given a sealed ballot, When a bid is cast, Then the event is private to the caster and carries no value", () => {
    const state = withBallot(ballotState(), auction());

    const cast = castBallot(state, castCommand(state, hiddenOpponent, AUCTION_ID, 400), context());
    if (!cast.ok) throw new Error(cast.error.message);

    const event = cast.value.events[0];
    expect(event?.type).toBe("EffectProposed");
    expect(event?.visibility).toEqual({ kind: "private", playerIds: [hiddenOpponent] });
    // Neither the amount nor anything derived from it may appear.
    expect(stableStringify(event)).not.toContain("400");
    expect(stableStringify(event)).toContain('"sealed":true');
  });

  it("Given an open ballot, When a vote is cast, Then the event is public and does carry the value", () => {
    const state = withBallot(ballotState(), vote());

    const cast = castBallot(state, castCommand(state, owner, VOTE_ID, "for"), context());
    if (!cast.ok) throw new Error(cast.error.message);

    expect(cast.value.events[0]?.visibility).toEqual({ kind: "public" });
    expect(stableStringify(cast.value.events[0])).toContain('"for"');
  });

  it("Given a sealed ballot with a cast in flight, When the state is projected, Then no viewer sees the value or the voter", () => {
    const state = withBallot(ballotState(), auction());
    const cast = accepted(
      castBallot(state, castCommand(state, hiddenOpponent, AUCTION_ID, 425), context()),
    );

    const publicView = projectPublicView(cast.state);
    const projected = publicView.ballots.find((ballot) => ballot.id === AUCTION_ID);
    expect(projected?.castBy).toBeNull();

    for (const viewer of [owner, revealedOpponent]) {
      const payload = stableStringify(projectPlayerView(cast.state, viewer));
      expect(payload).not.toContain("425");
      expect(payload).not.toContain("ballotCasts\":{\"ballot-under-test-auction");
      // `castBy` is the *only* place an in-flight cast is recorded, which is
      // what lets one `null` in `projections/public.ts` withhold both the values
      // and the voter ids together. A viewer's own casts come back separately,
      // through `self.ballotCasts`, and only ever their own.
      expect(projectPlayerView(cast.state, viewer).self.ballotCasts).toEqual({});
    }

    // The caster does get their own answer back, via `self.ballotCasts`.
    expect(projectPlayerView(cast.state, hiddenOpponent).self.ballotCasts[AUCTION_ID]).toBe(425);
  });

  it("Given a sealed ballot, When it closes, Then the resolution reveals every cast at once", () => {
    const state = withBallot(ballotState(), auction({ audience: [owner, hiddenOpponent] }));
    const a = accepted(castBallot(state, castCommand(state, owner, AUCTION_ID, 200), context()));
    const closed = accepted(
      castBallot(a.state, castCommand(a.state, hiddenOpponent, AUCTION_ID, 350), context()),
    );

    expect(resolutionOf(closed.state, AUCTION_ID).castBy).toEqual([
      { playerId: owner, value: 200 },
      { playerId: hiddenOpponent, value: 350 },
    ]);
    const projected = projectPublicView(closed.state).ballots.find(
      (ballot) => ballot.id === AUCTION_ID,
    );
    expect(projected?.castBy).toEqual({ [owner]: 200, [hiddenOpponent]: 350 });
  });
});

describe("window.expire (spec §7.1)", () => {
  it("Given a command from a seated player, When it claims to expire a ballot, Then it is rejected", () => {
    const state = withBallot(ballotState(), vote({ castBy: { [owner]: "for" } }));

    const result = expireBallot(state, expireCommand(state, VOTE_ID, owner), context());

    expect(rejection(result)).toBe("ACTOR_NOT_AUTHORIZED");
    expect(findBallot(state, VOTE_ID)?.resolution).toBeNull();
  });

  it("Given a losing bidder who would rather the auction never closed, When they inject an expiry, Then it is refused before anything resolves", () => {
    const state = withBallot(
      ballotState(),
      auction({ castBy: { [owner]: 200, [hiddenOpponent]: 600 } }),
    );

    expect(rejection(expireBallot(state, expireCommand(state, AUCTION_ID, owner), context()))).toBe(
      "ACTOR_NOT_AUTHORIZED",
    );
    expect(money(state, hiddenOpponent)).toBe(1000);
  });

  it("Given a partly-cast ballot, When the server expires it, Then it closes on the casts it has", () => {
    const state = withBallot(ballotState(), vote({ castBy: { [owner]: "for" } }));

    const closed = accepted(expireBallot(state, expireCommand(state, VOTE_ID), context()));

    const resolution = resolutionOf(closed.state, VOTE_ID);
    expect(resolution.closedBy).toBe("expired");
    expect(resolution.winningOption).toBe("for");
    expect(resolution.abstainedPlayerIds).toEqual([hiddenOpponent, revealedOpponent]);
  });

  it("Given an expiry that already fired, When it fires again, Then it is refused and the winner is not charged twice", () => {
    const state = withBallot(
      ballotState(),
      auction({ castBy: { [owner]: 250, [hiddenOpponent]: 100 } }),
    );

    const first = accepted(expireBallot(state, expireCommand(state, AUCTION_ID), context()));
    expect(money(first.state, owner)).toBe(750);

    const second = expireBallot(
      first.state,
      expireCommand(first.state, AUCTION_ID, SERVER_ACTOR, "command-expire-again"),
      context(),
    );

    expect(rejection(second)).toBe("DECISION_POINT_STALE");
    expect(money(first.state, owner)).toBe(750);
  });

  it("Given a decisionPointId that belongs to no ballot, When it expires, Then it is rejected as not found", () => {
    const state = withBallot(ballotState(), vote());

    expect(rejection(expireBallot(state, expireCommand(state, "reaction-owner"), context()))).toBe(
      "DECISION_POINT_NOT_FOUND",
    );
  });

  it("Given a mix of decision points, When the dispatcher asks which are ballots, Then only ballot ids answer yes", () => {
    const state = withBallot(ballotState(), vote());

    expect(isBallotDecisionPoint(state, VOTE_ID)).toBe(true);
    expect(isBallotDecisionPoint(state, "reaction-owner")).toBe(false);
    expect(isSeatedActor(state, owner)).toBe(true);
    expect(isSeatedActor(state, SERVER_ACTOR)).toBe(false);
  });
});

describe("openBallot", () => {
  it("Given an enabled mode, When a ballot is opened, Then it lands on the table with its audience in playerOrder", () => {
    const state = ballotState();

    const result = openBallot(state, {
      id: VOTE_ID,
      kind: "vote",
      subjectId: "vote.blame",
      subject: { options: ["owner", "nobody"] },
      audience: [revealedOpponent, owner],
      deadlineAt: "2026-07-18T10:09:00.000Z",
      closesAtRound: 5,
      visibility: "sealed",
    });

    if (!result.ok) throw new Error(result.message);
    expect(result.ballot.audience).toEqual([owner, revealedOpponent]);
    expect(result.ballot.castBy).toEqual({});
    expect(result.ballot.resolution).toBeNull();
    expect(result.state.ballots).toHaveLength(1);
  });

  it("Given a disabled mode, When a ballot is opened, Then it is refused", () => {
    const state = withRules(ballotState(), { interaction: { auctionsEnabled: false } });

    const result = openBallot(state, {
      id: AUCTION_ID,
      kind: "auction",
      subjectId: "auction.corner-office",
      subject: {},
      audience: [owner],
      deadlineAt: null,
      closesAtRound: 5,
      visibility: "sealed",
    });

    expect(result.ok).toBe(false);
  });

  it("Given an audience of nobody who can act, When a ballot is opened, Then it is refused rather than stranded", () => {
    const base = ballotState();
    const state = { ...base, eliminatedPlayerIds: [owner] };

    const result = openBallot(state, {
      id: VOTE_ID,
      kind: "vote",
      subjectId: "vote.blame",
      subject: {},
      audience: [owner, brand<PlayerId>("player-not-at-this-table")],
      deadlineAt: null,
      closesAtRound: 5,
      visibility: "open",
    });

    expect(result.ok).toBe(false);
  });

  it("Given an id already in use, When a ballot is opened, Then it is refused", () => {
    const state = withBallot(ballotState(), vote());

    const result = openBallot(state, {
      id: VOTE_ID,
      kind: "vote",
      subjectId: "vote.duplicate",
      subject: {},
      audience: [owner],
      deadlineAt: null,
      closesAtRound: 5,
      visibility: "open",
    });

    expect(result.ok).toBe(false);
  });
});

describe("ballot helpers", () => {
  it("Given a table with one open and one closed ballot, When a player asks what they can cast in, Then only the open one they have not answered is listed", () => {
    const base = ballotState();
    const state = {
      ...base,
      ballots: [
        vote(),
        auction({ castBy: { [owner]: 100 } }),
        vote({
          id: brand<BallotId>("ballot-closed"),
          resolution: { kind: "vote", winningOption: "for" },
        }),
      ],
    };

    expect(openBallotsForPlayer(state, owner).map((ballot) => ballot.id)).toEqual([VOTE_ID]);
    expect(openBallotsForPlayer(state, hiddenOpponent).map((ballot) => ballot.id)).toEqual([
      VOTE_ID,
      AUCTION_ID,
    ]);
  });

  it("Given a mode with a kind disabled, When a player asks what they can cast in, Then that kind is not offered", () => {
    const state = withRules(withBallot(ballotState(), auction()), {
      interaction: { auctionsEnabled: false },
    });

    expect(openBallotsForPlayer(state, owner)).toEqual([]);
  });

  it("Given an audience listing an unseated id, When entitlement is computed, Then it is dropped", () => {
    const state = withBallot(
      ballotState(),
      vote({ audience: [owner, brand<PlayerId>("player-ghost")] }),
    );

    expect(entitledVoters(state, vote({ audience: [owner, brand<PlayerId>("player-ghost")] }))).toEqual(
      [owner],
    );
    expect(findBallot(state, "ballot-missing")).toBeNull();
  });

  it("Given a bid, When it is validated without being submitted, Then the same rules answer as the transition would", () => {
    const state = ballotState({ [owner]: 250 });
    const lot = auction();

    expect(validateBallotCast(state, lot, owner, 200)).toEqual({ ok: true, value: 200 });
    expect(validateBallotCast(state, lot, owner, 300).ok).toBe(false);
    expect(validateBallotCast(state, vote(), owner, "for")).toEqual({ ok: true, value: "for" });
  });
});

describe("determinism, purity and the JSON round trip", () => {
  it("Given a frozen state, When the same cast is applied twice, Then the events and next state are byte-identical and the input is untouched", () => {
    const original = withBallot(ballotState(), auction({ castBy: { [owner]: 200 } }));
    const frozen = deepFreeze(structuredClone(original));
    const command = castCommand(frozen, hiddenOpponent, AUCTION_ID, 500);

    const first = castBallot(frozen, command, context());
    const second = castBallot(frozen, command, context());
    if (!first.ok || !second.ok) throw new Error("cast was rejected");

    expect(stableStringify(second.value.events)).toBe(stableStringify(first.value.events));
    expect(stableStringify(second.value.state)).toBe(stableStringify(first.value.state));
    expect(stableStringify(frozen)).toBe(stableStringify(original));
  });

  it("Given a closing cast, When the state has been through the jsonb snapshot boundary first, Then it resolves identically", () => {
    // Record key order is not preserved across the repository's
    // JSON.parse(JSON.stringify(…)); a tally or a bid ranking that depended on it
    // would diverge exactly here.
    const state = withBallot(
      ballotState(),
      auction({ castBy: { [owner]: 400, [revealedOpponent]: 400 } }),
    );
    const restored = deserializeGameState(serializeGameState(state));

    const live = castBallot(state, castCommand(state, hiddenOpponent, AUCTION_ID, 400), context());
    const resumed = castBallot(
      restored,
      castCommand(restored, hiddenOpponent, AUCTION_ID, 400),
      context(),
    );
    if (!live.ok || !resumed.ok) throw new Error("cast was rejected");

    expect(stableStringify(resumed.value.events)).toBe(stableStringify(live.value.events));
    expect(stableStringify(resumed.value.state)).toBe(stableStringify(live.value.state));
    // Three-way tie at 400: playerOrder decides, and it decides the same way
    // before and after the round trip.
    expect(resolutionOf(live.value.state, AUCTION_ID).winnerPlayerId).toBe(owner);
  });

  it("Given a closed ballot, When the state is serialized, Then it round-trips unchanged", () => {
    const state = withBallot(
      ballotState(),
      auction({ castBy: { [owner]: 300, [hiddenOpponent]: 100 } }),
    );
    const closed = accepted(expireBallot(state, expireCommand(state, AUCTION_ID), context()));

    const serialized = serializeGameState(closed.state);
    expect(deserializeGameState(serialized)).toEqual(closed.state);
    expect(serializeGameState(deserializeGameState(serialized))).toBe(serialized);
  });

  it("Given two different logical timestamps, When the same ballot closes, Then only the timestamps differ", () => {
    const state = withBallot(
      ballotState(),
      vote({ castBy: { [owner]: "for", [hiddenOpponent]: "against" } }),
    );

    const early = expireBallot(state, expireCommand(state, VOTE_ID), context("2020-01-01T00:00:00.000Z"));
    const late = expireBallot(state, expireCommand(state, VOTE_ID), context("2099-12-31T23:59:59.000Z"));
    if (!early.ok || !late.ok) throw new Error("expiry was rejected");

    const strip = (value: string) =>
      value.replaceAll("2020-01-01T00:00:00.000Z", "T").replaceAll("2099-12-31T23:59:59.000Z", "T");
    expect(strip(stableStringify(late.value.state))).toBe(strip(stableStringify(early.value.state)));
    expect(strip(stableStringify(late.value.events))).toBe(strip(stableStringify(early.value.events)));
  });

  it("Given a resolution computed twice from the same inputs, When compared, Then it is identical — resolveBallot reads no clock and draws no randomness", () => {
    const state = withBallot(
      ballotState(),
      vote({ castBy: { [owner]: "for", [hiddenOpponent]: "against", [revealedOpponent]: "for" } }),
    );
    const ballot = findBallot(state, VOTE_ID);
    if (ballot === null) throw new Error("expected the ballot");

    expect(stableStringify(resolveBallot(state, ballot, "expired"))).toBe(
      stableStringify(resolveBallot(state, ballot, "expired")),
    );
  });

  it("Given an accepted cast, When the next state is inspected, Then revision advanced, the command is recorded and the turn is untouched", () => {
    // Casting is deliberately out-of-turn: a ballot is what the players who are
    // not rolling get to do.
    const state = withBallot(ballotState(), vote());

    const cast = accepted(
      castBallot(state, castCommand(state, revealedOpponent, VOTE_ID, "for"), context()),
    );

    expect(cast.state.revision).toBe(state.revision + 1);
    expect(cast.state.lastCommandId).toBe("command-cast-player-revealed-opponent");
    expect(cast.state.stateHash).toBeNull();
    expect(cast.state.turn).toEqual(state.turn);
    expect(cast.state.turn.activePlayerId).toBe(owner);
    expect(cast.state.eventSequence).toBe(state.eventSequence + cast.events.length);
  });
});
