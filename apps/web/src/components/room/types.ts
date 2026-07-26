import type { FormEvent } from "react";

import type { BotDifficulty, RoomStatus } from "@office-ladder/contracts";

export type CharacterOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type LobbyPlayer = {
  readonly id: string;
  readonly name: string;
  /** Zero-based seat index as issued by the room projection. */
  readonly seat: number;
  readonly isHost: boolean;
  readonly isCurrentPlayer: boolean;
  readonly isReady: boolean;
  readonly isConnected: boolean;
  /**
   * A bot seat is an ordinary room member. It is always labelled in text as
   * well as marked structurally — never distinguished by colour alone.
   */
  readonly isBot: boolean;
  readonly botDifficulty: BotDifficulty | null;
  readonly characterId: string | null;
  readonly characterLabel: string | null;
};

export type StartControl =
  | { readonly kind: "hidden" }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "enabled"; readonly label?: string }
  | { readonly kind: "loading"; readonly label?: string };

/**
 * Why the host cannot requisition another contractor seat right now. `open`
 * means the control is usable; every other value carries its own copy so the
 * lobby can say what actually happened rather than just disabling a button.
 */
export type BotRequisitionState = "open" | "pending" | "full" | "closed";

export type BotRequisition = {
  readonly state: BotRequisitionState;
  readonly difficulties: readonly BotDifficulty[];
  readonly difficulty: BotDifficulty;
  /** Seats still required before the match can start; 0 once the floor is met. */
  readonly seatsToMinimum: number;
  /** Spends the view's single accent on whichever action is actually next. */
  readonly emphasis: "primary" | "secondary";
  readonly error: string | null;
  readonly onDifficultyChange: (difficulty: BotDifficulty) => void;
  readonly onAdd: (count: number) => void;
};

export type LobbyState =
  | { readonly kind: "loading"; readonly seatCount?: number }
  | { readonly kind: "error"; readonly message: string; readonly onRetry?: () => void }
  | {
      readonly kind: "ready";
      readonly players: readonly LobbyPlayer[];
      readonly characterOptions: readonly CharacterOption[];
      readonly roomStatus?: RoomStatus;
      readonly minimumPlayers?: number;
      readonly maximumPlayers?: number;
      readonly startControl: StartControl;
      readonly startError?: string | null;
      /** `null` for a non-host viewer: the control is absent, not disabled. */
      readonly botRequisition?: BotRequisition | null;
      readonly onRemoveBot?: (memberId: string) => void;
      readonly removingMemberId?: string | null;
      readonly onCharacterChange?: (playerId: string, characterId: string) => void;
      readonly onReadyChange?: (playerId: string, isReady: boolean) => void;
      readonly onStart?: () => void;
    };

export type ActionState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "disabled"; readonly reason?: string };

export type CreateRoomRequest = {
  readonly playerName: string;
  readonly characterId: string;
};

export type JoinRoomRequest = CreateRoomRequest & {
  readonly roomCode: string;
};

export type CreateJoinPanelProps = {
  readonly characterOptions: readonly CharacterOption[];
  readonly createState?: ActionState;
  readonly joinState?: ActionState;
  readonly onCreate: (request: CreateRoomRequest) => void;
  readonly onJoin: (request: JoinRoomRequest) => void;
};

export type RoomFormSubmitEvent = FormEvent<HTMLFormElement>;

/** Difficulty ids are opaque on the wire; the roster shows this uppercase. */
export function botDifficultyLabel(difficulty: BotDifficulty | null): string {
  switch (difficulty) {
    case "easy":
      return "Easy";
    case "standard":
      return "Standard";
    case "ruthless":
      return "Ruthless";
    default:
      return "Unrated";
  }
}

/** Seat colour token, paired everywhere with the seat-number glyph (§8). */
export function seatColorToken(seat: number): string {
  return `var(--player-${(seat % 6) + 1})`;
}

export function seatLabel(seat: number): string {
  return String(seat + 1).padStart(2, "0");
}
