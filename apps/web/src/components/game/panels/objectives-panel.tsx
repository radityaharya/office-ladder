import { Panel, type PanelChrome } from "./panel";
import { formatPanelMoney, formatPanelProgress, pluralise } from "./panel-format";
import {
  PanelEmpty,
  PanelList,
  PanelMeter,
  PanelNote,
  PanelRow,
  PanelStamp,
} from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

/**
 * An objective the viewer may read in full — their own (secret or not) or a
 * table-wide public one.
 */
export type VisibleObjective = {
  readonly kind: "visible";
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly progress: number;
  readonly target: number;
  readonly rewardPoints: number;
  readonly rewardMoney: number;
  /** Null for a table-wide objective. */
  readonly ownerName: string | null;
  readonly ownerSeat: number | null;
  readonly completedAtRound: number | null;
  /** True when this is the viewer's own secret objective. */
  readonly secret: boolean;
};

/**
 * Someone ELSE's secret objective — existence only.
 *
 * Spec §7.2: "Secret objectives project as existence-only." This member of the
 * union has no title, no detail, no progress, no target and no reward, so the
 * panel cannot describe it even by accident. Knowing that an opponent is chasing
 * *something* is the intended amount of information: it justifies suspicion
 * without handing over the answer.
 */
export type ConcealedObjective = {
  readonly kind: "concealed";
  readonly id: string;
  readonly ownerName: string;
  readonly ownerSeat: number | null;
};

export type ObjectivePanelItem = VisibleObjective | ConcealedObjective;

type ObjectivesPanelProps = {
  readonly objectives: readonly ObjectivePanelItem[];
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * Objectives and the non-promotion win paths.
 *
 * Two row shapes, because there are two kinds of fact: an objective you can read
 * (progress meter, reward, target) and an objective you can only know exists. The
 * second is not a greyed-out version of the first — it is a different row, from a
 * different member of the union, and it carries no redactable content at all.
 */
export function ObjectivesPanel({ objectives, scope, chrome }: ObjectivesPanelProps) {
  const definition = PANEL_DEFINITIONS.objectives;
  const visible = objectives.filter(
    (objective): objective is VisibleObjective => objective.kind === "visible",
  );
  const done = visible.filter((objective) => objective.completedAtRound !== null).length;

  return (
    <Panel
      chrome={chrome}
      footer={
        <PanelNote>
          Objectives score alongside rank and cash at the end of the match. Another
          seat&apos;s secret objective shows only that they hold one.
        </PanelNote>
      }
      meta={
        objectives.length === 0 ? undefined : `${done}/${visible.length} done · ${objectives.length} tracked`
      }
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {objectives.length === 0 ? (
        <PanelEmpty
          detail="Objectives are the scoring targets outside the promotion ladder. Yours show their progress and their reward; another seat's secret objective shows only that it exists."
          headline="No objectives assigned"
          summary={definition.summary}
        />
      ) : (
        <PanelList label="Objectives">
          {objectives.map((objective) =>
            objective.kind === "concealed" ? (
              <PanelRow
                key={objective.id}
                note="Held in confidence. The office will not say what it is until it is scored."
                origin="remote"
                seat={objective.ownerSeat}
                slot="panel-objective-concealed"
                stamps={<PanelStamp tone="caution">Sealed</PanelStamp>}
                title={`${objective.ownerName} holds a secret objective`}
              />
            ) : (
              <PanelRow
                facts={factsFor(objective)}
                key={objective.id}
                note={objective.detail}
                origin={objective.ownerName === null ? "system" : "local"}
                seat={objective.ownerSeat}
                slot="panel-objective-row"
                stamps={
                  <>
                    {objective.secret ? <PanelStamp>Yours only</PanelStamp> : null}
                    {objective.completedAtRound === null ? null : (
                      <PanelStamp tone="accent">Complete</PanelStamp>
                    )}
                  </>
                }
                title={objective.title}
              >
                <PanelMeter
                  label="Progress"
                  max={objective.target}
                  value={objective.progress}
                  valueText={formatPanelProgress(objective.progress, objective.target)}
                />
              </PanelRow>
            ),
          )}
        </PanelList>
      )}
    </Panel>
  );
}

function factsFor(objective: VisibleObjective): readonly string[] {
  const facts = [
    objective.ownerName === null ? "Table-wide" : objective.ownerName,
    pluralise(objective.rewardPoints, "point"),
  ];
  if (objective.rewardMoney !== 0) facts.push(formatPanelMoney(objective.rewardMoney));
  return facts;
}
