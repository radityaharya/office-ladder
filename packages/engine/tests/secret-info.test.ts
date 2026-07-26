import { describe, expect, it } from "vitest";

import {
  deserializeGameState,
  projectPlayerView,
  projectPublicView,
  serializeGameState,
} from "../src";
import type { GameState, PlayerId } from "../src";
import {
  discloseHand,
  isHandVisibleTo,
  isRedactedState,
  isRoleVisibleTo,
  isSealedCardId,
  redactStateForViewer,
  SEALED_CARD_DEFINITION_ID,
  SEALED_OBJECTIVE_DEFINITION_ID,
  SEALED_RNG_STREAM_STATE,
  sealedBallotCastKey,
  sealedHandCardId,
} from "../src/execution/secret-info";
import {
  createCanonicalGameState,
  createSharedSpaceGameState,
  fixtureIds,
  hiddenSabotageAmount,
  secretSentinels,
  sharedSpaceIds,
  sharedSpaceSentinels,
} from "./fixtures";
import { withRules } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const { owner, hiddenOpponent, revealedOpponent } = fixtureIds;

/**
 * Every secret in the shared-space fixture, attributed to the player it belongs
 * to. A viewer's redacted state must contain their own column and none of
 * anybody else's; the table-wide entries must be absent from every viewer's.
 */
const secretsOf: Readonly<Record<string, readonly string[]>> = {
  [owner]: [
    secretSentinels.ownerRoleId,
    secretSentinels.ownerHandDefinition,
    secretSentinels.ownerPrivateStatus,
  ],
  [hiddenOpponent]: [
    secretSentinels.hiddenOpponentRoleId,
    secretSentinels.hiddenOpponentHandDefinition,
    secretSentinels.hiddenOpponentPrivateStatus,
    secretSentinels.hiddenOpponentPrompt,
    sharedSpaceSentinels.ownerOnlyPlacement,
    sharedSpaceSentinels.secretObjective,
    sharedSpaceSentinels.sealedBallotCast,
  ],
  [revealedOpponent]: [secretSentinels.revealedOpponentHandDefinition],
};

/** Secrets that belong to nobody at the table and must never be projected. */
const engineOnlySecrets: readonly string[] = [
  secretSentinels.rng,
  secretSentinels.internalStack,
  secretSentinels.pendingEffect,
  secretSentinels.drawFirstDefinition,
  secretSentinels.drawSecondDefinition,
  secretSentinels.discardDefinition,
];

function expectAbsent(value: unknown, sentinels: readonly string[]): void {
  const json = JSON.stringify(value);
  for (const sentinel of sentinels) {
    expect(json).not.toContain(sentinel);
  }
}

describe("hand disclosure", () => {
  it("gives the owner their cards and everybody else a count", () => {
    const state = createSharedSpaceGameState();

    expect(discloseHand(state, owner, owner)).toEqual({
      kind: "cards",
      count: 1,
      cardIds: [fixtureIds.ownerHandCard],
    });
    // No field a card id could ride along in — the count-only shape does not
    // have one, so a consumer cannot forget to branch.
    expect(discloseHand(state, owner, hiddenOpponent)).toEqual({
      kind: "count",
      count: 1,
    });
    expect(discloseHand(state, owner, null)).toEqual({ kind: "count", count: 1 });
  });

  it("is switched off from config: open hands disclose to everyone", () => {
    const state = withRules(createSharedSpaceGameState(), {
      hidden: { hiddenHands: false },
    });

    expect(isHandVisibleTo(state, owner, hiddenOpponent)).toBe(true);
    expect(discloseHand(state, owner, hiddenOpponent)).toEqual({
      kind: "cards",
      count: 1,
      cardIds: [fixtureIds.ownerHandCard],
    });
  });

  it("reports an empty count for a player who is not at the table", () => {
    const state = createSharedSpaceGameState();

    expect(discloseHand(state, brand<PlayerId>("player-stranger"), owner)).toEqual({
      kind: "count",
      count: 0,
    });
  });
});

describe("role visibility", () => {
  it("shows a role to its holder, to nobody else, and to everybody once revealed", () => {
    const state = createSharedSpaceGameState();

    expect(isRoleVisibleTo(state, hiddenOpponent, hiddenOpponent)).toBe(true);
    expect(isRoleVisibleTo(state, hiddenOpponent, owner)).toBe(false);
    expect(isRoleVisibleTo(state, hiddenOpponent, null)).toBe(false);
    expect(isRoleVisibleTo(state, revealedOpponent, owner)).toBe(true);
  });

  it("is switched off from config: a mode without hidden roles hides nothing", () => {
    // The base fixture plays under the Quick preset, which has
    // `hidden.rolesEnabled` false — and `assignHiddenRoles` gives such a table an
    // all-employee roster, so there is provably no secret to protect.
    const state = createCanonicalGameState();
    expect(state.rules.hidden.rolesEnabled).toBe(false);

    expect(isRoleVisibleTo(state, hiddenOpponent, owner)).toBe(true);
    expect(
      redactStateForViewer(state, owner).players[hiddenOpponent].role.kind,
    ).toBe("role.management");
  });
});

describe("redactStateForViewer", () => {
  it("keeps a viewer's own secrets and removes everybody else's", () => {
    const state = createSharedSpaceGameState();

    for (const viewerId of state.playerOrder) {
      const redacted = redactStateForViewer(state, viewerId);
      const json = JSON.stringify(redacted);

      for (const own of secretsOf[viewerId]) {
        expect(json).toContain(own);
      }
      for (const otherId of state.playerOrder) {
        if (otherId === viewerId) continue;
        expectAbsent(redacted, secretsOf[otherId]);
      }
      expectAbsent(redacted, engineOnlySecrets);
    }
  });

  it("gives a spectator nobody's secrets at all", () => {
    const state = createSharedSpaceGameState();
    const redacted = redactStateForViewer(state, null);

    for (const playerId of state.playerOrder) {
      expectAbsent(redacted, secretsOf[playerId]);
    }
    expectAbsent(redacted, engineOnlySecrets);
    expect(redacted.prompts).toEqual([]);
    expect(redacted.reactionWindows).toEqual([]);
  });

  it("treats an id it cannot seat as a spectator rather than widening disclosure", () => {
    const state = createSharedSpaceGameState();
    const stranger = redactStateForViewer(state, brand<PlayerId>("player-stranger"));

    expect(stranger).toEqual(redactStateForViewer(state, null));
  });

  it("replaces a hidden hand with the same number of sealed cards", () => {
    const state = createSharedSpaceGameState();
    const redacted = redactStateForViewer(state, owner);

    // The count is what the game is supposed to show, so it survives.
    expect(redacted.players[hiddenOpponent].hand).toEqual([
      sealedHandCardId(hiddenOpponent, 0),
    ]);
    expect(redacted.players[hiddenOpponent].hand).toHaveLength(
      state.players[hiddenOpponent].hand.length,
    );
    // The real instance id is gone too, not merely its record: an instance id
    // can be tracked across turns to follow one card through a hand.
    expect(redacted.cards[fixtureIds.hiddenOpponentHandCard]).toBeUndefined();
    expect(redacted.cards[sealedHandCardId(hiddenOpponent, 0)]).toEqual(
      expect.objectContaining({
        definitionId: SEALED_CARD_DEFINITION_ID,
        zone: "hand",
        ownerId: hiddenOpponent,
        data: {},
      }),
    );
    expect(isSealedCardId(sealedHandCardId(hiddenOpponent, 0))).toBe(true);

    // The viewer's own hand is untouched.
    expect(redacted.players[owner].hand).toEqual([fixtureIds.ownerHandCard]);
    expect(redacted.cards[fixtureIds.ownerHandCard]).toEqual(
      state.cards[fixtureIds.ownerHandCard],
    );
  });

  it("seals face-down cards while leaving visible ones alone", () => {
    const redacted = redactStateForViewer(createSharedSpaceGameState(), owner);

    expect(redacted.cards[fixtureIds.drawCardFirst].definitionId).toBe(
      SEALED_CARD_DEFINITION_ID,
    );
    expect(redacted.cards[fixtureIds.discardCard].definitionId).toBe(
      SEALED_CARD_DEFINITION_ID,
    );
    expect(redacted.cards[fixtureIds.visibleCard].definitionId).toBe(
      "definition-visible-public",
    );
  });

  it("hides an unrevealed role and keeps a revealed one", () => {
    const redacted = redactStateForViewer(createSharedSpaceGameState(), owner);

    expect(redacted.players[hiddenOpponent].role.kind).toBeNull();
    expect(redacted.players[hiddenOpponent].role.revealed).toBe(false);
    expect(redacted.players[owner].role.kind).toBe("role.worker");
    expect(redacted.players[revealedOpponent].role).toEqual({
      id: "role-revealed-public",
      kind: "role.management",
      revealed: true,
    });
  });

  it("removes the seed material the hidden-role draw is derived from", () => {
    // Not tidiness: `roles.ts` seeds the draw from `rng.streams`, so publishing
    // those strings would let any recipient re-derive every player's role.
    const redacted = redactStateForViewer(createSharedSpaceGameState(), owner);

    expect(redacted.rng.streams.dice.state).toBe(SEALED_RNG_STREAM_STATE);
    expect(redacted.rng.streams.dice.cursor).toBe(41);
    expect(isRedactedState(redacted)).toBe(true);
    expect(isRedactedState(createSharedSpaceGameState())).toBe(false);
  });

  it("omits owner-only placements, hidden sabotage, secret objectives and parties-only agreements", () => {
    const state = createSharedSpaceGameState();
    const asOwner = redactStateForViewer(state, owner);

    expect(asOwner.placements.map((placement) => placement.id)).toEqual([
      sharedSpaceIds.publicPlacement,
    ]);
    // Structural, not a substring search: `hiddenSabotageAmount` is 150 and the
    // project's payout is 1500, so a naive scan would match the wrong number.
    expect(asOwner.projects[0].sabotage).toEqual([
      { playerId: revealedOpponent, amount: 50, hidden: false, atRound: 2 },
    ]);
    expect(
      asOwner.projects.flatMap((project) => project.sabotage).map((entry) => entry.amount),
    ).not.toContain(hiddenSabotageAmount);
    expect(asOwner.agreements.map((agreement) => agreement.id)).toEqual([
      sharedSpaceIds.publicAgreement,
    ]);

    const secret = asOwner.objectives.find(
      (objective) => objective.id === sharedSpaceIds.secretObjective,
    );
    // Existence-only: whose it is and whether it completed, never what it asks.
    expect(secret).toEqual({
      id: sharedSpaceIds.secretObjective,
      definitionId: SEALED_OBJECTIVE_DEFINITION_ID,
      ownerId: hiddenOpponent,
      progress: 0,
      target: 0,
      completedAtRound: null,
      visibility: "secret",
      rewardPoints: 0,
      rewardMoney: 0,
    });

    // The owner of each of those sees their own.
    const asHidden = redactStateForViewer(state, hiddenOpponent);
    expect(asHidden.placements).toHaveLength(2);
    expect(asHidden.projects[0].sabotage).toHaveLength(2);
    expect(asHidden.agreements).toHaveLength(2);
    expect(
      asHidden.objectives.find(
        (objective) => objective.id === sharedSpaceIds.secretObjective,
      )?.progress,
    ).toBe(2);
  });

  it("anonymises a sealed ballot in flight without losing the count", () => {
    const state = createSharedSpaceGameState();

    const asOwner = redactStateForViewer(state, owner);
    const sealedForOwner = asOwner.ballots.find(
      (ballot) => ballot.id === sharedSpaceIds.sealedBallot,
    );
    // One cast is in, by somebody. Which somebody is the leak, and the *keys* of
    // castBy are player ids — so both key and value are replaced.
    expect(sealedForOwner?.castBy).toEqual({ [sealedBallotCastKey(0)]: null });
    // The audience is public; the *casts* are what has to be anonymous, so the
    // assertion is on the record rather than on the whole ballot.
    expect(Object.keys(sealedForOwner?.castBy ?? {})).not.toContain(hiddenOpponent);
    expectAbsent(sealedForOwner?.castBy, [sharedSpaceSentinels.sealedBallotCast]);

    // The voter still sees their own bid, or they could not see what they bid.
    const asVoter = redactStateForViewer(state, hiddenOpponent);
    const sealedForVoter = asVoter.ballots.find(
      (ballot) => ballot.id === sharedSpaceIds.sealedBallot,
    );
    expect(sealedForVoter?.castBy).toEqual({
      [hiddenOpponent]: sharedSpaceSentinels.sealedBallotCast,
    });

    // An open ballot is open.
    expect(
      asOwner.ballots.find((ballot) => ballot.id === sharedSpaceIds.openBallot)?.castBy,
    ).toEqual({ [revealedOpponent]: "against" });
  });

  it("drops engine-internal frames, effects, prompts and windows a viewer is not party to", () => {
    const state = createSharedSpaceGameState();
    const asOwner = redactStateForViewer(state, owner);

    // The fixture's frame and pending effect both name the owner among their
    // affected players — and are both `server` visibility, which is absolute.
    expect(asOwner.resolutionStack).toEqual([]);
    expect(asOwner.pendingEffects).toEqual([]);
    expect(asOwner.prompts.map((prompt) => prompt.id)).toEqual(["prompt-owner"]);
    expect(asOwner.reactionWindows).toHaveLength(1);

    const asHidden = redactStateForViewer(state, hiddenOpponent);
    expect(asHidden.prompts.map((prompt) => prompt.id)).toEqual([
      "prompt-hidden-opponent",
    ]);
    expect(asHidden.reactionWindows).toEqual([]);
  });

  it("does not mutate the state it redacts", () => {
    const state = createSharedSpaceGameState();
    const before = JSON.stringify(state);
    redactStateForViewer(state, owner);

    expect(JSON.stringify(state)).toBe(before);
  });

  it("is idempotent", () => {
    const state = createSharedSpaceGameState();
    const once = redactStateForViewer(state, owner);

    expect(redactStateForViewer(once, owner)).toEqual(once);
  });

  it("survives a JSON round trip unchanged", () => {
    const state = createSharedSpaceGameState();
    const redacted = redactStateForViewer(state, owner);

    expect(JSON.parse(JSON.stringify(redacted))).toEqual(redacted);
    expect(deserializeGameState(serializeGameState(redacted))).toEqual(redacted);
  });
});

describe("projections composed over a redacted state", () => {
  /**
   * The property the spec asks for in §7.2, stated the way it will actually be
   * used by the per-socket fan-out. Nothing here relies on the projection
   * remembering to filter: the secrets are not in its input.
   */
  it("cannot carry another player's hand, secret objective, hidden sabotage or owner-only placement", () => {
    const state = createSharedSpaceGameState();

    for (const viewerId of state.playerOrder) {
      const view = projectPlayerView(redactStateForViewer(state, viewerId), viewerId);

      for (const otherId of state.playerOrder) {
        if (otherId === viewerId) continue;
        expectAbsent(view, secretsOf[otherId]);
      }
      expectAbsent(view, engineOnlySecrets);
      // Hidden sabotage has no free-text field to hide a sentinel in, so it is
      // asserted structurally: no viewer but the saboteur sees a hidden entry.
      // `hiddenOpponent` is the saboteur in the fixture, and since the merge-back
      // landed in `projections/public.ts` they now see their own entry — which is
      // the *disclosure* direction, not the leak direction this test is for.
      const sabotage = view.projects.flatMap((project) => project.sabotage);
      if (viewerId === hiddenOpponent) {
        expect(sabotage.filter((entry) => entry.hidden)).toEqual([
          expect.objectContaining({
            playerId: hiddenOpponent,
            amount: hiddenSabotageAmount,
          }),
        ]);
        continue;
      }
      expect(sabotage.some((entry) => entry.hidden)).toBe(false);
      expect(sabotage.map((entry) => entry.amount)).not.toContain(hiddenSabotageAmount);
    }
  });

  it("still reports every hand as a count, and the viewer's own in full", () => {
    const state = createSharedSpaceGameState();
    const view = projectPlayerView(redactStateForViewer(state, owner), owner);

    expect(view.players.map((player) => player.handCount)).toEqual([1, 1, 1]);
    expect(view.self.hand).toEqual([
      expect.objectContaining({ definitionId: secretSentinels.ownerHandDefinition }),
    ]);
    expect(view.players[1].role).toEqual({ revealed: false });
    expect(view.players[2].role).toEqual({ revealed: true, kind: "role.management" });
  });

  it("keeps a sealed ballot's cast count intact through the projection", () => {
    const state = createSharedSpaceGameState();
    const view = projectPlayerView(redactStateForViewer(state, owner), owner);
    const sealed = view.ballots.find(
      (ballot) => ballot.id === sharedSpaceIds.sealedBallot,
    );

    expect(sealed?.castBy).toBeNull();
    expect(sealed?.castCount).toBe(1);
  });

  it("gives a spectator a public view with no roles or hands in it", () => {
    const state = createSharedSpaceGameState();
    const view = projectPublicView(redactStateForViewer(state, null));

    expect(view.players.map((player) => player.handCount)).toEqual([1, 1, 1]);
    expect(view.players[0].role).toEqual({ revealed: false });
    for (const playerId of state.playerOrder) {
      expectAbsent(view, secretsOf[playerId]);
    }
    expectAbsent(view, engineOnlySecrets);
  });

  it("leaves an open-information mode alone end to end", () => {
    // Quick has both `hidden.rolesEnabled` and `hidden.hiddenHands` off. The
    // redaction layer must not invent secrecy the ruleset did not ask for.
    const state: GameState = createCanonicalGameState();
    const redacted = redactStateForViewer(state, owner);

    expect(redacted.players[hiddenOpponent].role.kind).toBe("role.management");
    expect(redacted.players[hiddenOpponent].hand).toEqual([
      fixtureIds.hiddenOpponentHandCard,
    ]);
    expect(redacted.cards[fixtureIds.hiddenOpponentHandCard].definitionId).toBe(
      secretSentinels.hiddenOpponentHandDefinition,
    );
  });
});
