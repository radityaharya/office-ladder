import {
  enumerateLegalActions,
  type GameState,
  type LegalAction,
  type PlayerId,
} from "@office-ladder/engine";
import {
  TURN_TIMEOUT_COMMAND_ID_PREFIX,
  type RoomStatus,
} from "@office-ladder/contracts";
import { normalizeStoredRoom } from "@/rooms/bots/bot-seats";
import { createRoomDrainScheduler } from "@/rooms/drain-scheduler";
import type {
  ActiveStoredRoom,
  RoomRepository,
  RoomService,
  RoomServiceErrorCode,
  RoomServiceResult,
  RoomTurnTimer,
  RoomWriteErrorCode,
  StoredRoom,
} from "@/rooms/service/types";
import { decideTurnTimeoutAction, type TurnTimeoutDecision } from "./turn-timeout-policy";
import {
  isTurnTimerCurrent,
  isTurnTimerExpired,
  nextTurnTimer,
  remainingTurnTimerMs,
} from "./turn-timer";

/**
 * Server-side enforcement of the turn clock.
 *
 * Modelled directly on the bot driver, because it is the same kind of thing: a
 * server-side actor that commits a legal action on somebody's behalf, guarded by
 * the same per-room slot (both share rooms/drain-scheduler.ts), the same
 * expectedRevision predicate, the same deterministic command ids, and the same
 * publish-after-each-commit. Nothing here depends on a client honouring a
 * deadline; a countdown in the browser is decoration over this.
 *
 * Three things start a pass:
 * - a mutation just committed (the routes kick both drivers together),
 * - the in-process wakeup this driver arms for a pending deadline fires,
 * - a bootstrap read revives it — that wakeup lives in memory and dies with the
 *   process, which is exactly why the bot driver needs the same self-heal.
 */

/**
 * Iterations per pass. A pass normally does one thing and then settles on the
 * next player's fresh deadline; the headroom covers clearing a stale timer and
 * handing off to the bot driver in the same pass.
 */
const MAX_ITERATIONS_PER_PASS = 8;

/**
 * Added to the remaining time when arming the in-process wakeup, so a callback
 * that lands a millisecond early does not burn a pass discovering that the
 * deadline has not quite arrived. Expiry itself is still exactly
 * `now >= deadlineAt`; this only decides when we bother to look.
 */
const WAKEUP_GRACE_MS = 250;

/**
 * Outcomes that mean the world moved on without us — the same set the bot driver
 * treats as quiet, for the same reason. Here one of them is more than tolerable:
 * losing the race to the player whose turn it actually was is the *desired*
 * outcome, not an error.
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

/** Why a pass stopped. Every `return` out of the loop names itself here. */
export type TurnTimeoutStop =
  | { readonly kind: "room-not-found" }
  | { readonly kind: "room-not-active"; readonly roomStatus: RoomStatus }
  /** An "active" room with no canonical game: torn state, not a quiet stop. */
  | { readonly kind: "room-missing-game" }
  | { readonly kind: "match-not-active"; readonly gameStatus: GameState["status"] }
  | { readonly kind: "no-active-player" }
  /** The clock is switched off for this deployment. Correct and common. */
  | { readonly kind: "no-clock" }
  /** A bot holds the turn; the bot driver owns it and has been given the chance. */
  | { readonly kind: "bot-turn"; readonly playerId: PlayerId }
  /** A fresh deadline was persisted for a turn that had none. */
  | {
      readonly kind: "timer-armed";
      readonly playerId: PlayerId;
      readonly deadlineAt: string;
      readonly gameRevision: number;
    }
  /** A deadline that no longer belongs to this turn was dropped. */
  | { readonly kind: "timer-cleared" }
  /** Arming or clearing lost a write race. Retried on the next pass. */
  | {
      readonly kind: "timer-write-rejected";
      readonly code: RoomWriteErrorCode;
      readonly expected: boolean;
    }
  /** Waiting. The wakeup for `remainingMs` is already armed. */
  | {
      readonly kind: "timer-pending";
      readonly playerId: PlayerId;
      readonly deadlineAt: string;
      readonly remainingMs: number;
    }
  /**
   * The clock ran out and the player had no legal action at all. Nobody can move
   * this match on — the loudest thing this driver can report.
   */
  | {
      readonly kind: "cannot-act";
      readonly playerId: PlayerId;
      readonly phase: GameState["turn"]["phase"];
      readonly gameRevision: number;
    }
  /** The policy named an action the enumerator did not offer: a defect. */
  | {
      readonly kind: "legal-action-missing";
      readonly playerId: PlayerId;
      readonly wanted: LegalAction["type"];
      readonly gameRevision: number;
    }
  | {
      readonly kind: "command-rejected";
      readonly playerId: PlayerId;
      readonly decision: TurnTimeoutDecision["kind"];
      readonly code: RoomServiceErrorCode;
      /** True for QUIET_STOP_CODES: the player got there first, or the world moved. */
      readonly expected: boolean;
    }
  /** The iteration cap tripped while the loop was still finding work. */
  | { readonly kind: "pass-cap"; readonly cap: number };

export type TurnTimeoutDriverEvent =
  | { readonly type: "turn-timeout.pass.started"; readonly roomId: string }
  | {
      readonly type: "turn-timeout.applied";
      readonly roomId: string;
      readonly playerId: PlayerId;
      readonly decision: TurnTimeoutDecision["kind"];
      readonly commandId: string;
      readonly revision: number;
      readonly gameRevision: number;
      /** The prompt kind that was auto-answered, or `null` for a roll. */
      readonly promptKind: string | null;
      /**
       * True when a prompt was answered with an option nobody has classified as
       * harmless. Reported at error level: it means a consequential decision was
       * made for an absent human by a fallback, and the new prompt kind needs a
       * safe option adding to the policy.
       */
      readonly unclassified: boolean;
    }
  | {
      readonly type: "turn-timeout.publish.failed";
      readonly roomId: string;
      readonly revision: number;
      readonly messageId: string;
      readonly error: unknown;
    }
  | {
      readonly type: "turn-timeout.pass.finished";
      readonly roomId: string;
      readonly actions: number;
      readonly stop: TurnTimeoutStop;
    }
  | {
      readonly type: "turn-timeout.pass.crashed";
      readonly roomId: string;
      readonly error: unknown;
    };

/** True for stops that mean this driver, the policy or the rules are broken. */
export function isTurnTimeoutDefect(stop: TurnTimeoutStop): boolean {
  switch (stop.kind) {
    case "cannot-act":
    case "legal-action-missing":
    case "room-missing-game":
    case "pass-cap":
      return true;
    case "command-rejected":
      return !stop.expected;
    case "timer-write-rejected":
      return !stop.expected;
    case "room-not-found":
    case "room-not-active":
    case "match-not-active":
    case "no-active-player":
    case "no-clock":
    case "bot-turn":
    case "timer-armed":
    case "timer-cleared":
    case "timer-pending":
      return false;
    default:
      stop satisfies never;
      return true;
  }
}

/** Cancels a pending wakeup. Returning the canceller avoids a handle type here. */
export type CancelTimer = () => void;

export type TurnTimeoutDriverDependencies = {
  readonly roomService: RoomService;
  readonly repository: RoomRepository;
  /** The same clock the room service arms deadlines with. */
  readonly now: () => string;
  /** How long a turn gets, in milliseconds; `0` disables the clock entirely. */
  readonly timeoutMs: number;
  /** Mirrors the route layer's publishProjectionUpdate(roomId, revision, messageId). */
  readonly publish: (roomId: string, revision: number, messageId: string) => Promise<void>;
  /**
   * Runs the bot driver to completion for this room.
   *
   * Awaited, and deliberately the bot driver's `drive` rather than its
   * `schedule`: when a timeout hands the turn to a bot, this pass has to wait for
   * the bots to finish before it can arm the next human's deadline. Without it the
   * chain of in-process wakeups would end on the bot's turn, and enforcement would
   * fall back to whenever some client next polled.
   */
  readonly driveBots: (roomId: string) => Promise<void>;
  /**
   * Schedules the next wakeup, returning its canceller. Injected so a test can
   * drive the clock deterministically, and so the production handle type
   * (Bun/Node `Timeout` vs a browser number) never leaks into this module.
   */
  readonly setTimer: (callback: () => void, delayMs: number) => CancelTimer;
  /**
   * Required, not optional. A driver that can take somebody's turn without saying
   * so is worse than no driver at all.
   */
  readonly onEvent: (event: TurnTimeoutDriverEvent) => void;
};

export type TurnTimeoutDriver = {
  /** Runs one settled pass: arms, waits, or enforces. */
  readonly drive: (roomId: string) => Promise<void>;
  /** Fire-and-forget drive(): never throws, never returns a rejected promise. */
  readonly schedule: (roomId: string) => void;
  /** Drops every pending wakeup. For tests and for an orderly shutdown. */
  readonly stop: () => void;
};

type PassOutcome = {
  readonly actions: number;
  readonly stop: TurnTimeoutStop;
};

/**
 * Deterministic per (game, revision, action kind), exactly like the bot driver's:
 * a duplicated pass that somehow reached the same state twice re-derives the same
 * command id, which the engine rejects as already-applied. expectedRevision is
 * still the real guard — this makes a duplicate fail loudly instead of applying
 * twice.
 *
 * The prefix comes from contracts' reserved list because this id is computable
 * from published state: a client allowed to send it first would have its own
 * command recorded as `lastCommandId`, and the engine would then refuse this one
 * as already-applied — quietly disabling the turn clock for that turn. See
 * isServerActorCommandId.
 */
function timeoutCommandId(game: GameState, decision: TurnTimeoutDecision): string {
  return `${TURN_TIMEOUT_COMMAND_ID_PREFIX}${String(game.gameId)}:${game.revision}:${decision.kind}`;
}

function isQuietStop(code: RoomServiceErrorCode): boolean {
  return QUIET_STOP_CODES.includes(code);
}

function promptKindOf(decision: TurnTimeoutDecision): string | null {
  return decision.kind === "respond" ? decision.promptKind : null;
}

export function createTurnTimeoutDriver(
  deps: TurnTimeoutDriverDependencies,
): TurnTimeoutDriver {
  /** One pending wakeup per room, replaced rather than accumulated. */
  const wakeups = new Map<string, CancelTimer>();

  function report(event: TurnTimeoutDriverEvent): void {
    try {
      deps.onEvent(event);
    } catch {
      // A throwing sink must not abort a turn that is already committed, and
      // there is by definition nowhere left to report a broken reporter to.
    }
  }

  function cancelWakeup(roomId: string): void {
    const cancel = wakeups.get(roomId);
    if (cancel === undefined) return;
    wakeups.delete(roomId);
    cancel();
  }

  function scheduleWakeup(roomId: string, delayMs: number): void {
    cancelWakeup(roomId);
    wakeups.set(
      roomId,
      deps.setTimer(() => {
        wakeups.delete(roomId);
        scheduler.schedule(roomId);
      }, delayMs + WAKEUP_GRACE_MS),
    );
  }

  async function publish(
    roomId: string,
    revision: number,
    messageId: string,
  ): Promise<void> {
    try {
      await deps.publish(roomId, revision, messageId);
    } catch (error) {
      // Already committed, and clients still poll: reported, never fatal.
      report({
        type: "turn-timeout.publish.failed",
        roomId,
        revision,
        messageId,
        error,
      });
    }
  }

  /**
   * Persists a change to the timer field alone.
   *
   * Deliberately the repository rather than a new RoomService method: this is not
   * a game command and does not belong on the service's mutation surface. It is
   * still safe, because the repository's revision predicate is what actually
   * prevents a lost update — the service's per-room lock only ever made the common
   * case avoid the conflict. Losing this race costs one retried pass, and is
   * reported as expected rather than as a defect.
   */
  async function writeTimer(
    roomId: string,
    room: StoredRoom,
    timer: RoomTurnTimer | null,
    messageId: string,
  ): Promise<TurnTimeoutStop | null> {
    const revision = room.revision + 1;
    const saved = await deps.repository.save({ ...room, turnTimer: timer, revision }, room.revision);
    if (!saved.ok) {
      return {
        kind: "timer-write-rejected",
        code: saved.error.code,
        expected: saved.error.code === "STALE_REVISION",
      };
    }
    await publish(roomId, revision, messageId);
    return null;
  }

  async function applyDecision(
    roomId: string,
    playerId: PlayerId,
    action: LegalAction,
    decision: TurnTimeoutDecision,
    commandId: string,
  ): Promise<RoomServiceResult<ActiveStoredRoom>> {
    if (decision.kind === "respond") {
      return deps.roomService.respondToPrompt({
        roomId,
        actorId: playerId,
        // "human" is the truth being asserted, not a disguise: the clock is only
        // ever armed for a human member, and what the service checks with this
        // field is "this id is not a bot seat". A bot seat here would be refused.
        actorKind: "human",
        commandId,
        expectedRevision: action.expectedRevision,
        decisionPointId: decision.decisionPointId,
        optionId: decision.optionId,
      });
    }
    return deps.roomService.roll({
      roomId,
      actorId: playerId,
      actorKind: "human",
      commandId,
      expectedRevision: action.expectedRevision,
    });
  }

  async function pass(roomId: string): Promise<PassOutcome> {
    let actions = 0;
    let handedOffToBots = false;

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_PASS; iteration += 1) {
      const stored = await deps.repository.get(roomId);
      if (stored === null) return { actions, stop: { kind: "room-not-found" } };
      const room = normalizeStoredRoom(stored);
      if (room.status !== "active") {
        return { actions, stop: { kind: "room-not-active", roomStatus: room.status } };
      }
      if (room.game === null) return { actions, stop: { kind: "room-missing-game" } };

      const game = room.game;
      if (game.status !== "active") {
        return { actions, stop: { kind: "match-not-active", gameStatus: game.status } };
      }
      const activePlayerId = game.turn.activePlayerId;
      if (activePlayerId === null) return { actions, stop: { kind: "no-active-player" } };

      const desired = nextTurnTimer({
        room,
        nowIso: deps.now(),
        timeoutMs: deps.timeoutMs,
      });

      // A stale deadline must not be projected as a live countdown, whatever the
      // reason it is stale — the clock switched off mid-match, or the turn moved to
      // a bot.
      //
      // `desired === null` is the case isTurnTimerCurrent alone does not catch:
      // when the clock is switched off between two processes, the stored deadline
      // still matches the current (game revision, player) pair, so it stays
      // "current" and keeps being projected — while this process will never enforce
      // it. A countdown that reaches zero and then does nothing is worse than no
      // countdown, so a timer nobody wants is dropped as eagerly as a wrong one.
      // (A bot turn also yields `desired === null`, but isTurnTimerCurrent already
      // reports false there, so this only widens the switched-off case.)
      if (room.turnTimer !== null && (desired === null || !isTurnTimerCurrent(room, room.turnTimer))) {
        cancelWakeup(roomId);
        const rejected = await writeTimer(roomId, room, desired, `timeout-rearmed:${game.revision}`);
        if (rejected !== null) return { actions, stop: rejected };
        if (desired !== null) {
          scheduleWakeup(roomId, desired.durationMs);
          return {
            actions,
            stop: {
              kind: "timer-armed",
              playerId: desired.playerId,
              deadlineAt: desired.deadlineAt,
              gameRevision: desired.gameRevision,
            },
          };
        }
        // Cleared, not armed — the clock was switched off, or the turn moved to a
        // bot. Look again in the same pass so one kick does the whole job.
        continue;
      }

      if (desired === null) {
        if (deps.timeoutMs <= 0) return { actions, stop: { kind: "no-clock" } };
        // Not a bot turn would have produced a timer, so this is one. Give the bot
        // driver its chance, then look once more so the next human's clock is armed
        // without waiting for a client to poll — but only once per pass, so a bot
        // the bot driver cannot move does not turn into a read loop.
        if (handedOffToBots) {
          return { actions, stop: { kind: "bot-turn", playerId: activePlayerId } };
        }
        handedOffToBots = true;
        await deps.driveBots(roomId);
        continue;
      }

      const timer = room.turnTimer;
      if (timer === null) {
        const rejected = await writeTimer(roomId, room, desired, `timeout-armed:${game.revision}`);
        if (rejected !== null) return { actions, stop: rejected };
        scheduleWakeup(roomId, desired.durationMs);
        return {
          actions,
          stop: {
            kind: "timer-armed",
            playerId: desired.playerId,
            deadlineAt: desired.deadlineAt,
            gameRevision: desired.gameRevision,
          },
        };
      }

      const nowIso = deps.now();
      if (!isTurnTimerExpired(timer, nowIso)) {
        const remainingMs = remainingTurnTimerMs(timer, nowIso) ?? timer.durationMs;
        scheduleWakeup(roomId, remainingMs);
        return {
          actions,
          stop: {
            kind: "timer-pending",
            playerId: timer.playerId,
            deadlineAt: timer.deadlineAt,
            remainingMs,
          },
        };
      }

      const legalActions = enumerateLegalActions(game, activePlayerId);
      const decision = decideTurnTimeoutAction(legalActions);
      if (decision.kind === "none") {
        return {
          actions,
          stop: {
            kind: "cannot-act",
            playerId: activePlayerId,
            phase: game.turn.phase,
            gameRevision: game.revision,
          },
        };
      }

      const wanted = decision.kind === "respond" ? "prompt.respond" : "turn.roll";
      const action = legalActions.find((candidate) => candidate.type === wanted);
      if (action === undefined) {
        // Unreachable by construction: the policy only names an action it found in
        // this same list. If it happens, the policy and the enumerator disagree and
        // the turn silently stalls, so it is reported rather than retried.
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

      const commandId = timeoutCommandId(game, decision);
      const result = await applyDecision(roomId, activePlayerId, action, decision, commandId);
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
        type: "turn-timeout.applied",
        roomId,
        playerId: activePlayerId,
        decision: decision.kind,
        commandId,
        revision: result.value.revision,
        gameRevision: result.value.game.revision,
        promptKind: promptKindOf(decision),
        unclassified: decision.kind === "respond" && decision.unclassified,
      });
      await publish(roomId, result.value.revision, commandId);
      // Committing already armed the next player's deadline, so the next iteration
      // only has to decide between waiting for it and handing off to the bots.
    }

    return { actions, stop: { kind: "pass-cap", cap: MAX_ITERATIONS_PER_PASS } };
  }

  async function runPass(roomId: string): Promise<void> {
    report({ type: "turn-timeout.pass.started", roomId });
    const outcome = await pass(roomId);
    report({
      type: "turn-timeout.pass.finished",
      roomId,
      actions: outcome.actions,
      stop: outcome.stop,
    });
  }

  const scheduler = createRoomDrainScheduler({
    run: runPass,
    onCrash: (roomId, error) => {
      report({ type: "turn-timeout.pass.crashed", roomId, error });
    },
  });

  return {
    drive: scheduler.drive,
    schedule: scheduler.schedule,
    stop() {
      for (const roomId of [...wakeups.keys()]) cancelWakeup(roomId);
    },
  };
}
