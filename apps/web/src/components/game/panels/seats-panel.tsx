import { formatPanelMoney, pluralise } from "./panel-format";
import { Panel, type PanelChrome } from "./panel";
import { PanelEmpty, PanelList, PanelNote, PanelRow, PanelStamp } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";
import {
  panelDebtFact,
  panelIncomeFact,
  panelUpkeepArrearsFact,
  panelUpkeepFact,
  type PanelUpkeepReadout,
} from "./panel-semantics";

/**
 * One seat's standing economy.
 *
 * Public on purpose — `PublicPlayerGameplayProjection` carries upkeep, loans and
 * income streams for every seat, because a table that cannot see who is
 * over-extended cannot price a deal with them. It lives on the roster rather than
 * in an economy panel of its own for a §12.4 reason: upkeep has to be visible
 * *before* it bites, and a recurring charge nobody reads until it lands is exactly
 * the surprise deduction that rule forbids.
 *
 * Debt is a separate field from `money` rather than a negative balance, also per
 * §12.4: a seat at -$300 cash and a seat carrying a $1,200 loan are in different
 * trouble, and one red figure cannot say which.
 */
export type SeatEconomy = {
  readonly upkeep: PanelUpkeepReadout;
  /** Sum of every outstanding loan. Owed, not spent. */
  readonly debtOutstanding: number;
  readonly loanCount: number;
  /** Net of every income stream, per round. Signed. */
  readonly incomePerRound: number;
};

/**
 * One seat, as the roster may show it.
 *
 * Everything here is public projection — a seat's rank, tile, cash, presence and
 * standing economy are visible to the whole table by design. The things that are
 * NOT public (their hand, their secret objectives, their hidden sabotage) have no
 * field on this type, which is how a later wave is prevented from putting them in
 * the roster: there is nowhere to put them.
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
  /**
   * The member's profile picture, or null — which is the common case, since bot
   * seats never have one and nothing in this app can set one yet.
   *
   * **Carried here, deliberately not drawn by this panel.** Identity in the roster
   * is the seat colour plus the seat NUMBER (§8), and a 320px rail should not
   * spend 20px per row on an image that is usually absent. It is on this type so
   * the board's token layer and any dossier overlay read faces from the same
   * derivation as the roster instead of re-walking `room.members`.
   *
   * Safe in an `img src` and nowhere else — the server vouches for an absolute
   * `https:` URL or a root-relative same-origin path (`parseAvatarUrl`), never for
   * a `style`, an `href` or a CSS `url()`.
   */
  readonly avatarUrl?: string | null;
  /** See {@link SeatEconomy}. Null when the match projects no economy block. */
  readonly economy?: SeatEconomy | null;
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
  const economyShown = seats.some((seat) => seat.economy !== null && seat.economy !== undefined);

  return (
    <Panel
      chrome={chrome}
      footer={
        economyShown ? (
          <PanelNote slot="panel-seat-economy-note">
            Upkeep is charged every round and rises with rank, so a promotion is a
            standing cost as well as a win condition. Debt is money owed, tracked
            apart from the cash a seat is holding.
          </PanelNote>
        ) : null
      }
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
              facts={factsFor(seat)}
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
 * The seat's facts, in one fixed order: who they are in the ladder, where they
 * are on the board, what they hold, what they owe.
 *
 * The economy facts are appended rather than interleaved so the first three are
 * always in the same place — a roster whose columns move as loans are taken is a
 * roster a player has to re-read every turn. Facts wrap between themselves and
 * never inside one (`.panel-fact` is `nowrap`), so adding two more cannot break a
 * figure across lines.
 */
function factsFor(seat: SeatPanelRow): readonly string[] {
  const facts = [seat.rankLabel, `Tile ${seat.tileLabel}`, formatPanelMoney(seat.money)];
  const economy = seat.economy;
  if (economy === null || economy === undefined) return facts;

  facts.push(panelUpkeepFact(economy.upkeep));
  const arrears = panelUpkeepArrearsFact(economy.upkeep);
  if (arrears !== null) facts.push(arrears);
  if (economy.loanCount > 0) {
    facts.push(panelDebtFact(economy.debtOutstanding, economy.loanCount));
  }
  const income = panelIncomeFact(economy.incomePerRound);
  if (income !== null) facts.push(income);

  return facts;
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
