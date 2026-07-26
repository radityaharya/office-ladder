import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { LobbyPanel, RoomHeader } from "@/components/room";
import type { CharacterOption, LobbyPlayer, LobbyState } from "@/components/room";
import {
  BOT_DIFFICULTIES,
  ContractValidationError,
  parseAvatarUrl,
  parseModeRules,
  type BotDifficulty,
  type ModeRules,
  type RoomMemberProjection,
  type RoomStatus,
} from "@office-ladder/contracts";
import { subscribeRoomUpdates } from "@/realtime/room-channel";

import type { ModeBriefingData } from "./mode-briefing";
import {
  isModePresetId,
  matchingPresetId,
  presetName,
  presetRules,
  summarizeModeRules,
  type ModePresetId,
} from "./mode-presets";

/**
 * Mirrors MINIMUM_PLAYERS in apps/server/src/rooms/service/create-room-service.ts.
 * Bot seats are ordinary members, so they count toward it — which is what makes
 * solo play possible at all.
 */
const POLL_INTERVAL_MS = 2_000, MINIMUM_PLAYERS = 3;

type LobbyBootstrap = {
  readonly room: {
    readonly code: string;
    readonly status: RoomStatus;
    readonly capacity: number;
    readonly revision: number;
    readonly members: readonly LobbyMember[];
    /** `null` when the room names a mode this build has no preset for. */
    readonly mode: ModePresetId | null;
    /**
     * The room's own ruleset when the projection carries one, `null` when it
     * does not. Absent today — `RoomProjection` has no `rules` field yet — so
     * the briefing falls back to the named preset's shipped rules, which is
     * correct for every room that did not author a custom ruleset.
     */
    readonly rules: ModeRules | null;
  };
  readonly selfMemberId: string;
  readonly gameRevision: number;
  readonly characterOptions: readonly CharacterOption[];
};

type LobbyMember = RoomMemberProjection & { readonly characterId: string | null; readonly characterLabel: string | null };

type JsonRecord = Readonly<Record<string, unknown>>;

type LoadState = { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly bootstrap: LobbyBootstrap };

class LobbyResponseError extends Error { readonly name = "LobbyResponseError"; }

export function RoomLobbyClient({ roomId }: { readonly roomId: string }) {
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("standard");
  const [botError, setBotError] = useState<string | null>(null);
  const [isAddingBot, setIsAddingBot] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const botRequestRef = useRef(false);

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

  // The room id is the Realtime topic the server publishes to.
  useEffect(() => {
    const cleanup = subscribeRoomUpdates(roomId, () => void loadLobby());
    return () => {
      void cleanup();
    };
  }, [loadLobby, roomId]);

  const roomStatus = loadState.kind === "ready" ? loadState.bootstrap.room.status : null;
  useEffect(() => {
    if (roomStatus === "active") {
      void navigate({ to: "/rooms/$roomId/game", params: { roomId }, replace: true });
    }
  }, [roomId, roomStatus, navigate]);

  const startMatch = useCallback(async (): Promise<void> => {
    if (loadState.kind !== "ready" || loadState.bootstrap.room.status !== "open") return;
    setIsStarting(true);
    setStartError(null);
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
        throw new LobbyResponseError(await readMutationError(response, "start"));
      }
      await loadLobby();
    } catch (error: unknown) {
      if (error instanceof Error) {
        // Keep the roster on screen: a rejected start is not a broken lobby.
        setStartError(error.message);
        return;
      }
      throw error;
    } finally {
      setIsStarting(false);
    }
  }, [loadLobby, loadState, roomId]);

  /**
   * POST /api/rooms/:roomId/bots — one request per seat, sequentially, so a
   * partial failure leaves the room in a state the host can see and reason
   * about. The body is exactly `{ difficulty }`: contracts' parseAddBotRequest
   * rejects any extra key, so no revision is sent.
   */
  const addBots = useCallback(
    async (count: number): Promise<void> => {
      if (botRequestRef.current) return;
      botRequestRef.current = true;
      setIsAddingBot(true);
      setBotError(null);
      try {
        for (let seat = 0; seat < Math.max(1, count); seat += 1) {
          const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/bots`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ difficulty: botDifficulty }),
          });
          if (!response.ok) {
            throw new LobbyResponseError(await readMutationError(response, "add-bot"));
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          setBotError(error.message);
        } else {
          throw error;
        }
      } finally {
        botRequestRef.current = false;
        setIsAddingBot(false);
        await loadLobby();
      }
    },
    [botDifficulty, loadLobby, roomId],
  );

  /**
   * DELETE /api/rooms/:roomId/bots/:memberId. The landed route reads the member
   * id from the path and never parses a body; the `{ memberId }` body is sent
   * anyway because contracts also ships parseRemoveBotRequest for that exact
   * shape, so either server implementation is satisfied and an unread body
   * costs nothing.
   */
  const removeBot = useCallback(
    async (memberId: string): Promise<void> => {
      if (botRequestRef.current) return;
      botRequestRef.current = true;
      setRemovingMemberId(memberId);
      setBotError(null);
      try {
        const response = await fetch(
          `/api/rooms/${encodeURIComponent(roomId)}/bots/${encodeURIComponent(memberId)}`,
          {
            method: "DELETE",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ memberId }),
          },
        );
        if (!response.ok) {
          throw new LobbyResponseError(await readMutationError(response, "remove-bot"));
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          setBotError(error.message);
        } else {
          throw error;
        }
      } finally {
        botRequestRef.current = false;
        setRemovingMemberId(null);
        await loadLobby();
      }
    },
    [loadLobby, roomId],
  );

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
      seat: member.seat,
      isHost: member.isHost,
      isCurrentPlayer: member.id === loadState.bootstrap.selfMemberId,
      isReady: member.isReady,
      isConnected: member.isConnected,
      isBot: member.isBot,
      botDifficulty: member.botDifficulty,
      characterId: member.characterId,
      characterLabel: member.characterLabel,
    }));
    const self = loadState.bootstrap.room.members.find(
      (member) => member.id === loadState.bootstrap.selfMemberId,
    );
    const isHost = self?.isHost === true;
    const status = loadState.bootstrap.room.status;
    const capacity = loadState.bootstrap.room.capacity;
    const seatsToMinimum = Math.max(0, MINIMUM_PLAYERS - players.length);
    const canStart = players.length >= MINIMUM_PLAYERS && status === "open";
    const isRoomFull = players.length >= capacity;
    const isBusy = isAddingBot || removingMemberId !== null;

    panelState = {
      kind: "ready",
      players,
      characterOptions: loadState.bootstrap.characterOptions,
      roomStatus: status,
      minimumPlayers: MINIMUM_PLAYERS,
      maximumPlayers: capacity,
      startControl: !isHost
        ? { kind: "hidden" }
        : isStarting || status === "starting"
          ? { kind: "loading" }
          : canStart
            ? { kind: "enabled" }
            : {
                kind: "blocked",
                // The shortfall and the fix are already stated above this
                // control; this line only names the gate.
                reason:
                  seatsToMinimum > 0
                    ? `Locked until ${MINIMUM_PLAYERS} seats are filled.`
                    : "This room can no longer be started.",
              },
      startError: isHost ? startError : null,
      // Host-only: a non-host gets no bot controls at all, not disabled ones.
      botRequisition: !isHost
        ? null
        : {
            state: isBusy
              ? "pending"
              : status !== "open"
                ? "closed"
                : isRoomFull
                  ? "full"
                  : "open",
            difficulties: BOT_DIFFICULTIES,
            difficulty: botDifficulty,
            seatsToMinimum,
            // Accent goes to whichever action is genuinely next (DESIGN.md §1.5).
            emphasis: seatsToMinimum > 0 && !isRoomFull && status === "open"
              ? "primary"
              : "secondary",
            error: botError,
            onDifficultyChange: setBotDifficulty,
            onAdd: (count) => void addBots(count),
          },
      onRemoveBot: isHost && status === "open" ? (memberId) => void removeBot(memberId) : undefined,
      removingMemberId,
      onStart: isHost && canStart ? startMatch : undefined,
    };
  }

  return (
    <main className="shell-page">
      <div className="shell-frame">
        {bootstrap ? (
          <RoomHeader
            roomCode={bootstrap.room.code}
            playerCount={bootstrap.room.members.length}
            capacity={bootstrap.room.capacity}
            minimumPlayers={MINIMUM_PLAYERS}
            status={bootstrap.room.status}
          />
        ) : (
          <header>
            <div className="shell-bar">
              <div className="shell-bar-group">
                <span className="shell-label shell-high">Office Ladder</span>
                <span className="shell-caption shell-medium">/ Facilities &mdash; room assembly</span>
              </div>
              <span className="shell-status">
                <span className="shell-led shell-led-idle" aria-hidden="true" />
                <span className="shell-label shell-medium">Connecting</span>
              </span>
            </div>
            <div className="shell-region shell-region-surface shell-stack shell-seam-bottom">
              <h1 className="shell-display shell-high">Room assembly</h1>
              <p className="shell-body shell-medium shell-prose">
                Reading the room record.
              </p>
            </div>
          </header>
        )}
        <div className="shell-frame-body">
          <LobbyPanel state={panelState} modeBriefing={modeBriefing(bootstrap)} />
        </div>
      </div>
    </main>
  );
}

/**
 * The lobby's read-only restatement of the room's ruleset, derived from the same
 * `mode-presets.ts` code the create-room picker uses.
 *
 * `null` — no briefing at all — whenever the mode is one this build cannot
 * describe. The briefing exists so a player can trust what they are about to
 * play; a guessed one would be worse than an absent one.
 */
function modeBriefing(bootstrap: LobbyBootstrap | null): ModeBriefingData | null {
  const mode = bootstrap?.room.mode;
  if (bootstrap === null || mode === null || mode === undefined) return null;

  const rules = bootstrap.room.rules ?? presetRules(mode);
  return {
    presetName: presetName(mode),
    custom: matchingPresetId(rules) !== mode,
    summary: summarizeModeRules(rules),
  };
}

function parseLobbyBootstrap(value: unknown): LobbyBootstrap {
  const root = requireRecord(value, "room bootstrap");
  const payload = isRecord(root["value"]) ? root["value"] : root;
  const room = requireRecord(payload["room"], "room");
  const members = room["members"];
  if (!Array.isArray(members)) throw new LobbyResponseError("Invalid room.members response.");
  const self = isRecord(payload["self"]) ? payload["self"] : null;
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
      mode: optionalModePresetId(room["mode"]),
      rules: optionalModeRules(room["rules"]),
    },
    selfMemberId: requireString(
      payload["selfMemberId"] ?? self?.["playerId"],
      "selfMemberId",
    ),
    gameRevision: game ? requireNumber(game["revision"], "game.revision") : 0,
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
    isBot: requireBoolean(member["isBot"], "member.isBot"),
    botDifficulty: optionalBotDifficulty(member["botDifficulty"]),
    // Re-validated on arrival with the contract's own parser rather than accepted
    // as a plain string: it answers `null` for every scheme that must never reach
    // an `img src` (javascript:, data:, blob:, plain http:, protocol-relative
    // `//host`), so a compromised or older server cannot hand the lobby a URL the
    // renderer would trust.
    avatarUrl: parseAvatarUrl(member["avatarUrl"]),
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

/**
 * The room's mode, or `null` when it names something this build has no preset
 * for — an older row, or a preset a newer server ships and this bundle does not.
 *
 * Non-throwing on purpose, unlike `requireRoomStatus`: a mode this client cannot
 * describe costs a briefing, not the whole lobby.
 */
function optionalModePresetId(value: unknown): ModePresetId | null {
  return typeof value === "string" && isModePresetId(value) ? value : null;
}

/**
 * A ruleset the room carries, re-validated with the contract's own parser rather
 * than trusted as a shape.
 *
 * Same reasoning as `parseAvatarUrl` on the member above: this arrives over the
 * wire and is rendered as fact to every player in the lobby, so it is either
 * something `parseModeRules` vouches for or it is nothing.
 */
function optionalModeRules(value: unknown): ModeRules | null {
  if (!isRecord(value)) return null;
  try {
    return parseModeRules(value);
  } catch (error: unknown) {
    if (error instanceof ContractValidationError) return null;
    throw error;
  }
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

function optionalBotDifficulty(value: unknown): BotDifficulty | null {
  if (value === null || value === undefined) return null;
  if (value === "easy" || value === "standard" || value === "ruthless") return value;
  throw new LobbyResponseError("The room returned an unsupported bot difficulty.");
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

type MutationKind = "start" | "add-bot" | "remove-bot";

/**
 * The room API answers failures as `{ error: { code } }` with no prose, so the
 * client owns the copy. Anything unmapped falls through to the raw code rather
 * than a blank apology — an operator can act on a code.
 */
const MUTATION_ERROR_COPY: Readonly<Record<string, string>> = {
  ACTOR_NOT_HOST: "Only the room host can do that.",
  ACTOR_NOT_MEMBER: "You are not a member of this room.",
  ACTOR_NOT_AUTHORIZED: "You are not allowed to do that in this room.",
  ACTOR_ALREADY_MEMBER: "That seat is already taken.",
  ROOM_NOT_FOUND: "This room no longer exists.",
  ROOM_CODE_NOT_FOUND: "That room code does not match an open room.",
  ROOM_NOT_OPEN: "The room is no longer open, so its seats cannot change.",
  ROOM_FULL: "Every seat is taken. Remove a bot before adding another.",
  MEMBER_NOT_BOT: "That seat belongs to a human player and cannot be removed here.",
  LAST_HUMAN_REQUIRED: "A room has to keep at least one human member.",
  MINIMUM_PLAYERS_NOT_MET: `At least ${MINIMUM_PLAYERS} members are required to start.`,
  STALE_REVISION: "The room changed while you were acting. It has been refreshed — try again.",
  GAME_NOT_ACTIVE: "The match is not running.",
  FORBIDDEN: "The server rejected the request. Reload the page and sign in again.",
  UNAUTHORIZED: "Your session has expired. Sign in again.",
  INVALID_REQUEST: "The server rejected the request as malformed.",
  INVALID_JSON: "The server rejected the request as malformed.",
  UNSUPPORTED_MEDIA_TYPE: "The server rejected the request as malformed.",
  INTERNAL_SERVER_ERROR: "The room service failed. Try again in a moment.",
};

const MUTATION_FALLBACK: Readonly<Record<MutationKind, string>> = {
  start: "The match could not be started.",
  "add-bot": "The bot seat could not be added.",
  "remove-bot": "The bot seat could not be removed.",
};

async function readMutationError(response: Response, kind: MutationKind): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const nested = isRecord(body) && isRecord(body["error"]) ? body["error"] : null;

  const message = isRecord(body) && typeof body["message"] === "string" ? body["message"] : null;
  const nestedMessage = nested && typeof nested["message"] === "string" ? nested["message"] : null;
  if (message !== null) return message;
  if (nestedMessage !== null) return nestedMessage;

  const code =
    nested && typeof nested["code"] === "string"
      ? nested["code"]
      : isRecord(body) && typeof body["code"] === "string"
        ? body["code"]
        : isRecord(body) && typeof body["error"] === "string"
          ? body["error"]
          : null;
  if (code !== null) return MUTATION_ERROR_COPY[code] ?? `The room service rejected this: ${code}.`;

  // No code at all on a 404 almost always means the route itself is missing.
  if (response.status === 404 && kind !== "start") {
    return "This server build does not support bot seats yet.";
  }
  return MUTATION_FALLBACK[kind];
}
