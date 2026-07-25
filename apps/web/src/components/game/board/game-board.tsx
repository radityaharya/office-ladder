import { useId } from "react";

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
  const panInstructionsId = useId();

  return (
    <section
      aria-describedby={panInstructionsId}
      aria-label={label}
      className={cn(
        "relative flex h-full max-h-full w-full max-w-full items-center justify-center overflow-auto outline-none [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      tabIndex={0}
    >
      <p className="sr-only" data-slot="board-pan-instructions" id={panInstructionsId}>
        Swipe or use arrow keys to pan the board if it does not fully fit the screen.
      </p>
      <div className="grid h-full max-h-full w-full max-w-full min-h-64 min-w-64 grid-cols-12 grid-rows-12 gap-0.5 rounded-lg border border-border bg-card p-1 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] sm:gap-1 sm:p-1.5">
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
      className="relative col-start-2 col-end-12 row-start-2 row-end-12 flex items-center justify-center overflow-hidden rounded-md border border-border bg-muted/10 p-6 text-center"
      data-slot="board-incident"
      style={{
        backgroundImage:
          "radial-gradient(color-mix(in oklch, var(--foreground) 6%, transparent) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <div className="relative w-full max-w-xl">
        {incident.status ? (
          <p className="font-sans text-xs font-semibold tracking-[0.15em] text-primary uppercase sm:text-sm">
            {incident.status}
          </p>
        ) : null}
        <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl">
          {incident.title}
        </h2>
        {incident.description ? (
          <p className="mt-4 font-mono text-xs leading-relaxed text-muted-foreground sm:text-base">
            {incident.description}
          </p>
        ) : null}
        {incident.detail ? <div className="mt-5">{incident.detail}</div> : null}
      </div>
    </div>
  );
}
