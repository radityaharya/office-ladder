import { cn } from "../../../lib/utils";

import { BoardTile, type BoardGridPosition } from "./board-tile";
import type {
  BoardIncidentView,
  BoardSpaceView,
  CornerCoordinate,
  PlayerTokenView,
} from "./types";

const cornerGrid = {
  "top-left": { gridColumn: 1, gridRow: 1 },
  "top-right": { gridColumn: 12, gridRow: 1 },
  "bottom-left": { gridColumn: 1, gridRow: 12 },
  "bottom-right": { gridColumn: 12, gridRow: 12 },
} as const satisfies Record<CornerCoordinate, BoardGridPosition>;

function gridPosition(space: BoardSpaceView): BoardGridPosition {
  if (space.placement === "corner") return cornerGrid[space.coordinate];

  switch (space.side) {
    case "bottom":
      return { gridColumn: space.coordinate + 1, gridRow: 12 };
    case "left":
      return { gridColumn: 1, gridRow: space.coordinate + 1 };
    case "top":
      return { gridColumn: 12 - space.coordinate, gridRow: 1 };
    case "right":
      return { gridColumn: 12, gridRow: 12 - space.coordinate };
    default:
      return space.side satisfies never;
  }
}

type GameBoardProps = {
  readonly spaces: readonly BoardSpaceView[];
  readonly players?: readonly PlayerTokenView[];
  readonly activeTile?: number | null;
  readonly incident: BoardIncidentView;
  readonly label?: string;
  readonly className?: string;
};

export function GameBoard({
  spaces,
  players = [],
  activeTile = null,
  incident,
  label = "Deadline Dash board",
  className,
}: GameBoardProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        "w-full overflow-auto rounded-md border border-border bg-background p-2 [scrollbar-gutter:stable]",
        className,
      )}
    >
      <div className="grid aspect-square min-w-144 max-w-224 grid-cols-12 grid-rows-12 gap-1 bg-muted/30 p-1">
        <ol className="contents" aria-label={`${label}, ${spaces.length} spaces`}>
          {spaces.map((space) => (
            <BoardTile
              active={activeTile === space.index}
              gridStyle={gridPosition(space)}
              key={space.id}
              players={players.filter((player) => player.position === space.index)}
              space={space}
              totalSpaces={spaces.length}
            />
          ))}
        </ol>
        <BoardIncident incident={incident} />
      </div>
    </section>
  );
}

function BoardIncident({ incident }: { readonly incident: BoardIncidentView }) {
  return (
    <div
      className="col-start-2 col-end-12 row-start-2 row-end-12 flex items-center justify-center border border-border bg-card p-6 text-center"
      data-slot="board-incident"
    >
      <div className="max-w-md">
        {incident.status ? (
          <p className="font-sans text-xs font-semibold tracking-widest text-primary uppercase">
            {incident.status}
          </p>
        ) : null}
        <h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl">
          {incident.title}
        </h2>
        {incident.description ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {incident.description}
          </p>
        ) : null}
        {incident.detail ? <div className="mt-4">{incident.detail}</div> : null}
      </div>
    </div>
  );
}
