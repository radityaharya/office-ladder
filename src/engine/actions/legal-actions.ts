import type { GameState, PlayerId } from "../model";

type LegalActionBase = {
  readonly gameId: GameState["gameId"];
  readonly actorId: PlayerId;
  readonly expectedRevision: number;
  readonly payload: Record<string, never>;
};

export type LegalAction =
  | (LegalActionBase & { readonly type: "game.start" })
  | (LegalActionBase & { readonly type: "turn.roll" });

export function enumerateLegalActions(
  state: GameState,
  actorId: PlayerId,
): readonly LegalAction[] {
  if (state.players[actorId] === undefined) {
    return [];
  }

  const hasBlockingWork =
    state.resolutionStack.length > 0 ||
    state.prompts.length > 0 ||
    state.pendingEffects.length > 0 ||
    state.reactionWindows.length > 0;

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
