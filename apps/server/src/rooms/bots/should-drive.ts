import type { GameBootstrap, RoomBootstrap } from "@office-ladder/contracts";

/**
 * Whether a bootstrap read shows a *live* game with a bot sitting on the active
 * turn — i.e. whether the read path should revive the in-memory bot drain.
 *
 * Both halves of that sentence matter. The engine's rollTurn always sets
 * turn.activePlayerId to the *next* player, including on the roll that ends the
 * match, so a finished game keeps naming somebody as active — a bot whenever
 * the winner was not the last seat before a human. Checking only isBot
 * therefore keeps firing on every poll of a completed match, which is exactly
 * where clients linger longest (the winner screen keeps its 5s refresh), and
 * each kick costs a full projection read for a drain that can never do
 * anything. "paused" (quarantined) is excluded for the same reason.
 */
export function shouldDriveBots(bootstrap: RoomBootstrap | GameBootstrap): boolean {
  if (!("publicProjection" in bootstrap)) return false;
  const projection = bootstrap.publicProjection;
  if (projection.status !== "active") return false;

  const activePlayerId = projection.activePlayerId;
  if (
    activePlayerId !== null &&
    bootstrap.room.members.some((member) => member.id === activePlayerId && member.isBot)
  ) {
    return true;
  }

  // An open reaction window is answered by players who are *not* on turn, and
  // while one is open the active player is blocked by it. So a window raised on a
  // bot during a human's turn used to be nobody's job: the driver only ever
  // looked at the active seat, and the human sat unable to act until the expiry
  // scheduler fired. A wasted kick (the window is open only on humans) costs one
  // repository read; a missed one costs the whole table the length of a timeout.
  return bootstrap.reactions.length > 0 && bootstrap.room.members.some((m) => m.isBot);
}
