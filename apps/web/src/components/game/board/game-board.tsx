import { useId, useMemo } from "react";

import { cn } from "../../../lib/utils";

import { BoardTile } from "./board-tile";
import { PlayerToken } from "./player-token";
import type {
  BoardCell,
  BoardDockSlot,
  BoardIncidentView,
  BoardSpaceView,
  BoardZone,
  CornerCoordinate,
  PlayerTokenView,
} from "./types";
import { useBoardTravel } from "./use-board-travel";

/**
 * Zero-based cells on the 12x12 grid. A corner's axis is the axis of the side
 * that *follows* it, because that is the track a token leaves the corner along.
 */
const cornerCells = {
  "bottom-right": { col: 11, row: 11, axis: "horizontal" },
  "bottom-left": { col: 0, row: 11, axis: "vertical" },
  "top-left": { col: 0, row: 0, axis: "horizontal" },
  "top-right": { col: 11, row: 0, axis: "vertical" },
} as const satisfies Record<CornerCoordinate, BoardCell>;

/*
 * Occupancy dock geometry, in px, and it has to agree with `styles/board.css`.
 * A plate is 14px tall; a seat-only plate is 14px wide and a plate that also
 * carries its uppercase BOT tag is 39px. Groups larger than `dockFullMax` drop
 * to seat-only plates: six tagged plates would be 240px of dock inside a ~98px
 * cell, which is the "3BOT / 2BOT" pile this replaces. Six seat-only plates are
 * 89px and fit, so the whole starting line-up on the reception desk reads as
 * `1 2 3 4 5 6`.
 */
const dockPlateWidth = 14;
const dockBotPlateWidth = 39;
const dockSeam = 1;
const dockFullMax = 2;

export function boardCell(space: BoardSpaceView): BoardCell {
  if (space.placement === "corner") return cornerCells[space.coordinate];

  // Travel is clockwise from the Receptionist at bottom-right, so each side's
  // `coordinate` (1..10, ascending with board index since the board was
  // reordered to the workbook) has to map onto the direction that side is
  // actually walked: leftwards along the bottom, up the left, rightwards along
  // the top, down the right. Getting one of these backwards renders the ring
  // counter-clockwise and makes a token appear to jump the length of an edge
  // every time it passes a corner — which is exactly what shipped before.
  switch (space.side) {
    case "bottom":
      return { col: 11 - space.coordinate, row: 11, axis: "horizontal" };
    case "left":
      return { col: 0, row: 11 - space.coordinate, axis: "vertical" };
    case "top":
      return { col: space.coordinate, row: 0, axis: "horizontal" };
    case "right":
      return { col: 11, row: space.coordinate, axis: "vertical" };
    default:
      return space.side satisfies never;
  }
}

type GameBoardProps = {
  readonly spaces: readonly BoardSpaceView[];
  readonly players?: readonly PlayerTokenView[];
  /** Space the active player is standing on — the view's single accent spend. */
  readonly activeTile?: number | null;
  /** Space the previous mover landed on, marked with a neutral frame. */
  readonly landedTile?: number | null;
  readonly incident: BoardIncidentView;
  readonly label?: string;
  readonly className?: string;
};

export function GameBoard({
  spaces,
  players = [],
  activeTile = null,
  landedTile = null,
  incident,
  label = "Deadline Dash board",
  className,
}: GameBoardProps) {
  const panInstructionsId = useId();
  const seated = useMemo(
    () => [...players].sort((left, right) => left.seat - right.seat),
    [players],
  );
  const cells = useMemo(
    () => new Map(spaces.map((space) => [space.index, boardCell(space)])),
    [spaces],
  );

  const travel = useBoardTravel({ players: seated, spaceCount: spaces.length });

  // Occupancy — and both the tile's accessible name and the dock read it from
  // the PROJECTION, never from where a token happens to be drawn mid-hop. Slot a
  // traveller by the tile it is passing over and every resting plate on that
  // tile re-slots for 140ms as it goes by, which is churn, not information.
  // Keying on truth means a plate only ever moves when occupancy really changed,
  // and a travelling token lands directly into the slot it already occupies.
  const occupancy = groupByPosition(seated, (player) => player.position);
  const docks = dockSlots(occupancy);

  return (
    <section
      aria-describedby={panInstructionsId}
      aria-label={label}
      className={cn("board-viewport", className)}
      data-slot="board-viewport"
      tabIndex={0}
    >
      <p className="sr-only" data-slot="board-pan-instructions" id={panInstructionsId}>
        Swipe or use arrow keys to pan the floor plan if it does not fully fit the
        screen. Travel runs clockwise from the reception desk.
      </p>
      <div className="board-frame" data-slot="board-frame">
        <div className="board-grid">
          <ol
            aria-label={`${label}, ${spaces.length} spaces`}
            className="board-track"
            role="list"
          >
            {spaces.map((space) => (
              <BoardTile
                active={activeTile === space.index}
                cell={boardCell(space)}
                key={space.id}
                landed={landedTile === space.index}
                players={occupancy.get(space.index) ?? []}
                space={space}
                totalSpaces={spaces.length}
              />
            ))}
          </ol>
          <BoardPlate activeTile={activeTile} incident={incident} spaces={spaces} />
          {/*
           * The tokens are `m.*` components (motion/react-m) and therefore need a
           * `LazyMotion` ancestor to animate at all. That provider is mounted ONCE
           * for the whole match, in the game route (`routes/rooms.$roomId.game.tsx`),
           * because the board is not the only `m.*` consumer any more — the dice
           * readout, the card notice, the prompt dialog and the activity log all
           * are. One provider is the whole point of `m`: a second scoped one here
           * would just be dead weight, and mixing `m` with full `motion` anywhere
           * in the tree defeats the tree-shaking it buys.
           */}
          <ul
            aria-label="Seat positions"
            className="board-token-layer"
            data-board-travelling={travel.isTravelling ? "true" : undefined}
            role="list"
          >
            {seated.map((player) => {
              const cell = cells.get(player.position);
              if (!cell) return null;

              const drawnPosition = travel.renderPosition(player.id);
              return (
                <PlayerToken
                  arrival={travel.isReduced ? 0 : travel.arrival(player.id)}
                  cell={cell}
                  dock={docks.get(player.id)}
                  key={player.id}
                  player={player}
                  renderCell={
                    drawnPosition === null ? cell : (cells.get(drawnPosition) ?? cell)
                  }
                  step={travel.travelStep(player.id)}
                />
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * The ring's interior. Once the frame stops being a forced square this is a wide
 * panel rather than a 506px box holding one paragraph, so it is laid out on a
 * real grid: a head bar, a two-column body (status on the left, the zone key as
 * a proper table on the right), and a full-width readout rail whose cells align
 * to the panel's own edges (DESIGN.md §4.5, §6.3, §6.4). It collapses back to a
 * single column on a narrow board through a container query, not a breakpoint,
 * because what matters is the panel's width and not the viewport's.
 */
function BoardPlate({
  activeTile,
  incident,
  spaces,
}: {
  readonly activeTile: number | null;
  readonly incident: BoardIncidentView;
  readonly spaces: readonly BoardSpaceView[];
}) {
  return (
    <section
      aria-label="Floor plan status"
      className="board-plate terminal-grid"
      data-slot="board-incident"
    >
      <div className="board-plate-head">
        <p className="board-plate-kicker">{incident.status ?? "Floor plan"}</p>
        <p className="board-plate-ref">{spaces.length} spaces · clockwise</p>
      </div>
      <div className="board-plate-main">
        <div className="board-plate-body">
          {incident.marker ? (
            <p className="board-plate-marker" data-board-tone={incident.marker.tone}>
              <span aria-hidden="true" className="board-plate-led" />
              {incident.marker.label}
            </p>
          ) : null}
          <h2 className="board-plate-title">{incident.title}</h2>
          {incident.description ? (
            <p className="board-plate-copy">{incident.description}</p>
          ) : null}
          <BoardReach activeTile={activeTile} spaces={spaces} />
          {incident.detail ? (
            <div className="board-plate-detail">{incident.detail}</div>
          ) : null}
        </div>
        <BoardLegend spaces={spaces} />
      </div>
      {incident.readouts && incident.readouts.length > 0 ? (
        <dl className="board-plate-readouts">
          {incident.readouts.map((readout) => (
            <div className="board-plate-readout" key={readout.label}>
              <dt className="board-plate-readout-label">{readout.label}</dt>
              <dd className="board-plate-readout-value">{readout.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

/**
 * What each face of the movement die lands on from where the active player is
 * standing. This is the one thing the ring's interior can say that nothing else
 * in the shell says: it is derived entirely from the authored board and the
 * projected position — no rule and no projection field is being invented — and it
 * is the difference between watching a token move and being able to follow why.
 * It is descriptive, never a control: legality still comes from the server.
 */
function BoardReach({
  activeTile,
  spaces,
}: {
  readonly activeTile: number | null;
  readonly spaces: readonly BoardSpaceView[];
}) {
  if (activeTile === null || spaces.length === 0) return null;

  const reach = Array.from({ length: 6 }, (_, offset) => offset + 1).flatMap((roll) => {
    const space = spaces.find(
      (candidate) => candidate.index === (activeTile + roll) % spaces.length,
    );

    return space ? [{ roll, space }] : [];
  });
  if (reach.length === 0) return null;

  return (
    <div className="board-reach" data-slot="board-reach">
      <p className="board-reach-head">
        Movement reach · one d6 clockwise from {formatSpace(activeTile)}
      </p>
      <ol className="board-reach-list">
        {reach.map(({ roll, space }) => (
          <li className="board-reach-item" key={roll}>
            <span className="board-reach-roll">{roll}</span>
            <span className="board-reach-code">{space.code}</span>
            <span className="board-reach-name">{space.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BoardLegend({ spaces }: { readonly spaces: readonly BoardSpaceView[] }) {
  const zones = new Map<BoardZone, { readonly label: string; count: number }>();
  for (const space of spaces) {
    const entry = zones.get(space.zone);
    if (entry) {
      entry.count += 1;
      continue;
    }
    zones.set(space.zone, { label: space.zoneLabel, count: 1 });
  }

  if (zones.size === 0) return null;

  return (
    <div className="board-legend" data-slot="board-legend">
      <p className="board-legend-head">Zone key</p>
      <dl className="board-legend-list">
        {[...zones].map(([zone, entry]) => (
          <div className="board-legend-item" key={zone}>
            <dt className="board-legend-term">
              <span
                aria-hidden="true"
                className="board-legend-swatch"
                data-board-zone={zone}
              />
              <span className="board-legend-name">{entry.label}</span>
            </dt>
            <dd className="board-legend-count">{entry.count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 1-based, zero-padded space number: index 6 renders as "07". */
function formatSpace(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function groupByPosition(
  players: readonly PlayerTokenView[],
  positionOf: (player: PlayerTokenView) => number,
): ReadonlyMap<number, readonly PlayerTokenView[]> {
  const grouped = new Map<number, PlayerTokenView[]>();
  for (const player of players) {
    const position = positionOf(player);
    const bucket = grouped.get(position);
    if (bucket) {
      bucket.push(player);
      continue;
    }
    grouped.set(position, [player]);
  }

  return grouped;
}

/**
 * Lays the tokens standing on one space out along that space's reserved bottom
 * band, left to right in seat order. One row only: the band is 14px of a ~50px
 * cell, so a second row would have to sit on top of the tile's own label, which
 * is the bug this replaces.
 */
function dockSlots(
  occupancy: ReadonlyMap<number, readonly PlayerTokenView[]>,
): ReadonlyMap<string, BoardDockSlot> {
  const slots = new Map<string, BoardDockSlot>();
  for (const group of occupancy.values()) {
    const density = group.length > dockFullMax ? "compact" : "full";
    let offset = 0;
    for (const player of group) {
      slots.set(player.id, { density, x: offset });
      offset +=
        (density === "full" && player.isBot ? dockBotPlateWidth : dockPlateWidth) +
        dockSeam;
    }
  }

  return slots;
}
