"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { LobbyPanel, RoomHeader } from "@/components/room";
import type { CharacterOption, LobbyPlayer, LobbyState } from "@/components/room";
import type { RoomMemberProjection, RoomStatus } from "@/contracts/rooms";
import { subscribeRoomUpdates } from "@/realtime/room-channel";

const POLL_INTERVAL_MS = 2_000, MINIMUM_PLAYERS = 3;

type LobbyBootstrap = {
  readonly room: {
    readonly code: string;
    readonly status: RoomStatus;
    readonly capacity: number;
    readonly revision: number;
    readonly members: readonly LobbyMember[];
  };
  readonly selfMemberId: string;
  readonly gameRevision: number;
  readonly roomTopic: string | null;
  readonly characterOptions: readonly CharacterOption[];
};

type LobbyMember = RoomMemberProjection & { readonly characterId: string | null; readonly characterLabel: string | null };

type JsonRecord = Readonly<Record<string, unknown>>;

type LoadState = { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly bootstrap: LobbyBootstrap };

class LobbyResponseError extends Error { readonly name = "LobbyResponseError"; }

export function RoomLobbyClient({ roomId }: { readonly roomId: string }) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [isStarting, setIsStarting] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const loadLobby = useCallback(async (): Promise<void> => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new LobbyResponseError(await readErrorMessage(response));
      }

      const bootstrap = parseLobbyBootstrap(await response.json());
      setLoadState({ kind: "ready", bootstrap });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof Error) {
        setLoadState({ kind: "error", message: error.message });
        return;
      }
      throw error;
    }
  }, [roomId]);

  useEffect(() => {
    const initialLoadId = window.setTimeout(() => void loadLobby(), 0);
    const intervalId = window.setInterval(() => void loadLobby(), POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
      requestRef.current?.abort();
    };
  }, [loadLobby]);

  const roomTopic = loadState.kind === "ready" ? loadState.bootstrap.roomTopic : null;
  useEffect(() => {
    if (roomTopic === null) return;
    const cleanup = subscribeRoomUpdates(roomTopic, () => void loadLobby());
    return () => {
      void cleanup();
    };
  }, [loadLobby, roomTopic]);

  const roomStatus = loadState.kind === "ready" ? loadState.bootstrap.room.status : null;
  useEffect(() => {
    if (roomStatus === "active") router.replace(`/rooms/${encodeURIComponent(roomId)}/game`);
  }, [roomId, roomStatus, router]);

  const startMatch = useCallback(async (): Promise<void> => {
    if (loadState.kind !== "ready" || loadState.bootstrap.room.status !== "open") return;
    setIsStarting(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/start`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision:
            loadState.bootstrap.gameRevision || loadState.bootstrap.room.revision,
        }),
      });
      if (!response.ok) {
        throw new LobbyResponseError(await readErrorMessage(response));
      }
      await loadLobby();
    } catch (error: unknown) {
      if (error instanceof Error) {
        setLoadState({ kind: "error", message: error.message });
        return;
      }
      throw error;
    } finally {
      setIsStarting(false);
    }
  }, [loadLobby, loadState, roomId]);

  const bootstrap = loadState.kind === "ready" ? loadState.bootstrap : null;
  let panelState: LobbyState;
  if (loadState.kind === "loading") {
    panelState = { kind: "loading", seatCount: 6 };
  } else if (loadState.kind === "error") {
    panelState = { kind: "error", message: loadState.message, onRetry: loadLobby };
  } else {
    const players = loadState.bootstrap.room.members.map((member): LobbyPlayer => ({
      id: member.id,
      name: member.displayName,
      isHost: member.isHost,
      isCurrentPlayer: member.id === loadState.bootstrap.selfMemberId,
      isReady: member.isReady,
      characterId: member.characterId,
      characterLabel: member.characterLabel,
    }));
    const self = loadState.bootstrap.room.members.find(
      (member) => member.id === loadState.bootstrap.selfMemberId,
    );
    const canStart = players.length >= MINIMUM_PLAYERS && loadState.bootstrap.room.status === "open";
    panelState = {
      kind: "ready",
      players,
      characterOptions: loadState.bootstrap.characterOptions,
      minimumPlayers: MINIMUM_PLAYERS,
      maximumPlayers: loadState.bootstrap.room.capacity,
      startControl: !self?.isHost
        ? { kind: "hidden" }
        : isStarting || loadState.bootstrap.room.status === "starting"
          ? { kind: "loading" }
          : canStart
            ? { kind: "enabled" }
            : { kind: "blocked", reason: "At least 3 players are required to start." },
      onStart: self?.isHost && canStart ? startMatch : undefined,
    };
  }

  return (
    <main className="min-h-[100dvh] bg-background px-5 py-6 text-foreground sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {bootstrap ? (
          <RoomHeader roomCode={bootstrap.room.code} playerCount={bootstrap.room.members.length} />
        ) : (
          <header className="border-b border-border pb-6">
            <p className="font-sans text-xs font-semibold tracking-widest text-primary uppercase">
              Private room
            </p>
            <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight">Team assembly</h1>
          </header>
        )}
        <LobbyPanel state={panelState} />
      </div>
    </main>
  );
}

function parseLobbyBootstrap(value: unknown): LobbyBootstrap {
  const root = requireRecord(value, "room bootstrap");
  const payload = isRecord(root["value"]) ? root["value"] : root;
  const room = requireRecord(payload["room"], "room");
  const members = room["members"];
  if (!Array.isArray(members)) throw new LobbyResponseError("Invalid room.members response.");
  const self = isRecord(payload["self"]) ? payload["self"] : null;
  const realtime = isRecord(payload["realtime"]) ? payload["realtime"] : null;
  const game = isRecord(payload["publicProjection"])
    ? payload["publicProjection"]
    : isRecord(payload["game"])
      ? payload["game"]
      : null;

  return {
    room: {
      code: requireString(room["code"], "room.code"),
      status: requireRoomStatus(room["status"]),
      capacity: requireNumber(room["capacity"], "room.capacity"),
      revision: requireNumber(room["revision"], "room.revision"),
      members: members.map(parseMember),
    },
    selfMemberId: requireString(
      payload["selfMemberId"] ?? self?.["playerId"],
      "selfMemberId",
    ),
    gameRevision: game ? requireNumber(game["revision"], "game.revision") : 0,
    roomTopic: optionalString(payload["roomTopic"] ?? realtime?.["roomTopic"]),
    characterOptions: parseCharacterOptions(payload["characterOptions"]),
  };
}

function parseMember(value: unknown): LobbyMember {
  const member = requireRecord(value, "room member");
  return {
    id: requireString(member["id"], "member.id"),
    displayName: requireString(member["displayName"], "member.displayName"),
    seat: requireNumber(member["seat"], "member.seat"),
    isHost: requireBoolean(member["isHost"], "member.isHost"),
    isReady: requireBoolean(member["isReady"], "member.isReady"),
    isConnected: requireBoolean(member["isConnected"], "member.isConnected"),
    characterId: optionalString(member["characterId"]),
    characterLabel: optionalString(member["characterLabel"]),
  };
}

function parseCharacterOptions(value: unknown): readonly CharacterOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((option) => {
    const item = requireRecord(option, "character option");
    return { id: requireString(item["id"], "character.id"), label: requireString(item["label"], "character.label") };
  });
}

function requireRoomStatus(value: unknown): RoomStatus {
  if (value === "open" || value === "starting" || value === "active" || value === "completed" || value === "abandoned") return value;
  throw new LobbyResponseError("The room returned an unsupported status.");
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (isRecord(value)) return value;
  throw new LobbyResponseError(`Invalid ${label} response.`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  throw new LobbyResponseError(`Invalid ${label} response.`);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new LobbyResponseError(`Invalid ${label} response.`);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  throw new LobbyResponseError(`Invalid ${label} response.`);
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = response.status === 404 ? "Room not found." : "The lobby could not be loaded.";
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body["message"] === "string") return body["message"];
    const responseError = isRecord(body) && isRecord(body["error"]) ? body["error"] : null;
    if (responseError && typeof responseError["message"] === "string") return responseError["message"];
    return fallback;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}
