import {
  enumerateLegalActions,
  type GameState,
  type LegalAction,
  type PlayerId,
} from "@office-ladder/engine";
import { BOT_COMMAND_ID_PREFIX, type RoomStatus } from "@office-ladder/contracts";
import { createRoomDrainScheduler } from "@/rooms/drain-scheduler";
import type {
  ActiveStoredRoom,
  RoomRepository,
  RoomService,
  RoomServiceErrorCode,
  RoomServiceResult,
} from "@/rooms/service/types";
import { decideBotAction, type BotDecision } from "./bot-policy";
import { botSeatFor, normalizeStoredRoom } from "./bot-seats";

/**
 * Hard cap on commands applied per drain. Bots only ever act while the active
 * player is a bot, so the loop already terminates on any human turn or on the
 * match ending — this exists so a rules bug (e.g. a grantExtraRoll cycle that
 * never advances) degrades into a reported anomaly instead of a hot loop.
 */
const MAX_ACTIONS_PER_DRAIN = 40;

/**
 * Outcomes that mean "the world moved on without us". A drain is best-effort
 * and racy by design (an HTTP request, a poll and a WebSocket reconnect can
 * all kick it), so these are expected stops, not errors to retry.
 *
 * Narrower than the room service's own "a client could have caused this" set
 * (see rooms/service/rejection.ts) because it answers a different question:
 * which rejections are a *normal consequence of racing drains*.
 */
const QUIET_STOP_CODES: readonly RoomServiceErrorCode[] = [
  "STALE_REVISION",
  "INVALID_COMMAND",
  "NOT_ACTOR_TURN",
  "GAME_NOT_ACTIVE",
  "GAME_ALREADY_ENDED",
  "ROOM_NOT_FOUND",
  "ACTOR_NOT_MEMBER",
];

/**
 * Why a drain pass stopped.
 *
 * Every `return` out of the drain loop names itself here. That is the whole
 * point: before this, "a bot is wedged on turn and the match can never
 * continue" and "it is a human's turn now, correctly" were the same silent
 * `return`, so a permanently stuck game was indistinguishable from the normal
 * quiet stop that every bootstrap poll produces.
 */
export type BotDrainStop =
  /** Scheduled for a room that does not exist — nothing can drive it. */
  | { readonly kind: "room-not-found" }
  /** The lobby, or a closed room. Correct and common. */
  | { readonly kind: "room-not-active"; readonly roomStatus: RoomStatus }
  /** An "active" room with no canonical game: torn state, not a quiet stop. */
  | { readonly kind: "room-missing-game" }
  /** Somebody won, or the match is quarantined. Correct. */
  | { readonly kind: "match-not-active"; readonly gameStatus: GameState["status"] }
  | { readonly kind: "no-active-player" }
  /** The correct reason to stop: this seat is a human's. */
  | { readonly kind: "human-turn"; readonly playerId: PlayerId }
  /**
   * A bot holds the turn and has no legal action. Nobody else can move, so the
   * match is stuck forever — the loudest thing this driver can report.
   */
  | {
      readonly kind: "bot-cannot-decide";
      readonly playerId: PlayerId;
      readonly phase: GameState["turn"]["phase"];
      readonly gameRevision: number;
    }
  /** decideBotAction chose an action the enumerator did not offer: a defect. */
  | {
      readonly kind: "legal-action-missing";
      readonly playerId: PlayerId;
      readonly wanted: LegalAction["type"];
      readonly gameRevision: number;
    }
  | {
      readonly kind: "command-rejected";
      readonly playerId: PlayerId;
      readonly decision: BotDecision["kind"];
      readonly code: RoomServiceErrorCode;
      /** True for QUIET_STOP_CODES: a lost race rather than a defect. */
      readonly expected: boolean;
    }
  /** The cap tripped, so the loop was still finding work: a rules cycle. */
  | { readonly kind: "action-cap"; readonly cap: number };

/**
 * Everything the driver has to say. The `type` strings double as log event
 * names, so the driver and its logs share one vocabulary.
 */
export type BotDriverEvent =
  | { readonly type: "bot.drain.started"; readonly roomId: string }
  | {
      readonly type: "bot.command.applied";
      readonly roomId: string;
      readonly playerId: PlayerId;
      readonly decision: BotDecision["kind"];
      readonly commandId: string;
      readonly revision: number;
      readonly gameRevision: number;
    }
  | {
      readonly type: "bot.publish.failed";
      readonly roomId: string;
      readonly revision: number;
      readonly messageId: string;
      readonly error: unknown;
    }
  | {
      readonly type: "bot.drain.finished";
      readonly roomId: string;
      readonly actions: number;
      readonly stop: BotDrainStop;
    }
  | { readonly type: "bot.drain.crashed"; readonly roomId: string; readonly error: unknown };

/** True for stops that mean the driver, the policy or the rules are broken. */
export function isBotDrainDefect(stop: BotDrainStop): boolean {
  switch (stop.kind) {
    case "bot-cannot-decide":
    case "legal-action-missing":
    case "room-missing-game":
    case "action-cap":
      return true;
    case "command-rejected":
      return !stop.expected;
    case "room-not-found":
    case "room-not-active":
    case "match-not-active":
    case "no-active-player":
    case "human-turn":
      return false;
    default:
      stop satisfies never;
      return true;
  }
}

export type BotDriverDependencies = {
  readonly roomService: RoomService;
  readonly repository: RoomRepository;
  /**
   * Pause taken **before** each bot command, including the first of a chain, so
   * humans see turns land one at a time. See turn-delay.ts for how the number is
   * chosen; this is where the *placement* is argued.
   *
   * Before rather than after, reasoned from what the player sees:
   *
   * - The first pause is the one that matters most. Without it the first bot's
   *   command commits in the same instant as the human's own — two turns' worth of
   *   events reaching the client as one arrival, which is the burst this pacing
   *   exists to remove. So the first bot in a chain waits like every other.
   * - A pause *after* the last commit is dead air with nothing pending behind it,
   *   and worse, it is dead air the player is charged for: the turn is already
   *   theirs the moment that command commits. Ending the chain on a commit hands
   *   control back with no added latency.
   *
   * Taken outside the room service's per-room lock (`sleep` here, `withRoomLock`
   * inside the service), so a bot pause never blocks a human command, a bootstrap
   * read, or the turn-timeout driver's timer write. It does hold this driver's own
   * per-room drain slot, which is what bounds it — see MAXIMUM_BOT_TURN_DELAY_MS.
   */
  readonly delayMs: number;
  /**
   * Mirrors the route layer's publishProjectionUpdate(roomId, revision,
   * messageId) so each bot turn is pushed to clients individually.
   */
  readonly publish: (roomId: string, revision: number, messageId: string) => Promise<void>;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Required, not optional: a driver you can construct without a sink is a
   * driver that can wedge a match in production and tell nobody. See
   * bot-driver-log.ts for the production one.
   */
  readonly onEvent: (event: BotDriverEvent) => void;
};

export type BotDriver = {
  /** Applies every consecutive bot turn that is currently pending. */
  readonly drive: (roomId: string) => Promise<void>;
  /** Fire-and-forget drive(): never throws, never returns a rejected promise. */
  readonly schedule: (roomId: string) => void;
};

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function moneyOf(game: GameState, playerId: PlayerId): number {
  return game.players[playerId]?.resources["money"]?.value ?? 0;
}

/**
 * Deterministic per (game, revision, action kind): a duplicated drain that
 * somehow reached the same state twice re-derives the same command id, which
 * the engine rejects as already-applied. expectedRevision is still the real
 * guard — this only makes the duplicate fail loudly instead of double-applying.
 *
 * Being derivable from published state is exactly why the prefix comes from
 * contracts' reserved list rather than being spelled out here: a client that can
 * compute this id could otherwise send it first, and the engine's
 * already-applied check would then refuse the bot's real turn — silently
 * freezing a match nobody else can move. See isServerActorCommandId.
 */
function botCommandId(game: GameState, decision: BotDecision): string {
  return `${BOT_COMMAND_ID_PREFIX}${String(game.gameId)}:${game.revision}:${decision.kind}`;
}

function isQuietStop(code: RoomServiceErrorCode): boolean {
  return QUIET_STOP_CODES.includes(code);
}

type DrainPassOutcome = {
  readonly actions: number;
  readonly stop: BotDrainStop;
};

export function createBotDriver(deps: BotDriverDependencies): BotDriver {
  const sleep = deps.sleep ?? defaultSleep;

  /**
   * A sink that throws must not be able to abort a bot turn that is already
   * committed, and there is by definition nowhere left to report a broken
   * reporter to.
   */
  function report(event: BotDriverEvent): void {
    try {
      deps.onEvent(event);
    } catch {
      // Intentionally empty: see above.
    }
  }

  async function applyDecision(
    roomId: string,
    botPlayerId: PlayerId,
    action: LegalAction,
    decision: BotDecision,
    commandId: string,
  ): Promise<RoomServiceResult<ActiveStoredRoom>> {
    if (decision.kind === "respond") {
      return deps.roomService.respondToPrompt({
        roomId,
        actorId: botPlayerId,
        // Declared, not assumed: the service re-checks the id against
        // StoredRoom.bots and refuses if this driver ever names a human member.
        actorKind: "bot",
        commandId,
        expectedRevision: action.expectedRevision,
        decisionPointId: decision.decisionPointId,
        optionId: decision.optionId,
      });
    }
    return deps.roomService.roll({
      roomId,
      actorId: botPlayerId,
      actorKind: "bot",
      commandId,
      expectedRevision: action.expectedRevision,
    });
  }

  /**
   * One pass: applies consecutive bot commands until something stops it, and
   * names what that was. Reports each applied command as it lands, so a partial
   * pass is still fully accounted for.
   */
  async function drainPass(roomId: string): Promise<DrainPassOutcome> {
    let actions = 0;

    for (let iteration = 0; iteration < MAX_ACTIONS_PER_DRAIN; iteration += 1) {
      const stored = await deps.repository.get(roomId);
      if (stored === null) return { actions, stop: { kind: "room-not-found" } };
      const room = normalizeStoredRoom(stored);
      if (room.status !== "active") {
        return { actions, stop: { kind: "room-not-active", roomStatus: room.status } };
      }
      if (room.game === null) return { actions, stop: { kind: "room-missing-game" } };

      const game = room.game;
      // "ended" (someone won) and "quarantined" are both legitimate stops.
      if (game.status !== "active") {
        return { actions, stop: { kind: "match-not-active", gameStatus: game.status } };
      }

      const activePlayerId = game.turn.activePlayerId;
      if (activePlayerId === null) return { actions, stop: { kind: "no-active-player" } };
      const seat = botSeatFor(room, activePlayerId);
      if (seat === null) {
        return { actions, stop: { kind: "human-turn", playerId: activePlayerId } };
      }

      const legalActions = enumerateLegalActions(game, activePlayerId);
      const decision = decideBotAction({
        legalActions,
        difficulty: seat.difficulty,
        money: moneyOf(game, activePlayerId),
      });
      if (decision.kind === "none") {
        // A bot that is the active player but has nothing legal to do stalls
        // the whole match, so this is a defect worth surfacing, not a no-op.
        return {
          actions,
          stop: {
            kind: "bot-cannot-decide",
            playerId: activePlayerId,
            phase: game.turn.phase,
            gameRevision: game.revision,
          },
        };
      }

      const wanted = decision.kind === "respond" ? "prompt.respond" : "turn.roll";
      const action = legalActions.find((candidate) => candidate.type === wanted);
      if (action === undefined) {
        // Unreachable by construction: decideBotAction only ever names an action
        // it found in this same list. If it happens, the policy and the
        // enumerator disagree, which is a silent stall — so it is reported.
        return {
          actions,
          stop: {
            kind: "legal-action-missing",
            playerId: activePlayerId,
            wanted,
            gameRevision: game.revision,
          },
        };
      }

      const commandId = botCommandId(game, decision);
      // Delay before acting, so a human watching sees the bot "think" — and so the
      // *previous* turn (the human's own, or the last bot's) has finished playing
      // out on the client before this one's events arrive. The room service stamps
      // every event of one command with a single `occurredAt`, so this pause is the
      // only thing that separates one turn from the next in what clients receive.
      // See BotDriverDependencies.delayMs for why it is here and not after the
      // commit.
      await sleep(deps.delayMs);

      const result = await applyDecision(
        roomId,
        activePlayerId,
        action,
        decision,
        commandId,
      );
      if (!result.ok) {
        return {
          actions,
          stop: {
            kind: "command-rejected",
            playerId: activePlayerId,
            decision: decision.kind,
            code: result.error.code,
            expected: isQuietStop(result.error.code),
          },
        };
      }

      actions += 1;
      report({
        type: "bot.command.applied",
        roomId,
        playerId: activePlayerId,
        decision: decision.kind,
        commandId,
        revision: result.value.revision,
        gameRevision: result.value.game.revision,
      });

      try {
        await deps.publish(roomId, result.value.revision, commandId);
      } catch (error) {
        // A failed broadcast must not abandon the rest of the bot turns: the
        // command is already committed and clients still poll.
        report({
          type: "bot.publish.failed",
          roomId,
          revision: result.value.revision,
          messageId: commandId,
          error,
        });
      }
    }

    return { actions, stop: { kind: "action-cap", cap: MAX_ACTIONS_PER_DRAIN } };
  }

  async function runDrain(roomId: string): Promise<void> {
    report({ type: "bot.drain.started", roomId });
    const outcome = await drainPass(roomId);
    report({
      type: "bot.drain.finished",
      roomId,
      actions: outcome.actions,
      stop: outcome.stop,
    });
  }

  // Owns the room's drain slot until there is provably nothing left to do: every
  // pass re-reads the room, so a kick that arrived mid-pass is honored by the
  // next one instead of being answered from a snapshot that predates it. Shared
  // with the turn-timeout driver, which needs the identical guarantees.
  const scheduler = createRoomDrainScheduler({
    run: runDrain,
    onCrash: (roomId, error) => {
      report({ type: "bot.drain.crashed", roomId, error });
    },
  });

  return { drive: scheduler.drive, schedule: scheduler.schedule };
}
