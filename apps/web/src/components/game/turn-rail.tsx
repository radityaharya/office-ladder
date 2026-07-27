import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { type KeyboardEvent, type ReactNode, useState } from "react";

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
  /**
   * Short lowercase unit suffix, e.g. `"rep"`, `"energy"`, `"work"`.
   *
   * `"money"` is the one special case: it renders as a `$` PREFIX (`-$200`)
   * rather than a trailing word, matching `formatPanelSignedMoney` in the panel
   * kit so the same amount reads the same in both places. Omit the unit
   * entirely for a bare count.
   */
  readonly unit?: string;
};

/** The unit token that renders a delta as cash. See {@link ActivityLogDeltaValue}. */
export const MONEY_UNIT = "money";

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

/* -------------------------------------------------------------------------- */
/* The rail seam — what the shell renders, what a panel owner fills in.       */
/*                                                                            */
/* plans/24-gameplay-v2-spec.md §8.5: v2 needs twelve rail destinations (hand, */
/* projects, market/auction, agreements, ballots, objectives, heat, chat,      */
/* quarter/event track, on top of seats, activity and the card feed). Twelve   */
/* stacked blocks is the crowded rail the spec rejects, and twelve TABS is the */
/* same scroll column turned sideways, so the destinations are grouped into    */
/* FIVE tabs and the three things a player needs continuously — whose turn it  */
/* is, the turn clock, and their own resources — never go behind a tab at all: */
/* they live in the rail's persistent head above the tab strip.                */
/*                                                                            */
/* Ownership: this file owns the rail SHELL (head, tab strip, panel frames,    */
/* attention badges and the two panels the shell has real data for — seats and */
/* activity). Everything else arrives through `panels`: one entry per          */
/* destination, whose `content` is rendered inside that panel's body. A        */
/* destination with no entry renders its resting empty state rather than       */
/* disappearing, so the rail's shape is the same at every stage of the build.  */
/* -------------------------------------------------------------------------- */

/** The five tab groups. Grouping, not twelve tabs — see the note above. */
export type RailGroupId = "table" | "work" | "market" | "social" | "track";

/** Every destination §8.5 names, plus the two the shell fills itself. */
export type RailDestinationId =
  | "seats"
  | "heat"
  | "quarter"
  | "hand"
  | "projects"
  | "objectives"
  | "market"
  | "agreements"
  | "ballots"
  | "chat"
  | "activity"
  | "feed";

/**
 * "Something in here needs you." Presentational only at this stage: wave 4
 * computes the real counts. `count` is rendered as a number so the badge is
 * never colour alone (DESIGN.md §8); `tone` only chooses which status token the
 * badge's hairline borrows.
 */
export type RailAttention = {
  readonly count?: number;
  readonly tone?: "info" | "caution" | "critical";
};

/** One destination's contributed content. See the seam note above. */
export type RailPanelContent = {
  readonly id: RailDestinationId;
  /** Rendered inside the panel body. Omit to keep the resting empty state. */
  readonly content?: ReactNode;
  readonly attention?: RailAttention | null;
  /** Optional right-aligned readout in the panel header, e.g. "3/6". */
  readonly summary?: string;
  /** `data-slot` for that readout. Defaults to `rail-panel-summary`. */
  readonly summarySlot?: string;
};

type RailDestinationMeta = {
  readonly title: string;
  /**
   * The group's primary surface: it takes the height the fixed-floor panels
   * beside it do not. Exactly one destination per group sets this.
   */
  readonly grow: boolean;
  /** Resting state. A true statement about an empty panel, never "TODO". */
  readonly empty: string;
};

export const RAIL_DESTINATIONS = {
  seats: { title: "Seats", grow: false, empty: "No seats taken yet." },
  activity: { title: "Activity", grow: true, empty: "No entries committed yet." },
  hand: { title: "Hand", grow: true, empty: "Your hand is empty." },
  projects: { title: "Projects", grow: false, empty: "No projects on the floor yet." },
  objectives: { title: "Objectives", grow: false, empty: "No objectives assigned yet." },
  market: { title: "Market", grow: true, empty: "Nothing listed." },
  agreements: { title: "Agreements", grow: false, empty: "No agreements in force." },
  heat: { title: "Heat", grow: false, empty: "No pressure recorded yet." },
  ballots: { title: "Ballots", grow: false, empty: "No ballot open." },
  chat: { title: "Chat", grow: true, empty: "No messages yet." },
  quarter: { title: "Quarter", grow: false, empty: "The quarter track is not open yet." },
  feed: { title: "Card feed", grow: true, empty: "No cards or events yet." },
} as const satisfies Record<RailDestinationId, RailDestinationMeta>;

type RailGroup = {
  readonly id: RailGroupId;
  readonly label: string;
  readonly destinations: readonly RailDestinationId[];
};

/**
 * Tab order, left to right. Two or three destinations each: any more and the
 * group becomes the scroll column the tabs exist to avoid (each non-primary
 * panel carries a 108px floor in hud.css so it cannot be squeezed to nothing).
 *
 * TABLE is first and open by default because it is the rail this view already
 * had — the seat dossiers and the activity log — and the log is how a match is
 * followed at all ("i genuinely cant follow the game"). Nothing about the new
 * destinations is allowed to demote it.
 *
 * The other four group by the question a player is asking:
 *   WORK    what am I holding and what am I working towards
 *   MARKET  what the floor's economy is doing
 *   SOCIAL  what the other seats and I are deciding together
 *   TRACK   what the office is doing to us, over time
 */
export const RAIL_GROUPS = [
  { id: "table", label: "Table", destinations: ["seats", "activity"] },
  { id: "work", label: "Work", destinations: ["hand", "projects", "objectives"] },
  { id: "market", label: "Market", destinations: ["market", "agreements", "heat"] },
  { id: "social", label: "Social", destinations: ["ballots", "chat"] },
  { id: "track", label: "Track", destinations: ["quarter", "feed"] },
] as const satisfies readonly RailGroup[];

type TurnRailProps = {
  readonly room: RoomProjection;
  readonly game: PublicGameProjection;
  readonly selfPlayerId: string;
  /** Resource deltas keyed by event id. Optional and purely additive. */
  readonly deltas?: readonly ActivityLogDelta[];
  /** How many of the newest entries to keep rendered. */
  readonly maxEntries?: number;
  /** Contributed destination content. See {@link RailPanelContent}. */
  readonly panels?: readonly RailPanelContent[];
  /** Which tab is open on first render. */
  readonly defaultGroup?: RailGroupId;
  /**
   * The playback catch-up control, hosted in the rail head.
   *
   * It belongs here rather than in the action region under the board: it
   * appears and vanishes during event playback, and in the action region that
   * moved the board 32px every time (measured 631px -> 599px). The rail's own
   * box is a definite grid track in game-shell.css, so a control arriving here
   * redistributes rail height and costs the board nothing.
   */
  readonly catchUp?: ReactNode;
  /**
   * The fixed lane at the end of the turn-state row.
   *
   * It used to hold `clockLabel(game.deadlineAt)` — a wall-clock INSTANT rendered
   * by a `/T(\d{2}:\d{2}:\d{2})/` regex, which is a timestamp and not a
   * countdown. §12.3 wants time pressure as a depleting bar, and the shell's HUD
   * header already carries one (`TurnClock` in game-hud.tsx) in a region that is
   * always in flow, so the rail no longer states the turn deadline at all: a
   * second bar 320px away would spend rail width to say the same thing twice and
   * read the same sr-only sentence twice.
   *
   * The lane stays — reserved, so nothing arriving in it can shove the state text
   * sideways — and defaults to the match's own position in time, which is what the
   * rail actually wants there. A host with a *different* clock to show (a docked
   * rail with no HUD above it) can pass an instrument instead.
   */
  readonly clock?: ReactNode;
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
  panels = [],
  defaultGroup = "table",
  catchUp = null,
  clock,
}: TurnRailProps) {
  const entries = buildActivityLog(game, room, deltas, selfPlayerId)
    .slice(-maxEntries)
    .reverse();
  const turnState = resolveTurnState(room, game, selfPlayerId);
  const mineCount = entries.filter((entry) => entry.origin === "local").length;
  const [openGroup, setOpenGroup] = useState<RailGroupId>(defaultGroup);
  const contributed = new Map(panels.map((panel) => [panel.id, panel]));

  /*
   * The two panels the shell has real data for. Both are contributed through the
   * same map every other destination goes through, so there is exactly one code
   * path for "what is inside a panel" — and wave 4 can override either by
   * passing its own entry for that id.
   */
  const built = new Map<RailDestinationId, RailPanelContent>([
    [
      "seats",
      {
        id: "seats",
        summary: `${game.players.length}/${room.capacity}`,
        content: (
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
        ),
      },
    ],
    [
      "activity",
      {
        id: "activity",
        /*
         * "dipisah yang sendiri atau lawan" — the header states the split in
         * numbers so the mine/theirs treatment on the rows below has a legend
         * rather than being something the player has to infer.
         */
        summary: `${mineCount} you · ${entries.length} all · R${game.revision}`,
        summarySlot: "turn-rail-log-count",
        content: <ActivityLog entries={entries} />,
      },
    ],
  ]);

  /**
   * Contributed entries MERGE over the built-in ones rather than replacing
   * them, so a caller can badge or re-summarise a panel the shell already fills
   * — `{ id: "seats", attention: { count: 1 } }` must not blank the roster.
   */
  function panelFor(id: RailDestinationId): RailPanelContent | undefined {
    const base = built.get(id);
    const extra = contributed.get(id);
    if (extra === undefined) return base;
    if (base === undefined) return extra;

    return {
      ...base,
      ...extra,
      content: extra.content ?? base.content,
      summary: extra.summary ?? base.summary,
      summarySlot: extra.summarySlot ?? base.summarySlot,
    };
  }

  return (
    <aside aria-label="Match rail" className="hud-rail" data-slot="turn-rail">
      {/*
        The persistent head. Never behind a tab, never conditional: whose turn it
        is, the turn clock, every seat as a numbered chip, and the local seat's
        own resources. It is an `auto` row of the rail's own grid, so when it
        does change height — a long "waiting on" line wrapping, the catch-up
        control arriving — the panel viewport below absorbs it. The rail's
        outside box is a definite track either way, so the board never moves.
      */}
      <div className="hud-rail-head" data-slot="rail-head">
        <TurnStateNotice clock={clock ?? <RailMatchPosition game={game} />} state={turnState} />
        <RailSeatStrip activePlayerId={game.activePlayerId} game={game} room={room} />
        <RailSelfReadout game={game} selfPlayerId={selfPlayerId} />
        {catchUp === null ? null : (
          <div className="hud-rail-aside" data-slot="rail-catchup">
            {catchUp}
          </div>
        )}
      </div>
      <RailTabs
        attention={groupAttention(panelFor)}
        onSelect={setOpenGroup}
        openGroup={openGroup}
      />
      <div className="hud-rail-viewport" data-slot="rail-viewport">
        {RAIL_GROUPS.map((group) => (
          <div
            aria-labelledby={`rail-tab-${group.id}`}
            className="hud-rail-group"
            data-group={group.id}
            data-slot="rail-group"
            hidden={group.id !== openGroup}
            id={`rail-group-${group.id}`}
            key={group.id}
            role="tabpanel"
            tabIndex={0}
          >
            {group.destinations.map((id) => (
              <RailPanel id={id} key={id} panel={panelFor(id)} />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

/**
 * One destination's frame: a 28px uppercase header (§6.3) and a body that
 * scrolls internally rather than growing the rail. The frame is always rendered
 * — a destination with nothing in it states that in words instead of vanishing,
 * so the rail's shape does not change as panels get wired up.
 */
function RailPanel({
  id,
  panel,
}: {
  readonly id: RailDestinationId;
  readonly panel: RailPanelContent | undefined;
}) {
  const meta = RAIL_DESTINATIONS[id];
  const attention = panel?.attention ?? null;
  const content = panel?.content ?? null;

  return (
    <section
      aria-labelledby={`rail-panel-${id}-heading`}
      /* `--log` is retained on the activity panel: hud.css and its tests have
         named that block since before the rail was tabbed. */
      className={cn("hud-rail-block", id === "activity" && "hud-rail-block--log")}
      data-grow={meta.grow ? "true" : "false"}
      data-panel={id}
      data-slot="rail-panel"
    >
      <header className="hud-rail-header">
        <h2 className="hud-rail-heading" id={`rail-panel-${id}-heading`}>
          {meta.title}
        </h2>
        {attention === null ? null : <RailFlag attention={attention} />}
        {panel?.summary === undefined ? null : (
          <span className="hud-sub" data-slot={panel.summarySlot ?? "rail-panel-summary"}>
            {panel.summary}
          </span>
        )}
      </header>
      {content === null ? (
        <p className="hud-rail-empty" data-slot="rail-panel-empty">
          {meta.empty}
        </p>
      ) : (
        /*
         * Contributed content gets its own scroll box, and that is load-bearing
         * rather than tidy.
         *
         * A panel mounted `chrome="none"` (which is how every kit destination is
         * mounted here — `RailPanel` already draws the header) has NO scroll body:
         * `Panel`'s own `.panel-body` is part of the chrome it just dropped.
         * Meanwhile exactly one block per group is `flex: 1 1 auto` with
         * `min-height: 0`, so in a short rail it shrinks to zero and its content
         * had nothing to clip it — measured in Chrome at a 240px rail: the Hand
         * block was 0px tall while 162px of its content painted straight over the
         * Projects panel below, so both panels' empty-state prose rendered on top
         * of each other and neither was readable.
         *
         * The rail's own built-in content (the activity log) never showed this
         * because it carries its own `overflow: auto`. This box is that guarantee,
         * applied once for every destination instead of per panel.
         */
        <div
          className="game-shell-rail-panel-body"
          data-slot="rail-panel-body"
          /* A scroll container with no tab stop hides its own overflow from
             keyboard users (§8). */
          tabIndex={0}
        >
          {content}
        </div>
      )}
    </section>
  );
}

/** In-panel attention marker: an LED and the count as text, never colour alone. */
function RailFlag({ attention }: { readonly attention: RailAttention }) {
  const count = attention.count ?? 0;

  return (
    <span className="hud-rail-flag" data-slot="rail-panel-flag" data-tone={attention.tone ?? "info"}>
      <span aria-hidden="true" className={cn("hud-led", `hud-led--${ledTone(attention.tone)}`)} />
      {count > 0 ? formatNumber(count) : "New"}
    </span>
  );
}

function ledTone(tone: RailAttention["tone"]): string {
  if (tone === "critical") return "away";
  if (tone === "caution") return "attention";
  return "remote";
}

/**
 * The tab strip. Five destinations groups, each with a badge lane that is
 * ALWAYS rendered — an arriving badge must not widen its tab and shove the
 * strip sideways, which is the same class of bug as a notice moving the board.
 */
function RailTabs({
  attention,
  onSelect,
  openGroup,
}: {
  readonly attention: ReadonlyMap<RailGroupId, RailAttention>;
  readonly onSelect: (group: RailGroupId) => void;
  readonly openGroup: RailGroupId;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = RAIL_GROUPS.length;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % count
        : event.key === "ArrowLeft"
          ? (index - 1 + count) % count
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? count - 1
              : null;
    if (next === null) return;

    const group = RAIL_GROUPS[next];
    if (group === undefined) return;

    event.preventDefault();
    onSelect(group.id);
    const strip = event.currentTarget.parentElement;
    strip?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div
      aria-label="Rail destinations"
      className="hud-rail-tabs"
      data-slot="rail-tabs"
      role="tablist"
    >
      {RAIL_GROUPS.map((group, index) => {
        const open = group.id === openGroup;
        const flag = attention.get(group.id);
        const count = flag?.count ?? 0;

        return (
          <button
            aria-controls={`rail-group-${group.id}`}
            aria-selected={open}
            className="hud-rail-tab"
            data-group={group.id}
            data-slot="rail-tab"
            id={`rail-tab-${group.id}`}
            key={group.id}
            onClick={() => onSelect(group.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            role="tab"
            tabIndex={open ? 0 : -1}
            type="button"
          >
            <span className="hud-rail-tab-label">{group.label}</span>
            {/* Reserved lane. Empty carries no border and no glyph, so the tab
                measures the same whether or not anything needs the player. */}
            <span
              className="hud-rail-tab-badge"
              data-empty={flag === undefined ? "true" : "false"}
              data-slot="rail-tab-badge"
              data-tone={flag?.tone ?? "info"}
            >
              {flag === undefined ? null : count > 0 ? formatNumber(count) : "·"}
              {flag === undefined ? null : (
                <span className="sr-only">
                  {count > 0 ? ` ${count} need attention.` : " Needs attention."}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A group's badge is the sum of its destinations' counts, at the worst tone any
 * of them reported — a player should not have to open a tab to find out that
 * one of the two panels behind it wants them.
 */
function groupAttention(
  panelFor: (id: RailDestinationId) => RailPanelContent | undefined,
): ReadonlyMap<RailGroupId, RailAttention> {
  const table = new Map<RailGroupId, RailAttention>();

  for (const group of RAIL_GROUPS) {
    let count = 0;
    let tone: RailAttention["tone"] | undefined;
    let flagged = false;

    for (const id of group.destinations) {
      const attention = panelFor(id)?.attention;
      if (!attention) continue;
      flagged = true;
      count += attention.count ?? 0;
      tone = worstTone(tone, attention.tone);
    }

    if (!flagged) continue;
    table.set(group.id, { count, ...(tone === undefined ? {} : { tone }) });
  }

  return table;
}

const TONE_RANK = { info: 0, caution: 1, critical: 2 } as const;

function worstTone(
  current: RailAttention["tone"],
  candidate: RailAttention["tone"],
): RailAttention["tone"] {
  if (candidate === undefined) return current;
  if (current === undefined) return candidate;
  return TONE_RANK[candidate] > TONE_RANK[current] ? candidate : current;
}

/**
 * Every seat as a numbered chip, in turn order, always visible.
 *
 * The dossier rows live behind the TABLE tab; this is the answer to "still cant
 * see all seats" at any width and on any tab — six 16px chips fit the narrowest
 * rail measure, and the chip carries the seat NUMBER, so it ties to a board
 * token without relying on colour (§8).
 */
function RailSeatStrip({
  activePlayerId,
  game,
  room,
}: {
  readonly activePlayerId: string | null;
  readonly game: PublicGameProjection;
  readonly room: RoomProjection;
}) {
  return (
    <ol className="hud-rail-seat-strip" data-slot="rail-seat-strip">
      {game.players.map((player) => {
        const slot = seatSlot(game, player.id);
        const active = player.id === activePlayerId;
        const member = memberFor(room, player.id);
        const away = !(member?.isBot ?? false) && !player.connected;

        return (
          <li
            className="hud-rail-seat-slot"
            data-slot="rail-seat-chip"
            data-state={active ? "active" : away ? "away" : "idle"}
            key={player.id}
          >
            <span aria-hidden="true" className={cn("hud-seat-chip", `hud-seat-${slot}`)}>
              {slot}
            </span>
            <span className="sr-only">
              Seat {slot}, {playerName(room, player.id)}
              {active ? ", active" : away ? ", away" : ""}.
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The local seat's own numbers, held beside the turn state so they are legible
 * without opening a tab. The HUD strip above the board carries the same figures
 * at full width; this is the copy that survives a narrow rail and the stacked
 * mobile sheet, where the strip has scrolled out of the way.
 */
function RailSelfReadout({
  game,
  selfPlayerId,
}: {
  readonly game: PublicGameProjection;
  readonly selfPlayerId: string;
}) {
  const player = game.players.find((candidate) => candidate.id === selfPlayerId);

  return (
    <dl className="hud-rail-self" data-slot="rail-self">
      <div className="hud-rail-self-cell">
        <dt className="hud-label">Cash</dt>
        <dd className="hud-sub">{player ? `$${formatNumber(player.resources["money"] ?? 0)}` : "—"}</dd>
      </div>
      <div className="hud-rail-self-cell">
        <dt className="hud-label">Rep</dt>
        <dd className="hud-sub">{player ? formatNumber(player.resources["reputation"] ?? 0) : "—"}</dd>
      </div>
      <div className="hud-rail-self-cell">
        <dt className="hud-label">Energy</dt>
        <dd className="hud-sub">{player ? formatNumber(player.resources["energy"] ?? 0) : "—"}</dd>
      </div>
    </dl>
  );
}

/**
 * Where the match is in its own time: round and turn number.
 *
 * The lane's default content, and a real answer to a question the rail is the
 * right place for — "how far in are we" — rather than the wall-clock instant that
 * used to sit here. Every panel in the rail states its deadlines in ROUNDS
 * (§12.4), so the round number is the unit that makes those readable; a
 * `hh:mm:ss` string had no relationship to any of them.
 *
 * Static by construction: two integers off the projection, no clock, no timer,
 * identical in `renderToStaticMarkup` and in the browser.
 */
function RailMatchPosition({ game }: { readonly game: PublicGameProjection }) {
  return (
    <>
      <span className="sr-only">Round </span>
      {`R${formatNumber(game.round)} · T${formatNumber(game.turnNumber)}`}
    </>
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

function TurnStateNotice({
  clock,
  state,
}: {
  readonly clock: ReactNode;
  readonly state: TurnState;
}) {
  return (
    <p className="hud-wait" data-slot="turn-rail-turn-state" data-tone={state.tone}>
      <span aria-hidden="true" className={cn("hud-led", `hud-led--${state.tone}`)} />
      <TurnStateSeatChip slot={state.slot} />
      <span className="hud-wait-text hud-fade-in" key={state.key}>
        {state.text}
      </span>
      {/* A reserved lane, whatever is in it: an instrument arriving here cannot
          shift the state text beside it (the same reason `.hud-delta-slot`
          exists). See `TurnRailProps.clock`. */}
      <span className="hud-wait-clock" data-slot="rail-turn-clock">
        {clock}
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
 * Builds the log from the committed event stream.
 *
 * Two passes, and the second one is the point.
 *
 * 1. **Describe.** Every event becomes a {@link LogLine} — a sentence in the
 *    right grammatical person, plus the signed amount when the projection
 *    actually carries one. See {@link describeEvent}.
 * 2. **Fold.** A line that says nothing the line above it has not already said
 *    is absorbed into it rather than getting a row of its own. One committed
 *    turn used to spend five rows saying "started their turn / had resources
 *    adjusted / resolved their tile / moved their token / rolled 4"; four of
 *    those five carried no fact at all.
 *
 * A line is only ever folded into an anchor **from the same revision**, i.e.
 * from the same committed command, and only when it carries no delta and no
 * caller decoration. Nothing that holds a number is ever dropped, and an event
 * with nothing above it to fold into keeps its own row — the log loses events
 * only when they were pure restatement.
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
  const context: LogContext = { room, selfPlayerId };
  const kept: ActivityLogEntry[] = [];
  let anchorRevision: number | null = null;

  for (const event of game.eventSummaries) {
    const decoration = decorations.get(event.id);
    const described = describeEvent(event, context);

    /*
     * The row belongs to whoever the line is ABOUT, which is not always the
     * command's actor: the server attributes every bookkeeping event to the
     * seat that issued the command, so a card that charges an opponent emits a
     * `ResourceChanged` stamped with the *player's* id. Colouring that row for
     * the actor would say the wrong seat lost the money.
     */
    const subjectPlayerId = described.subjectPlayerId ?? event.actorPlayerId;
    const seated = subjectPlayerId !== null && game.players.some((p) => p.id === subjectPlayerId);
    const delta =
      decoration === undefined
        ? described.delta
        : { amount: decoration.amount, ...(decoration.unit ? { unit: decoration.unit } : {}) };

    const entry = {
      id: event.id,
      revision: event.revision,
      occurredAt: event.occurredAt,
      text: decoration?.text ?? described.text,
      delta,
      origin:
        subjectPlayerId === null
          ? "system"
          : subjectPlayerId === selfPlayerId
            ? "local"
            : "remote",
      eventType: event.type,
      // Only when the subject really holds a seat: `seatSlot` answers 1 for an
      // unknown id, and a row rendered in seat 1's colour for a player who is
      // not in seat 1 would be a lie about identity.
      ...(seated ? { slot: seatSlot(game, subjectPlayerId) } : {}),
    } satisfies ActivityLogEntry;

    const folds =
      described.folds && decoration === undefined && delta === null && anchorRevision === event.revision;
    if (folds) continue;

    kept.push(entry);
    anchorRevision = event.revision;
  }

  return kept;
}

export function formatDelta(delta: ActivityLogDeltaValue): string {
  const sign = delta.amount < 0 ? "-" : "+";
  const magnitude = formatNumber(Math.abs(delta.amount));
  if (delta.unit === MONEY_UNIT) return `${sign}$${magnitude}`;
  return delta.unit ? `${sign}${magnitude} ${delta.unit}` : `${sign}${magnitude}`;
}

/** Wall clock in UTC, parsed from the ISO string so it never depends on a
 * browser API or the host's timezone (this renders on the server too). */
export function clockLabel(occurredAt: string): string {
  return /T(\d{2}:\d{2}:\d{2})/.exec(occurredAt)?.[1] ?? "--:--:--";
}

/* -------------------------------------------------------------------------- */
/* The log's vocabulary.                                                       */
/*                                                                             */
/* The governing complaint is "i genuinely cant follow the game", and the log   */
/* is the instrument a player follows it with. Two rules hold everything below  */
/* together:                                                                    */
/*                                                                             */
/*   SAY THE THING. "Had resources adjusted" is a shrug: it names no resource,  */
/*   no direction and no amount. Every line here either states a real fact or   */
/*   folds into the line above it. No line restates a number the delta column   */
/*   already shows, and no line invents one the projection does not carry.      */
/*                                                                             */
/*   OWN VERSUS OPPONENT IS GRAMMATICAL, not a name tag. The viewer's own lines */
/*   are written in the SECOND PERSON ("You paid the audit fine.") and every    */
/*   other seat's in the third ("Ada paid the audit fine."). That is a          */
/*   structural difference a reader parses before they have read the name, and  */
/*   it survives into assistive tech, which the tonal step and the seat rule do */
/*   not. See plans/24-gameplay-v2-spec.md §12.1.                               */
/* -------------------------------------------------------------------------- */

type LogContext = {
  readonly room: RoomProjection;
  readonly selfPlayerId: string | null;
};

/**
 * One seat's grammatical forms. Built once per line so a sentence never has to
 * branch on "is this me" itself, which is how the second-person voice stays
 * consistent instead of being applied to whichever sentences someone remembered.
 */
type LogVoice = {
  /** Sentence subject: `You`, `Ada`, `The office`. */
  readonly subject: string;
  /** Leading possessive: `Your`, `Ada's`, `The office's`. */
  readonly possessive: string;
  /** Mid-sentence possessive: `your`, `Ada's`, `the office's`. */
  readonly possessiveMid: string;
  readonly were: "were" | "was";
  readonly have: "have" | "has";
  readonly are: "are" | "is";
};

function voiceFor(context: LogContext, playerId: string | null): LogVoice {
  if (playerId === null) {
    return {
      subject: "The office",
      possessive: "The office's",
      possessiveMid: "the office's",
      were: "was",
      have: "has",
      are: "is",
    };
  }
  if (playerId === context.selfPlayerId) {
    return {
      subject: "You",
      possessive: "Your",
      possessiveMid: "your",
      were: "were",
      have: "have",
      are: "are",
    };
  }

  const name = playerName(context.room, playerId);
  return {
    subject: name,
    possessive: `${name}'s`,
    possessiveMid: `${name}'s`,
    were: "was",
    have: "has",
    are: "is",
  };
}

type LogLine = {
  readonly text: string;
  readonly delta: ActivityLogDeltaValue | null;
  /**
   * Whom the line is about, when that is not the command's actor. Drives the
   * row's origin, seat rule and `You`/`S2` stamp.
   */
  readonly subjectPlayerId?: string;
  /**
   * True when this line adds nothing the line above it already said, so it may
   * be absorbed into it. Advisory: `buildActivityLog` still keeps the row when
   * there is no anchor from the same command to absorb it into, and never folds
   * a line that carries a number.
   */
  readonly folds: boolean;
};

/** A line that stands on its own and carries no amount. */
function stated(text: string): LogLine {
  return { text, delta: null, folds: false };
}

function describeEvent(event: SafeEventSummary, context: LogContext): LogLine {
  const actor = voiceFor(context, event.actorPlayerId);
  /*
   * Read before the switch narrows it away. The union is exhaustive, so inside
   * `default` the event is `never` — but the server is free to ship a type this
   * build has never heard of, and that row must still be readable rather than
   * blank.
   */
  const rawType: string = event.type;

  switch (event.type) {
    case "DiceRolled":
      return stated(diceSentence(event, actor.subject));
    case "CardDrawn":
      return stated(
        `${actor.subject} drew ${cardTitle(event.card.definitionId, event.card.nameKey)} from the ${deckName(event.card.deckId)} deck.`,
      );
    case "GameStarted":
      return stated(`${actor.subject} opened the match.`);
    /*
     * A turn boundary is a heading, not a sentence: three words, so a reader
     * scanning for where their own last turn began finds it by shape. hud.css
     * strengthens the hairline under `[data-event="TurnStarted"]` to match.
     */
    case "TurnStarted":
      return stated(`${actor.possessive} turn.`);
    case "PlayerMoved":
      return movementLine(event, actor);
    case "SalaryAwarded":
      return {
        text: `${actor.subject} collected salary at reception.`,
        delta: moneyDelta(numberField(event, "amount")),
        folds: false,
      };
    /*
     * Structural, never a story. What a tile DID arrives as the resource,
     * card-draw and status lines that follow it in the same command, and those
     * say it far better than "resolved their tile" ever could.
     */
    case "TileResolved":
      return { text: `${actor.possessive} tile resolved.`, delta: null, folds: true };
    case "ResourceChanged":
      return resourceLine(event, context, actor);
    /*
     * Pure plumbing: an effect being *offered* to the reaction layer. Its two
     * possible endings — `EffectPrevented` and `ResourceChanged` — are the
     * events with something to say, and they both get their own line.
     */
    case "EffectProposed":
      return { text: `${actor.subject} put an effect on the table.`, delta: null, folds: true };
    case "EffectPrevented": {
      const by = voiceFor(context, stringField(event, "preventedByPlayerId") ?? event.actorPlayerId);
      return stated(`${by.subject} blocked that effect.`);
    }
    case "CardStored":
      return stated(`${actor.subject} filed a card to play later.`);
    case "CardPlayed":
      return stated(`${actor.subject} played a card.`);
    case "StatusApplied":
      return statusLine(event, context, actor);
    case "PromptOpened":
      return stated(`${actor.subject} ${actor.have} a decision to make.`);
    case "ReactionWindowOpened":
      return stated(`${actor.subject} opened a reaction window.`);
    case "PromotionAttempted":
      return stated(`${actor.subject} went for a promotion.`);
    case "PromotionBlocked": {
      const blocker = stringField(event, "blockedByPlayerId");
      return stated(
        blocker === null
          ? `${actor.possessive} promotion was blocked.`
          : `${voiceFor(context, blocker).subject} blocked ${actor.possessiveMid} promotion.`,
      );
    }
    case "ManagementRevealed":
      return stated(`${actor.subject} ${actor.are} management. That is public now.`);
    case "PlayerPromoted":
      return promotionLine(event, actor);
    case "ClockDeckExhausted":
      return stated(`${actor.subject} ran the clock deck out.`);
    case "MatchEnded":
      return stated(`${actor.subject} closed out the match.`);
    default:
      return stated(`${actor.subject} triggered ${humanizeEventType(rawType)}.`);
  }
}

/**
 * Where a token went, when the projection says where.
 *
 * With no destination there is nothing here the roll on the line above has not
 * already said, so the line folds — "moved their token" after "rolled 4" is the
 * same fact twice.
 */
function movementLine(event: SafeEventSummary, actor: LogVoice): LogLine {
  const to = numberField(event, "to");
  if (to === null) return { text: `${actor.subject} moved.`, delta: null, folds: true };

  const distance = numberField(event, "distance");
  const step = distance === null ? "" : ` ${formatNumber(Math.abs(distance))}`;
  const lap = (numberField(event, "lapsGained") ?? 0) > 0 ? ", passing reception" : "";
  const where = `tile ${tileLabel(to)}`;
  const direction = stringField(event, "direction");

  if (direction === "teleport") return stated(`${actor.subject} was moved to ${where}${lap}.`);
  if (direction === "backward") return stated(`${actor.subject} went back${step} to ${where}${lap}.`);
  return stated(`${actor.subject} moved${step} to ${where}${lap}.`);
}

function promotionLine(event: SafeEventSummary, actor: LogVoice): LogLine {
  const rank = stringField(event, "toRank");
  const cost = numberField(event, "cost");

  return {
    text:
      rank === null
        ? `${actor.subject} ${actor.were} promoted.`
        : `${actor.subject} ${actor.were} promoted to ${rankName(rank)}.`,
    delta: cost === null || cost === 0 ? null : moneyDelta(-Math.abs(cost)),
    folds: false,
  };
}

function statusLine(event: SafeEventSummary, context: LogContext, actor: LogVoice): LogLine {
  const subjectPlayerId = stringField(event, "subjectPlayerId");
  const subject = subjectPlayerId === null ? actor : voiceFor(context, subjectPlayerId);
  const status = stringField(event, "status");

  return {
    text:
      status === null
        ? `${subject.subject} picked up a status effect.`
        : `${subject.subject} picked up a status effect: ${idPhrase(status, "status.")}.`,
    delta: null,
    folds: false,
    ...(subjectPlayerId === null ? {} : { subjectPlayerId }),
  };
}

/**
 * The line the whole task exists for.
 *
 * `ResourceChanged` is emitted twice or more per turn and used to render as
 * "had resources adjusted" every single time — no resource, no direction, no
 * amount, and attributed to whoever issued the command rather than to whoever
 * actually lost the money.
 *
 * With an amount it becomes a real sentence plus a signed mono delta, and the
 * row moves onto the affected seat. Without one it folds away entirely, because
 * a row that says only "something changed" is worse than no row: it costs a
 * reader a line of attention and repays nothing.
 */
function resourceLine(event: SafeEventSummary, context: LogContext, actor: LogVoice): LogLine {
  const subjectPlayerId = stringField(event, "subjectPlayerId");
  const subject = subjectPlayerId === null ? actor : voiceFor(context, subjectPlayerId);
  const attribution = subjectPlayerId === null ? {} : { subjectPlayerId };
  const amount = resourceAmount(event);

  if (amount === null || amount === 0) {
    return { text: `${subject.possessive} resources moved.`, delta: null, folds: true, ...attribution };
  }

  const resource = resourceCopy(stringField(event, "resource"));
  const reason = REASON_COPY[stringField(event, "reason") ?? ""];
  const predicate =
    reason === undefined
      ? `${amount < 0 ? "spent" : "gained"} ${resource.noun}`
      : amount < 0
        ? reason.loss
        : reason.gain;

  return {
    text: `${subject.subject} ${predicate}.`,
    delta: { amount, ...(resource.unit === null ? {} : { unit: resource.unit }) },
    folds: false,
    ...attribution,
  };
}

/**
 * Why a resource moved, in the player's words rather than the engine's.
 *
 * Keyed by the engine's own `ResourceChangedEvent.payload.reason` vocabulary
 * (`packages/engine/src/execution/economy.ts` and the transitions that emit
 * their own). Both directions are authored because a refund is not a charge:
 * "paid upkeep" with a `+` in front of it would be a contradiction the reader
 * has to resolve. An unlisted reason falls back to spent/gained on the
 * resource's own noun, which is still a true sentence.
 */
const REASON_COPY: Readonly<Record<string, { readonly gain: string; readonly loss: string }>> = {
  salary: { gain: "collected salary", loss: "gave back salary" },
  upkeep: { gain: "was refunded upkeep", loss: "paid upkeep" },
  "income-stream": { gain: "took income", loss: "lost income" },
  "loan-principal": { gain: "drew down a loan", loss: "returned loan money" },
  "loan-repayment": { gain: "was credited a repayment", loss: "repaid a loan" },
  "audit-fine": { gain: "had the audit fine refunded", loss: "paid the audit fine" },
  "promotion-cost": { gain: "was refunded a promotion", loss: "paid for a promotion" },
  "employee-promoted-out": { gain: "was paid out by a promotion", loss: "paid out on a promotion" },
  "tile-effect": { gain: "gained from the tile", loss: "paid the tile" },
  "tile-decision-cost": { gain: "was refunded the tile deal", loss: "paid for the tile deal" },
  "card-played": { gain: "gained from a card", loss: "paid for a card" },
  "pending-effect": { gain: "gained from an effect", loss: "paid an effect" },
  "reaction-window": { gain: "gained from a reaction", loss: "paid for a reaction" },
  "objective-reward": { gain: "banked an objective reward", loss: "gave back an objective reward" },
  "agreement-settlement": { gain: "was paid on an agreement", loss: "paid out on an agreement" },
  "project-payout": { gain: "was paid out by a project", loss: "returned a project payout" },
  "project-stake": { gain: "took back a project stake", loss: "staked a project" },
  "project-contribution": { gain: "was refunded a contribution", loss: "put money into a project" },
  "project-contribution-work": { gain: "was credited project work", loss: "put work into a project" },
  "project-failure-penalty": { gain: "recovered a project penalty", loss: "paid a project penalty" },
  "project-sabotage-cost": { gain: "recovered a sabotage cost", loss: "paid to sabotage a project" },
  "project-sabotage-concealment": {
    gain: "recovered a concealment cost",
    loss: "paid to conceal sabotage",
  },
  "placement-cost": { gain: "recovered a placement cost", loss: "paid to place on the board" },
  attack: { gain: "took from a rival", loss: "was hit by a rival" },
  "attack-cost": { gain: "recovered an attack cost", loss: "paid to move against a rival" },
  "attack-gain": { gain: "took from a rival", loss: "gave ground to a rival" },
  "burnout-recovery": { gain: "recovered from burnout", loss: "burned out" },
  "clock-deck-exhausted": { gain: "was settled at the buzzer", loss: "was settled at the buzzer" },
  "director-reached": { gain: "was settled on the win", loss: "was settled on the win" },
};

/**
 * The noun a resource is called in prose, and the unit its delta carries.
 *
 * Keyed on the resource KIND (`resource.money`), with the bare form accepted
 * too. Deliberately not keyed on `ResourceChangedEvent.payload.resourceId` —
 * that is a hashed per-player `createStableId("ResourceId", …)` and names
 * nothing a reader could use.
 */
const RESOURCE_COPY: Readonly<
  Record<string, { readonly noun: string; readonly unit: string | null }>
> = {
  money: { noun: "cash", unit: MONEY_UNIT },
  reputation: { noun: "reputation", unit: "rep" },
  energy: { noun: "energy", unit: "energy" },
  "work-counter": { noun: "work", unit: "work" },
  debt: { noun: "debt", unit: MONEY_UNIT },
  heat: { noun: "heat", unit: "heat" },
};

function resourceCopy(resource: string | null): { readonly noun: string; readonly unit: string | null } {
  if (resource === null) return { noun: "resources", unit: null };
  return RESOURCE_COPY[resource.replace("resource.", "")] ?? { noun: "resources", unit: null };
}

/**
 * How far a resource moved, signed.
 *
 * Accepts either shape the projection might carry: a pre-signed `amount`, or
 * the engine's own `previousValue`/`newValue` pair. Returns `null` when it
 * carries neither — an unknown amount renders without one rather than with a
 * guess.
 */
function resourceAmount(event: SafeEventSummary): number | null {
  const amount = numberField(event, "amount");
  if (amount !== null) return amount;

  const previous = numberField(event, "previousValue");
  const next = numberField(event, "newValue");
  return previous === null || next === null ? null : next - previous;
}

function moneyDelta(amount: number | null): ActivityLogDeltaValue | null {
  return amount === null || amount === 0 ? null : { amount, unit: MONEY_UNIT };
}

/* -------------------------------------------------------------------------- */
/* Optional payload readers.                                                   */
/*                                                                             */
/* `SafeEventSummary` gives `DiceRolled` and `CardDrawn` real payloads and      */
/* every other type nothing but metadata, which is exactly why the log could    */
/* only ever manage "had resources adjusted". These read the fields this        */
/* module WOULD say something with, structurally and defensively, so the log    */
/* states a real amount the moment the server passes one through and states     */
/* none until then. The field names mirror the engine's own payloads            */
/* (`packages/engine/src/events/index.ts`), plus `subjectPlayerId` for the      */
/* affected seat and `resource` for the resource kind.                          */
/* -------------------------------------------------------------------------- */

function numberField(event: SafeEventSummary, key: string): number | null {
  const value = (event as unknown as Readonly<Record<string, unknown>>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(event: SafeEventSummary, key: string): string | null {
  const value = (event as unknown as Readonly<Record<string, unknown>>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `status.next-salary-multiplier` → `next salary multiplier`. */
function idPhrase(id: string, prefix: string): string {
  return id.replace(prefix, "").replaceAll("-", " ");
}

/** `rank.senior-staff` → `Senior staff`. */
function rankName(rankId: string): string {
  return sentenceCase(idPhrase(rankId, "rank."));
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
