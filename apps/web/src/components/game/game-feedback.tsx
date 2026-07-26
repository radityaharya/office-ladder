import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  GameBootstrap,
  PublicPlayerProjection,
} from "@office-ladder/contracts";

import {
  createEventFeedbackState,
  findLocalPromptAction,
  reduceEventFeedback,
  type EventFeedbackState,
  type EventNotice,
} from "./event-feedback-policy";
import {
  cardAnnouncement,
  cardAudience,
  CardDrawDialog,
  resolveAuthoredCardDraw,
  type AuthoredCardDraw,
} from "./card-draw-dialog";
import { PromptDialog } from "./prompt/prompt-dialog";

type GameFeedbackProps = {
  readonly bootstrap: GameBootstrap;
  readonly error: string | null;
  readonly isResponding: boolean;
  readonly onIdleChange: (idle: boolean) => void;
  readonly onRespond: (optionId: string) => void;
};

/**
 * The interrupting half of the feedback layer.
 *
 * ## The blocking rule, as implemented
 *
 * A modal that covers the board is justified **only when the game cannot proceed
 * without this player's input** — that is, exactly one condition: an open
 * decision prompt addressed to the local player (`prompt.respond` in
 * `bootstrap.legalActions`). That is the single overlay this component renders.
 *
 * Everything else is non-blocking. A card drawn by anyone, including the local
 * player, is information about something the server already committed, so it is
 * presented by `CardDrawFeed` as a docked strip that dims nothing and clears
 * itself. The handful of committed events a player must not miss (see
 * `criticalNotices`) become one corner toast each; every other committed event
 * is a line in the activity log and nothing more.
 *
 * ## What "idle" means now
 *
 * `onIdleChange(true)` means: **this component has processed the current
 * projection revision and the local player owes the server no decision.** Card
 * notices no longer participate — they self-dismiss, so waiting on them could
 * only delay the match report for a notice the player never had to clear, and
 * the report already prints the closing log entries that carry the same
 * information. See the note on the winner gate in game-client.tsx.
 */
export function GameFeedback({
  bootstrap,
  error,
  isResponding,
  onIdleChange,
  onRespond,
}: GameFeedbackProps) {
  const feedbackState = useRef<EventFeedbackState>(createEventFeedbackState());
  const [announcement, setAnnouncement] = useState("");
  const [processedRevision, setProcessedRevision] = useState<number | null>(null);
  const promptAction = findLocalPromptAction(bootstrap.legalActions);
  const selfPlayer = findSelfPlayer(bootstrap);

  useEffect(() => {
    const result = reduceEventFeedback(
      feedbackState.current,
      bootstrap.publicProjection.eventSummaries,
      bootstrap.room,
      bootstrap.self.playerId,
    );
    feedbackState.current = result.state;
    setProcessedRevision(bootstrap.publicProjection.revision);
    if (result.notices.length === 0) return;

    // Routine committed events are log entries, not overlays — the activity log
    // in the turn rail already renders every event in the projection. Only the
    // handful a player genuinely must not miss get a transient toast, and the
    // screen-reader announcement still covers the whole batch either way.
    setAnnouncement(feedbackMessage(result.notices));
    for (const notice of result.notices) {
      const alert = criticalNoticeFor(notice);
      if (alert === null) continue;
      toast(alert.title, {
        description: alert.description,
        duration: 6_000,
        icon: (
          <span
            aria-hidden="true"
            className={`overlay-led overlay-led-${alert.tone}`}
          />
        ),
        id: notice.eventId,
      });
    }
  }, [bootstrap]);

  useEffect(() => {
    if (processedRevision !== bootstrap.publicProjection.revision) return;
    onIdleChange(promptAction === null);
  }, [
    bootstrap.publicProjection.revision,
    onIdleChange,
    processedRevision,
    promptAction,
  ]);

  return (
    <>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      <PromptDialog
        action={promptAction}
        error={error}
        isResponding={isResponding}
        money={selfMoney(selfPlayer)}
        onRespond={onRespond}
        seat={selfPlayer?.seat ?? null}
      />
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* The non-blocking card feed.                                               */
/* ------------------------------------------------------------------------- */

/**
 * How long one card notice holds the strip before clearing itself, in ms.
 *
 * Pacing, not animation: reduced motion collapses the *transition* to a
 * crossfade but keeps these dwells, because a reduced-motion player still has to
 * be able to read what happened.
 *
 * The local player's own draw earns a longer read than a bot's. When draws pile
 * up — several bots resolving in one committed batch — the dwell compresses so
 * the strip can catch up. It never drops a draw: every queued card is shown,
 * exactly once, in server order.
 */
export const CARD_HOLD_MS = {
  mine: 5_000,
  theirs: 2_800,
  /** 3–4 queued: still readable, but the strip stops being a bottleneck. */
  catchUp: 1_200,
  /** 5+ queued: a bot burst. Legibility now lives in the activity log. */
  minimum: 800,
} as const;

export function cardHoldMs(draw: AuthoredCardDraw, queueLength: number): number {
  const base =
    cardAudience(draw.notice) === "mine" ? CARD_HOLD_MS.mine : CARD_HOLD_MS.theirs;
  if (queueLength <= 2) return base;
  if (queueLength <= 4) return Math.min(base, CARD_HOLD_MS.catchUp);

  return CARD_HOLD_MS.minimum;
}

type CardDrawFeedProps = {
  readonly bootstrap: GameBootstrap;
};

/**
 * Every committed card draw, played out one at a time as a docked strip.
 *
 * Mount this **inside the shell grid** (see game-client.tsx: it is the first
 * child of the `actionTray` slot, so it becomes a real full-width row directly
 * above the action bar) rather than as a floating layer. DESIGN.md §4.1 forbids
 * panels centred in free space; this is a region of the grid, hairline-separated
 * from the bar below it, and the board row — `minmax(0, 1fr)` — yields the space
 * instead of being covered by it.
 *
 * Queue contract, preserved from the modal it replaces:
 * - One own dedup ledger, seeded from history on first read, so a reload never
 *   replays cards already drawn and a 5s poll never re-shows the same draw.
 * - Draws enter the queue in server order and leave only from the head.
 * - The self-dismiss timer is keyed to the head's event id and re-checks it
 *   before shifting, so a stale timer can never skip a card or double-advance.
 * - While an actionable prompt owns the screen the head is HELD, not dropped:
 *   the prompt is answered first and the card is shown afterwards.
 */
export function CardDrawFeed({ bootstrap }: CardDrawFeedProps) {
  const ledger = useRef<EventFeedbackState>(createEventFeedbackState());
  const [queue, setQueue] = useState<readonly AuthoredCardDraw[]>([]);
  const blocked = findLocalPromptAction(bootstrap.legalActions) !== null;
  const current = queue[0] ?? null;
  const pending = Math.max(0, queue.length - 1);

  /*
   * Read at the moment a hold is armed rather than as an effect dependency: a
   * card arriving while one is on screen must not restart the running timer.
   */
  const queueLength = useRef(queue.length);
  queueLength.current = queue.length;

  useEffect(() => {
    const result = reduceEventFeedback(
      ledger.current,
      bootstrap.publicProjection.eventSummaries,
      bootstrap.room,
      bootstrap.self.playerId,
    );
    ledger.current = result.state;
    if (result.cardDraws.length === 0) return;

    setQueue((entries) => [
      ...entries,
      ...result.cardDraws.flatMap((draw) => {
        const authored = resolveAuthoredCardDraw(draw);
        return authored ? [authored] : [];
      }),
    ]);
  }, [bootstrap]);

  useEffect(() => {
    if (current === null || blocked) return;
    const eventId = current.notice.eventId;
    const timer = window.setTimeout(() => {
      setQueue((entries) =>
        entries[0]?.notice.eventId === eventId ? entries.slice(1) : entries,
      );
    }, cardHoldMs(current, queueLength.current));

    return () => window.clearTimeout(timer);
  }, [blocked, current]);

  return (
    <div className="card-feed" data-slot="card-feed">
      {/* The strip is ordinary content, so this is the only thing that speaks.
          One utterance per card, replacing the previous one. */}
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {current === null || blocked ? "" : cardAnnouncement(current)}
      </p>
      {/* `mode="wait"` because the strip is a single grid cell: two notices
          present at once would stack on top of each other. */}
      <AnimatePresence mode="wait">
        {current === null || blocked ? null : (
          <CardDrawDialog
            blocked={false}
            draw={current}
            key={current.notice.eventId}
            onContinue={() =>
              setQueue((entries) =>
                entries[0]?.notice.eventId === current.notice.eventId
                  ? entries.slice(1)
                  : entries,
              )
            }
          />
        )}
      </AnimatePresence>
      {pending === 0 || current === null || blocked ? null : (
        <p className="card-feed-queued" data-slot="card-feed-queued">
          <span className="card-notice-label">Queued</span>
          <span className="card-feed-queued-value">
            {pending} more {pending === 1 ? "card" : "cards"}
          </span>
        </p>
      )}
    </div>
  );
}

type CriticalNotice = {
  readonly title: string;
  readonly tone: "active" | "caution" | "critical" | "info";
  /** "local" only fires for the caller's own events; "table" fires for anyone's. */
  readonly scope: "local" | "table";
  readonly describe: (actorName: string) => string;
};

/**
 * The complete set of committed events allowed to interrupt with an overlay.
 * Everything else — rolls, moves, salary, tile resolutions, resource changes,
 * statuses, prompts, card draws — belongs in the activity log.
 *
 * Each entry describes only what the engine actually does: promotion is
 * automatic when affordable, so a promoted player never chose it and would
 * otherwise see their rank change with no explanation.
 */
const criticalNotices: Readonly<Record<string, CriticalNotice>> = {
  ClockDeckExhausted: {
    title: "Clock deck exhausted",
    tone: "info",
    scope: "table",
    describe: () => "The clock deck is out of cards.",
  },
  ManagementRevealed: {
    title: "Management revealed",
    tone: "caution",
    scope: "table",
    describe: (actorName) => `${actorName} is management. That role is now public.`,
  },
  PlayerPromoted: {
    title: "Promotion committed",
    tone: "active",
    scope: "local",
    describe: () =>
      "You met the next rank's cost, so the promotion was applied automatically.",
  },
  PromotionBlocked: {
    title: "Promotion blocked",
    tone: "critical",
    scope: "local",
    describe: () => "Your promotion attempt was blocked. Your rank is unchanged.",
  },
};

function criticalNoticeFor(notice: EventNotice): {
  readonly title: string;
  readonly description: string;
  readonly tone: CriticalNotice["tone"];
} | null {
  const entry = criticalNotices[notice.eventType];
  if (entry === undefined) return null;
  if (entry.scope === "local" && notice.actorKind !== "local") return null;

  return {
    title: entry.title,
    description: entry.describe(notice.actorName),
    tone: entry.tone,
  };
}

function findSelfPlayer(bootstrap: GameBootstrap): PublicPlayerProjection | null {
  return (
    bootstrap.publicProjection.players.find(
      (player) => player.id === bootstrap.self.playerId,
    ) ?? null
  );
}

/** Projections key money as either "money" or "resource.money" — accept both. */
function selfMoney(player: PublicPlayerProjection | null): number | null {
  if (player === null) return null;
  return player.resources["money"] ?? player.resources["resource.money"] ?? null;
}

function feedbackMessage(notices: readonly EventNotice[]): string {
  const latest = notices.at(-1);
  if (!latest) return "";
  const latestMessage = `${latest.actorName} · ${eventTypeLabel(latest.eventType)}`;
  return notices.length === 1
    ? latestMessage
    : `${notices.length} updates committed. Latest: ${latestMessage}`;
}

function eventTypeLabel(type: string): string {
  return type.replaceAll(".", " ").replaceAll("-", " ");
}
