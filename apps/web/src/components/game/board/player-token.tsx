// `m` rather than `motion`: the minimal component, with its feature bundle
// supplied by the match's single `LazyMotion` provider in
// `routes/rooms.$roomId.game.tsx`. See the note in game-board.tsx.
import * as m from "motion/react-m";
import type { CSSProperties } from "react";

import {
  EASING_STANDARD_BEZIER,
  GAMEPLAY_MOTION_MS,
  GAMEPLAY_SPRING,
  GAMEPLAY_TRANSITION,
} from "../../../lib/motion";

import type { BoardCell, BoardDockSlot, PlayerTokenView } from "./types";

type PlayerTokenProps = {
  readonly player: PlayerTokenView;
  /**
   * Board placement — the cell of the space the *projection* says this token is
   * on. Omit it to render the plate on its own (roster, legend, anywhere outside
   * the board grid) instead of positioning it over a space.
   */
  readonly cell?: BoardCell;
  /**
   * Cell the token is currently *drawn* on while travelling. Defaults to `cell`,
   * which is a token at rest. Motion animates the delta between the two, so a
   * token whose travel is interrupted or torn down snaps to `cell` — the truth —
   * rather than being stranded somewhere along the track.
   */
  readonly renderCell?: BoardCell;
  readonly dock?: BoardDockSlot;
  /**
   * Arrival serial from `useBoardTravel`. Any non-zero value replays the
   * one-shot landing acknowledgement; pass 0 (or nothing) to suppress it, which
   * is what reduced motion does.
   */
  readonly arrival?: number;
  /**
   * Hop index from `useBoardTravel`. 0 means "place this offset, do not animate
   * it": that is the commit where the projection moved the token's real space
   * forward while it is still drawn at its origin, so the offset jumps a whole
   * edge at once. Animating step 0 is what made the token shoot to its
   * destination and slide backwards before hopping, because the offset was
   * still zero on the frame the `li` re-parked onto its new cell.
   */
  readonly step?: number;
};

const stateLabels = {
  idle: "",
  current: ", active seat",
  disconnected: ", disconnected",
  eliminated: ", out of the match",
} as const satisfies Record<NonNullable<PlayerTokenView["state"]>, string>;

export function PlayerToken({
  player,
  cell,
  renderCell,
  dock,
  arrival = 0,
  step = 0,
}: PlayerTokenProps) {
  const state = player.state ?? "idle";
  const seat = <span className="board-token-seat">{player.seat}</span>;
  const botTag = player.isBot ? <span className="board-token-bot">BOT</span> : null;

  if (!cell) {
    return (
      <span className="board-token-plate" data-board-seat={player.seat}>
        {seat}
        {botTag}
      </span>
    );
  }

  const drawn = renderCell ?? cell;
  const density = dock?.density ?? "full";
  const dockOffset = dock?.x ?? 0;

  return (
    <li
      aria-label={tokenLabel(player)}
      className="board-token"
      data-board-token={player.id}
      data-board-token-bot={player.isBot ? "true" : undefined}
      data-board-token-density={density}
      data-board-token-position={player.position}
      data-board-token-state={state}
      data-board-token-travelling={
        drawn.col === cell.col && drawn.row === cell.row ? undefined : "true"
      }
      role="listitem"
      style={cellStyle(cell)}
      title={tokenLabel(player)}
    >
      {/*
       * Travel. The `li` above is already parked on the token's REAL cell by
       * plain CSS custom properties, so this only ever animates the offset back
       * to where the token is currently drawn — one cell per hop, along the
       * track. At rest both values are "0%", which Motion renders as
       * `transform: none`: the static/server render needs no browser and no
       * measurement to be correct.
       *
       * `tokenHop`, not `GAMEPLAY_SPRING.token`: a tween whose duration is the
       * travel machine's own beat, so each hop lands and stops instead of
       * overlapping the next one into a glide (§7.2, "discrete over continuous").
       */}
      <m.span
        animate={{
          x: `${(drawn.col - cell.col) * 100}%`,
          y: `${(drawn.row - cell.row) * 100}%`,
        }}
        className="board-token-travel"
        /* Mirrors `animate`, so a token mounting mid-travel appears where it is
           drawn rather than sliding in from its destination. */
        initial={{
          x: `${(drawn.col - cell.col) * 100}%`,
          y: `${(drawn.row - cell.row) * 100}%`,
        }}
        transition={step === 0 ? { duration: 0 } : GAMEPLAY_TRANSITION.tokenHop}
      >
        {/* Occupancy dock. `x` is a real pixel offset the board computed from
            who else is standing here, so plates re-slot on the same spring when
            someone arrives or leaves instead of jumping. */}
        <m.span
          animate={{ x: dockOffset }}
          className="board-token-plate"
          data-board-seat={player.seat}
          initial={{ x: dockOffset }}
          transition={GAMEPLAY_SPRING.token}
        >
          {seat}
          {density === "full" ? botTag : null}
          {arrival > 0 ? (
            <m.span
              animate={{ opacity: [0, 1, 0] }}
              aria-hidden="true"
              className="board-token-landing"
              initial={{ opacity: 0 }}
              key={`landing-${arrival}`}
              transition={{
                duration: GAMEPLAY_MOTION_MS.emphasis / 1000,
                ease: EASING_STANDARD_BEZIER,
                times: [0, 0.3, 1],
              }}
            />
          ) : null}
        </m.span>
      </m.span>
    </li>
  );
}

function tokenLabel(player: PlayerTokenView): string {
  const kind = player.isBot ? ", bot" : "";
  const state = stateLabels[player.state ?? "idle"];
  return `${player.name}, seat ${player.seat}${kind}, space ${formatSpace(player.position)}${state}`;
}

function formatSpace(position: number): string {
  return String(position + 1).padStart(2, "0");
}

function cellStyle(cell: BoardCell): CSSProperties {
  // Custom properties are not part of the CSSProperties type; React serialises
  // them verbatim, which is what the pure-CSS cell arithmetic needs. This is
  // the token's canonical position — never an animated value.
  return {
    "--board-token-col": cell.col,
    "--board-token-row": cell.row,
  } as CSSProperties;
}
