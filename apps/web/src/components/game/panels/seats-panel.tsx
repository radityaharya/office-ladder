import { formatPanelMoney, pluralise } from "./panel-format";
import { Panel, type PanelChrome } from "./panel";
import { PanelEmpty, PanelList, PanelRow, PanelStamp } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

/**
 * One seat, as the roster may show it.
 *
 * Everything here is public projection — a seat's rank, tile, cash and presence
 * are visible to the whole table by design. The things that are NOT public (their
 * hand, their secret objectives, their hidden sabotage) have no field on this
 * type, which is how a later wave is prevented from putting them in the roster:
 * there is nowhere to put them.
 */
export type SeatPanelRow = {
  readonly playerId: string;
  /** Display seat 1..6 — the same number the board token and log stamp carry. */
  readonly seat: number;
  readonly name: string;
  readonly rankLabel: string;
  /** 1-based, zero-padded board position, e.g. "07". */
  readonly tileLabel: string;
  readonly money: number;
  readonly presence: "online" | "away" | "bot";
  readonly active: boolean;
  readonly self: boolean;
  readonly eliminated?: boolean;
};

type SeatsPanelProps = {
  readonly seats: readonly SeatPanelRow[];
  readonly capacity: number;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * The seat roster.
 *
 * "still cant see all seats" was the complaint, and it was a layout failure
 * rather than a data one: the roster's rail block had `min-height: 0` and lost
 * every fight for vertical space against the activity log beside it, so a long
 * match clipped it to zero rows under a header that still read "SEATS 3/6". As a
 * panel it cannot do that — `.panel` and `.panel-body` both carry floors, and the
 * roster scrolls inside its own body instead of being squeezed by a sibling.
 */
export function SeatsPanel({ seats, capacity, scope, chrome }: SeatsPanelProps) {
  const definition = PANEL_DEFINITIONS.seats;

  return (
    <Panel
      chrome={chrome}
      meta={`${seats.length}/${capacity}`}
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {seats.length === 0 ? (
        <PanelEmpty
          detail="Each seat shows its rank, the tile it is standing on and its cash, and the seat holding the turn is marked active."
          headline="No seats filled"
          summary={definition.summary}
        />
      ) : (
        <PanelList label="Seats">
          {seats.map((seat) => (
            <PanelRow
              facts={[seat.rankLabel, `Tile ${seat.tileLabel}`, formatPanelMoney(seat.money)]}
              key={seat.playerId}
              origin={seat.self ? "local" : "remote"}
              seat={seat.seat}
              slot="panel-seat-row"
              state={seat.active ? "active" : seat.eliminated === true ? "muted" : "default"}
              stamps={
                <>
                  {seat.active ? <PanelStamp tone="accent">Active</PanelStamp> : null}
                  {seat.eliminated === true ? (
                    <PanelStamp tone="critical">Out</PanelStamp>
                  ) : null}
                </>
              }
              title={`${seat.name}${seat.self ? " (you)" : ""}`}
              trailing={<PresenceReadout presence={seat.presence} />}
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}

/**
 * Presence as an LED plus a word (§6.4, §8) — never the light alone. A bot is
 * called a bot: a sustained bot turn is a state a human sits through, and
 * "waiting" reads as a frozen screen unless the table says who it is waiting on.
 */
function PresenceReadout({ presence }: { readonly presence: SeatPanelRow["presence"] }) {
  const tone = presence === "online" ? "active" : presence === "bot" ? "info" : "critical";
  const label = presence === "online" ? "Online" : presence === "bot" ? "Bot" : "Away";

  return (
    <span className="panel-label" data-slot="panel-seat-presence">
      <span aria-hidden="true" className="panel-led" data-tone={tone} /> {label}
    </span>
  );
}

/** The roster's own attention summary, for the tab badge. */
export function seatsAttention(seats: readonly SeatPanelRow[]): string {
  const away = seats.filter((seat) => seat.presence === "away").length;
  return `${pluralise(away, "seat")} away from the table.`;
}
