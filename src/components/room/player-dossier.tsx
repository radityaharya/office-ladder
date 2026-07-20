import { RiShieldUserLine, RiUserLine } from "@remixicon/react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "../ui/native-select";
import { cn } from "../../lib/utils";

import type { CharacterOption, LobbyPlayer } from "./types";

type PlayerDossierProps = {
  readonly player: LobbyPlayer;
  readonly characterOptions: readonly CharacterOption[];
  readonly onCharacterChange?: (characterId: string) => void;
  readonly onReadyChange?: (isReady: boolean) => void;
  readonly disabled?: boolean;
};

export function PlayerDossier({
  player,
  characterOptions,
  onCharacterChange,
  onReadyChange,
  disabled = false,
}: PlayerDossierProps) {
  const canEditCharacter = player.isCurrentPlayer && onCharacterChange !== undefined;
  const canToggleReady = player.isCurrentPlayer && onReadyChange !== undefined;

  return (
    <div
      role="listitem"
      className={cn(
        "grid gap-4 border-b border-border px-4 py-5 last:border-b-0 sm:grid-cols-[minmax(0,1.25fr)_minmax(12rem,0.9fr)_auto] sm:items-center",
        player.isCurrentPlayer && "bg-muted/30",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center border border-border bg-background text-muted-foreground">
          {player.isHost ? (
            <RiShieldUserLine aria-hidden="true" />
          ) : (
            <RiUserLine aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="truncate font-heading text-base font-semibold text-foreground">
              {player.name}
            </p>
            {player.isHost ? <Badge>Host</Badge> : null}
            {player.isCurrentPlayer ? (
              <Badge variant="secondary">You</Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {player.characterLabel ?? "Character not assigned"}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        {canEditCharacter ? (
          <label className="block space-y-1">
            <span className="font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Character
            </span>
            <NativeSelect
              className="w-full"
              value={player.characterId ?? ""}
              disabled={disabled}
              aria-label={`Character for ${player.name}`}
              onChange={(event) => onCharacterChange(event.currentTarget.value)}
            >
              <NativeSelectOption value="">Choose character</NativeSelectOption>
              {characterOptions.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : (
          <div className="space-y-1">
            <p className="font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Assignment
            </p>
            <p className="text-sm text-foreground">
              {player.characterLabel ?? "Pending selection"}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <Badge variant={player.isReady ? "default" : "secondary"}>
          {player.isReady ? "Ready" : "Standby"}
        </Badge>
        {canToggleReady ? (
          <Button
            type="button"
            size="sm"
            variant={player.isReady ? "outline" : "default"}
            disabled={disabled || player.characterId === null}
            aria-pressed={player.isReady}
            onClick={() => onReadyChange(!player.isReady)}
          >
            {player.isReady ? "Stand down" : "Mark ready"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
