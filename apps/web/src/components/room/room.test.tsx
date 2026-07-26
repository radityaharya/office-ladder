import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BOT_DIFFICULTIES } from "@office-ladder/contracts";

import {
  CreateJoinPanel,
  LobbyPanel,
  PlayerDossier,
  ReadinessSummary,
  RoomHeader,
  evaluateStartCheck,
  type BotRequisition,
  type CharacterOption,
  type LobbyPlayer,
} from "./index";

const characters = [
  { id: "operator", label: "The Operator" },
  { id: "closer", label: "The Closer" },
] satisfies readonly CharacterOption[];

const host = {
  id: "player-1",
  name: "Avery",
  seat: 0,
  isHost: true,
  isCurrentPlayer: true,
  isReady: true,
  isConnected: true,
  isBot: false,
  botDifficulty: null,
  characterId: "operator",
  characterLabel: "The Operator",
} satisfies LobbyPlayer;

const guest = {
  id: "player-2",
  name: "Morgan",
  seat: 1,
  isHost: false,
  isCurrentPlayer: false,
  isReady: false,
  isConnected: true,
  isBot: false,
  botDifficulty: null,
  characterId: null,
  characterLabel: null,
} satisfies LobbyPlayer;

const bot = {
  id: "bot:room-1:0",
  name: "Temp Analyst",
  seat: 2,
  isHost: false,
  isCurrentPlayer: false,
  isReady: true,
  isConnected: true,
  isBot: true,
  botDifficulty: "ruthless",
  characterId: null,
  characterLabel: null,
} satisfies LobbyPlayer;

const players = [host, guest] satisfies readonly LobbyPlayer[];

function requisition(overrides: Partial<BotRequisition> = {}): BotRequisition {
  return {
    state: "open",
    difficulties: BOT_DIFFICULTIES,
    difficulty: "standard",
    seatsToMinimum: 0,
    emphasis: "secondary",
    error: null,
    onDifficultyChange: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  };
}

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
    const player = host;

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

  it("names the seat a roster row belongs to instead of leaving a bare glyph", () => {
    // Given — `aria-label` is a prohibited attribute on a bare span (it maps to
    // the generic role), so the label needs a role to attach to or assistive
    // tech drops it and reads the raw "01".
    const markup = renderToStaticMarkup(
      <PlayerDossier player={guest} characterOptions={characters} />,
    );

    // Then
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Seat 2"');
  });

  it("summarizes readiness without hiding the minimum-player requirement", () => {
    // Given
    const minimumPlayers = 3;

    // When
    const markup = renderToStaticMarkup(
      <ReadinessSummary players={players} minimumPlayers={minimumPlayers} />,
    );

    // Then
    expect(markup).toContain("1 / 2");
    expect(markup).toContain("1 more member");
    expect(markup).toContain("Blocked");
  });

  it("announces the start check as one sentence rather than six bare numbers", () => {
    // Given — the lobby re-polls every 2s. With `aria-live` on the strip, each
    // changed readout announced on its own with no label; the detail line is the
    // one utterance that carries the whole state in words.
    const markup = renderToStaticMarkup(
      <ReadinessSummary players={players} minimumPlayers={3} />,
    );

    // Then — exactly one live region, and it is the detail sentence.
    expect(markup.match(/aria-live/g) ?? []).toHaveLength(1);
    expect(markup).toContain(
      '<p aria-atomic="true" aria-live="polite" class="shell-region shell-region-sunken shell-seam-bottom shell-body shell-medium shell-prose" data-slot="start-check-detail">',
    );
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

describe("bot seats", () => {
  it("labels a bot seat in words with its difficulty, not by colour alone", () => {
    // Given
    const player = bot;

    // When
    const markup = renderToStaticMarkup(
      <PlayerDossier player={player} characterOptions={characters} />,
    );

    // Then
    expect(markup).toContain('data-bot="true"');
    expect(markup).toContain("Bot");
    expect(markup).toContain("Ruthless");
    expect(markup).toContain("Temp Analyst");
  });

  it("marks a human seat as human so the roster is never ambiguous", () => {
    // Given
    const player = guest;

    // When
    const markup = renderToStaticMarkup(
      <PlayerDossier player={player} characterOptions={characters} />,
    );

    // Then
    expect(markup).toContain('data-bot="false"');
    expect(markup).toContain("Human");
    expect(markup).not.toContain("Ruthless");
  });

  it("offers the host a remove control on a bot seat only", () => {
    // Given
    const onRemoveBot = vi.fn();

    // When
    const botMarkup = renderToStaticMarkup(
      <PlayerDossier player={bot} characterOptions={characters} onRemoveBot={onRemoveBot} />,
    );
    const humanMarkup = renderToStaticMarkup(
      <PlayerDossier player={guest} characterOptions={characters} onRemoveBot={onRemoveBot} />,
    );

    // Then
    expect(botMarkup).toContain("Remove");
    expect(humanMarkup).not.toContain("Remove");
  });

  it("shows the host every difficulty the contract supports", () => {
    // When
    const markup = renderToStaticMarkup(
      <LobbyPanel
        state={{
          kind: "ready",
          players: [host, guest, bot],
          characterOptions: characters,
          minimumPlayers: 3,
          maximumPlayers: 6,
          startControl: { kind: "enabled" },
          botRequisition: requisition(),
        }}
      />,
    );

    // Then
    expect(markup).toContain('id="bot-difficulty"');
    expect(markup).toContain('data-action="add-bot"');
    for (const difficulty of BOT_DIFFICULTIES) {
      expect(markup).toContain(`value="${difficulty}"`);
    }
    expect(markup).toContain("Easy");
    expect(markup).toContain("Standard");
    expect(markup).toContain("Ruthless");
  });

  it("hides every bot control from a non-host instead of disabling them", () => {
    // When
    const markup = renderToStaticMarkup(
      <LobbyPanel
        state={{
          kind: "ready",
          players: [host, guest, bot],
          characterOptions: characters,
          minimumPlayers: 3,
          maximumPlayers: 6,
          startControl: { kind: "hidden" },
          botRequisition: null,
        }}
      />,
    );

    // Then
    expect(markup).not.toContain('data-action="add-bot"');
    expect(markup).not.toContain('id="bot-difficulty"');
    expect(markup).not.toContain('data-action="start-match"');
    expect(markup).not.toContain("Remove");
  });

  it("explains a full room rather than silently disabling the add control", () => {
    // When
    const markup = renderToStaticMarkup(
      <LobbyPanel
        state={{
          kind: "ready",
          players: [host, guest, bot],
          characterOptions: characters,
          minimumPlayers: 3,
          maximumPlayers: 3,
          startControl: { kind: "enabled" },
          botRequisition: requisition({ state: "full" }),
        }}
      />,
    );

    // Then
    expect(markup).toContain("Every seat is taken");
    expect(markup).toContain("disabled");
  });

  it("surfaces a rejected bot mutation as an inline entry, keeping the roster", () => {
    // Given
    const error = "Only the room host can do that.";

    // When
    const markup = renderToStaticMarkup(
      <LobbyPanel
        state={{
          kind: "ready",
          players: [host, guest, bot],
          characterOptions: characters,
          minimumPlayers: 3,
          maximumPlayers: 6,
          startControl: { kind: "enabled" },
          botRequisition: requisition({ error }),
        }}
      />,
    );

    // Then
    expect(markup).toContain(error);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Temp Analyst");
  });
});

describe("solo play discoverability", () => {
  it("names what is missing and offers the action that fixes it", () => {
    // Given a host alone in a room that needs three members.
    const state = {
      kind: "ready",
      players: [host],
      characterOptions: characters,
      minimumPlayers: 3,
      maximumPlayers: 6,
      startControl: {
        kind: "blocked",
        reason: "2 more members required — 3 is the minimum. Add bot seats to start now.",
      },
      botRequisition: requisition({ seatsToMinimum: 2, emphasis: "primary" }),
    } as const;

    // When
    const markup = renderToStaticMarkup(<LobbyPanel state={state} />);

    // Then the shortfall is stated, and the accent primary is the fix, not start.
    expect(markup).toContain("2 more members required");
    expect(markup).toContain("Add 2 bots");
    expect(markup).toContain("Bot seats count toward the minimum");
    expect(markup).toMatch(/shell-btn shell-btn-primary[^"]*"[^>]*data-action="add-bot"/);
    expect(markup).toMatch(/shell-btn shell-btn-outline[^"]*"[^>]*data-action="start-match"/);
  });

  it("tells a non-host who they are waiting on without offering a control", () => {
    // When
    const markup = renderToStaticMarkup(
      <LobbyPanel
        state={{
          kind: "ready",
          players: [host, guest],
          characterOptions: characters,
          minimumPlayers: 3,
          maximumPlayers: 6,
          startControl: { kind: "hidden" },
          botRequisition: null,
        }}
      />,
    );

    // Then
    expect(markup).toContain("The host still needs");
    expect(markup).toContain("1 more");
    expect(markup).not.toContain('data-action="add-bot"');
  });

  it("counts bot seats toward the minimum headcount", () => {
    // Given one human and two bots.
    const roster = [
      host,
      { ...bot, id: "bot:room-1:0", seat: 1 },
      { ...bot, id: "bot:room-1:1", seat: 2, name: "Contract Auditor", botDifficulty: "easy" },
    ] satisfies readonly LobbyPlayer[];

    // When
    const check = evaluateStartCheck(roster, 3, "open");

    // Then
    expect(check.level).toBe("cleared");
    expect(check.seatsToMinimum).toBe(0);
    expect(check.humanCount).toBe(1);
    expect(check.botCount).toBe(2);
  });

  it("reports the exact shortfall for a lone host", () => {
    // When
    const check = evaluateStartCheck([host], 3, "open");

    // Then
    expect(check.level).toBe("blocked");
    expect(check.seatsToMinimum).toBe(2);
    expect(check.detail).toContain("2 more members required");
  });
});

describe("lobby loading and failure states", () => {
  it("renders skeleton roster rows rather than a floating spinner", () => {
    // When
    const markup = renderToStaticMarkup(<LobbyPanel state={{ kind: "loading", seatCount: 3 }} />);

    // Then
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("shell-skel");
    expect(markup).not.toContain("role=\"status\"");
  });

  it("renders a retryable failure entry", () => {
    // Given
    const onRetry = vi.fn();

    // When
    const markup = renderToStaticMarkup(
      <LobbyPanel state={{ kind: "error", message: "Room not found.", onRetry }} />,
    );

    // Then
    expect(markup).toContain("Room not found.");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Retry");
  });
});
