import { describe, expect, it } from "vitest";

import { projectPlayerView, projectPublicView } from "../src";
import type { GameState, ObjectiveState, PlayerId, ProjectState } from "../src";
import {
  createSharedSpaceGameState,
  fixtureIds,
  hiddenSabotageAmount,
  secretSentinels,
  sharedSpaceIds,
  sharedSpaceSentinels,
} from "./fixtures";
import { withRules } from "./turn-loop-fixtures";

/**
 * Adversarial redaction tests for spec §7.2.
 *
 * Every assertion here serialises a whole payload and looks for a sentinel
 * *anywhere* in the string, rather than reading the field it expects the secret
 * to live in. A field-by-field assertion passes happily when a secret gets
 * nested somewhere new — under `data`, inside a prompt option, in an outcome
 * blob — which is exactly how this class of bug ships.
 */

const { owner, hiddenOpponent, revealedOpponent } = fixtureIds;
const seats: readonly PlayerId[] = [owner, hiddenOpponent, revealedOpponent];

const serialized = (value: unknown) => JSON.stringify(value);

const expectAbsent = (value: unknown, sentinels: readonly string[]) => {
  const json = serialized(value);
  for (const sentinel of sentinels) {
    expect(json).not.toContain(sentinel);
  }
};

/** Every viewer's payload, plus the table's, keyed for exhaustive sweeps. */
const everyView = (state: GameState) => [
  ...seats.map((viewerId) => ({
    viewerId,
    view: projectPlayerView(state, viewerId) as unknown,
  })),
  { viewerId: null, view: projectPublicView(state) as unknown },
];

const objectiveOf = (state: GameState, id: string): ObjectiveState => {
  const objective = state.objectives.find((entry) => entry.id === id);
  if (!objective) throw new Error(`fixture is missing objective ${id}`);
  return objective;
};

const projectOf = (state: GameState): ProjectState => {
  const project = state.projects[0];
  if (!project) throw new Error("fixture is missing its project");
  return project;
};

const withObjective = (
  state: GameState,
  id: string,
  patch: Partial<ObjectiveState>,
): GameState => ({
  ...state,
  objectives: state.objectives.map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry,
  ),
});

describe("§7.2 hands project as a count, never contents", () => {
  it("keeps every other seat's hand out of every payload", () => {
    const state = createSharedSpaceGameState();
    const handSecretsOf: Readonly<Record<string, readonly string[]>> = {
      [owner]: [
        secretSentinels.ownerHandDefinition,
        fixtureIds.ownerHandCard,
      ],
      [hiddenOpponent]: [
        secretSentinels.hiddenOpponentHandDefinition,
        fixtureIds.hiddenOpponentHandCard,
      ],
      [revealedOpponent]: [
        secretSentinels.revealedOpponentHandDefinition,
        fixtureIds.revealedOpponentHandCard,
      ],
    };

    for (const { viewerId, view } of everyView(state)) {
      for (const seat of seats) {
        if (seat === viewerId) continue;
        expectAbsent(view, handSecretsOf[seat]);
      }
    }
  });

  it("still reports the count for every seat, and the viewer's own hand in full", () => {
    const state = createSharedSpaceGameState();
    const view = projectPlayerView(state, owner);

    expect(view.players.map((player) => player.handCount)).toEqual([1, 1, 1]);
    expect(view.self.hand).toEqual([
      expect.objectContaining({
        id: fixtureIds.ownerHandCard,
        definitionId: secretSentinels.ownerHandDefinition,
      }),
    ]);
    expect(projectPublicView(state).players.map((p) => p.handCount)).toEqual([
      1, 1, 1,
    ]);
  });

  it("keeps hands to a count even when the ruleset switches hidden hands off", () => {
    // The redaction is structural, not mode-driven: `PublicPlayerProjection`
    // has no field a card could travel in, so no ruleset can turn it back on.
    const state = withRules(createSharedSpaceGameState(), {
      hidden: {
        ...createSharedSpaceGameState().rules.hidden,
        hiddenHands: false,
        rolesEnabled: false,
      },
    });

    for (const { viewerId, view } of everyView(state)) {
      for (const seat of seats) {
        if (seat === viewerId) continue;
        expectAbsent(view, [
          seat === owner
            ? secretSentinels.ownerHandDefinition
            : seat === hiddenOpponent
              ? secretSentinels.hiddenOpponentHandDefinition
              : secretSentinels.revealedOpponentHandDefinition,
        ]);
      }
    }
  });
});

describe("§7.2 secret objectives project as existence-only", () => {
  it("gives every other viewer existence and nothing else", () => {
    const state = createSharedSpaceGameState();
    const secret = objectiveOf(state, sharedSpaceIds.secretObjective);

    for (const { viewerId, view } of everyView(state)) {
      if (viewerId === hiddenOpponent) continue;
      const typed = view as ReturnType<typeof projectPublicView>;
      const projected = typed.objectives.find(
        (entry) => entry.id === sharedSpaceIds.secretObjective,
      );

      // Existence, ownership and completion are disclosed; nothing else is.
      expect(projected).toEqual({
        id: secret.id,
        ownerId: hiddenOpponent,
        visibility: "secret",
        completedAtRound: null,
        definitionId: null,
        progress: null,
        target: null,
        rewardPoints: null,
        rewardMoney: null,
      });
      expectAbsent(view, [sharedSpaceSentinels.secretObjective]);
    }
  });

  it("discloses the viewer's own secret objective in full", () => {
    const state = createSharedSpaceGameState();
    const view = projectPlayerView(state, hiddenOpponent);
    const projected = view.objectives.find(
      (entry) => entry.id === sharedSpaceIds.secretObjective,
    );

    expect(projected).toEqual(
      expect.objectContaining({
        definitionId: sharedSpaceSentinels.secretObjective,
        progress: 2,
        target: 3,
        rewardPoints: 750,
        rewardMoney: 250,
      }),
    );
  });

  it("discloses a secret objective to the table once it has completed", () => {
    const state = withObjective(
      createSharedSpaceGameState(),
      sharedSpaceIds.secretObjective,
      { completedAtRound: 3 },
    );

    for (const { view } of everyView(state)) {
      const typed = view as ReturnType<typeof projectPublicView>;
      const projected = typed.objectives.find(
        (entry) => entry.id === sharedSpaceIds.secretObjective,
      );
      expect(projected?.definitionId).toBe(
        sharedSpaceSentinels.secretObjective,
      );
      expect(projected?.rewardPoints).toBe(750);
    }
  });

  it("never redacts a public objective", () => {
    const state = createSharedSpaceGameState();
    const projected = projectPublicView(state).objectives.find(
      (entry) => entry.id === sharedSpaceIds.publicObjective,
    );

    expect(projected?.definitionId).toBe("objective.ship-two-projects");
    expect(projected?.progress).toBe(1);
  });
});

describe("§7.2 owner-only placements are absent, not flagged", () => {
  it("omits the row entirely from every other payload", () => {
    const state = createSharedSpaceGameState();

    for (const { viewerId, view } of everyView(state)) {
      if (viewerId === hiddenOpponent) continue;
      const typed = view as ReturnType<typeof projectPublicView>;

      // Omission is the point: a redacted placeholder would still tell the
      // table that *something* is waiting on that tile.
      expect(typed.placements.map((placement) => placement.id)).toEqual([
        sharedSpaceIds.publicPlacement,
      ]);
      expectAbsent(view, [
        sharedSpaceIds.ownerOnlyPlacement,
        sharedSpaceSentinels.ownerOnlyPlacement,
      ]);
    }
  });

  it("shows an owner-only placement to its owner, in the same array", () => {
    const state = createSharedSpaceGameState();
    const view = projectPlayerView(state, hiddenOpponent);

    expect(view.placements.map((placement) => placement.id).sort()).toEqual(
      [sharedSpaceIds.ownerOnlyPlacement, sharedSpaceIds.publicPlacement].sort(),
    );
    expect(serialized(view)).toContain(
      sharedSpaceSentinels.ownerOnlyPlacement,
    );
  });
});

describe("§7.2 sealed ballots leak neither values nor castBy keys", () => {
  it("withholds the whole record from every viewer, including the caster", () => {
    const state = createSharedSpaceGameState();

    for (const { view } of everyView(state)) {
      const typed = view as ReturnType<typeof projectPublicView>;
      const sealed = typed.ballots.find(
        (ballot) => ballot.id === sharedSpaceIds.sealedBallot,
      );

      expect(sealed?.castBy).toBeNull();
      expect(sealed?.castCount).toBe(1);
    }

    // The cast value itself reaches nobody but the caster, and the *keys* —
    // which are voter ids — reach nobody at all.
    for (const viewerId of [owner, revealedOpponent]) {
      const view = projectPlayerView(state, viewerId);
      expectAbsent(view, [sharedSpaceSentinels.sealedBallotCast]);
      expect(sharedSpaceIds.sealedBallot in view.self.ballotCasts).toBe(false);
    }
    expectAbsent(projectPublicView(state), [
      sharedSpaceSentinels.sealedBallotCast,
    ]);
  });

  it("hands the caster their own cast back through self.ballotCasts only", () => {
    const state = createSharedSpaceGameState();
    const view = projectPlayerView(state, hiddenOpponent);

    expect(view.self.ballotCasts[sharedSpaceIds.sealedBallot]).toBe(
      sharedSpaceSentinels.sealedBallotCast,
    );
    expect(
      view.ballots.find((ballot) => ballot.id === sharedSpaceIds.sealedBallot)
        ?.castBy,
    ).toBeNull();
  });

  it("reveals every cast at once when the sealed ballot resolves", () => {
    const base = createSharedSpaceGameState();
    const state: GameState = {
      ...base,
      ballots: base.ballots.map((ballot) =>
        ballot.id === sharedSpaceIds.sealedBallot
          ? { ...ballot, resolution: { winnerPlayerId: hiddenOpponent } }
          : ballot,
      ),
    };

    const sealed = projectPublicView(state).ballots.find(
      (ballot) => ballot.id === sharedSpaceIds.sealedBallot,
    );
    expect(sealed?.castBy).toEqual({
      [hiddenOpponent]: sharedSpaceSentinels.sealedBallotCast,
    });
  });

  it("leaves an open ballot's casts visible in flight", () => {
    const state = createSharedSpaceGameState();
    const open = projectPublicView(state).ballots.find(
      (ballot) => ballot.id === sharedSpaceIds.openBallot,
    );

    expect(open?.castBy).toEqual({ [revealedOpponent]: "against" });
  });
});

describe("§7.2 hidden sabotage is invisible until resolution", () => {
  it("hides the entry from everyone but the saboteur while the project runs", () => {
    const state = createSharedSpaceGameState();

    for (const { viewerId, view } of everyView(state)) {
      if (viewerId === hiddenOpponent) continue;
      const typed = view as ReturnType<typeof projectPublicView>;
      const sabotage = typed.projects.flatMap((project) => project.sabotage);

      expect(sabotage.some((entry) => entry.hidden)).toBe(false);
      expect(sabotage.map((entry) => entry.amount)).not.toContain(
        hiddenSabotageAmount,
      );
      // The open entry is untouched — redaction is per row, not per project.
      expect(sabotage).toHaveLength(1);
    }
  });

  it("shows the saboteur their own hidden entry", () => {
    const state = createSharedSpaceGameState();
    const sabotage = projectPlayerView(state, hiddenOpponent).projects.flatMap(
      (project) => project.sabotage,
    );

    expect(sabotage).toHaveLength(2);
    expect(sabotage).toContainEqual(
      expect.objectContaining({
        playerId: hiddenOpponent,
        amount: hiddenSabotageAmount,
        hidden: true,
      }),
    );
  });

  it("opens the whole ledger once the project has resolved", () => {
    const base = createSharedSpaceGameState();
    for (const status of ["completed", "failed"] as const) {
      const state: GameState = {
        ...base,
        projects: base.projects.map((project) => ({ ...project, status })),
      };

      for (const { view } of everyView(state)) {
        const typed = view as ReturnType<typeof projectPublicView>;
        const sabotage = typed.projects.flatMap((project) => project.sabotage);
        expect(sabotage).toHaveLength(2);
        expect(sabotage.map((entry) => entry.amount)).toContain(
          hiddenSabotageAmount,
        );
      }
    }
  });

  it("keeps the public shape of a secretly-wrecked project unchanged", () => {
    const state = createSharedSpaceGameState();
    const project = projectOf(state);
    const projected = projectPublicView(state).projects[0];

    // Gross contributions are what the table sees; the damage is netted off
    // only at resolution, so nothing here hints at it.
    expect(projected?.contributedMoney).toBe(400);
    expect(projected?.contributedWork).toBe(3);
    expect(projected?.status).toBe(project.status);
  });
});

describe("§7.2 parties-only agreements", () => {
  it("omits the agreement from a non-party's payload", () => {
    const state = createSharedSpaceGameState();
    const view = projectPlayerView(state, owner);

    expect(view.agreements.map((agreement) => agreement.id)).toEqual([
      sharedSpaceIds.publicAgreement,
    ]);
    expectAbsent(view, [
      sharedSpaceIds.partiesOnlyAgreement,
      sharedSpaceSentinels.partiesOnlyPromise,
    ]);
    expectAbsent(projectPublicView(state), [
      sharedSpaceIds.partiesOnlyAgreement,
      sharedSpaceSentinels.partiesOnlyPromise,
    ]);
  });

  it("shows it to the proposer and to every named recipient", () => {
    const state = createSharedSpaceGameState();

    for (const viewerId of [hiddenOpponent, revealedOpponent]) {
      const view = projectPlayerView(state, viewerId);
      expect(view.agreements.map((agreement) => agreement.id).sort()).toEqual(
        [
          sharedSpaceIds.partiesOnlyAgreement,
          sharedSpaceIds.publicAgreement,
        ].sort(),
      );
      expect(serialized(view)).toContain(
        sharedSpaceSentinels.partiesOnlyPromise,
      );
    }
  });
});

describe("§7.2 an unrevealed role must not be derivable", () => {
  it("produces a byte-identical payload however the hidden role is assigned", () => {
    const base = createSharedSpaceGameState();
    const flipped: GameState = {
      ...base,
      players: {
        ...base.players,
        [hiddenOpponent]: {
          ...base.players[hiddenOpponent],
          role: {
            id: base.players[owner].role.id,
            kind: "role.worker",
            revealed: false,
          },
        },
      },
    };

    // Nothing outside `self` varies with an unrevealed role — not the role
    // block, not seat order, not a status, not a count. This is the property
    // the old `(order + 1) % 3 === 0` assignment scheme destroyed.
    expect(serialized(projectPublicView(flipped))).toBe(
      serialized(projectPublicView(base)),
    );
    for (const viewerId of [owner, revealedOpponent]) {
      expect(serialized(projectPlayerView(flipped, viewerId))).toBe(
        serialized(projectPlayerView(base, viewerId)),
      );
    }
  });

  it("emits no role id and no role kind for an unrevealed seat", () => {
    const state = createSharedSpaceGameState();
    const view = projectPublicView(state);

    expect(view.players[0]?.role).toEqual({ revealed: false });
    expect(view.players[1]?.role).toEqual({ revealed: false });
    expect(view.players[2]?.role).toEqual({
      revealed: true,
      kind: "role.management",
    });
    expectAbsent(view, [
      secretSentinels.ownerRoleId,
      secretSentinels.hiddenOpponentRoleId,
    ]);
  });

  it("gives a viewer their own role, and only their own", () => {
    const state = createSharedSpaceGameState();
    const view = projectPlayerView(state, hiddenOpponent);

    expect(view.self.role).toEqual({
      id: secretSentinels.hiddenOpponentRoleId,
      kind: "role.management",
      revealed: false,
    });
    expectAbsent(view, [secretSentinels.ownerRoleId]);
  });
});

describe("projection determinism", () => {
  it("survives a JSON round trip unchanged for every viewer", () => {
    const state = createSharedSpaceGameState();

    for (const { view } of everyView(state)) {
      expect(JSON.parse(serialized(view))).toEqual(view);
    }
  });

  it("does not depend on the insertion order of the player record", () => {
    const state = createSharedSpaceGameState();
    const reversed: GameState = {
      ...state,
      players: Object.fromEntries(
        [...state.playerOrder].reverse().map((playerId) => [
          playerId,
          state.players[playerId],
        ]),
      ),
    };

    // `playerOrder` is the only walk; rebuilding the record backwards must not
    // reorder a single row, or a repository JSON round trip could reshuffle the
    // table under a client.
    expect(serialized(projectPublicView(reversed))).toBe(
      serialized(projectPublicView(state)),
    );
    expect(serialized(projectPlayerView(reversed, owner))).toBe(
      serialized(projectPlayerView(state, owner)),
    );
  });

  it("copies rather than aliases canonical collections", () => {
    const state = createSharedSpaceGameState();
    const view = projectPublicView(state);

    expect(view.rules).not.toBe(state.rules);
    expect(view.eliminatedPlayerIds).not.toBe(state.eliminatedPlayerIds);
    expect(view.placements[0]?.data).not.toBe(state.placements[0]?.data);
  });

  it("refuses to project a view for a seat that does not exist", () => {
    expect(() =>
      projectPlayerView(createSharedSpaceGameState(), "player-ghost" as PlayerId),
    ).toThrow("Cannot project view for unknown player");
  });
});
