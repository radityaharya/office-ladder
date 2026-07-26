/**
 * Request DTOs and parsers for every gameplay command a *player* may submit
 * (spec §6.1, §6.2).
 *
 * The room had one mutating verb before this file existed. It now has
 * twenty-seven, every one of which arrives as JSON from a browser, so the shape
 * of this module matters as much as its contents:
 *
 * - Every body carries the optimistic-concurrency envelope (`commandId`,
 *   `expectedRevision`) and every decision command also carries
 *   `decisionPointId`, parsed by the same two helpers so no command can quietly
 *   skip the revision check or reuse a server actor's command-id namespace.
 * - Every key set is exact. An unknown field is refused rather than ignored, so a
 *   body cannot smuggle a field a later version of the server might start reading.
 * - Every numeric is bounded on both sides. Amounts, rounds, quantities and pip
 *   adjustments all have transport ceilings here; the *rules* ceiling (the
 *   `ModeRules` value, the player's actual balance) is the engine's to enforce.
 *   Both checks are load-bearing: contracts stops `Number.MAX_SAFE_INTEGER`
 *   arriving at all, the engine stops 10 money arriving from someone who has 5.
 *
 * **Authorisation is not here.** Parsing proves a body is well formed, never that
 * its author is entitled to the effect. `actorId` comes from the session, never
 * from the body — there is no field in any type below that names the actor — and
 * §6.3's entitlement checks belong to the engine transitions.
 */
import {
  PLACEMENT_KINDS,
  TRADE_ITEM_KINDS,
  TURN_ACTIONS,
  type PlacementKind,
  type TradeItem,
  type TurnAction,
  AGREEMENT_VISIBILITIES,
  type AgreementVisibility,
} from "./gameplay";
import { MODE_RULES_BOUNDS } from "./mode-rules";
import {
  parseCommandId,
  parseRespondToPromptRequest,
  parseRollRequest,
  parseStartGameRequest,
  type RespondToPromptRequest,
  type RollRequest,
  type StartGameRequest,
} from "./rooms";
import {
  ContractValidationError,
  parseBoundedJsonValue,
  parseIdList,
  parseNullableOpaqueId,
  parseOpaqueId,
  requireBoolean,
  requireBoundedInteger,
  requireBoundedText,
  requireEnum,
  requireExactKeys,
  requireObject,
  requireRevision,
  type JsonValue,
} from "./validate";

/**
 * Transport ceiling on any money figure in a request body.
 *
 * An order of magnitude above the most expensive thing in the content pack (a
 * marathon Director promotion costs 10,000), so it constrains nothing a real game
 * does, while keeping every arithmetic path in the engine far away from the edge
 * of safe-integer precision no matter how many of these a match accumulates.
 */
export const MAX_MONEY_AMOUNT = 1_000_000;
export const MAX_WORK_AMOUNT = 10_000;
export const MAX_ROUND_NUMBER = 10_000;
export const MAX_TOKEN_QUANTITY = 99;
export const MAX_IMMUNITY_ROUNDS = 20;
/** A six-seat table is the largest this game supports, so no list of players is longer. */
export const MAX_TARGET_PLAYER_IDS = 6;
/** Every other seat at a full table. */
export const MAX_AGREEMENT_RECIPIENTS = 5;
export const MAX_TRADE_ITEMS = 8;
/**
 * A promise is free-typed text that every player at the table will be shown and
 * that outlives the round it was made in, so it is capped and control-stripped
 * like a chat line — shorter, because it is a clause in a deal, not a message.
 */
export const PROMISE_TEXT_MAX_LENGTH = 200;
/**
 * Transport ceiling on `turn.adjust-roll`, taken from the same table the custom
 * mode validator uses so the two cannot disagree. A mode may allow less; nothing
 * may allow more.
 */
export const MAX_PIP_ADJUST = MODE_RULES_BOUNDS.maxPipAdjust.maximum;

const ENVELOPE_KEYS = ["commandId", "expectedRevision"] as const;

export type GameCommandRequestBase = {
  readonly commandId: string;
  readonly expectedRevision: number;
};

export type DecisionCommandRequestBase = GameCommandRequestBase & {
  readonly decisionPointId: string;
};

function commandBody(
  value: unknown,
  path: string,
  payloadKeys: readonly string[],
): Record<string, unknown> {
  const input = requireObject(value, path);
  requireExactKeys(input, [...ENVELOPE_KEYS, ...payloadKeys], path);
  return input;
}

function decisionBody(
  value: unknown,
  path: string,
  payloadKeys: readonly string[],
): Record<string, unknown> {
  return commandBody(value, path, ["decisionPointId", ...payloadKeys]);
}

function envelope(input: Record<string, unknown>): GameCommandRequestBase {
  return {
    commandId: parseCommandId(input["commandId"]),
    expectedRevision: requireRevision(input["expectedRevision"], "expectedRevision"),
  };
}

function decisionEnvelope(input: Record<string, unknown>): DecisionCommandRequestBase {
  return {
    ...envelope(input),
    decisionPointId: parseOpaqueId(input["decisionPointId"], "decisionPointId"),
  };
}

function parseMoney(value: unknown, path: string, minimum = 1): number {
  return requireBoundedInteger(value, path, minimum, MAX_MONEY_AMOUNT);
}

function parseRound(value: unknown, path: string): number {
  return requireBoundedInteger(value, path, 1, MAX_ROUND_NUMBER);
}

function parseTargetPlayerIds(value: unknown): readonly string[] {
  return parseIdList(value, "targetPlayerIds", {
    minimum: 0,
    maximum: MAX_TARGET_PLAYER_IDS,
  });
}

// ---------------------------------------------------------------------------
// §6.1 — declared in the engine's command union, never previously exposed
// ---------------------------------------------------------------------------

export type PlayCardRequest = GameCommandRequestBase & {
  readonly cardId: string;
  readonly targetPlayerIds: readonly string[];
  readonly choice: JsonValue;
};

export function parsePlayCardRequest(value: unknown): PlayCardRequest {
  const input = commandBody(value, "playCard", [
    "cardId",
    "targetPlayerIds",
    "choice",
  ]);

  return {
    ...envelope(input),
    cardId: parseOpaqueId(input["cardId"], "cardId"),
    targetPlayerIds: parseTargetPlayerIds(input["targetPlayerIds"]),
    choice: parseBoundedJsonValue(input["choice"], "choice"),
  };
}

export type ActivateCharacterRequest = GameCommandRequestBase & {
  readonly abilityId: string;
  readonly targetPlayerIds: readonly string[];
  readonly choice: JsonValue;
};

export function parseActivateCharacterRequest(
  value: unknown,
): ActivateCharacterRequest {
  const input = commandBody(value, "activateCharacter", [
    "abilityId",
    "targetPlayerIds",
    "choice",
  ]);

  return {
    ...envelope(input),
    abilityId: parseOpaqueId(input["abilityId"], "abilityId"),
    targetPlayerIds: parseTargetPlayerIds(input["targetPlayerIds"]),
    choice: parseBoundedJsonValue(input["choice"], "choice"),
  };
}

export type SpendTokenRequest = GameCommandRequestBase & {
  readonly tokenId: string;
  readonly quantity: number;
  readonly use: string;
};

export function parseSpendTokenRequest(value: unknown): SpendTokenRequest {
  const input = commandBody(value, "spendToken", ["tokenId", "quantity", "use"]);

  return {
    ...envelope(input),
    tokenId: parseOpaqueId(input["tokenId"], "tokenId"),
    quantity: requireBoundedInteger(input["quantity"], "quantity", 1, MAX_TOKEN_QUANTITY),
    use: parseOpaqueId(input["use"], "use"),
  };
}

export type PlayReactionRequest = DecisionCommandRequestBase & {
  readonly cardId: string | null;
  readonly abilityId: string | null;
  readonly targetPlayerIds: readonly string[];
  readonly choice: JsonValue;
};

export function parsePlayReactionRequest(value: unknown): PlayReactionRequest {
  const input = decisionBody(value, "playReaction", [
    "cardId",
    "abilityId",
    "targetPlayerIds",
    "choice",
  ]);

  const cardId = parseNullableOpaqueId(input["cardId"], "cardId");
  const abilityId = parseNullableOpaqueId(input["abilityId"], "abilityId");
  // A reaction is played *with* something. Neither is the empty command the
  // engine would have to invent a meaning for, and both at once is two reactions
  // in one revision — `reaction.pass` is how a player declines.
  if ((cardId === null) === (abilityId === null)) {
    throw new ContractValidationError(
      "playReaction",
      "must name exactly one of cardId or abilityId",
    );
  }

  return {
    ...decisionEnvelope(input),
    cardId,
    abilityId,
    targetPlayerIds: parseTargetPlayerIds(input["targetPlayerIds"]),
    choice: parseBoundedJsonValue(input["choice"], "choice"),
  };
}

export type PassReactionRequest = DecisionCommandRequestBase;

export function parsePassReactionRequest(value: unknown): PassReactionRequest {
  return decisionEnvelope(decisionBody(value, "passReaction", []));
}

export type PayAuditFineRequest = GameCommandRequestBase;

export function parsePayAuditFineRequest(value: unknown): PayAuditFineRequest {
  return envelope(commandBody(value, "payAuditFine", []));
}

export type AttemptPromotionRequest = GameCommandRequestBase;

export function parseAttemptPromotionRequest(value: unknown): AttemptPromotionRequest {
  return envelope(commandBody(value, "attemptPromotion", []));
}

export type ShuffleManagementDeckRequest = GameCommandRequestBase & {
  readonly deckId: string;
};

export function parseShuffleManagementDeckRequest(
  value: unknown,
): ShuffleManagementDeckRequest {
  const input = commandBody(value, "shuffleManagementDeck", ["deckId"]);

  return { ...envelope(input), deckId: parseOpaqueId(input["deckId"], "deckId") };
}

export type BlockPromotionRequest = DecisionCommandRequestBase;

export function parseBlockPromotionRequest(value: unknown): BlockPromotionRequest {
  return decisionEnvelope(decisionBody(value, "blockPromotion", []));
}

// ---------------------------------------------------------------------------
// §6.2 — new commands
// ---------------------------------------------------------------------------

export type AdjustRollRequest = GameCommandRequestBase & {
  readonly pips: number;
};

export function parseAdjustRollRequest(value: unknown): AdjustRollRequest {
  const input = commandBody(value, "adjustRoll", ["pips"]);
  const pips = requireBoundedInteger(
    input["pips"],
    "pips",
    -MAX_PIP_ADJUST,
    MAX_PIP_ADJUST,
  );
  // Zero would spend no energy and change no roll while still consuming a
  // revision and a free action — a no-op that costs the player their turn's
  // agency. Refused so the client cannot submit one by leaving a stepper at rest.
  if (pips === 0) {
    throw new ContractValidationError("pips", "must not be zero");
  }

  return { ...envelope(input), pips };
}

export type TurnActionRequest = GameCommandRequestBase & {
  readonly action: TurnAction;
  readonly targetPlayerIds: readonly string[];
  readonly choice: JsonValue;
};

export function parseTurnActionRequest(value: unknown): TurnActionRequest {
  const input = commandBody(value, "turnAction", [
    "action",
    "targetPlayerIds",
    "choice",
  ]);

  return {
    ...envelope(input),
    action: requireEnum(input["action"], TURN_ACTIONS, "action", "a supported action"),
    targetPlayerIds: parseTargetPlayerIds(input["targetPlayerIds"]),
    choice: parseBoundedJsonValue(input["choice"], "choice"),
  };
}

export type DeclinePromotionRequest = GameCommandRequestBase;

export function parseDeclinePromotionRequest(value: unknown): DeclinePromotionRequest {
  return envelope(commandBody(value, "declinePromotion", []));
}

export type ClaimTileRequest = GameCommandRequestBase & {
  readonly tileId: string;
};

export function parseClaimTileRequest(value: unknown): ClaimTileRequest {
  const input = commandBody(value, "claimTile", ["tileId"]);

  return { ...envelope(input), tileId: parseOpaqueId(input["tileId"], "tileId") };
}

export type UpgradeTileRequest = GameCommandRequestBase & {
  readonly tileId: string;
};

export function parseUpgradeTileRequest(value: unknown): UpgradeTileRequest {
  const input = commandBody(value, "upgradeTile", ["tileId"]);

  return { ...envelope(input), tileId: parseOpaqueId(input["tileId"], "tileId") };
}

export type PlacePlacementRequest = GameCommandRequestBase & {
  readonly kind: PlacementKind;
  readonly tileId: string;
};

export function parsePlacePlacementRequest(value: unknown): PlacePlacementRequest {
  const input = commandBody(value, "placePlacement", ["kind", "tileId"]);

  return {
    ...envelope(input),
    kind: requireEnum(input["kind"], PLACEMENT_KINDS, "kind", "a supported placement"),
    tileId: parseOpaqueId(input["tileId"], "tileId"),
  };
}

export type StartProjectRequest = GameCommandRequestBase & {
  readonly definitionId: string;
  readonly tileId: string | null;
  readonly openToJoin: boolean;
};

export function parseStartProjectRequest(value: unknown): StartProjectRequest {
  const input = commandBody(value, "startProject", [
    "definitionId",
    "tileId",
    "openToJoin",
  ]);

  return {
    ...envelope(input),
    definitionId: parseOpaqueId(input["definitionId"], "definitionId"),
    tileId: parseNullableOpaqueId(input["tileId"], "tileId"),
    openToJoin: requireBoolean(input["openToJoin"], "openToJoin"),
  };
}

export type ContributeToProjectRequest = GameCommandRequestBase & {
  readonly projectId: string;
  readonly money: number;
  readonly work: number;
};

export function parseContributeToProjectRequest(
  value: unknown,
): ContributeToProjectRequest {
  const input = commandBody(value, "contributeToProject", [
    "projectId",
    "money",
    "work",
  ]);

  const money = parseMoney(input["money"], "money", 0);
  const work = requireBoundedInteger(input["work"], "work", 0, MAX_WORK_AMOUNT);
  // Contributing nothing still records a contributor entitled to a pro-rata share
  // of the payout, which is a way to be paid for a project someone else funded.
  if (money === 0 && work === 0) {
    throw new ContractValidationError(
      "contributeToProject",
      "must contribute money or work",
    );
  }

  return {
    ...envelope(input),
    projectId: parseOpaqueId(input["projectId"], "projectId"),
    money,
    work,
  };
}

export type SabotageProjectRequest = GameCommandRequestBase & {
  readonly projectId: string;
  readonly amount: number;
  readonly hidden: boolean;
};

export function parseSabotageProjectRequest(value: unknown): SabotageProjectRequest {
  const input = commandBody(value, "sabotageProject", [
    "projectId",
    "amount",
    "hidden",
  ]);

  return {
    ...envelope(input),
    projectId: parseOpaqueId(input["projectId"], "projectId"),
    amount: requireBoundedInteger(input["amount"], "amount", 1, MAX_WORK_AMOUNT),
    hidden: requireBoolean(input["hidden"], "hidden"),
  };
}

function parseTradeItem(value: unknown, path: string): TradeItem {
  const input = requireObject(value, path);
  const kind = requireEnum(
    input["kind"],
    TRADE_ITEM_KINDS,
    `${path}.kind`,
    "a supported trade item",
  );

  switch (kind) {
    case "money":
      requireExactKeys(input, ["kind", "amount"], path);
      return { kind, amount: parseMoney(input["amount"], `${path}.amount`) };
    case "card":
      requireExactKeys(input, ["kind", "cardId"], path);
      return { kind, cardId: parseOpaqueId(input["cardId"], `${path}.cardId`) };
    case "token":
      requireExactKeys(input, ["kind", "tokenId", "quantity"], path);
      return {
        kind,
        tokenId: parseOpaqueId(input["tokenId"], `${path}.tokenId`),
        quantity: requireBoundedInteger(
          input["quantity"],
          `${path}.quantity`,
          1,
          MAX_TOKEN_QUANTITY,
        ),
      };
    case "tile":
      requireExactKeys(input, ["kind", "tileId"], path);
      return { kind, tileId: parseOpaqueId(input["tileId"], `${path}.tileId`) };
    case "immunity":
      requireExactKeys(input, ["kind", "rounds"], path);
      return {
        kind,
        rounds: requireBoundedInteger(
          input["rounds"],
          `${path}.rounds`,
          1,
          MAX_IMMUNITY_ROUNDS,
        ),
      };
    case "promise":
      requireExactKeys(input, ["kind", "text"], path);
      return {
        kind,
        text: requireBoundedText(input["text"], `${path}.text`, PROMISE_TEXT_MAX_LENGTH),
      };
  }
}

function parseTradeItems(value: unknown, path: string): readonly TradeItem[] {
  if (!Array.isArray(value)) {
    throw new ContractValidationError(path, "must be an array");
  }
  if (value.length > MAX_TRADE_ITEMS) {
    throw new ContractValidationError(
      path,
      `must contain at most ${String(MAX_TRADE_ITEMS)} items`,
    );
  }

  return value.map((entry, index) => parseTradeItem(entry, `${path}[${String(index)}]`));
}

export type OfferAgreementRequest = GameCommandRequestBase & {
  readonly recipientIds: readonly string[];
  readonly give: readonly TradeItem[];
  readonly receive: readonly TradeItem[];
  readonly expiresAtRound: number;
  readonly visibility: AgreementVisibility;
};

export function parseOfferAgreementRequest(value: unknown): OfferAgreementRequest {
  const input = commandBody(value, "offerAgreement", [
    "recipientIds",
    "give",
    "receive",
    "expiresAtRound",
    "visibility",
  ]);

  const give = parseTradeItems(input["give"], "give");
  const receive = parseTradeItems(input["receive"], "receive");
  // An offer with nothing on either side is not a deal, and an empty one that can
  // still be "accepted" is a way to manufacture agreement-log entries.
  if (give.length === 0 && receive.length === 0) {
    throw new ContractValidationError("offerAgreement", "must contain at least one item");
  }

  return {
    ...envelope(input),
    recipientIds: parseIdList(input["recipientIds"], "recipientIds", {
      minimum: 1,
      maximum: MAX_AGREEMENT_RECIPIENTS,
    }),
    give,
    receive,
    expiresAtRound: parseRound(input["expiresAtRound"], "expiresAtRound"),
    visibility: requireEnum(
      input["visibility"],
      AGREEMENT_VISIBILITIES,
      "visibility",
      "a supported agreement visibility",
    ),
  };
}

export type RespondToAgreementRequest = GameCommandRequestBase & {
  readonly agreementId: string;
  readonly accept: boolean;
};

export function parseRespondToAgreementRequest(
  value: unknown,
): RespondToAgreementRequest {
  const input = commandBody(value, "respondToAgreement", ["agreementId", "accept"]);

  return {
    ...envelope(input),
    agreementId: parseOpaqueId(input["agreementId"], "agreementId"),
    accept: requireBoolean(input["accept"], "accept"),
  };
}

export type TargetAttackRequest = GameCommandRequestBase & {
  readonly targetPlayerId: string;
  readonly vector: string;
  readonly cardId: string | null;
};

export function parseTargetAttackRequest(value: unknown): TargetAttackRequest {
  const input = commandBody(value, "targetAttack", [
    "targetPlayerId",
    "vector",
    "cardId",
  ]);

  return {
    ...envelope(input),
    targetPlayerId: parseOpaqueId(input["targetPlayerId"], "targetPlayerId"),
    // Left as an opaque id rather than an enumeration: the spec types `vector` as
    // a string and no vector vocabulary is authored yet, so enumerating one here
    // would be contracts inventing content. The engine refuses an unknown vector;
    // this only guarantees it is a slug and not a payload.
    vector: parseOpaqueId(input["vector"], "vector"),
    cardId: parseNullableOpaqueId(input["cardId"], "cardId"),
  };
}

export type CastBallotRequest = GameCommandRequestBase & {
  readonly ballotId: string;
  readonly value: JsonValue;
};

export function parseCastBallotRequest(value: unknown): CastBallotRequest {
  const input = commandBody(value, "castBallot", ["ballotId", "value"]);

  return {
    ...envelope(input),
    ballotId: parseOpaqueId(input["ballotId"], "ballotId"),
    // Votes and auction bids share this field, so its shape is the ballot's
    // business: a vote sends a player id, a bid sends a number. Bounded JSON
    // rather than `unknown` so neither can be a megabyte.
    value: parseBoundedJsonValue(input["value"], "value"),
  };
}

export type TakeLoanRequest = GameCommandRequestBase & {
  readonly principal: number;
};

export function parseTakeLoanRequest(value: unknown): TakeLoanRequest {
  const input = commandBody(value, "takeLoan", ["principal"]);

  return { ...envelope(input), principal: parseMoney(input["principal"], "principal") };
}

export type RepayLoanRequest = GameCommandRequestBase & {
  readonly loanId: string;
  readonly amount: number;
};

export function parseRepayLoanRequest(value: unknown): RepayLoanRequest {
  const input = commandBody(value, "repayLoan", ["loanId", "amount"]);

  return {
    ...envelope(input),
    loanId: parseOpaqueId(input["loanId"], "loanId"),
    amount: parseMoney(input["amount"], "amount"),
  };
}

// ---------------------------------------------------------------------------
// The player command surface, and what is deliberately outside it
// ---------------------------------------------------------------------------

/**
 * Every command type a player may submit. This list *is* the authorisation
 * boundary for command types: it is an allow-list, so a type is submittable only
 * by appearing here.
 */
export const PLAYER_COMMAND_TYPES = [
  "game.start",
  "turn.roll",
  "turn.play-card",
  "turn.activate-character",
  "turn.spend-token",
  "turn.adjust-roll",
  "turn.action",
  "prompt.respond",
  "reaction.play",
  "reaction.pass",
  "audit.pay-fine",
  "promotion.attempt",
  "promotion.decline",
  "management.shuffle-deck",
  "management.block-promotion",
  "tile.claim",
  "tile.upgrade",
  "placement.place",
  "project.start",
  "project.contribute",
  "project.sabotage",
  "agreement.offer",
  "agreement.respond",
  "attack.target",
  "ballot.cast",
  "loan.take",
  "loan.repay",
] as const;

export type PlayerCommandType = (typeof PLAYER_COMMAND_TYPES)[number];

/**
 * Commands only the server may inject.
 *
 * `window.expire` closes a reaction window, ballot or turn clock whose
 * `deadlineAt` has passed (§7.1); `quarter.advance` rolls the calendar forward;
 * `turn.timeout` commits a turn on an absent player's behalf. All three are the
 * server acting *as* the clock, and a player who could submit one could expire a
 * reaction window the instant it opened, close a sealed auction the moment they
 * had the high bid, or skip a rival's turn.
 *
 * **They are excluded by construction, not by a check.** This package exports no
 * request type and no parser for any of them, and the parser registry below is a
 * mapped type over {@link PlayerCommandType} — adding a `"window.expire"` entry to
 * it is a compile error, and there is nothing to add. This list exists so tests
 * can assert the two sets stay disjoint and so the refusal message can be
 * specific; the guarantee is the absence, not the list.
 */
export const SERVER_INJECTED_COMMAND_TYPES = [
  "window.expire",
  "quarter.advance",
  "turn.timeout",
] as const;

export type ServerInjectedCommandType = (typeof SERVER_INJECTED_COMMAND_TYPES)[number];

export type PlayerCommandRequestByType = {
  "game.start": StartGameRequest;
  "turn.roll": RollRequest;
  "turn.play-card": PlayCardRequest;
  "turn.activate-character": ActivateCharacterRequest;
  "turn.spend-token": SpendTokenRequest;
  "turn.adjust-roll": AdjustRollRequest;
  "turn.action": TurnActionRequest;
  "prompt.respond": RespondToPromptRequest;
  "reaction.play": PlayReactionRequest;
  "reaction.pass": PassReactionRequest;
  "audit.pay-fine": PayAuditFineRequest;
  "promotion.attempt": AttemptPromotionRequest;
  "promotion.decline": DeclinePromotionRequest;
  "management.shuffle-deck": ShuffleManagementDeckRequest;
  "management.block-promotion": BlockPromotionRequest;
  "tile.claim": ClaimTileRequest;
  "tile.upgrade": UpgradeTileRequest;
  "placement.place": PlacePlacementRequest;
  "project.start": StartProjectRequest;
  "project.contribute": ContributeToProjectRequest;
  "project.sabotage": SabotageProjectRequest;
  "agreement.offer": OfferAgreementRequest;
  "agreement.respond": RespondToAgreementRequest;
  "attack.target": TargetAttackRequest;
  "ballot.cast": CastBallotRequest;
  "loan.take": TakeLoanRequest;
  "loan.repay": RepayLoanRequest;
};

/**
 * One parser per player command, keyed by command type.
 *
 * The mapped-type annotation does two jobs no runtime check can: omitting a
 * player command is a compile error (so a new command cannot ship with a route
 * and no validation), and adding a key that is not a player command — a
 * server-injected one, most of all — is also a compile error.
 */
const PLAYER_COMMAND_PARSERS: {
  readonly [Type in PlayerCommandType]: (
    value: unknown,
  ) => PlayerCommandRequestByType[Type];
} = {
  "game.start": parseStartGameRequest,
  "turn.roll": parseRollRequest,
  "turn.play-card": parsePlayCardRequest,
  "turn.activate-character": parseActivateCharacterRequest,
  "turn.spend-token": parseSpendTokenRequest,
  "turn.adjust-roll": parseAdjustRollRequest,
  "turn.action": parseTurnActionRequest,
  "prompt.respond": parseRespondToPromptRequest,
  "reaction.play": parsePlayReactionRequest,
  "reaction.pass": parsePassReactionRequest,
  "audit.pay-fine": parsePayAuditFineRequest,
  "promotion.attempt": parseAttemptPromotionRequest,
  "promotion.decline": parseDeclinePromotionRequest,
  "management.shuffle-deck": parseShuffleManagementDeckRequest,
  "management.block-promotion": parseBlockPromotionRequest,
  "tile.claim": parseClaimTileRequest,
  "tile.upgrade": parseUpgradeTileRequest,
  "placement.place": parsePlacePlacementRequest,
  "project.start": parseStartProjectRequest,
  "project.contribute": parseContributeToProjectRequest,
  "project.sabotage": parseSabotageProjectRequest,
  "agreement.offer": parseOfferAgreementRequest,
  "agreement.respond": parseRespondToAgreementRequest,
  "attack.target": parseTargetAttackRequest,
  "ballot.cast": parseCastBallotRequest,
  "loan.take": parseTakeLoanRequest,
  "loan.repay": parseRepayLoanRequest,
};

export function isPlayerCommandType(value: string): value is PlayerCommandType {
  return (PLAYER_COMMAND_TYPES as readonly string[]).includes(value);
}

/**
 * Validates a command type that arrived in a request.
 *
 * Allow-list membership, so a server-injected type is refused by not being a
 * player command rather than by being on a deny-list — the same reason the avatar
 * validator allows schemes instead of blocking them. The extra message for a
 * server-injected type is for the developer reading the 400; it is not what makes
 * the refusal happen.
 */
export function parseCommandType(value: unknown): PlayerCommandType {
  if (typeof value === "string" && isPlayerCommandType(value)) {
    return value;
  }
  if (
    typeof value === "string" &&
    (SERVER_INJECTED_COMMAND_TYPES as readonly string[]).includes(value)
  ) {
    throw new ContractValidationError(
      "type",
      "is submitted by the server only and cannot be sent by a player",
    );
  }

  throw new ContractValidationError("type", "must be a supported player command");
}

/**
 * Dispatches to the parser for a player command type.
 *
 * Useful where a caller already holds a validated type — a generic command route,
 * a bot driver replaying its own choice — and does not want a switch that can fall
 * out of step with this file. Per-command routes should keep calling the
 * individual parser: the error path stays specific and the type is a literal.
 */
export function parsePlayerCommandRequest<Type extends PlayerCommandType>(
  type: Type,
  value: unknown,
): PlayerCommandRequestByType[Type] {
  return PLAYER_COMMAND_PARSERS[type](value);
}
