import { describe, expect, it } from "vitest";

import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";
import type { ModeRules } from "@office-ladder/content";

import {
  GAME_STATE_SCHEMA_VERSION,
  deserializeGameState,
  projectPlayerView,
  projectPublicView,
  serializeGameState,
  stableStringify,
} from "../src";
import type {
  CharacterId,
  CommandId,
  ContentReleaseId,
  ContributeToProjectCommand,
  GameId,
  GameState,
  PlayerId,
  PlayerState,
  ProjectId,
  ProjectState,
  RankId,
  ResourceId,
  RoleId,
  RulesetId,
  SabotageProjectCommand,
  StartProjectCommand,
  TileId,
  TransitionResult,
} from "../src";
import type { ProjectDefinition } from "../src/execution/projects";
import {
  DEFAULT_PROJECT_DEFINITIONS,
  affordableProjectDefinitions,
  canStartProject,
  contributableProjects,
  contributeToProject,
  findProjectDefinition,
  resolveDueProjects,
  sabotageProject,
  sabotageableProjects,
  startProject,
} from "../src/execution/projects";

const brand = <Id extends string>(value: string) => value as Id;

const LEAD = brand<PlayerId>("player-lead");
const JOINER = brand<PlayerId>("player-joiner");
const RIVAL = brand<PlayerId>("player-rival");
const ORDER = [LEAD, JOINER, RIVAL] as const;

const LOGICAL_TIMESTAMP = "2026-07-26T09:00:00.000Z";

/**
 * `mode.standard` is the preset with projects, heat and joining all on, so it is
 * the ruleset every "the mechanic works" test below runs under. Every "the
 * mechanic is switched off" test flips exactly one flag through `withRules`, so
 * a gate that stopped reading `state.rules` would fail loudly rather than
 * quietly passing under a hardcoded default.
 */
const standardRules: ModeRules = deadlineDashModes["mode.standard"].rules;

const QUARTERLY = "project.quarterly-report";
const quarterly = findProjectDefinition(QUARTERLY);
if (quarterly === null) throw new Error("missing the quarterly-report definition");

type RulesOverrides = {
  readonly [Block in keyof ModeRules]?: ModeRules[Block] extends object
    ? Partial<ModeRules[Block]>
    : ModeRules[Block];
};

function withRules(state: GameState, overrides: RulesOverrides): GameState {
  const merged: Record<string, unknown> = { ...state.rules };
  for (const [block, override] of Object.entries(overrides)) {
    const current = merged[block];
    merged[block] =
      current !== null && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>), ...(override as Record<string, unknown>) }
        : override;
  }

  return { ...state, rules: merged as unknown as ModeRules };
}

type Wallet = {
  readonly money?: number;
  readonly reputation?: number;
  readonly work?: number;
  readonly heat?: number;
};

function player(
  id: PlayerId,
  order: number,
  rules: ModeRules,
  wallet: Wallet = {},
): PlayerState {
  return {
    id,
    order,
    connected: true,
    position: 0,
    lapsCompleted: 0,
    rank: { id: brand<RankId>("rank.intern"), kind: "rank.intern", index: 0 },
    role: { id: brand<RoleId>(`role-${id}`), kind: "role.worker", revealed: false },
    characterId: brand<CharacterId>("character.workaholic"),
    resources: {
      money: {
        id: brand<ResourceId>(`${id}-money`),
        kind: "resource.money",
        value: wallet.money ?? 2_000,
        minimum: 0,
        maximum: null,
      },
      reputation: {
        id: brand<ResourceId>(`${id}-reputation`),
        kind: "resource.reputation",
        value: wallet.reputation ?? 6,
        minimum: 0,
        maximum: null,
      },
      energy: {
        id: brand<ResourceId>(`${id}-energy`),
        kind: "resource.energy",
        value: 5,
        minimum: 0,
        maximum: 5,
      },
      "work-counter": {
        id: brand<ResourceId>(`${id}-work-counter`),
        kind: "resource.work-counter",
        value: wallet.work ?? 12,
        minimum: 0,
        maximum: null,
      },
    },
    tokens: {},
    hand: [],
    statuses: [],
    abilities: [],
    skipTurns: 0,
    inAudit: false,
    negativeEffectsIgnoredThisLap: 0,
    upkeep: { perRound: 0, lastChargedRound: 0, missedPayments: 0 },
    loans: [],
    incomeStreams: [],
    heat: {
      value: wallet.heat ?? 0,
      threshold: rules.conflict.heatThreshold,
      investigationsOpened: 0,
      lastIncrementedAtRound: null,
    },
  };
}

type StateOptions = {
  readonly rules?: ModeRules;
  readonly round?: number;
  readonly active?: PlayerId;
  readonly wallets?: Partial<Record<string, Wallet>>;
  readonly projects?: readonly ProjectState[];
};

/**
 * A self-contained three-seat pre-roll state.
 *
 * Deliberately not built on `tests/fixtures.ts`: eleven other agents are editing
 * that file in this working tree right now, and a project test that fails
 * because somebody else re-shaped a shared fixture tells nobody anything.
 */
function gameState(options: StateOptions = {}): GameState {
  const rules = options.rules ?? standardRules;
  const wallets = options.wallets ?? {};

  return {
    gameId: brand<GameId>("game-projects"),
    modeId: brand("mode.standard"),
    rules,
    versions: {
      stateSchemaVersion: GAME_STATE_SCHEMA_VERSION,
      replaySchemaVersion: 1,
      engineVersion: "engine-test",
      rulesVersion: "rules-test",
      rulesetId: brand<RulesetId>("ruleset-test"),
      contentReleaseId: brand<ContentReleaseId>("content-test"),
      contentHash: "content-hash-test",
    },
    status: "active",
    revision: 11,
    eventSequence: 40,
    startAuthorizedPlayerId: LEAD,
    playerOrder: [...ORDER],
    players: {
      [LEAD]: player(LEAD, 0, rules, wallets[LEAD] ?? {}),
      [JOINER]: player(JOINER, 1, rules, wallets[JOINER] ?? {}),
      [RIVAL]: player(RIVAL, 2, rules, wallets[RIVAL] ?? {}),
    },
    turn: {
      number: 7,
      round: options.round ?? 2,
      activePlayerId: options.active ?? LEAD,
      phase: "pre-roll",
      startedAt: LOGICAL_TIMESTAMP,
      deadlineAt: null,
    },
    boardSize: 8,
    tileIds: Array.from({ length: 8 }, (_, index) => brand<TileId>(`tile-${index}`)),
    decks: {},
    cards: {},
    resolutionStack: [],
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    tileOwnership: {},
    placements: [],
    projects: options.projects ?? [],
    agreements: [],
    objectives: [],
    ballots: [],
    quarters: [],
    currentQuarterIndex: 0,
    eliminatedPlayerIds: [],
    rng: {
      streams: {
        dice: { algorithm: "xorshift32", version: "1", state: "305419896", cursor: 0 },
      },
    },
    marathonEndgame: null,
    outcome: null,
    quarantine: null,
    lastCommandId: null,
    stateHash: null,
  };
}

function context(timestamp = LOGICAL_TIMESTAMP) {
  return { logicalTimestamp: timestamp, content: deadlineDashContent };
}

function startCommand(
  state: GameState,
  overrides: Partial<StartProjectCommand> = {},
): StartProjectCommand {
  return {
    commandId: brand<CommandId>("command-project-start"),
    gameId: state.gameId,
    actorId: state.turn.activePlayerId ?? LEAD,
    expectedRevision: state.revision,
    type: "project.start",
    payload: { definitionId: QUARTERLY, tileId: null, openToJoin: true },
    ...overrides,
  };
}

function contributeCommand(
  state: GameState,
  projectId: ProjectId,
  overrides: Partial<ContributeToProjectCommand> = {},
): ContributeToProjectCommand {
  return {
    commandId: brand<CommandId>("command-project-contribute"),
    gameId: state.gameId,
    actorId: state.turn.activePlayerId ?? LEAD,
    expectedRevision: state.revision,
    type: "project.contribute",
    payload: { projectId, money: 150, work: 0 },
    ...overrides,
  };
}

function sabotageCommand(
  state: GameState,
  projectId: ProjectId,
  overrides: Partial<SabotageProjectCommand> = {},
): SabotageProjectCommand {
  return {
    commandId: brand<CommandId>("command-project-sabotage"),
    gameId: state.gameId,
    actorId: state.turn.activePlayerId ?? RIVAL,
    expectedRevision: state.revision,
    type: "project.sabotage",
    payload: { projectId, amount: 1, hidden: false },
    ...overrides,
  };
}

function accepted(result: TransitionResult): GameState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value.state;
}

function acceptedWith(result: TransitionResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value;
}

function rejectedWith(result: TransitionResult, code: string): void {
  expect(result).toEqual(
    expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code }),
    }),
  );
}

function onlyProject(state: GameState): ProjectState {
  const project = state.projects[0];
  if (project === undefined) throw new Error("expected exactly one project");

  return project;
}

function money(state: GameState, playerId: PlayerId): number {
  return state.players[playerId]?.resources.money?.value ?? 0;
}

function reputation(state: GameState, playerId: PlayerId): number {
  return state.players[playerId]?.resources.reputation?.value ?? 0;
}

function work(state: GameState, playerId: PlayerId): number {
  return state.players[playerId]?.resources["work-counter"]?.value ?? 0;
}

function heatOf(state: GameState, playerId: PlayerId): number {
  return state.players[playerId]?.heat.value ?? 0;
}

/** The state as another player would act from: same table, different seat. */
function handOff(state: GameState, to: PlayerId): GameState {
  return { ...state, turn: { ...state.turn, activePlayerId: to } };
}

function roundsOn(state: GameState, round: number): GameState {
  return { ...state, turn: { ...state.turn, round } };
}

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner, seen);
  }

  return Object.freeze(value);
}

function assertRoundTrips(state: GameState): void {
  expect(deserializeGameState(serializeGameState(state))).toEqual(state);
}

/**
 * The whole lifecycle: lead stakes, lead does the work, a joiner funds the rest.
 * Returns the state with a `funded` project and the round its deadline falls in.
 */
function fundedProject(base: GameState = gameState()): {
  readonly state: GameState;
  readonly projectId: ProjectId;
} {
  const started = accepted(startProject(base, startCommand(base), context()));
  const project = onlyProject(started);

  const leadWorks = accepted(
    contributeToProject(
      started,
      contributeCommand(started, project.id, {
        commandId: brand<CommandId>("command-lead-work"),
        payload: { projectId: project.id, money: 0, work: 3 },
      }),
      context(),
    ),
  );

  const joinerSeat = handOff(leadWorks, JOINER);
  const funded = accepted(
    contributeToProject(
      joinerSeat,
      contributeCommand(joinerSeat, project.id, {
        commandId: brand<CommandId>("command-joiner-money"),
        actorId: JOINER,
        payload: { projectId: project.id, money: 150, work: 0 },
      }),
      context(),
    ),
  );

  // Handed back to the lead, so a test that wants another seat says so.
  return { state: handOff(funded, LEAD), projectId: project.id };
}

describe("project.start", () => {
  it("Given an active player under a projects-enabled mode, When they start a project, Then the stake is charged and a live project is opened", () => {
    const state = gameState();

    const next = accepted(startProject(state, startCommand(state), context()));
    const project = onlyProject(next);

    expect(money(next, LEAD)).toBe(2_000 - quarterly.leadStakeMoney);
    expect(project.leadPlayerId).toBe(LEAD);
    expect(project.definitionId).toBe(QUARTERLY);
    expect(project.status).toBe("open");
    expect(project.requiredMoney).toBe(quarterly.requiredMoney);
    expect(project.requiredWork).toBe(quarterly.requiredWork);
    expect(project.payout).toEqual(quarterly.payout);
    expect(project.leadBonusBasisPoints).toBe(quarterly.leadBonusBasisPoints);
    // The lead's stake is contribution #0: they are, by construction, the
    // earliest and least-diluted entry in the pot.
    expect(project.contributions).toEqual([
      { playerId: LEAD, money: quarterly.leadStakeMoney, work: 0, atRound: 2 },
    ]);
    expect(project.sabotage).toEqual([]);
    expect(next.revision).toBe(state.revision + 1);
  });

  it("Given the mode's deadlineRounds, When a project is started, Then its deadline is that many rounds out and comes from rules alone", () => {
    const state = gameState({ round: 5 });
    const stretched = withRules(state, { projects: { deadlineRounds: 9 } });

    expect(
      onlyProject(accepted(startProject(state, startCommand(state), context()))).deadlineRound,
    ).toBe(5 + standardRules.projects.deadlineRounds);
    expect(
      onlyProject(accepted(startProject(stretched, startCommand(stretched), context())))
        .deadlineRound,
    ).toBe(5 + 9);
  });

  it("Given a start command from someone who is not the active player, Then it is rejected", () => {
    const state = gameState({ active: LEAD });

    rejectedWith(
      startProject(state, startCommand(state, { actorId: RIVAL }), context()),
      "NOT_ACTOR_TURN",
    );
  });

  it("Given a mode with projects disabled, Then starting one is rejected and nothing is charged", () => {
    const state = withRules(gameState(), { projects: { enabled: false } });

    const result = startProject(state, startCommand(state), context());

    rejectedWith(result, "ILLEGAL_ACTION");
    expect(money(state, LEAD)).toBe(2_000);
  });

  it("Given a mode allowing no concurrent projects per player, Then starting one is rejected", () => {
    const state = withRules(gameState(), { projects: { maxConcurrentPerPlayer: 0 } });

    rejectedWith(startProject(state, startCommand(state), context()), "ILLEGAL_ACTION");
  });

  it("Given a lead already at maxConcurrentPerPlayer, When they start another, Then it is rejected", () => {
    const capped = withRules(gameState(), { projects: { maxConcurrentPerPlayer: 1 } });
    const first = accepted(startProject(capped, startCommand(capped), context()));

    rejectedWith(
      startProject(
        first,
        startCommand(first, { commandId: brand<CommandId>("second-start") }),
        context(),
      ),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a resolved project, Then it no longer counts against the concurrency cap", () => {
    const capped = withRules(gameState(), { projects: { maxConcurrentPerPlayer: 1 } });
    const first = accepted(startProject(capped, startCommand(capped), context()));
    const project = onlyProject(first);
    const past = roundsOn(first, project.deadlineRound + 1);
    const settled: GameState = {
      ...past,
      ...resolveDueProjects(past, past.turn.round),
    };

    expect(onlyProject(settled).status).toBe("failed");
    expect(
      accepted(
        startProject(
          settled,
          startCommand(settled, { commandId: brand<CommandId>("second-start") }),
          context(),
        ),
      ).projects,
    ).toHaveLength(2);
  });

  it("Given a lead who cannot cover the stake, Then the start is rejected as INSUFFICIENT_RESOURCE", () => {
    const state = gameState({ wallets: { [LEAD]: { money: quarterly.leadStakeMoney - 1 } } });

    rejectedWith(startProject(state, startCommand(state), context()), "INSUFFICIENT_RESOURCE");
  });

  it("Given a definition this build does not ship, Then the start is rejected", () => {
    const state = gameState();

    rejectedWith(
      startProject(
        state,
        startCommand(state, {
          payload: { definitionId: "project.not-a-thing", tileId: null, openToJoin: true },
        }),
        context(),
      ),
      "INVALID_COMMAND",
    );
  });

  it("Given a tile that is not on this board, Then the start is rejected", () => {
    const state = gameState();

    rejectedWith(
      startProject(
        state,
        startCommand(state, {
          payload: {
            definitionId: QUARTERLY,
            tileId: brand<TileId>("tile-not-here"),
            openToJoin: true,
          },
        }),
        context(),
      ),
      "INVALID_COMMAND",
    );
  });

  it("Given a tile already occupied by a live project, Then a second project cannot be placed on it", () => {
    const tileId = brand<TileId>("tile-3");
    const state = gameState();
    const first = accepted(
      startProject(
        state,
        startCommand(state, {
          payload: { definitionId: QUARTERLY, tileId, openToJoin: true },
        }),
        context(),
      ),
    );

    rejectedWith(
      startProject(
        handOff(first, JOINER),
        startCommand(handOff(first, JOINER), {
          commandId: brand<CommandId>("second-on-same-tile"),
          actorId: JOINER,
          payload: { definitionId: QUARTERLY, tileId, openToJoin: true },
        }),
        context(),
      ),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a mode where joining is off, When a project is started as openToJoin, Then it is stored closed anyway", () => {
    const state = withRules(gameState(), { projects: { joinable: false } });

    expect(
      onlyProject(accepted(startProject(state, startCommand(state), context()))).openToJoin,
    ).toBe(false);
  });

  it("Given a mode whose projects get no rounds to run in, Then starting one is rejected", () => {
    const state = withRules(gameState(), { projects: { deadlineRounds: 0 } });

    rejectedWith(startProject(state, startCommand(state), context()), "ILLEGAL_ACTION");
  });

  it("Given a state that is not in pre-roll, Then a project cannot be started", () => {
    const state = gameState();
    const midTurn: GameState = { ...state, turn: { ...state.turn, phase: "tile-resolution" } };

    rejectedWith(startProject(midTurn, startCommand(midTurn), context()), "INVALID_PHASE");
  });

  it("Given a started project, Then the resulting state survives the jsonb snapshot boundary unchanged", () => {
    const state = gameState();

    assertRoundTrips(accepted(startProject(state, startCommand(state), context())));
  });
});

describe("project.contribute", () => {
  it("Given an open project, When a joiner funds the remainder, Then their resources move and the project reads funded", () => {
    const { state, projectId } = fundedProject();
    const project = onlyProject(state);

    expect(project.id).toBe(projectId);
    expect(project.status).toBe("funded");
    expect(money(state, LEAD)).toBe(2_000 - quarterly.leadStakeMoney);
    expect(work(state, LEAD)).toBe(12 - quarterly.requiredWork);
    expect(money(state, JOINER)).toBe(2_000 - 150);
    expect(project.contributions).toHaveLength(3);
  });

  it("Given a contribution, When it is applied, Then only the actor's own resources move", () => {
    const started = accepted(startProject(gameState(), startCommand(gameState()), context()));
    const seat = handOff(started, JOINER);

    const next = accepted(
      contributeToProject(
        seat,
        contributeCommand(seat, onlyProject(seat).id, { actorId: JOINER }),
        context(),
      ),
    );

    // The authorisation property that matters (spec §6.3): a contribute command
    // has no field naming whose money to spend, so it can only ever spend the
    // actor's. Everyone else is byte-identical.
    expect(next.players[JOINER]).not.toEqual(seat.players[JOINER]);
    expect(next.players[LEAD]).toEqual(seat.players[LEAD]);
    expect(next.players[RIVAL]).toEqual(seat.players[RIVAL]);
  });

  it("Given a contribute command from someone who is not the active player, Then it is rejected", () => {
    const started = accepted(startProject(gameState(), startCommand(gameState()), context()));

    rejectedWith(
      contributeToProject(
        started,
        contributeCommand(started, onlyProject(started).id, { actorId: RIVAL }),
        context(),
      ),
      "NOT_ACTOR_TURN",
    );
  });

  it("Given a mode with projects disabled, Then contributing is rejected", () => {
    const started = accepted(startProject(gameState(), startCommand(gameState()), context()));
    const off = withRules(started, { projects: { enabled: false } });

    rejectedWith(
      contributeToProject(off, contributeCommand(off, onlyProject(off).id), context()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a mode where joining is off, Then a non-lead cannot contribute but the lead still can", () => {
    const state = withRules(gameState(), { projects: { joinable: false } });
    const started = accepted(startProject(state, startCommand(state), context()));
    const projectId = onlyProject(started).id;
    const joinerSeat = handOff(started, JOINER);

    rejectedWith(
      contributeToProject(
        joinerSeat,
        contributeCommand(joinerSeat, projectId, { actorId: JOINER }),
        context(),
      ),
      "ILLEGAL_ACTION",
    );
    expect(
      onlyProject(
        accepted(
          contributeToProject(started, contributeCommand(started, projectId), context()),
        ),
      ).contributions,
    ).toHaveLength(2);
  });

  it("Given a project its lead closed to joiners, Then another player cannot contribute", () => {
    const state = gameState();
    const started = accepted(
      startProject(
        state,
        startCommand(state, {
          payload: { definitionId: QUARTERLY, tileId: null, openToJoin: false },
        }),
        context(),
      ),
    );
    const seat = handOff(started, JOINER);

    rejectedWith(
      contributeToProject(
        seat,
        contributeCommand(seat, onlyProject(seat).id, { actorId: JOINER }),
        context(),
      ),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a contributor without the money, Then the contribution is rejected as INSUFFICIENT_RESOURCE", () => {
    const state = gameState({ wallets: { [JOINER]: { money: 10 } } });
    const started = accepted(startProject(state, startCommand(state), context()));
    const seat = handOff(started, JOINER);

    rejectedWith(
      contributeToProject(
        seat,
        contributeCommand(seat, onlyProject(seat).id, {
          actorId: JOINER,
          payload: { projectId: onlyProject(seat).id, money: 150, work: 0 },
        }),
        context(),
      ),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given a contributor without the work, Then the contribution is rejected as INSUFFICIENT_RESOURCE", () => {
    const state = gameState({ wallets: { [LEAD]: { work: 1 } } });
    const started = accepted(startProject(state, startCommand(state), context()));

    rejectedWith(
      contributeToProject(
        started,
        contributeCommand(started, onlyProject(started).id, {
          payload: { projectId: onlyProject(started).id, money: 0, work: 5 },
        }),
        context(),
      ),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given a contribution of nothing, or of a fractional amount, Then it is rejected", () => {
    const started = accepted(startProject(gameState(), startCommand(gameState()), context()));
    const projectId = onlyProject(started).id;

    rejectedWith(
      contributeToProject(
        started,
        contributeCommand(started, projectId, { payload: { projectId, money: 0, work: 0 } }),
        context(),
      ),
      "ILLEGAL_ACTION",
    );
    rejectedWith(
      contributeToProject(
        started,
        contributeCommand(started, projectId, { payload: { projectId, money: 1.5, work: 0 } }),
        context(),
      ),
      "INVALID_COMMAND",
    );
    rejectedWith(
      contributeToProject(
        started,
        contributeCommand(started, projectId, { payload: { projectId, money: -50, work: 0 } }),
        context(),
      ),
      "INVALID_COMMAND",
    );
  });

  it("Given a project whose deadline has passed, Then it cannot be topped up", () => {
    const started = accepted(startProject(gameState(), startCommand(gameState()), context()));
    const project = onlyProject(started);
    const late = roundsOn(started, project.deadlineRound + 1);

    rejectedWith(
      contributeToProject(late, contributeCommand(late, project.id), context()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a project that has already resolved, Then it cannot be contributed to", () => {
    const started = accepted(startProject(gameState(), startCommand(gameState()), context()));
    const project = onlyProject(started);
    const past = roundsOn(started, project.deadlineRound + 1);
    const settled: GameState = {
      ...past,
      ...resolveDueProjects(past, past.turn.round),
      turn: { ...past.turn, round: project.deadlineRound },
    };

    rejectedWith(
      contributeToProject(settled, contributeCommand(settled, project.id), context()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a contribution, Then the resulting state survives the jsonb snapshot boundary unchanged", () => {
    assertRoundTrips(fundedProject().state);
  });
});

describe("project.sabotage", () => {
  it("Given an open sabotage, When it lands, Then work is spent, heat rises immediately and the entry is public", () => {
    const { state, projectId } = fundedProject();
    const seat = handOff(state, RIVAL);

    const next = accepted(
      sabotageProject(seat, sabotageCommand(seat, projectId, { actorId: RIVAL }), context()),
    );

    expect(work(next, RIVAL)).toBe(12 - 1);
    // Open sabotage costs no concealment money.
    expect(money(next, RIVAL)).toBe(2_000);
    expect(heatOf(next, RIVAL)).toBe(standardRules.conflict.heatPerAttack);
    expect(onlyProject(next).sabotage).toEqual([
      { playerId: RIVAL, amount: 1, hidden: false, atRound: 2 },
    ]);
  });

  it("Given a hidden sabotage, When it lands, Then it costs concealment money and defers its heat", () => {
    const { state, projectId } = fundedProject();
    const seat = handOff(state, RIVAL);

    const next = accepted(
      sabotageProject(
        seat,
        sabotageCommand(seat, projectId, {
          actorId: RIVAL,
          payload: { projectId, amount: 2, hidden: true },
        }),
        context(),
      ),
    );

    expect(work(next, RIVAL)).toBe(12 - 2);
    expect(money(next, RIVAL)).toBe(2_000 - 2 * quarterly.hiddenSabotageMoneyPerWork);
    // Heat is public state, so raising it now would announce the attack on the
    // very turn it was made. It lands at resolution, when the entry is revealed.
    expect(heatOf(next, RIVAL)).toBe(0);
    expect(onlyProject(next).sabotage[0]?.hidden).toBe(true);
  });

  it("Given a hidden sabotage in flight, Then no other player's projection can see it", () => {
    const { state, projectId } = fundedProject();
    const seat = handOff(state, RIVAL);
    const next = accepted(
      sabotageProject(
        seat,
        sabotageCommand(seat, projectId, {
          actorId: RIVAL,
          payload: { projectId, amount: 2, hidden: true },
        }),
        context(),
      ),
    );

    const publicView = projectPublicView(next);
    expect(publicView.projects[0]?.sabotage).toEqual([]);
    // The gross progress the lead can see is untouched, so the project still
    // reads as funded and nothing about its public shape hints at the damage.
    expect(publicView.projects[0]?.status).toBe("funded");
    expect(publicView.projects[0]?.contributedWork).toBe(quarterly.requiredWork);

    for (const viewer of [LEAD, JOINER]) {
      expect(projectPlayerView(next, viewer).projects[0]?.sabotage).toEqual([]);
    }
    // Nor anywhere else in the payload: no stringified leak either.
    expect(stableStringify(projectPlayerView(next, LEAD))).not.toContain(RIVAL_SABOTAGE_MARKER);
  });

  it("Given an open sabotage, Then it is visible to every viewer straight away", () => {
    const { state, projectId } = fundedProject();
    const seat = handOff(state, RIVAL);
    const next = accepted(
      sabotageProject(seat, sabotageCommand(seat, projectId, { actorId: RIVAL }), context()),
    );

    expect(projectPublicView(next).projects[0]?.sabotage).toHaveLength(1);
    expect(projectPlayerView(next, LEAD).projects[0]?.sabotage).toHaveLength(1);
  });

  it("Given a sabotage command from someone who is not the active player, Then it is rejected", () => {
    const { state, projectId } = fundedProject();

    rejectedWith(
      sabotageProject(state, sabotageCommand(state, projectId, { actorId: RIVAL }), context()),
      "NOT_ACTOR_TURN",
    );
  });

  it("Given a mode where sabotage is off, Then it is rejected and nothing is spent", () => {
    const { state, projectId } = fundedProject();
    const off = withRules(handOff(state, RIVAL), { projects: { sabotageable: false } });

    rejectedWith(
      sabotageProject(off, sabotageCommand(off, projectId, { actorId: RIVAL }), context()),
      "ILLEGAL_ACTION",
    );
    expect(work(off, RIVAL)).toBe(12);
  });

  it("Given a mode with projects disabled entirely, Then sabotage is rejected", () => {
    const { state, projectId } = fundedProject();
    const off = withRules(handOff(state, RIVAL), { projects: { enabled: false } });

    rejectedWith(
      sabotageProject(off, sabotageCommand(off, projectId, { actorId: RIVAL }), context()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a project's own lead, Then they cannot sabotage it", () => {
    const { state, projectId } = fundedProject();

    rejectedWith(
      sabotageProject(state, sabotageCommand(state, projectId, { actorId: LEAD }), context()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a saboteur without the work to spend, Then it is rejected as INSUFFICIENT_RESOURCE", () => {
    const { state, projectId } = fundedProject(gameState({ wallets: { [RIVAL]: { work: 1 } } }));
    const seat = handOff(state, RIVAL);

    rejectedWith(
      sabotageProject(
        seat,
        sabotageCommand(seat, projectId, {
          actorId: RIVAL,
          payload: { projectId, amount: 2, hidden: false },
        }),
        context(),
      ),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given a saboteur who cannot afford concealment, Then hiding it is rejected while doing it openly is not", () => {
    const { state, projectId } = fundedProject(gameState({ wallets: { [RIVAL]: { money: 10 } } }));
    const seat = handOff(state, RIVAL);

    rejectedWith(
      sabotageProject(
        seat,
        sabotageCommand(seat, projectId, {
          actorId: RIVAL,
          payload: { projectId, amount: 1, hidden: true },
        }),
        context(),
      ),
      "INSUFFICIENT_RESOURCE",
    );
    expect(
      onlyProject(
        accepted(
          sabotageProject(
            seat,
            sabotageCommand(seat, projectId, { actorId: RIVAL }),
            context(),
          ),
        ),
      ).sabotage,
    ).toHaveLength(1);
  });

  it("Given a zero or fractional sabotage, Then it is rejected", () => {
    const { state, projectId } = fundedProject();
    const seat = handOff(state, RIVAL);

    for (const amount of [0, -1, 1.5]) {
      rejectedWith(
        sabotageProject(
          seat,
          sabotageCommand(seat, projectId, {
            actorId: RIVAL,
            payload: { projectId, amount, hidden: false },
          }),
          context(),
        ),
        "INVALID_COMMAND",
      );
    }
  });

  it("Given a mode with heat switched off, Then sabotage still lands but costs no suspicion", () => {
    const { state, projectId } = fundedProject();
    const cold = withRules(handOff(state, RIVAL), { conflict: { heatEnabled: false } });

    const next = accepted(
      sabotageProject(cold, sabotageCommand(cold, projectId, { actorId: RIVAL }), context()),
    );

    expect(onlyProject(next).sabotage).toHaveLength(1);
    expect(heatOf(next, RIVAL)).toBe(0);
  });

  it("Given a saboteur one point below the investigation threshold, Then the sabotage opens an investigation against them", () => {
    const threshold = standardRules.conflict.heatThreshold;
    const { state, projectId } = fundedProject(
      gameState({
        wallets: { [RIVAL]: { heat: threshold - standardRules.conflict.heatPerAttack } },
      }),
    );
    const seat = handOff(state, RIVAL);

    const result = acceptedWith(
      sabotageProject(seat, sabotageCommand(seat, projectId, { actorId: RIVAL }), context()),
    );

    expect(result.state.prompts).toHaveLength(1);
    expect(result.state.prompts[0]?.kind).toBe("heat-investigation");
    // The prompt is aimed at the *attacker*, never the victim.
    expect(result.state.prompts[0]?.audience).toEqual([RIVAL]);
    expect(result.events.some((event) => event.type === "PromptOpened")).toBe(true);
  });

  it("Given a sabotage, Then the resulting state survives the jsonb snapshot boundary unchanged", () => {
    const { state, projectId } = fundedProject();
    const seat = handOff(state, RIVAL);

    assertRoundTrips(
      accepted(
        sabotageProject(
          seat,
          sabotageCommand(seat, projectId, {
            actorId: RIVAL,
            payload: { projectId, amount: 1, hidden: true },
          }),
          context(),
        ),
      ),
    );
  });
});

const RIVAL_SABOTAGE_MARKER = `"playerId":"${RIVAL}","amount"`;

describe("project deadline resolution", () => {
  it("Given a funded project past its deadline, Then it completes and the whole pot is paid out", () => {
    const { state } = fundedProject();
    const project = onlyProject(state);
    const past = roundsOn(state, project.deadlineRound + 1);

    const resolution = resolveDueProjects(past, past.turn.round);
    const settled: GameState = { ...past, ...resolution };

    expect(onlyProject(settled).status).toBe("completed");
    // Weights are money-denominated: lead 150 money + 3 work x 100 = 450,
    // joiner 150. Lead bonus is 15% of 1100 = 165, and the remaining 935 splits
    // 450:150 with the odd unit going to the larger remainder.
    expect(money(settled, LEAD)).toBe(2_000 - 150 + 866);
    expect(money(settled, JOINER)).toBe(2_000 - 150 + 234);
    expect(reputation(settled, LEAD)).toBe(6 + 3);
    expect(reputation(settled, JOINER)).toBe(6 + 1);

    const paidMoney = resolution.resolved[0]?.payouts.reduce(
      (sum, share) => sum + share.money,
      0,
    );
    // Largest-remainder: every unit of the pot lands on somebody.
    expect(paidMoney).toBe(quarterly.payout.money);
    expect(resolution.resolved[0]?.objectiveProgress).toBe(
      quarterly.payout.objectiveProgress,
    );
  });

  it("Given identical money-equivalent contributions, Then leading pays strictly better than joining, and joining still beats abstaining", () => {
    // The two contributors are made deliberately identical in weight so the
    // *only* thing separating their payouts is the lead bonus — which is the
    // entire reason anybody starts a project instead of waiting for someone
    // else to.
    const state = gameState();
    const started = accepted(startProject(state, startCommand(state), context()));
    const projectId = onlyProject(started).id;
    // Lead: 150 staked + 3 work at 100 each = 450 of money-equivalent weight.
    const leadWorks = accepted(
      contributeToProject(
        started,
        contributeCommand(started, projectId, {
          commandId: brand<CommandId>("command-lead-matched-work"),
          payload: { projectId, money: 0, work: quarterly.requiredWork },
        }),
        context(),
      ),
    );
    const seat = handOff(leadWorks, JOINER);
    // Joiner: 450 money. Same weight, nothing else different.
    const matched = accepted(
      contributeToProject(
        seat,
        contributeCommand(seat, projectId, {
          actorId: JOINER,
          payload: { projectId, money: 450, work: 0 },
        }),
        context(),
      ),
    );
    const past = roundsOn(matched, onlyProject(matched).deadlineRound + 1);
    const resolution = resolveDueProjects(past, past.turn.round);

    const leadShare = resolution.resolved[0]?.payouts.find((share) => share.playerId === LEAD);
    const joinerShare = resolution.resolved[0]?.payouts.find(
      (share) => share.playerId === JOINER,
    );
    expect(leadShare?.money ?? 0).toBeGreaterThan(joinerShare?.money ?? 0);
    // And the joiner is still ahead of where they started, so abstaining is not
    // the dominant line either. Only just ahead, because they entered a pot that
    // was already fully funded — being late is the price of not leading.
    expect(joinerShare?.money ?? 0).toBeGreaterThan(450);
  });

  it("Given a joiner who fills the last of an underfunded pot, Then they clear a real profit", () => {
    const { state } = fundedProject();
    const past = roundsOn(state, onlyProject(state).deadlineRound + 1);

    const resolution = resolveDueProjects(past, past.turn.round);
    const joinerShare = resolution.resolved[0]?.payouts.find(
      (share) => share.playerId === JOINER,
    );

    // 150 in, 234 out. Contributing early into a pot that still needs filling
    // is strongly positive; that is the pressure that gets projects funded.
    expect(joinerShare?.money ?? 0).toBeGreaterThan(150);
  });

  it("Given an underfunded project past its deadline, Then it fails, nothing is refunded, and the lead pays the largest penalty", () => {
    const state = gameState();
    const started = accepted(startProject(state, startCommand(state), context()));
    const projectId = onlyProject(started).id;
    const seat = handOff(started, JOINER);
    const joined = accepted(
      contributeToProject(
        seat,
        contributeCommand(seat, projectId, {
          actorId: JOINER,
          payload: { projectId, money: 150, work: 0 },
        }),
        context(),
      ),
    );
    const past = roundsOn(joined, onlyProject(joined).deadlineRound + 1);

    const settled: GameState = { ...past, ...resolveDueProjects(past, past.turn.round) };

    expect(onlyProject(settled).status).toBe("failed");
    // The money is gone: contributions are spent when made, never escrowed.
    // Without that, starting a project would be free and the decision empty.
    expect(money(settled, LEAD)).toBe(2_000 - 150);
    expect(money(settled, JOINER)).toBe(2_000 - 150);
    // The lead eats the whole penalty; equal contributors split the same number.
    expect(reputation(settled, LEAD)).toBe(6 - quarterly.failureReputationPenalty);
    expect(reputation(settled, JOINER)).toBe(6 - 1);
    expect(reputation(settled, RIVAL)).toBe(6);
  });

  it("Given a project that looked funded but was secretly sabotaged, Then it fails at the deadline and the sabotage is revealed", () => {
    const { state, projectId } = fundedProject();
    const seat = handOff(state, RIVAL);
    const sabotaged = accepted(
      sabotageProject(
        seat,
        sabotageCommand(seat, projectId, {
          actorId: RIVAL,
          payload: { projectId, amount: 1, hidden: true },
        }),
        context(),
      ),
    );
    expect(onlyProject(sabotaged).status).toBe("funded");

    const past = roundsOn(sabotaged, onlyProject(sabotaged).deadlineRound + 1);
    const resolution = resolveDueProjects(past, past.turn.round);
    const settled: GameState = { ...past, ...resolution };

    expect(onlyProject(settled).status).toBe("failed");
    expect(resolution.resolved[0]?.grossWork).toBe(quarterly.requiredWork);
    expect(resolution.resolved[0]?.netWork).toBe(quarterly.requiredWork - 1);
    // Revealed to everybody, exactly once, at resolution.
    expect(onlyProject(settled).sabotage).toEqual([
      { playerId: RIVAL, amount: 1, hidden: false, atRound: 2 },
    ]);
    expect(projectPublicView(settled).projects[0]?.sabotage).toHaveLength(1);
    // The deferred heat lands with the reveal.
    expect(heatOf(settled, RIVAL)).toBe(standardRules.conflict.heatPerAttack);
    expect(resolution.resolved[0]?.revealedSaboteurIds).toEqual([RIVAL]);
    expect(resolution.resolved[0]?.heatRaisedPlayerIds).toEqual([RIVAL]);
  });

  it("Given sabotage that does not sink the project, Then it still completes on net work", () => {
    const base = gameState({ wallets: { [LEAD]: { work: 12 } } });
    const started = accepted(startProject(base, startCommand(base), context()));
    const projectId = onlyProject(started).id;
    const buffered = accepted(
      contributeToProject(
        started,
        contributeCommand(started, projectId, {
          payload: { projectId, money: 150, work: 5 },
        }),
        context(),
      ),
    );
    const seat = handOff(buffered, RIVAL);
    const sabotaged = accepted(
      sabotageProject(
        seat,
        sabotageCommand(seat, projectId, {
          actorId: RIVAL,
          payload: { projectId, amount: 2, hidden: true },
        }),
        context(),
      ),
    );
    const past = roundsOn(sabotaged, onlyProject(sabotaged).deadlineRound + 1);

    const settled: GameState = { ...past, ...resolveDueProjects(past, past.turn.round) };

    // 5 work contributed, 2 destroyed, 3 required: over-contributing is the
    // counter-play to sabotage you cannot see.
    expect(onlyProject(settled).status).toBe("completed");
  });

  it("Given a resolution, When it is run again at the same round, Then nothing changes", () => {
    const { state } = fundedProject();
    const past = roundsOn(state, onlyProject(state).deadlineRound + 1);
    const settled: GameState = { ...past, ...resolveDueProjects(past, past.turn.round) };

    const again = resolveDueProjects(settled, settled.turn.round);

    expect(again.resolved).toEqual([]);
    expect(again.changes).toEqual([]);
    expect(stableStringify(again.players)).toBe(stableStringify(settled.players));
    expect(stableStringify(again.projects)).toBe(stableStringify(settled.projects));
  });

  it("Given a game restored several rounds past two deadlines, Then both resolve in one call", () => {
    const state = gameState();
    const first = accepted(startProject(state, startCommand(state), context()));
    const second = accepted(
      startProject(
        first,
        startCommand(first, { commandId: brand<CommandId>("second-project") }),
        context(),
      ),
    );
    const earliest = second.projects[0];
    if (earliest === undefined) throw new Error("expected two projects");
    const far = roundsOn(second, earliest.deadlineRound + 40);

    const resolution = resolveDueProjects(far, far.turn.round);

    expect(resolution.resolved).toHaveLength(2);
    expect(resolution.projects.every((project) => project.status === "failed")).toBe(true);
  });

  it("Given a project still inside its deadline round, Then it is left alone", () => {
    const { state } = fundedProject();
    const project = onlyProject(state);

    expect(
      resolveDueProjects(roundsOn(state, project.deadlineRound), project.deadlineRound)
        .resolved,
    ).toEqual([]);
  });

  it("Given a caller that has already rebuilt the player map, Then resolution layers onto that map rather than state.players", () => {
    const { state } = fundedProject();
    const past = roundsOn(state, onlyProject(state).deadlineRound + 1);
    const leadSeat = past.players[LEAD];
    if (leadSeat === undefined) throw new Error("missing lead");
    const midTurn = { ...past.players, [LEAD]: { ...leadSeat, skipTurns: 2 } };

    const resolution = resolveDueProjects(past, past.turn.round, { players: midTurn });

    // The caller's in-flight bookkeeping survives the payout.
    expect(resolution.players[LEAD]?.skipTurns).toBe(2);
    expect(resolution.players[LEAD]?.resources.money?.value).toBeGreaterThan(
      leadSeat.resources.money?.value ?? 0,
    );
  });

  it("Given a resolution's changes, Then every one is emittable as a ResourceChanged and names only real movements", () => {
    const { state } = fundedProject();
    const past = roundsOn(state, onlyProject(state).deadlineRound + 1);

    const resolution = resolveDueProjects(past, past.turn.round);

    expect(resolution.changes.length).toBeGreaterThan(0);
    for (const change of resolution.changes) {
      expect(change.newValue).not.toBe(change.previousValue);
      expect(change.reason).toBe("project-payout");
      expect(ORDER).toContain(change.playerId);
    }
  });

  it("Given a resolved project, Then the resulting state survives the jsonb snapshot boundary unchanged", () => {
    const { state } = fundedProject();
    const past = roundsOn(state, onlyProject(state).deadlineRound + 1);

    assertRoundTrips({ ...past, ...resolveDueProjects(past, past.turn.round) });
  });

  it("Given a state that has been through the jsonb boundary, Then resolution produces the identical outcome", () => {
    const { state } = fundedProject();
    const past = roundsOn(state, onlyProject(state).deadlineRound + 1);
    const restored = deserializeGameState(serializeGameState(past));

    // Record key order is insertion order in memory and sorted order after the
    // round trip, so a distribution that leaned on `Object.keys` would diverge
    // here.
    expect(stableStringify(resolveDueProjects(restored, restored.turn.round))).toBe(
      stableStringify(resolveDueProjects(past, past.turn.round)),
    );
  });
});

describe("project purity and determinism", () => {
  it.each([
    ["start", (state: GameState) => startProject(state, startCommand(state), context())],
    [
      "contribute",
      (state: GameState) =>
        contributeToProject(state, contributeCommand(state, onlyProject(state).id), context()),
    ],
    [
      "sabotage",
      (state: GameState) =>
        sabotageProject(
          handOff(state, RIVAL),
          sabotageCommand(handOff(state, RIVAL), onlyProject(state).id, { actorId: RIVAL }),
          context(),
        ),
    ],
  ])(
    "Given a frozen state, When %s is applied twice, Then the events and next state are byte-identical and the input is untouched",
    (label, apply) => {
      const seeded =
        label === "start"
          ? gameState()
          : accepted(startProject(gameState(), startCommand(gameState()), context()));
      const frozen = deepFreeze(structuredClone(seeded));

      const first = acceptedWith(apply(frozen));
      const second = acceptedWith(apply(frozen));

      expect(stableStringify(second.events)).toBe(stableStringify(first.events));
      expect(stableStringify(second.state)).toBe(stableStringify(first.state));
      expect(stableStringify(frozen)).toBe(stableStringify(seeded));
    },
  );

  it("Given two different logical timestamps, Then only the timestamps differ", () => {
    const state = gameState();
    const early = acceptedWith(
      startProject(state, startCommand(state), context("2020-01-01T00:00:00.000Z")),
    );
    const late = acceptedWith(
      startProject(state, startCommand(state), context("2099-12-31T23:59:59.000Z")),
    );

    const strip = (value: string) =>
      value
        .replaceAll("2020-01-01T00:00:00.000Z", "T")
        .replaceAll("2099-12-31T23:59:59.000Z", "T");
    expect(strip(stableStringify(late.events))).toBe(strip(stableStringify(early.events)));
    expect(strip(stableStringify(late.state))).toBe(strip(stableStringify(early.state)));
  });

  it("Given identical commands with different client-chosen command ids, Then the project id is unchanged", () => {
    const state = gameState();

    // Ids come from server-owned state (gameId plus the revision this command
    // produces), so a client cannot name — or collide with — a project id.
    const first = onlyProject(accepted(startProject(state, startCommand(state), context())));
    const second = onlyProject(
      accepted(
        startProject(
          state,
          startCommand(state, { commandId: brand<CommandId>("a-different-id") }),
          context(),
        ),
      ),
    );

    expect(second.id).toBe(first.id);
  });
});

describe("project legal-action predicates", () => {
  it("Given the shipped presets, Then the predicates track each preset's own projects block", () => {
    for (const mode of Object.values(deadlineDashModes)) {
      const state = gameState({ rules: mode.rules });
      const expected =
        mode.rules.projects.enabled &&
        mode.rules.projects.maxConcurrentPerPlayer > 0 &&
        mode.rules.projects.deadlineRounds >= 1;

      expect(canStartProject(state, LEAD)).toBe(expected);
    }
  });

  it("Given a live open project, Then it is contributable by anyone and sabotageable by everyone but its lead", () => {
    const { state, projectId } = fundedProject();

    expect(contributableProjects(state, LEAD).map((project) => project.id)).toEqual([projectId]);
    expect(contributableProjects(handOff(state, RIVAL), RIVAL).map((p) => p.id)).toEqual([
      projectId,
    ]);
    expect(sabotageableProjects(state, LEAD)).toEqual([]);
    expect(sabotageableProjects(handOff(state, RIVAL), RIVAL).map((p) => p.id)).toEqual([
      projectId,
    ]);
  });

  it("Given a mode with sabotage off, Then nothing is advertised as sabotageable", () => {
    const { state } = fundedProject();
    const off = withRules(handOff(state, RIVAL), { projects: { sabotageable: false } });

    expect(sabotageableProjects(off, RIVAL)).toEqual([]);
  });

  it("Given a player who can only afford the cheapest rung, Then only that rung is advertised", () => {
    const state = gameState({ wallets: { [LEAD]: { money: 200 } } });

    expect(affordableProjectDefinitions(state, LEAD).map((definition) => definition.id)).toEqual(
      [QUARTERLY],
    );
  });

  it("Given a player who cannot afford any rung, Then starting is not advertised at all", () => {
    const state = gameState({ wallets: { [LEAD]: { money: 1 } } });

    expect(canStartProject(state, LEAD)).toBe(false);
    expect(affordableProjectDefinitions(state, LEAD)).toEqual([]);
  });
});

const CUSTOM_DEFINITIONS: readonly ProjectDefinition[] = [
  {
    id: "project.custom",
    requiredMoney: 200,
    requiredWork: 2,
    workValueMoney: 50,
    leadStakeMoney: 100,
    payout: { money: 900, reputation: 3, objectiveProgress: 0 },
    leadBonusBasisPoints: 1_000,
    failureReputationPenalty: 4,
    hiddenSabotageMoneyPerWork: 25,
  },
];

function customStart(state: GameState): StartProjectCommand {
  return startCommand(state, {
    payload: { definitionId: "project.custom", tileId: null, openToJoin: true },
  });
}

describe("an authored project catalog replacing the built-in one", () => {
  it("Given a supplied catalog, When a project is started from it, Then its own numbers are used", () => {
    const state = gameState();

    const project = onlyProject(
      accepted(
        startProject(state, customStart(state), context(), {
          definitions: CUSTOM_DEFINITIONS,
        }),
      ),
    );

    expect(project.requiredMoney).toBe(200);
    expect(project.payout).toEqual({ money: 900, reputation: 3, objectiveProgress: 0 });
    expect(money(accepted(
      startProject(state, customStart(state), context(), { definitions: CUSTOM_DEFINITIONS }),
    ), LEAD)).toBe(2_000 - 100);
  });

  it("Given the same command without that catalog, Then the definition is unknown", () => {
    const state = gameState();

    rejectedWith(startProject(state, customStart(state), context()), "INVALID_COMMAND");
  });

  it("Given a project whose definition the resolver was not given, Then open sabotage still works but concealment cannot be priced", () => {
    const state = gameState();
    const started = accepted(
      startProject(state, customStart(state), context(), { definitions: CUSTOM_DEFINITIONS }),
    );
    const projectId = onlyProject(started).id;
    const seat = handOff(started, RIVAL);

    // An unknown definition must not become a shield.
    rejectedWith(
      sabotageProject(
        seat,
        sabotageCommand(seat, projectId, {
          actorId: RIVAL,
          payload: { projectId, amount: 1, hidden: true },
        }),
        context(),
      ),
      "INVARIANT_VIOLATION",
    );
    expect(
      onlyProject(
        accepted(
          sabotageProject(seat, sabotageCommand(seat, projectId, { actorId: RIVAL }), context()),
        ),
      ).sabotage,
    ).toHaveLength(1);
  });

  it("Given a failure resolved with the same catalog it started under, Then that catalog's penalty is charged", () => {
    const state = gameState();
    const started = accepted(
      startProject(state, customStart(state), context(), { definitions: CUSTOM_DEFINITIONS }),
    );
    const past = roundsOn(started, onlyProject(started).deadlineRound + 1);

    const withCatalog: GameState = {
      ...past,
      ...resolveDueProjects(past, past.turn.round, { definitions: CUSTOM_DEFINITIONS }),
    };
    const withoutCatalog: GameState = { ...past, ...resolveDueProjects(past, past.turn.round) };

    expect(reputation(withCatalog, LEAD)).toBe(6 - 4);
    // Without it the project still fails; it just cannot price the penalty, and
    // inventing one would be worse than charging none.
    expect(onlyProject(withoutCatalog).status).toBe("failed");
    expect(reputation(withoutCatalog, LEAD)).toBe(6);
  });
});

describe("eliminated players", () => {
  it("Given an eliminated player, Then none of the three project verbs is available to them", () => {
    const { state, projectId } = fundedProject();
    const out: GameState = { ...state, eliminatedPlayerIds: [LEAD] };

    rejectedWith(startProject(out, startCommand(out), context()), "ILLEGAL_ACTION");
    rejectedWith(
      contributeToProject(out, contributeCommand(out, projectId), context()),
      "ILLEGAL_ACTION",
    );
    expect(canStartProject(out, LEAD)).toBe(false);
    expect(contributableProjects(out, LEAD)).toEqual([]);
  });
});

describe("the default project catalog", () => {
  it("Given every shipped definition, Then contributing to it is profitable and it is sabotageable", () => {
    for (const definition of DEFAULT_PROJECT_DEFINITIONS) {
      const requiredValue =
        definition.requiredMoney + definition.requiredWork * definition.workValueMoney;

      // If the pot does not exceed the total money-equivalent cost of filling
      // the project, contributing is a donation and nobody ever would.
      expect(definition.payout.money).toBeGreaterThan(requiredValue);
      // A pure-money contributor has to profit too, or the work track quietly
      // becomes the only rational way in.
      const afterLeadBonus =
        definition.payout.money -
        Math.floor((definition.payout.money * definition.leadBonusBasisPoints) / 10_000);
      expect(afterLeadBonus / requiredValue).toBeGreaterThan(1);
      // Leading has to cost something up front, or starting is free.
      expect(definition.leadStakeMoney).toBeGreaterThan(0);
      expect(definition.leadStakeMoney).toBeLessThan(definition.requiredMoney);
      // Failure has to cost, or the decision to start is empty.
      expect(definition.failureReputationPenalty).toBeGreaterThan(0);
      // Every project must be ruinable, or sabotage has no object.
      expect(definition.requiredWork).toBeGreaterThan(0);
      expect(definition.hiddenSabotageMoneyPerWork).toBeGreaterThan(0);
    }
  });

  it("Given the catalog, Then every definition id is unique", () => {
    const ids = DEFAULT_PROJECT_DEFINITIONS.map((definition) => definition.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
