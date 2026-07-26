import type { TradeItem as ContractTradeItem } from "@office-ladder/contracts";
import {
  createStableId,
  type CommandId,
  type GameCommand,
  type GameId,
  type PlayerId,
  type TradeItem,
} from "@office-ladder/engine";
import type { PlayerCommandSelection, SubmitServerCommandInput } from "./types";

/**
 * Translation from a validated transport request into an engine command.
 *
 * This is the per-command half of the room service, and the only part of it that
 * is per-command at all: everything around it — the actor-kind guard, the
 * membership check, the revision predicate, the event summaries, the turn clock,
 * the conditional write — is identical for all twenty-six and lives in exactly
 * one place (see `create-room-service.ts`). What differs is only how a request
 * body becomes a payload, and that is what this file is.
 *
 * Three properties are load-bearing and none of them is a convention:
 *
 * - **The switch is exhaustive by construction.** `PlayerCommandSelection` is a
 *   mapped type over the contracts command list, so a command added there with
 *   no case here is a compile error at `selection satisfies never`, not a
 *   runtime `undefined`.
 * - **No actor is read from the request.** Every envelope field that names a
 *   person — `actorId` — comes from the caller's session by way of
 *   {@link CommandEnvelope}. There is no field in any contracts request DTO that
 *   could supply one, and this file adds none.
 * - **Ids are branded here, not trusted from the wire.** `createStableId` is the
 *   only way a string becomes a `TileId`/`ProjectId`/`BallotId`, so a payload id
 *   is an opaque string until the engine looks it up and refuses what it cannot
 *   find. Branding is not validation and is not treated as any.
 */

export type CommandEnvelope = {
  readonly commandId: CommandId;
  readonly gameId: GameId;
  /** Resolved from the authenticated session, never from the request body. */
  readonly actorId: PlayerId;
};

function playerIds(ids: readonly string[]): readonly PlayerId[] {
  return ids.map((id) => createStableId("PlayerId", id));
}

/**
 * A trade clause, re-branded.
 *
 * `promise` deliberately carries its text through untouched: it is unenforceable
 * by design (spec §5.5) and the engine transfers nothing for it. Contracts has
 * already capped and control-stripped the string.
 */
function tradeItem(item: ContractTradeItem): TradeItem {
  switch (item.kind) {
    case "money":
      return { kind: "money", amount: item.amount };
    case "card":
      return { kind: "card", cardId: createStableId("CardInstanceId", item.cardId) };
    case "token":
      return {
        kind: "token",
        tokenId: createStableId("TokenId", item.tokenId),
        quantity: item.quantity,
      };
    case "tile":
      return { kind: "tile", tileId: createStableId("TileId", item.tileId) };
    case "immunity":
      return { kind: "immunity", rounds: item.rounds };
    case "promise":
      return { kind: "promise", text: item.text };
  }
}

export function toGameCommand(
  selection: PlayerCommandSelection,
  envelope: CommandEnvelope,
): GameCommand {
  const { commandId, gameId, actorId } = envelope;
  const base = { commandId, gameId, actorId };

  switch (selection.type) {
    case "turn.roll":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "turn.roll",
        payload: {},
      };
    case "turn.play-card":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "turn.play-card",
        payload: {
          cardId: createStableId("CardInstanceId", selection.request.cardId),
          targetPlayerIds: playerIds(selection.request.targetPlayerIds),
          choice: selection.request.choice,
        },
      };
    case "turn.activate-character":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "turn.activate-character",
        payload: {
          abilityId: createStableId("AbilityId", selection.request.abilityId),
          targetPlayerIds: playerIds(selection.request.targetPlayerIds),
          choice: selection.request.choice,
        },
      };
    case "turn.spend-token":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "turn.spend-token",
        payload: {
          tokenId: createStableId("TokenId", selection.request.tokenId),
          quantity: selection.request.quantity,
          use: selection.request.use,
        },
      };
    case "turn.adjust-roll":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "turn.adjust-roll",
        payload: { pips: selection.request.pips },
      };
    case "turn.action":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "turn.action",
        payload: {
          action: selection.request.action,
          targetPlayerIds: playerIds(selection.request.targetPlayerIds),
          choice: selection.request.choice,
        },
      };
    case "prompt.respond":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        decisionPointId: createStableId(
          "DecisionPointId",
          selection.request.decisionPointId,
        ),
        type: "prompt.respond",
        payload: {
          optionId: createStableId("PromptOptionId", selection.request.optionId),
          // The engine models a free-form response value and nothing authored
          // uses one yet: every shipped prompt is a closed option list, so the
          // option id carries the whole answer. Sending the option id twice
          // would be inventing a second channel for the same decision.
          value: null,
        },
      };
    case "reaction.play":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        decisionPointId: createStableId(
          "DecisionPointId",
          selection.request.decisionPointId,
        ),
        type: "reaction.play",
        payload: {
          cardId:
            selection.request.cardId === null
              ? null
              : createStableId("CardInstanceId", selection.request.cardId),
          abilityId:
            selection.request.abilityId === null
              ? null
              : createStableId("AbilityId", selection.request.abilityId),
          targetPlayerIds: playerIds(selection.request.targetPlayerIds),
          choice: selection.request.choice,
        },
      };
    case "reaction.pass":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        decisionPointId: createStableId(
          "DecisionPointId",
          selection.request.decisionPointId,
        ),
        type: "reaction.pass",
        payload: {},
      };
    case "audit.pay-fine":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "audit.pay-fine",
        payload: {},
      };
    case "promotion.attempt":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "promotion.attempt",
        payload: {},
      };
    case "promotion.decline":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "promotion.decline",
        payload: {},
      };
    case "management.shuffle-deck":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "management.shuffle-deck",
        payload: { deckId: createStableId("DeckId", selection.request.deckId) },
      };
    case "management.block-promotion":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        decisionPointId: createStableId(
          "DecisionPointId",
          selection.request.decisionPointId,
        ),
        type: "management.block-promotion",
        payload: {},
      };
    case "tile.claim":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "tile.claim",
        payload: { tileId: createStableId("TileId", selection.request.tileId) },
      };
    case "tile.upgrade":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "tile.upgrade",
        payload: { tileId: createStableId("TileId", selection.request.tileId) },
      };
    case "placement.place":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "placement.place",
        payload: {
          kind: selection.request.kind,
          tileId: createStableId("TileId", selection.request.tileId),
        },
      };
    case "project.start":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "project.start",
        payload: {
          definitionId: selection.request.definitionId,
          tileId:
            selection.request.tileId === null
              ? null
              : createStableId("TileId", selection.request.tileId),
          openToJoin: selection.request.openToJoin,
        },
      };
    case "project.contribute":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "project.contribute",
        payload: {
          projectId: createStableId("ProjectId", selection.request.projectId),
          money: selection.request.money,
          work: selection.request.work,
        },
      };
    case "project.sabotage":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "project.sabotage",
        payload: {
          projectId: createStableId("ProjectId", selection.request.projectId),
          amount: selection.request.amount,
          hidden: selection.request.hidden,
        },
      };
    case "agreement.offer":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "agreement.offer",
        payload: {
          recipientIds: playerIds(selection.request.recipientIds),
          give: selection.request.give.map(tradeItem),
          receive: selection.request.receive.map(tradeItem),
          expiresAtRound: selection.request.expiresAtRound,
          visibility: selection.request.visibility,
        },
      };
    case "agreement.respond":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "agreement.respond",
        payload: {
          agreementId: createStableId("AgreementId", selection.request.agreementId),
          accept: selection.request.accept,
        },
      };
    case "attack.target":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "attack.target",
        payload: {
          targetPlayerId: createStableId("PlayerId", selection.request.targetPlayerId),
          vector: selection.request.vector,
          cardId:
            selection.request.cardId === null
              ? null
              : createStableId("CardInstanceId", selection.request.cardId),
        },
      };
    case "ballot.cast":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "ballot.cast",
        payload: {
          ballotId: createStableId("BallotId", selection.request.ballotId),
          value: selection.request.value,
        },
      };
    case "loan.take":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "loan.take",
        payload: { principal: selection.request.principal },
      };
    case "loan.repay":
      return {
        ...base,
        expectedRevision: selection.request.expectedRevision,
        type: "loan.repay",
        payload: {
          loanId: createStableId("LoanId", selection.request.loanId),
          amount: selection.request.amount,
        },
      };
    default:
      // A command declared in contracts with no case above never reaches
      // production: this line stops compiling first.
      selection satisfies never;
      throw new TypeError("Unsupported player command");
  }
}

/**
 * The scheduler's own commands (spec §7.1).
 *
 * `actorId` is a *synthetic per-room id*, not a seat and not a caller-supplied
 * value. The engine's authorisation rule for these three is inverted — a command
 * whose actor is seated at the table is the rejection — so deriving the actor
 * here rather than accepting one is what makes "a player submitted an expiry"
 * unrepresentable rather than merely refused.
 *
 * Derived from the room id so it is stable across restarts and readable in a
 * log, and prefixed so it can never collide with a Better Auth user id (which is
 * what every real seat's id is created from).
 */
export function serverActorId(roomId: string): PlayerId {
  return createStableId("PlayerId", `server:scheduler:${roomId}`);
}

export function toServerCommand(
  input: SubmitServerCommandInput,
  envelope: Omit<CommandEnvelope, "actorId">,
): GameCommand | null {
  const base = {
    commandId: envelope.commandId,
    gameId: envelope.gameId,
    actorId: serverActorId(input.roomId),
    expectedRevision: input.expectedRevision,
  };

  switch (input.type) {
    case "window.expire": {
      // The only one of the three that names *what* expired, so a missing
      // decision point is a malformed call rather than a defaulted one: an
      // expiry with no target would either do nothing or, worse, pick.
      if (input.decisionPointId === undefined) return null;
      return {
        ...base,
        type: "window.expire",
        payload: {
          decisionPointId: createStableId("DecisionPointId", input.decisionPointId),
        },
      };
    }
    case "quarter.advance":
      return { ...base, type: "quarter.advance", payload: {} };
    case "turn.timeout":
      return {
        ...base,
        // The engine's TurnTimeoutCommand is a decision command, and the
        // decision point it answers is the turn itself. Nothing in the timeout
        // transition reads it, so it is derived from the room rather than
        // invented per call — two schedulers firing for the same room produce
        // the same value, which is what keeps a duplicate fire idempotent
        // together with the revision predicate.
        decisionPointId: createStableId("DecisionPointId", `${input.roomId}:turn-timeout`),
        type: "turn.timeout",
        payload: {},
      };
    default:
      input.type satisfies never;
      return null;
  }
}
