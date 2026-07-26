import type {
  GameState,
  PlayerId,
  PlayerState,
  ResourceId,
  ResourceState,
} from "../model";

/**
 * How many laps of outstanding skipped turns one hand-off will walk through
 * before giving up (see resolveNextTurn). Content can only ever charge 2 at a
 * time and every hand-off pays one back, so this is far above anything reachable;
 * it exists purely so a corrupt persisted counter cannot make a command loop.
 */
const MAX_SKIP_DEBT_LAPS = 64;

/**
 * One player's energy being refilled because they started a turn exhausted, so
 * the caller can emit the ResourceChanged event for it. The walk itself is pure
 * and knows nothing about events.
 */
export type BurnoutRecovery = {
  readonly playerId: PlayerId;
  readonly resourceId: ResourceId;
  readonly previousValue: number;
  readonly newValue: number;
};

export type NextTurnResolution = {
  readonly nextPlayerId: PlayerId;
  readonly turnNumber: number;
  readonly round: number;
  readonly players: Readonly<Record<string, PlayerState>>;
  /** Empty on the overwhelming majority of turns. */
  readonly burnoutRecoveries: readonly BurnoutRecovery[];
};

function findEnergy(
  player: PlayerState,
): readonly [string, ResourceState] | undefined {
  return Object.entries(player.resources).find(
    ([, resource]) => resource.kind === "resource.energy",
  );
}

/**
 * The burnout rule, which every source states and none of them located in the
 * same place: the design workbook attaches "if energy decrease to zero, skip 1
 * turn to refill energy to full" to the Work tile, while both rulebooks and the
 * GDD make it phase 1 of a turn — *"Check burnout: Energy = 0? → WAJIB skip turn
 * (Energy refill ke full)"* (GDD:628, GDD:214, How_to_Play "Start of Turn /
 * Check burnout (Energy = 0?)").
 *
 * The turn-start reading is the one implemented, for three reasons: the
 * rulebooks are the later documents; energy can reach zero from a card as easily
 * as from a Work tile and the rule should not care which; and the observable
 * outcome — one turn lost, then a full bar — is identical either way, because
 * nothing between the exhausting landing and the forfeited turn can read or
 * change another player's energy.
 *
 * It lives in the turn-order walk rather than in `rollTurn` because the player
 * it applies to is usually *not* the acting player: it has to fire as somebody
 * else's roll hands the turn on, before the exhausted player can roll. That also
 * makes the refill land exactly where the GDD puts it ("refill otomatis ke full
 * setelahnya") — the turn is forfeited and the energy comes back with it, so
 * their next real turn is played at full.
 *
 * Returns null when the player is not exhausted, and deliberately also when the
 * refill could not actually raise their energy (no energy resource, or no
 * maximum to refill to). A skip that changes nothing would repeat on every
 * single pass and strand that player for the rest of the match, so "cannot be
 * fixed" is treated as "not burnout" rather than as an infinite penalty.
 */
function resolveBurnout(player: PlayerState): {
  readonly player: PlayerState;
  readonly recovery: BurnoutRecovery;
} | null {
  const energy = findEnergy(player);
  if (energy === undefined) return null;

  const [key, resource] = energy;
  // Literally the rulebooks' "Energy = 0". `<=` rather than `===` so a resource
  // that somehow went negative is still recognised as exhausted.
  if (resource.value > 0) return null;
  if (resource.maximum === null || resource.maximum <= resource.value) return null;

  return {
    player: {
      ...player,
      resources: {
        ...player.resources,
        [key]: { ...resource, value: resource.maximum },
      },
    },
    recovery: {
      playerId: player.id,
      resourceId: resource.id,
      previousValue: resource.value,
      newValue: resource.maximum,
    },
  };
}

/**
 * Re-applies the walk's burnout refills over a player map the caller has since
 * rebuilt.
 *
 * Both call sites overwrite the acting player's entry with the record they
 * assembled during the transition (`{ ...nextTurn.players, [actor]: updated }`),
 * which would silently drop a refill the walk had granted the actor themselves —
 * possible whenever the walk wraps all the way round to them.
 *
 * Both callers now build that record *from* `nextTurn.players[actor]`, so this is
 * a no-op in practice; it is kept as the guarantee that canonical state can never
 * disagree with a refill already announced as an event, however the callers are
 * later rearranged. Idempotent by construction, so it never touches a player the
 * overwrite left alone.
 */
export function withBurnoutRecoveries(
  players: Readonly<Record<string, PlayerState>>,
  recoveries: readonly BurnoutRecovery[],
): Readonly<Record<string, PlayerState>> {
  if (recoveries.length === 0) return players;

  let updated = players;
  for (const recovery of recoveries) {
    const player = updated[recovery.playerId];
    if (player === undefined) continue;
    const energy = findEnergy(player);
    if (energy === undefined) continue;

    const [key, resource] = energy;
    if (resource.value === recovery.newValue) continue;
    updated = {
      ...updated,
      [recovery.playerId]: {
        ...player,
        resources: {
          ...player.resources,
          [key]: { ...resource, value: recovery.newValue },
        },
      },
    };
  }

  return updated;
}

/**
 * Advances turn order, honoring skipTurns: a player with a positive
 * skipTurns counter is passed over (their counter decrements by one) rather
 * than becoming active. Round/turn-number bookkeeping matches the original
 * no-skip behavior exactly when nobody is actually skipped.
 *
 * `actorState` is the acting player's record *as this transition leaves it*, not
 * as it began. That distinction is load-bearing rather than tidiness: the walk's
 * candidate list is `fromOrderIndex + 1 … fromOrderIndex + order.length`, whose
 * last entry is the actor themselves, reached whenever every other seat is passed
 * over — one outstanding `skipTurns` at a two-seat table is enough. Both counters
 * the walk reads can be set by the very command calling it (the Burnout tile adds
 * `skipTurns`; a Work tile or a card empties energy), so reading `state.players`
 * for the actor let them dodge their own brand-new skip debt and their own
 * exhaustion and take a turn the rules forbid. The returned `players` therefore
 * always carries `actorState`, including on the early return, so a caller that
 * trusts it cannot silently revert this transition's own work.
 *
 * A player who is not skipped for that reason is then checked for burnout (see
 * resolveBurnout) and passed over too, with their energy refilled. The order of
 * the two matters: an explicit skip is a debt the player is already paying, and
 * their turn never starts, so it consumes the pass on its own and leaves the
 * burnout check for whenever a turn of theirs actually would have begun.
 *
 * Two turns are deliberately not checked, because neither is the start of a
 * turn: an extra roll (`grantExtraRoll`, the Receptionist's free roll) is a
 * continuation of the roller's current turn, so exhausting yourself mid-turn does
 * not cancel a roll you have already been granted; and the match's opening turn
 * never runs this walk at all, which is harmless because setup deals every player
 * full energy.
 */
export function resolveNextTurn(
  state: GameState,
  fromOrderIndex: number,
  grantExtraRoll: boolean,
  actorId: PlayerId,
  actorState: PlayerState,
): NextTurnResolution {
  const seats: Readonly<Record<string, PlayerState>> = {
    ...state.players,
    [actorId]: actorState,
  };

  if (grantExtraRoll) {
    return {
      nextPlayerId: actorId,
      turnNumber: state.turn.number,
      round: state.turn.round,
      players: seats,
      burnoutRecoveries: [],
    };
  }

  let players = seats;
  let index = fromOrderIndex;
  const burnoutRecoveries: BurnoutRecovery[] = [];

  // The walk keeps going while every seat is unavailable, instead of stopping
  // after one lap: with a whole table on skipped turns, stopping short handed the
  // turn to a player who still owed one, so a two-turn Burnout penalty was served
  // as one and canonical state held an active player with `skipTurns > 0`.
  //
  // Termination is structural, not hopeful. Every lap decrements each positive
  // `skipTurns` by exactly one, and a burnout pass refills the energy that caused
  // it (so a seat is passed over for burnout at most once), which bounds the walk
  // at the largest counter plus two laps. The bound is still enforced below, so a
  // future skip reason that does not self-clear degrades to the old fall-back
  // rather than spinning.
  const largestSkipDebt = state.playerOrder.reduce((largest, seatId) => {
    const seat = seats[seatId];
    return seat === undefined ? largest : Math.max(largest, seat.skipTurns);
  }, 0);
  // Capped so a persisted counter far outside anything the content pack can
  // produce (authored skips are 2 at a time, and every hand-off pays one back)
  // cannot turn a single command into an unbounded walk.
  const budget = state.playerOrder.length * (Math.min(largestSkipDebt, MAX_SKIP_DEBT_LAPS) + 2);

  for (let step = 0; step < budget; step += 1) {
    index = (index + 1) % state.playerOrder.length;
    const candidateId = state.playerOrder[index];
    if (candidateId === undefined) break;
    const candidate = players[candidateId];
    if (candidate === undefined) break;

    if (candidate.skipTurns > 0) {
      players = {
        ...players,
        [candidateId]: { ...candidate, skipTurns: candidate.skipTurns - 1 },
      };
      continue;
    }

    const burnout = resolveBurnout(candidate);
    if (burnout !== null) {
      players = { ...players, [candidateId]: burnout.player };
      burnoutRecoveries.push(burnout.recovery);
      continue;
    }

    return {
      nextPlayerId: candidateId,
      turnNumber: state.turn.number + 1,
      round: index === 0 ? state.turn.round + 1 : state.turn.round,
      players,
      burnoutRecoveries,
    };
  }

  // Unreachable for every skip reason the engine has today (see the bound above);
  // kept as the last-resort guard against a future one that never clears, because
  // a game with no legal turn is worse than a penalty served short. The decrements
  // and refills already made are kept: they were paid for by the turns passed
  // over, and discarding them would let the same players be skipped forever.
  const fallbackIndex = (fromOrderIndex + 1) % state.playerOrder.length;
  const fallbackId = state.playerOrder[fallbackIndex] ?? actorId;
  return {
    nextPlayerId: fallbackId,
    turnNumber: state.turn.number + 1,
    round: fallbackIndex === 0 ? state.turn.round + 1 : state.turn.round,
    players,
    burnoutRecoveries,
  };
}
