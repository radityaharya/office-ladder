import type { GameState, PlayerId, PromptResponse } from "../model";
import { projectPublicView } from "./public";
import { cloneJsonObject, cloneJsonValue, getCard, projectCard, projectStatus } from "./shared";
import type {
  PlayerGameProjection,
  PlayerPromptResponseProjection,
} from "./types";

function projectPromptResponse(
  response: PromptResponse,
): PlayerPromptResponseProjection {
  return {
    optionId: response.optionId,
    value: cloneJsonValue(response.value),
  };
}

export function projectPlayerView(
  state: GameState,
  playerId: PlayerId,
): PlayerGameProjection {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Cannot project view for unknown player: ${playerId}`);
  }

  const publicView = projectPublicView(state);

  return {
    status: publicView.status,
    revision: publicView.revision,
    turn: publicView.turn,
    boardSize: publicView.boardSize,
    players: publicView.players,
    decks: publicView.decks,
    outcome: publicView.outcome,
    self: {
      role: {
        id: player.role.id,
        kind: player.role.kind,
        revealed: player.role.revealed,
      },
      characterId: player.characterId,
      hand: player.hand.map((cardId) => projectCard(getCard(state, cardId))),
      privateStatuses: player.statuses
        .filter((status) => status.visibility === "private")
        .map(projectStatus),
      abilities: player.abilities.map((ability) => ({
        id: ability.id,
        usesRemaining: ability.usesRemaining,
        cooldownLapsRemaining: ability.cooldownLapsRemaining,
        data: cloneJsonObject(ability.data),
      })),
    },
    prompts: state.prompts
      .filter((prompt) => prompt.audience.includes(playerId))
      .map((prompt) => ({
        id: prompt.id,
        kind: prompt.kind,
        legalResponses: prompt.legalResponses.map((response) => ({
          id: response.id,
          value: cloneJsonValue(response.value),
        })),
        deadlineAt: prompt.deadlineAt,
        defaultResponse: projectPromptResponse(prompt.defaultResponse),
        response: prompt.responses[playerId]
          ? projectPromptResponse(prompt.responses[playerId])
          : null,
      })),
    reactions: state.reactionWindows
      .filter((reaction) => reaction.eligiblePlayerIds.includes(playerId))
      .map((reaction) => ({
        id: reaction.id,
        kind: reaction.kind,
        hasPriority: reaction.priorityPlayerId === playerId,
        hasPassed: reaction.passedPlayerIds.includes(playerId),
        hasPlayed: reaction.playedByPlayerIds.includes(playerId),
        deadlineAt: reaction.deadlineAt,
      })),
  };
}
