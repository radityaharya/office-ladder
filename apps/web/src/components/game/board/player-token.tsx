// `m` rather than `motion`: the minimal component, with its feature bundle
// supplied by the match's single `LazyMotion` provider in
// `routes/rooms.$roomId.game.tsx`. See the note in game-board.tsx.
import * as m from "motion/react-m";
import { useState, type CSSProperties } from "react";

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
  /*
   * The url whose `img` has already failed, rather than a boolean. Keying the
   * failure to the value means a player who changes their avatar gets one fresh
   * attempt automatically — a boolean would blacklist the seat, not the image.
   */
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const seat = <span className="board-token-seat">{player.seat}</span>;
  const botTag = player.isBot ? <span className="board-token-bot">BOT</span> : null;
  /*
   * A bot gets no face cell at all. That is the honest reading of `avatarUrl`
   * being permanently `null` for bots, it is what keeps a bot from rendering as a
   * human with a missing photo, and it is what keeps two bot plates on one space
   * inside a ~97px cell: a bot spends its 14px on the `BOT` tag it already had
   * rather than on an empty square.
   */
  const face = player.isBot ? null : (
    <TokenFace
      failedPhotoUrl={failedPhotoUrl}
      onPhotoFailed={setFailedPhotoUrl}
      player={player}
    />
  );

  if (!cell) {
    return (
      <span
        className="board-token-plate"
        data-board-bot={player.isBot ? "true" : undefined}
        data-board-seat={player.seat}
      >
        {face}
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
          {density === "full" ? face : null}
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

/**
 * The player's photo on their piece, at the only size a 44-space ring leaves for
 * one: 14px square inside a 14px-tall plate, on a ~97x48 tile.
 *
 * Two things make that small size honest rather than decorative:
 *
 *  - **The fallback is always in the markup, underneath the photo.** The seat
 *    initial is a real element in flow and the `img` is absolutely positioned
 *    over it, so a missing, blocked, slow or broken avatar reveals the initial
 *    with no reflow, no layout shift and no broken-image glyph. `renderToStaticMarkup`
 *    and the first client paint therefore both produce a correct plate.
 *  - **Nothing identifies a seat by its photo.** At 14px a face reads as a
 *    person's colour signature, which is enough to find your own piece at a
 *    glance, and not enough to be the identity system — that stays the seat
 *    colour, the seat pattern and the seat numeral beside it (§8).
 *
 * `alt=""`: the photo is decorative here, because the token's own accessible name
 * already states the player's name, seat, bot-ness and space. A second copy of
 * the name inside it would be read twice.
 */
function TokenFace({
  failedPhotoUrl,
  onPhotoFailed,
  player,
}: {
  readonly failedPhotoUrl: string | null;
  readonly onPhotoFailed: (url: string) => void;
  readonly player: PlayerTokenView;
}) {
  const photoUrl = renderableAvatarUrl(player.avatarUrl);
  const showPhoto = photoUrl !== null && photoUrl !== failedPhotoUrl;

  return (
    <span
      className="board-token-face"
      data-board-face={showPhoto ? "photo" : "initial"}
    >
      <span aria-hidden="true" className="board-token-initial">
        {tokenInitial(player)}
      </span>
      {showPhoto ? (
        <img
          alt=""
          className="board-token-photo"
          /* Decode off the critical path — the fallback underneath is already a
             correct plate, so nothing waits on this. NOT `loading="lazy"`: a
             board's pieces are at most six 14px images that are on screen from the
             first paint, and deferring them would leave the identity affordance
             absent for no saving. Measured in Chrome: lazy left every avatar
             unloaded while the board sat below the fold. */
          decoding="async"
          onError={() => onPhotoFailed(photoUrl)}
          referrerPolicy="no-referrer"
          src={photoUrl}
        />
      ) : null}
    </span>
  );
}

/** One character. `initials` is up to two and only one fits a 14px face. */
function tokenInitial(player: PlayerTokenView): string {
  const source = player.initials ?? player.name;
  return (source.trim().at(0) ?? "?").toUpperCase();
}

/**
 * Longest avatar URL this will place in an `img src`. Matches the contract's own
 * `AVATAR_URL_MAX_LENGTH` in spirit rather than importing it — this is a second,
 * independent gate, and a gate that trusts the value it is gating is not one.
 */
const AVATAR_URL_MAX_LENGTH = 512;

/** Characters that could terminate an attribute or smuggle a second one. */
const UNSAFE_URL_CHARACTERS = /["'<>`\\\s]/;

/* eslint-disable-next-line no-control-regex -- the point is to reject these. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * The subset of `RoomMemberProjection.avatarUrl` this component will draw.
 *
 * The server already guarantees far more than this (see the field's own doc
 * comment) and the value never reaches an executing context here — it is an
 * `img src` and nothing else. This is deliberately a *second* check at the render
 * boundary anyway, because the cost is one regex and the failure mode of trusting
 * a URL that arrived over the wire is not proportionate to it. Anything rejected
 * degrades to the seat initial, which is the same fallback as "no avatar".
 */
export function renderableAvatarUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const url = value.trim();
  if (url.length === 0 || url.length > AVATAR_URL_MAX_LENGTH) return null;
  if (UNSAFE_URL_CHARACTERS.test(url) || CONTROL_CHARACTERS.test(url)) return null;
  // Protocol-relative `//host/…` inherits the page scheme and is not same-origin.
  if (url.startsWith("//")) return null;
  if (url.startsWith("/")) return url;

  return url.slice(0, 8).toLowerCase() === "https://" ? url : null;
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
