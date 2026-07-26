import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";
import type { EffectDescriptor } from "@office-ladder/content";

import {
  deserializeGameState,
  serializeGameState,
  stableStringify,
} from "../src";
import type {
  AbilityId,
  CommandId,
  DecisionPointId,
  ExpireWindowCommand,
  GameState,
  PassReactionCommand,
  PlayReactionCommand,
  PlayerId,
  PlayerState,
  ResourceId,
  ResourceState,
  TransitionResult,
} from "../src";
import {
  applyPendingEffect,
  createPendingEffect,
  pendingEffectDescriptor,
  preventionRandomSource,
} from "../src/execution/prevent-effect";
import {
  expireWindow,
  expiredReactionWindows,
  isReactionWindowResolved,
  isServerInjectedActor,
  openReactionWindow,
  openReactionWindowsFor,
  passReaction,
  playReaction,
  reactionWindowDeadline,
  reactionWindowPreventerId,
  withReactionWindowOpened,
} from "../src/execution/reaction-window";
import type { OpenReactionWindowInput } from "../src/execution/reaction-window";
import { createCanonicalGameState, fixtureIds } from "./fixtures";
import { logicalTimestamp, rollCommand, withRules } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const { owner, hiddenOpponent, revealedOpponent } = fixtureIds;

/** The server's own actor id — deliberately not a seat at the table. */
const serverActor = brand<PlayerId>("system:reaction-scheduler");

function context(timestamp = logicalTimestamp) {
  return { logicalTimestamp: timestamp, content: deadlineDashContent };
}

function money(playerId: PlayerId, value: number): ResourceState {
  return {
    id: brand<ResourceId>(`resource-${playerId}-money`),
    kind: "resource.money",
    value,
    minimum: 0,
    maximum: null,
  };
}

function funded(player: PlayerState, value: number): PlayerState {
  return { ...player, resources: { money: money(player.id, value) } };
}

/**
 * A three-seat table with the Quick preset's ruleset (reaction windows on,
 * 10-second windows, hands on), every hand-off artefact cleared, and every
 * player holding money so a guarded effect has something to actually take.
 */
function baseState(): GameState {
  const state = createCanonicalGameState();

  return {
    ...state,
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    resolutionStack: [],
    lastCommandId: null,
    turn: {
      ...state.turn,
      phase: "pre-roll",
      activePlayerId: owner,
      deadlineAt: null,
    },
    players: {
      [owner]: funded(state.players[owner], 500),
      [hiddenOpponent]: {
        ...funded(state.players[hiddenOpponent], 500),
        skipTurns: 0,
        inAudit: false,
      },
      [revealedOpponent]: funded(state.players[revealedOpponent], 500),
    },
  };
}

/** Takes 100 money off whoever it lands on. Small, deterministic, observable. */
const fine: EffectDescriptor = {
  type: "modifyResource",
  resource: "money",
  amount: -100,
  clampAtZero: true,
};

const defaultOpening: OpenReactionWindowInput = {
  kind: "prevention",
  eligiblePlayerIds: [owner, hiddenOpponent, revealedOpponent],
  priorityPlayerId: hiddenOpponent,
  sourceId: "tile.audit",
  effect: fine,
  affectedPlayerIds: [hiddenOpponent],
};

/**
 * Opens a window the way an integrated transition would: run the pure opener,
 * fold it into canonical state, and advance the revision and event sequence the
 * host transition would have advanced.
 */
function opened(
  state: GameState = baseState(),
  input: Partial<OpenReactionWindowInput> = {},
): GameState {
  const opening = openReactionWindow(
    state,
    rollCommand(state),
    context(),
    state.eventSequence + 1,
    { ...defaultOpening, ...input },
  );
  if (opening === null) throw new Error("expected a reaction window to open");

  const withWindow = withReactionWindowOpened(state, opening);
  const lastEvent = opening.events[opening.events.length - 1];

  return {
    ...withWindow,
    revision: state.revision + 1,
    eventSequence: lastEvent?.sequence ?? state.eventSequence,
  };
}

function windowIdOf(state: GameState): DecisionPointId {
  const id = state.reactionWindows[0]?.id;
  if (id === undefined) throw new Error("expected an open reaction window");

  return id;
}

function playCommand(
  state: GameState,
  actorId: PlayerId,
  overrides: Partial<PlayReactionCommand["payload"]> = {},
  commandId = `command-play-${actorId}`,
): PlayReactionCommand {
  return {
    commandId: brand<CommandId>(commandId),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
    decisionPointId: windowIdOf(state),
    type: "reaction.play",
    payload: {
      cardId: null,
      abilityId: brand<AbilityId>("ability-owner-secret"),
      targetPlayerIds: [],
      choice: null,
      ...overrides,
    },
  };
}

function passCommand(
  state: GameState,
  actorId: PlayerId,
  commandId = `command-pass-${actorId}`,
): PassReactionCommand {
  return {
    commandId: brand<CommandId>(commandId),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
    decisionPointId: windowIdOf(state),
    type: "reaction.pass",
    payload: {},
  };
}

function expireCommand(
  state: GameState,
  overrides: Partial<ExpireWindowCommand> = {},
): ExpireWindowCommand {
  return {
    commandId: brand<CommandId>("command-expire"),
    gameId: state.gameId,
    actorId: serverActor,
    expectedRevision: state.revision,
    type: "window.expire",
    payload: { decisionPointId: windowIdOf(state) },
    ...overrides,
  };
}

function accepted(result: TransitionResult): GameState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value.state;
}

function events(result: TransitionResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value.events;
}

function rejectedWith(result: TransitionResult, code: string): void {
  expect(result).toEqual(
    expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) }),
  );
}

function moneyOf(state: GameState, playerId: PlayerId): number {
  return state.players[playerId]?.resources["money"]?.value ?? -1;
}

/** Every eligible player answers; returns the state once the window has closed. */
function everyonePasses(state: GameState): GameState {
  let current = state;
  for (const playerId of [owner, hiddenOpponent, revealedOpponent]) {
    current = accepted(passReaction(current, passCommand(current, playerId), context()));
  }

  return current;
}

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner, seen);
  }

  return Object.freeze(value);
}

/** Applies a transition twice against a frozen state and asserts both agree. */
function appliesIdentically(
  state: GameState,
  transition: (input: GameState) => TransitionResult,
): GameState {
  const frozen = deepFreeze(structuredClone(state));
  const first = transition(frozen);
  const second = transition(frozen);

  expect(stableStringify(events(second))).toBe(stableStringify(events(first)));
  expect(stableStringify(accepted(second))).toBe(stableStringify(accepted(first)));
  expect(stableStringify(frozen)).toBe(stableStringify(state));

  return accepted(first);
}

describe("opening a reaction window", () => {
  it("Given a preventable effect and a mode with reaction windows on, When a window is opened, Then the window, its frame and its pending effect all enter canonical state", () => {
    const state = opened();

    const window = state.reactionWindows[0];
    expect(window?.kind).toBe("prevention");
    expect(window?.eligiblePlayerIds).toEqual([owner, hiddenOpponent, revealedOpponent]);
    expect(window?.priorityPlayerId).toBe(hiddenOpponent);
    expect(window?.passedPlayerIds).toEqual([]);
    expect(window?.playedByPlayerIds).toEqual([]);

    const pending = state.pendingEffects[0];
    expect(pending?.id).toBe(window?.pendingEffectId);
    expect(pending?.preventionEligible).toBe(true);
    expect(pending?.affectedPlayerIds).toEqual([hiddenOpponent]);
    expect(pending?.effect).toEqual({
      type: "modifyResource",
      resource: "money",
      amount: -100,
      clampAtZero: true,
    });

    // The FrameKind that had never been pushed.
    const frame = state.resolutionStack[0];
    expect(frame?.kind).toBe("open-reaction-window");
    expect(frame?.id).toBe(window?.frameId);
    expect(frame?.capturedValues).toEqual({ resumePhase: "pre-roll" });
    expect(state.turn.phase).toBe("reaction");
  });

  it("Given a window opening, When its events are read, Then the proposal and the opening are both announced in sequence", () => {
    const state = baseState();
    const opening = openReactionWindow(
      state,
      rollCommand(state),
      context(),
      state.eventSequence + 1,
      defaultOpening,
    );

    expect(opening?.events.map((event) => event.type)).toEqual([
      "EffectProposed",
      "ReactionWindowOpened",
    ]);
    expect(opening?.events.map((event) => event.sequence)).toEqual([
      state.eventSequence + 1,
      state.eventSequence + 2,
    ]);
  });

  it("Given a mode with interaction.reactionWindows switched off, When a window would open, Then none opens at all", () => {
    const state = withRules(baseState(), { interaction: { reactionWindows: false } });

    expect(
      openReactionWindow(
        state,
        rollCommand(state),
        context(),
        state.eventSequence + 1,
        defaultOpening,
      ),
    ).toBeNull();
  });

  it("Given nobody eligible, When a window would open, Then none opens", () => {
    const state = baseState();

    expect(
      openReactionWindow(state, rollCommand(state), context(), state.eventSequence + 1, {
        ...defaultOpening,
        eligiblePlayerIds: [],
      }),
    ).toBeNull();
  });

  it("Given an eligible list in the wrong order holding a duplicate, a stranger and an eliminated player, When the window opens, Then it is normalised to canonical turn order", () => {
    const state: GameState = {
      ...baseState(),
      eliminatedPlayerIds: [revealedOpponent],
    };

    const window = opened(state, {
      eligiblePlayerIds: [
        revealedOpponent,
        hiddenOpponent,
        owner,
        hiddenOpponent,
        brand<PlayerId>("player-who-is-not-here"),
      ],
    }).reactionWindows[0];

    expect(window?.eligiblePlayerIds).toEqual([owner, hiddenOpponent]);
  });

  it("Given a priority player who is not eligible, When the window opens, Then priority is dropped rather than pointing at a player who cannot answer", () => {
    const window = opened(baseState(), {
      eligiblePlayerIds: [owner],
      priorityPlayerId: revealedOpponent,
    }).reactionWindows[0];

    expect(window?.priorityPlayerId).toBeNull();
  });
});

describe("the window deadline", () => {
  it("Given a mode's reactionWindowSeconds, When a window opens, Then the deadline is that many seconds after the caller's own timestamp", () => {
    expect(opened().reactionWindows[0]?.deadlineAt).toBe("2026-07-18T12:00:10.000Z");

    const slower = withRules(baseState(), { interaction: { reactionWindowSeconds: 45 } });
    expect(opened(slower).reactionWindows[0]?.deadlineAt).toBe("2026-07-18T12:00:45.000Z");
  });

  it("Given a zero-second window, When it opens, Then the deadline has already passed rather than being absent", () => {
    const instant = withRules(baseState(), { interaction: { reactionWindowSeconds: 0 } });
    const state = opened(instant);

    expect(state.reactionWindows[0]?.deadlineAt).toBe(logicalTimestamp);
    expect(expiredReactionWindows(state, logicalTimestamp)).toHaveLength(1);
  });

  it.each([
    ["2026-07-18T12:00:00.000Z", 10, "2026-07-18T12:00:10.000Z"],
    ["2026-12-31T23:59:55.000Z", 10, "2027-01-01T00:00:05.000Z"],
    ["2024-02-28T23:59:50.500Z", 15, "2024-02-29T00:00:05.500Z"],
    ["2023-02-28T23:59:50.500Z", 15, "2023-03-01T00:00:05.500Z"],
    ["2026-07-18T12:00:00.000Z", -5, "2026-07-18T12:00:00.000Z"],
  ])(
    "Given %s plus %i seconds, When the deadline is computed, Then it is %s",
    (from, seconds, expected) => {
      expect(reactionWindowDeadline(from, seconds)).toBe(expected);
    },
  );

  it("Given a thousand instants across a century, When each deadline is computed, Then it matches the platform's own UTC arithmetic", () => {
    // The formatter is hand-rolled to keep `new Date` out of the engine; this is
    // the check that hand-rolling did not introduce a calendar bug.
    const start = Date.parse("1990-01-01T00:00:00.000Z");
    const step = 3_155_760_000; // ~36.5 days, so every month and leap year is hit
    for (let index = 0; index < 1_000; index += 1) {
      const fromMs = start + index * step;
      const from = new Date(fromMs).toISOString();
      expect(reactionWindowDeadline(from, 12)).toBe(
        new Date(fromMs + 12_000).toISOString(),
      );
    }
  });

  it("Given an unparseable timestamp, When the deadline is computed, Then it is absent rather than invented", () => {
    expect(reactionWindowDeadline("not-a-timestamp", 10)).toBeNull();
  });
});

describe("reaction.pass", () => {
  it("Given every eligible player passing, When the last one answers, Then the guarded effect lands and the window is gone", () => {
    const state = opened();
    const closed = everyonePasses(state);

    expect(moneyOf(closed, hiddenOpponent)).toBe(400);
    expect(moneyOf(closed, owner)).toBe(500);
    expect(closed.reactionWindows).toEqual([]);
    expect(closed.pendingEffects).toEqual([]);
    expect(closed.resolutionStack).toEqual([]);
    expect(closed.turn.phase).toBe("pre-roll");
  });

  it("Given the last pass, When the effect lands, Then it is reported as a resource change", () => {
    const state = opened();
    const first = accepted(passReaction(state, passCommand(state, owner), context()));
    const second = accepted(
      passReaction(first, passCommand(first, hiddenOpponent), context()),
    );

    const closing = passReaction(second, passCommand(second, revealedOpponent), context());

    expect(events(closing)).toEqual([
      expect.objectContaining({
        type: "ResourceChanged",
        payload: expect.objectContaining({
          playerId: hiddenOpponent,
          previousValue: 500,
          newValue: 400,
          reason: "pending-effect",
        }),
      }),
    ]);
  });

  it("Given a pass that is not the last one, When it is applied, Then the window stays open and nothing is announced", () => {
    const state = opened();

    const result = passReaction(state, passCommand(state, owner), context());
    const next = accepted(result);

    expect(events(result)).toEqual([]);
    expect(next.reactionWindows[0]?.passedPlayerIds).toEqual([owner]);
    expect(next.revision).toBe(state.revision + 1);
    expect(moneyOf(next, hiddenOpponent)).toBe(500);
    expect(isReactionWindowResolved(next.reactionWindows[0]!)).toBe(false);
  });

  it("Given responses arriving in different orders, When both tables close, Then their canonical state is identical", () => {
    const state = opened();

    const forwards = [owner, hiddenOpponent, revealedOpponent].reduce(
      (current, playerId) =>
        accepted(passReaction(current, passCommand(current, playerId), context())),
      state,
    );
    const backwards = [revealedOpponent, hiddenOpponent, owner].reduce(
      (current, playerId) =>
        accepted(passReaction(current, passCommand(current, playerId), context())),
      state,
    );

    // Only the causation of the final command can differ; nothing about the
    // table's state may depend on the order the responses arrived in.
    expect(stableStringify({ ...backwards, lastCommandId: null })).toBe(
      stableStringify({ ...forwards, lastCommandId: null }),
    );
  });
});

describe("reaction.play", () => {
  it("Given a player who plays an ability while another player holds the turn, When the window closes, Then the effect is prevented and never applied", () => {
    const state = opened();
    // revealedOpponent is not the active player: reacting out of turn is the
    // entire mechanic, and must not be gated on turn.activePlayerId.
    expect(state.turn.activePlayerId).toBe(owner);

    const played = accepted(
      playReaction(
        state,
        playCommand(state, revealedOpponent, {
          abilityId: null,
          cardId: fixtureIds.revealedOpponentHandCard,
        }),
        context(),
      ),
    );
    const afterOwner = accepted(
      passReaction(played, passCommand(played, owner), context()),
    );
    const closing = passReaction(
      afterOwner,
      passCommand(afterOwner, hiddenOpponent),
      context(),
    );
    const closed = accepted(closing);

    expect(moneyOf(closed, hiddenOpponent)).toBe(500);
    expect(closed.reactionWindows).toEqual([]);
    expect(closed.pendingEffects).toEqual([]);
    expect(events(closing)).toEqual([
      expect.objectContaining({
        type: "EffectPrevented",
        payload: expect.objectContaining({
          preventedByPlayerId: revealedOpponent,
          sourceId: "tile.audit",
        }),
      }),
    ]);
  });

  it("Given a card played into a window, When it is spent, Then it leaves the hand for its deck's discard pile, face up", () => {
    const state = opened();
    const cardId = fixtureIds.ownerHandCard;

    const result = playReaction(
      state,
      playCommand(state, owner, { abilityId: null, cardId }),
      context(),
    );
    const next = accepted(result);

    expect(next.players[owner]?.hand).toEqual([]);
    expect(next.cards[cardId]?.zone).toBe("discard-pile");
    expect(next.cards[cardId]?.ownerId).toBeNull();
    expect(next.cards[cardId]?.faceUp).toBe(true);
    expect(next.decks[fixtureIds.deck]?.discardPile).toContain(cardId);
    expect(events(result)).toEqual([
      expect.objectContaining({
        type: "CardPlayed",
        payload: expect.objectContaining({ playerId: owner, cardId }),
      }),
    ]);
  });

  it("Given an ability played into a window, When it is spent, Then a use is burned", () => {
    const state = opened();

    const next = accepted(playReaction(state, playCommand(state, owner), context()));

    expect(next.players[owner]?.abilities[0]?.usesRemaining).toBe(0);
    expect(next.reactionWindows[0]?.playedByPlayerIds).toEqual([owner]);
  });

  it("Given two players who both react, When the window closes, Then priority decides who is credited, deterministically", () => {
    const state = opened();
    const first = accepted(
      playReaction(
        state,
        playCommand(state, owner, { abilityId: null, cardId: fixtureIds.ownerHandCard }),
        context(),
      ),
    );
    const second = accepted(
      playReaction(
        first,
        playCommand(first, hiddenOpponent, {
          abilityId: null,
          cardId: fixtureIds.hiddenOpponentHandCard,
        }),
        context(),
      ),
    );

    // Both are recorded, in canonical turn order rather than arrival order.
    expect(second.reactionWindows[0]?.playedByPlayerIds).toEqual([owner, hiddenOpponent]);
    // Priority sits on hiddenOpponent, so the walk starts at their seat.
    expect(reactionWindowPreventerId(second, second.reactionWindows[0]!)).toBe(
      hiddenOpponent,
    );

    const closing = passReaction(
      second,
      passCommand(second, revealedOpponent),
      context(),
    );
    expect(events(closing)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ preventedByPlayerId: hiddenOpponent }),
      }),
    ]);
  });

  it("Given no priority player, When several react, Then the walk starts from seat zero", () => {
    const state = opened(baseState(), { priorityPlayerId: null });
    const first = accepted(
      playReaction(
        state,
        playCommand(state, hiddenOpponent, {
          abilityId: null,
          cardId: fixtureIds.hiddenOpponentHandCard,
        }),
        context(),
      ),
    );
    const second = accepted(
      playReaction(
        first,
        playCommand(first, revealedOpponent, {
          abilityId: null,
          cardId: fixtureIds.revealedOpponentHandCard,
        }),
        context(),
      ),
    );

    expect(reactionWindowPreventerId(second, second.reactionWindows[0]!)).toBe(
      hiddenOpponent,
    );
  });
});

describe("authorisation", () => {
  it("Given a player who is not eligible, When they try to play into the window, Then it is refused", () => {
    const state = opened(baseState(), { eligiblePlayerIds: [owner, hiddenOpponent] });

    rejectedWith(
      playReaction(
        state,
        playCommand(state, revealedOpponent, {
          abilityId: null,
          cardId: fixtureIds.revealedOpponentHandCard,
        }),
        context(),
      ),
      "ACTOR_NOT_AUTHORIZED",
    );
  });

  it("Given a player who is not eligible, When they try to pass, Then it is refused", () => {
    const state = opened(baseState(), { eligiblePlayerIds: [owner, hiddenOpponent] });

    rejectedWith(
      passReaction(state, passCommand(state, revealedOpponent), context()),
      "ACTOR_NOT_AUTHORIZED",
    );
  });

  it("Given a refused response, When state is compared, Then nothing moved", () => {
    const state = opened(baseState(), { eligiblePlayerIds: [owner, hiddenOpponent] });
    const before = stableStringify(state);

    passReaction(state, passCommand(state, revealedOpponent), context());
    playReaction(
      state,
      playCommand(state, revealedOpponent, {
        abilityId: null,
        cardId: fixtureIds.revealedOpponentHandCard,
      }),
      context(),
    );

    expect(stableStringify(state)).toBe(before);
  });

  it("Given a player who has already answered, When they answer again, Then the second attempt is stale", () => {
    const state = opened();
    const passed = accepted(passReaction(state, passCommand(state, owner), context()));

    rejectedWith(
      passReaction(passed, passCommand(passed, owner), context()),
      "DECISION_POINT_STALE",
    );
    rejectedWith(
      playReaction(passed, playCommand(passed, owner), context()),
      "DECISION_POINT_STALE",
    );
  });

  it("Given a decisionPointId that names no open window, When a response arrives, Then it is refused", () => {
    const state = opened();
    const command: PassReactionCommand = {
      ...passCommand(state, owner),
      decisionPointId: brand<DecisionPointId>("decision-that-does-not-exist"),
    };

    rejectedWith(passReaction(state, command, context()), "DECISION_POINT_NOT_FOUND");
  });

  it("Given somebody else's card, When a player tries to spend it, Then it is refused — a reaction must not let me play your hand", () => {
    const state = opened();

    rejectedWith(
      playReaction(
        state,
        playCommand(state, owner, {
          abilityId: null,
          cardId: fixtureIds.hiddenOpponentHandCard,
        }),
        context(),
      ),
      "CARD_NOT_AVAILABLE",
    );
  });

  it("Given a card that is not in hand, When it is played, Then it is refused", () => {
    const state = opened();

    rejectedWith(
      playReaction(
        state,
        playCommand(state, owner, { abilityId: null, cardId: fixtureIds.visibleCard }),
        context(),
      ),
      "CARD_NOT_AVAILABLE",
    );
  });

  it("Given a play that names neither or both of a card and an ability, When it arrives, Then it is refused", () => {
    const state = opened();

    rejectedWith(
      playReaction(
        state,
        playCommand(state, owner, { abilityId: null, cardId: null }),
        context(),
      ),
      "INVALID_COMMAND",
    );
    rejectedWith(
      playReaction(
        state,
        playCommand(state, owner, { cardId: fixtureIds.ownerHandCard }),
        context(),
      ),
      "INVALID_COMMAND",
    );
  });

  it("Given a target who is not at this table, When a reaction names them, Then it is refused", () => {
    const state = opened();

    rejectedWith(
      playReaction(
        state,
        playCommand(state, owner, {
          targetPlayerIds: [brand<PlayerId>("player-who-is-not-here")],
        }),
        context(),
      ),
      "ILLEGAL_ACTION",
    );
  });

  it("Given an actor who is not a player at all, When they answer a window, Then they are not eligible", () => {
    const state = opened();

    rejectedWith(
      passReaction(state, passCommand(state, serverActor), context()),
      "ACTOR_NOT_AUTHORIZED",
    );
  });
});

describe("mode gating", () => {
  it("Given a mode with reaction windows switched off, When a player plays or passes, Then both are refused", () => {
    const state = withRules(opened(), { interaction: { reactionWindows: false } });

    rejectedWith(playReaction(state, playCommand(state, owner), context()), "ILLEGAL_ACTION");
    rejectedWith(passReaction(state, passCommand(state, owner), context()), "ILLEGAL_ACTION");
  });

  it("Given a mode with hands switched off, When a card reaction is played, Then it is refused but an ability reaction still works", () => {
    const state = withRules(opened(), { agency: { handEnabled: false } });

    rejectedWith(
      playReaction(
        state,
        playCommand(state, owner, { abilityId: null, cardId: fixtureIds.ownerHandCard }),
        context(),
      ),
      "ILLEGAL_ACTION",
    );
    expect(
      accepted(playReaction(state, playCommand(state, owner), context())).reactionWindows[0]
        ?.playedByPlayerIds,
    ).toEqual([owner]);
  });
});

describe("paying for a reaction", () => {
  it("Given an ability with no uses left, When it is played, Then it is refused for want of the resource", () => {
    const state = opened();
    const spent: GameState = {
      ...state,
      players: {
        ...state.players,
        [owner]: {
          ...state.players[owner]!,
          abilities: [{ ...state.players[owner]!.abilities[0]!, usesRemaining: 0 }],
        },
      },
    };

    rejectedWith(
      playReaction(spent, playCommand(spent, owner), context()),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given an ability still on cooldown, When it is played, Then it is refused", () => {
    const state = opened();
    const cooling: GameState = {
      ...state,
      players: {
        ...state.players,
        [owner]: {
          ...state.players[owner]!,
          abilities: [
            { ...state.players[owner]!.abilities[0]!, cooldownLapsRemaining: 2 },
          ],
        },
      },
    };

    rejectedWith(
      playReaction(cooling, playCommand(cooling, owner), context()),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given an ability the actor does not hold, When it is played, Then it is refused", () => {
    const state = opened();

    rejectedWith(
      playReaction(
        state,
        playCommand(state, revealedOpponent, {
          abilityId: brand<AbilityId>("ability-owner-secret"),
        }),
        context(),
      ),
      "ILLEGAL_ACTION",
    );
  });
});

describe("window.expire", () => {
  it("Given a player as the actor, When window.expire arrives, Then it is refused however entitled that player is", () => {
    const state = opened();

    for (const playerId of [owner, hiddenOpponent, revealedOpponent]) {
      rejectedWith(
        expireWindow(state, expireCommand(state, { actorId: playerId }), context()),
        "ACTOR_NOT_AUTHORIZED",
      );
    }
    // Same window, same command shape, only the actor differs: the refusal is
    // about who sent it and nothing else.
    expect(accepted(expireWindow(state, expireCommand(state), context())).reactionWindows).toEqual(
      [],
    );
  });

  it("Given a window nobody reacted to, When the server expires it, Then the guarded effect lands", () => {
    const state = opened();

    const closed = accepted(expireWindow(state, expireCommand(state), context()));

    expect(moneyOf(closed, hiddenOpponent)).toBe(400);
    expect(closed.reactionWindows).toEqual([]);
    expect(closed.turn.phase).toBe("pre-roll");
  });

  it("Given a window somebody reacted to, When the server expires it before the others answer, Then the effect is prevented", () => {
    const state = opened();
    const played = accepted(playReaction(state, playCommand(state, owner), context()));

    const closing = expireWindow(played, expireCommand(played), context());

    expect(moneyOf(accepted(closing), hiddenOpponent)).toBe(500);
    expect(events(closing)).toEqual([
      expect.objectContaining({
        type: "EffectPrevented",
        payload: expect.objectContaining({ preventedByPlayerId: owner }),
      }),
    ]);
  });

  it("Given a window that has already expired, When the scheduler fires again, Then the second fire cannot double-resolve", () => {
    const state = opened();
    const closed = accepted(expireWindow(state, expireCommand(state), context()));
    const before = stableStringify(closed);

    const second = expireWindow(closed, {
      ...expireCommand(state),
      commandId: brand<CommandId>("command-expire-again"),
      expectedRevision: closed.revision,
    }, context());

    rejectedWith(second, "DECISION_POINT_NOT_FOUND");
    expect(stableStringify(closed)).toBe(before);
    expect(moneyOf(closed, hiddenOpponent)).toBe(400);
  });

  it("Given a window closed by its last responder, When the scheduler's expire lands late, Then it finds nothing to do", () => {
    const closed = everyonePasses(opened());

    rejectedWith(
      expireWindow(
        closed,
        {
          commandId: brand<CommandId>("command-expire-late"),
          gameId: closed.gameId,
          actorId: serverActor,
          expectedRevision: closed.revision,
          type: "window.expire",
          payload: { decisionPointId: brand<DecisionPointId>("any") },
        },
        context(),
      ),
      "DECISION_POINT_NOT_FOUND",
    );
  });

  it("Given a ruleset that has since read as disabled, When the server drains a stranded window, Then it still closes — an open window blocks every other command", () => {
    const state = withRules(opened(), { interaction: { reactionWindows: false } });

    const closed = accepted(expireWindow(state, expireCommand(state), context()));

    expect(closed.reactionWindows).toEqual([]);
  });
});

describe("recovering a missed deadline", () => {
  it("Given windows with past, future and absent deadlines, When the server looks on load, Then only the passed one is returned", () => {
    const state = opened();
    const window = state.reactionWindows[0]!;
    const stranded: GameState = {
      ...state,
      reactionWindows: [
        window,
        { ...window, id: brand<DecisionPointId>("reaction-future"), deadlineAt: "2099-01-01T00:00:00.000Z" },
        { ...window, id: brand<DecisionPointId>("reaction-open-ended"), deadlineAt: null },
      ],
    };

    expect(
      expiredReactionWindows(stranded, "2026-07-18T12:00:30.000Z").map((found) => found.id),
    ).toEqual([window.id]);
    expect(expiredReactionWindows(stranded, "2026-07-18T12:00:05.000Z")).toEqual([]);
    expect(expiredReactionWindows(stranded, "not-a-timestamp")).toEqual([]);
  });

  it("Given a window whose deadline lands exactly now, When the server looks, Then it is treated as expired", () => {
    const state = opened();

    expect(expiredReactionWindows(state, "2026-07-18T12:00:10.000Z")).toHaveLength(1);
  });
});

describe("what a player is offered", () => {
  it("Given an open window, When each player's outstanding decisions are listed, Then only those who have not answered are offered one", () => {
    const state = opened();

    expect(openReactionWindowsFor(state, owner)).toHaveLength(1);

    const passed = accepted(passReaction(state, passCommand(state, owner), context()));
    expect(openReactionWindowsFor(passed, owner)).toEqual([]);
    expect(openReactionWindowsFor(passed, hiddenOpponent)).toHaveLength(1);
  });

  it("Given a window the player is not eligible for, When their decisions are listed, Then they are offered nothing", () => {
    const state = opened(baseState(), { eligiblePlayerIds: [owner] });

    expect(openReactionWindowsFor(state, revealedOpponent)).toEqual([]);
  });

  it("Given the server's own actor id, When it is checked against the table, Then it is recognised as not a seat", () => {
    const state = baseState();

    expect(isServerInjectedActor(state, serverActor)).toBe(true);
    expect(isServerInjectedActor(state, owner)).toBe(false);
  });
});

describe("determinism and the JSON boundary", () => {
  it("Given an open window, When canonical state is serialized, Then it round-trips unchanged", () => {
    const state = opened();

    expect(deserializeGameState(serializeGameState(state))).toEqual(state);
    expect(serializeGameState(deserializeGameState(serializeGameState(state)))).toBe(
      serializeGameState(state),
    );
  });

  it("Given a window closed by expiry, When the resulting state is serialized, Then it round-trips unchanged", () => {
    const closed = accepted(expireWindow(opened(), expireCommand(opened()), context()));

    expect(deserializeGameState(serializeGameState(closed))).toEqual(closed);
  });

  it("Given a state that has been through the jsonb boundary, When the same command is applied, Then it yields what the in-memory original did", () => {
    const state = opened();
    const restored = deserializeGameState(serializeGameState(state));

    const live = expireWindow(state, expireCommand(state), context());
    const resumed = expireWindow(restored, expireCommand(restored), context());

    expect(stableStringify(accepted(resumed))).toBe(stableStringify(accepted(live)));
    expect(stableStringify(events(resumed))).toBe(stableStringify(events(live)));
  });

  it("Given a frozen state, When each reaction transition is applied twice, Then both runs agree and the input is untouched", () => {
    const state = opened();

    appliesIdentically(state, (input) =>
      passReaction(input, passCommand(input, owner), context()),
    );
    appliesIdentically(state, (input) =>
      playReaction(input, playCommand(input, owner), context()),
    );
    appliesIdentically(state, (input) =>
      expireWindow(input, expireCommand(input), context()),
    );
  });

  it("Given two different logical timestamps, When a window is expired, Then only the timestamps differ", () => {
    const state = opened();

    const early = expireWindow(state, expireCommand(state), context("2020-01-01T00:00:00.000Z"));
    const late = expireWindow(state, expireCommand(state), context("2099-12-31T23:59:59.000Z"));
    const strip = (value: string) =>
      value
        .replaceAll("2020-01-01T00:00:00.000Z", "T")
        .replaceAll("2099-12-31T23:59:59.000Z", "T");

    expect(strip(stableStringify(events(late)))).toBe(strip(stableStringify(events(early))));
    expect(strip(stableStringify(accepted(late)))).toBe(strip(stableStringify(accepted(early))));
  });

  it("Given a guarded effect that consumes randomness, When the window is expired twice from the same state, Then the same faces are drawn", () => {
    const gamble: EffectDescriptor = {
      type: "rollCheck",
      dice: { count: 2, sides: 6 },
      rerollEligible: false,
      outcomes: [
        { when: { doubles: true }, effects: [{ type: "modifyResource", resource: "money", amount: 250 }] },
        { when: { doubles: false }, effects: [{ type: "modifyResource", resource: "money", amount: -50, clampAtZero: true }] },
      ],
    };
    const state = opened(baseState(), { effect: gamble });

    const closed = appliesIdentically(state, (input) =>
      expireWindow(input, expireCommand(input), context()),
    );

    // Whichever branch the seed picked, it moved money and did so reproducibly.
    expect(moneyOf(closed, hiddenOpponent)).not.toBe(500);
  });
});

describe("the pending-effect layer", () => {
  it("Given a stored effect outside this build's vocabulary, When the window resolves, Then nothing is applied and the window still closes cleanly", () => {
    const state = opened();
    const alien: GameState = {
      ...state,
      pendingEffects: [
        { ...state.pendingEffects[0]!, effect: { type: "transferResource", amount: 100 } },
      ],
    };

    const closed = accepted(expireWindow(alien, expireCommand(alien), context()));

    expect(moneyOf(closed, hiddenOpponent)).toBe(500);
    expect(closed.reactionWindows).toEqual([]);
    expect(closed.pendingEffects).toEqual([]);
    expect(pendingEffectDescriptor(alien.pendingEffects[0]!)).toBeNull();
    expect(
      applyPendingEffect(alien, alien.pendingEffects[0]!, preventionRandomSource(alien)).applied,
    ).toBe(false);
  });

  it("Given an effect affecting several players, When it is applied, Then it lands in canonical turn order", () => {
    const state = baseState();
    const pending = createPendingEffect(state, 1, {
      frameId: brand("frame-multi"),
      sourceId: "test",
      affectedPlayerIds: [revealedOpponent, owner],
      effect: fine,
      preventable: true,
    });

    expect(pending.affectedPlayerIds).toEqual([owner, revealedOpponent]);

    const application = applyPendingEffect(state, pending, preventionRandomSource(state));
    expect(application.changes.map((change) => change.playerId)).toEqual([
      owner,
      revealedOpponent,
    ]);
    expect(application.players[owner]?.resources["money"]?.value).toBe(400);
    expect(application.players[revealedOpponent]?.resources["money"]?.value).toBe(400);
    expect(application.players[hiddenOpponent]?.resources["money"]?.value).toBe(500);
  });

  it("Given the prevention stream and the tile-effect stream at the same state, When both draw, Then they are not the same stream", () => {
    const state = baseState();

    const prevention = Array.from({ length: 8 }, () => preventionRandomSource(state).next());
    const repeat = Array.from({ length: 8 }, () => preventionRandomSource(state).next());

    // Same state, same stream: replay-identical.
    expect(repeat).toEqual(prevention);
    // A different state moves it, so consecutive windows are independent draws.
    const later = preventionRandomSource({ ...state, revision: state.revision + 1 }).next();
    expect(later).not.toBe(prevention[0]);
  });

  it("Given a bare window guarding nothing, When it closes, Then it resolves without applying or cancelling anything", () => {
    const state = opened(baseState(), { effect: null, kind: "end-turn" });

    expect(state.pendingEffects).toEqual([]);
    const closing = expireWindow(state, expireCommand(state), context());

    expect(events(closing)).toEqual([]);
    expect(accepted(closing).reactionWindows).toEqual([]);
    expect(accepted(closing).turn.phase).toBe("pre-roll");
  });
});
