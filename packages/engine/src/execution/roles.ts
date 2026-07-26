import type { GameCommand } from "../commands";
import type { GameEvent, ManagementRevealedEvent } from "../events";
import type {
  EngineErrorCode,
  GameState,
  MatchOutcome,
  PlayerId,
  PlayerState,
  RoleKind,
} from "../model";
import { createSeededRandomSource, randomInt } from "../random";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * Hidden roles: Management against Employees.
 *
 * Three things have to be true at once for a hidden role to be a real mechanic
 * rather than a cosmetic label, and this module owns all three:
 *
 * 1. **Assignment is not derivable from public state.** The draw comes from a
 *    source seeded out of `state.rng.streams` — server-owned material that no
 *    projection carries (and `secret-info.ts` seals it as well, so a leak would
 *    take two independent mistakes). The previous rule was
 *    `(order + 1) % 3 === 0` against a seat number published to every client,
 *    which meant every player could compute every other player's role by
 *    counting chairs.
 * 2. **Reveal is a decision its holder makes**, authorised against the holder,
 *    never against the table.
 * 3. **The two sides want different things**, which is the whole point: an
 *    employee wins by climbing out; management wins by making sure nobody does.
 *
 * Everything here is gated on `state.rules.hidden` and reads every switch from
 * the frozen ruleset — a mode with `rolesEnabled: false` gets a table of plain
 * employees, not a quietly-still-running hidden-role game.
 */

const SEED_FIELD_SEPARATOR = "|";

/** Stands in for a stream a state does not carry, so the seed stays total. */
const ABSENT_FIELD = "-";

/**
 * The domain tag for the role draw.
 *
 * Deliberately *not* one of `ephemeral-random.ts`'s purposes: that module's
 * seeds all begin `ephemeral|…`, so no tuple of fields here can ever flatten to
 * the same string as one of theirs, and the role draw cannot correlate with a
 * dice check. Same discipline, disjoint namespace.
 */
const HIDDEN_ROLE_SEED_DOMAIN = "hidden-roles";

function streamFields(state: GameState, streamName: string): readonly string[] {
  const stream = state.rng.streams[streamName];
  if (stream === undefined) return [ABSENT_FIELD, ABSENT_FIELD, ABSENT_FIELD];

  return [stream.algorithm, stream.state, String(stream.cursor)];
}

/**
 * The seed for the hidden-role draw.
 *
 * Every field is server-owned canonical state. In particular the *command id is
 * absent*: it is chosen by the client, and seeding from it would let a player
 * enumerate ids offline against this 32-bit PRNG until they found one that put
 * them (or an ally) in Management. It is also replay-identical, because it
 * depends only on `state`, which is exactly what a replay feeds back in.
 *
 * The `setup` stream is the load-bearing field. It is derived from the server's
 * setup seed, is never published in any projection, and — unlike the dice stream
 * — no observable game output is ever drawn from it, so it cannot be
 * reconstructed backwards from die faces a client has already been shown.
 * `playerOrder` folds in who is actually at the table, so two tables sharing a
 * seed but not a roster still draw differently.
 */
export function hiddenRoleAssignmentSeed(state: GameState): string {
  return [
    HIDDEN_ROLE_SEED_DOMAIN,
    state.gameId,
    ...streamFields(state, "setup"),
    ...streamFields(state, "dice"),
    state.playerOrder.join(","),
  ].join(SEED_FIELD_SEPARATOR);
}

/**
 * How many seats hold Management at a given table size.
 *
 * `floor(n / 3)` reproduces the balance the shipped assignment already had, and
 * is clamped so a table can never be all-management (there would be nobody to
 * contain, and `evaluateRoleWin` would have no contest to adjudicate).
 *
 * This is a table-size function rather than a mode tunable because `ModeRules`
 * has nowhere to put one: `rules.hidden` carries four booleans and no counts.
 * See the returned `gaps` — the ratio wants a home in `ModeRules.hidden`.
 */
export function managementSeatCount(playerCount: number): number {
  if (!Number.isSafeInteger(playerCount) || playerCount <= 0) return 0;

  return Math.min(Math.floor(playerCount / 3), playerCount - 1);
}

export type HiddenRoleAssignment = {
  readonly playerId: PlayerId;
  readonly kind: RoleKind;
};

/**
 * Who is Management, as a pure function of server-owned state.
 *
 * Walks `playerOrder` rather than `Object.keys(players)`: key order is not a
 * stable contract across the repository's JSON round trip, and an assignment
 * that shifted on reload would be worse than no hidden role at all.
 *
 * With `rules.hidden.rolesEnabled` off this returns an all-employee table. That
 * is the mechanic's off switch doing real work: it overwrites whatever the
 * caller's setup proposed, so a mode without hidden roles cannot end up with a
 * half-wired Management seat that nothing in the engine ever consumes.
 */
export function assignHiddenRoles(
  state: GameState,
): readonly HiddenRoleAssignment[] {
  const order = state.playerOrder;

  if (!state.rules.hidden.rolesEnabled) {
    return order.map((playerId) => ({ playerId, kind: "role.worker" as const }));
  }

  // Partial Fisher-Yates over seat *indices*, which keeps the draw uniform over
  // subsets of the size we want without materialising every combination.
  const random = createSeededRandomSource(hiddenRoleAssignmentSeed(state));
  const seats = order.map((_unused, index) => index);
  const wanted = managementSeatCount(order.length);

  for (let index = 0; index < wanted; index += 1) {
    const swapWith = randomInt(random, index, seats.length - 1);
    const held = seats[index];
    const drawn = seats[swapWith];
    if (held === undefined || drawn === undefined) continue;
    seats[index] = drawn;
    seats[swapWith] = held;
  }

  const management = new Set(seats.slice(0, wanted));

  return order.map((playerId, index) => ({
    playerId,
    kind: management.has(index) ? "role.management" : "role.worker",
  }));
}

export type HiddenRoleAssignmentOutcome = {
  readonly state: GameState;
  /** Empty when nothing was applied — see `applyHiddenRoleAssignment`. */
  readonly assignments: readonly HiddenRoleAssignment[];
};

/**
 * Stamps the drawn roles onto canonical state. Call this **once**, from the
 * `game.start` transition, before the status leaves `setup`.
 *
 * The pre-start guard is not decoration: the seed is a function of the state it
 * is drawn against, so calling this a second time — against a state that has
 * since advanced — would re-draw a *different* assignment and silently reshuffle
 * the table mid-match. Refusing outside the pre-start window makes that
 * unrepresentable rather than merely discouraged; the empty `assignments` array
 * is how a caller can tell nothing happened.
 *
 * `RoleState.id` is preserved (it is the player's own stable role id, minted at
 * setup) and `revealed` is forced false: a match begins with nothing disclosed.
 */
export function applyHiddenRoleAssignment(
  state: GameState,
): HiddenRoleAssignmentOutcome {
  if (state.status !== "setup" || state.turn.phase !== "not-started") {
    return { state, assignments: [] };
  }

  const assignments = assignHiddenRoles(state);
  const players: Record<string, PlayerState> = { ...state.players };

  for (const assignment of assignments) {
    const player = players[assignment.playerId];
    if (player === undefined) continue;
    players[assignment.playerId] = {
      ...player,
      role: { id: player.role.id, kind: assignment.kind, revealed: false },
    };
  }

  return { state: { ...state, players }, assignments };
}

/** This player's role kind, or null when they hold none / do not exist. */
export function roleOf(state: GameState, playerId: PlayerId): RoleKind | null {
  return state.players[playerId]?.role.kind ?? null;
}

/**
 * Every player holding `kind`, in `playerOrder` — never in object-key order,
 * which does not survive a JSON round trip as a contract.
 */
export function playersWithRole(
  state: GameState,
  kind: RoleKind,
): readonly PlayerId[] {
  return state.playerOrder.filter(
    (playerId) => state.players[playerId]?.role.kind === kind,
  );
}

export type RevealRoleRequest = {
  /**
   * Whose role is being revealed. Present, and checked against
   * `command.actorId`, precisely so the "reveal someone else" case has somewhere
   * to be rejected rather than being unrepresentable-by-accident in a payload
   * shape that might later grow the field back.
   */
  readonly targetPlayerId: PlayerId;
};

function reject(
  state: GameState,
  command: GameCommand,
  code: EngineErrorCode,
  message: string,
): TransitionResult {
  return rejectCommand(state, command, { code, message });
}

/**
 * A player discloses their own role.
 *
 * Authorisation is the entire substance of this transition (spec §6.3): a role
 * is the one piece of state whose *value* is the mechanic, so being able to
 * reveal another player's role would not be a small privilege escalation, it
 * would be the hidden-role game deleted. `targetPlayerId` must be the actor,
 * checked before anything is mutated.
 *
 * Deliberately does **not** consume the turn or require it to be the actor's
 * turn. Coming clean is a social move whose value is usually in the middle of
 * someone *else's* decision, and it cannot be spammed: a revealed role is
 * revealed permanently, so the second attempt is rejected.
 *
 * Emits `ManagementRevealed` carrying the actual `RoleKind`, so an employee
 * revealing themselves is reported honestly rather than as a management reveal.
 * (The event's *name* predates roles being real — see the returned `gaps`.)
 */
export function revealRole(
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
  request: RevealRoleRequest,
): TransitionResult {
  if (!state.rules.hidden.rolesEnabled) {
    return reject(
      state,
      command,
      "ILLEGAL_ACTION",
      "Hidden roles are disabled by this match's ruleset",
    );
  }
  if (state.status !== "active") {
    return reject(
      state,
      command,
      "GAME_NOT_ACTIVE",
      "A role can only be revealed during an active match",
    );
  }

  const actor = state.players[command.actorId];
  if (actor === undefined) {
    return reject(
      state,
      command,
      "ACTOR_NOT_FOUND",
      "Command actor is not a player in this game",
    );
  }
  // Before any mutation, and before the target is even looked up: entitlement is
  // a property of the actor, not of the thing being acted on.
  if (request.targetPlayerId !== command.actorId) {
    return reject(
      state,
      command,
      "ACTOR_NOT_AUTHORIZED",
      "A role can only be revealed by the player who holds it",
    );
  }
  if (actor.role.revealed) {
    return reject(
      state,
      command,
      "ILLEGAL_ACTION",
      "This player's role has already been revealed",
    );
  }
  if (actor.role.kind === null) {
    return reject(
      state,
      command,
      "INVARIANT_VIOLATION",
      "Player holds no role to reveal",
    );
  }

  const revealed: ManagementRevealedEvent = {
    ...createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + 1,
    ),
    type: "ManagementRevealed",
    payload: { playerId: actor.id, role: actor.role.kind },
  };
  const events: readonly GameEvent[] = [revealed];

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: revealed.sequence,
        players: {
          ...state.players,
          [actor.id]: {
            ...actor,
            role: { ...actor.role, revealed: true },
          },
        },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events,
    },
  };
}

/**
 * Turns every role face up.
 *
 * For the end of a match: a hidden-role game whose reveal never happens is a
 * game nobody can tell they lost, and the end screen renders from
 * `PublicRoleProjection`, which shows a kind only once `revealed` is true.
 *
 * A no-op when the ruleset has roles switched off — there is nothing hidden to
 * disclose, and flipping the flag would make a mode without roles start
 * rendering role badges.
 */
export function revealAllRoles(state: GameState): GameState {
  if (!state.rules.hidden.rolesEnabled) return state;

  const players: Record<string, PlayerState> = { ...state.players };
  for (const playerId of state.playerOrder) {
    const player = players[playerId];
    if (player === undefined || player.role.revealed) continue;
    players[playerId] = { ...player, role: { ...player.role, revealed: true } };
  }

  return { ...state, players };
}

export type RoleWinReason =
  /** An employee reached the top rank: the ladder was climbable after all. */
  | "employee-promoted-out"
  /** A manager took the corner office themselves. */
  | "management-took-the-corner-office"
  /** The match ran out without anyone escaping. Management's actual objective. */
  | "management-contained-the-ladder";

export type RoleWinEvaluation = {
  readonly winningRole: RoleKind;
  /** The whole winning side, in `playerOrder`; eliminated players are excluded. */
  readonly winnerPlayerIds: readonly PlayerId[];
  readonly reason: RoleWinReason;
  /** Who would have won without role win conditions — kept for the end screen. */
  readonly baseWinnerPlayerIds: readonly PlayerId[];
};

/**
 * Who wins on roles, given the outcome the ordinary rules produced.
 *
 * The two objectives are genuinely different, and neither is a restatement of
 * the other:
 *
 * - **Employees** want somebody — anybody — out of the building. One employee
 *   reaching the top rank wins it for every employee, which is what makes
 *   employees worth co-operating with rather than merely racing.
 * - **Management** wants the ladder to hold. Any ending in which no employee was
 *   promoted out is a management win, including a manager taking the top job
 *   themselves. Containment is a real objective you can play towards — block a
 *   promotion, drain the leader — and it is the reason management has anything
 *   to do on a turn beyond racing.
 *
 * Returns `null` — meaning "the base outcome stands unchanged" — whenever the
 * contest cannot be adjudicated honestly:
 *
 * - `hidden.rolesEnabled` or `hidden.roleWinConditions` is off. Both switches
 *   are read from the frozen ruleset; neither is inferred from `modeId`.
 * - `winPaths.promotion` is off. Then employees have no escape route at all and
 *   management would win every match by default, which is a broken config rather
 *   than a rule.
 * - One side is empty (a table too small to seat a manager, or every manager
 *   eliminated). A one-sided contest has no winner to re-attribute.
 */
export function evaluateRoleWin(
  state: GameState,
  base: MatchOutcome,
): RoleWinEvaluation | null {
  const { hidden, winPaths } = state.rules;
  if (!hidden.rolesEnabled || !hidden.roleWinConditions) return null;
  if (!winPaths.promotion) return null;

  const eliminated = new Set<string>(state.eliminatedPlayerIds);
  const side = (kind: RoleKind): readonly PlayerId[] =>
    playersWithRole(state, kind).filter((playerId) => !eliminated.has(playerId));

  const employees = side("role.worker");
  const managers = side("role.management");
  if (employees.length === 0 || managers.length === 0) return null;

  const baseWinnerPlayerIds = [...base.winnerPlayerIds];
  // Only a promotion out of the top rank settles the contest on its merits.
  // Every other ending — quarters elapsed, clock exhausted, scored, last
  // standing — is by definition a match in which nobody climbed out.
  const promotedOut =
    base.reason === "director-reached" ? base.winnerPlayerIds : [];

  const escapee = promotedOut.find(
    (playerId) => state.players[playerId]?.role.kind === "role.worker",
  );
  if (escapee !== undefined) {
    return {
      winningRole: "role.worker",
      winnerPlayerIds: employees,
      reason: "employee-promoted-out",
      baseWinnerPlayerIds,
    };
  }

  const insider = promotedOut.find(
    (playerId) => state.players[playerId]?.role.kind === "role.management",
  );

  return {
    winningRole: "role.management",
    winnerPlayerIds: managers,
    reason: insider === undefined
      ? "management-contained-the-ladder"
      : "management-took-the-corner-office",
    baseWinnerPlayerIds,
  };
}

/**
 * The base outcome with the role contest applied, or the base outcome untouched
 * when role win conditions do not apply.
 *
 * `reason`, `winPath`, `scores` and `endedAt` are left alone: how the match
 * *ended* is not a role question, and `MatchEndReason` is a closed union this
 * mechanic has no business extending. Only who won, and under which flag,
 * changes. The displaced individual winners are preserved under `data.roleWin`
 * so an end screen can still say who actually reached the top.
 */
export function resolveRoleWinOutcome(
  state: GameState,
  base: MatchOutcome,
): MatchOutcome {
  const evaluation = evaluateRoleWin(state, base);
  if (evaluation === null) return base;

  return {
    ...base,
    winnerPlayerIds: evaluation.winnerPlayerIds,
    winningRole: evaluation.winningRole,
    data: {
      ...base.data,
      roleWin: {
        reason: evaluation.reason,
        baseWinnerPlayerIds: evaluation.baseWinnerPlayerIds,
      },
    },
  };
}

/**
 * The single call a win check needs: re-attribute the outcome to the winning
 * side *and* turn every role face up, which always belong together — an outcome
 * naming `winningRole` while the roles are still hidden would tell the table who
 * won without telling them who that was.
 */
export function concludeRoleWin(
  state: GameState,
  base: MatchOutcome,
): { readonly state: GameState; readonly outcome: MatchOutcome } {
  return {
    state: revealAllRoles(state),
    outcome: resolveRoleWinOutcome(state, base),
  };
}
