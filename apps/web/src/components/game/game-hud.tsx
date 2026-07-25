import {
  RiArrowLeftLine,
  RiCoinsLine,
  RiFlashlightLine,
  RiHistoryLine,
  RiMapPin2Line,
  RiShieldStarLine,
  RiUserStarLine,
} from "@remixicon/react";
import { Link } from "@tanstack/react-router";

import type {
  PublicGameProjection,
  PublicPlayerProjection,
  RoomProjection,
} from "@office-ladder/contracts";

import { playerColorClass, playerName, rankLabel } from "./turn-rail";

type GameHudProps = {
  readonly room: RoomProjection;
  readonly game: PublicGameProjection;
  readonly selfPlayerId: string;
};

const resourceIcons = {
  money: RiCoinsLine,
  reputation: RiShieldStarLine,
  energy: RiFlashlightLine,
  "work-counter": RiHistoryLine,
} as const;

const resourceLabels = {
  money: "Cash",
  reputation: "Rep",
  energy: "Energy",
  "work-counter": "Work",
} as const;

export function GameHud({ room, game, selfPlayerId }: GameHudProps) {
  const selfPlayer = game.players.find((player) => player.id === selfPlayerId);

  return (
    <>
      <TopBar game={game} room={room} />
      <ResourceDock selfPlayer={selfPlayer} />
    </>
  );
}

function TopBar({
  game,
  room,
}: {
  readonly game: PublicGameProjection;
  readonly room: RoomProjection;
}) {
  const activeName = game.activePlayerId ? playerName(room, game.activePlayerId) : null;

  return (
    <header
      className="pointer-events-auto absolute top-3 left-3 z-30 flex items-center gap-2 sm:top-4 sm:left-4"
      data-slot="game-header-region"
    >
      <Link
        aria-label={`Back to room ${room.code}`}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)] backdrop-blur hover:bg-muted hover:text-foreground sm:size-11"
        params={{ roomId: room.id }}
        to="/rooms/$roomId"
      >
        <RiArrowLeftLine aria-hidden="true" className="size-5" />
      </Link>
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-card/95 py-2 pr-4 pl-4 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)] backdrop-blur">
        <p className="font-heading text-sm font-semibold tracking-tight text-foreground sm:text-base">
          Deadline Dash
        </p>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <p className="font-mono text-xs font-medium tracking-wide text-muted-foreground">
          {room.code}
        </p>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <p className="font-mono text-xs tracking-wide text-muted-foreground">
          R{game.round}.{game.turnNumber}
        </p>
        {activeName ? (
          <>
            <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:inline-block" />
            <p className="hidden font-sans text-xs font-semibold text-primary sm:inline-block">
              {activeName}&rsquo;s turn
            </p>
          </>
        ) : null}
      </div>
    </header>
  );
}

function ResourceDock({ selfPlayer }: { readonly selfPlayer?: PublicPlayerProjection }) {
  if (!selfPlayer) {
    return (
      <p
        className="pointer-events-none absolute bottom-3 left-3 z-30 rounded-full border border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground backdrop-blur sm:bottom-4 sm:left-4"
        data-slot="game-resources-region"
      >
        Spectating
      </p>
    );
  }

  return (
    <section
      aria-label="Your resources"
      className="pointer-events-auto absolute bottom-3 left-3 z-30 flex flex-wrap items-center gap-2 sm:bottom-4 sm:left-4"
      data-slot="game-resources-region"
    >
      <span
        aria-hidden="true"
        className={`size-3 shrink-0 rounded-full ${playerColorClass(selfPlayer.seat, "bg")}`}
      />
      <ResourceChip icon={RiMapPin2Line} label="Tile" value={`${selfPlayer.position + 1}/44`} />
      {Object.entries(selfPlayer.resources).map(([resource, value]) => (
        <ResourceChip
          icon={resourceIcon(resource)}
          key={resource}
          label={resourceLabel(resource)}
          value={value.toLocaleString()}
        />
      ))}
      <ResourceChip icon={RiUserStarLine} label="Rank" value={rankLabel(selfPlayer)} />
    </section>
  );
}

function ResourceChip({
  icon: Icon,
  label,
  value,
}: {
  readonly icon: typeof RiCoinsLine;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/95 py-1.5 pr-3.5 pl-2.5 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)] backdrop-blur">
      <Icon aria-hidden="true" className="size-4 text-primary" />
      <span className="flex flex-col leading-none">
        <span className="font-mono text-sm font-bold tabular-nums text-foreground">{value}</span>
        <span className="hidden font-sans text-[0.5625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:block">
          {label}
        </span>
      </span>
    </span>
  );
}

function resourceLabel(resource: string): string {
  const key = resource.replace("resource.", "") as keyof typeof resourceLabels;
  return resourceLabels[key] ?? resource.replaceAll("-", " ");
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
