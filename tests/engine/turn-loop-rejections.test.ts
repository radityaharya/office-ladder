import { describe, expect, it } from "vitest";

import {
  applyCommand,
  type CommandId,
  type GameId,
  createScriptedRandomSource,
} from "../../src/engine";
import { deadlineDashContent } from "../../src/content/deadline-dash";
import { fixtureIds } from "./fixtures";
import {
  context,
  logicalTimestamp,
  rejected,
  rollCommand,
  rollState,
} from "./turn-loop-fixtures";

const branded = <Id extends string>(value: string) => value as Id;

describe("turn command rejection", () => {
  it("Given a committed state, when a command has a stale revision, then state and RNG are preserved", () => {
    const state = rollState(3);
    const command = rollCommand(state, { expectedRevision: state.revision - 1 });
    const before = structuredClone(state);
    const random = createScriptedRandomSource([0, 0]);

    const result = applyCommand(state, command, {
      logicalTimestamp,
      random,
      content: deadlineDashContent,
    });

    rejected(result, "STALE_REVISION");
    expect(state).toEqual(before);
    expect(random.getCursor()).toBe(0);
  });

  it("Given a committed state, when the wrong actor rolls, then the command is rejected without mutation", () => {
    const state = rollState(3);
    const command = rollCommand(state, { actorId: fixtureIds.hiddenOpponent });

    rejected(applyCommand(state, command, context([0, 0])), "NOT_ACTOR_TURN");
    expect(state).toEqual(rollState(3));
  });

  it("Given a committed state, when the last command is submitted again, then it is rejected without consuming RNG", () => {
    const state = { ...rollState(3), lastCommandId: branded<CommandId>("command-roll") };
    const command = rollCommand(state);
    const random = createScriptedRandomSource([0, 0]);

    rejected(
      applyCommand(state, command, {
        logicalTimestamp,
        random,
        content: deadlineDashContent,
      }),
      "INVALID_COMMAND",
    );
    expect(random.getCursor()).toBe(0);
  });

  it("Given a committed state, when a command targets another game, then it is rejected without mutation", () => {
    const state = rollState(3);
    const command = rollCommand(state, { gameId: branded<GameId>("game-other") });

    rejected(applyCommand(state, command, context([0, 0])), "INVALID_COMMAND");
    expect(state).toEqual(rollState(3));
  });

  it("Given a committed state, when an unsupported command type is submitted, then it is rejected without mutation", () => {
    const state = rollState(3);
    const command = rollCommand(state);
    Reflect.set(command, "type", "turn.unsupported");

    rejected(applyCommand(state, command, context([0, 0])), "INVALID_COMMAND");
    expect(state).toEqual(rollState(3));
  });

  it("Given an unsupported command with an unknown actor, when submitted, then command type is rejected first", () => {
    const state = rollState(3);
    const command = rollCommand(state, {
      actorId: branded<typeof fixtureIds.owner>("player-missing"),
    });
    Reflect.set(command, "type", "turn.unsupported");

    rejected(applyCommand(state, command, context([0])), "INVALID_COMMAND");
  });

  it("Given a corrupt persisted dice state, when rolling, then the engine rejects without throwing", () => {
    const state = {
      ...rollState(3),
      rng: {
        streams: {
          dice: {
            algorithm: "xorshift32",
            version: "1",
            state: "0",
            cursor: 0,
          },
        },
      },
    };

    rejected(
      applyCommand(state, rollCommand(state), {
        logicalTimestamp,
        content: deadlineDashContent,
      }),
      "INVARIANT_VIOLATION",
    );
  });
});
