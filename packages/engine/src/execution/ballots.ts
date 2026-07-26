import type { CastBallotCommand, ExpireWindowCommand } from "../commands";
import type { EffectProposedEvent, GameEvent, ResourceChangedEvent } from "../events";
import type {
  BallotId,
  BallotState,
  DecisionPointId,
  EffectId,
  EngineErrorCode,
  GameState,
  JsonObject,
  JsonValue,
  LogicalTimestamp,
  ModeRules,
  PlayerId,
  PlayerState,
  ResourceId,
  ResourceState,
} from "../model";
import { createEventMetadata } from "./events";
import { rejectCommand } from "./errors";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Ballots: votes and auctions (spec §5.8).
 *
 * One shape covers both because they resolve the same way — an audience casts,
 * the ballot closes, one deterministic winner falls out — which is why
 * `BallotState` carries a single `kind` discriminator rather than being two
 * types. The differences are narrow and live in exactly two places here:
 * `validateBallotCast` (what a legal `value` is) and `resolveBallot` (how the
 * winner is picked and whether anything is charged).
 *
 * Three properties this module is built around, in priority order:
 *
 * 1. **Authorisation before mutation** (spec §6.3). A ballot is the first place
 *    a command from player A can decide something that costs player B, so every
 *    entry point checks entitlement — audience membership, seat, elimination —
 *    before a single field is rewritten. A cast never writes to another player's
 *    slot in `castBy`: the key is always `command.actorId`, never anything from
 *    the payload.
 * 2. **Sealed means sealed** (spec §7.2). While `visibility === "sealed"` and
 *    the ballot is unresolved, nothing here publishes a value *or a voter id* —
 *    not in state that a public projection can reach, and not in an event. The
 *    per-cast event is emitted `private` to the caster alone precisely because
 *    "who has voted already" is itself information. `castBy` is the only place
 *    an in-flight cast is recorded, which is what makes redaction enforceable in
 *    one place (`projections/public.ts` withholds the whole record while
 *    `resolution === null`) rather than field by field.
 * 3. **Mode-driven** (spec §4). `interaction.votesEnabled` and
 *    `interaction.auctionsEnabled` gate opening and casting. There is no
 *    `modeId` comparison and no hardcoded enablement anywhere below.
 *
 * Nothing here reads a clock, draws randomness, or iterates an object's keys in
 * a way that decides an outcome: every walk over players goes through
 * `state.playerOrder`, which survives the repository's JSON round trip, and
 * every tie is broken by position in that order.
 */

/** Why a ballot stopped accepting casts. */
export type BallotCloseReason = "all-cast" | "expired";

/** One resource movement a closing ballot caused. Auctions only, today. */
export type BallotSettlement = {
  readonly playerId: PlayerId;
  readonly resourceKey: string;
  readonly resourceId: ResourceId;
  readonly previousValue: number;
  readonly newValue: number;
  readonly reason: string;
};

/** The result of closing a ballot: the closed ballot plus everything it moved. */
export type BallotResolutionOutcome = {
  /** The same ballot with `resolution` filled in. Never `null` after this. */
  readonly ballot: BallotState;
  /** `state.players` with any settlement applied. Unchanged for a vote. */
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly settlements: readonly BallotSettlement[];
};

export type OpenBallotInput = {
  readonly id: BallotId;
  readonly kind: BallotState["kind"];
  readonly subjectId: string;
  readonly subject: JsonObject;
  readonly audience: readonly PlayerId[];
  readonly deadlineAt: LogicalTimestamp | null;
  readonly closesAtRound: number;
  readonly visibility: BallotState["visibility"];
};

export type OpenBallotResult =
  | { readonly ok: true; readonly state: GameState; readonly ballot: BallotState }
  | { readonly ok: false; readonly code: EngineErrorCode; readonly message: string };

export type BallotCastValidation =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly code: EngineErrorCode; readonly message: string };

const MONEY_KIND = "resource.money";

const AUCTION_SETTLEMENT_REASON = "ballot-auction-settlement";

/**
 * A bid of zero is a pass, not a bid.
 *
 * Every ballot needs a legal "I decline" cast, otherwise one absent player holds
 * the table until `window.expire` fires. Votes get theirs from an authored
 * abstain option; auctions get it from zero, which no auction can ever win with.
 */
const AUCTION_PASS_BID = 0;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Ballot ids and decision-point ids are both opaque stable ids, and the server's
 * scheduler addresses a ballot's deadline through `window.expire`'s
 * `decisionPointId`. Compared as plain strings so either brand can look one up.
 */
export function findBallot(
  state: GameState,
  ballotId: BallotId | DecisionPointId | string,
): BallotState | null {
  return (
    state.ballots.find((candidate) => String(candidate.id) === String(ballotId)) ?? null
  );
}

/**
 * Whether a `window.expire` naming this decision point belongs to this module.
 *
 * The dispatcher needs this: `window.expire` also fires for reaction windows and
 * turn timers, and only the id says which.
 */
export function isBallotDecisionPoint(
  state: GameState,
  decisionPointId: DecisionPointId | string,
): boolean {
  return findBallot(state, decisionPointId) !== null;
}

/** The `ModeRules` switch that governs this ballot kind. Spec §4.1. */
export function ballotKindEnabled(rules: ModeRules, kind: BallotState["kind"]): boolean {
  return kind === "vote"
    ? rules.interaction.votesEnabled
    : rules.interaction.auctionsEnabled;
}

/**
 * Whether an actor id names a seated player.
 *
 * Exported so the dispatcher can apply the *same* rule to `window.expire` that
 * `expireBallot` applies: the command is server-injected only (spec §7.1), and
 * "not a seat at this table" is the only signal the engine has for that — it has
 * no notion of a server identity and must not grow one.
 */
export function isSeatedActor(state: GameState, actorId: PlayerId): boolean {
  return state.players[actorId] !== undefined;
}

/**
 * The audience members who may still act, in `playerOrder`.
 *
 * Anyone in the audience who is not seated or who has been eliminated is dropped
 * — they can never cast, so counting them would mean no ballot ever reaches
 * all-cast and every one would have to wait for its deadline.
 */
export function entitledVoters(
  state: GameState,
  ballot: BallotState,
): readonly PlayerId[] {
  return state.playerOrder.filter(
    (playerId) =>
      ballot.audience.includes(playerId) &&
      state.players[playerId] !== undefined &&
      !state.eliminatedPlayerIds.includes(playerId),
  );
}

/** Open ballots this player is entitled to and has not cast in yet. */
export function openBallotsForPlayer(
  state: GameState,
  playerId: PlayerId,
): readonly BallotState[] {
  return state.ballots.filter(
    (ballot) =>
      ballot.resolution === null &&
      ballotKindEnabled(state.rules, ballot.kind) &&
      entitledVoters(state, ballot).includes(playerId) &&
      !(playerId in ballot.castBy),
  );
}

/**
 * The player's money resource as a `[key, resource]` pair, or `null`.
 *
 * Selected by kind and disambiguated by the *lowest key*, never by whichever
 * entry `Object.entries` happens to yield first: record key order is not stable
 * across the repository's `JSON.parse(JSON.stringify(…))` boundary, and an
 * auction that charged a different resource before and after a reload would be a
 * replay divergence.
 */
function findMoney(player: PlayerState): readonly [string, ResourceState] | null {
  let found: readonly [string, ResourceState] | null = null;
  for (const [key, resource] of Object.entries(player.resources)) {
    if (resource.kind !== MONEY_KIND) continue;
    if (found === null || key < found[0]) {
      found = [key, resource];
    }
  }

  return found;
}

/** How much of this player's money a ballot may actually take. */
function spendableMoney(player: PlayerState): number {
  const money = findMoney(player);
  if (money === null) return 0;
  const floor = money[1].minimum ?? 0;

  return Math.max(0, money[1].value - floor);
}

// ---------------------------------------------------------------------------
// Cast validation
// ---------------------------------------------------------------------------

function readStringArray(subject: JsonObject, key: string): readonly string[] | null {
  const raw = subject[key];
  if (!Array.isArray(raw)) return null;
  const values = raw.filter((entry): entry is string => typeof entry === "string");

  return values.length === raw.length && values.length > 0 ? values : null;
}

function readNumber(subject: JsonObject, key: string): number | null {
  const raw = subject[key];

  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Whether `value` is a legal cast for this ballot, from this player, right now.
 *
 * Split out from `castBallot` because bots and `legal-actions` need the same
 * answer without submitting a command, and because a second copy of these rules
 * would eventually disagree with this one.
 *
 * Votes take a string option id. When the opener authored
 * `subject.options: string[]` the cast must be one of them; when it did not, any
 * string is accepted, so a ballot can be raised over a free-form subject without
 * this module needing to know what it is.
 *
 * Auctions take a non-negative integer bid, at most what the bidder can spend
 * *now*. Cast-time affordability is not the same promise as close-time
 * affordability — see `resolveBallot` for what happens when the two disagree —
 * but bidding money you have never had is straightforwardly a cheat and is
 * refused here.
 */
export function validateBallotCast(
  state: GameState,
  ballot: BallotState,
  playerId: PlayerId,
  value: JsonValue,
): BallotCastValidation {
  if (ballot.kind === "vote") {
    if (typeof value !== "string" || value.length === 0) {
      return {
        ok: false,
        code: "ILLEGAL_ACTION",
        message: "A vote must be cast as a non-empty option id",
      };
    }
    const options = readStringArray(ballot.subject, "options");
    if (options !== null && !options.includes(value)) {
      return {
        ok: false,
        code: "ILLEGAL_ACTION",
        message: "Vote value is not one of this ballot's authored options",
      };
    }

    return { ok: true, value };
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return {
      ok: false,
      code: "ILLEGAL_ACTION",
      message: "An auction bid must be a non-negative whole number",
    };
  }

  const minBid = readNumber(ballot.subject, "minBid");
  if (value !== AUCTION_PASS_BID && minBid !== null && value < minBid) {
    return {
      ok: false,
      code: "ILLEGAL_ACTION",
      message: "Auction bid is below this ballot's minimum bid",
    };
  }

  const player = state.players[playerId];
  if (player === undefined) {
    return {
      ok: false,
      code: "ACTOR_NOT_FOUND",
      message: "Bidder is missing from canonical player state",
    };
  }
  if (value > spendableMoney(player)) {
    return {
      ok: false,
      code: "INSUFFICIENT_RESOURCE",
      message: "Auction bid exceeds the bidder's spendable money",
    };
  }

  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/**
 * Raises a ballot. The seam the `openBallot` effect (spec §10.3) and any
 * server-side opener call.
 *
 * Deliberately not a command transition: a ballot is always raised *by*
 * something else — a tile effect, a card, a promotion challenge — so this takes
 * a state and hands one back rather than owning an envelope of its own. The
 * caller turns a rejection into an `EngineError` with its own command attached.
 */
export function openBallot(state: GameState, input: OpenBallotInput): OpenBallotResult {
  if (!ballotKindEnabled(state.rules, input.kind)) {
    return {
      ok: false,
      code: "ILLEGAL_ACTION",
      message:
        input.kind === "vote"
          ? "Votes are disabled by this mode's rules"
          : "Auctions are disabled by this mode's rules",
    };
  }
  if (findBallot(state, input.id) !== null) {
    return {
      ok: false,
      code: "INVALID_COMMAND",
      message: "A ballot with this id is already on the table",
    };
  }

  // Ordered by `playerOrder` and de-duplicated at construction, so every later
  // read of `audience` is already canonical and no consumer has to re-sort it.
  const audience = state.playerOrder.filter(
    (playerId) =>
      input.audience.includes(playerId) &&
      state.players[playerId] !== undefined &&
      !state.eliminatedPlayerIds.includes(playerId),
  );
  if (audience.length === 0) {
    return {
      ok: false,
      code: "ILLEGAL_ACTION",
      message: "A ballot needs at least one seated, non-eliminated voter",
    };
  }

  const ballot: BallotState = {
    id: input.id,
    kind: input.kind,
    subjectId: input.subjectId,
    subject: input.subject,
    audience,
    castBy: {},
    deadlineAt: input.deadlineAt,
    closesAtRound: input.closesAtRound,
    visibility: input.visibility,
    resolution: null,
  };

  return {
    ok: true,
    state: { ...state, ballots: [...state.ballots, ballot] },
    ballot,
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

type VoteTallyRow = {
  readonly option: string;
  readonly count: number;
  readonly firstCastOrderIndex: number;
  readonly firstCastByPlayerId: PlayerId;
};

/**
 * Vote tally, walked in `playerOrder`.
 *
 * `firstCastOrderIndex` is the tie-break: when two options draw, the one whose
 * earliest supporter sits earliest in turn order takes it. That is a rule a
 * player can be told and can predict, and unlike "whichever key came out of the
 * record first" it survives a JSON round trip.
 */
function tallyVote(state: GameState, ballot: BallotState): readonly VoteTallyRow[] {
  const rows: VoteTallyRow[] = [];

  entitledVoters(state, ballot).forEach((playerId, index) => {
    const raw = ballot.castBy[playerId];
    if (typeof raw !== "string") return;
    const existing = rows.findIndex((row) => row.option === raw);
    if (existing < 0) {
      rows.push({
        option: raw,
        count: 1,
        firstCastOrderIndex: index,
        firstCastByPlayerId: playerId,
      });

      return;
    }
    rows[existing] = { ...rows[existing], count: rows[existing].count + 1 };
  });

  return [...rows].sort((left, right) =>
    left.count !== right.count
      ? right.count - left.count
      : left.firstCastOrderIndex - right.firstCastOrderIndex,
  );
}

type AuctionBid = {
  readonly playerId: PlayerId;
  readonly amount: number;
  readonly orderIndex: number;
};

/** Bids above the pass threshold, strongest first, ties by `playerOrder`. */
function rankBids(state: GameState, ballot: BallotState): readonly AuctionBid[] {
  const bids: AuctionBid[] = [];

  entitledVoters(state, ballot).forEach((playerId, index) => {
    const raw = ballot.castBy[playerId];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= AUCTION_PASS_BID) {
      return;
    }
    bids.push({ playerId, amount: raw, orderIndex: index });
  });

  return [...bids].sort((left, right) =>
    left.amount !== right.amount
      ? right.amount - left.amount
      : left.orderIndex - right.orderIndex,
  );
}

function castRecordInOrder(
  state: GameState,
  ballot: BallotState,
): readonly JsonObject[] {
  return entitledVoters(state, ballot)
    .filter((playerId) => playerId in ballot.castBy)
    .map((playerId) => ({
      playerId,
      value: ballot.castBy[playerId] ?? null,
    }));
}

function resolveVote(
  state: GameState,
  ballot: BallotState,
  closedBy: BallotCloseReason,
): BallotResolutionOutcome {
  const rows = tallyVote(state, ballot);
  const winner = rows[0] ?? null;
  const runnerUp = rows[1] ?? null;
  const tied = winner !== null && runnerUp !== null && winner.count === runnerUp.count;

  const resolution: JsonObject = {
    kind: "vote",
    closedBy,
    closedAtRound: state.turn.round,
    winningOption: winner === null ? null : winner.option,
    // An array, not a record: a tally keyed by option would put the outcome at
    // the mercy of key order the moment anyone iterated it.
    tally: rows.map((row) => ({
      option: row.option,
      count: row.count,
      firstCastByPlayerId: row.firstCastByPlayerId,
    })),
    castBy: castRecordInOrder(state, ballot),
    abstainedPlayerIds: entitledVoters(state, ballot).filter(
      (playerId) => !(playerId in ballot.castBy),
    ),
    tieBrokenBy: tied ? "player-order" : null,
  };

  return {
    ballot: { ...ballot, resolution },
    players: state.players,
    settlements: [],
  };
}

function resolveAuction(
  state: GameState,
  ballot: BallotState,
  closedBy: BallotCloseReason,
): BallotResolutionOutcome {
  const ranked = rankBids(state, ballot);

  // The bidder who cannot afford their own winning bid. Cast-time affordability
  // is checked, but a bid is not an escrow: money can leave between the cast and
  // the close (upkeep, a toll, a fine, someone else's card). Rather than let
  // that void the whole auction — which would reward bidding high and then
  // spending down — the defaulter simply forfeits and the lot falls to the next
  // bid that *can* be paid, at that bid's own price.
  const defaulted: PlayerId[] = [];
  const affordable = ranked.find((bid) => {
    const bidder = state.players[bid.playerId];
    if (bidder !== undefined && spendableMoney(bidder) >= bid.amount) return true;
    defaulted.push(bid.playerId);

    return false;
  });
  const winner: AuctionBid | null = affordable ?? null;

  // A tie that `playerOrder` actually decided. An equal bid that was passed over
  // for being unaffordable lost on money, not on seat, and reporting that as a
  // tie-break would misdescribe the auction to the table.
  const contested =
    winner !== null &&
    ranked.some(
      (bid) =>
        bid.playerId !== winner.playerId &&
        bid.amount === winner.amount &&
        !defaulted.includes(bid.playerId),
    );

  const settlements: BallotSettlement[] = [];
  let players = state.players;

  if (winner !== null) {
    const bidder = state.players[winner.playerId];
    const money = bidder === undefined ? null : findMoney(bidder);
    if (bidder !== undefined && money !== null) {
      const [key, resource] = money;
      const newValue = resource.value - winner.amount;
      settlements.push({
        playerId: winner.playerId,
        resourceKey: key,
        resourceId: resource.id,
        previousValue: resource.value,
        newValue,
        reason: AUCTION_SETTLEMENT_REASON,
      });
      players = {
        ...players,
        [winner.playerId]: {
          ...bidder,
          resources: {
            ...bidder.resources,
            [key]: { ...resource, value: newValue },
          },
        },
      };
    }
  }

  const resolution: JsonObject = {
    kind: "auction",
    closedBy,
    closedAtRound: state.turn.round,
    winnerPlayerId: winner === null ? null : winner.playerId,
    winningBid: winner === null ? 0 : winner.amount,
    bids: ranked.map((bid) => ({ playerId: bid.playerId, amount: bid.amount })),
    castBy: castRecordInOrder(state, ballot),
    /**
     * Named in the resolution on purpose. There is no `ModeRules` field for an
     * over-bid penalty, so inventing a fine here would be exactly the hardcoded
     * constant §4 forbids; the sanction is that the whole table sees who could
     * not pay.
     */
    defaultedPlayerIds: defaulted,
    tieBrokenBy: contested ? "player-order" : null,
  };

  return {
    ballot: { ...ballot, resolution },
    players,
    settlements,
  };
}

/**
 * Closes a ballot and computes everything that follows from it.
 *
 * Pure and trigger-agnostic: all-cast, `window.expire`, a round sweep and a
 * replay all want the same answer, and this is the only place that decides it.
 * Callers are responsible for putting `outcome.ballot` back into `state.ballots`
 * and emitting events for `outcome.settlements`.
 */
export function resolveBallot(
  state: GameState,
  ballot: BallotState,
  closedBy: BallotCloseReason,
): BallotResolutionOutcome {
  return ballot.kind === "vote"
    ? resolveVote(state, ballot, closedBy)
    : resolveAuction(state, ballot, closedBy);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

type EventMetadataFactory = () => Omit<GameEvent, "type" | "payload">;

/**
 * Ballots have no event type of their own — `events/index.ts` predates them and
 * is owned elsewhere — so they ride `EffectProposed`, whose payload carries a
 * free `JsonObject`. The `kind` discriminator inside `effect` is what a feed or
 * projection matches on. Replacing this with real `BallotCast` / `BallotResolved`
 * envelopes is a rename here and nothing else.
 */
function ballotEffectId(ballot: BallotState, suffix: string): EffectId {
  return `${String(ballot.id)}:${suffix}` as EffectId;
}

function castEvent(
  ballot: BallotState,
  playerId: PlayerId,
  value: JsonValue,
  metadata: EventMetadataFactory,
): EffectProposedEvent {
  const sealed = ballot.visibility === "sealed";

  return {
    ...metadata(),
    // A sealed ballot leaks nothing in flight, and "X has voted" is a leak: it
    // tells the table who is still deliberating and lets the last caster time
    // their own. So the whole event — not just its value — is private to the
    // caster, and the public record of who cast what appears only in the
    // resolution.
    visibility: sealed
      ? { kind: "private", playerIds: [playerId] }
      : { kind: "public" },
    type: "EffectProposed",
    payload: {
      effectId: ballotEffectId(ballot, `cast:${String(playerId)}`),
      affectedPlayerIds: [playerId],
      effect: sealed
        ? {
            kind: "ballot.cast",
            ballotId: ballot.id,
            ballotKind: ballot.kind,
            playerId,
            sealed: true,
          }
        : {
            kind: "ballot.cast",
            ballotId: ballot.id,
            ballotKind: ballot.kind,
            playerId,
            sealed: false,
            value,
          },
    },
  };
}

function resolvedEvent(
  ballot: BallotState,
  audience: readonly PlayerId[],
  metadata: EventMetadataFactory,
): EffectProposedEvent {
  return {
    ...metadata(),
    type: "EffectProposed",
    payload: {
      effectId: ballotEffectId(ballot, "resolved"),
      affectedPlayerIds: [...audience],
      effect: {
        kind: "ballot.resolved",
        ballotId: ballot.id,
        ballotKind: ballot.kind,
        subjectId: ballot.subjectId,
        resolution: ballot.resolution ?? null,
      },
    },
  };
}

function settlementEvents(
  settlements: readonly BallotSettlement[],
  metadata: EventMetadataFactory,
): readonly ResourceChangedEvent[] {
  return settlements.map((settlement) => ({
    ...metadata(),
    type: "ResourceChanged",
    payload: {
      playerId: settlement.playerId,
      resourceId: settlement.resourceId,
      previousValue: settlement.previousValue,
      newValue: settlement.newValue,
      reason: settlement.reason,
    },
  }));
}

function replaceBallot(
  ballots: readonly BallotState[],
  updated: BallotState,
): readonly BallotState[] {
  return ballots.map((candidate) =>
    String(candidate.id) === String(updated.id) ? updated : candidate,
  );
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * `ballot.cast` — one vote or one bid, from the actor, for themselves.
 *
 * Explicitly **not** gated on whose turn it is. A ballot is the mechanic that
 * lets the five players who are not rolling do something, so requiring the
 * active seat would defeat its entire purpose; the dispatcher must exempt this
 * command from its `NOT_ACTOR_TURN` guard.
 *
 * Casts are final. Re-casting would make "all cast, so close" ambiguous (a
 * change of mind after closure has nowhere to go) and would turn an open vote
 * into a game of who edits last; a player who wants to hedge has the abstain
 * option or a zero bid.
 */
export function castBallot(
  state: GameState,
  command: CastBallotCommand,
  context: TransitionContext,
): TransitionResult {
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Ballots can only be cast in an active game",
    });
  }

  const ballot = findBallot(state, command.payload.ballotId);
  if (ballot === null) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_NOT_FOUND",
      message: "No matching ballot for this ballotId",
    });
  }
  if (ballot.resolution !== null) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_STALE",
      message: "This ballot has already closed",
    });
  }
  if (!ballotKindEnabled(state.rules, ballot.kind)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message:
        ballot.kind === "vote"
          ? "Votes are disabled by this mode's rules"
          : "Auctions are disabled by this mode's rules",
    });
  }

  // Authorisation, before anything is rewritten (spec §6.3). `entitledVoters`
  // folds in audience membership, still being seated, and not being eliminated;
  // there is no path here that writes a cast under a player id the actor does
  // not own, because the key below is `command.actorId` and nothing else.
  if (!entitledVoters(state, ballot).includes(command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Actor is not entitled to cast in this ballot",
    });
  }
  if (command.actorId in ballot.castBy) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This player has already cast in this ballot",
    });
  }

  const validated = validateBallotCast(state, ballot, command.actorId, command.payload.value);
  if (!validated.ok) {
    return rejectCommand(state, command, {
      code: validated.code,
      message: validated.message,
    });
  }

  const cast: BallotState = {
    ...ballot,
    castBy: { ...ballot.castBy, [command.actorId]: validated.value },
  };

  const events: GameEvent[] = [];
  const metadata: EventMetadataFactory = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + events.length + 1,
    );

  events.push(castEvent(cast, command.actorId, validated.value, metadata));

  const outstanding = entitledVoters(state, cast).filter(
    (playerId) => !(playerId in cast.castBy),
  );

  let ballots = replaceBallot(state.ballots, cast);
  let players = state.players;

  if (outstanding.length === 0) {
    const outcome = resolveBallot(state, cast, "all-cast");
    ballots = replaceBallot(state.ballots, outcome.ballot);
    players = outcome.players;
    events.push(...settlementEvents(outcome.settlements, metadata));
    events.push(resolvedEvent(outcome.ballot, entitledVoters(state, cast), metadata));
  }

  const lastEvent = events[events.length - 1];
  if (lastEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Ballot cast did not emit an event",
    });
  }

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        players,
        ballots,
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}

/**
 * `window.expire` for a ballot: the deadline the engine wrote has passed and the
 * server has said so (spec §7.1). The engine still never reads a clock — this is
 * the server telling it what time it is, through the ordinary command path.
 *
 * Server-injected only, and the only handle the engine has on that is that no
 * seat owns the actor id, so a command from any player is refused. **The
 * dispatcher must let a non-seated actor through for this command type** — its
 * `ACTOR_NOT_FOUND` guard would otherwise reject every legitimate expiry before
 * this function ever runs.
 *
 * Idempotent in the sense §7.1 requires: a ballot with a `resolution` is refused
 * rather than resolved a second time, so a duplicate fire can never double-charge
 * an auction winner.
 */
export function expireBallot(
  state: GameState,
  command: ExpireWindowCommand,
  context: TransitionContext,
): TransitionResult {
  if (isSeatedActor(state, command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "window.expire is server-injected and never accepted from a player",
    });
  }
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Ballots can only be closed in an active game",
    });
  }

  const ballot = findBallot(state, command.payload.decisionPointId);
  if (ballot === null) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_NOT_FOUND",
      message: "No matching ballot for this decisionPointId",
    });
  }
  if (ballot.resolution !== null) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_STALE",
      message: "This ballot has already closed",
    });
  }

  // Deliberately not gated on `ballotKindEnabled`. Closing is cleanup, and a
  // ballot that exists must always be closable: refusing here would strand it
  // open forever and hold its audience with it.
  const outcome = resolveBallot(state, ballot, "expired");

  const events: GameEvent[] = [];
  const metadata: EventMetadataFactory = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + events.length + 1,
    );

  events.push(...settlementEvents(outcome.settlements, metadata));
  events.push(resolvedEvent(outcome.ballot, entitledVoters(state, ballot), metadata));

  const lastEvent = events[events.length - 1];
  if (lastEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Ballot expiry did not emit an event",
    });
  }

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        players: outcome.players,
        ballots: replaceBallot(state.ballots, outcome.ballot),
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}
