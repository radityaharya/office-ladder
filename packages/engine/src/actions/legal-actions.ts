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
  if (ownPrompt !== undefined && state.turn.activePlayerId === actorId) {
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
