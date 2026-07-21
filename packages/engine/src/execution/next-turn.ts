import type { GameState, PlayerId, PlayerState } from "../model";

export type NextTurnResolution = {
  readonly nextPlayerId: PlayerId;
  readonly turnNumber: number;
  readonly round: number;
  readonly players: Readonly<Record<string, PlayerState>>;
};

/**
 * Advances turn order, honoring skipTurns: a player with a positive
 * skipTurns counter is passed over (their counter decrements by one) rather
 * than becoming active. Round/turn-number bookkeeping matches the original
 * no-skip behavior exactly when nobody is actually skipped.
 */
export function resolveNextTurn(
  state: GameState,
  fromOrderIndex: number,
  grantExtraRoll: boolean,
  actorId: PlayerId,
): NextTurnResolution {
  if (grantExtraRoll) {
    return {
      nextPlayerId: actorId,
      turnNumber: state.turn.number,
      round: state.turn.round,
      players: state.players,
    };
  }

  let players = state.players;
  let index = fromOrderIndex;

  for (let step = 0; step < state.playerOrder.length; step += 1) {
    index = (index + 1) % state.playerOrder.length;
    const candidateId = state.playerOrder[index];
    if (candidateId === undefined) break;
    const candidate = players[candidateId];
    if (candidate === undefined) break;

    if (candidate.skipTurns > 0) {
      players = {
        ...players,
        [candidateId]: { ...candidate, skipTurns: candidate.skipTurns - 1 },
      };
      continue;
    }

    return {
      nextPlayerId: candidateId,
      turnNumber: state.turn.number + 1,
      round: index === 0 ? state.turn.round + 1 : state.turn.round,
      players,
    };
  }

  // Every other player is currently skipped — fall back to the natural next
  // player rather than getting stuck with no legal turn.
  const fallbackIndex = (fromOrderIndex + 1) % state.playerOrder.length;
  const fallbackId = state.playerOrder[fallbackIndex] ?? actorId;
  return {
    nextPlayerId: fallbackId,
    turnNumber: state.turn.number + 1,
    round: fallbackIndex === 0 ? state.turn.round + 1 : state.turn.round,
    players: state.players,
  };
}
