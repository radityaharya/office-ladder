import { deadlineDashContent } from "@office-ladder/content";
import {
  applyCommand,
  createStableId,
  type GameCommand,
  type PlayerId,
} from "@office-ladder/engine";
import { appendEventSummaries } from "@/rooms/room-snapshot";
import { eventSummaries } from "@/rooms/service/game-setup";
import { nextTurnTimer } from "@/rooms/turn-timer/turn-timer";
import type {
  ActiveStoredRoom,
  RoomRepository,
  RoomService,
  RoomServiceErrorCode,
  RoomServiceResult,
} from "@/rooms/service/types";
import { isBotMember, normalizeStoredRoom } from "./bot-seats";
import type { BotCommandBody } from "./bot-policy";

/**
 * How a bot's chosen command reaches the engine.
 *
 * ### Why this module exists at all
 *
 * `RoomService` exposes exactly two game verbs — `roll()` and
 * `respondToPrompt()` — because when it was written the game had exactly two.
 * It now has twenty-eight, and the bot driver has to be able to send
 * `promotion.attempt` or no shipped mode can be won: every preset sets
 * `agency.promotionIsChoice`, so the engine promotes nobody until somebody asks.
 *
 * Spec §11.1 answers this properly with one command endpoint and, behind it, one
 * service method. That belongs to the route/service owner and is not this
 * package's to write. Until it lands, this adapter is the bot driver's own
 * transport: it **routes the two verbs the service already owns back through the
 * service**, so the locked, guarded, well-tested path stays the path for them,
 * and applies the rest itself.
 *
 * ### Why applying the rest here is safe
 *
 * The precedent is `turn-timer/turn-timeout-driver.ts`'s `writeTimer`, which
 * writes through the repository for the same reason and documents it: the
 * repository's revision predicate — not the service's in-process lock — is what
 * actually prevents a lost update. A bot that loses that race gets
 * `STALE_REVISION`, which the driver already classifies as an expected stop and
 * retries on its next kick. Every other invariant is preserved by reusing the
 * service's own helpers rather than restating them: `eventSummaries` for the
 * redacted feed, `appendEventSummaries` for the retention cap, `nextTurnTimer`
 * for the turn clock.
 *
 * ### What it refuses
 *
 * The actor must be a **bot seat in this room**. That is the identity half of
 * §6.3 — the engine validates game legality, this validates that the id acting
 * is one this server owns — and it is checked before `applyCommand` sees
 * anything. A driver bug that named a human member is refused here rather than
 * quietly playing somebody's turn for them.
 */

export type BotCommandSubmission = {
  readonly roomId: string;
  readonly actorId: PlayerId;
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly command: BotCommandBody;
};

export type BotCommandSubmitter = (
  submission: BotCommandSubmission,
) => Promise<RoomServiceResult<ActiveStoredRoom>>;

export type BotCommandSubmitterDependencies = {
  readonly roomService: RoomService;
  readonly repository: RoomRepository;
  /** ISO-8601 instant, same source the room service uses for its own writes. */
  readonly now: () => string;
  /**
   * The configured turn budget, so a bot command that hands the turn back to a
   * human arms that human's clock in the same write. Passing `0` here when the
   * clock is on would silently disarm it on every bot turn.
   */
  readonly turnTimeoutMs: number;
};

function fail(code: RoomServiceErrorCode): RoomServiceResult<ActiveStoredRoom> {
  return { ok: false, error: { code } };
}

/**
 * The engine envelope for a decision.
 *
 * `decisionPointId` is branded separately from the rest, so the three decision
 * commands are widened here rather than in the policy — which keeps the policy
 * free of engine id constructors and therefore trivially testable.
 */
function toGameCommand(
  submission: BotCommandSubmission,
  gameId: GameCommand["gameId"],
): GameCommand {
  const envelope = {
    commandId: createStableId("CommandId", submission.commandId),
    gameId,
    actorId: submission.actorId,
    expectedRevision: submission.expectedRevision,
  } as const;
  const body = submission.command;

  switch (body.type) {
    case "prompt.respond":
      return {
        ...envelope,
        type: body.type,
        decisionPointId: createStableId("DecisionPointId", body.decisionPointId),
        payload: {
          optionId: createStableId("PromptOptionId", body.payload.optionId),
          value: body.payload.value,
        },
      };
    case "reaction.play":
      return {
        ...envelope,
        type: body.type,
        decisionPointId: createStableId("DecisionPointId", body.decisionPointId),
        payload: {
          cardId:
            body.payload.cardId === null
              ? null
              : createStableId("CardInstanceId", body.payload.cardId),
          abilityId:
            body.payload.abilityId === null
              ? null
              : createStableId("AbilityId", body.payload.abilityId),
          targetPlayerIds: body.payload.targetPlayerIds,
          choice: body.payload.choice,
        },
      };
    case "reaction.pass":
    case "management.block-promotion":
      return {
        ...envelope,
        type: body.type,
        decisionPointId: createStableId("DecisionPointId", body.decisionPointId),
        payload: {},
      };
    case "ballot.cast":
      return {
        ...envelope,
        type: body.type,
        payload: {
          ballotId: createStableId("BallotId", body.payload.ballotId),
          value: body.payload.value,
        },
      };
    case "agreement.respond":
      return {
        ...envelope,
        type: body.type,
        payload: {
          agreementId: createStableId("AgreementId", body.payload.agreementId),
          accept: body.payload.accept,
        },
      };
    case "loan.repay":
      return {
        ...envelope,
        type: body.type,
        payload: {
          loanId: createStableId("LoanId", body.payload.loanId),
          amount: body.payload.amount,
        },
      };
    case "turn.play-card":
      return {
        ...envelope,
        type: body.type,
        payload: {
          cardId: createStableId("CardInstanceId", body.payload.cardId),
          targetPlayerIds: body.payload.targetPlayerIds,
          choice: body.payload.choice,
        },
      };
    case "turn.spend-token":
      return {
        ...envelope,
        type: body.type,
        payload: {
          tokenId: createStableId("TokenId", body.payload.tokenId),
          quantity: body.payload.quantity,
          use: body.payload.use,
        },
      };
    case "turn.activate-character":
      return {
        ...envelope,
        type: body.type,
        payload: {
          abilityId: createStableId("AbilityId", body.payload.abilityId),
          targetPlayerIds: body.payload.targetPlayerIds,
          choice: body.payload.choice,
        },
      };
    case "tile.claim":
    case "tile.upgrade":
      return {
        ...envelope,
        type: body.type,
        payload: { tileId: createStableId("TileId", body.payload.tileId) },
      };
    case "placement.place":
      return {
        ...envelope,
        type: body.type,
        payload: {
          kind: body.payload.kind,
          tileId: createStableId("TileId", body.payload.tileId),
        },
      };
    case "project.start":
      return {
        ...envelope,
        type: body.type,
        payload: {
          definitionId: body.payload.definitionId,
          tileId: body.payload.tileId,
          openToJoin: body.payload.openToJoin,
        },
      };
    case "project.contribute":
      return {
        ...envelope,
        type: body.type,
        payload: {
          projectId: createStableId("ProjectId", body.payload.projectId),
          money: body.payload.money,
          work: body.payload.work,
        },
      };
    case "project.sabotage":
      return {
        ...envelope,
        type: body.type,
        payload: {
          projectId: createStableId("ProjectId", body.payload.projectId),
          amount: body.payload.amount,
          hidden: body.payload.hidden,
        },
      };
    // The rest carry payloads the engine takes verbatim. Spelled out one per
    // case rather than collapsed into a default: TypeScript widens `type` across
    // a shared branch, which turns the union back into "some command" and lets a
    // payload be paired with the wrong verb without a compile error.
    case "turn.roll":
      return { ...envelope, type: body.type, payload: body.payload };
    case "audit.pay-fine":
      return { ...envelope, type: body.type, payload: body.payload };
    case "promotion.attempt":
      return { ...envelope, type: body.type, payload: body.payload };
    case "promotion.decline":
      return { ...envelope, type: body.type, payload: body.payload };
    case "turn.adjust-roll":
      return { ...envelope, type: body.type, payload: body.payload };
    case "turn.action":
      return { ...envelope, type: body.type, payload: body.payload };
    case "loan.take":
      return { ...envelope, type: body.type, payload: body.payload };
    case "attack.target":
      return { ...envelope, type: body.type, payload: body.payload };
    default:
      // Exhaustive: a new BotCommandBody member is a compile error here, which is
      // the point — a decision the submitter cannot carry would otherwise become
      // a silent runtime stall on somebody's turn.
      body satisfies never;
      throw new Error("unsupported bot command");
  }
}

export function createBotCommandSubmitter(
  deps: BotCommandSubmitterDependencies,
): BotCommandSubmitter {
  return async function submit(submission) {
    const { command } = submission;

    // The two verbs the service owns keep going through the service: its
    // per-room lock, its actor-kind guard and its own tests are all still the
    // authority for them, and duplicating that here would be two answers to one
    // question.
    if (command.type === "turn.roll") {
      return deps.roomService.roll({
        roomId: submission.roomId,
        actorId: submission.actorId,
        actorKind: "bot",
        commandId: submission.commandId,
        expectedRevision: submission.expectedRevision,
      });
    }
    if (command.type === "prompt.respond") {
      return deps.roomService.respondToPrompt({
        roomId: submission.roomId,
        actorId: submission.actorId,
        actorKind: "bot",
        commandId: submission.commandId,
        expectedRevision: submission.expectedRevision,
        decisionPointId: command.decisionPointId,
        optionId: command.payload.optionId,
      });
    }

    const stored = await deps.repository.get(submission.roomId);
    if (stored === null) return fail("ROOM_NOT_FOUND");
    const room = normalizeStoredRoom(stored);
    if (!room.memberIds.includes(submission.actorId)) return fail("ACTOR_NOT_MEMBER");
    // Identity, checked before the engine sees anything (§6.3). The driver is the
    // only caller, but "the only caller today" is not an authorisation model.
    if (!isBotMember(room, submission.actorId)) return fail("ACTOR_NOT_BOT");
    if (room.game === null || room.status !== "active") return fail("GAME_NOT_ACTIVE");

    const applied = applyCommand(
      room.game,
      toGameCommand(submission, room.game.gameId),
      { logicalTimestamp: deps.now(), content: deadlineDashContent },
    );
    if (!applied.ok) return { ok: false, error: { code: applied.error.code } };

    const updated: ActiveStoredRoom = {
      ...room,
      status: "active",
      revision: room.revision + 1,
      game: applied.value.state,
      eventSummaries: appendEventSummaries(
        room.eventSummaries,
        eventSummaries(applied.value.events, submission.actorId),
      ),
      turnTimer: null,
    };
    const withTimer: ActiveStoredRoom = {
      ...updated,
      turnTimer: nextTurnTimer({
        room: { ...updated, turnTimer: room.turnTimer },
        nowIso: deps.now(),
        timeoutMs: deps.turnTimeoutMs,
      }),
    };

    const saved = await deps.repository.save(withTimer, room.revision);
    return saved.ok ? { ok: true, value: withTimer } : fail(saved.error.code);
  };
}
