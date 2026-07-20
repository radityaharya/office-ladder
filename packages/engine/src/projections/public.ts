import type { GameState } from "../model";
import {
  getCard,
  projectCard,
  projectOutcome,
  projectPublicPlayer,
  projectTurn,
} from "./shared";
import type { PublicGameProjection } from "./types";

export function projectPublicView(state: GameState): PublicGameProjection {
  return {
    status: state.status,
    revision: state.revision,
    turn: projectTurn(state.turn),
    boardSize: state.boardSize,
    players: state.playerOrder.map((playerId) => {
      const player = state.players[playerId];
      if (!player) {
        throw new Error(`Projection references unknown player: ${playerId}`);
      }
      return projectPublicPlayer(player);
    }),
    decks: Object.values(state.decks).map((deck) => ({
      id: deck.id,
      kind: deck.kind,
      drawCount: deck.drawPile.length,
      discardCount: deck.discardPile.length,
      visibleCards: deck.visibleCards.map((cardId) =>
        projectCard(getCard(state, cardId)),
      ),
    })),
    outcome: projectOutcome(state.outcome),
  };
}
