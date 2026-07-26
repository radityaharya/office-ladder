import { deadlineDashContent } from "@office-ladder/content";
import { describe, expect, it } from "vitest";

import {
  deserializeGameState,
  projectPublicView,
  serializeGameState,
} from "../src";
import type {
  CommandId,
  GameState,
  MatchOutcome,
  PlayerId,
  PlayerState,
  RoleId,
  RoleKind,
  TakeTurnActionCommand,
} from "../src";
import {
  applyHiddenRoleAssignment,
  assignHiddenRoles,
  concludeRoleWin,
  evaluateRoleWin,
  hiddenRoleAssignmentSeed,
  managementSeatCount,
  playersWithRole,
  resolveRoleWinOutcome,
  revealAllRoles,
  revealRole,
  roleOf,
} from "../src/execution/roles";
import { createCanonicalGameState, fixtureIds } from "./fixtures";
import { logicalTimestamp, withRules } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const context = { logicalTimestamp, content: deadlineDashContent };

/**
 * A pre-start table of `playerCount` seats.
 *
 * Built from the canonical fixture so every unrelated field is realistic, but
 * with hands, decks and cards emptied: the assignment tests care about seats and
 * seeds, and cloning the fixture player would otherwise give six players the
 * same card instance.
 */
function tableState(
  playerCount: number,
  options: {
    readonly setupStreamState?: string;
    readonly rolesEnabled?: boolean;
    readonly seedRole?: RoleKind;
  } = {},
): GameState {
  const base = createCanonicalGameState();
  const template = base.players[fixtureIds.owner];
  const playerIds = Array.from({ length: playerCount }, (_unused, index) =>
    brand<PlayerId>(`player-${index}`),
  );

  const players: Record<string, PlayerState> = {};
  playerIds.forEach((playerId, order) => {
    players[playerId] = {
      ...template,
      id: playerId,
      order,
      role: {
        id: brand<RoleId>(`${playerId}:role`),
        kind: options.seedRole ?? "role.worker",
        revealed: false,
      },
      hand: [],
      statuses: [],
      abilities: [],
    };
  });

  const state: GameState = {
    ...base,
    status: "setup",
    turn: {
      ...base.turn,
      number: 0,
      round: 0,
      activePlayerId: null,
      phase: "not-started",
    },
    playerOrder: playerIds,
    players,
    startAuthorizedPlayerId: playerIds[0],
    decks: {},
    cards: {},
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    resolutionStack: [],
    rng: {
      streams: {
        setup: {
          algorithm: "xorshift32",
          version: "1",
          state: options.setupStreamState ?? "2463534242",
          cursor: 0,
        },
        dice: {
          algorithm: "xorshift32",
          version: "1",
          state: "1013904223",
          cursor: 0,
        },
      },
    },
    lastCommandId: null,
  };

  return withRules(state, {
    hidden: { rolesEnabled: options.rolesEnabled ?? true },
  });
}

/** The seats holding Management, as a comparable string. */
function managementSeats(state: GameState): string {
  return assignHiddenRoles(state)
    .map((assignment, index) => (assignment.kind === "role.management" ? index : -1))
    .filter((seat) => seat >= 0)
    .join(",");
}

function revealCommand(
  state: GameState,
  actorId: PlayerId,
  commandId = "command-reveal",
): TakeTurnActionCommand {
  return {
    commandId: brand<CommandId>(commandId),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
    type: "turn.action",
    payload: { action: "role.reveal", targetPlayerIds: [], choice: null },
  };
}

/** A three-seat table mid-match, one manager, ready to reveal or to end. */
function activeRoleTable(
  options: { readonly rolesEnabled?: boolean; readonly roleWinConditions?: boolean } = {},
): GameState {
  const state = tableState(3, { rolesEnabled: options.rolesEnabled ?? true });
  const [first, second, third] = state.playerOrder;

  const withRoles: GameState = {
    ...state,
    status: "active",
    turn: { ...state.turn, number: 1, round: 1, activePlayerId: first, phase: "pre-roll" },
    players: {
      ...state.players,
      [first]: {
        ...state.players[first],
        role: { ...state.players[first].role, kind: "role.worker" },
      },
      [second]: {
        ...state.players[second],
        role: { ...state.players[second].role, kind: "role.management" },
      },
      [third]: {
        ...state.players[third],
        role: { ...state.players[third].role, kind: "role.worker" },
      },
    },
  };

  return withRules(withRoles, {
    hidden: {
      rolesEnabled: options.rolesEnabled ?? true,
      roleWinConditions: options.roleWinConditions ?? true,
    },
  });
}

function outcome(overrides: Partial<MatchOutcome> = {}): MatchOutcome {
  return {
    reason: "director-reached",
    winnerPlayerIds: [],
    winningRole: null,
    endedAt: logicalTimestamp,
    scores: [],
    winPath: "promotion",
    data: {},
    ...overrides,
  };
}

describe("hidden role assignment", () => {
  it("seats floor(n / 3) managers and never the whole table", () => {
    expect(managementSeatCount(2)).toBe(0);
    expect(managementSeatCount(3)).toBe(1);
    expect(managementSeatCount(5)).toBe(1);
    expect(managementSeatCount(6)).toBe(2);
    // Clamped: a one-seat table cannot be all management, or there would be no
    // contest for evaluateRoleWin to adjudicate.
    expect(managementSeatCount(1)).toBe(0);
    expect(managementSeatCount(0)).toBe(0);
  });

  it("assigns exactly that many managers, in playerOrder", () => {
    const state = tableState(6);
    const assignments = assignHiddenRoles(state);

    expect(assignments.map((entry) => entry.playerId)).toEqual([...state.playerOrder]);
    expect(assignments.filter((entry) => entry.kind === "role.management")).toHaveLength(2);
  });

  it("is switched off from config: rolesEnabled false yields an all-employee table", () => {
    // The setup layer proposed a table of managers. A ruleset without hidden
    // roles must overwrite that rather than leave a half-wired Management seat
    // nothing in the engine consumes.
    const state = tableState(6, { rolesEnabled: false, seedRole: "role.management" });

    expect(assignHiddenRoles(state).every((entry) => entry.kind === "role.worker")).toBe(true);

    const applied = applyHiddenRoleAssignment(state);
    expect(playersWithRole(applied.state, "role.management")).toEqual([]);
    expect(playersWithRole(applied.state, "role.worker")).toEqual([...state.playerOrder]);
  });

  it("seats nobody when the table is too small to hold a manager", () => {
    const state = tableState(2);

    expect(assignHiddenRoles(state).every((entry) => entry.kind === "role.worker")).toBe(true);
  });

  it("is deterministic, and survives a JSON round trip unchanged", () => {
    const state = tableState(6);
    const roundTripped = deserializeGameState(serializeGameState(state));

    expect(hiddenRoleAssignmentSeed(roundTripped)).toBe(hiddenRoleAssignmentSeed(state));
    expect(assignHiddenRoles(roundTripped)).toEqual(assignHiddenRoles(state));
    expect(assignHiddenRoles(state)).toEqual(assignHiddenRoles(state));
  });

  it("is not derivable from public state", () => {
    // Two tables whose *entire public projection* is byte-identical, differing
    // only in the setup stream's internal state — which no projection carries.
    // If the assignment can still differ between them, then no amount of public
    // information determines it.
    const seeds = Array.from({ length: 24 }, (_unused, index) =>
      String(1_000_003 + index * 7_919),
    );
    const states = seeds.map((setupStreamState) =>
      tableState(6, { setupStreamState }),
    );

    const publicViews = states.map((state) =>
      JSON.stringify(projectPublicView(state)),
    );
    expect(new Set(publicViews).size).toBe(1);

    const distinct = new Set(states.map(managementSeats));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("does not pin management to fixed seats", () => {
    // The regression this mechanic exists to kill: `(order + 1) % 3 === 0`
    // against a seat number published as `member.seat` meant seats 2 and 5 were
    // *always* management and every player could count chairs. Every seat must
    // be reachable.
    const everManagement = new Set<number>();
    for (let index = 0; index < 120; index += 1) {
      const state = tableState(6, { setupStreamState: String(7 + index * 104_729) });
      assignHiddenRoles(state).forEach((assignment, seat) => {
        if (assignment.kind === "role.management") everManagement.add(seat);
      });
    }

    expect([...everManagement].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("applies the draw to canonical state, preserving role ids and hiding everything", () => {
    const state = tableState(6);
    const { state: applied, assignments } = applyHiddenRoleAssignment(state);

    expect(assignments).toHaveLength(6);
    for (const playerId of applied.playerOrder) {
      expect(applied.players[playerId].role.id).toBe(state.players[playerId].role.id);
      expect(applied.players[playerId].role.revealed).toBe(false);
    }
    expect(playersWithRole(applied, "role.management")).toHaveLength(2);
  });

  it("refuses to redraw after the match has started", () => {
    // The seed is a function of the state it is drawn against, so a second draw
    // against a later state would silently reshuffle the table mid-match.
    const started: GameState = { ...tableState(6), status: "active" };
    const result = applyHiddenRoleAssignment(started);

    expect(result.assignments).toEqual([]);
    expect(result.state).toBe(started);
  });
});

describe("role reveal", () => {
  it("lets a player reveal their own role", () => {
    const state = activeRoleTable();
    const actorId = state.playerOrder[1];
    const result = revealRole(state, revealCommand(state, actorId), context, {
      targetPlayerId: actorId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.state.players[actorId].role.revealed).toBe(true);
    expect(result.value.state.revision).toBe(state.revision + 1);
    expect(result.value.state.lastCommandId).toBe("command-reveal");
    expect(result.value.events).toEqual([
      expect.objectContaining({
        type: "ManagementRevealed",
        payload: { playerId: actorId, role: "role.management" },
      }),
    ]);
  });

  it("reports an employee reveal honestly rather than as a management reveal", () => {
    const state = activeRoleTable();
    const actorId = state.playerOrder[0];
    const result = revealRole(state, revealCommand(state, actorId), context, {
      targetPlayerId: actorId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events[0]).toEqual(
      expect.objectContaining({ payload: { playerId: actorId, role: "role.worker" } }),
    );
  });

  it("rejects revealing somebody else's role, and leaves it hidden", () => {
    const state = activeRoleTable();
    const actorId = state.playerOrder[0];
    const targetId = state.playerOrder[1];

    const result = revealRole(state, revealCommand(state, actorId), context, {
      targetPlayerId: targetId,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "ACTOR_NOT_AUTHORIZED" }),
      }),
    );
    expect(state.players[targetId].role.revealed).toBe(false);
  });

  it("rejects a reveal from somebody who is not at the table", () => {
    const state = activeRoleTable();
    const stranger = brand<PlayerId>("player-stranger");

    expect(
      revealRole(state, revealCommand(state, stranger), context, {
        targetPlayerId: stranger,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "ACTOR_NOT_FOUND" }),
      }),
    );
  });

  it("rejects a reveal when the ruleset has hidden roles switched off", () => {
    const state = activeRoleTable({ rolesEnabled: false });
    const actorId = state.playerOrder[1];

    expect(
      revealRole(state, revealCommand(state, actorId), context, {
        targetPlayerId: actorId,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "ILLEGAL_ACTION" }),
      }),
    );
  });

  it("rejects a second reveal — there is nothing left to disclose", () => {
    const state = activeRoleTable();
    const actorId = state.playerOrder[1];
    const first = revealRole(state, revealCommand(state, actorId), context, {
      targetPlayerId: actorId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(
      revealRole(first.value.state, revealCommand(first.value.state, actorId, "command-reveal-2"), context, {
        targetPlayerId: actorId,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "ILLEGAL_ACTION" }),
      }),
    );
  });

  it("rejects a reveal outside an active match", () => {
    const state: GameState = { ...activeRoleTable(), status: "ended" };
    const actorId = state.playerOrder[1];

    expect(
      revealRole(state, revealCommand(state, actorId), context, {
        targetPlayerId: actorId,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "GAME_NOT_ACTIVE" }),
      }),
    );
  });

  it("does not consume the turn", () => {
    const state = activeRoleTable();
    const actorId = state.playerOrder[1];
    const result = revealRole(state, revealCommand(state, actorId), context, {
      targetPlayerId: actorId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.turn).toEqual(state.turn);
  });

  it("survives a JSON round trip with the reveal intact", () => {
    const state = activeRoleTable();
    const actorId = state.playerOrder[1];
    const result = revealRole(state, revealCommand(state, actorId), context, {
      targetPlayerId: actorId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const roundTripped = deserializeGameState(serializeGameState(result.value.state));
    expect(roundTripped).toEqual(result.value.state);
    expect(roundTripped.players[actorId].role).toEqual({
      id: state.players[actorId].role.id,
      kind: "role.management",
      revealed: true,
    });
  });

  it("reveals every role at once for the end screen, and nothing when roles are off", () => {
    const enabled = revealAllRoles(activeRoleTable());
    expect(
      enabled.playerOrder.every((playerId) => enabled.players[playerId].role.revealed),
    ).toBe(true);

    const disabled = activeRoleTable({ rolesEnabled: false });
    expect(revealAllRoles(disabled)).toBe(disabled);
  });
});

describe("role win conditions", () => {
  it("gives every employee the win when one of them is promoted out", () => {
    const state = activeRoleTable();
    const escapee = state.playerOrder[0];
    const base = outcome({ winnerPlayerIds: [escapee] });

    const evaluation = evaluateRoleWin(state, base);
    expect(evaluation).toEqual({
      winningRole: "role.worker",
      winnerPlayerIds: [state.playerOrder[0], state.playerOrder[2]],
      reason: "employee-promoted-out",
      baseWinnerPlayerIds: [escapee],
    });

    const resolved = resolveRoleWinOutcome(state, base);
    expect(resolved.winningRole).toBe("role.worker");
    expect(resolved.winnerPlayerIds).toEqual([state.playerOrder[0], state.playerOrder[2]]);
    // How the match ended is not a role question.
    expect(resolved.reason).toBe(base.reason);
    expect(resolved.winPath).toBe(base.winPath);
    expect(resolved.data).toEqual({
      roleWin: { reason: "employee-promoted-out", baseWinnerPlayerIds: [escapee] },
    });
  });

  it("gives management the win when a manager takes the corner office", () => {
    const state = activeRoleTable();
    const insider = state.playerOrder[1];

    const resolved = resolveRoleWinOutcome(state, outcome({ winnerPlayerIds: [insider] }));
    expect(resolved.winningRole).toBe("role.management");
    expect(resolved.winnerPlayerIds).toEqual([insider]);
    expect(resolved.data).toEqual({
      roleWin: {
        reason: "management-took-the-corner-office",
        baseWinnerPlayerIds: [insider],
      },
    });
  });

  it("gives management the win when the match simply runs out — the ladder held", () => {
    const state = activeRoleTable();
    const leader = state.playerOrder[0];
    const base = outcome({
      reason: "quarters-elapsed",
      winnerPlayerIds: [leader],
      winPath: "wealth",
    });

    const resolved = resolveRoleWinOutcome(state, base);
    expect(resolved.winningRole).toBe("role.management");
    expect(resolved.winnerPlayerIds).toEqual([state.playerOrder[1]]);
    expect(resolved.data).toEqual({
      roleWin: {
        reason: "management-contained-the-ladder",
        baseWinnerPlayerIds: [leader],
      },
    });
  });

  it("is switched off from config", () => {
    const base = outcome({ winnerPlayerIds: [brand<PlayerId>("player-0")] });

    const noWinConditions = activeRoleTable({ roleWinConditions: false });
    expect(evaluateRoleWin(noWinConditions, base)).toBeNull();
    expect(resolveRoleWinOutcome(noWinConditions, base)).toBe(base);

    const noRoles = activeRoleTable({ rolesEnabled: false });
    expect(evaluateRoleWin(noRoles, base)).toBeNull();
    expect(resolveRoleWinOutcome(noRoles, base)).toBe(base);
  });

  it("refuses to adjudicate when employees have no escape route at all", () => {
    // With the promotion win path off nobody can ever be promoted out, so
    // management would win every match by default. That is a broken config, not
    // a rule, and the base outcome stands.
    const state = withRules(activeRoleTable(), { winPaths: { promotion: false } });
    const base = outcome({ winnerPlayerIds: [state.playerOrder[0]] });

    expect(evaluateRoleWin(state, base)).toBeNull();
    expect(resolveRoleWinOutcome(state, base)).toBe(base);
  });

  it("refuses to adjudicate a one-sided table", () => {
    const state = activeRoleTable();
    const onlyEmployees: GameState = {
      ...state,
      players: {
        ...state.players,
        [state.playerOrder[1]]: {
          ...state.players[state.playerOrder[1]],
          role: { ...state.players[state.playerOrder[1]].role, kind: "role.worker" },
        },
      },
    };
    const base = outcome({ winnerPlayerIds: [state.playerOrder[0]] });

    expect(evaluateRoleWin(onlyEmployees, base)).toBeNull();
    expect(resolveRoleWinOutcome(onlyEmployees, base)).toBe(base);
  });

  it("excludes eliminated players from the winning side", () => {
    const state: GameState = {
      ...activeRoleTable(),
      eliminatedPlayerIds: [brand<PlayerId>("player-2")],
    };
    const base = outcome({ winnerPlayerIds: [state.playerOrder[0]] });

    expect(resolveRoleWinOutcome(state, base).winnerPlayerIds).toEqual([
      state.playerOrder[0],
    ]);
  });

  it("refuses to adjudicate when elimination has emptied one side", () => {
    const state: GameState = {
      ...activeRoleTable(),
      eliminatedPlayerIds: [brand<PlayerId>("player-1")],
    };
    const base = outcome({ winnerPlayerIds: [state.playerOrder[0]] });

    expect(evaluateRoleWin(state, base)).toBeNull();
  });

  it("concludes by revealing every role alongside the re-attributed outcome", () => {
    const state = activeRoleTable();
    const base = outcome({ winnerPlayerIds: [state.playerOrder[0]] });
    const concluded = concludeRoleWin(state, base);

    expect(concluded.outcome.winningRole).toBe("role.worker");
    for (const playerId of concluded.state.playerOrder) {
      expect(concluded.state.players[playerId].role.revealed).toBe(true);
      expect(roleOf(concluded.state, playerId)).not.toBeNull();
    }
  });

  it("survives a JSON round trip of the concluded state and outcome", () => {
    const state = activeRoleTable();
    const base = outcome({ winnerPlayerIds: [state.playerOrder[0]] });
    const concluded = concludeRoleWin(state, base);
    const ended: GameState = {
      ...concluded.state,
      status: "ended",
      outcome: concluded.outcome,
    };

    const roundTripped = deserializeGameState(serializeGameState(ended));
    expect(roundTripped).toEqual(ended);
    expect(roundTripped.outcome?.winningRole).toBe("role.worker");
    expect(roundTripped.outcome?.data).toEqual({
      roleWin: {
        reason: "employee-promoted-out",
        baseWinnerPlayerIds: [state.playerOrder[0]],
      },
    });
  });
});
