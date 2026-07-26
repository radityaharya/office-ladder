import { Panel, type PanelChrome } from "./panel";
import { panelClock } from "./panel-format";
import { PanelEmpty, PanelList, PanelNote, PanelRow, PanelStamp } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

/**
 * A card issued or an office-wide event fired.
 *
 * `audience` is the mine/theirs/office split the feedback layer already uses, and
 * it is a required field: "notif kebanyakan (dipisah yang sendiri atau lawan)"
 * means a feed item that cannot say whose it is has no business in this panel.
 */
export type EventFeedItem = {
  readonly id: string;
  readonly kind: "card" | "global-event" | "notice";
  readonly audience: "mine" | "theirs" | "office";
  /** The card's authored name, or the event's title. Sentence/title case. */
  readonly title: string;
  /** Deck of origin for a card, or the quarter for a scheduled event. */
  readonly source: string | null;
  /** Who it landed on, when there is a seat to name. */
  readonly actorName: string | null;
  readonly actorSeat: number | null;
  /** One line of what it did. Already applied by the time it is read. */
  readonly summary: string | null;
  readonly occurredAt: string;
};

type EventsPanelProps = {
  /** Newest first. */
  readonly items: readonly EventFeedItem[];
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * The card and event feed.
 *
 * Everything in here is **already committed** — the server applied the effects
 * before this browser heard about them — so it is presented as a record, not as
 * an alert. That is the whole reason this panel exists: "notif gak modal yang
 * nutupin" (notifications must not be modals that cover things) and "the popup
 * event notification is causing the board to jump up and down" are both
 * consequences of a transient notice living in the board's own column. A docked
 * panel neither covers the board nor resizes it, and nothing here steals focus.
 *
 * The one thing still allowed to cover the board is a prompt the game cannot
 * proceed without (`PromptDialog`), which is a decision rather than a
 * notification.
 */
export function EventsPanel({ items, scope, chrome }: EventsPanelProps) {
  const definition = PANEL_DEFINITIONS.events;
  const mine = items.filter((item) => item.audience === "mine").length;

  return (
    <Panel
      chrome={chrome}
      footer={
        <PanelNote>
          Already applied when you read it. Nothing in this panel needs an answer.
        </PanelNote>
      }
      meta={items.length === 0 ? undefined : `${mine} you · ${items.length} all`}
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {items.length === 0 ? (
        <PanelEmpty
          detail="Cards drawn and office-wide events land here as records. They are resolved by the server before you see them, so this panel never blocks the board and never asks you for anything."
          headline="Nothing issued yet"
          summary={definition.summary}
        />
      ) : (
        <PanelList label="Cards and events">
          {items.map((item) => (
            <PanelRow
              facts={factsFor(item)}
              key={item.id}
              note={item.summary ?? undefined}
              origin={originFor(item.audience)}
              seat={item.actorSeat}
              slot="panel-event-row"
              stamps={<PanelStamp>{kindLabel(item.kind)}</PanelStamp>}
              title={item.title}
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}

function factsFor(item: EventFeedItem): readonly string[] {
  const facts = [panelClock(item.occurredAt)];
  if (item.source !== null) facts.push(item.source);
  if (item.actorName !== null) facts.push(item.actorName);
  return facts;
}

function originFor(audience: EventFeedItem["audience"]): "local" | "remote" | "system" {
  if (audience === "mine") return "local";
  if (audience === "theirs") return "remote";
  return "system";
}

function kindLabel(kind: EventFeedItem["kind"]): string {
  if (kind === "card") return "Card";
  if (kind === "global-event") return "Office";
  return "Notice";
}
