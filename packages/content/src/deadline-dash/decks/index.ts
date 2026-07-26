import type { DeckConfig } from "../../schema/decks";
import { annualEventDeck } from "./annual-event";
import { boardMeetingDeck } from "./board-meeting";
import { eventDeck } from "./event";
import { meetingDeck } from "./meeting";
import { networkingDeck } from "./networking";
import { workDeck } from "./work";

/**
 * The Deadline Dash card system, one file per deck.
 *
 * This pack was previously a curated subset — 29 cards of the ~247 designed
 * (see docs/DEADLINE_DASH_FULL_GDD.md) — because the content schema could only
 * express *immediate self-effects*: no targeting, no stored/[REACTION] play,
 * no deck-depletion timer, so the remaining designs were simply not
 * representable. That is no longer the constraint. With the v2 effect
 * vocabulary (plans/24-gameplay-v2-spec.md §10) the pack is being **completed**
 * deck by deck rather than held deliberately small; the per-card plan governing
 * that completion is the authority on which cards exist and what they do.
 *
 * Each deck lives in its own module and owns its own `id` and card list, so
 * decks can be authored and merged independently instead of serialising every
 * edit through one file:
 *
 * - `./work`          → `workDeck`          (`deck.work`)
 * - `./meeting`       → `meetingDeck`       (`deck.meeting`)
 * - `./event`         → `eventDeck`         (`deck.event`)
 * - `./networking`    → `networkingDeck`    (`deck.networking`)
 * - `./board-meeting` → `boardMeetingDeck`  (`deck.board-meeting`)
 * - `./annual-event`  → `annualEventDeck`   (`deck.annual-event`)
 *
 * This module only assembles them; it holds no card literals of its own. Add a
 * card to its deck's file, never here.
 *
 * `displayName`/`flavorText` are authored display copy, written in the
 * in-fiction register DESIGN.md's mandate requires: a line an office system
 * would have logged, procedural and unbothered, never a punchline. Every
 * flavor line is truthful to that card's own `effects` and deliberately does
 * not restate numbers — the UI renders the mechanics from `effects` directly,
 * so copy that implied an unimplemented mechanic would simply be a lie.
 */
export const deadlineDashDecks = [
  workDeck,
  meetingDeck,
  eventDeck,
  networkingDeck,
  boardMeetingDeck,
  annualEventDeck,
] as const satisfies readonly DeckConfig[];

export { annualEventDeck, boardMeetingDeck, eventDeck, meetingDeck, networkingDeck, workDeck };
