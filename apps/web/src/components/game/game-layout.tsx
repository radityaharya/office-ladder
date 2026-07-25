import type { ReactNode } from "react";

type GameLayoutProps = {
  readonly hud: ReactNode;
  readonly board: ReactNode;
  readonly actionTray: ReactNode;
  readonly turnRail: ReactNode;
};

export function GameLayout({
  hud,
  board,
  actionTray,
  turnRail,
}: GameLayoutProps) {
  return (
    <div className="relative flex h-full w-full flex-col" data-slot="game-layout">
      {hud}
      <div
        className="flex min-h-0 flex-1 items-center justify-center p-2 pt-16 pb-20 sm:p-3 sm:pt-20 sm:pr-68 sm:pb-24"
        data-slot="game-board-region"
      >
        {board}
      </div>
      <div data-slot="game-action-region">{actionTray}</div>
      <div data-slot="game-turn-rail-region">{turnRail}</div>
    </div>
  );
}
