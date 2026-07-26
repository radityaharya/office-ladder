import { useId, useMemo } from "react";

import { cn } from "../../../lib/utils";

import { BoardTile, placementMark } from "./board-tile";
import { PlayerToken } from "./player-token";
import type {
  BoardCell,
  BoardDockSlot,
  BoardIncidentView,
  BoardPlacementView,
  BoardSpaceView,
  BoardTileOwnershipView,
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
/** `[face 14][seat 12]` plus the plate's 2px of border. */
const dockFacePlateWidth = 28;
/** `[seat 12][BOT 24 + 1px seam]` plus the plate's 2px of border. A bot has no
 *  face cell, so this width is unchanged from before photos existed — which is
 *  what keeps two bots on one space fitting a ~97px cell. */
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
  /**
   * Claimed tiles, from `GameplayProjection.tileOwnership` (spec §5.1). Passing
   * the array — even empty — is what tells the board this is a territory match.
   */
  readonly ownership?: readonly BoardTileOwnershipView[];
  /**
   * Placements this viewer may see: `gameplay.placements` (public) merged with
   * `gameplay.self.ownPlacements` (the viewer's own, including `owner-only`).
   *
   * The board renders what it is handed and redacts nothing, because the
   * projection already did — another player's `owner-only` placement is absent
   * from this viewer's payload entirely, and re-deriving it here to hide it again
   * would put it back in the DOM (spec §7.2, §12.4). Do not.
   */
  readonly placements?: readonly BoardPlacementView[];
  /**
   * Force the per-tile territory gutter on or off.
   *
   * Defaults to "on when either collection was supplied", which is the mode's own
   * shape rather than the state of play — the gutter must be reserved from the
   * first render of the match, or the first claim reflows the room name on all 44
   * tiles. Pass it explicitly from `gameplay.rules` when a ruleset allows
   * claiming but nothing has been claimed yet.
   */
  readonly territory?: boolean;
  readonly label?: string;
  readonly className?: string;
};

export function GameBoard({
  spaces,
  players = [],
  activeTile = null,
  landedTile = null,
  incident,
  ownership,
  placements,
  territory,
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

  // Shared board state, indexed by the content tile id the caller already keys
  // it by, so no space has to be looked up by position in a list per render.
  const ownershipByTile = useMemo(
    () => new Map((ownership ?? []).map((entry) => [entry.tileId, entry])),
    [ownership],
  );
  const placementsByTile = useMemo(() => groupByTile(placements ?? []), [placements]);
  const showTerritory = territory ?? (ownership !== undefined || placements !== undefined);

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
        {/*
         * `data-board-territory` reserves the per-tile gutter for the WHOLE match
         * (see board.css). It is set from the mode's shape, never from whether
         * anything has been claimed yet — a reservation that arrives with the
         * first claim would reflow every room name on the ring at once, which is
         * the "nothing that appears may move the board" rule applied one level
         * down.
         */}
        <div className="board-grid" data-board-territory={showTerritory ? "true" : undefined}>
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
                ownership={ownershipByTile.get(space.id) ?? null}
                placements={placementsByTile.get(space.id) ?? []}
                players={occupancy.get(space.index) ?? []}
                space={space}
                territory={showTerritory}
                totalSpaces={spaces.length}
              />
            ))}
          </ol>
          <BoardPlate
            activeTile={activeTile}
            incident={incident}
            ownership={ownership ?? []}
            placements={placements ?? []}
            spaces={spaces}
            territory={showTerritory}
          />
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
  ownership,
  placements,
  spaces,
  territory,
}: {
  readonly activeTile: number | null;
  readonly incident: BoardIncidentView;
  readonly ownership: readonly BoardTileOwnershipView[];
  readonly placements: readonly BoardPlacementView[];
  readonly spaces: readonly BoardSpaceView[];
  readonly territory: boolean;
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
        {/* One column of keys, always rendered so the plate's wide two-column
            layout does not depend on how many keys there happen to be. */}
        <div className="board-plate-keys" data-slot="board-plate-keys">
          <BoardLegend spaces={spaces} />
          {territory ? (
            <BoardTerritoryKey ownership={ownership} placements={placements} />
          ) : null}
        </div>
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

/**
 * What the marks in each tile's territory gutter mean, and how much of the ring
 * is currently claimed.
 *
 * This is what makes a one-letter mark on a 97px tile legible rather than a
 * private code: the gutter compresses, and the key expands. It doubles as the
 * spec's §12.5 empty state — before anyone has claimed anything it still says
 * what claiming is and what will appear — so a territory match teaches its own
 * shared-state vocabulary instead of assuming it.
 */
function BoardTerritoryKey({
  ownership,
  placements,
}: {
  readonly ownership: readonly BoardTileOwnershipView[];
  readonly placements: readonly BoardPlacementView[];
}) {
  const kinds = new Map<string, { readonly mark: string; readonly label: string; count: number }>();
  for (const placement of placements) {
    const entry = kinds.get(placement.kind);
    if (entry) {
      entry.count += 1;
      continue;
    }
    kinds.set(placement.kind, { ...placementMark(placement), count: 1 });
  }

  const ownedByYou = ownership.filter((entry) => entry.isSelf).length;

  return (
    <div className="board-legend" data-slot="board-territory-key">
      <p className="board-legend-head">Territory key</p>
      {ownership.length === 0 && placements.length === 0 ? (
        <p className="board-territory-empty">
          Claimed spaces carry their owner&apos;s seat number and a coloured edge.
          Anything placed on a space is marked beside it. Nothing is claimed yet.
        </p>
      ) : (
        <dl className="board-legend-list">
          <div className="board-legend-item">
            <dt className="board-legend-term">
              <span className="board-legend-name">Claimed</span>
            </dt>
            <dd className="board-legend-count">{ownership.length}</dd>
          </div>
          <div className="board-legend-item">
            <dt className="board-legend-term">
              <span className="board-legend-name">Yours</span>
            </dt>
            <dd className="board-legend-count">{ownedByYou}</dd>
          </div>
          {[...kinds].map(([kind, entry]) => (
            <div className="board-legend-item" key={kind}>
              <dt className="board-legend-term">
                <span aria-hidden="true" className="board-tile-mark" data-board-mark={entry.mark}>
                  {entry.mark}
                </span>
                <span className="board-legend-name">{entry.label}</span>
              </dt>
              <dd className="board-legend-count">{entry.count}</dd>
            </div>
          ))}
        </dl>
      )}
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

function groupByTile(
  placements: readonly BoardPlacementView[],
): ReadonlyMap<string, readonly BoardPlacementView[]> {
  const grouped = new Map<string, BoardPlacementView[]>();
  for (const placement of placements) {
    const bucket = grouped.get(placement.tileId);
    if (bucket) {
      bucket.push(placement);
      continue;
    }
    grouped.set(placement.tileId, [placement]);
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
      offset += plateWidth(player, density) + dockSeam;
    }
  }

  return slots;
}

/**
 * How much dock a plate occupies, which is exactly what it renders (see
 * `PlayerToken`): a compact plate is the seat glyph alone, a bot's full plate is
 * the seat glyph plus its `BOT` tag, and a human's full plate is their 14px face
 * plus the seat glyph.
 *
 * Worst cases at `dockFullMax = 2`, against ~93px of usable dock in a ~97px cell:
 * two faced humans 57px, a human beside a bot 68px, two bots 79px.
 */
function plateWidth(player: PlayerTokenView, density: BoardDockSlot["density"]): number {
  if (density !== "full") return dockPlateWidth;

  return player.isBot ? dockBotPlateWidth : dockFacePlateWidth;
}
