import { RiErrorWarningLine } from "@remixicon/react";

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

import { EmptySeat } from "./empty-seat";
import { PlayerDossier } from "./player-dossier";
import { ReadinessSummary } from "./readiness-summary";
import type { LobbyState, StartControl } from "./types";

type LobbyPanelProps = {
  readonly state: LobbyState;
};

export function LobbyPanel({ state }: LobbyPanelProps) {
  switch (state.kind) {
    case "loading":
      return <LobbyLoading seatCount={state.seatCount ?? 6} />;
    case "error":
      return <LobbyError message={state.message} onRetry={state.onRetry} />;
    case "ready": {
      const minimumPlayers = state.minimumPlayers ?? 3;
      const maximumPlayers = state.maximumPlayers ?? 6;
      const openSeats = Math.max(0, maximumPlayers - state.players.length);

      return (
        <section className="surface-panel overflow-hidden" aria-labelledby="lobby-roster-title">
          <div className="flex flex-col gap-2 px-4 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <h2
                id="lobby-roster-title"
                className="font-heading text-lg font-semibold tracking-wider uppercase"
              >
                Player dossier
              </h2>
              <p className="text-sm text-muted-foreground">
                The room supports 3–6 players. Every active player needs a character and ready status.
              </p>
            </div>
            <p className="font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              {state.players.length} / {maximumPlayers} seats filled
            </p>
          </div>

          <ReadinessSummary players={state.players} minimumPlayers={minimumPlayers} />

          <div role="list" aria-label="Room players and open seats">
            {state.players.map((player) => (
              <PlayerDossier
                key={player.id}
                player={player}
                characterOptions={state.characterOptions}
                onCharacterChange={
                  state.onCharacterChange
                    ? (characterId) => state.onCharacterChange?.(player.id, characterId)
                    : undefined
                }
                onReadyChange={
                  state.onReadyChange
                    ? (isReady) => state.onReadyChange?.(player.id, isReady)
                    : undefined
                }
                disabled={state.startControl.kind === "loading"}
              />
            ))}
            {Array.from({ length: openSeats }, (_, index) => {
              const seatNumber = state.players.length + index + 1;
              return (
                <EmptySeat
                  key={seatNumber}
                  seatNumber={seatNumber}
                  required={seatNumber <= minimumPlayers}
                />
              );
            })}
          </div>

          <StartSection control={state.startControl} onStart={state.onStart} />
        </section>
      );
    }
    default:
      return assertNever(state);
  }
}

function StartSection({
  control,
  onStart,
}: {
  readonly control: StartControl;
  readonly onStart?: () => void;
}) {
  switch (control.kind) {
    case "hidden":
      return null;
    case "blocked":
      return (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{control.reason}</p>
          <Button type="button" disabled>
            Start match
          </Button>
        </div>
      );
    case "enabled":
      return (
        <div className="flex justify-end border-t border-border px-4 py-5">
          <Button type="button" onClick={onStart} disabled={onStart === undefined}>
            {control.label ?? "Start match"}
          </Button>
        </div>
      );
    case "loading":
      return (
        <div className="flex justify-end border-t border-border px-4 py-5">
          <Button type="button" disabled aria-busy="true">
            {control.label ?? "Starting match"}
          </Button>
        </div>
      );
    default:
      return assertNever(control);
  }
}

function LobbyLoading({ seatCount }: { readonly seatCount: number }) {
  return (
    <section className="surface-panel overflow-hidden" aria-busy="true" aria-label="Loading lobby">
      <div className="space-y-3 px-4 py-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="border-y border-border px-4 py-4">
        <Skeleton className="h-10 w-full" />
      </div>
      <div>
        {Array.from({ length: seatCount }, (_, index) => (
          <div key={index} className="flex items-center gap-3 border-b border-border px-4 py-5 last:border-b-0">
            <Skeleton className="size-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LobbyError({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }) {
  return (
    <Alert variant="destructive" className="border-destructive/30 bg-card">
      <RiErrorWarningLine aria-hidden="true" />
      <AlertTitle>Lobby unavailable</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {onRetry ? (
        <div className="col-start-2 mt-3">
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled room state: ${String(value)}`);
}
