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
  if (activePlayerId === null) return false;
  return bootstrap.room.members.some(
    (member) => member.id === activePlayerId && member.isBot,
  );
}
