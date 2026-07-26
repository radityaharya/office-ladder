import { TURN_TIMEOUT_COMMAND_ID_PREFIX } from "@office-ladder/contracts";
import type { GameState } from "@office-ladder/engine";
import type { SubmitServerCommandInput } from "@/rooms/service/types";
import type { ExpiryTarget } from "./window-deadlines";

/**
 * Turning a due deadline into the submission that closes it.
 *
 * Pure, and separate from the driver so the two properties that make an expiry
 * safe are testable without a repository.
 *
 * **The actor is not named here, and cannot be.** `SubmitServerCommandInput` has
 * no `actorId` field: the room service derives a synthetic per-room actor of its
 * own (`server:scheduler:<roomId>`), and the engine's authorisation rule for
 * these command types is inverted — an actor that *is* a seat is the rejection.
 * A scheduler that cannot name an actor cannot name a player, so "a player
 * expired the window" is unrepresentable from here rather than merely refused.
 * That is spec §6.3's requirement discharged structurally.
 *
 * **The command id is a deterministic function of (game, revision, target).**
 * Two timers, a retry and a restart all produce duplicate fires in practice;
 * re-deriving the same id means the engine's own idempotency check
 * (`commandId === lastCommandId`) refuses the duplicate instead of resolving the
 * same window twice.
 */

/**
 * Command ids are minted inside the reserved server-actor namespace so a client
 * cannot pre-claim one.
 *
 * These ids are computable from published state — a game id, a revision, and a
 * window id every client can see. Without the reservation a player could send
 * the exact id the scheduler was about to derive; the engine would then refuse
 * the scheduler's command as already-applied, silently disabling expiry for that
 * window, and an unexpirable window blocks every other command in the match.
 * `parseCommandId` in contracts rejects any client-supplied id carrying one of
 * these prefixes, and `submitServerCommand` requires one, so the two checks
 * together mean no browser-originated id can ever expire a window.
 *
 * The `expiry:` segment keeps this namespace disjoint from the turn-timeout
 * driver's `timeout:<gameId>:<revision>:<kind>`, so the two server-side actors
 * can never mint the same id for different work. A dedicated
 * `WINDOW_EXPIRY_COMMAND_ID_PREFIX` in contracts would say this more plainly;
 * that file belongs to another owner this wave, and reusing the reserved prefix
 * gets the security property today without a cross-owner edit.
 */
const EXPIRY_COMMAND_ID_SEGMENT = "expiry";

export function expiryCommandId(game: GameState, target: ExpiryTarget): string {
  return [
    `${TURN_TIMEOUT_COMMAND_ID_PREFIX}${EXPIRY_COMMAND_ID_SEGMENT}`,
    target.kind,
    String(game.gameId),
    String(game.revision),
    target.id,
  ].join(":");
}

/**
 * The submission a due target resolves through.
 *
 * `window.expire` carries the resolvable's own id and the engine's dispatcher
 * decides whether it names a ballot, a promotion block or a plain reaction
 * window — one command type, four resolvables behind it. The turn clock is the
 * one boundary `window.expire` has no branch for, so it takes `turn.timeout`,
 * whose behaviour is driven by `rules.timers.onTimeout` rather than by anything
 * this module decides.
 *
 * `expectedRevision` is the revision the scan read. It is the same optimistic
 * check every player command makes, and it is what makes losing a race to a
 * player who answered the window in time a clean rejection rather than a double
 * resolution.
 */
export function expirySubmissionFor(
  roomId: string,
  game: GameState,
  target: ExpiryTarget,
): SubmitServerCommandInput {
  const base = {
    roomId,
    expectedRevision: game.revision,
    commandId: expiryCommandId(game, target),
  } as const;

  return target.kind === "turn"
    ? { ...base, type: "turn.timeout" }
    : { ...base, type: "window.expire", decisionPointId: target.id };
}
