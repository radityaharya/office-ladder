import { RiHistoryLine } from "@remixicon/react";

import type {
  PublicGameProjection,
  PublicPlayerProjection,
  RoomProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";

import { cn } from "@/lib/utils";

type TurnRailProps = {
  readonly room: RoomProjection;
  readonly game: PublicGameProjection;
  readonly selfPlayerId: string;
};

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

export function playerColorClass(seat: number, kind: "bg" | "ring" = "bg"): string {
  const table = kind === "bg" ? playerBgClasses : playerRingClasses;
  return table[seat as keyof typeof table] ?? (kind === "bg" ? "bg-muted-foreground" : "ring-muted-foreground");
}

export function TurnRail({ room, game, selfPlayerId }: TurnRailProps) {
  return (
    <aside
      aria-label="Players and activity"
      className="pointer-events-auto absolute top-20 right-4 z-30 hidden max-h-[calc(100%-6rem)] w-64 flex-col gap-3 sm:flex"
      data-slot="turn-rail"
    >
      <div
        className="flex flex-col gap-1.5 overflow-y-auto rounded-2xl border border-border bg-card/95 p-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] backdrop-blur"
        role="list"
        aria-label="Players in seat order"
      >
        {game.players.map((player) => (
          <PlayerRow
            active={player.id === game.activePlayerId}
            key={player.id}
            name={playerName(room, player.id)}
            player={player}
            self={player.id === selfPlayerId}
          />
        ))}
      </div>
      <ActivityTicker events={game.eventSummaries} room={room} />
    </aside>
  );
}

function PlayerRow({
  active,
  name,
  player,
  self,
}: {
  readonly active: boolean;
  readonly name: string;
  readonly player: PublicPlayerProjection;
  readonly self: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors",
        active ? "bg-primary/20 ring-1 ring-primary/40" : "bg-transparent",
      )}
      data-slot="turn-rail-seat"
      role="listitem"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full font-sans text-sm font-black text-background",
          playerColorClass(player.seat),
          active && "ring-2 ring-foreground",
          !player.connected && "opacity-50 grayscale",
        )}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-sm font-semibold text-foreground">
          {name}
          {self ? " (you)" : ""}
        </p>
        <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">
          {rankLabel(player)} · P{player.position + 1}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 font-sans text-[0.625rem] font-semibold tracking-[0.08em] uppercase",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {active ? "Acting" : player.connected ? "Online" : "Away"}
      </span>
    </div>
  );
}

function ActivityTicker({
  events,
  room,
}: {
  readonly events: readonly SafeEventSummary[];
  readonly room: RoomProjection;
}) {
  const recentEvents = events.slice(-5).reverse();

  return (
    <section
      aria-label="Recent activity"
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] backdrop-blur"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <p className="font-sans text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          Activity
        </p>
        <RiHistoryLine aria-hidden="true" className="size-4 text-muted-foreground" />
      </div>
      {recentEvents.length === 0 ? (
        <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          No moves yet.
        </p>
      ) : (
        <ol className="min-h-0 divide-y divide-border overflow-y-auto">
          {recentEvents.map((event) => (
            <li
              className="flex items-baseline gap-2 px-3 py-2.5"
              data-slot="turn-rail-activity"
              key={event.id}
            >
              <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
                R{event.revision}
              </span>
              <p className="min-w-0 truncate text-xs leading-relaxed text-foreground">
                {activitySentence(event, room)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function playerName(room: RoomProjection, playerId: string): string {
  const member = room.members.find((candidate) => candidate.id === playerId);
  return member?.displayName ?? `Seat ${member?.seat ?? "?"}`;
}

export function rankLabel(player: PublicPlayerProjection): string {
  return player.rank.kind?.replace("rank.", "").replaceAll("-", " ") ?? `Rank ${player.rank.index + 1}`;
}

const eventSentences: Readonly<Record<string, string>> = {
  TurnStarted: "started their turn",
  DiceRolled: "rolled the dice",
  PlayerMoved: "moved across the board",
  TileResolved: "resolved a tile",
  ResourceChanged: "had a resource change",
  PlayerPromoted: "got promoted",
  CardDrawn: "drew a card",
  GameStarted: "kicked off the match",
  PromptOpened: "hit a decision point",
  PromptResolved: "made a call",
};

function activitySentence(event: SafeEventSummary, room: RoomProjection): string {
  const actor = event.actorPlayerId ? playerName(room, event.actorPlayerId) : "The office";
  const action = eventSentences[event.type] ?? eventLabel(event.type);
  return `${actor} ${action}`;
}

function eventLabel(type: string): string {
  const label = type.replaceAll(".", " ").replaceAll("-", " ");
  return label.charAt(0).toLowerCase() + label.slice(1);
}
