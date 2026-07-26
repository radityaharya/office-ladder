import type { RoomStatus } from "@office-ladder/contracts";
import type { GameState } from "@office-ladder/engine";
import { isBotMember, normalizeStoredRoom } from "@/rooms/bots/bot-seats";
import { createRoomDrainScheduler } from "@/rooms/drain-scheduler";
import type {
  RoomRepository,
  RoomService,
  RoomServiceErrorCode,
} from "@/rooms/service/types";
import { expirySubmissionFor } from "./expiry-command";
import {
  expiredExpiryTargets,
  expiryLatenessMs,
  nextExpiryDelayMs,
  nextExpiryTarget,
  type ExpiryScanOptions,
  type ExpiryTarget,
} from "./window-deadlines";

/**
 * The server half of spec §7.1: the wall clock the engine is not allowed to read.
 *
 * The engine writes `deadlineAt` onto a reaction window, a ballot or the turn and
 * stops caring. This driver fires at that instant and submits `window.expire`
 * (or `turn.timeout`, the one boundary `window.expire` has no branch for) through
 * the ordinary command path.
 *
 * Modelled on `turn-timer/turn-timeout-driver.ts` and sharing its machinery
 * where the two genuinely agree — the same per-room drain scheduler, the same
 * fire-and-forget `schedule`, the same publish-after-each-commit, the same
 * "reported, never fatal" treatment of a failed broadcast. What it does *not*
 * share is the timeout driver's decision policy: there is no least-harmful option
 * to pick here, because an expiry is not a choice made on somebody's behalf. The
 * deadline arrived; the resolvable closes on the rules it was opened with.
 *
 * The three properties the whole component exists for:
 *
 * - **Idempotent.** Command ids are deterministic in (game, revision, target),
 *   so a duplicate fire — two timers, a retry, a second process — is refused by
 *   the engine as already-applied rather than resolving anything twice. Behind
 *   that, closing is a one-way door in the engine: a second `window.expire`
 *   finds no window and a resolved ballot refuses a second close.
 * - **Recoverable.** Nothing here is stateful except the pending wakeup, which
 *   dies with the process. Every pass begins by scanning for deadlines that have
 *   *already* passed and resolving them immediately, so a restart in the middle
 *   of a reaction window costs one pass, not the match.
 * - **Not authoritative about time.** The deadline in state is the truth. A late
 *   wakeup still resolves — there is no staleness bound. An early one resolves
 *   nothing: the scan compares against the stored deadline, not against the
 *   timer that woke us, which matters because the engine cannot reject an early
 *   expiry (`expireWindow` never looks at the clock).
 */

/**
 * Iterations per pass. Several deadlines can come due together — a reaction
 * window and a ballot opened by the same turn, then the turn itself — and each
 * commit changes the revision every later command must quote, so they have to be
 * fired one at a time. The cap bounds that, and tripping it is reported as a
 * defect rather than retried.
 */
const MAX_ITERATIONS_PER_PASS = 8;

/**
 * Added to a scheduled sleep so a callback that lands a millisecond early does
 * not burn a pass discovering the deadline has not quite arrived. Expiry itself
 * is still exactly `now >= deadlineAt`; this only decides when we bother to look.
 */
const WAKEUP_GRACE_MS = 250;

/**
 * Rejections that mean the world moved on without us.
 *
 * Every one of these is a *success* from this driver's point of view:
 *
 * - STALE_REVISION — somebody committed between our read and our write.
 * - INVALID_COMMAND — our own id is already `lastCommandId`: a duplicate fire,
 *   which is the idempotency guarantee doing its job.
 * - DECISION_POINT_NOT_FOUND — the window closed because everyone answered
 *   first, which is the outcome the deadline existed to avoid waiting for.
 * - DECISION_POINT_STALE — the ballot already closed.
 * - GAME_NOT_ACTIVE / GAME_ALREADY_ENDED / ROOM_NOT_FOUND — the match or the
 *   room is gone.
 *
 * ACTOR_NOT_AUTHORIZED is deliberately absent: it would mean the scheduler's own
 * identity collided with a seat, which is a security defect and must be loud.
 */
const QUIET_STOP_CODES: readonly RoomServiceErrorCode[] = [
  "STALE_REVISION",
  "INVALID_COMMAND",
  "DECISION_POINT_NOT_FOUND",
  "DECISION_POINT_STALE",
  "GAME_NOT_ACTIVE",
  "GAME_ALREADY_ENDED",
  "ROOM_NOT_FOUND",
];

/** Why a pass stopped. Every `return` out of the loop names itself here. */
export type WindowExpiryStop =
  | { readonly kind: "room-not-found" }
  | { readonly kind: "room-not-active"; readonly roomStatus: RoomStatus }
  /** An "active" room with no canonical game: torn state, not a quiet stop. */
  | { readonly kind: "room-missing-game" }
  /** Nothing in this game carries a deadline. The common resting state. */
  | { readonly kind: "idle"; readonly gameStatus: GameState["status"] }
  /** Waiting. The wakeup for `remainingMs` is already armed. */
  | {
      readonly kind: "pending";
      readonly target: ExpiryTarget;
      readonly remainingMs: number;
    }
  | {
      readonly kind: "command-rejected";
      readonly target: ExpiryTarget;
      readonly code: RoomServiceErrorCode;
      /** True for QUIET_STOP_CODES: somebody got there first, or state moved. */
      readonly expected: boolean;
    }
  /** The iteration cap tripped while the loop was still finding work. */
  | { readonly kind: "pass-cap"; readonly cap: number };

export type WindowExpiryDriverEvent =
  | { readonly type: "window-expiry.pass.started"; readonly roomId: string }
  | {
      readonly type: "window-expiry.fired";
      readonly roomId: string;
      readonly targetKind: ExpiryTarget["kind"];
      readonly targetId: string;
      readonly deadlineAt: string;
      /**
       * How far past the deadline the fire actually landed. A steadily growing
       * value is the signal that the scheduler is behind, and it is the only way
       * to tell "the timer works" from "every client's poll happens to be
       * driving it".
       */
      readonly lateMs: number;
      /**
       * True when the deadline was derived from `rules.timers.turnSeconds`
       * rather than read from state. Reported so the day the engine starts
       * writing `TurnState.deadlineAt` is visible in the log.
       */
      readonly derivedDeadline: boolean;
      readonly commandId: string;
      readonly revision: number;
      readonly gameRevision: number;
    }
  /**
   * A submitted expiry came back refused. Reported per target rather than only
   * as the pass's stop, because a pass can be refused for one resolvable and
   * still close another — and the refusal is the interesting half.
   */
  | {
      readonly type: "window-expiry.refused";
      readonly roomId: string;
      readonly targetKind: ExpiryTarget["kind"];
      readonly targetId: string;
      readonly code: RoomServiceErrorCode;
      readonly expected: boolean;
    }
  | {
      readonly type: "window-expiry.publish.failed";
      readonly roomId: string;
      readonly revision: number;
      readonly messageId: string;
      readonly error: unknown;
    }
  | {
      readonly type: "window-expiry.pass.finished";
      readonly roomId: string;
      readonly actions: number;
      readonly stop: WindowExpiryStop;
    }
  | {
      readonly type: "window-expiry.pass.crashed";
      readonly roomId: string;
      readonly error: unknown;
    };

/** True for stops that mean this driver, the engine or the rules are broken. */
export function isWindowExpiryDefect(stop: WindowExpiryStop): boolean {
  switch (stop.kind) {
    case "room-missing-game":
    case "pass-cap":
      return true;
    case "command-rejected":
      return !stop.expected;
    case "room-not-found":
    case "room-not-active":
    case "idle":
    case "pending":
      return false;
    default:
      stop satisfies never;
      return true;
  }
}

/** Cancels a pending wakeup. Returning the canceller avoids a handle type here. */
export type CancelTimer = () => void;

export type WindowExpiryDriverDependencies = {
  readonly repository: RoomRepository;
  /**
   * The ordinary command path, narrowed to the one method this driver may use.
   *
   * `submitServerCommand` is spec §7.1's scheduler seam on the room service: it
   * takes the per-room lock, derives the synthetic non-seated actor itself,
   * applies through `applyCommand`, appends event summaries, re-derives the turn
   * clock and writes conditionally on the revision — the same block every player
   * command goes through. Depending on `Pick` rather than the whole service is
   * deliberate: it is a compile-time statement that this driver cannot roll for
   * a player, start a match or seat a bot, only cross a wall-clock boundary.
   */
  readonly roomService: Pick<RoomService, "submitServerCommand">;
  /** The same clock the deadlines were armed against. */
  readonly now: () => string;
  /**
   * Whether this deployment runs a turn clock. The *length* always comes from
   * `rules.timers.turnSeconds`; this is only the on/off switch, and it exists so
   * the existing operator-facing "no turn timer" setting keeps meaning what it
   * says. Reaction windows and ballots are never gated on it.
   */
  readonly turnClockEnabled: boolean;
  /** Mirrors the route layer's publishProjectionUpdate(roomId, revision, messageId). */
  readonly publish: (roomId: string, revision: number, messageId: string) => Promise<void>;
  /**
   * Schedules the next wakeup, returning its canceller. Injected so a test can
   * drive the clock deterministically, and so the production handle type
   * (Bun/Node `Timeout` vs a browser number) never leaks into this module.
   */
  readonly setTimer: (callback: () => void, delayMs: number) => CancelTimer;
  /**
   * Called once at the end of a pass that committed something, so the other
   * server-side actors get a look at the state an expiry just produced — a
   * closed window can hand the turn to a bot, and a timed-out turn can hand it
   * to a human whose own clock now needs arming. Called after the loop rather
   * than after each commit so this driver never interleaves with them mid-pass.
   */
  readonly onCommitted?: (roomId: string) => void;
  /**
   * Required, not optional. A driver that can close somebody's reaction window
   * without saying so is worse than no driver at all.
   */
  readonly onEvent: (event: WindowExpiryDriverEvent) => void;
};

export type WindowExpiryDriver = {
  /** Runs one settled pass: resolves what is due, or sleeps until it is. */
  readonly drive: (roomId: string) => Promise<void>;
  /** Fire-and-forget drive(): never throws, never returns a rejected promise. */
  readonly schedule: (roomId: string) => void;
  /** Drops every pending wakeup. For tests and for an orderly shutdown. */
  readonly stop: () => void;
};

type PassOutcome = {
  readonly actions: number;
  readonly stop: WindowExpiryStop;
};

function isQuietStop(code: RoomServiceErrorCode): boolean {
  return QUIET_STOP_CODES.includes(code);
}

/** Identity of a target within one pass. Kind and id together, never id alone. */
function targetKey(target: ExpiryTarget): string {
  return `${target.kind}:${target.id}`;
}

export function createWindowExpiryDriver(
  deps: WindowExpiryDriverDependencies,
): WindowExpiryDriver {
  /** One pending wakeup per room, replaced rather than accumulated. */
  const wakeups = new Map<string, CancelTimer>();

  function report(event: WindowExpiryDriverEvent): void {
    try {
      deps.onEvent(event);
    } catch {
      // A throwing sink must not abort an expiry that is already committed, and
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
        type: "window-expiry.publish.failed",
        roomId,
        revision,
        messageId,
        error,
      });
    }
  }

  async function pass(roomId: string): Promise<PassOutcome> {
    let actions = 0;
    /**
     * Targets this pass has already been refused for, so one resolvable the
     * engine will never close cannot starve the rest.
     *
     * Without it, an un-expirable window sitting on the earliest deadline is
     * picked first on every pass forever, and every *other* due deadline in the
     * room — a ballot, the turn — never gets tried at all. Skipping is only ever
     * applied to unexpected refusals; a quiet one means the world moved and the
     * right answer is to re-read, not to move on.
     */
    const refused = new Set<string>();
    let lastRefusal: WindowExpiryStop | null = null;

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_PASS; iteration += 1) {
      const stored = await deps.repository.get(roomId);
      if (stored === null) {
        cancelWakeup(roomId);
        return { actions, stop: { kind: "room-not-found" } };
      }
      const room = normalizeStoredRoom(stored);
      if (room.status !== "active") {
        cancelWakeup(roomId);
        return { actions, stop: { kind: "room-not-active", roomStatus: room.status } };
      }
      if (room.game === null) {
        cancelWakeup(roomId);
        return { actions, stop: { kind: "room-missing-game" } };
      }

      const game = room.game;
      const options: ExpiryScanOptions = {
        turnClockEnabled: deps.turnClockEnabled,
        isBotSeat: (playerId) => isBotMember(room, playerId),
      };

      const nowIso = deps.now();
      const due = expiredExpiryTargets(game, nowIso, options);
      const target = due.find((candidate) => !refused.has(targetKey(candidate)));

      if (target === undefined) {
        // Nothing left this pass can act on. A *future* deadline still gets a
        // wakeup even when something was refused: the refused target's deadline
        // is in the past and re-arming for it alone would be a busy loop, but
        // letting one broken window stop the room's turn clock from ever firing
        // again is the worse failure. The cost is one refused command per later
        // deadline, which is bounded rather than a spin.
        const delayMs = nextExpiryDelayMs(game, nowIso, options);
        const pending = delayMs === null ? null : nextExpiryTarget(game, nowIso, options);
        if (delayMs === null) cancelWakeup(roomId);
        else scheduleWakeup(roomId, delayMs);

        if (lastRefusal !== null) return { actions, stop: lastRefusal };
        return {
          actions,
          stop:
            pending === null || delayMs === null
              ? { kind: "idle", gameStatus: game.status }
              : { kind: "pending", target: pending, remainingMs: delayMs },
        };
      }

      const submission = expirySubmissionFor(roomId, game, target);
      const lateMs = expiryLatenessMs(target, nowIso);

      const result = await deps.roomService.submitServerCommand(submission);
      if (!result.ok) {
        const expected = isQuietStop(result.error.code);
        const stop: WindowExpiryStop = {
          kind: "command-rejected",
          target,
          code: result.error.code,
          expected,
        };
        report({
          type: "window-expiry.refused",
          roomId,
          targetKind: target.kind,
          targetId: target.id,
          code: result.error.code,
          expected,
        });
        // A quiet refusal means the world moved between the read and the write —
        // somebody answered the window, or another writer won the revision. The
        // right answer is a fresh read, and whoever won it kicks the drivers
        // themselves, so this pass is done.
        if (expected) {
          cancelWakeup(roomId);
          return { actions, stop };
        }
        // An unexpected one means *this* resolvable cannot be closed. Skip it and
        // give the room's other due deadlines their turn rather than letting one
        // broken window take the whole schedule down with it.
        refused.add(targetKey(target));
        lastRefusal = stop;
        continue;
      }

      actions += 1;
      report({
        type: "window-expiry.fired",
        roomId,
        targetKind: target.kind,
        targetId: target.id,
        deadlineAt: target.deadlineAt,
        lateMs,
        derivedDeadline: target.derived,
        commandId: submission.commandId,
        revision: result.value.revision,
        gameRevision: result.value.game.revision,
      });
      await publish(roomId, result.value.revision, submission.commandId);
      // Loop: the commit may have opened the next window, or several deadlines
      // may have come due while the process was down.
    }

    return { actions, stop: { kind: "pass-cap", cap: MAX_ITERATIONS_PER_PASS } };
  }

  async function runPass(roomId: string): Promise<void> {
    report({ type: "window-expiry.pass.started", roomId });
    const outcome = await pass(roomId);
    report({
      type: "window-expiry.pass.finished",
      roomId,
      actions: outcome.actions,
      stop: outcome.stop,
    });
    if (outcome.actions > 0) deps.onCommitted?.(roomId);
  }

  const scheduler = createRoomDrainScheduler({
    run: runPass,
    onCrash: (roomId, error) => {
      report({ type: "window-expiry.pass.crashed", roomId, error });
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
