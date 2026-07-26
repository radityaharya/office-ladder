import type { EffectDescriptor } from "@office-ladder/content";

import { describeEffect, type AuthoredCardCopy } from "../card";
import { Panel, type PanelChrome } from "./panel";
import { pluralise } from "./panel-format";
import { PanelEmpty, PanelNote, PanelSeatGlyph, panelSeatClass } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

import { cn } from "@/lib/utils";

/**
 * A card in YOUR hand. Full detail, because it is yours to read.
 *
 * `copy` and `effects` are the card module's own shapes, so a host builds this
 * with `resolveAuthoredCardCopy(card, deck)` and the authored content pack —
 * there is no second source of card display copy in this app.
 */
export type HandCardView = {
  /** The card instance, not the definition: two copies of one card differ here. */
  readonly instanceId: string;
  readonly definitionId: string;
  readonly deckId: string;
  readonly copy: AuthoredCardCopy;
  readonly effects: readonly EffectDescriptor[];
  readonly playable: boolean;
  /** Why not, in words, when `playable` is false. Shown, never hidden. */
  readonly blockedReason: string | null;
};

/**
 * Another player's hand.
 *
 * **This type is the hidden-information guarantee, and it is a guarantee because
 * of what it does not have.** Spec §7.2 requires that a hidden hand projects as a
 * count; there is therefore no field here for a card id, a card name, a deck, an
 * effect or a face. A later wave cannot leak an opponent's hand through this
 * panel by being careless, because there is nowhere to put the card — it would
 * have to change this type first, which is a review-visible act rather than an
 * accident.
 */
export type OpponentHandCount = {
  readonly seat: number;
  readonly name: string;
  readonly cardCount: number;
};

type HandPanelProps = {
  readonly cards: readonly HandCardView[];
  readonly opponents: readonly OpponentHandCount[];
  /** `ModeConfig.handLimit`, echoed so a full hand is legible before it bites. */
  readonly handLimit?: number | null;
  readonly onPlay?: (instanceId: string) => void;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * The hand.
 *
 * A ROW of cards, not a list of rows — a hand is spatial, and a player picks a
 * card by recognising it rather than by reading a table. The row scrolls
 * horizontally inside the panel body with a visible thin scrollbar and snap
 * points, and each tile is a fixed measure so the row's scroll distance is
 * predictable rather than content-dependent.
 *
 * The card VISUAL is not re-invented here. The deck stamp, the authored name, the
 * flavor line, the signed mono delta, the uppercase scope tag and the polarity
 * rule all come from the card module (`AuthoredCardCopy`, `describeEffect`) and
 * are the same three facts `CardFace` prints — this is the same content at a
 * hand-tile measure, exactly as `.card-notice` already restates it at a feed-strip
 * measure. `CardFace` itself is the full-detail presentation for a surface with
 * room for it (the draw record); at 176px it would set a 24px name and a
 * three-column table inside a 320px rail.
 */
export function HandPanel({
  cards,
  opponents,
  handLimit,
  onPlay,
  scope,
  chrome,
}: HandPanelProps) {
  const definition = PANEL_DEFINITIONS.hand;
  const meta =
    handLimit === undefined || handLimit === null
      ? `${cards.length}`
      : `${cards.length}/${handLimit}`;

  return (
    <Panel
      chrome={chrome}
      footer={<OpponentHands opponents={opponents} />}
      meta={meta}
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {cards.length === 0 ? (
        <PanelEmpty
          detail="Cards you draw and keep are held here until you play them. A card you cannot play yet still shows exactly what it would do, and why it is unavailable."
          headline="Holding no cards"
          summary={definition.summary}
        />
      ) : (
        <ul
          aria-label="Your hand"
          className="panel-hand"
          data-slot="panel-hand"
          /* The row is its own horizontal scroll container, so it needs to be a
             tab stop or its overflow is pointer-only (§8). */
          tabIndex={0}
        >
          {cards.map((card) => (
            <HandCard card={card} key={card.instanceId} onPlay={onPlay} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function HandCard({
  card,
  onPlay,
}: {
  readonly card: HandCardView;
  readonly onPlay: ((instanceId: string) => void) | undefined;
}) {
  const readouts = card.effects.map((effect) => describeEffect(effect));

  return (
    <li
      className="panel-hand-card"
      data-card-definition-id={card.definitionId}
      data-card-deck-id={card.deckId}
      data-playable={card.playable ? "true" : "false"}
      data-slot="panel-hand-card"
    >
      <span className="panel-hand-deck">{card.copy.deckName} deck</span>
      <span className="panel-hand-name">{card.copy.name}</span>
      {card.copy.flavor === null ? null : (
        <p className="panel-hand-flavor">{card.copy.flavor}</p>
      )}
      {readouts.length === 0 ? (
        <p className="panel-hand-flavor" data-slot="panel-hand-no-effect">
          No mechanical effect. Playing this only puts a line in the log.
        </p>
      ) : (
        <ul className="panel-hand-effects" data-slot="panel-hand-effects">
          {readouts.map((readout, index) => (
            <li
              className="panel-hand-effect"
              data-polarity={readout.polarity}
              key={`${readout.type}-${index}`}
            >
              <span className="panel-hand-effect-delta">
                {readout.delta === null ? "—" : readout.delta}
              </span>
              <span className="panel-hand-effect-scope">{readout.scope}</span>
              <span className="panel-hand-effect-text">{readout.sentence}</span>
            </li>
          ))}
        </ul>
      )}
      {/* A blocked card states its reason in text rather than only going dim —
          a disabled control that will not say why is not legible (§5, §8). */}
      {card.playable ? null : (
        <p className="panel-hand-flavor" data-slot="panel-hand-blocked">
          {card.blockedReason ?? "Not playable right now."}
        </p>
      )}
      <button
        className="panel-btn"
        data-slot="panel-hand-play"
        disabled={!card.playable || onPlay === undefined}
        onClick={onPlay === undefined ? undefined : () => onPlay(card.instanceId)}
        type="button"
      >
        Play
      </button>
    </li>
  );
}

/**
 * Everyone else's hand, as counts.
 *
 * This is the entire presentation of another player's hand in this app. It lives
 * in the footer rather than in the row because it is a different KIND of fact: the
 * row is cards, this is bookkeeping about cards you cannot see.
 */
function OpponentHands({ opponents }: { readonly opponents: readonly OpponentHandCount[] }) {
  return (
    <>
      {opponents.length === 0 ? null : (
        <ul aria-label="Cards held by other seats" className="panel-hand-counts">
          {opponents.map((opponent) => (
            <li
              className={cn("panel-hand-count", panelSeatClass(opponent.seat))}
              data-slot="panel-hand-count"
              key={`${opponent.seat}-${opponent.name}`}
            >
              <PanelSeatGlyph seat={opponent.seat} />
              <span className="panel-sub">
                {opponent.name} · {pluralise(opponent.cardCount, "card")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <PanelNote slot="panel-hand-hidden-note">
        Other seats show a count only. Nobody at this table can see what anyone
        else is holding, including you.
      </PanelNote>
    </>
  );
}
