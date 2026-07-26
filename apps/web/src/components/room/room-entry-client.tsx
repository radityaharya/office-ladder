import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { deadlineDashCharacters } from "@office-ladder/content";
import type { ModeRules, RoomCapacity, RoomMode } from "@office-ladder/contracts";

import { CreateJoinPanel } from "./create-join-panel";
import { DEFAULT_MODE_SELECTION, type ModeSelection } from "./mode-picker";
import type { ActionState } from "./types";

const ROOM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const characterOptions = Object.values(deadlineDashCharacters).map(
  ({ id, displayNameKey }) => {
    const key = displayNameKey
      .replace("deadlineDash.character.", "")
      .replace(".name", "")
      .replace(/([a-z])([A-Z])/g, "$1 $2");

    return {
      id,
      label: key.charAt(0).toUpperCase() + key.slice(1),
    };
  },
);

type RoomCommand =
  | {
      readonly kind: "create";
      readonly endpoint: "/api/rooms";
      /**
       * `mode` is typed as the *contract's* `RoomMode`, not as the content
       * pack's preset id, so a preset the pack ships and contracts has never
       * heard of fails to compile here rather than 400-ing at runtime. That
       * drift is exactly what made `mode.standard` and `mode.campaign`
       * unselectable while both were shipping.
       *
       * `rules` is omitted entirely unless a ruleset was actually authored:
       * `parseCreateRoomRequest` treats an absent key and `null` as the same
       * fact, and the smaller body is the one that says what happened.
       */
      readonly body: {
        readonly mode: RoomMode;
        readonly capacity: RoomCapacity;
        readonly playerName: string;
        readonly rules?: ModeRules;
      };
    }
  | {
      readonly kind: "join";
      readonly endpoint: "/api/rooms/join";
      readonly body: { readonly roomCode: string; readonly playerName: string };
    };

class RoomEntryError extends Error {
  readonly name = "RoomEntryError";
}

export function RoomEntryClient() {
  const navigate = useNavigate();
  const pendingCommand = useRef<RoomCommand["kind"] | null>(null);
  const [createState, setCreateState] = useState<ActionState>({ kind: "idle" });
  const [joinState, setJoinState] = useState<ActionState>({ kind: "idle" });
  const [modeSelection, setModeSelection] = useState<ModeSelection>(
    DEFAULT_MODE_SELECTION,
  );

  async function submit(command: RoomCommand): Promise<void> {
    if (pendingCommand.current !== null) return;

    pendingCommand.current = command.kind;
    switch (command.kind) {
      case "create":
        setCreateState({ kind: "loading" });
        setJoinState({ kind: "disabled", reason: "Room creation is in progress." });
        break;
      case "join":
        setCreateState({ kind: "disabled", reason: "Room joining is in progress." });
        setJoinState({ kind: "loading" });
        break;
      default:
        assertNever(command);
    }

    try {
      const response = await fetch(command.endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command.body),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new RoomEntryError(
          readErrorMessage(payload) ??
            (command.kind === "create" ? "Room could not be created." : "Room could not be joined."),
        );
      }

      const roomId = readRoomId(payload);
      await navigate({ to: "/rooms/$roomId", params: { roomId } });
    } catch (error) {
      const message =
        error instanceof RoomEntryError
          ? error.message
          : "The room service could not be reached. Check your connection and try again.";

      pendingCommand.current = null;
      switch (command.kind) {
        case "create":
          setCreateState({ kind: "error", message });
          setJoinState({ kind: "idle" });
          break;
        case "join":
          setCreateState({ kind: "idle" });
          setJoinState({ kind: "error", message });
          break;
        default:
          assertNever(command);
      }
    }
  }

  return (
    <CreateJoinPanel
      characterOptions={characterOptions}
      createState={createState}
      joinState={joinState}
      modeSelection={modeSelection}
      onModeSelectionChange={setModeSelection}
      onCreate={({ playerName, modeId, customRules }) => {
        void submit({
          kind: "create",
          endpoint: "/api/rooms",
          body:
            customRules === null
              ? { mode: modeId, capacity: 6, playerName }
              : { mode: modeId, capacity: 6, playerName, rules: customRules },
        });
      }}
      onJoin={({ roomCode, playerName }) => {
        void submit({
          kind: "join",
          endpoint: "/api/rooms/join",
          body: { roomCode, playerName },
        });
      }}
    />
  );
}

function readRoomId(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload["room"])) {
    throw new RoomEntryError("The room service returned an invalid response.");
  }

  const roomId = payload["room"]["id"];
  if (typeof roomId !== "string" || !ROOM_ID_PATTERN.test(roomId)) {
    throw new RoomEntryError("The room service returned an invalid room identifier.");
  }

  return roomId;
}

function readErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const message = payload["message"];
  if (typeof message === "string" && message.length > 0) return message;

  const error = payload["error"];
  if (typeof error === "string" && error.length > 0) return error;
  if (!isRecord(error)) return null;

  const nestedMessage = error["message"];
  return typeof nestedMessage === "string" && nestedMessage.length > 0
    ? nestedMessage
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled room command: ${String(value)}`);
}
