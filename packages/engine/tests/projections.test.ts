import { describe, expect, it } from "vitest";

import { projectPlayerView, projectPublicView } from "../src";
import {
  createCanonicalGameState,
  fixtureIds,
  secretSentinels,
} from "./fixtures";

const serialized = (value: unknown) => JSON.stringify(value);

const expectAbsent = (value: unknown, sentinels: readonly string[]) => {
  const json = serialized(value);
  for (const sentinel of sentinels) {
    expect(json).not.toContain(sentinel);
  }
};

describe("game projections", () => {
  it("projects a public allowlist without canonical secrets", () => {
    const view = projectPublicView(createCanonicalGameState());

    expect(view.players).toHaveLength(3);
    expect(view.decks).toEqual([
      expect.objectContaining({
        id: fixtureIds.deck,
        drawCount: 2,
        discardCount: 1,
        visibleCards: [
          expect.objectContaining({ definitionId: "definition-visible-public" }),
        ],
      }),
    ]);
    expect(view.players[0]?.role).toEqual({ revealed: false });
    expect(view.players[1]?.role).toEqual({ revealed: false });
    expect(view.players[2]?.role).toEqual({
      revealed: true,
      kind: "role.management",
    });
    expect(view.players[0]?.statuses).toEqual([
      expect.objectContaining({ id: "status-owner-public" }),
    ]);

    expectAbsent(view, [
      secretSentinels.ownerRoleId,
      secretSentinels.hiddenOpponentRoleId,
      secretSentinels.ownerCharacter,
      secretSentinels.hiddenOpponentCharacter,
      secretSentinels.revealedOpponentCharacter,
      secretSentinels.ownerHandDefinition,
      secretSentinels.hiddenOpponentHandDefinition,
      secretSentinels.revealedOpponentHandDefinition,
      secretSentinels.ownerPrivateStatus,
      secretSentinels.hiddenOpponentPrivateStatus,
      secretSentinels.rng,
      secretSentinels.internalStack,
      secretSentinels.pendingEffect,
      secretSentinels.drawFirstDefinition,
      secretSentinels.drawSecondDefinition,
      secretSentinels.discardDefinition,
      secretSentinels.hiddenOpponentPrompt,
      fixtureIds.drawCardFirst,
      fixtureIds.drawCardSecond,
      fixtureIds.discardCard,
    ]);
  });

  it("adds only the requesting player's private state", () => {
    const view = projectPlayerView(
      createCanonicalGameState(),
      fixtureIds.owner,
    );
    const json = serialized(view);

    expect(view.self.role).toEqual({
      id: secretSentinels.ownerRoleId,
      kind: "role.worker",
      revealed: false,
    });
    expect(view.self.characterId).toBe(secretSentinels.ownerCharacter);
    expect(view.self.hand).toEqual([
      expect.objectContaining({
        id: fixtureIds.ownerHandCard,
        definitionId: secretSentinels.ownerHandDefinition,
      }),
    ]);
    expect(view.self.privateStatuses).toEqual([
      expect.objectContaining({ id: secretSentinels.ownerPrivateStatus }),
    ]);
    expect(view.self.abilities).toEqual([
      expect.objectContaining({ id: "ability-owner-secret" }),
    ]);
    expect(view.prompts).toEqual([
      expect.objectContaining({ id: "prompt-owner", kind: "owner-choice" }),
    ]);
    expect(view.reactions).toEqual([
      expect.objectContaining({ id: "reaction-owner", hasPriority: true }),
    ]);
    expect(json).toContain(secretSentinels.ownerRoleId);
    expect(json).toContain(secretSentinels.ownerCharacter);
    expect(json).toContain(secretSentinels.ownerHandDefinition);
    expect(json).toContain(secretSentinels.ownerPrivateStatus);

    expectAbsent(view, [
      secretSentinels.hiddenOpponentRoleId,
      secretSentinels.hiddenOpponentCharacter,
      secretSentinels.revealedOpponentCharacter,
      secretSentinels.hiddenOpponentHandDefinition,
      secretSentinels.revealedOpponentHandDefinition,
      secretSentinels.hiddenOpponentPrivateStatus,
      secretSentinels.hiddenOpponentPrompt,
      secretSentinels.rng,
      secretSentinels.internalStack,
      secretSentinels.pendingEffect,
      secretSentinels.drawFirstDefinition,
      secretSentinels.drawSecondDefinition,
      secretSentinels.discardDefinition,
      fixtureIds.drawCardFirst,
      fixtureIds.drawCardSecond,
      fixtureIds.discardCard,
    ]);
  });

  it("rejects projection requests for unknown players", () => {
    expect(() =>
      projectPlayerView(
        createCanonicalGameState(),
        "player-does-not-exist" as typeof fixtureIds.owner,
      ),
    ).toThrow("Cannot project view for unknown player");
  });
});
