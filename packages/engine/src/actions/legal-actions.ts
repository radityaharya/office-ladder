import type { GameState, PlayerId, PromptOptionId } from "../model";

type LegalActionBase = {
  readonly gameId: GameState["gameId"];
  readonly actorId: PlayerId;
  readonly expectedRevision: number;
};

export type LegalAction =
  | (LegalActionBase & { readonly type: "game.start"; readonly payload: Record<string, never> })
  | (LegalActionBase & { readonly type: "turn.roll"; readonly payload: Record<string, never> })
  | (LegalActionBase & {
      readonly type: "prompt.respond";
      readonly decisionPointId: GameState["prompts"][number]["id"];
      readonly kind: string;
      readonly options: readonly PromptOptionId[];
    });

export function enumerateLegalActions(
  state: GameState,
  actorId: PlayerId,
): readonly LegalAction[] {
  if (state.players[actorId] === undefined) {
    return [];
  }

  const ownPrompt = state.prompts.find((prompt) => prompt.audience.includes(actorId));
  // A prompt outlives the match that opened it: an audit-release prompt stays
  // open while the turn moves on, so another player can reach Director while it
  // is still pending and leave the audited player both active and holding a
  // prompt in an ended game. applyCommand rejects every command at that point
  // (GAME_ALREADY_ENDED), so advertising the response here would offer an action
  // that can only ever fail.
  if (
    ownPrompt !== undefined &&
    state.status === "active" &&
    state.turn.activePlayerId === actorId
  ) {
    return [
      {
        gameId: state.gameId,
        actorId,
        expectedRevision: state.revision,
        type: "prompt.respond",
        decisionPointId: ownPrompt.id,
        kind: ownPrompt.kind,
        options: ownPrompt.legalResponses.map((option) => option.id),
      },
    ];
  }

  const hasBlockingWork =
    state.resolutionStack.length > 0 ||
    state.pendingEffects.length > 0 ||
    state.reactionWindows.length > 0 ||
    ownPrompt !== undefined;

  if (
    state.status === "setup" &&
    state.turn.phase === "not-started" &&
    state.startAuthorizedPlayerId === actorId &&
    !hasBlockingWork
  ) {
    return [
      {
        gameId: state.gameId,
        actorId,
        expectedRevision: state.revision,
        type: "game.start",
        payload: {},
      },
    ];
  }

  if (
    state.status === "active" &&
    state.turn.phase === "pre-roll" &&
    state.turn.activePlayerId === actorId &&
    !hasBlockingWork
  ) {
    return [
      {
        gameId: state.gameId,
        actorId,
        expectedRevision: state.revision,
        type: "turn.roll",
        payload: {},
      },
    ];
  }

  return [];
}
