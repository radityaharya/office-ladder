import type { GameState, JsonValue, PlayerId, PromptResponse } from "../model";
import { projectGameView } from "./public";
import {
  cloneJsonObject,
  cloneJsonValue,
  getCard,
  projectCard,
  projectStatus,
} from "./shared";
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

/**
 * One viewer's whole view of the game.
 *
 * The shared-space collections are **viewer-scoped at the source**, not public
 * plus a merge pass: `projectGameView(state, playerId)` decides row by row what
 * this viewer is entitled to, so their `owner-only` placements, their `hidden`
 * sabotage, the `parties-only` agreements they are party to and their secret
 * objectives' detail come back in the same array the public rows do (spec §7.2,
 * and the contract on `PlayerGameProjection`). One array per concept means a UI
 * cannot render the public one and forget the private one.
 *
 * Everything genuinely private to this seat — hand contents, role, private
 * statuses, abilities, their own in-flight ballot casts, their prompts and the
 * reaction windows they are eligible for — is added below and nowhere else.
 */
export function projectPlayerView(
  state: GameState,
  playerId: PlayerId,
): PlayerGameProjection {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Cannot project view for unknown player: ${playerId}`);
  }

  return {
    ...projectGameView(state, playerId),
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
      // Only ever this viewer's own casts. A sealed ballot projects `castBy` as
      // null, so without this a player could not see the bid they just placed.
      ballotCasts: Object.fromEntries(
        state.ballots
          .filter((ballot) => playerId in ballot.castBy)
          .map((ballot) => [
            ballot.id,
            cloneJsonValue(ballot.castBy[playerId] as JsonValue),
          ]),
      ),
    },
    // Audience-filtered, and only ever this viewer's own response: a sealed
    // prompt with several people in its audience must not tell one of them how
    // another answered.
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
