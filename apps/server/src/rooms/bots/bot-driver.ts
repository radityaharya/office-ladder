import {
  enumerateLegalActions,
  type GameState,
  type PlayerId,
} from "@office-ladder/engine";
import { BOT_COMMAND_ID_PREFIX, type RoomStatus } from "@office-ladder/contracts";
import { createRoomDrainScheduler } from "@/rooms/drain-scheduler";
import type {
  RoomRepository,
  RoomServiceErrorCode,
  StoredRoom,
} from "@/rooms/service/types";
import { botThinkingLine, botDecisionLine, type BotChatLine } from "./bot-chat";
import type { BotCommandSubmitter } from "./bot-command-submitter";
import { decideBotAction, type BotActionSlug, type BotDecision } from "./bot-policy";
import { botSeatFor, botSeats, normalizeStoredRoom } from "./bot-seats";
import { readBotTable } from "./bot-view";
import { botThinkMs } from "./think-time";

/**
 * Hard cap on commands applied per drain.
 *
 * Raised from 40 with the command set: a bot turn used to be exactly one
 * `turn.roll`, and is now up to a handful of pre-roll decisions (a promotion, a
 * free action, a claim, a card) before the roll that ends it, times however many
 * bot seats are chained together. The cap is still what it always was — a
 * backstop so a rules bug degrades into a reported anomaly instead of a hot loop
 * — not a budget anything is expected to reach. Every policy rung is written to
 * consume the thing that offered it; see bot-policy.ts's "every rung terminates".
 */
const MAX_ACTIONS_PER_DRAIN = 120;

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
  /**
   * The correct reason to stop: this seat is a human's, and no bot at the table
   * is holding anything up. The second half is new — a bot can owe the table a
   * reaction, a vote or an answer to an offer while somebody else is on turn,
   * and those are driven before this stop is reported. See {@link drainPass}.
   */
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
  /** The bot's own view of the game could not be built: torn or missing state. */
  | { readonly kind: "bot-not-seated"; readonly playerId: PlayerId }
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
  /**
   * A bot has decided and is about to pause before committing.
   *
   * Emitted *before* the pause, and carrying the phrase the room should be shown
   * while it lasts. This is the difference between pacing and a freeze: a delay
   * nobody is told about looks exactly like a server that stopped answering.
   */
  | {
      readonly type: "bot.thinking";
      readonly roomId: string;
      readonly playerId: PlayerId;
      readonly decision: BotActionSlug;
      readonly why: string;
      readonly thinkMs: number;
      /** `null` in any chat mode but `quick` — see bot-chat.ts. */
      readonly line: BotChatLine | null;
    }
  | {
      readonly type: "bot.command.applied";
      readonly roomId: string;
      readonly playerId: PlayerId;
      readonly decision: BotDecision["kind"];
      readonly commandId: string;
      readonly revision: number;
      readonly gameRevision: number;
      /** The remark the bot makes about what it just did, if any. */
      readonly line: BotChatLine | null;
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
    case "bot-not-seated":
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
  readonly repository: RoomRepository;
  /**
   * How a decision reaches the engine. See bot-command-submitter.ts — it keeps
   * `turn.roll` and `prompt.respond` on the room service's own locked path and
   * applies the other twenty-six itself, because `RoomService` has no method for
   * them yet (spec §11.1's single command endpoint is another owner's).
   */
  readonly submit: BotCommandSubmitter;
  /**
   * The deployment-wide `BOT_TURN_DELAY_MS`, or `null` when it is unset — in
   * which case each room paces itself from its own `ModeRules.bots`. See
   * think-time.ts for the precedence and why `0` has to stay distinguishable
   * from "not configured".
   */
  readonly configuredDelayMs: number | null;
  /**
   * Mirrors the route layer's publishProjectionUpdate(roomId, revision,
   * messageId) so each bot turn is pushed to clients individually.
   */
  readonly publish: (roomId: string, revision: number, messageId: string) => Promise<void>;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Required, not optional: a driver you can construct without a sink is a
   * driver that can wedge a match in production and tell nobody. It also now
   * carries the thinking beat, so a missing sink would silently turn paced bots
   * back into frozen ones. See bot-driver-log.ts for the production one.
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
 *
 * Exported so the test that documents that wedge derives the id the same way the
 * driver does. Two spellings of this format would make that test pass against an
 * id no bot ever mints, which is worse than not having it.
 */
export function botCommandId(game: GameState, decision: BotDecision): string {
  return `${BOT_COMMAND_ID_PREFIX}${String(game.gameId)}:${game.revision}:${decision.kind}`;
}

function isQuietStop(code: RoomServiceErrorCode): boolean {
  return QUIET_STOP_CODES.includes(code);
}

/**
 * The seat this pass should act for.
 *
 * Out-of-turn work comes first, and it has to: reaction windows, ballots and
 * trade offers are answered by players who are *not* on turn, and while a window
 * is open the active player is blocked by it. A driver that only ever looked at
 * `turn.activePlayerId` therefore left every window raised on a bot unanswered
 * until the expiry scheduler fired — with a human sitting on a turn they could
 * not take. Blocking the whole table on a bot's silence is worse than a bot that
 * answers slightly out of order.
 *
 * Bot seats are considered in room order so the choice is stable across reads.
 */
function seatToDrive(room: StoredRoom, game: GameState): PlayerId | null {
  for (const seat of botSeats(room)) {
    if (game.players[seat.playerId] === undefined) continue;
    if (game.eliminatedPlayerIds.includes(seat.playerId)) continue;
    if (seat.playerId === game.turn.activePlayerId) continue;
    const owed = enumerateLegalActions(game, seat.playerId).some(
      (action) =>
        action.type === "reaction.play" ||
        action.type === "reaction.pass" ||
        action.type === "management.block-promotion" ||
        action.type === "ballot.cast" ||
        action.type === "agreement.respond",
    );
    if (owed) return seat.playerId;
  }

  const activePlayerId = game.turn.activePlayerId;
  if (activePlayerId === null) return null;

  return botSeatFor(room, activePlayerId) === null ? null : activePlayerId;
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
      const botPlayerId = seatToDrive(room, game);
      if (botPlayerId === null) {
        if (activePlayerId === null) return { actions, stop: { kind: "no-active-player" } };
        return { actions, stop: { kind: "human-turn", playerId: activePlayerId } };
      }

      const table = readBotTable(game, botPlayerId);
      if (table === null) {
        // A seat listed as a bot that the game does not know about. Nothing can
        // act for it and nothing else can take its turn, so it is a defect.
        return { actions, stop: { kind: "bot-not-seated", playerId: botPlayerId } };
      }

      const seat = botSeatFor(room, botPlayerId);
      const decision = decideBotAction({
        legalActions: enumerateLegalActions(game, botPlayerId),
        difficulty: seat?.difficulty ?? "standard",
        table,
      });
      if (decision.kind === "none") {
        // Reported rather than skipped, in both directions. On turn it stalls the
        // whole match — nobody else may act on a bot's turn. Off turn it is a
        // disagreement between `seatToDrive` (which only picks a seat that owes
        // the table something) and the policy (which has an answer for every one
        // of those), and skipping it would spin this loop to the action cap.
        return {
          actions,
          stop: {
            kind: "bot-cannot-decide",
            playerId: botPlayerId,
            phase: game.turn.phase,
            gameRevision: game.revision,
          },
        };
      }

      const commandId = botCommandId(game, decision);
      const thinkMs = botThinkMs({
        rules: game.rules,
        configuredDelayMs: deps.configuredDelayMs,
        seed: commandId,
      });
      // Announced *before* the pause, so the wait has a visible reason while it
      // is happening rather than an explanation that arrives with the command.
      report({
        type: "bot.thinking",
        roomId,
        playerId: botPlayerId,
        decision: decision.kind,
        why: decision.why,
        thinkMs,
        line: botThinkingLine(game.rules.social.chat),
      });
      // Delay before acting, so a human watching sees the bot think — and so the
      // *previous* turn (the human's own, or the last bot's) has finished playing
      // out on the client before this one's events arrive. The room service stamps
      // every event of one command with a single `occurredAt`, so this pause is the
      // only thing that separates one turn from the next in what clients receive.
      //
      // Taken outside the room service's per-room lock, so a bot pause never
      // blocks a human command, a bootstrap read, or the turn-timeout driver's
      // timer write. It does hold this driver's own per-room drain slot, which is
      // what bounds it — see MAXIMUM_BOT_TURN_DELAY_MS.
      await sleep(thinkMs);

      const result = await deps.submit({
        roomId,
        actorId: botPlayerId,
        commandId,
        expectedRevision: decision.expectedRevision,
        command: decision.command,
      });
      if (!result.ok) {
        return {
          actions,
          stop: {
            kind: "command-rejected",
            playerId: botPlayerId,
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
        playerId: botPlayerId,
        decision: decision.kind,
        commandId,
        revision: result.value.revision,
        gameRevision: result.value.game.revision,
        line: botDecisionLine(game.rules.social.chat, decision.kind),
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
