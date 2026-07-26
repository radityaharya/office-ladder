import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";

import type {
  BotDifficulty,
  PublicGameProjection,
  PublicPlayerProjection,
  RoomMemberProjection,
  RoomProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";
import { deadlineDashContent } from "@office-ladder/content";

import { CHROME_MOTION_MS, EASING_STANDARD_BEZIER } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Who a log line belongs to. Deliberately the same three words
 * `event-feedback-policy.ts` already uses for `EventActorKind`, so the log rail
 * and the notice layer can be matched to each other without a translation table:
 * `local` is the viewer, `remote` is any other seat (human or bot), `system` is
 * the office/engine acting with no actor.
 */
export type ActivityLogOrigin = "local" | "remote" | "system";

/**
 * A single activity-log line. Derived from the server's `SafeEventSummary`
 * stream by {@link buildActivityLog}, optionally decorated with a resource
 * delta supplied by the feedback layer (see {@link ActivityLogDelta}).
 */
export type ActivityLogEntry = {
  readonly id: string;
  readonly revision: number;
  /** ISO-8601 instant, straight from `SafeEventSummary.occurredAt`. */
  readonly occurredAt: string;
  /** Sentence-case prose. Never uppercase — DESIGN.md §2.2. */
  readonly text: string;
  readonly delta: ActivityLogDeltaValue | null;
  /**
   * Optional so a caller can still hand-build an entry. Absent means "unknown
   * provenance": the row renders with no origin tag and a neutral rule rather
   * than claiming to be the office's doing.
   */
  readonly origin?: ActivityLogOrigin;
  /** Display seat 1..6 of the actor, for the row's identity rule and `S2` tag. */
  readonly slot?: number;
  /** Raw `SafeEventSummary.type`, used only to mark turn boundaries. */
  readonly eventType?: string;
};

export type ActivityLogDeltaValue = {
  /** Signed. The sign is always rendered, so gain/loss is never color-only. */
  readonly amount: number;
  /** Short lowercase unit suffix, e.g. "rep", "energy". Omit for money. */
  readonly unit?: string;
};

/**
 * Decoration contract for the feedback layer: give the log an `eventId` from
 * `PublicGameProjection.eventSummaries` plus the amount that event moved, and
 * the log renders it as a signed mono delta on that row. `text` optionally
 * replaces the derived sentence when the feedback layer knows better.
 */
export type ActivityLogDelta = {
  readonly eventId: string;
  readonly amount: number;
  readonly unit?: string;
  readonly text?: string;
};

type TurnRailProps = {
  readonly room: RoomProjection;
  readonly game: PublicGameProjection;
  readonly selfPlayerId: string;
  /** Resource deltas keyed by event id. Optional and purely additive. */
  readonly deltas?: readonly ActivityLogDelta[];
  /** How many of the newest entries to keep rendered. */
  readonly maxEntries?: number;
};

const DEFAULT_MAX_ENTRIES = 40;
const SEAT_COUNT = 6;

const playerBgClasses = {
  1: "bg-player-1",
  2: "bg-player-2",
  3: "bg-player-3",
  4: "bg-player-4",
  5: "bg-player-5",
  6: "bg-player-6",
} as const;

const playerRingClasses = {
  1: "ring-player-1",
  2: "ring-player-2",
  3: "ring-player-3",
  4: "ring-player-4",
  5: "ring-player-5",
  6: "ring-player-6",
} as const;

/** Retained for callers that still need a Tailwind seat-color utility. */
export function playerColorClass(seat: number, kind: "bg" | "ring" = "bg"): string {
  const table = kind === "bg" ? playerBgClasses : playerRingClasses;
  return (
    table[seat as keyof typeof table] ??
    (kind === "bg" ? "bg-muted-foreground" : "ring-muted-foreground")
  );
}

/**
 * Display slot 1..6 for a player.
 *
 * `PublicPlayerProjection.seat` is the engine's turn `order`, which is
 * ZERO-based in the real projection (`apps/server/src/rooms/service/projections.ts`
 * maps `seat: player.order`). Deriving the slot from the player's index in
 * `game.players` — which is already in turn order — is therefore the only
 * derivation that yields a collision-free 1..6 for both real payloads and the
 * 1-based test fixtures.
 */
export function seatSlot(game: PublicGameProjection, playerId: string): number {
  const index = game.players.findIndex((player) => player.id === playerId);
  return index < 0 ? 1 : (index % SEAT_COUNT) + 1;
}

export function TurnRail({
  room,
  game,
  selfPlayerId,
  deltas,
  maxEntries = DEFAULT_MAX_ENTRIES,
}: TurnRailProps) {
  const entries = buildActivityLog(game, room, deltas, selfPlayerId)
    .slice(-maxEntries)
    .reverse();
  const turnState = resolveTurnState(room, game, selfPlayerId);
  const mineCount = entries.filter((entry) => entry.origin === "local").length;

  return (
    <aside aria-label="Players and activity" className="hud-rail" data-slot="turn-rail">
      <section aria-labelledby="turn-rail-seats-heading" className="hud-rail-block">
        <header className="hud-rail-header">
          <h2 className="hud-rail-heading" id="turn-rail-seats-heading">
            Seats
          </h2>
          <span className="hud-sub">
            {game.players.length}/{room.capacity}
          </span>
        </header>
        <TurnStateNotice state={turnState} />
        <ol className="hud-seat-list">
          {game.players.map((player) => (
            <SeatRow
              active={player.id === game.activePlayerId}
              key={player.id}
              member={memberFor(room, player.id)}
              name={playerName(room, player.id)}
              player={player}
              self={player.id === selfPlayerId}
              slot={seatSlot(game, player.id)}
            />
          ))}
        </ol>
      </section>
      <section
        aria-labelledby="turn-rail-log-heading"
        className="hud-rail-block hud-rail-block--log"
      >
        <header className="hud-rail-header">
          <h2 className="hud-rail-heading" id="turn-rail-log-heading">
            Activity
          </h2>
          {/*
            "dipisah yang sendiri atau lawan" — the header states the split in
            numbers so the mine/theirs treatment on the rows below has a legend
            rather than being something the player has to infer.
          */}
          <span className="hud-sub" data-slot="turn-rail-log-count">
            {mineCount} you · {entries.length} all · R{game.revision}
          </span>
        </header>
        <ActivityLog entries={entries} />
      </section>
    </aside>
  );
}

/**
 * The committed-event log. Exported so the feedback layer (or a test) can
 * render it on its own with entries it built itself.
 */
export function ActivityLog({
  entries,
  emptyLabel = "No entries committed yet.",
}: {
  readonly entries: readonly ActivityLogEntry[];
  readonly emptyLabel?: string;
}) {
  const history = useHistoryEntryIds(entries);
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <div
      aria-label="Activity log"
      /*
       * `role="log"` carries an implicit `aria-live="polite"`, which would read
       * out every inserted row on every poll — on top of the feedback layer's
       * own batched announcement ("2 updates committed. Latest: …"). The batch
       * summary is the better utterance, so the log keeps the log ROLE (it is
       * still identified and navigable as a log) but hands announcement duty to
       * that single live region rather than double-announcing every event.
       */
      aria-live="off"
      className="hud-log"
      data-slot="turn-rail-log"
      role="log"
      tabIndex={0}
    >
      {entries.length === 0 ? (
        <p className="hud-log-empty">{emptyLabel}</p>
      ) : (
        <ol className="hud-log-list">
          {entries.map((entry) => (
            <ActivityLogRow
              arrival={!reduceMotion && !history.has(entry.id)}
              entry={entry}
              key={entry.id}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The event ids that were already on screen when the log first rendered.
 *
 * Those rows are history and render at rest — no inline `opacity: 0` ever
 * reaches the markup, so the first synchronous render (and the static render the
 * tests assert on) is already the correct resting state and never depends on
 * JavaScript to become visible. Everything else is an arrival and gets the 160ms
 * fade, which is what makes the motion mean "this line is new" rather than "the
 * panel just loaded".
 *
 * Keyed on ids, not on a revision high-water mark: one committed engine command
 * emits several events that all share ONE revision (this is exactly why a bot's
 * whole turn used to land as a single burst), so a revision threshold would
 * mistake the tail of an in-flight turn for history. A row only animates when its
 * DOM node mounts, so an id being "an arrival" forever is harmless — it can only
 * play once.
 */
function useHistoryEntryIds(entries: readonly ActivityLogEntry[]): ReadonlySet<string> {
  const [history] = useState(() => new Set(entries.map((entry) => entry.id)));
  return history;
}

function ActivityLogRow({
  arrival,
  entry,
}: {
  readonly arrival: boolean;
  readonly entry: ActivityLogEntry;
}) {
  const clock = clockLabel(entry.occurredAt);
  const delta = entry.delta === null ? null : formatDelta(entry.delta);
  const origin = entry.origin;
  const glyph = originGlyph(entry);

  /*
   * §7.1's 160ms row insertion, expressed in Motion so the reduced-motion
   * decision lives in one place. Opacity plus a 4px transform — a transform
   * cannot reflow the list, so a row arriving never nudges the rows a player is
   * mid-read of. No spring and no stagger: the log is where the game is
   * followed, and staggering would delay information to decorate it.
   */
  const arrivalProps = arrival
    ? {
        initial: { opacity: 0, y: -4 },
        animate: { opacity: 1, y: 0 },
        transition: {
          duration: CHROME_MOTION_MS.base / 1_000,
          ease: EASING_STANDARD_BEZIER,
        },
      }
    : {};

  return (
    <m.li
      className={cn("hud-log-row", entry.slot === undefined ? null : `hud-seat-${entry.slot}`)}
      data-event={entry.eventType ?? "unknown"}
      data-origin={origin ?? "unknown"}
      data-revision={entry.revision}
      data-slot="turn-rail-activity"
      {...arrivalProps}
    >
      <span className="hud-log-body">
        <time className="hud-log-time" dateTime={entry.occurredAt}>
          {clock}
        </time>
        {glyph === null ? null : (
          <span className="hud-log-origin" data-slot="turn-rail-activity-origin">
            <span aria-hidden="true">{glyph}</span>
            {/*
              The sentence already names the actor, so opponent and office rows
              need nothing extra — but nothing in "Avery rolled 4." tells a
              screen-reader user that Avery is *them*. The mine/theirs split is
              therefore stated in text on the viewer's own rows only, rather
              than left to the tonal step and the seat rule (§8).
            */}
            {origin === "local" ? <span className="sr-only">Your action.</span> : null}
          </span>
        )}
        <span className="hud-log-text">{entry.text}</span>
      </span>
      {delta === null ? null : (
        <span
          className={cn(
            "hud-log-delta",
            entry.delta !== null && entry.delta.amount > 0 && "hud-log-delta--gain",
            entry.delta !== null && entry.delta.amount < 0 && "hud-log-delta--loss",
          )}
          data-slot="turn-rail-activity-delta"
        >
          {delta}
        </span>
      )}
    </m.li>
  );
}

/**
 * The scannable origin stamp: `You` on the viewer's own rows, `S2` on another
 * seat's (the same number the board token and the dossier glyph carry), `Ops`
 * for the office acting on its own. Uppercased in CSS, so assistive tech reads
 * words rather than shouted letters.
 */
function originGlyph(entry: ActivityLogEntry): string | null {
  if (entry.origin === "local") return "You";
  if (entry.origin === "system") return "Ops";
  if (entry.origin === "remote") return entry.slot === undefined ? "Opp" : `S${entry.slot}`;
  return null;
}

function SeatRow({
  active,
  member,
  name,
  player,
  self,
  slot,
}: {
  readonly active: boolean;
  readonly member: RoomMemberProjection | undefined;
  readonly name: string;
  readonly player: PublicPlayerProjection;
  readonly self: boolean;
  readonly slot: number;
}) {
  const isBot = member?.isBot ?? false;
  const away = !isBot && !player.connected;

  return (
    <li
      className={cn(
        "hud-seat-row",
        active && "hud-seat-row--active",
        away && "hud-seat-row--away",
      )}
      data-active={active ? "true" : "false"}
      data-slot="turn-rail-seat"
    >
      <span aria-hidden="true" className={cn("hud-seat-glyph", `hud-seat-${slot}`)}>
        {slot}
      </span>
      <span className="hud-seat-main">
        {/*
          The glyph itself is aria-hidden (a bare "3" announces as noise), so the
          seat number has to reach assistive tech some other way — identity is
          never colour alone (§8) and the colour is the only other carrier.
          `sr-only` is absolutely positioned, so it does not disturb this flex
          column. It sits inside `hud-seat-main` rather than beside it because
          `.hud-seat-row` is a fixed three-column grid.
        */}
        <span className="sr-only">Seat {slot}.</span>
        <span className="hud-seat-name">
          {name}
          {self ? " (you)" : ""}
        </span>
        {/*
          Three unbreakable parts joined by breakable separators: the line is
          allowed to wrap (an ellipsis here hid the cash value in a 320px rail),
          but never mid-fact — "Tile / 13" reads as two facts instead of one.
        */}
        <span className="hud-seat-meta">
          <span className="hud-seat-fact">{rankLabel(player)}</span>
          {" · "}
          <span className="hud-seat-fact">Tile {tileLabel(player.position)}</span>
          {" · "}
          <span className="hud-seat-fact">
            ${formatNumber(player.resources["money"] ?? 0)}
          </span>
        </span>
      </span>
      <span className="hud-seat-status">
        {active ? (
          <span
            className="hud-tag hud-tag--accent hud-fade-in"
            data-slot="turn-rail-active-tag"
          >
            Active
          </span>
        ) : null}
        {isBot ? (
          <span className="hud-seat-state" data-slot="turn-rail-bot-tag">
            <span aria-hidden="true" className="hud-led hud-led--remote" />
            Bot{member?.botDifficulty ? ` · ${difficultyLabel(member.botDifficulty)}` : ""}
          </span>
        ) : (
          <span className="hud-seat-state" data-slot="turn-rail-connection">
            <span
              aria-hidden="true"
              className={cn("hud-led", player.connected ? "hud-led--online" : "hud-led--away")}
            />
            {player.connected ? "Online" : "Away"}
          </span>
        )}
      </span>
    </li>
  );
}

type TurnState = {
  readonly tone: "attention" | "remote" | "idle";
  readonly text: string;
  /** Changes whenever the turn changes, so the tag replays its 160ms fade. */
  readonly key: string;
  /**
   * Display seat 1..6 of whoever holds the turn, or `null` when nobody does.
   * Present so "waiting on Ada" can be tied back to a token on the board by
   * number, not by remembering which colour Ada is (§8).
   */
  readonly slot: number | null;
};

/**
 * Whose move it is, in plain words. Bots are driven server-side on a delay, so
 * "waiting on <bot>" is a real, sustained state the human sits in — it must
 * read as calm instrumentation, never as a frozen screen.
 */
export function resolveTurnState(
  room: RoomProjection,
  game: PublicGameProjection,
  selfPlayerId: string,
): TurnState {
  if (game.status === "ended") {
    return { tone: "idle", text: "Match closed", key: "ended", slot: null };
  }
  if (game.status !== "active") {
    return { tone: "idle", text: "Standing by", key: `status:${game.status}`, slot: null };
  }

  const activePlayerId = game.activePlayerId;
  if (activePlayerId === null) {
    return { tone: "idle", text: "Awaiting server", key: "awaiting", slot: null };
  }
  if (activePlayerId === selfPlayerId) {
    return {
      tone: "attention",
      text: "Your move",
      key: `self:${activePlayerId}`,
      slot: seatSlot(game, activePlayerId),
    };
  }

  const member = memberFor(room, activePlayerId);
  const name = playerName(room, activePlayerId);
  const suffix = member?.isBot
    ? ` · Bot${member.botDifficulty ? ` ${difficultyLabel(member.botDifficulty)}` : ""}`
    : "";

  return {
    tone: "remote",
    text: `Waiting on ${name}${suffix}`,
    key: `remote:${activePlayerId}`,
    slot: seatSlot(game, activePlayerId),
  };
}

function TurnStateNotice({ state }: { readonly state: TurnState }) {
  return (
    <p className="hud-wait" data-slot="turn-rail-turn-state" data-tone={state.tone}>
      <span aria-hidden="true" className={cn("hud-led", `hud-led--${state.tone}`)} />
      <TurnStateSeatChip slot={state.slot} />
      <span className="hud-wait-text hud-fade-in" key={state.key}>
        {state.text}
      </span>
    </p>
  );
}

/**
 * The seat number of whoever holds the turn, so a sustained bot turn is tied to
 * a specific token on the board. Exported because the room header's own
 * turn-state readout shows the same chip.
 */
export function TurnStateSeatChip({ slot }: { readonly slot: number | null }) {
  if (slot === null) return null;

  return (
    <span
      aria-hidden="true"
      className={cn("hud-seat-chip", `hud-seat-${slot}`)}
      data-slot="turn-state-seat-chip"
    >
      {slot}
    </span>
  );
}

export function playerName(room: RoomProjection, playerId: string): string {
  const member = memberFor(room, playerId);
  return member?.displayName ?? `Seat ${member?.seat ?? "?"}`;
}

export function memberFor(
  room: RoomProjection,
  playerId: string,
): RoomMemberProjection | undefined {
  return room.members.find((candidate) => candidate.id === playerId);
}

export function rankLabel(player: PublicPlayerProjection): string {
  const kind = player.rank.kind;
  if (kind === null || kind === "") return `Tier ${player.rank.index + 1}`;
  return sentenceCase(kind.replace("rank.", "").replaceAll("-", " "));
}

export function difficultyLabel(difficulty: BotDifficulty | string): string {
  return sentenceCase(difficulty.replaceAll("-", " "));
}

/** 1-based, zero-padded board position: tile 7 (index 6) renders as "07". */
export function tileLabel(position: number): string {
  return String(position + 1).padStart(2, "0");
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Builds the log from the committed event stream. Every known event type gets
 * a real sentence; an unrecognised type degrades to a readable fallback rather
 * than an empty row, so a new server event never blanks the log.
 */
export function buildActivityLog(
  game: PublicGameProjection,
  room: RoomProjection,
  deltas: readonly ActivityLogDelta[] = [],
  /**
   * Optional and last so existing two-argument callers keep compiling. Without
   * it no row can be marked as the viewer's own, which is correct for a
   * spectator or for the match report but wrong for the live rail — pass it.
   */
  selfPlayerId: string | null = null,
): readonly ActivityLogEntry[] {
  const decorations = new Map(deltas.map((delta) => [delta.eventId, delta]));

  return game.eventSummaries.map((event) => {
    const decoration = decorations.get(event.id);
    const actorPlayerId = event.actorPlayerId;
    const seated = actorPlayerId !== null && game.players.some((p) => p.id === actorPlayerId);

    return {
      id: event.id,
      revision: event.revision,
      occurredAt: event.occurredAt,
      text: decoration?.text ?? activitySentence(event, room),
      delta:
        decoration === undefined
          ? null
          : { amount: decoration.amount, ...(decoration.unit ? { unit: decoration.unit } : {}) },
      origin:
        actorPlayerId === null
          ? "system"
          : actorPlayerId === selfPlayerId
            ? "local"
            : "remote",
      eventType: event.type,
      // Only when the actor really holds a seat: `seatSlot` answers 1 for an
      // unknown id, and a row rendered in seat 1's colour for a player who is
      // not in seat 1 would be a lie about identity.
      ...(seated ? { slot: seatSlot(game, actorPlayerId) } : {}),
    } satisfies ActivityLogEntry;
  });
}

export function formatDelta(delta: ActivityLogDeltaValue): string {
  const sign = delta.amount < 0 ? "-" : "+";
  const magnitude = formatNumber(Math.abs(delta.amount));
  return delta.unit ? `${sign}${magnitude} ${delta.unit}` : `${sign}${magnitude}`;
}

/** Wall clock in UTC, parsed from the ISO string so it never depends on a
 * browser API or the host's timezone (this renders on the server too). */
export function clockLabel(occurredAt: string): string {
  return /T(\d{2}:\d{2}:\d{2})/.exec(occurredAt)?.[1] ?? "--:--:--";
}

const eventSentences: Readonly<Record<string, string>> = {
  GameStarted: "opened the match",
  TurnStarted: "started their turn",
  PlayerMoved: "moved their token",
  SalaryAwarded: "passed reception and collected salary",
  TileResolved: "resolved their tile",
  CardStored: "filed a card for later",
  CardPlayed: "played a card",
  EffectProposed: "proposed an effect",
  EffectPrevented: "prevented an effect",
  ResourceChanged: "had resources adjusted",
  StatusApplied: "picked up a status effect",
  PromptOpened: "reached a decision point",
  PromptResolved: "answered a decision point",
  ReactionWindowOpened: "opened a reaction window",
  PromotionAttempted: "attempted a promotion",
  PromotionBlocked: "had a promotion blocked",
  ManagementRevealed: "revealed a management role",
  PlayerPromoted: "was promoted",
  ClockDeckExhausted: "exhausted the clock deck",
  MatchEnded: "closed out the match",
};

function activitySentence(event: SafeEventSummary, room: RoomProjection): string {
  const actor = event.actorPlayerId === null ? "The office" : playerName(room, event.actorPlayerId);

  if (event.type === "DiceRolled") return diceSentence(event, actor);
  if (event.type === "CardDrawn") {
    return `${actor} drew ${cardTitle(event.card.definitionId, event.card.nameKey)} from the ${deckName(event.card.deckId)} deck.`;
  }

  const known = eventSentences[event.type];
  if (known !== undefined) return `${actor} ${known}.`;
  return `${actor} triggered ${humanizeEventType(event.type)}.`;
}

/**
 * Movement rolls exactly ONE six-sided die; only the audit-release response
 * rolls 2d6. Always render however many faces the event actually carries.
 */
function diceSentence(
  event: Extract<SafeEventSummary, { readonly type: "DiceRolled" }>,
  actor: string,
): string {
  const faces = event.dice;
  const purpose = dicePurposeSuffix(event.purpose);

  if (faces.length === 0) return `${actor} rolled ${event.total}${purpose}.`;
  if (faces.length === 1) return `${actor} rolled ${faces[0]}${purpose}.`;
  return `${actor} rolled ${faces.join(" + ")} for ${event.total}${purpose}.`;
}

function dicePurposeSuffix(purpose: string): string {
  if (purpose === "" || purpose === "normal-movement") return "";
  if (purpose === "audit-release") return " to leave audit review";
  return ` for ${purpose.replaceAll("-", " ")}`;
}

/**
 * Authored deck cards are gaining OPTIONAL display-name fields in
 * packages/content, so this prefers an authored name when one exists and
 * otherwise derives the title from the definition id (or the name key).
 */
function cardTitle(definitionId: string, nameKey: string): string {
  const authored = authoredCardName(definitionId);
  if (authored !== null) return authored;

  const source = definitionId === "" ? nameKey : definitionId;
  const tail = source.split(".").at(-1) ?? source;
  return sentenceCase(tail.replaceAll("-", " "));
}

function authoredCardName(definitionId: string): string | null {
  for (const deck of deadlineDashContent.decks) {
    for (const card of deck.cards) {
      if (card.id !== definitionId) continue;
      const named: { readonly displayName?: unknown } = card;
      return typeof named.displayName === "string" && named.displayName.length > 0
        ? named.displayName
        : null;
    }
  }
  return null;
}

function deckName(deckId: string): string {
  return deckId.replace("deck.", "").replaceAll("-", " ");
}

function humanizeEventType(type: string): string {
  const spaced = type
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.length === 0 ? "an unlabelled event" : spaced.toLowerCase();
}

function sentenceCase(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
