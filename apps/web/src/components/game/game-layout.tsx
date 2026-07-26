import type { ReactNode } from "react";

type GameLayoutProps = {
  readonly hud: ReactNode;
  readonly board: ReactNode;
  readonly actionTray: ReactNode;
  readonly turnRail: ReactNode;
};

/**
 * The match shell.
 *
 * Every structural region is a cell of one grid (`.game-shell` in
 * styles/game-shell.css), so the HUD chrome, board, rail and action bar all
 * resolve against the same row and column edges (DESIGN.md §4.5) instead of
 * reserving space for each other with padding offsets. Nothing here is
 * absolutely positioned and nothing floats: the rail is a real right column and
 * the action bar is a real full-width bottom row.
 *
 * DOM order is board -> action tray -> turn rail: the order a keyboard and a
 * screen reader should meet them in (look at the floor, act, then read
 * telemetry). Named grid areas place the rail on the right regardless of that
 * order, and below 640px the shell restacks it under the board rather than
 * hiding it, so capability parity holds at every breakpoint (§9).
 */
export function GameLayout({
  hud,
  board,
  actionTray,
  turnRail,
}: GameLayoutProps) {
  return (
    <div className="game-shell" data-slot="game-layout">
      <div className="game-shell-hud" data-slot="game-hud-region">
        {hud}
      </div>
      <div className="game-shell-board" data-slot="game-board-region">
        {board}
      </div>
      <div className="game-shell-action" data-slot="game-action-region">
        {actionTray}
      </div>
      <div className="game-shell-rail" data-slot="game-turn-rail-region">
        {turnRail}
      </div>
    </div>
  );
}
