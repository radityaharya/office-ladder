import type { BoardCell, BoardSpaceView, PlayerTokenView } from "./types";

type BoardTileProps = {
  readonly space: BoardSpaceView;
  readonly cell: BoardCell;
  readonly players: readonly PlayerTokenView[];
  readonly active: boolean;
  readonly landed: boolean;
  readonly totalSpaces: number;
};

export function BoardTile({
  space,
  cell,
  players,
  active,
  landed,
  totalSpaces,
}: BoardTileProps) {
  return (
    <li
      aria-label={tileLabel({ space, players, active, landed, totalSpaces })}
      className="board-tile"
      data-board-active={active ? "true" : undefined}
      data-board-code={space.code}
      data-board-inactive={space.inactive ? "true" : undefined}
      data-board-index={space.index}
      data-board-kind={space.kindId}
      data-board-landed={landed ? "true" : undefined}
      data-board-occupants={players.length > 0 ? players.length : undefined}
      data-board-placement={space.placement}
      data-board-zone={space.zone}
      role="listitem"
      style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
    >
      <span aria-hidden="true" className="board-tile-rule" />
      {/*
       * The state tag lives in the head row, not at the tile's foot. The foot is
       * the occupancy dock's reserved band: with six seats standing on the
       * reception desk at kickoff, a tag down there is exactly what used to end
       * up printed underneath a rack of token plates.
       */}
      <span className="board-tile-head">
        <span className="board-tile-code">{space.code}</span>
        {active || landed ? (
          <span
            className="board-tile-tag"
            data-board-tag={active ? "active" : "landed"}
          >
            {active ? "Turn" : "Last"}
          </span>
        ) : null}
        <span className="board-tile-index">{formatSpace(space.index)}</span>
      </span>
      {/*
       * Both label forms ship in the markup and a container query on the tile
       * picks one, so a narrow cell shortens to another whole word instead of
       * hyphenating "Operati/on" or ellipsising "Best em…". Below a code-only
       * cell width neither is shown — the facility code carries it, and the full
       * name is always in the tile's accessible name.
       */}
      <span className="board-tile-name">
        <span className="board-tile-name-full">{space.label}</span>
        <span className="board-tile-name-short">{space.shortLabel ?? space.label}</span>
      </span>
    </li>
  );
}

function tileLabel({
  space,
  players,
  active,
  landed,
  totalSpaces,
}: Omit<BoardTileProps, "cell">): string {
  const marks = [
    active ? "active space" : null,
    landed ? "last landing" : null,
    space.inactive ? "closed" : null,
  ].filter((mark): mark is string => mark !== null);

  return [
    `Space ${formatSpace(space.index)} of ${totalSpaces}`,
    space.label,
    `${space.zoneLabel} zone`,
    `code ${space.code}`,
    ...marks,
    occupantText(players),
  ].join(", ");
}

function occupantText(players: readonly PlayerTokenView[]): string {
  if (players.length === 0) return "unoccupied";

  const names = players.map(
    (player) => `${player.name} (seat ${player.seat}${player.isBot ? ", bot" : ""})`,
  );
  if (names.length === 1) return `occupied by ${names[0]}`;

  return `occupied by ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function formatSpace(index: number): string {
  return String(index + 1).padStart(2, "0");
}
