import type { CSSProperties } from "react";

import {
  botDifficultyLabel,
  seatColorToken,
  seatLabel,
  type CharacterOption,
  type LobbyPlayer,
} from "./types";

type PlayerDossierProps = {
  readonly player: LobbyPlayer;
  readonly characterOptions: readonly CharacterOption[];
  readonly onCharacterChange?: (characterId: string) => void;
  readonly onReadyChange?: (isReady: boolean) => void;
  /** Host-only. Absent for every non-host viewer and for human seats. */
  readonly onRemoveBot?: () => void;
  readonly isRemoving?: boolean;
  readonly disabled?: boolean;
};

/**
 * One roster row on the facilities terminal. Seat identity is colour *plus* the
 * mono seat glyph, and a bot seat is marked with the literal word "BOT" beside
 * its difficulty — neither is ever carried by colour alone (DESIGN.md §8).
 */
export function PlayerDossier({
  player,
  characterOptions,
  onCharacterChange,
  onReadyChange,
  onRemoveBot,
  isRemoving = false,
  disabled = false,
}: PlayerDossierProps) {
  const canEditCharacter = player.isCurrentPlayer && onCharacterChange !== undefined;
  const canToggleReady = player.isCurrentPlayer && onReadyChange !== undefined;
  const seatId = `seat-${player.seat}`;
  const rowClassName = player.isCurrentPlayer
    ? "shell-seat shell-seat-self"
    : "shell-seat";

  return (
    <div
      role="listitem"
      className={rowClassName}
      style={{ "--shell-seat-color": seatColorToken(player.seat) } as CSSProperties}
      data-member-id={player.id}
      data-seat={player.seat}
      data-bot={player.isBot ? "true" : "false"}
    >
      {/*
        `role="img"` is load-bearing, not decoration: `aria-label` is PROHIBITED
        on an element that maps to the generic role (a bare `span`), so assistive
        tech drops it and announces the raw "01" glyph instead of the seat. The
        role gives the label something to attach to and replaces the glyph text.
      */}
      <span className="shell-seat-num" role="img" aria-label={`Seat ${player.seat + 1}`}>
        {seatLabel(player.seat)}
      </span>

      <div className="shell-seat-cell shell-seat-name">
        <span className="shell-body shell-high shell-truncate" id={`${seatId}-name`}>
          {player.name}
        </span>
        {player.isHost ? <span className="shell-tag shell-tag-strong">Host</span> : null}
        {player.isCurrentPlayer ? <span className="shell-tag shell-tag-strong">You</span> : null}
      </div>

      <div className="shell-seat-cell" data-label="Type">
        {player.isBot ? (
          <span className="shell-status">
            <span className="shell-led shell-led-info" aria-hidden="true" />
            <span className="shell-label shell-medium">
              Bot &middot; {botDifficultyLabel(player.botDifficulty)}
            </span>
          </span>
        ) : (
          <span className="shell-status">
            <span
              className={
                player.isConnected
                  ? "shell-led shell-led-active"
                  : "shell-led shell-led-idle"
              }
              aria-hidden="true"
            />
            <span className="shell-label shell-medium">
              {player.isConnected ? "Human" : "Human · Offline"}
            </span>
          </span>
        )}
      </div>

      <div className="shell-seat-cell" data-label="Assignment">
        {canEditCharacter ? (
          <label className="shell-field" htmlFor={`${seatId}-character`}>
            <span className="shell-sr-only">Character for {player.name}</span>
            <span className="shell-select-wrap">
              <select
                id={`${seatId}-character`}
                className="shell-select"
                value={player.characterId ?? ""}
                disabled={disabled}
                onChange={(event) => onCharacterChange(event.currentTarget.value)}
              >
                <option value="">Unassigned</option>
                {characterOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
        ) : (
          <span className="shell-body shell-medium shell-truncate">
            {player.characterLabel ?? "Assigned at start"}
          </span>
        )}
      </div>

      <div className="shell-seat-actions" data-label="Status">
        <span className="shell-status">
          <span
            className={
              player.isReady ? "shell-led shell-led-active" : "shell-led shell-led-caution"
            }
            aria-hidden="true"
          />
          <span className="shell-label shell-medium">
            {player.isReady ? "Ready" : "Standby"}
          </span>
        </span>

        {canToggleReady ? (
          <button
            type="button"
            className="shell-btn shell-btn-outline shell-btn-sm"
            aria-pressed={player.isReady}
            disabled={disabled || player.characterId === null}
            onClick={() => onReadyChange(!player.isReady)}
          >
            {player.isReady ? "Stand down" : "Mark ready"}
          </button>
        ) : null}

        {player.isBot && onRemoveBot !== undefined ? (
          <button
            type="button"
            className="shell-btn shell-btn-danger shell-btn-sm"
            disabled={disabled || isRemoving}
            aria-busy={isRemoving}
            aria-describedby={`${seatId}-name`}
            onClick={onRemoveBot}
          >
            {isRemoving ? "Removing" : "Remove"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
