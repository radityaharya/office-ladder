import type { ReactNode } from "react";

import type { EffectDescriptor } from "@office-ladder/content";

import { cn } from "@/lib/utils";

import type { AuthoredCardCopy } from "./authored-card-copy";
import { CardEffectTable } from "./card-effect-table";

export type CardNameRenderProps = {
  readonly className: string;
  readonly children: string;
};

type CardFaceProps = {
  readonly cardId: string;
  readonly deckId: string;
  readonly copy: AuthoredCardCopy;
  readonly effects: readonly EffectDescriptor[];
  /** Provenance line ("Drawn by …"), supplied by the host so it can be the modal's description. */
  readonly provenance?: ReactNode;
  /**
   * Element used for the card name. Defaults to a plain heading; the draw dialog
   * passes the modal's own Title so the name also labels the dialog.
   */
  readonly renderName?: (props: CardNameRenderProps) => ReactNode;
  readonly className?: string;
};

const NAME_CLASS =
  "font-heading text-2xl leading-[1.2] font-semibold tracking-[-0.01em] normal-case text-foreground";

/**
 * A drawn card, presented as a record the system issued: deck of origin, the
 * card's name, its flavor line when the content pack authors one, then an
 * explicit effects readout.
 *
 * Flat by construction — regions are separated by hairlines and one tonal step
 * (DESIGN.md §4.1), never by shadow or radius. Renders its full resting state
 * on the first synchronous pass with no browser APIs involved.
 */
export function CardFace({
  cardId,
  className,
  copy,
  deckId,
  effects,
  provenance,
  renderName = defaultRenderName,
}: CardFaceProps) {
  return (
    <article
      className={cn("grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-card", className)}
      data-card-deck-id={deckId}
      data-card-definition-id={cardId}
      data-card-name-source={copy.nameSource}
      data-slot="card-face"
    >
      <div className="grid gap-3 border-b border-border px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="ui-label inline-flex h-6 items-center border border-border bg-surface-sunken px-2 text-foreground"
            data-slot="card-face-deck"
          >
            {copy.deckName} deck
          </span>
          <span
            className="ui-data text-[0.6875rem] text-muted-foreground"
            data-slot="card-face-ref"
          >
            {cardId}
          </span>
        </div>
        {renderName({ className: NAME_CLASS, children: copy.name })}
        {copy.flavor === null ? null : (
          <p
            className="card-face-flavor text-sm leading-relaxed text-muted-foreground"
            data-slot="card-face-flavor"
          >
            {copy.flavor}
          </p>
        )}
        {provenance}
      </div>
      <CardEffectTable effects={effects} />
    </article>
  );
}

function defaultRenderName({ className, children }: CardNameRenderProps): ReactNode {
  return (
    <h2 className={className} data-slot="card-face-name">
      {children}
    </h2>
  );
}
