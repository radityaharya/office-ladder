import type { ReactNode } from "react";

type GameLayoutProps = {
  readonly hud: ReactNode;
  readonly board: ReactNode;
  readonly actionTray: ReactNode;
  readonly turnRail: ReactNode;
  /**
   * Time-limited things: a reaction window, a prompt countdown, a ballot about
   * to close, the quarter/event track. See {@link AttentionNotice} for the
   * shape the band is built for.
   *
   * The band is rendered whether or not anything is passed, and its row is a
   * definite height in `.game-shell` — that is the whole point of it. A notice
   * arriving here covers nothing, dims nothing, takes no focus, and moves
   * nothing: the board's row is unaffected because the band's row never changes
   * size. Anything that must be seen on a deadline belongs here rather than in
   * a modal or in an extra row above the action bar.
   */
  readonly attention?: ReactNode;
};

/**
 * The match shell.
 *
 * Every structural region is a cell of one grid (`.game-shell` in
 * styles/game-shell.css), so the HUD chrome, the attention band, the board, the
 * rail and the action bar all resolve against the same row and column edges
 * (DESIGN.md §4.5) instead of reserving space for each other with padding
 * offsets. Nothing here is absolutely positioned and nothing floats: the rail is
 * a real right column and the action bar is a real full-width bottom row.
 *
 * DOM order is hud -> attention -> board -> action tray -> turn rail: the order
 * a keyboard and a screen reader should meet them in (read the instruments, see
 * what needs you, look at the floor, act, then read telemetry). Named grid areas
 * place the rail on the right regardless of that order, and below 1024px the
 * shell restacks it into a full-width bottom sheet under the board rather than
 * hiding it, so capability parity holds at every breakpoint (§9).
 */
export function GameLayout({
  hud,
  board,
  actionTray,
  turnRail,
  attention = null,
}: GameLayoutProps) {
  return (
    <div className="game-shell" data-slot="game-layout">
      <div className="game-shell-hud" data-slot="game-hud-region">
        {hud}
      </div>
      <div
        className="game-shell-attention"
        data-occupied={attention === null ? "false" : "true"}
        data-slot="game-attention-region"
        /* Only a tab stop when it actually holds something: the band hides its
           own scrollbar, so occupied content that overflows would otherwise be
           unreachable without a pointer (§8). An empty band is not a stop. */
        tabIndex={attention === null ? undefined : 0}
      >
        {attention ?? (
          <p className="game-shell-attention-rest" data-slot="game-attention-rest">
            <span className="hud-label">Attention</span>
            <span className="hud-sub">—</span>
          </p>
        )}
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

/**
 * A time-limited notice, in the one row shape the attention band is built for:
 * an LED, a label, a sentence and — where the caller has one — a deadline and up
 * to two 28px controls.
 *
 * Exported so the band has a house style rather than each caller inventing one.
 * It is deliberately a plain readout: no entrance animation, no dim, no focus
 * steal. DESIGN.md §7.2 allows a gameplay reveal, but this band is chrome that
 * is already on screen — what changes is the text inside it.
 */
export function AttentionNotice({
  actions = null,
  deadline = null,
  detail,
  label,
  tone = "info",
}: {
  readonly actions?: ReactNode;
  /** Pre-formatted. The band never runs a clock of its own. */
  readonly deadline?: string | null;
  readonly detail: string;
  readonly label: string;
  readonly tone?: "info" | "caution" | "critical";
}) {
  return (
    <div className="game-shell-attention-notice" data-slot="game-attention-notice" data-tone={tone}>
      <span aria-hidden="true" className="game-shell-led" data-tone={tone} />
      <span className="game-shell-label">{label}</span>
      <span className="game-shell-attention-detail">{detail}</span>
      {deadline === null ? null : (
        <span className="game-shell-value" data-slot="game-attention-deadline">
          {deadline}
        </span>
      )}
      {actions}
    </div>
  );
}
