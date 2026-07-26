import { RiArrowLeftLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  deadlineDashBoard,
  deadlineDashCharacters,
  deadlineDashModes,
  deadlineDashRanks,
} from "@office-ladder/content";
import type {
  PublicGameProjection,
  PublicPlayerProjection,
  RoomProjection,
} from "@office-ladder/contracts";

import { EASING_STANDARD_BEZIER, GAMEPLAY_MOTION_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  formatDelta,
  formatNumber,
  playerName,
  rankLabel,
  resolveTurnState,
  seatSlot,
  tileLabel,
  TurnStateSeatChip,
} from "./turn-rail";

type GameHudProps = {
  readonly room: RoomProjection;
  readonly game: PublicGameProjection;
  readonly selfPlayerId: string;
  /**
   * `GameBootstrap.serverTime`, the instant the projection beside it was stamped.
   *
   * The turn clock's scale comes from it: `deadlineAt` is an absolute instant and
   * the browser's own clock can be minutes off, so the only honest way to render a
   * proportion is `deadlineAt - serverTime`, both of which are the server's
   * numbers. Omit it and the clock still renders — it just cannot say how much of
   * the budget is gone and reports itself as unsynced in the markup rather than
   * guessing from `Date.now()`.
   */
  readonly serverTime?: string | null;
  /**
   * `GameBootstrap.self.characterId`. Optional: when supplied, the promotion
   * readout applies the character's `modifyPromotionRequirement` passive (the
   * Office Politician needs one less reputation), matching
   * `packages/engine/src/execution/roll-promotion.ts` exactly. Without it the
   * base content requirement is shown.
   */
  readonly selfCharacterId?: string | null;
};

const BOARD_TILE_COUNT = deadlineDashBoard.spaces.length;
const RANK_COUNT = deadlineDashRanks.length;

/**
 * Every member of `RoomProjection["mode"]` needs an entry: the union grew to the
 * four presets when modes became rulesets, and an incomplete record here is an
 * implicit-`any` index, not a graceful fallback.
 */
const modeLabels: Record<RoomProjection["mode"], string> = {
  "mode.quick": "Quick",
  "mode.standard": "Standard",
  "mode.marathon": "Marathon",
  "mode.campaign": "Campaign",
};

export function GameHud({
  room,
  game,
  selfPlayerId,
  selfCharacterId = null,
  serverTime = null,
}: GameHudProps) {
  return (
    <>
      <GameHudHeader
        game={game}
        room={room}
        selfPlayerId={selfPlayerId}
        serverTime={serverTime}
      />
      <GameHudStrip
        game={game}
        room={room}
        selfCharacterId={selfCharacterId}
        selfPlayerId={selfPlayerId}
      />
    </>
  );
}

/**
 * 48px room header: identity, room code, and who holds the turn. Renders a
 * router `Link`, so it needs a router context — `GameHudStrip` and
 * `TurnStateIndicator` are exported separately for context-free rendering.
 */
export function GameHudHeader({
  room,
  game,
  selfPlayerId,
  serverTime = null,
}: Omit<GameHudProps, "selfCharacterId">) {
  return (
    <header className="hud-header" data-slot="game-header-region">
      <Link
        aria-label={`Back to room ${room.code}`}
        className="hud-header-back"
        params={{ roomId: room.id }}
        to="/rooms/$roomId"
      >
        <RiArrowLeftLine aria-hidden="true" className="size-4" />
      </Link>
      <p className="hud-header-title">Deadline Dash</p>
      <span aria-hidden="true" className="hud-header-rule" />
      <p className="hud-value" data-slot="game-header-room-code">
        {room.code}
      </p>
      <span aria-hidden="true" className="hud-header-rule hud-header-optional" />
      <p className="hud-label hud-header-optional">{modeLabel(room.mode)} shift</p>
      <span aria-hidden="true" className="hud-header-spacer" />
      <TurnStateIndicator state={resolveTurnState(room, game, selfPlayerId)} />
      {/*
        Whose turn it is and how long they have are one thought, so they sit next
        to each other and neither goes behind a tab (spec §12.2). The clock's lane
        is a definite width whether or not a clock is running, so a turn ending
        cannot shift the header — and the header is the board's own top edge.
      */}
      <TurnClock game={game} selfPlayerId={selfPlayerId} serverTime={serverTime} />
    </header>
  );
}

/**
 * The turn clock, as a DEPLETING BAR (spec §12.3).
 *
 * Not a ticking number, and that is the requirement rather than a preference: a
 * number demands the reader subtract, which is the wrong ask when a window is
 * eight seconds long. What this replaces is a `/T(\d{2}:\d{2}:\d{2})/` over
 * `deadlineAt` rendering a static wall-clock time — a timestamp, not a countdown.
 *
 * Reads the clock straight off the projection each render. See
 * {@link DeadlineMeter} for why that is the whole implementation.
 */
export function TurnClock({
  game,
  selfPlayerId,
  serverTime = null,
}: {
  readonly game: PublicGameProjection;
  readonly selfPlayerId: string;
  readonly serverTime?: string | null;
}) {
  const isSelf = game.activePlayerId === selfPlayerId;
  const seat = game.activePlayerId === null ? null : seatSlot(game, game.activePlayerId);

  return (
    <DeadlineMeter
      deadlineAt={game.deadlineAt}
      durationMs={game.turnTimerDurationMs}
      expiryNote={
        isSelf
          ? "When it runs out the server rolls for you, so the table is never blocked."
          : "When it runs out the server rolls on their behalf, so the table is never blocked."
      }
      owner={isSelf ? "self" : "opponent"}
      serverTime={serverTime}
      subject={isSelf ? "you" : seat === null ? "the active seat" : `seat ${seat}`}
    />
  );
}

/**
 * A depleting bar for one server-set deadline. Reusable for any wall-clock
 * boundary the shell has to show — a turn, a reaction window, a closing ballot —
 * so they read as the same instrument (spec §7.1, §12.3).
 *
 * **The deadline in state is the truth and this runs no clock of its own.** There
 * is no interval, no `requestAnimationFrame`, no `Date.now()` and no local
 * countdown state anywhere in here, which is the point:
 *
 *  - The resting geometry is `deadlineAt - serverTime`, both of the server's own
 *    numbers, so the same markup renders on the server, in `renderToStaticMarkup`
 *    and on the first client paint, and none of it depends on the browser's clock
 *    being right (which the contract warns it may not be, by minutes).
 *  - The continuous part is one CSS animation whose duration is the full budget
 *    and whose `animation-delay` is NEGATIVE by the time already elapsed — the
 *    browser seeks into it and the compositor carries it the rest of the way. This
 *    is §12.3's one sanctioned continuous animation, and `prefers-reduced-motion`
 *    turns it into discrete steps rather than removing it (see hud.css).
 *  - Every projection update re-states duration and delay, so the bar re-syncs to
 *    the server on every poll and push instead of drifting away from it.
 *  - **It decides nothing.** There is no expiry callback and no auto-submit here
 *    by design: the server commits the turn on the player's behalf whether or not
 *    any client noticed, so a client that acted on its own idea of "now" could
 *    only ever race a decision that was already made. The bar reaches zero, stops,
 *    and waits for the next update.
 */
export function DeadlineMeter({
  deadlineAt,
  durationMs,
  expiryNote,
  label = "Clock",
  owner,
  serverTime = null,
  subject,
}: {
  readonly deadlineAt: string | null;
  readonly durationMs: number | null;
  /** What the server does at zero, stated in words for the reader. */
  readonly expiryNote: string;
  readonly label?: string;
  /** Own versus opponent, carried structurally as well as in the sentence. */
  readonly owner: "self" | "opponent";
  readonly serverTime?: string | null;
  /** Who the clock is on, e.g. `"you"` or `"seat 3"`. */
  readonly subject: string;
}) {
  const clock = resolveDeadline({ deadlineAt, durationMs, serverTime });

  return (
    <div
      className="hud-clock"
      data-armed={clock === null ? "false" : "true"}
      data-owner={owner}
      data-slot="game-turn-clock"
      data-synced={clock === null ? undefined : clock.synced ? "true" : "false"}
    >
      <span className="hud-label hud-clock-label">{label}</span>
      <span
        aria-hidden="true"
        className="hud-clock-track"
        data-remaining={clock === null ? undefined : clock.remainingPercent}
      >
        {clock === null ? null : (
          <span
            className="hud-clock-fill"
            /* A new deadline is a new animation, not a re-timed one. */
            key={deadlineAt ?? "none"}
            style={{
              animationDelay: `-${clock.elapsedMs}ms`,
              animationDuration: `${clock.durationMs}ms`,
              /* The resting value the animation seeks away from. It is also what
                 shows if animations never run at all, so the bar is honest
                 without a frame loop. */
              transform: `scaleX(${clock.remainingPercent / 100})`,
            }}
          />
        )}
      </span>
      {/* A number confirms the SCALE — an eight-second window and a ninety-second
          turn are the same bar otherwise — and it never ticks (§6.4 wants the
          value echoed; §12.3 forbids a running one). */}
      <span className="hud-sub hud-clock-budget">
        {clock === null ? "—" : formatBudget(clock.durationMs)}
      </span>
      <span className="sr-only" data-slot="game-turn-clock-description">
        {clock === null
          ? "No turn clock is running."
          : `Turn clock: a ${formatBudgetWords(clock.durationMs)} budget for ${subject}. ${expiryNote}${
              clock.synced ? "" : " Remaining time is unsynced."
            }`}
      </span>
    </div>
  );
}

type ResolvedDeadline = {
  readonly durationMs: number;
  readonly elapsedMs: number;
  readonly remainingPercent: number;
  /**
   * False when no `serverTime` was supplied, so the elapsed portion could not be
   * derived from the server's own pair of instants. The bar then starts full and
   * runs the real budget — never further from the truth than the budget itself,
   * and reported in the markup rather than presented as a measurement.
   */
  readonly synced: boolean;
};

function resolveDeadline({
  deadlineAt,
  durationMs,
  serverTime,
}: {
  readonly deadlineAt: string | null;
  readonly durationMs: number | null;
  readonly serverTime: string | null | undefined;
}): ResolvedDeadline | null {
  if (deadlineAt === null || durationMs === null || durationMs <= 0) return null;

  const deadlineMs = Date.parse(deadlineAt);
  if (Number.isNaN(deadlineMs)) return null;

  const stampMs = typeof serverTime === "string" ? Date.parse(serverTime) : Number.NaN;
  const synced = !Number.isNaN(stampMs);
  const remainingMs = synced
    ? Math.min(durationMs, Math.max(0, deadlineMs - stampMs))
    : durationMs;

  return {
    durationMs,
    elapsedMs: durationMs - remainingMs,
    remainingPercent: Math.round((remainingMs / durationMs) * 100),
    synced,
  };
}

/** Compact scale marker: `45s` under a minute and a half, `2:00` above it. */
function formatBudget(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 90) return `${seconds}s`;

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatBudgetWords(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 90) return `${seconds} second`;

  // Adjectival, like the seconds branch: this always reads "a <x> budget", where
  // "a 2 minutes budget" would not.
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return rest === 0 ? `${minutes} minute` : `${minutes} minute ${rest} second`;
}

/**
 * The live-telemetry strip: 40px, surface fill, bottom hairline, edge-to-edge,
 * one 11px uppercase label plus one mono tabular value per readout, separated
 * by 1px vertical rules (DESIGN.md §6.4).
 */
export function GameHudStrip({
  room,
  game,
  selfPlayerId,
  selfCharacterId = null,
}: GameHudProps) {
  const selfPlayer = game.players.find((player) => player.id === selfPlayerId);

  return (
    <dl
      aria-label="Shift telemetry"
      className="hud-strip"
      data-slot="game-resources-region"
      tabIndex={0}
    >
      <HudCell cell="round" label="Round">
        <span className="hud-value">{formatNumber(game.round)}</span>
      </HudCell>
      <HudCell cell="turn" label="Turn">
        <span className="hud-value">{formatNumber(game.turnNumber)}</span>
      </HudCell>
      {selfPlayer === undefined ? (
        <HudCell cell="view" label="View">
          <span className="hud-value">Spectating</span>
        </HudCell>
      ) : (
        <SelfReadouts
          game={game}
          player={selfPlayer}
          room={room}
          selfCharacterId={selfCharacterId}
        />
      )}
    </dl>
  );
}

/** 6px square status LED plus a text label — never colour alone (§6.4, §8). */
export function TurnStateIndicator({
  state,
}: {
  readonly state: ReturnType<typeof resolveTurnState>;
}) {
  return (
    <span className="hud-header-state" data-slot="game-header-turn-state" data-tone={state.tone}>
      <span aria-hidden="true" className={cn("hud-led", `hud-led--${state.tone}`)} />
      <TurnStateSeatChip slot={state.slot} />
      <span className="hud-header-state-text hud-fade-in" key={state.key}>
        {state.text}
      </span>
    </span>
  );
}

function SelfReadouts({
  game,
  player,
  room,
  selfCharacterId,
}: {
  readonly game: PublicGameProjection;
  readonly player: PublicPlayerProjection;
  readonly room: RoomProjection;
  readonly selfCharacterId: string | null;
}) {
  const slot = seatSlot(game, player.id);
  const energy = energyTelemetry(player, room.mode);
  const promotion = promotionTelemetry(player, room.mode, selfCharacterId);

  return (
    <>
      {/*
        The seat READOUT is the swatch plus `S1`; the display name is not a
        readout at all, and it was the widest thing in the strip — 93px of a name
        the dossier row states in full ("Contract Auditor (you)") two inches to
        the right, truncated to "Contract Aud…" here. It stays in the cell's
        accessible description so nothing is lost to a screen reader.
      */}
      <HudCell
        cell="seat"
        description={`You are ${playerName(room, player.id)}, seat ${slot}.`}
        label="Seat"
      >
        <span aria-hidden="true" className={cn("hud-swatch", `hud-seat-${slot}`)} />
        <span className="hud-value">S{slot}</span>
      </HudCell>
      <HudCell cell="rank" label="Rank">
        <span className="hud-value">{rankLabel(player)}</span>
        <span className="hud-sub">
          {player.rank.index + 1}/{RANK_COUNT}
        </span>
      </HudCell>
      <HudCell cell="cash" label="Cash">
        <HudNumber prefix="$" slot="game-hud-cash" value={player.resources["money"] ?? 0} />
      </HudCell>
      <HudCell cell="reputation" label="Rep">
        <HudNumber slot="game-hud-reputation" value={player.resources["reputation"] ?? 0} />
      </HudCell>
      <HudCell
        cell="energy"
        label="Energy"
        title={`Energy ${energy.value} of ${energy.maximum}`}
      >
        <Meter ratio={energy.ratio} tone={energy.low ? "low" : "default"} />
        <HudNumber
          slot="game-hud-energy"
          suffix={`/${energy.maximum}`}
          value={energy.value}
        />
        {energy.low ? <span className="hud-sub">Low</span> : null}
      </HudCell>
      <HudCell cell="work" label="Work">
        <HudNumber slot="game-hud-work" value={player.resources["work-counter"] ?? 0} />
      </HudCell>
      {/* The board length is a constant, not telemetry — it moves to the
          description rather than spending strip width on "/44" forever. */}
      <HudCell
        cell="tile"
        description={`Tile ${tileLabel(player.position)} of ${BOARD_TILE_COUNT}.`}
        label="Tile"
      >
        <span className="hud-value">{tileLabel(player.position)}</span>
      </HudCell>
      <PromotionCell promotion={promotion} />
    </>
  );
}

function PromotionCell({ promotion }: { readonly promotion: PromotionTelemetry }) {
  if (promotion.kind === "final") {
    return (
      <HudCell cell="promotion" label="Next rank" title="Director is the top rank.">
        <span className="hud-value">None</span>
        <span className="hud-sub">Top rank</span>
      </HudCell>
    );
  }

  return (
    <HudCell
      cell="promotion"
      description={promotion.detail}
      label="Next rank"
      title={promotion.detail}
    >
      <span className="hud-value">{promotion.rankLabel}</span>
      <Meter ratio={promotion.ratio} tone={promotion.ready ? "met" : "default"} />
      <span className="hud-sub">{promotion.summary}</span>
    </HudCell>
  );
}

/**
 * How long a `+300` stays beside the readout it explains.
 *
 * Deliberately NOT one of `GAMEPLAY_MOTION_MS`'s budgets: this is a dwell — how
 * long a one-shot piece of text remains legible — not the duration of any
 * animation, and it has to outlast the 400ms tick by enough to actually be read
 * while bot turns play out. Reduced motion shortens no part of it: the chip is
 * the *evidence* a player who gets no animation still needs.
 */
const HUD_DELTA_DWELL_MS = 1_600;

/**
 * A gameplay resource readout (DESIGN.md §7.2: "resource-value changes"), which
 * counts to its new value over `gameplay-tick` instead of snapping, and states
 * the change as a signed number beside itself.
 *
 * Three properties hold by construction:
 *  - The TRUE value is what renders synchronously, on the server and on the
 *    first client render (`useState(value)`), so the markup a test asserts and
 *    the number a reduced-motion player reads are the committed one.
 *  - The count only ever interpolates BETWEEN two committed values and always
 *    lands exactly on the new one, so no frame shows a number that was never
 *    true. `data-value` carries the committed value throughout for anything
 *    reading the DOM.
 *  - It never gates anything. This is a readout; nothing waits on it.
 */
function HudNumber({
  prefix = "",
  slot,
  suffix = "",
  value,
}: {
  readonly prefix?: string;
  readonly slot: string;
  readonly suffix?: string;
  readonly value: number;
}) {
  const { shown, delta } = useTickedReadout(value);

  return (
    <>
      {/* One string child, not adjacent nodes: the value has to be a single
          contiguous text run so "$1,200" / "4/5" is greppable in markup. */}
      <span className="hud-value" data-slot={slot} data-value={value}>
        {`${prefix}${formatNumber(shown)}${suffix}`}
      </span>
      <span className="hud-delta-slot">
        {delta === null ? null : (
          <span
            className="hud-delta"
            data-sign={delta.amount > 0 ? "gain" : "loss"}
            data-slot={`${slot}-delta`}
          >
            {formatDelta({ amount: delta.amount })}
          </span>
        )}
      </span>
    </>
  );
}

type ReadoutDelta = {
  readonly amount: number;
  /** Distinguishes two consecutive identical deltas, which state alone cannot. */
  readonly seq: number;
};

/**
 * Counts `value` to its committed target over §7.2's `gameplay-tick`, and
 * reports the signed change for `HUD_DELTA_DWELL_MS`.
 *
 * `prefers-reduced-motion` collapses the count to an instant state change while
 * keeping the delta — per §7.2 a reduced-motion player must still be able to
 * tell what happened, and here the *number* is what happened.
 */
function useTickedReadout(value: number): {
  readonly shown: number;
  readonly delta: ReadoutDelta | null;
} {
  const reduceMotion = useReducedMotion() ?? false;
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState<ReadoutDelta | null>(null);
  /** What is on screen right now, so an interrupted count resumes from it. */
  const shownRef = useRef(value);
  /** The last value the server committed, i.e. what the count is aiming at. */
  const committedRef = useRef(value);
  const sequenceRef = useRef(0);
  /*
   * Read inside the effect rather than declared as a dependency: a dependency
   * would tear down a running count when the OS setting changed and, because the
   * effect early-returns on an unchanged value, could leave the readout frozen
   * mid-count — a number that was never true, sitting at rest.
   */
  const reduceMotionRef = useRef(reduceMotion);

  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  useEffect(() => {
    const from = committedRef.current;
    if (from === value) return;

    committedRef.current = value;
    sequenceRef.current += 1;
    setDelta({ amount: value - from, seq: sequenceRef.current });

    if (reduceMotionRef.current) {
      shownRef.current = value;
      setShown(value);
      return;
    }

    const controls = animate(shownRef.current, value, {
      duration: GAMEPLAY_MOTION_MS.tick / 1_000,
      ease: EASING_STANDARD_BEZIER,
      onUpdate: (frame) => {
        const rounded = Math.round(frame);
        shownRef.current = rounded;
        setShown(rounded);
      },
      onComplete: () => {
        // Converge on the projection exactly. Motion is presentation; the
        // committed value is the truth, and it is what must be at rest.
        shownRef.current = value;
        setShown(value);
      },
    });

    return () => {
      controls.stop();
    };
  }, [value]);

  useEffect(() => {
    if (delta === null) return;
    const timer = window.setTimeout(() => setDelta(null), HUD_DELTA_DWELL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [delta]);

  return { shown, delta };
}

function HudCell({
  cell,
  children,
  description,
  label,
  title,
}: {
  readonly cell: string;
  readonly children: ReactNode;
  /**
   * Text a pointer user gets from `title` but nobody else would. A `title` on a
   * non-focusable div is a hover-only affordance (§8) — keyboard and screen
   * reader users can never reach it — so anything the visible readout does not
   * already state is repeated here as visually-hidden text.
   */
  readonly description?: string;
  readonly label: string;
  readonly title?: string;
}) {
  return (
    <div className="hud-cell" data-hud-cell={cell} data-slot="game-hud-cell" title={title}>
      <dt className="hud-label">{label}</dt>
      <dd>
        {children}
        {description === undefined ? null : (
          <span className="sr-only" data-slot="game-hud-cell-description">
            {description}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Sunken track, flat fill, 0 radius, no gradient, no glow. The bar only
 * illustrates — the caller always echoes the number beside it (DESIGN.md §6.4).
 */
function Meter({
  ratio,
  tone,
}: {
  readonly ratio: number;
  readonly tone: "default" | "low" | "met";
}) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);

  return (
    <span
      aria-hidden="true"
      className={cn("hud-meter", tone === "low" && "hud-meter--low", tone === "met" && "hud-meter--met")}
      data-slot="game-hud-meter"
      data-percent={percent}
    >
      <span className="hud-meter-fill" style={{ width: `${percent}%` }} />
    </span>
  );
}

function modeLabel(mode: RoomProjection["mode"]): string {
  return modeLabels[mode] ?? mode.replace("mode.", "");
}

type EnergyTelemetry = {
  readonly value: number;
  readonly maximum: number;
  readonly ratio: number;
  readonly low: boolean;
};

/**
 * `PublicPlayerProjection.resources` is flattened to plain values, so the
 * engine's per-resource `maximum` never reaches the browser. The ceiling is
 * therefore re-derived from the mode's starting energy, which is exactly what
 * `packages/engine/src/setup/create-game.ts` uses as the energy maximum today.
 */
function energyTelemetry(
  player: PublicPlayerProjection,
  mode: RoomProjection["mode"],
): EnergyTelemetry {
  const value = player.resources["energy"] ?? 0;
  const configured = deadlineDashModes[mode]?.startingResources.energy ?? 0;
  const maximum = Math.max(configured, value, 1);

  return {
    value,
    maximum,
    ratio: value / maximum,
    low: value <= Math.max(1, Math.floor(maximum / 3)),
  };
}

type PromotionTelemetry =
  | { readonly kind: "final" }
  | {
      readonly kind: "next";
      readonly rankLabel: string;
      readonly ratio: number;
      readonly ready: boolean;
      readonly summary: string;
      readonly detail: string;
    };

/**
 * Promotion is automatic the moment BOTH requirements are met, so the readout
 * reports the binding requirement — the one actually holding the player back —
 * and puts the full pair in the cell's tooltip.
 */
function promotionTelemetry(
  player: PublicPlayerProjection,
  mode: RoomProjection["mode"],
  characterId: string | null,
): PromotionTelemetry {
  const currentRank = deadlineDashRanks.find((rank) => rank.id === player.rank.kind);
  const nextRank =
    currentRank === undefined
      ? undefined
      : deadlineDashRanks.find((rank) => rank.tier === currentRank.tier + 1);

  if (nextRank === undefined || nextRank.promotionFromPrevious === null) {
    return { kind: "final" };
  }

  const requirement = nextRank.promotionFromPrevious;
  const cashRequired = requirement.moneyCost[mode] ?? requirement.moneyCost["mode.quick"];
  const repRequired = Math.max(
    0,
    requirement.reputationRequired + reputationRequirementAdjustment(characterId),
  );
  const cash = player.resources["money"] ?? 0;
  const reputation = player.resources["reputation"] ?? 0;
  const cashRatio = cashRequired <= 0 ? 1 : Math.min(1, cash / cashRequired);
  const repRatio = repRequired <= 0 ? 1 : Math.min(1, reputation / repRequired);
  const label = sentenceCase(nextRank.id.replace("rank.", "").replaceAll("-", " "));
  const detail = `${label} needs $${formatNumber(cashRequired)} and ${repRequired} reputation. You hold $${formatNumber(cash)} and ${reputation} reputation.`;

  if (cashRatio >= 1 && repRatio >= 1) {
    return { kind: "next", rankLabel: label, ratio: 1, ready: true, summary: "Ready", detail };
  }

  const cashIsBinding = cashRatio <= repRatio;

  return {
    kind: "next",
    rankLabel: label,
    ratio: Math.min(cashRatio, repRatio),
    ready: false,
    summary: cashIsBinding
      ? `$${formatNumber(cash)}/$${formatNumber(cashRequired)}`
      : `${reputation}/${repRequired} rep`,
    detail,
  };
}

function reputationRequirementAdjustment(characterId: string | null): number {
  if (characterId === null) return 0;
  const character = Object.values(deadlineDashCharacters).find(
    (candidate) => candidate.id === characterId,
  );
  if (character === undefined) return 0;
  const passive = character.passive;
  return passive.type === "modifyPromotionRequirement" && passive.resource === "reputation"
    ? passive.amount
    : 0;
}

function sentenceCase(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
