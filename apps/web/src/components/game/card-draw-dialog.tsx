import { RiCloseLine } from "@remixicon/react";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

import { deadlineDashContent } from "@office-ladder/content";

import {
  CHROME_MOTION_MS,
  EASING_STANDARD,
  GAMEPLAY_SPRING,
  REDUCED_MOTION_FADE,
} from "@/lib/motion";

import {
  describeCardDrawSource,
  describeEffect,
  resolveAuthoredCardCopy,
  type AuthoredCardCopy,
} from "./card";
import type { CardDrawNotice } from "./event-feedback-policy";

type AuthoredCard = (typeof deadlineDashContent.decks)[number]["cards"][number];
type AuthoredDeck = (typeof deadlineDashContent.decks)[number];

export type AuthoredCardDraw = {
  readonly notice: CardDrawNotice;
  readonly deck: AuthoredDeck;
  readonly card: AuthoredCard;
  /**
   * Display copy resolved once at this boundary. Additive — `notice`, `deck` and
   * `card` keep their original meaning for existing consumers.
   */
  readonly copy: AuthoredCardCopy;
};

type CardDrawDialogProps = {
  readonly draw: AuthoredCardDraw | null;
  readonly blocked: boolean;
  readonly onContinue: () => void;
};

/** Who the draw belongs to. Separated in the markup, never by colour alone. */
export type CardAudience = "mine" | "theirs" | "system";

/**
 * One drawn card, presented as a **non-blocking docked notice**.
 *
 * A card draw is information about something the server already applied — the
 * effects were committed before this browser heard the event. Demanding a click
 * to acknowledge history is exactly what a player experiences as noise, so this
 * no longer opens a modal: it renders a row that docks above the action bar,
 * dims nothing, covers no part of the board, traps no focus, and never sits
 * between the player and the roll control (DESIGN.md §4.1/§4.3, and §7.2's
 * "motion never gates input"). The only overlay left in the feedback layer is
 * the decision prompt, which the game genuinely cannot proceed without.
 *
 * Props are the historical contract, unchanged in shape and meaning:
 * - `draw`      — the single card to present, or null for nothing to show.
 * - `blocked`   — an actionable prompt owns the screen, so hold this draw. The
 *                 host does NOT drop it; it is still at the head of the queue.
 * - `onContinue`— advance the queue. Now called by the host's self-dismiss timer
 *                 as well as by this notice's optional dismiss control, so a
 *                 player never has to click to move the game on.
 *
 * The authored copy is unchanged and unabbreviated: deck name, display name,
 * flavor line, and one row per effect carrying the same sentence, uppercase
 * scope and explicitly signed mono delta that `CardEffectTable` renders — same
 * `describeEffect` source of truth, laid out along the strip instead of down a
 * column.
 */
export function CardDrawDialog({ draw, blocked, onContinue }: CardDrawDialogProps) {
  // Hook first: this component returns early, and a conditional hook would be a
  // rules-of-hooks violation the moment `draw` flips to null.
  const reduceMotion = useReducedMotion() === true;
  if (draw === null || blocked) return null;

  const audience = cardAudience(draw.notice);
  const readouts = draw.card.effects.map((effect) => describeEffect(effect));

  return (
    <m.article
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      className="card-notice"
      /* Explicitly recorded so a reviewer — and the test suite — can assert this
         presentation never became a modal again. */
      data-blocking="false"
      data-card-audience={audience}
      data-card-deck-id={draw.deck.id}
      data-card-definition-id={draw.card.id}
      data-card-draw="true"
      data-slot="card-notice"
      exit={
        reduceMotion
          ? { opacity: 0, transition: REDUCED_MOTION_FADE }
          : {
              opacity: 0,
              y: 4,
              /* Dismissal is instrumentation, not a reveal: §7.2 budgets an
                 entrance, never an exit, so the leave uses `easing-standard` at
                 chrome speed rather than stretching the surface spring. */
              transition: {
                duration: CHROME_MOTION_MS.fast / 1000,
                ease: EASING_STANDARD,
              },
            }
      }
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      transition={reduceMotion ? REDUCED_MOTION_FADE : GAMEPLAY_SPRING.surface}
    >
      <div className="card-notice-ident">
        <p className="card-notice-label">
          <span aria-hidden="true" className="card-draw-led" />
          {audienceKicker(audience)}
        </p>
        <p className="card-notice-actor" data-slot="card-notice-actor">
          {audienceActor(draw.notice)}
        </p>
      </div>

      <div className="card-notice-body">
        <p className="card-notice-head">
          <span className="card-notice-deck" data-slot="card-notice-deck">
            {draw.copy.deckName} deck
          </span>
          <span className="card-notice-name" data-slot="card-notice-name">
            {draw.copy.name}
          </span>
        </p>
        {draw.copy.flavor === null ? null : (
          <p className="card-notice-flavor" data-slot="card-notice-flavor">
            {draw.copy.flavor}
          </p>
        )}
        {/* Full provenance still reaches assistive tech even though the strip
            shows only the actor's name. */}
        <p className="sr-only">{describeCardDrawSource(draw.notice)}</p>
      </div>

      <ul className="card-notice-effects" data-slot="card-notice-effects">
        {readouts.length === 0 ? (
          <li className="card-notice-effect" data-polarity="neutral">
            <span className="card-notice-effect-delta">—</span>
            <span className="card-notice-effect-scope">Record</span>
            <span className="card-notice-effect-text">
              No mechanical effect. The draw is recorded and nothing changes.
            </span>
          </li>
        ) : (
          readouts.map((readout, index) => (
            <li
              className="card-notice-effect"
              data-polarity={readout.polarity}
              data-slot="card-notice-effect"
              key={`${readout.type}-${index}`}
            >
              <span className="card-notice-effect-delta">
                {readout.delta ?? "—"}
              </span>
              <span className="card-notice-effect-scope">{readout.scope}</span>
              <span className="card-notice-effect-text">{readout.sentence}</span>
            </li>
          ))
        )}
      </ul>

      <dl className="card-notice-meta">
        <div className="card-notice-meta-cell">
          <dt className="card-notice-label">Rev</dt>
          <dd className="card-notice-meta-value">{draw.notice.revision}</dd>
        </div>
        <div className="card-notice-meta-cell">
          <dt className="card-notice-label">State</dt>
          <dd className="card-notice-meta-value">Committed</dd>
        </div>
      </dl>

      {/*
        Optional, never required: the notice clears itself on a timer. It exists
        so a keyboard or screen-reader user can retire the row early instead of
        waiting it out, and because a 28px target is cheaper than a player
        wondering whether the strip is stuck (§8).
      */}
      <button
        className="card-notice-dismiss"
        data-slot="card-notice-dismiss"
        onClick={onContinue}
        type="button"
      >
        <RiCloseLine aria-hidden="true" className="card-notice-dismiss-glyph" />
        <span className="sr-only">Dismiss the {draw.copy.name} card notice</span>
      </button>
    </m.article>
  );
}

export function cardAudience(notice: CardDrawNotice): CardAudience {
  switch (notice.actorKind) {
    case "local":
      return "mine";
    case "system":
      return "system";
    case "remote":
      return "theirs";
  }
}

/**
 * One polite-live-region sentence per card. The strip itself is ordinary
 * content, so this is the only thing that speaks — without it, a reduced-motion
 * or screen-reader player would have no evidence the draw happened at all
 * (DESIGN.md §7.2).
 */
export function cardAnnouncement(draw: AuthoredCardDraw): string {
  const audience = cardAudience(draw.notice);
  const actor =
    audience === "mine"
      ? "You drew"
      : audience === "system"
        ? "The system drew"
        : `${draw.notice.actorName} drew`;
  const effects = draw.card.effects
    .map((effect) => describeEffect(effect).sentence)
    .join(" ");

  return `${actor} ${draw.copy.name} from the ${draw.copy.deckName} deck. ${
    effects.length === 0 ? "No mechanical effect." : effects
  }`;
}

/**
 * Mine versus theirs, carried by words rather than a hue: the kicker names the
 * audience outright and the value beside it names the actor ("You" / "Bo" /
 * "System"). The tonal step and left rule in cards.css are reinforcement only.
 */
function audienceKicker(audience: CardAudience): string {
  switch (audience) {
    case "mine":
      return "Your card";
    case "theirs":
      return "Opponent card";
    case "system":
      return "System card";
  }
}

function audienceActor(notice: CardDrawNotice): string {
  switch (notice.actorKind) {
    case "local":
      return "You";
    case "system":
      return "System";
    case "remote":
      return notice.actorName;
  }
}

/**
 * Matches a committed CardDrawn payload against the authored content pack.
 * Returns null when the payload does not correspond to a real authored card —
 * the UI shows nothing rather than inventing a card.
 */
export function resolveAuthoredCardDraw(draw: CardDrawNotice): AuthoredCardDraw | null {
  for (const deck of deadlineDashContent.decks) {
    if (deck.id !== draw.card.deckId) continue;
    const card = deck.cards.find(
      (candidate) =>
        candidate.id === draw.card.definitionId && candidate.nameKey === draw.card.nameKey,
    );
    if (card) return { notice: draw, deck, card, copy: resolveAuthoredCardCopy(card, deck) };
  }
  return null;
}
