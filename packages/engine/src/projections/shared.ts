import type {
  CardState,
  GameState,
  JsonObject,
  JsonValue,
  MatchOutcome,
  PlayerState,
  PlayerStatusState,
  RankState,
  ResourceState,
  TokenState,
  TurnState,
} from "../model";
import type {
  ProjectedCard,
  PublicPlayerProjection,
  PublicStatusProjection,
} from "./types";

export function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    );
  }

  return value;
}

export function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject;
}

function projectRank(rank: RankState): RankState {
  return {
    id: rank.id,
    kind: rank.kind,
    index: rank.index,
  };
}

function projectResources(
  resources: Readonly<Record<string, ResourceState>>,
): Readonly<Record<string, ResourceState>> {
  return Object.fromEntries(
    Object.entries(resources).map(([key, resource]) => [
      key,
      {
        id: resource.id,
        kind: resource.kind,
        value: resource.value,
        minimum: resource.minimum,
        maximum: resource.maximum,
      },
    ]),
  );
}

function projectTokens(
  tokens: Readonly<Record<string, TokenState>>,
): Readonly<Record<string, TokenState>> {
  return Object.fromEntries(
    Object.entries(tokens).map(([key, token]) => [
      key,
      {
        id: token.id,
        kind: token.kind,
        count: token.count,
        maximum: token.maximum,
      },
    ]),
  );
}

export function projectStatus(status: PlayerStatusState): PublicStatusProjection {
  return {
    id: status.id,
    sourceId: status.sourceId,
    stacks: status.stacks,
    remainingTurns: status.remainingTurns,
    expiresAtRound: status.expiresAtRound,
    data: cloneJsonObject(status.data),
  };
}

export function projectPublicPlayer(player: PlayerState): PublicPlayerProjection {
  return {
    id: player.id,
    order: player.order,
    connected: player.connected,
    position: player.position,
    lapsCompleted: player.lapsCompleted,
    rank: projectRank(player.rank),
    role: player.role.revealed
      ? { revealed: true, kind: player.role.kind }
      : { revealed: false },
    resources: projectResources(player.resources),
    tokens: projectTokens(player.tokens),
    statuses: player.statuses
      .filter((status) => status.visibility === "public")
      .map(projectStatus),
    skipTurns: player.skipTurns,
    inAudit: player.inAudit,
  };
}

export function projectCard(card: CardState): ProjectedCard {
  return {
    id: card.id,
    definitionId: card.definitionId,
    deckId: card.deckId,
    data: cloneJsonObject(card.data),
  };
}

export function getCard(state: GameState, cardId: string): CardState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Projection references unknown card: ${cardId}`);
  }
  return card;
}

export function projectTurn(turn: TurnState): TurnState {
  return {
    number: turn.number,
    round: turn.round,
    activePlayerId: turn.activePlayerId,
    phase: turn.phase,
    startedAt: turn.startedAt,
    deadlineAt: turn.deadlineAt,
  };
}

export function projectOutcome(outcome: MatchOutcome | null): MatchOutcome | null {
  if (!outcome) {
    return null;
  }

  return {
    reason: outcome.reason,
    winnerPlayerIds: [...outcome.winnerPlayerIds],
    winningRole: outcome.winningRole,
    endedAt: outcome.endedAt,
    data: cloneJsonObject(outcome.data),
  };
}
