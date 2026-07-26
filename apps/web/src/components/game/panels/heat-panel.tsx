import { Panel, type PanelAttention, type PanelChrome } from "./panel";
import { formatPanelNumber, formatPanelProgress, pluralise } from "./panel-format";
import {
  PanelDef,
  PanelDefs,
  PanelEmpty,
  PanelList,
  PanelMeter,
  PanelNote,
  PanelRow,
  PanelStamp,
} from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

/** The viewer's own heat. */
export type HeatSelfReadout = {
  readonly value: number;
  readonly threshold: number;
  readonly investigationsOpened: number;
  readonly lastIncrementedAtRound: number | null;
};

/**
 * Another seat's heat.
 *
 * Public on purpose, and this is a design decision rather than an oversight: heat
 * exists to make aggression cost the aggressor (spec §5.4), and a deterrent
 * nobody can see deters nobody. There is nothing to redact here.
 */
export type HeatSeatReadout = {
  readonly seat: number;
  readonly name: string;
  readonly value: number;
  readonly threshold: number;
  readonly underInvestigation: boolean;
};

type HeatPanelProps = {
  /** Null when `conflict.heatEnabled` is off for this mode. */
  readonly self: HeatSelfReadout | null;
  readonly seats: readonly HeatSeatReadout[];
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * Heat — the aggression cost.
 *
 * The one panel that is a READOUT rather than a list, which is why the primitive
 * has to size to content as well as fill: a single meter plus three numbers in a
 * panel stretched to 400px of rail is empty space pretending to be data.
 * `sizing="content"` is that case, and `scrollBody={false}` keeps it from being a
 * spurious tab stop.
 *
 * When heat is switched off by the mode, the panel says so and explains what it
 * would do — a destination that renders nothing teaches a player nothing about
 * why their attack was free.
 */
export function HeatPanel({ self, seats, scope, chrome }: HeatPanelProps) {
  const definition = PANEL_DEFINITIONS.heat;

  if (self === null) {
    return (
      <Panel
        chrome={chrome}
        panelId={definition.id}
        scope={scope}
        scrollBody={false}
        sizing="content"
        title={definition.title}
      >
        <PanelEmpty
          detail="When it is on, every attack you make raises your heat, and crossing the threshold opens an HR investigation against you — not against the player you hit."
          headline="Heat is off in this mode"
          summary={definition.summary}
        />
      </Panel>
    );
  }

  const over = self.value >= self.threshold;

  return (
    <Panel
      attention={heatAttention(self)}
      chrome={chrome}
      footer={
        <PanelNote tone={over ? "critical" : "idle"}>
          Crossing the threshold opens an investigation against you, not against
          whoever you hit.
        </PanelNote>
      }
      meta={formatPanelProgress(self.value, self.threshold)}
      panelId={definition.id}
      scope={scope}
      sizing="content"
      title={definition.title}
    >
      <PanelDefs label="Your heat">
        <PanelDef
          hint={over ? "At or over threshold" : "Below threshold"}
          label="Heat"
          value={formatPanelNumber(self.value)}
        />
        <PanelDef label="Threshold" value={formatPanelNumber(self.threshold)} />
        <PanelDef
          label="Investigations"
          value={formatPanelNumber(self.investigationsOpened)}
        />
        <PanelDef
          label="Last raised"
          value={
            self.lastIncrementedAtRound === null
              ? "Never"
              : `Round ${formatPanelNumber(self.lastIncrementedAtRound)}`
          }
        />
      </PanelDefs>
      <div className="panel-block" data-slot="panel-heat-meter">
        <PanelMeter
          ceiling
          label="Suspicion"
          max={self.threshold}
          value={self.value}
          valueText={formatPanelProgress(self.value, self.threshold)}
        />
      </div>
      {seats.length === 0 ? null : (
        <PanelList label="Heat by seat">
          {seats.map((seat) => (
            <PanelRow
              facts={[formatPanelProgress(seat.value, seat.threshold)]}
              key={seat.seat}
              seat={seat.seat}
              slot="panel-heat-row"
              stamps={
                seat.underInvestigation ? (
                  <PanelStamp tone="critical">Under review</PanelStamp>
                ) : null
              }
              title={seat.name}
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}

/** Badges the viewer's own heat once it reaches the threshold. */
export function heatAttention(self: HeatSelfReadout | null): PanelAttention | null {
  if (self === null) return null;
  if (self.value < self.threshold) return null;
  return {
    count: self.investigationsOpened > 0 ? self.investigationsOpened : 1,
    summary:
      self.investigationsOpened > 0
        ? `${pluralise(self.investigationsOpened, "investigation")} open against you.`
        : "Your heat has reached the threshold.",
  };
}
