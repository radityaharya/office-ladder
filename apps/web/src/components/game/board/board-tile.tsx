import type {
  BoardCell,
  BoardPlacementView,
  BoardSpaceView,
  BoardTileOwnershipView,
  PlayerTokenView,
} from "./types";

type BoardTileProps = {
  readonly space: BoardSpaceView;
  readonly cell: BoardCell;
  readonly players: readonly PlayerTokenView[];
  readonly active: boolean;
  readonly landed: boolean;
  readonly totalSpaces: number;
  /** Who has claimed this space, or `null`. */
  readonly ownership?: BoardTileOwnershipView | null;
  /** Everything placed on this space that this viewer may see. */
  readonly placements?: readonly BoardPlacementView[];
  /**
   * Whether the match's ruleset has tile claiming and placements at all.
   *
   * A property of the MODE, not of whether anyone has claimed anything yet —
   * which is the whole point. The gutter's width is reserved for the entire match
   * from the first render, so the first claim of the game marks a tile without
   * re-flowing the room name on all 44 of them.
   */
  readonly territory?: boolean;
};

/**
 * One-letter marks for the five authored placement kinds (spec §5.1). Every kind
 * has a distinct first letter, so the mark is the initial of the thing itself
 * rather than an arbitrary code — and the board's own territory key spells all of
 * them out, so the letter never has to be guessed.
 *
 * Keyed by the `placement.*` id as a plain record rather than an exhaustive
 * `satisfies`: this file deliberately does not import the contracts union (see
 * `BoardPlacementView.kind`), so an unauthored kind has to degrade rather than
 * fail to render.
 */
const placementMarks: Readonly<Record<string, { readonly mark: string; readonly label: string }>> =
  {
    "placement.meeting-invite": { mark: "M", label: "Meeting invite" },
    "placement.sabotage": { mark: "S", label: "Sabotage" },
    "placement.surveillance": { mark: "V", label: "Surveillance" },
    "placement.rumour": { mark: "R", label: "Rumour" },
    "placement.favour": { mark: "F", label: "Favour" },
  };

/**
 * How many marks the territory gutter draws. The gutter is 25px of usable height
 * on a ~48px cell (the tile's 4px top inset and the occupancy dock's 19px band
 * are both off limits), and a mark is 12px, so two is the honest ceiling. Past it
 * the second mark becomes a count and the tile's accessible name enumerates
 * every entry — nothing is ever silently dropped.
 */
const gutterMarkLimit = 2;

export function BoardTile({
  space,
  cell,
  players,
  active,
  landed,
  totalSpaces,
  ownership = null,
  placements = [],
  territory = false,
}: BoardTileProps) {
  return (
    <li
      aria-label={tileLabel({
        space,
        players,
        active,
        landed,
        totalSpaces,
        ownership,
        placements,
      })}
      className="board-tile"
      data-board-active={active ? "true" : undefined}
      data-board-code={space.code}
      data-board-inactive={space.inactive ? "true" : undefined}
      data-board-index={space.index}
      data-board-kind={space.kindId}
      data-board-landed={landed ? "true" : undefined}
      data-board-occupants={players.length > 0 ? players.length : undefined}
      data-board-owner-level={ownership && ownership.level > 0 ? ownership.level : undefined}
      data-board-owner-seat={ownership?.ownerSeat}
      data-board-owner-self={ownership?.isSelf ? "true" : undefined}
      data-board-placement-count={placements.length > 0 ? placements.length : undefined}
      data-board-placement={space.placement}
      data-board-zone={space.zone}
      role="listitem"
      style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
    >
      <span aria-hidden="true" className="board-tile-rule" />
      {/*
       * Ownership as a persistent mark on the tile itself, readable across the
       * whole ring in peripheral vision (spec §12.4 — "never rail-only"). The
       * edge is absolutely positioned, so it costs no layout and the tile cannot
       * change size when a claim lands or is traded away. Own versus opponent is
       * structural, not a name to read: solid for the viewer's own, hatched for
       * everyone else's (see board.css).
       */}
      {ownership === null ? null : (
        <span aria-hidden="true" className="board-tile-owner-edge" />
      )}
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
       *
       * The territory gutter shrinks the tile's own query container (an
       * `inline-size` container measures its CONTENT box), so the label tiers
       * step down on their own in a territory match rather than needing a second
       * set of thresholds that could drift from the first.
       */}
      <span className="board-tile-name">
        <span className="board-tile-name-full">{space.label}</span>
        <span className="board-tile-name-short">{space.shortLabel ?? space.label}</span>
      </span>
      {territory ? (
        <TileTerritory ownership={ownership} placements={placements} />
      ) : null}
    </li>
  );
}

/**
 * The right-hand gutter: who owns this space, and what is sitting on it.
 *
 * `aria-hidden`, deliberately and completely. Every mark here is a compression of
 * something the tile's accessible name already states in full sentences —
 * duplicating them as loose letters would make the board's screen-reader output
 * worse, not better.
 */
function TileTerritory({
  ownership,
  placements,
}: {
  readonly ownership: BoardTileOwnershipView | null;
  readonly placements: readonly BoardPlacementView[];
}) {
  const marks = [
    ...(ownership === null
      ? []
      : [
          <span
            className="board-tile-owner"
            data-board-owner-level={ownership.level > 0 ? ownership.level : undefined}
            data-board-owner-self={ownership.isSelf ? "true" : undefined}
            data-board-seat={ownership.ownerSeat}
            key="owner"
          >
            {ownership.ownerSeat}
          </span>,
        ]),
    ...placements.map((placement) => (
      <span
        className="board-tile-mark"
        data-board-mark-self={placement.isSelf ? "true" : undefined}
        data-board-mark-sealed={placement.visibility === "owner-only" ? "true" : undefined}
        data-board-mark={placementMark(placement).mark}
        data-board-seat={placement.ownerSeat}
        key={placement.id}
      >
        {placementMark(placement).mark}
      </span>
    )),
  ];

  return (
    <span aria-hidden="true" className="board-tile-territory" data-slot="board-tile-territory">
      {marks.length > gutterMarkLimit
        ? [
            marks[0],
            <span className="board-tile-mark" data-board-mark-more="true" key="more">
              {marks.length - 1}
            </span>,
          ]
        : marks}
    </span>
  );
}

function placementMark(placement: BoardPlacementView): {
  readonly mark: string;
  readonly label: string;
} {
  const authored = placementMarks[placement.kind];
  if (authored !== undefined) {
    return placement.label === undefined
      ? authored
      : { mark: authored.mark, label: placement.label };
  }

  // An unrecognised kind still marks its tile rather than vanishing from the
  // board: the trailing segment's initial, and a readable label from the id.
  const segment = placement.kind.split(".").at(-1) ?? placement.kind;
  const label = placement.label ?? sentenceCase(segment.replaceAll("-", " "));

  return { mark: (segment.at(0) ?? "?").toUpperCase(), label };
}

function tileLabel({
  space,
  players,
  active,
  landed,
  totalSpaces,
  ownership,
  placements,
}: Omit<BoardTileProps, "cell" | "territory">): string {
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
    ...ownershipText(ownership ?? null),
    ...placementText(placements ?? []),
    occupantText(players),
  ].join(", ");
}

/**
 * Ownership in words, because the mark and the edge are colour and shape. The
 * viewer's own tiles read "owned by you" — the own-versus-opponent distinction
 * has to survive into the accessible name too, not only into the pixels.
 */
function ownershipText(ownership: BoardTileOwnershipView | null): readonly string[] {
  if (ownership === null) return [];

  const owner = ownership.isSelf ? "owned by you" : `owned by ${ownership.ownerName}`;

  return ownership.level > 0 ? [owner, `upgraded to level ${ownership.level}`] : [owner];
}

/**
 * Every placement, in full — including the ones the gutter compressed into a
 * count. `owner-only` entries say so: they only ever reach their own owner, and
 * that owner needs to know the table cannot see them.
 */
function placementText(placements: readonly BoardPlacementView[]): readonly string[] {
  return placements.map((placement) => {
    const { label } = placementMark(placement);
    const owner = placement.isSelf ? "yours" : `placed by ${placement.ownerName}`;
    const sealed = placement.visibility === "owner-only" ? ", visible only to you" : "";

    return `${label.toLowerCase()} ${owner}${sealed}`;
  });
}

function occupantText(players: readonly PlayerTokenView[]): string {
  if (players.length === 0) return "unoccupied";

  const names = players.map(
    (player) => `${player.name} (seat ${player.seat}${player.isBot ? ", bot" : ""})`,
  );
  if (names.length === 1) return `occupied by ${names[0]}`;

  return `occupied by ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function sentenceCase(value: string): string {
  if (value.length === 0) return value;
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function formatSpace(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export { placementMark };
