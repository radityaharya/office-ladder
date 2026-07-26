import { useMemo } from "react";

import type { GameBootstrap, SafeEventSummary } from "@office-ladder/contracts";

import type { DiceRollFeedItem } from "./dice-readout";

/**
 * Bridges committed projections to the dice instrument.
 *
 * Deliberately a **pure derivation**, not a ledger: the newest `DiceRolled` in
 * the projection it is handed *is* the roll to report. That matters twice over.
 *
 * - It is correct on the first synchronous render. The previous version kept its
 *   own seen-event ledger inside an effect, so the very first render always
 *   reported `null` and the real faces only appeared after mount — which meant a
 *   `renderToStaticMarkup` of a wired-up board showed no dice at all, and a
 *   reduced-motion player briefly saw an empty instrument.
 * - Pacing belongs in exactly one place. Pass the **paced** bootstrap from
 *   `useEventPacing` and a bot's roll surfaces on its own beat; pass the raw
 *   bootstrap and it surfaces the instant the projection lands. Either way this
 *   hook has no opinion, so there is no second cursor to drift.
 *
 * The settle animation is still fired at most once per roll — `useDiceSettle`
 * keys the sequence off the committed event id, so a poll that re-delivers an
 * identical projection cannot re-animate it, and a page loaded mid-match shows
 * its last real roll seated rather than replaying it.
 */
export function useDiceFeed(bootstrap: GameBootstrap | null): DiceRollFeedItem | null {
  return useMemo(
    () => (bootstrap === null ? null : latestCommittedRoll(bootstrap)),
    [bootstrap],
  );
}

/** The newest committed roll in a projection, or null when it records none. */
export function latestCommittedRoll(
  bootstrap: GameBootstrap,
): DiceRollFeedItem | null {
  const events = bootstrap.publicProjection.eventSummaries;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined && isDiceRolled(event)) return toFeedItem(event, bootstrap);
  }

  return null;
}

function isDiceRolled(
  event: SafeEventSummary,
): event is Extract<SafeEventSummary, { readonly type: "DiceRolled" }> {
  return event.type === "DiceRolled";
}

function toFeedItem(
  event: Extract<SafeEventSummary, { readonly type: "DiceRolled" }>,
  bootstrap: GameBootstrap,
): DiceRollFeedItem {
  const member = bootstrap.room.members.find(
    (candidate) => candidate.id === event.actorPlayerId,
  );
  const isSelf =
    event.actorPlayerId !== null && event.actorPlayerId === bootstrap.self.playerId;

  return {
    eventId: event.id,
    faces: event.dice,
    total: event.total,
    purpose: event.purpose,
    rollerName:
      member?.displayName ?? (event.actorPlayerId === null ? "System" : "A coworker"),
    isSelf,
    isBot: member?.isBot ?? false,
    seat: seatSlot(bootstrap, event.actorPlayerId),
  };
}

/**
 * The 1..6 turn-order slot for a player.
 *
 * Derived from the player's index in the already turn-ordered
 * `publicProjection.players`, exactly as `seatSlot` in the turn rail does, and
 * for the same reason: `PublicPlayerProjection.seat` is the engine's ZERO-based
 * turn `order`, so reading it directly puts the first seat at 0 and loses it.
 * Deriving it the same way is what guarantees the roller's chip colour here
 * matches their token on the board and their row in the rail.
 */
function seatSlot(bootstrap: GameBootstrap, playerId: string | null): number | null {
  if (playerId === null) return null;
  const index = bootstrap.publicProjection.players.findIndex(
    (player) => player.id === playerId,
  );
  if (index < 0 || index > 5) return null;

  return index + 1;
}
