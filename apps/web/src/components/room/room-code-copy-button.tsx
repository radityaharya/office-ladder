"use client";

import { useState } from "react";

type RoomCodeCopyButtonProps = {
  readonly roomCode: string;
};

type CopyState = "idle" | "copied" | "error";

/**
 * A 28px icon-footprint control (DESIGN.md §6.1/§8) whose glyph is drawn in
 * inline SVG so nothing is fetched from another host. The result is announced
 * in text, never by colour alone.
 */
export function RoomCodeCopyButton({ roomCode }: RoomCodeCopyButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

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
      ? `Room code ${roomCode} copied`
      : copyState === "error"
        ? "Copy failed — select the code manually"
        : `Copy room code ${roomCode}`;

  return (
    <>
      <button
        type="button"
        className="shell-btn shell-btn-outline shell-btn-icon"
        aria-label={label}
        title={label}
        data-copy-state={copyState}
        onClick={() => void copyRoomCode()}
      >
        {copyState === "copied" ? <CheckGlyph /> : <CopyGlyph />}
      </button>
      {/*
        Both outcomes are announced. A changed `aria-label` on the already-focused
        button is not reliably re-read, so a failed copy would otherwise be
        silent — §8 requires every error to reach a live region. The message
        names the recovery, because there is no retry that would behave
        differently.
      */}
      <span className="shell-sr-only" role="status" aria-live="polite">
        {copyState === "copied"
          ? "Room code copied"
          : copyState === "error"
            ? `Copy failed. Select the room code ${roomCode} and copy it manually.`
            : ""}
      </span>
    </>
  );
}

function CopyGlyph() {
  return (
    <svg
      className="shell-btn-glyph"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="1.5" width="8" height="8" />
      <path d="M4.5 12.5h8v-8" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      className="shell-btn-glyph"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 7.5l3.5 3.5L12 3.5" />
    </svg>
  );
}
