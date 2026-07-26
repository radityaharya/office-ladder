import { Panel, type PanelChrome } from "./panel";
import {
  formatPanelMoneyProgress,
  formatPanelProgress,
  pluralise,
} from "./panel-format";
import {
  PanelEmpty,
  PanelList,
  PanelMeter,
  PanelNote,
  PanelRow,
  PanelStamp,
} from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";
import { PanelDeadline } from "./panel-semantics";

export type ProjectPanelStatus = "open" | "funded" | "completed" | "failed";

/** Sabotage the office has REVEALED. See the note on {@link ProjectPanelItem}. */
export type RevealedSabotage = {
  readonly seat: number | null;
  readonly name: string;
  readonly amount: number;
};

/**
 * A project on the floor.
 *
 * **There is deliberately no field for hidden sabotage — not even a count.** Spec
 * §5.2 says hidden sabotage "is revealed only on resolution", so before that
 * moment its existence is not projectable either: a "1 hidden sabotage" badge
 * would tell the lead exactly what the mechanic exists to withhold. Revealed
 * entries arrive in `revealedSabotage` at resolution and not before, and a later
 * wave that wants to show suspicion has to add a field here and argue for it.
 */
export type ProjectPanelItem = {
  readonly id: string;
  readonly title: string;
  readonly leadName: string;
  readonly leadSeat: number | null;
  readonly status: ProjectPanelStatus;
  readonly money: { readonly committed: number; readonly required: number };
  readonly work: { readonly committed: number; readonly required: number };
  readonly deadlineRound: number;
  readonly contributorCount: number;
  readonly openToJoin: boolean;
  /** Your own committed money, so you can tell your stake from the pool's. */
  readonly yourMoney: number;
  readonly revealedSabotage: readonly RevealedSabotage[];
};

type ProjectsPanelProps = {
  readonly projects: readonly ProjectPanelItem[];
  readonly round: number;
  readonly onContribute?: (projectId: string) => void;
  readonly onSabotage?: (projectId: string) => void;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * Projects — the centrepiece mechanic, and therefore the panel that has to be
 * readable at a glance.
 *
 * A project is four facts and a clock: what it needs, how close it is, who is in
 * it, and when it dies. Both meters are rendered with their numbers beside them
 * (§6.4) because a bar alone cannot tell a player whether one more contribution
 * finishes it.
 */
export function ProjectsPanel({
  projects,
  round,
  onContribute,
  onSabotage,
  scope,
  chrome,
}: ProjectsPanelProps) {
  const definition = PANEL_DEFINITIONS.projects;
  const live = projects.filter(
    (project) => project.status === "open" || project.status === "funded",
  );

  return (
    <Panel
      chrome={chrome}
      footer={
        <PanelNote>
          Contributors share a completed project's payout pro rata; the lead takes
          a bonus. A failed project pays nobody.
        </PanelNote>
      }
      meta={projects.length === 0 ? undefined : `${live.length} live · ${projects.length} all`}
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {projects.length === 0 ? (
        <PanelEmpty
          detail="Whoever starts a project names the money and work it needs and a deadline. Anyone may fund it for a share of the payout, and anyone may quietly sabotage it before the deadline — sabotage stays hidden until the project resolves."
          headline="No projects on the floor"
          summary={definition.summary}
        />
      ) : (
        <PanelList label="Projects">
          {projects.map((project) => (
            <PanelRow
              actions={
                onContribute === undefined && onSabotage === undefined ? undefined : (
                  <>
                    {onContribute === undefined ? null : (
                      <button
                        className="panel-btn"
                        data-slot="panel-project-contribute"
                        disabled={project.status !== "open" && project.status !== "funded"}
                        onClick={() => onContribute(project.id)}
                        type="button"
                      >
                        Contribute
                      </button>
                    )}
                    {onSabotage === undefined ? null : (
                      <button
                        className="panel-btn"
                        data-slot="panel-project-sabotage"
                        disabled={project.status !== "open" && project.status !== "funded"}
                        onClick={() => onSabotage(project.id)}
                        type="button"
                      >
                        Sabotage
                      </button>
                    )}
                  </>
                )
              }
              facts={factsFor(project)}
              key={project.id}
              note={
                project.revealedSabotage.length === 0
                  ? undefined
                  : `Sabotaged by ${project.revealedSabotage
                      .map((entry) => entry.name)
                      .join(", ")}.`
              }
              seat={project.leadSeat}
              slot="panel-project-row"
              stamps={
                <>
                  <PanelStamp tone={statusTone(project.status)}>
                    {statusLabel(project.status)}
                  </PanelStamp>
                  {project.openToJoin ? <PanelStamp>Open</PanelStamp> : null}
                </>
              }
              title={project.title}
              trailing={
                <PanelDeadline
                  phrasing="due"
                  round={round}
                  slot="panel-project-deadline"
                  targetRound={project.deadlineRound}
                />
              }
            >
              <PanelMeter
                label="Cash"
                max={project.money.required}
                value={project.money.committed}
                valueText={formatPanelMoneyProgress(
                  project.money.committed,
                  project.money.required,
                )}
              />
              <PanelMeter
                label="Work"
                max={project.work.required}
                value={project.work.committed}
                valueText={formatPanelProgress(project.work.committed, project.work.required)}
              />
            </PanelRow>
          ))}
        </PanelList>
      )}
    </Panel>
  );
}

function factsFor(project: ProjectPanelItem): readonly string[] {
  return [
    `Lead ${project.leadName}`,
    pluralise(project.contributorCount, "backer"),
    `Your stake $${project.yourMoney.toLocaleString("en-US")}`,
  ];
}

function statusLabel(status: ProjectPanelStatus): string {
  if (status === "open") return "Open";
  if (status === "funded") return "Funded";
  if (status === "completed") return "Done";
  return "Failed";
}

function statusTone(status: ProjectPanelStatus): "neutral" | "accent" | "caution" | "critical" {
  if (status === "funded") return "accent";
  if (status === "failed") return "critical";
  if (status === "open") return "caution";
  return "neutral";
}
