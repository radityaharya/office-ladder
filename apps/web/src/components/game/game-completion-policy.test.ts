import { describe, expect, it } from "vitest";

import { shouldShowGameWinner } from "./game-completion-policy";

describe("game completion policy", () => {
  it("keeps the game surface while ended feedback is still pending", () => {
    // Given
    const completion = {
      status: "ended",
      projectionRevision: 8,
      feedbackCompleteRevision: null,
    } as const;

    // When
    const showWinner = shouldShowGameWinner(completion);

    // Then
    expect(showWinner).toBe(false);
  });

  it("shows the winner only after ended feedback becomes idle", () => {
    // Given
    const completion = {
      status: "ended",
      projectionRevision: 8,
      feedbackCompleteRevision: 8,
    } as const;

    // When
    const showWinner = shouldShowGameWinner(completion);

    // Then
    expect(showWinner).toBe(true);
  });

  it("never replaces an active game with the winner surface", () => {
    // Given
    const completion = {
      status: "active",
      projectionRevision: 8,
      feedbackCompleteRevision: 8,
    } as const;

    // When
    const showWinner = shouldShowGameWinner(completion);

    // Then
    expect(showWinner).toBe(false);
  });

  it("keeps a newer ended projection visible when only an older revision was idle", () => {
    // Given
    const completion = {
      status: "ended",
      projectionRevision: 9,
      feedbackCompleteRevision: 8,
    } as const;

    // When
    const showWinner = shouldShowGameWinner(completion);

    // Then
    expect(showWinner).toBe(false);
  });
});
