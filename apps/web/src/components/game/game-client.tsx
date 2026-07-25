import { RiArrowLeftLine, RiRefreshLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { GameBootstrap } from "@office-ladder/contracts";
import { subscribeRoomUpdates } from "@/realtime/room-channel";
import { Button } from "@/components/ui/button";

import { GameBoard } from "./board";
import { ActionTray } from "./action-tray";
import { GameHud } from "./game-hud";
import { GameFeedback } from "./game-feedback";
import { shouldShowGameWinner } from "./game-completion-policy";
import { GameLayout } from "./game-layout";
import { createGameView, findPromptAction, findRollAction } from "./game-view";
import { playerName, TurnRail } from "./turn-rail";

type GameClientProps = {
  readonly roomId: string;
};

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly bootstrap: GameBootstrap };

class GameRequestError extends Error {
  readonly name = "GameRequestError";

  constructor(readonly status: number) {
    super(`Game request failed with status ${status}`);
  }
}

export function GameClient({ roomId }: GameClientProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [isRolling, setIsRolling] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  const [feedbackCompleteRevision, setFeedbackCompleteRevision] = useState<number | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      if (response.status === 404) {
        setState({ kind: "absent" });
        return;
      }
      if (!response.ok) throw new GameRequestError(response.status);

      const bootstrap: GameBootstrap = await response.json();
      setState({ kind: "ready", bootstrap });
      setRollError(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof GameRequestError) {
        setState({ kind: "error", message: "The current game projection could not be loaded." });
        return;
      }
      if (error instanceof TypeError) {
        setState({ kind: "error", message: "The game server could not be reached." });
        return;
      }
      throw error;
    }
  }, [roomId]);

  useEffect(() => {
    const controller = new AbortController();
    const initialRefresh = window.setTimeout(() => void refresh(controller.signal), 0);
    const interval = window.setInterval(() => void refresh(), 5_000);
    const cleanup = subscribeRoomUpdates(roomId, (update) => {
      if (update.changed.some((area) => area !== "room")) void refresh();
    });

    return () => {
      controller.abort();
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      void cleanup();
    };
  }, [refresh, roomId]);

  const view = useMemo(() => state.kind === "ready" ? createGameView(state.bootstrap) : null, [state]);

  const roll = useCallback(async (): Promise<void> => {
    if (state.kind !== "ready") return;
    const action = findRollAction(state.bootstrap.legalActions);
    if (!action || state.bootstrap.publicProjection.activePlayerId !== state.bootstrap.self.playerId) return;

    setIsRolling(true);
    setRollError(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/roll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: action.expectedRevision }),
      });
      if (!response.ok) throw new GameRequestError(response.status);
      await refresh();
    } catch (error) {
      if (error instanceof GameRequestError) {
        setRollError(error.status === 409 ? "The turn changed before that roll reached the server. Refreshing the board." : "The roll was not accepted. Try again after the projection refreshes.");
        await refresh();
        return;
      }
      if (error instanceof TypeError) {
        setRollError("The game server could not be reached. The board will keep polling for the latest projection.");
        return;
      }
      throw error;
    } finally {
      setIsRolling(false);
    }
  }, [refresh, roomId, state]);

  const [isResponding, setIsResponding] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);

  const respondToPrompt = useCallback(async (optionId: string): Promise<void> => {
    if (state.kind !== "ready") return;
    const action = findPromptAction(state.bootstrap.legalActions);
    if (!action) return;

    setIsResponding(true);
    setRespondError(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision: action.expectedRevision,
          decisionPointId: action.decisionPointId,
          optionId,
        }),
      });
      if (!response.ok) throw new GameRequestError(response.status);
      await refresh();
    } catch (error) {
      if (error instanceof GameRequestError) {
        setRespondError(error.status === 409 ? "The turn changed before that response reached the server. Refreshing the board." : "That response was not accepted. Try again after the projection refreshes.");
        await refresh();
        return;
      }
      if (error instanceof TypeError) {
        setRespondError("The game server could not be reached.");
        return;
      }
      throw error;
    } finally {
      setIsResponding(false);
    }
  }, [refresh, roomId, state]);

  if (state.kind === "loading") return <GameLoading />;
  if (state.kind === "absent") return <GameAbsent roomId={roomId} />;
  if (state.kind === "error") return <GameError message={state.message} onRetry={() => void refresh()} roomId={roomId} />;
  if (!view) return null;

  if (shouldShowGameWinner({
    status: state.bootstrap.publicProjection.status,
    projectionRevision: state.bootstrap.publicProjection.revision,
    feedbackCompleteRevision,
  })) {
    return <GameWinner bootstrap={state.bootstrap} roomId={roomId} />;
  }

  return (
    <main className="game-viewport">
      <GameFeedback
        bootstrap={state.bootstrap}
        error={respondError}
        isResponding={isResponding}
        onIdleChange={(idle) => {
          setFeedbackCompleteRevision(idle ? state.bootstrap.publicProjection.revision : null);
        }}
        onRespond={(optionId) => void respondToPrompt(optionId)}
      />
      <GameLayout
        hud={
          <GameHud
            game={state.bootstrap.publicProjection}
            room={state.bootstrap.room}
            selfPlayerId={state.bootstrap.self.playerId}
          />
        }
        board={
          <GameBoard
            activeTile={view.activeTile}
            incident={view.incident}
            label="Deadline Dash office board"
            players={view.players}
            spaces={view.spaces}
          />
        }
        actionTray={
          <ActionTray
            activePlayerName={activePlayerName(state.bootstrap)}
            canRoll={view.canRoll}
            isRolling={isRolling}
            onRoll={() => void roll()}
            rollError={rollError}
          />
        }
        turnRail={
          <TurnRail
            game={state.bootstrap.publicProjection}
            room={state.bootstrap.room}
            selfPlayerId={state.bootstrap.self.playerId}
          />
        }
      />
    </main>
  );
}

function activePlayerName(bootstrap: GameBootstrap): string {
  const activePlayerId = bootstrap.publicProjection.activePlayerId;
  return activePlayerId ? playerName(bootstrap.room, activePlayerId) : "The server";
}

function GameLoading() {
  return <main className="game-viewport grid place-items-center p-4"><div className="surface-panel w-full max-w-xl p-6" aria-busy="true"><p className="ui-kicker text-primary">Loading projection</p><h1 className="mt-3 font-heading text-2xl font-semibold">Opening the conference room</h1><div className="mt-6 h-2 overflow-hidden rounded-xs bg-muted"><span className="block h-full w-1/2 animate-pulse bg-primary" /></div></div></main>;
}

function GameAbsent({ roomId }: { readonly roomId: string }) {
  return <main className="game-viewport grid place-items-center p-4"><div className="surface-panel w-full max-w-xl p-6"><p className="ui-kicker text-muted-foreground">No active game</p><h1 className="mt-3 font-heading text-2xl font-semibold">The room has not started a match.</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Return to the room to check readiness or start the next office scramble.</p><Link className="mt-6 inline-flex min-h-11 items-center gap-2 text-xs font-semibold tracking-widest text-primary uppercase" to="/rooms/$roomId" params={{ roomId }}><RiArrowLeftLine aria-hidden="true" className="size-4" />Back to room</Link></div></main>;
}

function GameError({ message, onRetry, roomId }: { readonly message: string; readonly onRetry: () => void; readonly roomId: string }) {
  return <main className="game-viewport grid place-items-center p-4"><div className="surface-panel w-full max-w-xl border-destructive/40 p-6"><p className="ui-kicker text-destructive">Projection unavailable</p><h1 className="mt-3 font-heading text-2xl font-semibold">The board feed dropped.</h1><p className="mt-3 text-sm text-muted-foreground">{message}</p><div className="mt-6 flex flex-wrap gap-3"><Button onClick={onRetry} type="button"><RiRefreshLine aria-hidden="true" />Retry</Button><Link className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-6 text-xs font-semibold tracking-widest uppercase hover:bg-muted" to="/rooms/$roomId" params={{ roomId }}><RiArrowLeftLine aria-hidden="true" className="size-4" />Back to room</Link></div></div></main>;
}

function GameWinner({ bootstrap, roomId }: { readonly bootstrap: GameBootstrap; readonly roomId: string }) {
  const winnerId = bootstrap.publicProjection.winnerPlayerIds[0] ?? null;
  const winnerName =
    winnerId === null
      ? "Someone"
      : (bootstrap.room.members.find((member) => member.id === winnerId)?.displayName ?? "A coworker");
  const isSelf = winnerId !== null && winnerId === bootstrap.self.playerId;

  return (
    <main className="game-viewport grid place-items-center p-4">
      <div className="surface-panel w-full max-w-xl border-primary/40 p-6 text-center sm:p-8">
        <p className="font-sans text-xs font-semibold tracking-widest text-primary uppercase">Match complete</p>
        <h1 className="mt-3 font-heading text-3xl font-semibold">
          {isSelf ? "You made Director." : `${winnerName} made Director.`}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {isSelf
            ? "Every promotion cashed in. The corner office is yours."
            : "The office scramble is over. Better luck climbing the ladder next round."}
        </p>
        <Link
          className="mt-6 inline-flex items-center gap-2 text-xs font-semibold tracking-widest text-primary uppercase"
          params={{ roomId }}
          to="/rooms/$roomId"
        >
          <RiArrowLeftLine aria-hidden="true" className="size-4" />
          Back to room
        </Link>
      </div>
    </main>
  );
}
