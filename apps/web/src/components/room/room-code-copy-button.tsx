"use client";

import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { useState } from "react";

import { Button } from "../ui/button";

type RoomCodeCopyButtonProps = {
  readonly roomCode: string;
};

export function RoomCodeCopyButton({ roomCode }: RoomCodeCopyButtonProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  async function copyRoomCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyState("copied");
    } catch (error: unknown) {
      if (error instanceof Error) {
        setCopyState("error");
        return;
      }
      throw error;
    }
  }

  const label =
    copyState === "copied"
      ? "Copied"
      : copyState === "error"
        ? "Copy failed"
        : "Copy room code";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={copyRoomCode}
    >
      {copyState === "copied" ? (
        <RiCheckLine aria-hidden="true" />
      ) : (
        <RiFileCopyLine aria-hidden="true" />
      )}
    </Button>
  );
}
