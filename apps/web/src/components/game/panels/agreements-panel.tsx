import { Panel, type PanelAttention, type PanelChrome } from "./panel";
import { pluralise } from "./panel-format";
import { PanelEmpty, PanelList, PanelNote, PanelRow, PanelStamp } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";
import { panelDeadlineLabel } from "./panel-semantics";

export type AgreementPanelStatus =
  | "offered"
  | "accepted"
  | "declined"
  | "expired"
  | "settled"
  | "broken";

/**
 * One item of a deal.
 *
 * `enforced` is the whole moral of spec §5.5: a money/card/tile/token transfer is
 * enforced by the engine, a promise is not. The panel prints that distinction on
 * every term rather than in a footnote, because betrayal being possible is the
 * only reason table talk matters — and a player who thinks a promise is binding
 * has been misled by the UI, not by their opponent.
 */
export type AgreementTerm = {
  /** Short mono token, e.g. "$400", "Tile 12", "Promise". */
  readonly label: string;
  /** One line of what it means. */
  readonly detail: string;
  readonly enforced: boolean;
};

type AgreementBase = {
  readonly id: string;
  readonly proposerName: string;
  readonly proposerSeat: number | null;
  readonly recipientNames: readonly string[];
  readonly status: AgreementPanelStatus;
  readonly expiresAtRound: number;
  /** True when this agreement is waiting on the viewer's own answer. */
  readonly awaitingYou: boolean;
};

/**
 * An agreement, as the viewer may see it.
 *
 * The union is the redaction: a `parties-only` agreement the viewer is not party
 * to has no `give`/`receive` fields to render. It appears — the table knowing a
 * deal exists is part of the social pressure — but its terms are structurally
 * absent rather than conditionally hidden.
 */
export type AgreementPanelItem = AgreementBase &
  (
    | {
        readonly disclosure: "visible";
        readonly give: readonly AgreementTerm[];
        readonly receive: readonly AgreementTerm[];
      }
    | { readonly disclosure: "parties-only" }
  );

type AgreementsPanelProps = {
  readonly agreements: readonly AgreementPanelItem[];
  readonly round: number;
  readonly onRespond?: (agreementId: string, accept: boolean) => void;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * The agreement log.
 *
 * Offers you must answer sit at the top of the panel's attention: the header
 * badge counts them, so the tab strip can carry the same count without the shell
 * knowing what an agreement is. Nothing here is a modal — an offer with an expiry
 * is time-limited, and §8.5's constraint is that time-limited things must be
 * visible WITHOUT blocking the board.
 */
export function AgreementsPanel({
  agreements,
  round,
  onRespond,
  scope,
  chrome,
}: AgreementsPanelProps) {
  const definition = PANEL_DEFINITIONS.agreements;

  return (
    <Panel
      attention={agreementsAttention(agreements)}
      chrome={chrome}
      footer={
        <PanelNote>
          Transfers are enforced by the office. Promises are not — the log only
          remembers who broke one.
        </PanelNote>
      }
      meta={agreements.length === 0 ? undefined : pluralise(agreements.length, "deal")}
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {agreements.length === 0 ? (
        <PanelEmpty
          detail="Offers, trades and recorded promises are listed here with what each side owes and the round the offer lapses on. A deal between other players shows that it exists; its terms stay between the parties."
          headline="No agreements on record"
          summary={definition.summary}
        />
      ) : (
        <PanelList label="Agreements">
          {agreements.map((agreement) => (
            <PanelRow
              actions={
                onRespond === undefined || !agreement.awaitingYou ? undefined : (
                  <>
                    <button
                      className="panel-btn"
                      data-slot="panel-agreement-accept"
                      data-variant="primary"
                      onClick={() => onRespond(agreement.id, true)}
                      type="button"
                    >
                      Accept
                    </button>
                    <button
                      className="panel-btn"
                      data-slot="panel-agreement-decline"
                      onClick={() => onRespond(agreement.id, false)}
                      type="button"
                    >
                      Decline
                    </button>
                  </>
                )
              }
              facts={factsFor(agreement, round)}
              key={agreement.id}
              note={termsLine(agreement)}
              seat={agreement.proposerSeat}
              slot="panel-agreement-row"
              stamps={
                <>
                  <PanelStamp tone={statusTone(agreement.status)}>
                    {statusLabel(agreement.status)}
                  </PanelStamp>
                  {agreement.awaitingYou ? (
                    <PanelStamp tone="caution">Your call</PanelStamp>
                  ) : null}
                </>
              }
              state={agreement.awaitingYou ? "active" : "default"}
              title={`${agreement.proposerName} → ${agreement.recipientNames.join(", ")}`}
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}

/**
 * The terms, or the reason there are none to show. Reading `give`/`receive` is
 * only possible inside the `visible` branch — TypeScript will not let the
 * `parties-only` branch reach them.
 */
function termsLine(agreement: AgreementPanelItem): string {
  if (agreement.disclosure === "parties-only") {
    return "Terms are between the parties. The office records that this deal exists and nothing else.";
  }
  const give = agreement.give.map(termText).join(", ");
  const receive = agreement.receive.map(termText).join(", ");
  return `Gives ${give || "nothing"}; receives ${receive || "nothing"}.`;
}

function termText(term: AgreementTerm): string {
  return term.enforced ? term.label : `${term.label} (not enforced)`;
}

/**
 * An offer states its own clock; a settled deal states the round it closed on.
 *
 * The live case goes through the kit's one deadline formatter
 * (`panel-semantics.ts`) so "lapses in 2 rounds" reads the same here as "closes in
 * 2 rounds" does on a lot — §12.4's whole point is that the same clock must not
 * read three ways across eleven panels.
 */
function factsFor(agreement: AgreementPanelItem, round: number): readonly string[] {
  const expiry =
    agreement.status === "offered"
      ? panelDeadlineLabel(agreement.expiresAtRound, round, "lapses")
      : `Round ${agreement.expiresAtRound}`;
  return [expiry, pluralise(agreement.recipientNames.length, "party", "parties")];
}

/** The badge for offers waiting on the viewer. Exported so a tab can carry it. */
export function agreementsAttention(
  agreements: readonly AgreementPanelItem[],
): PanelAttention | null {
  const waiting = agreements.filter((agreement) => agreement.awaitingYou).length;
  if (waiting === 0) return null;
  return {
    count: waiting,
    summary: `${pluralise(waiting, "offer")} waiting on your answer.`,
  };
}

function statusLabel(status: AgreementPanelStatus): string {
  if (status === "offered") return "Offered";
  if (status === "accepted") return "Accepted";
  if (status === "declined") return "Declined";
  if (status === "expired") return "Lapsed";
  if (status === "settled") return "Settled";
  return "Broken";
}

function statusTone(
  status: AgreementPanelStatus,
): "neutral" | "accent" | "caution" | "critical" {
  if (status === "offered") return "caution";
  if (status === "accepted" || status === "settled") return "accent";
  if (status === "broken") return "critical";
  return "neutral";
}
