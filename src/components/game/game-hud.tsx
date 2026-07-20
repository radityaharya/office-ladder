import {
  RiArrowLeftLine,
  RiCoinsLine,
  RiErrorWarningLine,
  RiFlashlightLine,
  RiHistoryLine,
  RiMapPin2Line,
  RiRefreshLine,
  RiShieldStarLine,
  RiUserStarLine,
} from "@remixicon/react";
import Link from "next/link";

import type {
  PublicGameProjection,
  PublicPlayerProjection,
  RoomProjection,
  SafeEventSummary,
} from "@/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type GameHudProps = {
  readonly room: RoomProjection;
  readonly game: PublicGameProjection;
  readonly selfPlayerId: string;
  readonly canRoll: boolean;
  readonly isRolling: boolean;
  readonly rollError: string | null;
  readonly onRoll: () => void;
};

const resourceIcons = {
  money: RiCoinsLine,
  reputation: RiShieldStarLine,
  energy: RiFlashlightLine,
  "work-counter": RiHistoryLine,
} as const;

export function GameHud({
  room,
  game,
  selfPlayerId,
  canRoll,
  isRolling,
  rollError,
  onRoll,
}: GameHudProps) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const selfPlayer = game.players.find((player) => player.id === selfPlayerId);

  return (
    <div className="contents">
      <header className="order-1 flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between lg:col-span-2 lg:row-start-1">
        <div className="min-w-0 space-y-1">
          <Link
            className="inline-flex items-center gap-2 font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase hover:text-foreground"
            href={`/rooms/${room.id}`}
          >
            <RiArrowLeftLine aria-hidden="true" className="size-4" />
            Room {room.code}
          </Link>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Deadline Dash
          </h1>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
          <span>Round {game.round}</span>
          <span>Turn {game.turnNumber}</span>
          <span className="text-foreground">{phaseLabel(game.phase)}</span>
        </div>
      </header>

      <section
        aria-label="Your resources"
        className="order-2 flex min-w-0 snap-x gap-6 overflow-x-auto border-b border-border bg-card px-4 py-3 [scrollbar-gutter:stable] lg:col-span-2 lg:row-start-2"
      >
        {selfPlayer ? (
          <>
            <ResourceItem icon={RiMapPin2Line} label="Position" value={`${selfPlayer.position + 1} / 44`} />
            {Object.entries(selfPlayer.resources).map(([resource, value]) => (
              <ResourceItem
                icon={resourceIcon(resource)}
                key={resource}
                label={resourceLabel(resource)}
                value={value.toLocaleString()}
              />
            ))}
            <ResourceItem icon={RiUserStarLine} label="Rank" value={rankLabel(selfPlayer)} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Spectating the current office scramble.</p>
        )}
      </section>

      <aside className="order-5 border border-border bg-card lg:col-start-2 lg:row-start-3" aria-labelledby="turn-rail-title">
        <div className="border-b border-border px-4 py-4">
          <h2 id="turn-rail-title" className="font-heading text-lg font-semibold tracking-wider uppercase">
            Turn rail
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {activePlayer ? `${playerName(room, activePlayer.id)} is at position ${activePlayer.position + 1}.` : "The match is resolving."}
          </p>
        </div>
        <div role="list" aria-label="Players in seat order">
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
      </aside>

      <section className="order-6 border border-border bg-card p-4 lg:col-start-2 lg:row-start-4" aria-labelledby="activity-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="activity-title" className="font-heading text-lg font-semibold tracking-wider uppercase">
            Activity
          </h2>
          <RiHistoryLine aria-hidden="true" className="size-4 text-muted-foreground" />
        </div>
        <ActivityList events={game.eventSummaries} room={room} />
      </section>

      <section
        aria-labelledby="action-dock-title"
        className="order-4 border border-border bg-card p-4 shadow-sm lg:sticky lg:bottom-4 lg:col-start-1 lg:row-start-4"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 id="action-dock-title" className="font-heading text-lg font-semibold tracking-wider uppercase">
              {canRoll ? "Your move" : "Stand by"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {canRoll
                ? "Roll to advance. Movement and the resulting tile are committed by the seeded server engine."
                : `${activePlayer ? playerName(room, activePlayer.id) : "The server"} currently owns the next action.`}
            </p>
            {rollError ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-destructive" role="alert">
                <RiErrorWarningLine aria-hidden="true" className="size-4" />
                {rollError}
              </p>
            ) : null}
          </div>
          <Button aria-busy={isRolling} disabled={!canRoll || isRolling} onClick={onRoll} size="lg" type="button">
            {isRolling ? <RiRefreshLine aria-hidden="true" className="animate-spin" /> : null}
            {isRolling ? "Rolling" : "Roll dice"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ResourceItem({ icon: Icon, label, value }: { readonly icon: typeof RiCoinsLine; readonly label: string; readonly value: string }) {
  return (
    <div className="flex shrink-0 snap-start items-center gap-3">
      <Icon aria-hidden="true" className="size-4 text-primary" />
      <div>
        <p className="font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">{label}</p>
        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  );
}

function PlayerRow({ active, name, player, self }: { readonly active: boolean; readonly name: string; readonly player: PublicPlayerProjection; readonly self: boolean }) {
  return (
    <div className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0", active && "bg-primary/10 ring-1 ring-inset ring-primary/50")} role="listitem">
      <span className="flex size-7 items-center justify-center border border-border bg-background font-mono text-xs font-semibold tabular-nums">{player.seat}</span>
      <div className="min-w-0">
        <p className="truncate font-heading text-sm font-semibold text-foreground">{name}{self ? " (you)" : ""}</p>
        <p className="truncate text-xs text-muted-foreground">{rankLabel(player)} · Position {player.position + 1}</p>
      </div>
      <span className={cn("font-sans text-xs font-semibold tracking-widest uppercase", active ? "text-primary" : "text-muted-foreground")}>{active ? "Acting" : player.connected ? "Online" : "Away"}</span>
    </div>
  );
}

function ActivityList({ events, room }: { readonly events: readonly SafeEventSummary[]; readonly room: RoomProjection }) {
  const recentEvents = events.slice(-5).reverse();
  if (recentEvents.length === 0) return <p className="mt-4 text-sm text-muted-foreground">No committed incidents yet. The first roll will start the paper trail.</p>;

  return (
    <ol className="mt-4 divide-y divide-border">
      {recentEvents.map((event) => (
        <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0" key={event.id}>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">R{event.revision}</span>
          <p className="text-sm text-foreground">{event.actorPlayerId ? playerName(room, event.actorPlayerId) : "System"} · {eventLabel(event.type)}</p>
        </li>
      ))}
    </ol>
  );
}

function playerName(room: RoomProjection, playerId: string): string {
  return room.members.find((member) => member.id === playerId)?.displayName ?? `Seat ${room.members.find((member) => member.id === playerId)?.seat ?? "?"}`;
}

function rankLabel(player: PublicPlayerProjection): string {
  return player.rank.kind?.replace("rank.", "").replaceAll("-", " ") ?? `Rank ${player.rank.index + 1}`;
}

function phaseLabel(phase: string): string {
  return phase.replaceAll("-", " ").replaceAll("_", " ");
}

function resourceLabel(resource: string): string {
  return resource.replace("resource.", "").replaceAll("-", " ");
}

function resourceIcon(resource: string): typeof RiCoinsLine {
  switch (resource) {
    case "money":
    case "resource.money":
      return resourceIcons.money;
    case "reputation":
    case "resource.reputation":
      return resourceIcons.reputation;
    case "energy":
    case "resource.energy":
      return resourceIcons.energy;
    case "work-counter":
    case "resource.work-counter":
      return resourceIcons["work-counter"];
    default:
      return RiCoinsLine;
  }
}

function eventLabel(type: string): string {
  return type.replaceAll(".", " ").replaceAll("-", " ");
}
