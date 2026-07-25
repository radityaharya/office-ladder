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
  start: "border-primary bg-primary/25 text-primary",
  department: "border-info/70 bg-info/20 text-info",
  action: "border-info/70 bg-info/20 text-info",
  policy: "border-warning/80 bg-warning/25 text-warning",
  transit: "border-foreground/40 bg-muted/60 text-foreground",
  safe: "border-primary/60 bg-primary/15 text-primary",
  corner: "border-foreground/40 bg-muted/70 text-foreground",
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
  1: "bg-player-1 [background-image:repeating-linear-gradient(45deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px)]",
  2: "bg-player-2 [background-image:radial-gradient(var(--background)_1px,transparent_1px)] [background-size:3px_3px]",
  3: "bg-player-3 [background-image:repeating-linear-gradient(-45deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px)]",
  4: "bg-player-4 [background-image:repeating-linear-gradient(0deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px)]",
  5: "bg-player-5 [background-image:conic-gradient(var(--background)_25%,transparent_0_50%,var(--background)_0_75%,transparent_0)] [background-size:4px_4px]",
  6: "bg-player-6 [background-image:repeating-linear-gradient(45deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px),repeating-linear-gradient(-45deg,transparent_0,transparent_2px,var(--background)_2px,var(--background)_3px)]",
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
        "group/tile relative flex min-h-14 min-w-14 flex-col overflow-hidden rounded-sm border-2 bg-card p-1.5 text-card-foreground outline-none transition-[border-color,filter,transform] duration-150 sm:p-2",
        kindStyles[space.kind],
        active && "z-10 border-foreground ring-2 ring-foreground ring-offset-2 ring-offset-background",
        space.inactive && "opacity-55 grayscale",
      )}
      data-active={active || undefined}
      data-board-index={space.index}
      data-kind={space.kind}
      data-placement={space.placement}
      role="listitem"
      style={gridStyle}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-current" />
      <span className="flex items-start justify-between gap-1 text-[0.625rem] leading-none font-bold tracking-wider uppercase">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 sm:size-4" />
        <span className="font-mono tabular-nums opacity-80">{space.index + 1}</span>
      </span>
      <span className="mt-auto line-clamp-2 font-sans text-[0.6875rem] leading-tight font-bold break-words text-foreground sm:text-xs">
        {space.label}
      </span>
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
