import type { GameBootstrap, RoomBootstrap } from "@office-ladder/contracts";

/**
 * Whether a bootstrap read shows a *live* game whose current turn belongs to a
 * human — i.e. whether the read path should revive the in-memory turn clock.
 *
 * The mirror image of bots/should-drive.ts, and narrow for the same reasons. The
 * engine's rollTurn always names the *next* player as active, including on the
 * roll that ends the match, so a finished game still reports somebody as active;
 * a check that ignored `status` would fire on every poll of a completed match,
 * which is exactly where clients linger longest. "paused" (quarantined) is
 * excluded too — there is nothing to enforce in a quarantined match.
 *
 * A bot on turn is deliberately excluded: bots are not on a clock (see
 * turn-timer.ts), so kicking the driver would cost a projection read to discover
 * there is nothing to do. The driver still handles a bot turn correctly when it is
 * kicked for another reason — it hands off to the bot driver — but the read path
 * does not need to ask.
 */
export function shouldEnforceTurnTimer(
  bootstrap: RoomBootstrap | GameBootstrap,
): boolean {
  if (!("publicProjection" in bootstrap)) return false;
  const projection = bootstrap.publicProjection;
  if (projection.status !== "active") return false;
  const activePlayerId = projection.activePlayerId;
  if (activePlayerId === null) return false;
  return bootstrap.room.members.some(
    (member) => member.id === activePlayerId && !member.isBot,
  );
}
