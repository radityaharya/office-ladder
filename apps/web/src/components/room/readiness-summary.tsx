import type { LobbyPlayer } from "./types";

type ReadinessSummaryProps = {
  readonly players: readonly LobbyPlayer[];
  readonly minimumPlayers?: number;
};

export function ReadinessSummary({
  players,
  minimumPlayers = 3,
}: ReadinessSummaryProps) {
  const readyCount = players.filter((player) => player.isReady).length;
  const missingPlayers = Math.max(0, minimumPlayers - players.length);
  const waitingPlayers = players.length - readyCount;

  return (
    <section
      aria-label="Readiness summary"
      aria-live="polite"
      className="grid gap-4 border-y border-border bg-muted/30 px-4 py-4 sm:grid-cols-3"
    >
      <SummaryItem label="Readiness" value={`${readyCount} of ${players.length} ready`} />
      <SummaryItem
        label="Headcount"
        value={
          missingPlayers > 0
            ? `${missingPlayers} more player${missingPlayers === 1 ? "" : "s"} required`
            : "Minimum headcount reached"
        }
      />
      <SummaryItem
        label="Start check"
        value={
          missingPlayers > 0
            ? "Recruiting"
            : waitingPlayers > 0
              ? `${waitingPlayers} still on standby`
              : "All systems ready"
        }
      />
    </section>
  );
}

function SummaryItem({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="space-y-1">
      <p className="font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
