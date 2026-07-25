import { RiErrorWarningLine, RiRefreshLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";

type ActionTrayProps = {
  readonly activePlayerName: string;
  readonly canRoll: boolean;
  readonly isRolling: boolean;
  readonly rollError: string | null;
  readonly onRoll: () => void;
};

export function ActionTray({
  activePlayerName,
  canRoll,
  isRolling,
  rollError,
  onRoll,
}: ActionTrayProps) {
  return (
    <section
      aria-label="Current action"
      className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex flex-col items-center gap-2 px-3 sm:bottom-5"
      data-slot="action-tray"
    >
      {rollError ? (
        <p
          className="pointer-events-auto flex max-w-md items-start gap-2 rounded-full border border-destructive/40 bg-card/95 px-4 py-1.5 text-xs text-destructive backdrop-blur"
          role="alert"
        >
          <RiErrorWarningLine aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {rollError}
        </p>
      ) : null}
      {canRoll ? (
        <span className="pointer-events-auto relative">
          {!isRolling ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-pulse rounded-full bg-primary/50 blur-xl"
            />
          ) : null}
          <Button
            aria-busy={isRolling}
            className="relative h-14 min-w-48 rounded-full text-sm shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)] sm:h-16 sm:min-w-56"
            disabled={isRolling}
            onClick={onRoll}
            size="lg"
            type="button"
          >
            {isRolling ? <RiRefreshLine aria-hidden="true" className="animate-spin" /> : null}
            {isRolling ? "Rolling…" : "Roll dice"}
          </Button>
        </span>
      ) : (
        <p className="pointer-events-auto rounded-full border border-border bg-card/90 px-4 py-2 text-xs text-muted-foreground backdrop-blur">
          Waiting on <span className="font-semibold text-foreground">{activePlayerName}</span>
        </p>
      )}
    </section>
  );
}
