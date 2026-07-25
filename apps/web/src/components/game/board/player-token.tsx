import { cn } from "../../../lib/utils";

import type { PlayerTokenView } from "./types";

const seatStyles = {
  1: "bg-player-1 [background-image:repeating-linear-gradient(45deg,transparent_0,transparent_3px,var(--background)_3px,var(--background)_4px)] [clip-path:polygon(0_0,75%_0,100%_25%,100%_100%,0_100%)]",
  2: "bg-player-2 [background-image:radial-gradient(var(--background)_1px,transparent_1px)] [background-size:4px_4px]",
  3: "bg-player-3 [background-image:repeating-linear-gradient(-45deg,transparent_0,transparent_3px,var(--background)_3px,var(--background)_4px)] [clip-path:polygon(25%_0,100%_0,100%_100%,0_100%,0_25%)]",
  4: "bg-player-4 [background-image:repeating-linear-gradient(0deg,transparent_0,transparent_3px,var(--background)_3px,var(--background)_4px)]",
  5: "bg-player-5 [background-image:conic-gradient(var(--background)_25%,transparent_0_50%,var(--background)_0_75%,transparent_0)] [background-size:6px_6px] [clip-path:polygon(0_0,100%_0,100%_75%,75%_100%,25%_100%,0_75%)]",
  6: "bg-player-6 [background-image:repeating-linear-gradient(45deg,transparent_0,transparent_3px,var(--background)_3px,var(--background)_4px),repeating-linear-gradient(-45deg,transparent_0,transparent_3px,var(--background)_3px,var(--background)_4px)]",
} as const satisfies Record<PlayerTokenView["seat"], string>;

type PlayerTokenProps = {
  readonly player: PlayerTokenView;
  readonly compact?: boolean;
};

export function PlayerToken({ player, compact = false }: PlayerTokenProps) {
  return (
    <span
      aria-label={`${player.name}, seat ${player.seat}`}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-xs border border-foreground font-sans text-[0.6875rem] leading-none font-black text-background ring-2 ring-background transition-[filter,opacity,transform] duration-150",
        compact ? "size-5" : "size-7",
        seatStyles[player.seat],
        player.state === "current" && "z-10 scale-110 ring-primary",
        player.state === "disconnected" && "opacity-60 grayscale",
        player.state === "eliminated" && "opacity-40 grayscale",
      )}
      data-player-seat={player.seat}
      data-state={player.state ?? "idle"}
      title={`${player.name}, seat ${player.seat}`}
    >
      <span className="bg-foreground/90 px-0.5 text-background">
        {player.initials ?? player.seat}
      </span>
    </span>
  );
}
