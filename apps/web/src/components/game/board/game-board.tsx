import { useId, useMemo } from "react";

import { cn } from "../../../lib/utils";

import { BoardTile, placementMark } from "./board-tile";
import { PlayerToken } from "./player-token";
import type {
  BoardCell,
  BoardDockSlot,
  BoardIncidentView,
  BoardPlacementView,
  BoardScheduleView,
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
            players={seated}
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
 * real grid: a head bar, an optional quarter strip, a two-column body (status on
 * the left, the keys as proper tables on the right), and a full-width readout
 * rail whose cells align to the panel's own edges (DESIGN.md §4.5, §6.3, §6.4).
 * It collapses back to a single column on a narrow board through a container
 * query, not a breakpoint, because what matters is the panel's width and not the
 * viewport's.
 *
 * WHAT LIVES HERE, AND WHY (measured in a live campaign match at 1698x913):
 * the interior is 1086.8 x 552.7px — 600,633px², 69.4% of the whole board's
 * area — and 44.1% of that was two contiguous blank blocks (254.7px below the
 * reach strip in the body column, 210.7px below the last key in the keys
 * column) with a total ink coverage of 22.6%. Three rules decided what got the
 * space back:
 *
 *  1. The ring stays the thing the eye goes to. Nothing here may restate what
 *     the ring already says better — which is why there is deliberately NO
 *     standings table of "who is on which tile". The tokens are that table, and
 *     a text copy of them printed in the middle of the ring would compete with
 *     the ring for no new information.
 *  2. What the ring CANNOT say gets the room: the ring shows one claim per tile
 *     in a 16px gutter but never aggregates them, so nobody can tell who is
 *     winning the territory race without counting 44 gutters ({@link
 *     BoardClaimLedger}); and it shows where a token is but not what each die
 *     face does from there ({@link BoardReach}).
 *  3. Whatever remains stays empty. An empty interior beats a busy one.
 */
function BoardPlate({
  activeTile,
  incident,
  ownership,
  placements,
  players,
  spaces,
  territory,
}: {
  readonly activeTile: number | null;
  readonly incident: BoardIncidentView;
  readonly ownership: readonly BoardTileOwnershipView[];
  readonly placements: readonly BoardPlacementView[];
  readonly players: readonly PlayerTokenView[];
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
      {incident.schedule ? <BoardSchedule schedule={incident.schedule} /> : null}
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
          <BoardReach
            activeTile={activeTile}
            ownership={ownership}
            placements={placements}
            spaces={spaces}
            territory={territory}
          />
          {incident.detail ? (
            <div className="board-plate-detail">{incident.detail}</div>
          ) : null}
        </div>
        {/* One column of keys, always rendered so the plate's wide two-column
            layout does not depend on how many keys there happen to be. */}
        <div className="board-plate-keys" data-slot="board-plate-keys">
          {/*
           * Ordered by how much each block's HEIGHT moves. The zone key is fixed
           * for a whole match and the ledger reserves one row per seat from turn
           * 0, so both are rigid; the territory key is the only variable block
           * here (§12.5 requires it swap a teaching empty state for rows once
           * something is claimed, and it gains a row per placement kind that
           * appears). Putting the one thing that resizes LAST means nothing in
           * this column is ever pushed down by it.
           */}
          <BoardLegend spaces={spaces} />
          {territory ? (
            <BoardClaimLedger ownership={ownership} players={players} />
          ) : null}
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
 * The fiscal calendar and, more to the point, the event this table has been told
 * is coming (spec §5.7).
 *
 * §5.7 announces an office-wide event one quarter ahead **so players can
 * position for it**. That only works if the announcement is somewhere a player
 * actually looks, and until now its only home was the footer of a docked panel
 * behind a tab. This is the same three facts on the board itself.
 *
 * Fixed three-cell rail, in the HUD's own grammar (§6.4: label + mono value,
 * separated by 1px vertical rules, never pills). Every cell has a resting form,
 * so the quarter turning over or an event being announced changes text inside a
 * cell and never the strip's height.
 */
function BoardSchedule({ schedule }: { readonly schedule: BoardScheduleView }) {
  const announced = schedule.nextEventLabel !== null;

  return (
    <dl
      aria-label="Fiscal calendar"
      className="board-schedule"
      data-slot="board-schedule"
    >
      <div className="board-schedule-cell">
        <dt className="board-schedule-label">Quarter</dt>
        <dd className="board-schedule-value">
          {schedule.quarterLabel} · {schedule.span}
        </dd>
      </div>
      <div className="board-schedule-cell">
        <dt className="board-schedule-label">This quarter</dt>
        <dd className="board-schedule-value">{schedule.currentEventLabel ?? "—"}</dd>
      </div>
      {/* The announcement. The LED is always in the markup — caution once
          something is scheduled, idle before — so arming it cannot reflow the
          row, and the state is never carried by colour alone (§8): the value
          beside it says it in words either way. */}
      <div
        className="board-schedule-cell"
        data-board-announced={announced ? "true" : undefined}
        data-slot="board-schedule-announcement"
      >
        <dt className="board-schedule-label">
          Announced{schedule.nextQuarterLabel ? ` · ${schedule.nextQuarterLabel}` : ""}
        </dt>
        <dd className="board-schedule-value">
          <span aria-hidden="true" className="board-schedule-led" />
          {schedule.nextEventLabel ?? "Nothing scheduled yet"}
        </dd>
      </div>
    </dl>
  );
}

/**
 * What each face of the movement die lands on from where the active player is
 * standing. This is the one thing the ring's interior can say that nothing else
 * in the shell says: it is derived entirely from the authored board and the
 * projected position — no rule and no projection field is being invented — and it
 * is the difference between watching a token move and being able to follow why.
 * It is descriptive, never a control: legality still comes from the server.
 *
 * It is now the interior's PRIMARY content rather than a 78px footnote under a
 * paragraph. That was the single worst use of the plate's space: the most
 * decision-relevant thing on the screen ("3 is Burnout, 4 is the reception
 * desk") was set at 11px in a strip a fifth the height of the blank block
 * beneath it. Six columns now run the body column's full height, so the space
 * that was blank is structure — hairline column rules the eye can read — rather
 * than a hole.
 *
 * Each column answers the three questions in the order a player asks them:
 * WHERE (the zone swatch and facility code, the same swatch grammar the zone key
 * uses, so a column is scannable by pattern before any word is read), WHAT (the
 * room name), and WHOSE (the claim line, in territory modes only). The claim
 * line always renders — "Unclaimed" is its resting form — so a claim landing
 * mid-match changes a word and never a height.
 */
function BoardReach({
  activeTile,
  ownership,
  placements,
  spaces,
  territory,
}: {
  readonly activeTile: number | null;
  readonly ownership: readonly BoardTileOwnershipView[];
  readonly placements: readonly BoardPlacementView[];
  readonly spaces: readonly BoardSpaceView[];
  readonly territory: boolean;
}) {
  if (activeTile === null || spaces.length === 0) return null;

  const reach = Array.from({ length: 6 }, (_, offset) => offset + 1).flatMap((roll) => {
    const space = spaces.find(
      (candidate) => candidate.index === (activeTile + roll) % spaces.length,
    );

    return space ? [{ roll, space }] : [];
  });
  if (reach.length === 0) return null;

  const ownerOf = new Map(ownership.map((entry) => [entry.tileId, entry]));
  const placedOn = groupByTile(placements);

  return (
    <div className="board-reach" data-slot="board-reach">
      <p className="board-reach-head">
        Movement reach · one d6 clockwise from {formatSpace(activeTile)}
      </p>
      <ol className="board-reach-list">
        {reach.map(({ roll, space }) => {
          const owner = ownerOf.get(space.id) ?? null;
          const placed = placedOn.get(space.id) ?? [];

          return (
            <li className="board-reach-item" key={roll}>
              <span className="board-reach-roll">{roll}</span>
              <span className="board-reach-facility">
                <span
                  aria-hidden="true"
                  className="board-legend-swatch"
                  data-board-zone={space.zone}
                />
                <span className="board-reach-code">{space.code}</span>
              </span>
              <span className="board-reach-name">{space.label}</span>
              <span className="board-reach-zone">{space.zoneLabel}</span>
              {territory ? (
                <span
                  className="board-reach-claim"
                  data-board-claim-self={owner?.isSelf ? "true" : undefined}
                  data-board-owner-seat={owner?.ownerSeat}
                  data-slot="board-reach-claim"
                >
                  <span aria-hidden="true" className="board-reach-claim-rule" />
                  {describeReachClaim(owner, placed)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * One short phrase for "whose is this, and what is waiting on it".
 *
 * Words, not a colour: the seat rule beside it is the same seat identity the
 * ring draws, but §8 forbids that rule being the only carrier, and a player
 * deciding whether to roll into a space with a sabotage on it needs to be told,
 * not to infer it from a hue.
 */
function describeReachClaim(
  owner: BoardTileOwnershipView | null,
  placed: readonly BoardPlacementView[],
): string {
  const claim =
    owner === null
      ? "Unclaimed"
      : owner.isSelf
        ? "Yours"
        : `Seat ${owner.ownerSeat}`;
  if (placed.length === 0) return claim;

  return `${claim} · ${placed.map((entry) => placementMark(entry).label).join(", ")}`;
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

/**
 * Who is winning the territory race.
 *
 * This is the one piece of shared state the ring genuinely cannot express. A
 * claim is drawn on its own tile in a 16px gutter, which is correct — §12.4
 * requires ownership be readable on the board rather than only in a rail — but
 * it never aggregates, so answering "am I behind?" means counting 44 gutters.
 * The territory key above already reports the two totals; this reports the
 * split, which is the only form of the number that is actually a standing.
 *
 * ONE ROW PER SEATED PLAYER, ALWAYS, FROM TURN 0 — including seats on zero. That
 * is what makes this safe to put on the board: a first claim changes a digit,
 * never the row count, so the block's height is fixed for the whole match
 * (§12.1). Seats are drawn in seat order rather than sorted by score for the
 * same reason — a lead changing hands must not reorder rows under the eye.
 */
function BoardClaimLedger({
  ownership,
  players,
}: {
  readonly ownership: readonly BoardTileOwnershipView[];
  readonly players: readonly PlayerTokenView[];
}) {
  if (players.length === 0) return null;

  const claims = new Map<number, number>();
  for (const entry of ownership) {
    claims.set(entry.ownerSeat, (claims.get(entry.ownerSeat) ?? 0) + 1);
  }

  /*
   * Own-versus-opponent (§12.1) without a new prop. `PlayerTokenView` does not
   * say which seat the viewer holds, but every ownership entry does, so the
   * viewer's seat is whichever seat owns a tile flagged `isSelf`. Before the
   * viewer has claimed anything there is nothing to derive it from and no row is
   * marked — the "Yours" total in the key above still reads 0 correctly, so the
   * degradation loses emphasis, never truth.
   */
  const selfSeat = ownership.find((entry) => entry.isSelf)?.ownerSeat ?? null;

  return (
    <div className="board-legend" data-slot="board-claim-ledger">
      <p className="board-legend-head">Claims by seat</p>
      <dl className="board-legend-list">
        {players.map((player) => (
          <div
            className="board-legend-item"
            data-board-claim-self={player.seat === selfSeat ? "true" : undefined}
            key={player.id}
          >
            <dt className="board-legend-term">
              <span
                aria-hidden="true"
                className="board-ledger-seat"
                data-board-seat={player.seat}
              >
                {player.seat}
              </span>
              <span className="board-ledger-name">
                {player.seat === selfSeat ? `${player.name} (you)` : player.name}
              </span>
            </dt>
            <dd className="board-legend-count">{claims.get(player.seat) ?? 0}</dd>
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
