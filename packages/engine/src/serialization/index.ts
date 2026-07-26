import { GAME_STATE_SCHEMA_VERSION } from "../model";
import type {
  CardZone,
  DeckKind,
  FrameKind,
  GameState,
  GameStatus,
  JsonObject,
  JsonValue,
  MatchEndReason,
  RankKind,
  ResourceKind,
  RoleKind,
  TokenKind,
  TurnPhase,
} from "../model";

const GAME_STATUSES: readonly GameStatus[] = [
  "setup",
  "active",
  "paused",
  "quarantined",
  "ended",
];

export const SUPPORTED_GAME_STATE_SCHEMA_VERSION = GAME_STATE_SCHEMA_VERSION;

const TURN_PHASES = [
  "not-started",
  "turn-start",
  "audit",
  "pre-roll",
  "roll",
  "post-roll",
  "movement",
  "tile-resolution",
  "prompt",
  "reaction",
  "promotion",
  "turn-end",
  "game-over",
] as const;
const RESOURCE_KINDS = [
  "resource.money",
  "resource.reputation",
  "resource.energy",
  "resource.work-counter",
] as const;
const TOKEN_KINDS = [
  "token.move",
  "token.momentum",
  "token.reputation",
  "token.money",
] as const;
const RANK_KINDS = [
  "rank.intern",
  "rank.staff",
  "rank.senior-staff",
  "rank.supervisor",
  "rank.assistant-manager",
  "rank.manager",
  "rank.senior-manager",
  "rank.general-manager",
  "rank.director",
] as const;
const ROLE_KINDS = ["role.worker", "role.management"] as const;
const DECK_KINDS = [
  "deck.work",
  "deck.meeting",
  "deck.event",
  "deck.networking",
  "deck.board-meeting",
  "deck.annual-event",
] as const;
const CARD_ZONES = [
  "draw-pile",
  "discard-pile",
  "hand",
  "visible",
  "resolving",
  "removed",
] as const;
const FRAME_KINDS = [
  "resolve-turn-start",
  "resolve-movement",
  "resolve-tile",
  "draw-card",
  "resolve-card",
  "apply-effect",
  "open-prompt",
  "open-reaction-window",
  "resolve-promotion",
  "check-win-conditions",
  "finish-turn",
  "custom",
] as const;
const VISIBILITIES = ["public", "private", "sealed", "server"] as const;
const PROMPT_VISIBILITIES = ["public", "private", "sealed"] as const;
const REACTION_KINDS = ["prevention", "end-turn", "promotion-block"] as const;
const MATCH_END_REASONS = [
  "director-reached",
  "clock-deck-exhausted",
  "marathon-scored",
  "terminated-no-contest",
  "quarters-elapsed",
  "objectives-complete",
  "last-standing",
] as const;

/**
 * Compile-time proof that each allow-list above covers its whole model union.
 *
 * These lists guard an UNTRUSTED persisted snapshot, so they cannot simply be
 * derived from the type at runtime — the point is to reject a string the model
 * does not name. But a hand-kept list silently drifts the other way too: a value
 * ADDED to the model and forgotten here makes the engine refuse to serialize its
 * own legal state.
 *
 * That is not hypothetical. `MatchEndReason` gained `quarters-elapsed`,
 * `objectives-complete` and `last-standing` when fixed-length and objective win
 * shapes landed, this list kept the original four, and every match ending for one
 * of the new reasons failed to persist — the same shape of failure as the
 * `stateSchemaVersion` bump that made `game.start` unstorable.
 *
 * `Missing<Union, Tuple>` resolves to `true` only when the tuple covers the union;
 * otherwise it resolves to the unlisted members, and the assignment below fails to
 * compile naming them. Note that `GAME_STATUSES` never drifted precisely because
 * it carries an explicit `readonly GameStatus[]` annotation — these assertions give
 * the bare `as const` lists the same protection in the direction an annotation
 * cannot catch.
 */
type Missing<Union extends string, Listed extends string> = [
  Exclude<Union, Listed>,
] extends [never]
  ? true
  : Exclude<Union, Listed>;

const _ALLOW_LISTS_COVER_EVERY_VARIANT: {
  readonly turnPhase: Missing<TurnPhase, (typeof TURN_PHASES)[number]>;
  readonly resourceKind: Missing<ResourceKind, (typeof RESOURCE_KINDS)[number]>;
  readonly tokenKind: Missing<TokenKind, (typeof TOKEN_KINDS)[number]>;
  readonly rankKind: Missing<RankKind, (typeof RANK_KINDS)[number]>;
  readonly roleKind: Missing<RoleKind, (typeof ROLE_KINDS)[number]>;
  readonly deckKind: Missing<DeckKind, (typeof DECK_KINDS)[number]>;
  readonly cardZone: Missing<CardZone, (typeof CARD_ZONES)[number]>;
  readonly frameKind: Missing<FrameKind, (typeof FRAME_KINDS)[number]>;
  readonly matchEndReason: Missing<MatchEndReason, (typeof MATCH_END_REASONS)[number]>;
} = {
  turnPhase: true,
  resourceKind: true,
  tokenKind: true,
  rankKind: true,
  roleKind: true,
  deckKind: true,
  cardZone: true,
  frameKind: true,
  matchEndReason: true,
};
void _ALLOW_LISTS_COVER_EVERY_VARIANT;

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }

  return typeof value;
}

function assertCompatible(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers; received ${value}`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new TypeError(
      `${path} is not JSON-compatible; received ${describeValue(value)}`,
    );
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${path} contains a cyclic reference`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`${path} contains a symbol-keyed property`);
      }

      const keys = Object.keys(value);
      if (keys.length !== value.length) {
        throw new TypeError(`${path} contains a non-index array property`);
      }

      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError(`${path}[${index}] is missing from a sparse array`);
        }
        assertCompatible(value[index], `${path}[${index}]`, ancestors);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      const constructorName = prototype?.constructor?.name;
      throw new TypeError(
        `${path} must be a plain object; received ${constructorName ?? "class instance"}`,
      );
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${path} contains a symbol-keyed property`);
    }

    for (const key of Object.keys(value)) {
      assertCompatible(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        ancestors,
      );
    }
  } finally {
    ancestors.delete(value);
  }
}

export function isJsonCompatible(value: unknown): value is JsonValue {
  try {
    assertJsonCompatible(value);
    return true;
  } catch {
    return false;
  }
}

export function assertJsonCompatible(
  value: unknown,
): asserts value is JsonValue {
  assertCompatible(value, "$", new Set<object>());
}

function stringifyCompatible(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stringifyCompatible).join(",")}]`;
  }

  const objectValue = value as JsonObject;
  return `{${Object.keys(objectValue)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stringifyCompatible(objectValue[key])}`,
    )
    .join(",")}}`;
}

export function stableStringify(value: unknown): string {
  assertJsonCompatible(value);
  return stringifyCompatible(value);
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
}

function assertNullableString(value: unknown, path: string): asserts value is string | null {
  if (value !== null) {
    assertString(value, path);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean`);
  }
}

function assertNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
}

function assertInteger(value: unknown, path: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${path} must be an integer greater than or equal to ${minimum}`);
  }
}

function assertNullableNumber(value: unknown, path: string): asserts value is number | null {
  if (value !== null) {
    assertNumber(value, path);
  }
}

function assertNullableInteger(value: unknown, path: string): asserts value is number | null {
  if (value !== null) {
    assertInteger(value, path);
  }
}

function assertOneOf(
  value: unknown,
  allowed: readonly string[],
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${path} has an invalid value: ${String(value)}`);
  }
}

function assertNullableOneOf(value: unknown, allowed: readonly string[], path: string): void {
  if (value !== null) {
    assertOneOf(value, allowed, path);
  }
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  assertArray(value, path);
  value.forEach((entry, index) => assertString(entry, `${path}[${index}]`));
}

function assertJsonObject(value: unknown, path: string): asserts value is JsonObject {
  assertRecord(value, path);
}

function assertVersions(value: unknown): void {
  assertRecord(value, "versions");
  if (value.stateSchemaVersion !== SUPPORTED_GAME_STATE_SCHEMA_VERSION) {
    throw new TypeError(
      `versions.stateSchemaVersion must be ${SUPPORTED_GAME_STATE_SCHEMA_VERSION}; received ${String(value.stateSchemaVersion)}`,
    );
  }
  assertInteger(value.replaySchemaVersion, "versions.replaySchemaVersion");
  assertString(value.engineVersion, "versions.engineVersion");
  assertString(value.rulesVersion, "versions.rulesVersion");
  assertString(value.rulesetId, "versions.rulesetId");
  assertString(value.contentReleaseId, "versions.contentReleaseId");
  assertString(value.contentHash, "versions.contentHash");
}

function assertPlayer(value: unknown, path: string): void {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertInteger(value.order, `${path}.order`);
  assertBoolean(value.connected, `${path}.connected`);
  assertInteger(value.position, `${path}.position`);
  assertInteger(value.lapsCompleted, `${path}.lapsCompleted`);

  assertRecord(value.rank, `${path}.rank`);
  assertString(value.rank.id, `${path}.rank.id`);
  assertNullableOneOf(value.rank.kind, RANK_KINDS, `${path}.rank.kind`);
  assertInteger(value.rank.index, `${path}.rank.index`);

  assertRecord(value.role, `${path}.role`);
  assertString(value.role.id, `${path}.role.id`);
  assertNullableOneOf(value.role.kind, ROLE_KINDS, `${path}.role.kind`);
  assertBoolean(value.role.revealed, `${path}.role.revealed`);
  assertString(value.characterId, `${path}.characterId`);

  assertRecord(value.resources, `${path}.resources`);
  for (const [key, resourceValue] of Object.entries(value.resources)) {
    const resourcePath = `${path}.resources.${key}`;
    assertRecord(resourceValue, resourcePath);
    assertString(resourceValue.id, `${resourcePath}.id`);
    assertNullableOneOf(resourceValue.kind, RESOURCE_KINDS, `${resourcePath}.kind`);
    assertNumber(resourceValue.value, `${resourcePath}.value`);
    assertNullableNumber(resourceValue.minimum, `${resourcePath}.minimum`);
    assertNullableNumber(resourceValue.maximum, `${resourcePath}.maximum`);
  }

  assertRecord(value.tokens, `${path}.tokens`);
  for (const [key, tokenValue] of Object.entries(value.tokens)) {
    const tokenPath = `${path}.tokens.${key}`;
    assertRecord(tokenValue, tokenPath);
    assertString(tokenValue.id, `${tokenPath}.id`);
    assertNullableOneOf(tokenValue.kind, TOKEN_KINDS, `${tokenPath}.kind`);
    assertInteger(tokenValue.count, `${tokenPath}.count`);
    assertInteger(tokenValue.maximum, `${tokenPath}.maximum`);
  }

  assertStringArray(value.hand, `${path}.hand`);
  assertArray(value.statuses, `${path}.statuses`);
  value.statuses.forEach((statusValue, index) => {
    const statusPath = `${path}.statuses[${index}]`;
    assertRecord(statusValue, statusPath);
    assertString(statusValue.id, `${statusPath}.id`);
    assertNullableString(statusValue.sourceId, `${statusPath}.sourceId`);
    assertInteger(statusValue.stacks, `${statusPath}.stacks`);
    assertNullableInteger(statusValue.remainingTurns, `${statusPath}.remainingTurns`);
    assertNullableInteger(statusValue.expiresAtRound, `${statusPath}.expiresAtRound`);
    assertOneOf(statusValue.visibility, ["public", "private"], `${statusPath}.visibility`);
    assertJsonObject(statusValue.data, `${statusPath}.data`);
  });

  assertArray(value.abilities, `${path}.abilities`);
  value.abilities.forEach((abilityValue, index) => {
    const abilityPath = `${path}.abilities[${index}]`;
    assertRecord(abilityValue, abilityPath);
    assertString(abilityValue.id, `${abilityPath}.id`);
    assertNullableInteger(abilityValue.usesRemaining, `${abilityPath}.usesRemaining`);
    assertInteger(abilityValue.cooldownLapsRemaining, `${abilityPath}.cooldownLapsRemaining`);
    assertJsonObject(abilityValue.data, `${abilityPath}.data`);
  });
  assertInteger(value.skipTurns, `${path}.skipTurns`);
  assertBoolean(value.inAudit, `${path}.inAudit`);
  assertInteger(
    value.negativeEffectsIgnoredThisLap,
    `${path}.negativeEffectsIgnoredThisLap`,
  );
}

function assertTurn(value: unknown): void {
  assertRecord(value, "turn");
  assertInteger(value.number, "turn.number");
  assertInteger(value.round, "turn.round");
  assertNullableString(value.activePlayerId, "turn.activePlayerId");
  assertOneOf(value.phase, TURN_PHASES, "turn.phase");
  assertNullableString(value.startedAt, "turn.startedAt");
  assertNullableString(value.deadlineAt, "turn.deadlineAt");
}

function assertDeck(value: unknown, path: string): void {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertNullableOneOf(value.kind, DECK_KINDS, `${path}.kind`);
  assertStringArray(value.drawPile, `${path}.drawPile`);
  assertStringArray(value.discardPile, `${path}.discardPile`);
  assertStringArray(value.visibleCards, `${path}.visibleCards`);
  assertBoolean(value.reshufflesWhenEmpty, `${path}.reshufflesWhenEmpty`);
  assertBoolean(value.managementShuffleEligible, `${path}.managementShuffleEligible`);
  assertInteger(value.shuffleCount, `${path}.shuffleCount`);
}

function assertCard(value: unknown, path: string): void {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertString(value.definitionId, `${path}.definitionId`);
  assertString(value.deckId, `${path}.deckId`);
  assertOneOf(value.zone, CARD_ZONES, `${path}.zone`);
  assertNullableString(value.ownerId, `${path}.ownerId`);
  assertBoolean(value.faceUp, `${path}.faceUp`);
  assertJsonObject(value.data, `${path}.data`);
}

function assertResolutionFrame(value: unknown, path: string): void {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertOneOf(value.kind, FRAME_KINDS, `${path}.kind`);
  assertNullableString(value.parentFrameId, `${path}.parentFrameId`);
  assertNullableString(value.sourceId, `${path}.sourceId`);
  assertNullableString(value.actingPlayerId, `${path}.actingPlayerId`);
  assertStringArray(value.affectedPlayerIds, `${path}.affectedPlayerIds`);
  assertArray(value.remainingOperations, `${path}.remainingOperations`);
  assertJsonObject(value.capturedValues, `${path}.capturedValues`);
  assertOneOf(value.visibility, VISIBILITIES, `${path}.visibility`);
}

function assertPrompt(value: unknown, path: string): void {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertString(value.frameId, `${path}.frameId`);
  assertString(value.kind, `${path}.kind`);
  assertStringArray(value.audience, `${path}.audience`);
  assertArray(value.legalResponses, `${path}.legalResponses`);
  value.legalResponses.forEach((optionValue, index) => {
    const optionPath = `${path}.legalResponses[${index}]`;
    assertRecord(optionValue, optionPath);
    assertString(optionValue.id, `${optionPath}.id`);
    if (!("value" in optionValue)) {
      throw new TypeError(`${optionPath}.value is required`);
    }
  });
  assertNullableString(value.deadlineAt, `${path}.deadlineAt`);
  assertRecord(value.defaultResponse, `${path}.defaultResponse`);
  assertString(value.defaultResponse.optionId, `${path}.defaultResponse.optionId`);
  if (!("value" in value.defaultResponse)) {
    throw new TypeError(`${path}.defaultResponse.value is required`);
  }
  assertOneOf(value.visibility, PROMPT_VISIBILITIES, `${path}.visibility`);
  assertRecord(value.responses, `${path}.responses`);
  for (const [key, responseValue] of Object.entries(value.responses)) {
    const responsePath = `${path}.responses.${key}`;
    assertRecord(responseValue, responsePath);
    assertString(responseValue.optionId, `${responsePath}.optionId`);
    if (!("value" in responseValue)) {
      throw new TypeError(`${responsePath}.value is required`);
    }
  }
}

function assertPendingEffect(value: unknown, path: string): void {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertString(value.frameId, `${path}.frameId`);
  assertNullableString(value.sourceId, `${path}.sourceId`);
  assertStringArray(value.affectedPlayerIds, `${path}.affectedPlayerIds`);
  assertJsonObject(value.effect, `${path}.effect`);
  assertBoolean(value.preventionEligible, `${path}.preventionEligible`);
  assertOneOf(value.visibility, VISIBILITIES, `${path}.visibility`);
}

function assertReactionWindow(value: unknown, path: string): void {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertString(value.frameId, `${path}.frameId`);
  assertOneOf(value.kind, REACTION_KINDS, `${path}.kind`);
  assertStringArray(value.eligiblePlayerIds, `${path}.eligiblePlayerIds`);
  assertNullableString(value.priorityPlayerId, `${path}.priorityPlayerId`);
  assertStringArray(value.passedPlayerIds, `${path}.passedPlayerIds`);
  assertStringArray(value.playedByPlayerIds, `${path}.playedByPlayerIds`);
  assertNullableString(value.deadlineAt, `${path}.deadlineAt`);
  assertNullableString(value.pendingEffectId, `${path}.pendingEffectId`);
}

function assertNullableEndStates(state: Record<string, unknown>): void {
  if (state.marathonEndgame !== null) {
    assertRecord(state.marathonEndgame, "marathonEndgame");
    assertInteger(state.marathonEndgame.startedAtRound, "marathonEndgame.startedAtRound");
    assertInteger(state.marathonEndgame.finalRound, "marathonEndgame.finalRound");
    assertString(state.marathonEndgame.triggerPlayerId, "marathonEndgame.triggerPlayerId");
  }
  if (state.outcome !== null) {
    assertRecord(state.outcome, "outcome");
    assertOneOf(state.outcome.reason, MATCH_END_REASONS, "outcome.reason");
    assertStringArray(state.outcome.winnerPlayerIds, "outcome.winnerPlayerIds");
    assertNullableOneOf(state.outcome.winningRole, ROLE_KINDS, "outcome.winningRole");
    assertString(state.outcome.endedAt, "outcome.endedAt");
    assertJsonObject(state.outcome.data, "outcome.data");
  }
  if (state.quarantine !== null) {
    assertRecord(state.quarantine, "quarantine");
    assertString(state.quarantine.errorCode, "quarantine.errorCode");
    assertString(state.quarantine.message, "quarantine.message");
    assertNullableString(state.quarantine.commandId, "quarantine.commandId");
    assertNullableString(state.quarantine.frameId, "quarantine.frameId");
    assertJsonObject(state.quarantine.diagnostics, "quarantine.diagnostics");
  }
}

function assertGameState(value: unknown): asserts value is GameState {
  assertRecord(value, "Serialized game state");
  assertString(value.gameId, "gameId");
  assertString(value.modeId, "modeId");
  assertVersions(value.versions);
  assertOneOf(value.status, GAME_STATUSES, "status");
  assertInteger(value.revision, "revision");
  assertInteger(value.eventSequence, "eventSequence");
  assertString(value.startAuthorizedPlayerId, "startAuthorizedPlayerId");
  assertStringArray(value.playerOrder, "playerOrder");
  assertRecord(value.players, "players");
  assertTurn(value.turn);
  assertInteger(value.boardSize, "boardSize", 1);
  assertStringArray(value.tileIds, "tileIds");
  assertRecord(value.decks, "decks");
  assertRecord(value.cards, "cards");
  const players = value.players;
  const cards = value.cards;

  for (const [playerId, playerValue] of Object.entries(players)) {
    assertPlayer(playerValue, `players.${playerId}`);
    const player = playerValue as Record<string, unknown>;
    if (player.id !== playerId) {
      throw new TypeError(`players.${playerId}.id must match its players key`);
    }
    if ((player.position as number) >= value.boardSize) {
      throw new TypeError(`players.${playerId}.position must be less than boardSize`);
    }
  }
  if (new Set(value.playerOrder).size !== value.playerOrder.length) {
    throw new TypeError("playerOrder must not contain duplicate player IDs");
  }
  if (value.playerOrder.length !== Object.keys(players).length) {
    throw new TypeError("playerOrder must contain every player exactly once");
  }
  if (!(value.startAuthorizedPlayerId in players)) {
    throw new TypeError("startAuthorizedPlayerId references a missing player");
  }
  value.playerOrder.forEach((playerId, index) => {
    const player = players[playerId] as Record<string, unknown> | undefined;
    if (player === undefined) {
      throw new TypeError(`playerOrder[${index}] references a missing player`);
    }
    if (player.order !== index) {
      throw new TypeError(`players.${playerId}.order must match playerOrder`);
    }
  });
  const turn = value.turn as Record<string, unknown>;
  if (turn.activePlayerId !== null && !(turn.activePlayerId as string in players)) {
    throw new TypeError("turn.activePlayerId references a missing player");
  }

  if (new Set(value.tileIds).size !== value.tileIds.length) {
    throw new TypeError("tileIds must not contain duplicates");
  }
  if (value.tileIds.length !== value.boardSize) {
    throw new TypeError("tileIds must contain exactly boardSize entries");
  }

  for (const [deckId, deckValue] of Object.entries(value.decks)) {
    assertDeck(deckValue, `decks.${deckId}`);
    if ((deckValue as Record<string, unknown>).id !== deckId) {
      throw new TypeError(`decks.${deckId}.id must match its decks key`);
    }
  }
  for (const [cardId, cardValue] of Object.entries(cards)) {
    assertCard(cardValue, `cards.${cardId}`);
    const card = cardValue as Record<string, unknown>;
    if (card.id !== cardId) {
      throw new TypeError(`cards.${cardId}.id must match its cards key`);
    }
    if (!(card.deckId as string in value.decks)) {
      throw new TypeError(`cards.${cardId}.deckId references a missing deck`);
    }
    if (card.ownerId !== null && !(card.ownerId as string in value.players)) {
      throw new TypeError(`cards.${cardId}.ownerId references a missing player`);
    }
  }

  const referencedCardIds = new Set<string>();
  const addCardReferences = (
    cardIds: readonly string[],
    path: string,
    expectedZone: string,
    expectedOwnerId: string | null,
  ): void => {
    cardIds.forEach((cardId, index) => {
      const card = cards[cardId] as Record<string, unknown> | undefined;
      if (card === undefined) {
        throw new TypeError(`${path}[${index}] references a missing card`);
      }
      if (card.zone !== expectedZone || card.ownerId !== expectedOwnerId) {
        throw new TypeError(`${path}[${index}] does not match the card zone or owner`);
      }
      if (referencedCardIds.has(cardId)) {
        throw new TypeError(`${path}[${index}] references a card more than once`);
      }
      referencedCardIds.add(cardId);
    });
  };

  for (const [deckId, deckValue] of Object.entries(value.decks)) {
    const deck = deckValue as Record<string, unknown>;
    addCardReferences(deck.drawPile as string[], `decks.${deckId}.drawPile`, "draw-pile", null);
    addCardReferences(deck.discardPile as string[], `decks.${deckId}.discardPile`, "discard-pile", null);
    addCardReferences(deck.visibleCards as string[], `decks.${deckId}.visibleCards`, "visible", null);
  }
  for (const [playerId, playerValue] of Object.entries(value.players)) {
    const player = playerValue as Record<string, unknown>;
    addCardReferences(player.hand as string[], `players.${playerId}.hand`, "hand", playerId);
  }
  for (const [cardId, cardValue] of Object.entries(cards)) {
    const card = cardValue as Record<string, unknown>;
    if (
      card.zone !== "resolving" &&
      card.zone !== "removed" &&
      !referencedCardIds.has(cardId)
    ) {
      throw new TypeError(`cards.${cardId} is not referenced by its declared zone`);
    }
  }

  assertArray(value.resolutionStack, "resolutionStack");
  value.resolutionStack.forEach((entry, index) =>
    assertResolutionFrame(entry, `resolutionStack[${index}]`),
  );
  assertArray(value.prompts, "prompts");
  value.prompts.forEach((entry, index) => assertPrompt(entry, `prompts[${index}]`));
  assertArray(value.pendingEffects, "pendingEffects");
  value.pendingEffects.forEach((entry, index) =>
    assertPendingEffect(entry, `pendingEffects[${index}]`),
  );
  assertArray(value.reactionWindows, "reactionWindows");
  value.reactionWindows.forEach((entry, index) =>
    assertReactionWindow(entry, `reactionWindows[${index}]`),
  );

  assertRecord(value.rng, "rng");
  assertRecord(value.rng.streams, "rng.streams");
  for (const [streamId, streamValue] of Object.entries(value.rng.streams)) {
    const streamPath = `rng.streams.${streamId}`;
    assertRecord(streamValue, streamPath);
    assertString(streamValue.algorithm, `${streamPath}.algorithm`);
    assertString(streamValue.version, `${streamPath}.version`);
    assertString(streamValue.state, `${streamPath}.state`);
    assertInteger(streamValue.cursor, `${streamPath}.cursor`);
  }

  assertNullableEndStates(value);
  assertNullableString(value.lastCommandId, "lastCommandId");
  assertNullableString(value.stateHash, "stateHash");
}

export function serializeGameState(state: GameState): string {
  assertJsonCompatible(state);
  assertGameState(state);
  return stringifyCompatible(state);
}

export function deserializeGameState(serialized: string): GameState {
  let value: unknown;

  try {
    value = JSON.parse(serialized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(`Invalid serialized game state JSON: ${message}`);
  }

  assertJsonCompatible(value);
  assertGameState(value);
  return value;
}
