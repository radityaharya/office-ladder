"use client";

import { RiArrowLeftLine, RiRefreshLine } from "@remixicon/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { GameBootstrap, LegalActionSummary } from "@/contracts";
import { deadlineDashBoard } from "@/content/deadline-dash/board";
import { subscribeRoomUpdates } from "@/realtime/room-channel";
import { Button } from "@/components/ui/button";

import { GameBoard } from "./board";
import type { BoardSpaceKind, BoardSpaceView, PlayerSeat, PlayerTokenView } from "./board";
import { GameHud } from "./game-hud";

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

const tileLabels = {
  receptionist: "Receptionist",
  finance: "Finance",
  "energy-restore": "Energy restore",
  meeting: "Meeting",
  work: "Work",
  hr: "Human resources",
  networking: "Networking",
  training: "Training",
  "board-meeting": "Board meeting",
  burnout: "Burnout",
  "ceo-office": "CEO office",
  event: "Office event",
  "ceo-favorite": "CEO favorite",
  sales: "Sales",
  "best-employee": "Best employee",
  audit: "Audit",
  operation: "Operations",
  legal: "Legal",
  "annual-event": "Annual event",
  marketing: "Marketing",
  it: "IT",
} as const;

export function GameClient({ roomId }: GameClientProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [isRolling, setIsRolling] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);

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

  if (state.kind === "loading") return <GameLoading />;
  if (state.kind === "absent") return <GameAbsent roomId={roomId} />;
  if (state.kind === "error") return <GameError message={state.message} onRetry={() => void refresh()} roomId={roomId} />;
  if (!view) return null;

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-4 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-[112rem] gap-4 lg:grid-cols-[minmax(0,1fr)_clamp(16rem,22vw,20rem)]">
        <GameHud
          canRoll={view.canRoll}
          game={state.bootstrap.publicProjection}
          isRolling={isRolling}
          onRoll={() => void roll()}
          rollError={rollError}
          room={state.bootstrap.room}
          selfPlayerId={state.bootstrap.self.playerId}
        />
        <div className="order-3 min-w-0 lg:col-start-1 lg:row-start-3">
          <GameBoard
            activeTile={view.activeTile}
            incident={view.incident}
            label="Deadline Dash office board"
            players={view.players}
            spaces={view.spaces}
          />
        </div>
      </div>
    </main>
  );
}

function createGameView(bootstrap: GameBootstrap) {
  const game = bootstrap.publicProjection;
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const players = game.players.flatMap((player): readonly PlayerTokenView[] => {
    const seat = playerSeat(player.seat);
    if (seat === null) return [];
    const name = bootstrap.room.members.find((member) => member.id === player.id)?.displayName ?? `Seat ${seat}`;
    return [{ id: player.id, name, seat, position: player.position, initials: initials(name), state: player.id === game.activePlayerId ? "current" : player.connected ? "idle" : "disconnected" }];
  });
  const spaces = deadlineDashBoard.spaces.map(toBoardSpace);
  const rollAction = findRollAction(bootstrap.legalActions);
  const activeTile = activePlayer?.position ?? null;
  const activeName = activePlayer ? bootstrap.room.members.find((member) => member.id === activePlayer.id)?.displayName ?? `Seat ${activePlayer.seat}` : "Server";

  return {
    activeTile,
    canRoll: rollAction !== null && game.activePlayerId === bootstrap.self.playerId,
    incident: {
      status: `${game.phase.replaceAll("-", " ")} · position ${activeTile === null ? "pending" : activeTile + 1}`,
      title: game.status === "ended" ? "Final review complete" : `${activeName}'s turn`,
      description: "Positions reflect the latest public projection. Dice outcomes and movement are resolved by the seeded server engine.",
      detail: game.eventSummaries.at(-1) ? <p className="font-mono text-xs text-muted-foreground">Latest committed event: {game.eventSummaries.at(-1)?.type.replaceAll(".", " ")} · revision {game.eventSummaries.at(-1)?.revision}</p> : undefined,
    },
    players,
    spaces,
  };
}

function toBoardSpace(tile: (typeof deadlineDashBoard.spaces)[number]): BoardSpaceView {
  const base = { id: tile.id, index: tile.index, kind: tileKind(tile.kind), label: tileLabels[tile.kind], categoryLabel: categoryLabel(tile.kind), detail: tile.kind.replaceAll("-", " ") };
  return tile.placement === "corner" ? { ...base, placement: "corner", coordinate: tile.coordinate } : { ...base, placement: "side", side: tile.side, coordinate: tile.coordinate };
}

function tileKind(kind: keyof typeof tileLabels): BoardSpaceKind {
  if (kind === "receptionist") return "start";
  if (kind === "meeting" || kind === "event" || kind === "networking") return "action";
  if (kind === "burnout" || kind === "audit" || kind === "finance" || kind === "hr" || kind === "legal") return "policy";
  if (kind === "operation") return "transit";
  if (kind === "energy-restore") return "safe";
  if (kind === "board-meeting" || kind === "annual-event") return "corner";
  return "department";
}

function categoryLabel(kind: keyof typeof tileLabels): string {
  const category = tileKind(kind);
  return category === "safe" ? "Break / safe" : category[0]?.toUpperCase() + category.slice(1);
}

function playerSeat(seat: number): PlayerSeat | null {
  if (seat === 1 || seat === 2 || seat === 3 || seat === 4 || seat === 5 || seat === 6) return seat;
  return null;
}

function findRollAction(actions: readonly LegalActionSummary[]): Extract<LegalActionSummary, { readonly type: "turn.roll" }> | null {
  return actions.find((action) => action.type === "turn.roll") ?? null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function GameLoading() {
  return <main className="grid min-h-[100dvh] place-items-center bg-background p-6 text-foreground"><div className="w-full max-w-xl border border-border bg-card p-6" aria-busy="true"><p className="font-sans text-xs font-semibold tracking-widest text-primary uppercase">Loading projection</p><h1 className="mt-3 font-heading text-2xl font-semibold">Opening the conference room</h1><div className="mt-6 h-2 overflow-hidden bg-muted"><span className="block h-full w-1/2 animate-pulse bg-primary" /></div></div></main>;
}

function GameAbsent({ roomId }: { readonly roomId: string }) {
  return <main className="grid min-h-[100dvh] place-items-center bg-background p-6 text-foreground"><div className="w-full max-w-xl border border-border bg-card p-6"><p className="font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">No active game</p><h1 className="mt-3 font-heading text-2xl font-semibold">The room has not started a match.</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Return to the room to check readiness or start the next office scramble.</p><Link className="mt-6 inline-flex items-center gap-2 text-xs font-semibold tracking-widest text-primary uppercase" href={`/rooms/${roomId}`}><RiArrowLeftLine aria-hidden="true" className="size-4" />Back to room</Link></div></main>;
}

function GameError({ message, onRetry, roomId }: { readonly message: string; readonly onRetry: () => void; readonly roomId: string }) {
  return <main className="grid min-h-[100dvh] place-items-center bg-background p-6 text-foreground"><div className="w-full max-w-xl border border-destructive/40 bg-card p-6"><p className="font-sans text-xs font-semibold tracking-widest text-destructive uppercase">Projection unavailable</p><h1 className="mt-3 font-heading text-2xl font-semibold">The board feed dropped.</h1><p className="mt-3 text-sm text-muted-foreground">{message}</p><div className="mt-6 flex flex-wrap gap-3"><Button onClick={onRetry} type="button"><RiRefreshLine aria-hidden="true" />Retry</Button><Link className="inline-flex h-10 items-center gap-2 border border-border px-6 text-xs font-semibold tracking-widest uppercase hover:bg-muted" href={`/rooms/${roomId}`}><RiArrowLeftLine aria-hidden="true" className="size-4" />Back to room</Link></div></div></main>;
}
