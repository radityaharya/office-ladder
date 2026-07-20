import type { FormEvent } from "react";

export type CharacterOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type LobbyPlayer = {
  readonly id: string;
  readonly name: string;
  readonly isHost: boolean;
  readonly isCurrentPlayer: boolean;
  readonly isReady: boolean;
  readonly characterId: string | null;
  readonly characterLabel: string | null;
};

export type StartControl =
  | { readonly kind: "hidden" }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "enabled"; readonly label?: string }
  | { readonly kind: "loading"; readonly label?: string };

export type LobbyState =
  | { readonly kind: "loading"; readonly seatCount?: number }
  | { readonly kind: "error"; readonly message: string; readonly onRetry?: () => void }
  | {
      readonly kind: "ready";
      readonly players: readonly LobbyPlayer[];
      readonly characterOptions: readonly CharacterOption[];
      readonly minimumPlayers?: number;
      readonly maximumPlayers?: number;
      readonly startControl: StartControl;
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
