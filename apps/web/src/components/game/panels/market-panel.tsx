import { Panel, type PanelChrome } from "./panel";
import { formatPanelMoney, pluralise } from "./panel-format";
import { PanelEmpty, PanelList, PanelNote, PanelRow, PanelStamp } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

export type MarketLotKind = "tile" | "card" | "favour" | "contract";

export type MarketBid = {
  readonly seat: number | null;
  readonly name: string;
  readonly amount: number;
};

type MarketLotBase = {
  readonly id: string;
  readonly title: string;
  readonly kind: MarketLotKind;
  readonly closesAtRound: number;
  /** You always know your OWN bid, in either visibility. */
  readonly yourBid: number | null;
};

/**
 * A lot on the market.
 *
 * A discriminated union rather than a flat shape with nullable fields, because
 * spec §5.8 requires that a **sealed** auction leaks nothing in flight: "nobody
 * sees votes or bids in flight". A sealed lot therefore has no `standingBid`
 * field at all — not a null one — so a template cannot print
 * `lot.standingBid?.name` and quietly reveal the leader. It gets a bid COUNT,
 * which is the most a sealed lot may say.
 */
export type MarketLot = MarketLotBase &
  (
    | { readonly visibility: "sealed"; readonly bidCount: number }
    | { readonly visibility: "open"; readonly standingBid: MarketBid | null }
  );

type MarketPanelProps = {
  readonly lots: readonly MarketLot[];
  readonly round: number;
  readonly onBid?: (lotId: string) => void;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * The market and auction board.
 *
 * Every lot states one price fact and one clock fact, and a sealed lot states
 * that it is sealed rather than showing an empty price — a blank where a number
 * belongs reads as a bug, whereas "Sealed" is information.
 */
export function MarketPanel({ lots, round, onBid, scope, chrome }: MarketPanelProps) {
  const definition = PANEL_DEFINITIONS.market;

  return (
    <Panel
      chrome={chrome}
      footer={
        <PanelNote>
          Affordability is checked when a lot closes, not when you bid. A bid you
          cannot cover is a lost lot.
        </PanelNote>
      }
      meta={lots.length === 0 ? undefined : pluralise(lots.length, "lot")}
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {lots.length === 0 ? (
        <PanelEmpty
          detail="Tiles, cards and favours put up for sale or auction appear here with the standing bid and the round the lot closes on. A sealed auction shows only that it is running — no bid is visible to anyone until it closes."
          headline="Nothing on the market"
          summary={definition.summary}
        />
      ) : (
        <PanelList label="Market lots">
          {lots.map((lot) => (
            <PanelRow
              actions={
                onBid === undefined ? undefined : (
                  <button
                    className="panel-btn"
                    data-slot="panel-market-bid"
                    onClick={() => onBid(lot.id)}
                    type="button"
                  >
                    Bid
                  </button>
                )
              }
              facts={factsFor(lot)}
              key={lot.id}
              seat={lot.visibility === "open" ? (lot.standingBid?.seat ?? null) : null}
              slot="panel-market-row"
              stamps={
                <>
                  <PanelStamp>{kindLabel(lot.kind)}</PanelStamp>
                  {lot.visibility === "sealed" ? (
                    <PanelStamp tone="caution">Sealed</PanelStamp>
                  ) : null}
                </>
              }
              title={lot.title}
              trailing={
                <span className="panel-row-deadline" data-slot="panel-market-closes">
                  {closesLabel(lot.closesAtRound, round)}
                </span>
              }
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}

/**
 * The lot's price facts. The `sealed` branch cannot reach a standing bid: the
 * field does not exist on that member of the union.
 */
function factsFor(lot: MarketLot): readonly string[] {
  const yours =
    lot.yourBid === null ? "No bid from you" : `You ${formatPanelMoney(lot.yourBid)}`;

  if (lot.visibility === "sealed") {
    return [pluralise(lot.bidCount, "bid"), "Bids hidden until close", yours];
  }
  const standing =
    lot.standingBid === null
      ? "No bids yet"
      : `${formatPanelMoney(lot.standingBid.amount)} — ${lot.standingBid.name}`;
  return [standing, yours];
}

function closesLabel(closesAtRound: number, round: number): string {
  const remaining = closesAtRound - round;
  if (remaining <= 0) return "Closing";
  return `Closes in ${pluralise(remaining, "round")}`;
}

function kindLabel(kind: MarketLotKind): string {
  if (kind === "tile") return "Tile";
  if (kind === "card") return "Card";
  if (kind === "favour") return "Favour";
  return "Contract";
}
