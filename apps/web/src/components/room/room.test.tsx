import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CreateJoinPanel,
  LobbyPanel,
  PlayerDossier,
  ReadinessSummary,
  RoomHeader,
  type CharacterOption,
  type LobbyPlayer,
} from "./index";

const characters = [
  { id: "operator", label: "The Operator" },
  { id: "closer", label: "The Closer" },
] satisfies readonly CharacterOption[];

const players = [
  {
    id: "player-1",
    name: "Avery",
    isHost: true,
    isCurrentPlayer: true,
    isReady: true,
    characterId: "operator",
    characterLabel: "The Operator",
  },
  {
    id: "player-2",
    name: "Morgan",
    isHost: false,
    isCurrentPlayer: false,
    isReady: false,
    characterId: null,
    characterLabel: null,
  },
] satisfies readonly LobbyPlayer[];

describe("room primitives", () => {
  it("renders room identity and the supported player range", () => {
    // Given
    const roomCode = "Q4W8ZT";

    // When
    const markup = renderToStaticMarkup(
      <RoomHeader roomCode={roomCode} playerCount={2} />,
    );

    // Then
    expect(markup).toContain(roomCode);
    expect(markup).toContain("3–6 players");
  });

  it("renders a dossier as a list row with a functional character select", () => {
    // Given
    const player = players[0];

    // When
    const markup = renderToStaticMarkup(
      <PlayerDossier
        player={player}
        characterOptions={characters}
        onCharacterChange={vi.fn()}
      />,
    );

    // Then
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain("<select");
    expect(markup).toContain("Host");
  });

  it("summarizes readiness without hiding the minimum-player requirement", () => {
    // Given
    const minimumPlayers = 3;

    // When
    const markup = renderToStaticMarkup(
      <ReadinessSummary players={players} minimumPlayers={minimumPlayers} />,
    );

    // Then
    expect(markup).toContain("1 of 2 ready");
    expect(markup).toContain("1 more player required");
  });

  it("renders roster seats and the host start control in the ready lobby", () => {
    // Given
    const onStart = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <LobbyPanel
        state={{
          kind: "ready",
          players,
          characterOptions: characters,
          minimumPlayers: 3,
          maximumPlayers: 6,
          startControl: {
            kind: "blocked",
            reason: "Waiting for one more player",
          },
          onStart,
        }}
      />,
    );

    // Then
    expect(markup).toContain('role="list"');
    expect(markup).toContain("Open seat 3");
    expect(markup).toContain("Waiting for one more player");
  });

  it("renders create and join actions with disabled loading state", () => {
    // Given
    const onCreate = vi.fn();
    const onJoin = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <CreateJoinPanel
        createState={{ kind: "loading" }}
        joinState={{ kind: "idle" }}
        characterOptions={characters}
        onCreate={onCreate}
        onJoin={onJoin}
      />,
    );

    // Then
    expect(markup).toContain("Creating room");
    expect(markup).toContain("Join room");
    expect(markup).toContain("disabled");
  });
});
