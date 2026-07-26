"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * The mandate is "entries, not toasts; log lines, not banners" (DESIGN.md §0):
 * routine committed events belong in the activity log, so this stack only ever
 * carries the handful of notices a player must not miss.
 *
 * How small that set is, concretely: `criticalNotices` in game-feedback.tsx is
 * the entire allowlist — four event types, two of which only fire for the local
 * player's own seat. Card draws do not toast (they are a docked strip that
 * clears itself), and rolls, moves, salary, tile resolutions, resource changes
 * and statuses do not toast at all. `visibleToasts` and `duration` below are set
 * on the assumption that this surface stays that quiet; if a future change starts
 * routing per-turn events here, the fix is to stop doing that, not to raise the
 * cap.
 *
 * Shape follows §4.4 (hairline border + the one sanctioned short-throw shadow,
 * both applied in styles/overlays.css), §4.2 (2px radius — never a pill), and
 * §6.4 (a 6px square status LED beside a text label, never a coloured icon
 * burst standing in for the label).
 *
 * Accessibility: sonner's own container is the live region — every toast is
 * announced politely and the stack is reachable from the keyboard. Nothing here
 * overrides `aria-live`, `role`, or the notification landmark, and the close
 * button is kept so a toast is never only dismissable by waiting. The feedback
 * layer's separate `aria-live` summary covers the events that never toast, so
 * the two do not describe the same event twice.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      closeButton
      /* Long enough to read two lines, short enough that a promotion notice is
         gone before the next turn resolves. */
      duration={6000}
      gap={8}
      position="bottom-right"
      /* Bottom-right sits over the tail of the activity log rather than over the
         board or the action tray, and the log renders newest-first — so the rows
         a toast can obscure are the ones already read. */
      visibleToasts={2}
      icons={{
        success: (
          <span aria-hidden="true" className="overlay-led overlay-led-active" />
        ),
        info: <span aria-hidden="true" className="overlay-led overlay-led-info" />,
        warning: (
          <span aria-hidden="true" className="overlay-led overlay-led-caution" />
        ),
        error: (
          <span aria-hidden="true" className="overlay-led overlay-led-critical" />
        ),
        loading: <span aria-hidden="true" className="overlay-led" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface-raised)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border-strong)",
          "--border-radius": "2px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast overlay-toast",
          title: "overlay-toast-title",
          description: "overlay-toast-body",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
