import { Panel, type PanelAttention, type PanelChrome } from "./panel";
import { pluralise } from "./panel-format";
import { PanelEmpty, PanelList, PanelNote, PanelRow, PanelStamp } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";
import { PanelDeadline } from "./panel-semantics";

export type BallotKind = "vote" | "auction";

export type BallotCast = {
  readonly seat: number | null;
  readonly name: string;
  /** Already rendered for display — "Yes", "$400". The panel does not interpret. */
  readonly value: string;
};

type BallotBase = {
  readonly id: string;
  /** What is being decided, in one line. */
  readonly subject: string;
  readonly kind: BallotKind;
  readonly closesAtRound: number;
  readonly audienceCount: number;
  readonly youMayCast: boolean;
  /** Your own cast, which you may always see. Null until you cast. */
  readonly yourCast: string | null;
};

/**
 * A ballot, as the viewer may see it.
 *
 * Spec §5.8: a sealed ballot is sealed until close, and §7.2 adds that it "must
 * not leak in-flight votes to anyone, **including via `castBy` keys**" — i.e. not
 * even the identity of who has already voted. The sealed branch therefore carries
 * a single number, `castCount`, and has no `casts` array to iterate: a sealed
 * ballot cannot be rendered as a list of voters because there is no list.
 */
export type BallotPanelItem = BallotBase &
  (
    | { readonly visibility: "sealed"; readonly castCount: number }
    | { readonly visibility: "open"; readonly casts: readonly BallotCast[] }
  );

type BallotsPanelProps = {
  readonly ballots: readonly BallotPanelItem[];
  readonly round: number;
  readonly onCast?: (ballotId: string) => void;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * Votes and auction bids.
 *
 * A ballot is time-limited and therefore exactly the kind of thing §8.5 says must
 * be visible without covering the board: the panel badges it, the row states its
 * deadline in rounds, and the cast control sits in the row. No modal, no scrim,
 * no focus steal — the board stays readable while the table decides.
 */
export function BallotsPanel({ ballots, round, onCast, scope, chrome }: BallotsPanelProps) {
  const definition = PANEL_DEFINITIONS.ballots;

  return (
    <Panel
      attention={ballotsAttention(ballots)}
      chrome={chrome}
      footer={
        <PanelNote>
          A sealed ballot reveals every cast at once when it closes. Nothing is
          visible in flight, including who has already answered.
        </PanelNote>
      }
      meta={ballots.length === 0 ? undefined : pluralise(ballots.length, "ballot")}
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {ballots.length === 0 ? (
        <PanelEmpty
          detail="Votes and auction bids are collected here with the round each one closes on. An open ballot shows every cast as it lands; a sealed one shows only that it is running."
          headline="No ballot open"
          summary={definition.summary}
        />
      ) : (
        <PanelList label="Ballots">
          {ballots.map((ballot) => (
            <PanelRow
              actions={
                onCast === undefined ? undefined : (
                  <button
                    className="panel-btn"
                    data-slot="panel-ballot-cast"
                    disabled={!ballot.youMayCast}
                    onClick={() => onCast(ballot.id)}
                    type="button"
                  >
                    {ballot.yourCast === null ? "Cast" : "Change"}
                  </button>
                )
              }
              facts={factsFor(ballot)}
              key={ballot.id}
              note={castsLine(ballot)}
              slot="panel-ballot-row"
              stamps={
                <>
                  <PanelStamp>{ballot.kind === "vote" ? "Vote" : "Auction"}</PanelStamp>
                  {ballot.visibility === "sealed" ? (
                    <PanelStamp tone="caution">Sealed</PanelStamp>
                  ) : null}
                </>
              }
              state={ballot.youMayCast && ballot.yourCast === null ? "active" : "default"}
              title={ballot.subject}
              trailing={
                <PanelDeadline
                  phrasing="closes"
                  round={round}
                  slot="panel-ballot-closes"
                  targetRound={ballot.closesAtRound}
                />
              }
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}

/**
 * Who has answered — or, for a sealed ballot, how many have, which is all a
 * sealed ballot is allowed to say.
 */
function castsLine(ballot: BallotPanelItem): string {
  if (ballot.visibility === "sealed") {
    return `${pluralise(ballot.castCount, "cast")} of ${ballot.audienceCount} in, all hidden until close.`;
  }
  if (ballot.casts.length === 0) return "Nobody has answered yet.";
  return ballot.casts.map((cast) => `${cast.name}: ${cast.value}`).join(" · ");
}

function factsFor(ballot: BallotPanelItem): readonly string[] {
  const yours = ballot.yourCast === null ? "You have not cast" : `You cast ${ballot.yourCast}`;
  return [yours, pluralise(ballot.audienceCount, "voter")];
}

/** Ballots the viewer may still answer. Exported so a tab can carry the badge. */
export function ballotsAttention(
  ballots: readonly BallotPanelItem[],
): PanelAttention | null {
  const open = ballots.filter((ballot) => ballot.youMayCast && ballot.yourCast === null).length;
  if (open === 0) return null;
  return {
    count: open,
    summary: `${pluralise(open, "ballot")} still waiting on your cast.`,
  };
}
