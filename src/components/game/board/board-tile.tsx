import {
  RiArrowRightLine,
  RiBriefcase4Line,
  RiCalendarEventLine,
  RiFlagLine,
  RiGovernmentLine,
  RiShieldCheckLine,
  RiVipDiamondLine,
} from "@remixicon/react";

import { cn } from "../../../lib/utils";

import { PlayerToken } from "./player-token";
import type { BoardSpaceKind, BoardSpaceView, PlayerTokenView } from "./types";

const kindStyles = {
  start: "border-primary/50 bg-primary/10 text-primary",
  department: "border-sky-400/35 bg-sky-400/10 text-sky-300",
  action: "border-blue-400/35 bg-blue-400/10 text-blue-300",
  policy: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  transit: "border-foreground/25 bg-muted/40 text-foreground",
  safe: "border-emerald-300/30 bg-emerald-300/8 text-emerald-200",
  corner: "border-violet-400/35 bg-violet-400/10 text-violet-300",
} as const satisfies Record<BoardSpaceKind, string>;

const kindIcons = {
  start: RiFlagLine,
  department: RiBriefcase4Line,
  action: RiCalendarEventLine,
  policy: RiGovernmentLine,
  transit: RiArrowRightLine,
  safe: RiShieldCheckLine,
  corner: RiVipDiamondLine,
} as const satisfies Record<BoardSpaceKind, typeof RiFlagLine>;

const ownerStyles = {
  1: "bg-sky-400 [background-image:repeating-linear-gradient(45deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px)]",
  2: "bg-amber-400 [background-image:radial-gradient(var(--background)_1px,transparent_1px)] [background-size:3px_3px]",
  3: "bg-fuchsia-400 [background-image:repeating-linear-gradient(-45deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px)]",
  4: "bg-indigo-400 [background-image:repeating-linear-gradient(0deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px)]",
  5: "bg-orange-400 [background-image:conic-gradient(var(--background)_25%,transparent_0_50%,var(--background)_0_75%,transparent_0)] [background-size:4px_4px]",
  6: "bg-violet-400 [background-image:repeating-linear-gradient(45deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px),repeating-linear-gradient(-45deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px)]",
} as const satisfies Record<NonNullable<BoardSpaceView["ownerSeat"]>, string>;

type BoardTileProps = {
  readonly space: BoardSpaceView;
  readonly players: readonly PlayerTokenView[];
  readonly active: boolean;
  readonly gridStyle: BoardGridPosition;
  readonly totalSpaces: number;
};

export type BoardGridPosition = {
  readonly gridColumn: number;
  readonly gridRow: number;
};

function occupantText(players: readonly PlayerTokenView[]): string {
  if (players.length === 0) return "no players";
  if (players.length === 1) return players[0]?.name ?? "one player";

  return `${players
    .slice(0, -1)
    .map((player) => player.name)
    .join(", ")} and ${players.at(-1)?.name}`;
}

export function BoardTile({
  space,
  players,
  active,
  gridStyle,
  totalSpaces,
}: BoardTileProps) {
  const Icon = kindIcons[space.kind];
  const owner = space.ownerSeat ? `owned by seat ${space.ownerSeat}` : "unowned";
  const accessibleName = `Position ${space.index + 1} of ${totalSpaces}, ${space.label}, ${space.categoryLabel}, ${owner}, ${occupantText(players)}`;

  return (
    <li
      aria-label={accessibleName}
      className={cn(
        "group/tile relative flex min-h-12 min-w-12 flex-col overflow-hidden rounded-xs border bg-card p-1.5 text-card-foreground outline-none transition-[border-color,filter,transform] duration-150",
        kindStyles[space.kind],
        active && "z-10 border-primary ring-2 ring-primary ring-offset-2 ring-offset-background",
        space.inactive && "opacity-55 grayscale",
      )}
      data-active={active || undefined}
      data-board-index={space.index}
      data-kind={space.kind}
      data-placement={space.placement}
      role="listitem"
      style={gridStyle}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-current" />
      <span className="flex items-start justify-between gap-1 text-[0.6875rem] leading-none font-semibold tracking-wider uppercase">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="font-mono tabular-nums opacity-70">{space.index + 1}</span>
      </span>
      <span className="mt-auto line-clamp-2 font-sans text-[0.6875rem] leading-tight font-semibold text-foreground sm:text-xs">
        {space.label}
      </span>
      {space.detail ? (
        <span className="mt-1 hidden truncate font-mono text-[0.6875rem] leading-none text-muted-foreground sm:block">
          {space.detail}
        </span>
      ) : null}
      {space.ownerSeat ? (
        <span
          aria-label={`Owned by seat ${space.ownerSeat}`}
          className={cn(
            "absolute right-1 bottom-1 size-2 border border-foreground",
            ownerStyles[space.ownerSeat],
          )}
        />
      ) : null}
      {players.length > 0 ? (
        <span className="absolute right-1 top-4 flex -space-x-1.5">
          {players.map((player) => (
            <PlayerToken compact key={player.id} player={player} />
          ))}
        </span>
      ) : null}
    </li>
  );
}
