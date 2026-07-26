import { describe, expect, it } from "vitest";

import type {
  ActivateCharacterCommand,
  CommandId,
  GameState,
  PlayerState,
} from "../src";
import {
  AGENCY_STATUS_IDS,
  abilityAvailability,
  activateCharacter,
  characterActiveAbilityId,
} from "../src/execution/agency";
import {
  accepted,
  agencyContext,
  agencyIds,
  agencyState,
  branded,
  commandBase,
  expectRoundTrips,
  rejected,
  resourceValue,
} from "./agency-fixtures";

function activate(
  state: GameState,
  characterId: string,
  overrides: Partial<ActivateCharacterCommand> = {},
): ActivateCharacterCommand {
  return {
    ...commandBase(state, `activate-${characterId}`),
    type: "turn.activate-character",
    payload: {
      abilityId: characterActiveAbilityId(characterId),
      targetPlayerIds: [],
      choice: null,
    },
    ...overrides,
  };
}

function owner(state: GameState): PlayerState {
  const player = state.players[agencyIds.owner];
  if (player === undefined) throw new Error("fixture missing owner");

  return player;
}

/** Every targeted active needs a mode that models targeting and its price. */
const targetingRules = {
  conflict: { targetedAttacks: true, heatEnabled: true, heatPerAttack: 1 },
} as const;

describe("turn.activate-character — self actives", () => {
  it("Given the Workaholic, When they buy their energy back, Then money is charged, energy refills and the turn action is spent", () => {
    const state = agencyState({
      owner: { characterId: "character.workaholic", money: 1000, energy: 1, energyMaximum: 5 },
    });

    const { state: next, events } = accepted(
      activateCharacter(state, activate(state, "character.workaholic"), agencyContext()),
    );

    expect(resourceValue(next, agencyIds.owner, "money")).toBe(900);
    expect(resourceValue(next, agencyIds.owner, "energy")).toBe(5);
    expect(next.turn).toEqual(state.turn);
    expect(events.at(-1)?.type).toBe("EffectProposed");
    expectRoundTrips(next);
  });

  it("Given the Workaholic has used their active, When they try again on the same lap, Then the cooldown refuses it", () => {
    const state = agencyState({
      owner: { characterId: "character.workaholic", money: 1000, energy: 1, lapsCompleted: 0 },
      rules: { agency: { freeActionsPerTurn: 2 } },
    });
    const { state: after } = accepted(
      activateCharacter(state, activate(state, "character.workaholic"), agencyContext()),
    );

    const availability = abilityAvailability(
      after,
      owner(after),
      characterActiveAbilityId("character.workaholic"),
    );
    expect(availability.ready).toBe(false);
    expect(availability.cooldownLapsRemaining).toBe(2);
    rejected(
      activateCharacter(
        after,
        activate(after, "character.workaholic", {
          commandId: branded<CommandId>("activate-again"),
        }),
        agencyContext(),
      ),
      "ILLEGAL_ACTION",
    );
  });

  it("Given the cooldown's laps have been completed, When the active is used again, Then it is ready", () => {
    const state = agencyState({
      owner: { characterId: "character.workaholic", money: 1000, energy: 1, lapsCompleted: 0 },
    });
    const { state: after } = accepted(
      activateCharacter(state, activate(state, "character.workaholic"), agencyContext()),
    );
    const lapsLater: GameState = {
      ...after,
      players: {
        ...after.players,
        [agencyIds.owner]: { ...owner(after), lapsCompleted: 2 },
      },
    };

    expect(
      abilityAvailability(
        lapsLater,
        owner(lapsLater),
        characterActiveAbilityId("character.workaholic"),
      ).ready,
    ).toBe(true);
  });

  it("Given the Sales Star, When they bank their next salary, Then the status the roll transition already consumes is applied", () => {
    const state = agencyState({ owner: { characterId: "character.sales-star" } });

    const { state: next, events } = accepted(
      activateCharacter(state, activate(state, "character.sales-star"), agencyContext()),
    );

    const status = owner(next).statuses.find(
      (candidate) => candidate.id === AGENCY_STATUS_IDS.nextSalaryMultiplier,
    );
    expect(status?.data).toEqual({ multiplier: 2 });
    expect(events.some((event) => event.type === "StatusApplied")).toBe(true);
    expectRoundTrips(next);
  });

  it("Given the Lucky Employee, When they spend their reroll, Then it is held for the next roll and the turns cooldown is enforced", () => {
    const state = agencyState({ owner: { characterId: "character.lucky-employee" } });

    const { state: next } = accepted(
      activateCharacter(state, activate(state, "character.lucky-employee"), agencyContext()),
    );

    expect(
      owner(next).statuses.some((status) => status.id === AGENCY_STATUS_IDS.rollReroll),
    ).toBe(true);
    const abilityId = characterActiveAbilityId("character.lucky-employee");
    expect(abilityAvailability(next, owner(next), abilityId).cooldownTurnsRemaining).toBe(5);
    const laterTurn: GameState = {
      ...next,
      turn: { ...next.turn, number: next.turn.number + 5 },
    };
    expect(abilityAvailability(laterTurn, owner(laterTurn), abilityId).ready).toBe(true);
  });

  it("Given the Tech Genius, When they teleport, Then they arrive without traversing and without gaining a lap", () => {
    const state = agencyState({
      owner: { characterId: "character.tech-genius", position: 3, lapsCompleted: 1 },
    });

    const { state: next, events } = accepted(
      activateCharacter(
        state,
        activate(state, "character.tech-genius", {
          payload: {
            abilityId: characterActiveAbilityId("character.tech-genius"),
            targetPlayerIds: [],
            choice: { tileIndex: 12 },
          },
        }),
        agencyContext(),
      ),
    );

    expect(owner(next).position).toBe(12);
    expect(owner(next).lapsCompleted).toBe(1);
    expect(
      events.some(
        (event) => event.type === "PlayerMoved" && event.payload.direction === "teleport",
      ),
    ).toBe(true);
    expectRoundTrips(next);
  });

  it.each([-1, 999, Number.NaN])(
    "Given a teleport to tile %s, When it is applied, Then the destination is refused",
    (tileIndex) => {
      const state = agencyState({ owner: { characterId: "character.tech-genius" } });

      rejected(
        activateCharacter(
          state,
          activate(state, "character.tech-genius", {
            payload: {
              abilityId: characterActiveAbilityId("character.tech-genius"),
              targetPlayerIds: [],
              choice: { tileIndex },
            },
          }),
          agencyContext(),
        ),
        "INVALID_COMMAND",
      );
    },
  );
});

describe("turn.activate-character — targeted actives", () => {
  it("Given the Social Butterfly, When they swap places, Then both players move and the actor's heat rises", () => {
    const state = agencyState({
      rules: targetingRules,
      owner: { characterId: "character.social-butterfly", position: 2 },
      opponent: { position: 17 },
    });

    const { state: next, events } = accepted(
      activateCharacter(
        state,
        activate(state, "character.social-butterfly", {
          payload: {
            abilityId: characterActiveAbilityId("character.social-butterfly"),
            targetPlayerIds: [agencyIds.hiddenOpponent],
            choice: null,
          },
        }),
        agencyContext(),
      ),
    );

    expect(owner(next).position).toBe(17);
    expect(next.players[agencyIds.hiddenOpponent]?.position).toBe(2);
    expect(owner(next).heat.value).toBe(1);
    expect(events.filter((event) => event.type === "PlayerMoved")).toHaveLength(2);
    expectRoundTrips(next);
  });

  it("Given the Office Politician, When they steal reputation, Then it moves off the target and onto the actor", () => {
    const state = agencyState({
      rules: targetingRules,
      owner: { characterId: "character.office-politician", reputation: 1 },
      opponent: { reputation: 4 },
    });

    const { state: next } = accepted(
      activateCharacter(
        state,
        activate(state, "character.office-politician", {
          payload: {
            abilityId: characterActiveAbilityId("character.office-politician"),
            targetPlayerIds: [agencyIds.hiddenOpponent],
            choice: null,
          },
        }),
        agencyContext(),
      ),
    );

    expect(resourceValue(next, agencyIds.hiddenOpponent, "reputation")).toBe(2);
    expect(resourceValue(next, agencyIds.owner, "reputation")).toBe(3);
    expectRoundTrips(next);
  });

  it("Given a target holding less than the theft, When it resolves, Then it takes what is there rather than failing", () => {
    const state = agencyState({
      rules: targetingRules,
      owner: { characterId: "character.office-politician", reputation: 0 },
      opponent: { reputation: 1 },
    });

    const { state: next } = accepted(
      activateCharacter(
        state,
        activate(state, "character.office-politician", {
          payload: {
            abilityId: characterActiveAbilityId("character.office-politician"),
            targetPlayerIds: [agencyIds.hiddenOpponent],
            choice: null,
          },
        }),
        agencyContext(),
      ),
    );

    expect(resourceValue(next, agencyIds.hiddenOpponent, "reputation")).toBe(0);
    expect(resourceValue(next, agencyIds.owner, "reputation")).toBe(1);
  });

  it("Given a mode with targeting switched off, When a targeted active is used, Then it is refused and nobody moves", () => {
    const state = agencyState({
      rules: { conflict: { targetedAttacks: false } },
      owner: { characterId: "character.social-butterfly", position: 2 },
      opponent: { position: 17 },
    });

    rejected(
      activateCharacter(
        state,
        activate(state, "character.social-butterfly", {
          payload: {
            abilityId: characterActiveAbilityId("character.social-butterfly"),
            targetPlayerIds: [agencyIds.hiddenOpponent],
            choice: null,
          },
        }),
        agencyContext(),
      ),
      "ILLEGAL_ACTION",
    );
    expect(state.players[agencyIds.hiddenOpponent]?.position).toBe(17);
  });

  it("Given a targeted active aimed at its own actor, When it is applied, Then the command is refused", () => {
    const state = agencyState({
      rules: targetingRules,
      owner: { characterId: "character.office-politician" },
    });

    rejected(
      activateCharacter(
        state,
        activate(state, "character.office-politician", {
          payload: {
            abilityId: characterActiveAbilityId("character.office-politician"),
            targetPlayerIds: [agencyIds.owner],
            choice: null,
          },
        }),
        agencyContext(),
      ),
      "INVALID_COMMAND",
    );
  });
});

describe("turn.activate-character — authorisation and refusals", () => {
  it("Given a player who is not the active one, When they activate, Then it is refused as not their turn", () => {
    const state = agencyState({ owner: { characterId: "character.sales-star" } });

    rejected(
      activateCharacter(
        state,
        activate(state, "character.sales-star", { actorId: agencyIds.hiddenOpponent }),
        agencyContext(),
      ),
      "NOT_ACTOR_TURN",
    );
  });

  it("Given an ability id belonging to a different character, When it is submitted, Then the actor is not authorised to use it", () => {
    const state = agencyState({ owner: { characterId: "character.sales-star" } });

    rejected(
      activateCharacter(
        state,
        activate(state, "character.sales-star", {
          payload: {
            abilityId: characterActiveAbilityId("character.tech-genius"),
            targetPlayerIds: [],
            choice: null,
          },
        }),
        agencyContext(),
      ),
      "ACTOR_NOT_AUTHORIZED",
    );
  });

  it("Given the Workaholic cannot afford their own active, When they use it, Then it is refused for insufficient money", () => {
    const state = agencyState({
      owner: { characterId: "character.workaholic", money: 50, energy: 1 },
    });

    rejected(
      activateCharacter(state, activate(state, "character.workaholic"), agencyContext()),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given a mode that grants no turn actions, When an active is used, Then the whole mechanic is off", () => {
    const state = agencyState({
      owner: { characterId: "character.sales-star" },
      rules: { agency: { freeActionsPerTurn: 0 } },
    });

    rejected(
      activateCharacter(state, activate(state, "character.sales-star"), agencyContext()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a character the content pack does not know, When they activate, Then the mismatch is reported rather than guessed at", () => {
    const state = agencyState({ owner: { characterId: "character.invented" } });

    rejected(
      activateCharacter(state, activate(state, "character.invented"), agencyContext()),
      "CONTENT_MISMATCH",
    );
  });

  it("Given the turn's action already spent on a free action, When an active is used, Then they compete for the same budget", () => {
    const state = agencyState({
      owner: { characterId: "character.sales-star" },
      rules: { agency: { freeActionsPerTurn: 1 } },
    });
    const { state: after } = accepted(
      activateCharacter(state, activate(state, "character.sales-star"), agencyContext()),
    );

    rejected(
      activateCharacter(
        after,
        activate(after, "character.sales-star", { commandId: branded<CommandId>("activate-twice") }),
        agencyContext(),
      ),
      "ILLEGAL_ACTION",
    );
  });
});
