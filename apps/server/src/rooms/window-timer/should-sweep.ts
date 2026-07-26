import type { GameBootstrap, RoomBootstrap } from "@office-ladder/contracts";

/**
 * Whether a bootstrap read should revive the in-memory expiry schedule.
 *
 * The wakeups this driver arms live in the process and die with it, so something
 * has to re-arm them after a restart. A route mutation does it for a room
 * somebody is still playing; this is the other half — the read path — and it is
 * what makes "a server restart during a reaction window must not strand the
 * match" true rather than aspirational.
 *
 * The mirror image of `turn-timer/should-enforce.ts`, with one deliberate
 * difference: it does **not** narrow to a human on turn. A reaction window, a
 * ballot and an agreement are all answered out of turn by design — that is the
 * entire point of §7.3 — so "whose turn is it" says nothing about whether a
 * deadline is running. A bot holding the turn is irrelevant to a window every
 * other seat is being asked about.
 *
 * A finished match is excluded even though a reaction window left open on one is
 * still drainable by the engine. Clients linger on a completed match longer than
 * anywhere else, so sweeping there would put a repository read on the most-polled
 * path in the app to serve a case that only arises if the match ended with a
 * window still open *and* the process restarted before the wakeup fired. That
 * residual is called out in the report rather than paid for on every poll.
 */
export function shouldSweepWindows(bootstrap: RoomBootstrap | GameBootstrap): boolean {
  if (!("publicProjection" in bootstrap)) return false;
  return bootstrap.publicProjection.status === "active";
}
