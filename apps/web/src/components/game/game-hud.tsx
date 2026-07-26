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

const modeLabels = {
  "mode.quick": "Quick",
  "mode.marathon": "Marathon",
} as const;

export function GameHud({ room, game, selfPlayerId, selfCharacterId = null }: GameHudProps) {
  return (
    <>
      <GameHudHeader game={game} room={room} selfPlayerId={selfPlayerId} />
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
    </header>
  );
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
