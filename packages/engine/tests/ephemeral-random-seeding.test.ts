import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  applyCommand,
  createEphemeralRandom,
  createSeededRandomSource,
  ephemeralRandomSeed,
  rollDie,
  stableStringify,
} from "../src";
import type {
  CommandId,
  DecisionPointId,
  FrameId,
  GameState,
  PromptOptionId,
  RespondToPromptCommand,
  TransitionValue,
} from "../src";
import { fixtureIds } from "./fixtures";
import {
  accepted,
  boardIndexOfKind,
  context,
  rollCommand,
  rollState,
} from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const PROMPT_ID = brand<DecisionPointId>("prompt-audit-seeding");
const PAY_FINE = brand<PromptOptionId>("pay-fine");
const ATTEMPT_ROLL = brand<PromptOptionId>("attempt-roll");

/** A copy of `state` whose canonical (server-owned) dice stream sits at `value`. */
function withDiceStreamState(state: GameState, value: string): GameState {
  const dice = state.rng.streams.dice;
  if (dice === undefined) throw new Error("fixture missing a dice stream");

  return {
    ...state,
    rng: { streams: { ...state.rng.streams, dice: { ...dice, state: value } } },
  };
}

/** An in-audit player facing an open audit-release prompt on their own turn. */
function confinedState(): GameState {
  const state = rollState(16);
  const owner = state.players[fixtureIds.owner];
  if (owner === undefined) throw new Error("fixture missing owner player");

  return {
    ...state,
    players: {
      ...state.players,
      [fixtureIds.owner]: {
        ...owner,
        inAudit: true,
        resources: { ...owner.resources, money: { ...owner.resources.money, value: 1000 } },
      },
    },
    prompts: [
      {
        id: PROMPT_ID,
        frameId: brand<FrameId>("frame-audit-seeding"),
        kind: "audit-release",
        audience: [fixtureIds.owner],
        legalResponses: [
          { id: PAY_FINE, value: null },
          { id: ATTEMPT_ROLL, value: null },
        ],
        deadlineAt: null,
        defaultResponse: { optionId: ATTEMPT_ROLL, value: null },
        visibility: "public",
        responses: {},
      },
    ],
  };
}

function attemptRoll(state: GameState, commandId: string): RespondToPromptCommand {
  return {
    commandId: brand<CommandId>(commandId),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    decisionPointId: PROMPT_ID,
    type: "prompt.respond",
    payload: { optionId: ATTEMPT_ROLL, value: null },
  };
}

/** Whether the engine's own seed for `state` releases the player. */
function serverSideReleases(state: GameState): boolean {
  const source = createEphemeralRandom(state, "audit-release");
  const first = rollDie(source);
  const second = rollDie(source);

  return first === second;
}

/** A confined state whose server-derived audit roll comes up `released`. */
function confinedStateWhere(released: boolean): GameState {
  for (let candidate = 1; candidate <= 500; candidate += 1) {
    const state = withDiceStreamState(confinedState(), String(candidate));
    if (serverSideReleases(state) === released) return state;
  }

  throw new Error(`no dice-stream state whose audit roll releases=${String(released)}`);
}

/**
 * The offline attack the old seeding allowed, run for real: enumerate candidate
 * command ids against the engine's own PRNG until one rolls doubles. This is
 * cheap — a handful of tries — which is exactly why seeding from a value the
 * client chooses was a guaranteed, free escape from a 500-money fine.
 */
function commandIdForcingDoublesUnderOldSeeding(): string {
  for (let candidate = 0; candidate < 10_000; candidate += 1) {
    const id = `attack-${candidate}`;
    const source = createSeededRandomSource(id);
    const first = rollDie(source);
    const second = rollDie(source);
    if (first === second) return id;
  }

  throw new Error("no command id produced doubles under the old seeding");
}

/**
 * Everything a command produced except the command id itself. Two runs with
 * different command ids must agree on this: the id is allowed to appear as
 * causation and as the idempotency marker, and nowhere else.
 */
function outcomeFingerprint(value: TransitionValue): string {
  return stableStringify({
    events: value.events.map((event) => ({
      ...event,
      causationCommandId: brand<CommandId>("redacted"),
    })),
    state: { ...value.state, lastCommandId: brand<CommandId>("redacted") },
  });
}

/** Command ids that satisfy the transport's own id grammar. */
const idCharacters = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-",
];
const commandIdArbitrary = fc
  .array(fc.constantFrom(...idCharacters), { minLength: 0, maxLength: 32 })
  .map((characters) => `c${characters.join("")}`);

describe("ephemeral randomness is seeded from server-owned state, not the command id", () => {
  it("Given a confined player whose server-side audit roll fails, When they submit a command id enumerated offline to force doubles, Then they stay in audit", () => {
    // The exploit this test exists for: under the old seeding the attempt's
    // faces came from createSeededRandomSource(command.commandId), so this id
    // released the player every time, first try, for free.
    const state = confinedStateWhere(false);
    const attackId = commandIdForcingDoublesUnderOldSeeding();

    const { state: next } = accepted(applyCommand(state, attemptRoll(state, attackId), context([])));

    expect(next.players[fixtureIds.owner]?.inAudit).toBe(true);
    // The prompt stays open: a failed attempt is not silently dropped.
    expect(next.prompts.map((prompt) => prompt.id)).toEqual([PROMPT_ID]);
    // ...and no fine was paid either, so this is a failure, not a release.
    expect(next.players[fixtureIds.owner]?.resources.money.value).toBe(1000);
  });

  it("Given a confined player whose server-side audit roll succeeds, When any command id is submitted, Then they are released", () => {
    // The mirror of the case above: the gamble still exists, it is just the
    // server's to resolve. Without this, "always fails" would also pass.
    const state = confinedStateWhere(true);

    for (const commandId of ["c1", commandIdForcingDoublesUnderOldSeeding(), "zzz"]) {
      const { state: next } = accepted(
        applyCommand(state, attemptRoll(state, commandId), context([])),
      );

      expect(next.players[fixtureIds.owner]?.inAudit).toBe(false);
      expect(next.prompts).toEqual([]);
    }
  });

  it("Given one state and many different command ids, When the audit attempt is applied, Then every run produces the same outcome", () => {
    const state = confinedStateWhere(false);

    const fingerprints = new Set(
      Array.from({ length: 64 }, (_, index) => `sweep-${index}`).map((commandId) =>
        outcomeFingerprint(accepted(applyCommand(state, attemptRoll(state, commandId), context([])))),
      ),
    );

    expect(fingerprints.size).toBe(1);
  });

  it("Given one state and many different command ids, When a turn is rolled, Then the tile-effect outcome is the same for all of them", () => {
    // Position 15 + die 1 lands on an event tile that draws a card, so this
    // roll really does consume the ephemeral tile-effect source.
    const state = rollState(15);

    const fingerprints = new Set(
      Array.from({ length: 64 }, (_, index) => `roll-sweep-${index}`).map((commandId) =>
        outcomeFingerprint(
          accepted(
            applyCommand(
              state,
              rollCommand(state, { commandId: brand<CommandId>(commandId) }),
              context([0]),
            ),
          ),
        ),
      ),
    );

    expect(fingerprints.size).toBe(1);
  });

  it("Given arbitrary command ids from the transport's id grammar, When the same state is rolled, Then the outcome distribution does not depend on them", () => {
    const state = rollState(15);
    const baseline = outcomeFingerprint(
      accepted(applyCommand(state, rollCommand(state), context([0]))),
    );

    fc.assert(
      fc.property(commandIdArbitrary, (commandId) => {
        const result = applyCommand(
          state,
          rollCommand(state, { commandId: brand<CommandId>(commandId) }),
          context([0]),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(outcomeFingerprint(result.value)).toBe(baseline);
      }),
      { numRuns: 200 },
    );
  });

  it("Given arbitrary command ids, When a confined player attempts the audit roll, Then release never depends on the id", () => {
    const failing = confinedStateWhere(false);
    const releasing = confinedStateWhere(true);

    fc.assert(
      fc.property(commandIdArbitrary, (commandId) => {
        const stuck = accepted(
          applyCommand(failing, attemptRoll(failing, commandId), context([])),
        );
        const freed = accepted(
          applyCommand(releasing, attemptRoll(releasing, commandId), context([])),
        );

        expect(stuck.state.players[fixtureIds.owner]?.inAudit).toBe(true);
        expect(freed.state.players[fixtureIds.owner]?.inAudit).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("Given the same command twice against the same state, When both are applied, Then the events are byte-identical including their ids", () => {
    const state = confinedStateWhere(false);
    const command = attemptRoll(state, "replay-me");

    const first = accepted(applyCommand(state, command, context([])));
    const second = accepted(applyCommand(state, command, context([])));

    expect(stableStringify(second.events)).toBe(stableStringify(first.events));
    expect(stableStringify(second.state)).toBe(stableStringify(first.state));
  });

  it("Given a failed audit attempt, When the next attempt is seeded, Then it draws from a later state rather than repeating the same losing roll", () => {
    const state = confinedStateWhere(false);
    const { state: afterFailure } = accepted(
      applyCommand(state, attemptRoll(state, "first-attempt"), context([])),
    );

    expect(ephemeralRandomSeed(afterFailure, "audit-release")).not.toBe(
      ephemeralRandomSeed(state, "audit-release"),
    );
    // Both of the monotonic server-owned counters in the seed moved on.
    expect(afterFailure.revision).toBeGreaterThan(state.revision);
    expect(afterFailure.eventSequence).toBeGreaterThan(state.eventSequence);
  });

  it("Given one state, When each purpose derives its seed, Then the purposes are domain-separated rather than sharing a stream", () => {
    const state = confinedStateWhere(false);
    const purposes = ["tile-effects", "audit-release", "tile-decision"] as const;

    const seeds = purposes.map((purpose) => ephemeralRandomSeed(state, purpose));
    expect(new Set(seeds).size).toBe(purposes.length);

    // Distinct seed strings would still be worthless if they collided through
    // the 32-bit hash, so check the streams themselves diverge.
    const firstDraws = purposes.map((purpose) => {
      const source = createEphemeralRandom(state, purpose);
      return Array.from({ length: 8 }, () => rollDie(source)).join(",");
    });
    expect(new Set(firstDraws).size).toBe(purposes.length);
  });

  it("Given one purpose, When a second source is created for it at the same state, Then it repeats the first rather than continuing it", () => {
    // Not a bug — the documented contract, pinned because violating it is silent.
    // The seed is a pure function of (state, purpose) and `state` does not move
    // while a command is resolving, so a second `createEphemeralRandom` call for a
    // purpose already in use hands back a stream at position zero, and every draw
    // from it repeats the first source's. Two draws that were meant to be
    // independent would then be perfectly correlated. Anything needing more
    // randomness must keep drawing from the source it already holds — the way a
    // nested rollCheck and a multi-card draw do, advancing one cursor — or declare
    // a new purpose.
    const state = confinedStateWhere(false);

    const held = createEphemeralRandom(state, "tile-effects");
    const firstThree = [rollDie(held), rollDie(held), rollDie(held)];
    const secondSource = createEphemeralRandom(state, "tile-effects");

    expect([rollDie(secondSource), rollDie(secondSource), rollDie(secondSource)]).toEqual(
      firstThree,
    );
    // Continuing to draw from the source already held does advance, which is why
    // the single-source discipline is sufficient.
    expect(rollDie(held)).not.toBe(undefined);
    expect(held.getCursor()).toBe(4);
    expect(secondSource.getCursor()).toBe(3);
  });

  it("Given a rolled turn, When its events are inspected, Then every event id comes from the game and its own sequence, not from the command", () => {
    const state = rollState(15);
    const commandId = "distinctive-client-chosen-id";
    const { events } = accepted(
      applyCommand(
        state,
        rollCommand(state, { commandId: brand<CommandId>(commandId) }),
        context([0]),
      ),
    );

    expect(events.length).toBeGreaterThan(1);
    for (const event of events) {
      expect(event.eventId).toBe(`${state.gameId}:event:${event.sequence}`);
      expect(event.eventId).not.toContain(commandId);
      // The id is still recorded, as causation — that part is legitimate.
      expect(event.causationCommandId).toBe(commandId);
    }
    // Unique within the command, so no event can overwrite another.
    expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
  });

  it("Given a landing that opens a prompt, When the prompt is built, Then its id and frame id come from the game and event sequence, not from the command", () => {
    const state = rollState(16);
    const commandId = "another-client-chosen-id";

    // die = 6 lands on tile.board.22.audit
    const { state: next, events } = accepted(
      applyCommand(
        state,
        rollCommand(state, { commandId: brand<CommandId>(commandId) }),
        context([0.9]),
      ),
    );

    const prompt = next.prompts[0];
    if (prompt === undefined) throw new Error("expected the audit prompt to open");
    const opened = events.find((event) => event.type === "PromptOpened");
    if (opened === undefined) throw new Error("expected a PromptOpened event");

    expect(prompt.id).toBe(`${state.gameId}:prompt:${opened.sequence}:audit-release`);
    expect(prompt.frameId).toBe(`${state.gameId}:frame:${opened.sequence}`);
    expect(prompt.id).not.toContain(commandId);
    expect(prompt.frameId).not.toContain(commandId);
  });

  it("Given a prevented negative effect, When its EffectPrevented event is emitted, Then the effect id comes from the game and that event's own sequence", () => {
    const base = rollState(boardIndexOfKind("finance") - 1);
    const owner = base.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner player");
    // Tech Genius's ignoreNegativeEffect cancels the finance tile's payment (one
    // space short of it, die 1 lands there), which is what emits EffectPrevented.
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        [fixtureIds.owner]: {
          ...owner,
          characterId: brand("character.tech-genius"),
          statuses: [],
          resources: { ...owner.resources, money: { ...owner.resources.money, value: 1000 } },
        },
      },
    };
    const commandId = "effect-id-client-chosen";

    const { events } = accepted(
      applyCommand(
        state,
        rollCommand(state, { commandId: brand<CommandId>(commandId) }),
        context([0]),
      ),
    );

    const prevented = events.find((event) => event.type === "EffectPrevented");
    if (prevented === undefined || prevented.type !== "EffectPrevented") {
      throw new Error("expected an EffectPrevented event");
    }
    expect(prevented.payload.effectId).toBe(
      `${state.gameId}:effect-prevented:${prevented.sequence}`,
    );
    expect(prevented.payload.effectId).not.toContain(commandId);
  });

  it("Given a prompt id the engine minted, When it is checked against the transport's id grammar, Then it is still a legal opaque id", () => {
    // The client posts this straight back as `decisionPointId`, so a derivation
    // that produced an unparseable id would break the flow it protects.
    const state = rollState(16);
    const { state: next } = accepted(applyCommand(state, rollCommand(state), context([0.9])));
    const prompt = next.prompts[0];
    if (prompt === undefined) throw new Error("expected the audit prompt to open");

    expect(prompt.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    expect(prompt.frameId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  });

  it("Given the ephemeral seed, When it is derived, Then it contains no client-supplied field and every server-owned one", () => {
    const state = confinedStateWhere(false);
    const dice = state.rng.streams.dice;
    if (dice === undefined) throw new Error("fixture missing a dice stream");

    const seed = ephemeralRandomSeed(state, "tile-effects");

    for (const field of [
      "tile-effects",
      state.gameId,
      String(state.revision),
      String(state.eventSequence),
      dice.algorithm,
      dice.state,
      String(dice.cursor),
    ]) {
      expect(seed).toContain(field);
    }
    expect(seed).not.toContain(String(state.lastCommandId));
  });
});
