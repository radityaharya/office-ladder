import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GameBoard } from "./game-board";
import { PlayerToken, renderableAvatarUrl } from "./player-token";
import type { BoardSpaceView, PlayerTokenView } from "./types";

const incident = {
  status: "Round 1 · Turn 1",
  title: "Mina's turn",
  marker: { tone: "info", label: "Turn in progress" },
} as const;

const corners = ["bottom-right", "bottom-left", "top-left", "top-right"] as const;

function createSpaces(): readonly BoardSpaceView[] {
  return Array.from({ length: 44 }, (_, index): BoardSpaceView => {
    const base = {
      id: `tile-${index}`,
      index,
      zone: "workfloor",
      code: "WRK",
      label: "Work",
      zoneLabel: "Work floor",
      kindId: "work",
    } as const;

    if (index % 11 === 0) {
      return {
        ...base,
        placement: "corner",
        coordinate: corners[index / 11] ?? "bottom-right",
      };
    }

    const sides = ["bottom", "left", "top", "right"] as const;

    return {
      ...base,
      placement: "side",
      side: sides[Math.floor(index / 11)] ?? "bottom",
      coordinate: index % 11,
    };
  });
}

function board(players: readonly PlayerTokenView[]): string {
  return renderToStaticMarkup(
    <GameBoard incident={incident} players={players} spaces={createSpaces()} />,
  );
}

describe("player photos on tokens", () => {
  it("draws the player's own photo on their piece", () => {
    // Given a seated player with an avatar
    const players = [
      {
        id: "p-1",
        name: "Mina Rahardjo",
        seat: 1,
        position: 7,
        initials: "MR",
        avatarUrl: "https://cdn.example.com/u/mina.jpg",
      },
    ] as const satisfies readonly PlayerTokenView[];

    // When
    const markup = board(players);

    // Then the photo is on the token, not only in a rail dossier.
    expect(markup).toContain('data-board-face="photo"');
    expect(markup).toContain('src="https://cdn.example.com/u/mina.jpg"');
    expect(markup).toContain('class="board-token-photo"');
    // Decorative: the token's accessible name already states the player.
    expect(markup).toContain('alt=""');
    expect(markup).toContain("Mina Rahardjo, seat 1, space 08");
  });

  it("keeps the seat initial underneath the photo so a failed load cannot leave a hole", () => {
    // Given
    const markup = board([
      {
        id: "p-1",
        name: "Mina Rahardjo",
        seat: 1,
        position: 7,
        initials: "MR",
        avatarUrl: "https://cdn.example.com/u/mina.jpg",
      },
    ]);

    // Then the fallback is a real element in flow even while the photo is
    // present, which is what makes dropping the `img` on `error` free of any
    // layout change — and what makes the resting markup correct with no images at
    // all.
    expect(markup).toContain('<span aria-hidden="true" class="board-token-initial">M</span>');
  });

  it("falls back to the seat initial when a player has no avatar, never a broken image", () => {
    // Given — the common case today: nothing in the app can set an avatar yet.
    const markup = board([
      { id: "p-1", name: "omar", seat: 2, position: 3, initials: "O" },
    ]);

    // Then
    expect(markup).toContain('data-board-face="initial"');
    expect(markup).toContain('class="board-token-initial">O<');
    expect(markup).not.toContain("board-token-photo");
    expect(markup).not.toContain("<img");
  });

  it("identifies a bot as a bot rather than as a human with a missing photo", () => {
    // Given a bot beside a human on the same space
    const markup = board([
      { id: "p-1", name: "Mina", seat: 1, position: 4, initials: "M" },
      { id: "p-2", name: "Ledger", seat: 2, position: 4, isBot: true },
    ]);

    // Then the bot has no face cell at all — a bot's `avatarUrl` is always null,
    // so an empty square would be a lie — and spends that width on saying BOT.
    expect(markup.match(/class="board-token-face"/g)).toHaveLength(1);
    expect(markup).toContain('<span class="board-token-bot">BOT</span>');
    expect(markup).toContain('data-board-token-bot="true"');
    expect(markup).toContain("Ledger, seat 2, bot, space 05");
  });

  it("keeps bot-ness readable at compact density, where the BOT tag cannot fit", () => {
    // Given three plates on one space, which drops every plate to seat-only
    const markup = board([
      { id: "p-1", name: "Mina", seat: 1, position: 4, initials: "M" },
      { id: "p-2", name: "Ledger", seat: 2, position: 4, isBot: true },
      { id: "p-3", name: "Judge", seat: 3, position: 4, isBot: true },
    ]);

    // Then the tag and the faces are gone, but the bot marker on the token
    // survives — it drives a width-free hatched rule in board.css, so bot-ness no
    // longer lives only in the accessible name at this density.
    expect(markup).toContain('data-board-token-density="compact"');
    expect(markup).not.toContain("board-token-face");
    expect(markup).not.toContain("board-token-bot\">BOT");
    expect(markup.match(/data-board-token-bot="true"/g)).toHaveLength(2);
    expect(markup).toContain("Judge, seat 3, bot, space 05");
  });

  it("reserves the wider faced plate in the dock so two photos cannot overlap", () => {
    // Given two humans on one space, both with photos
    const markup = board([
      {
        id: "p-1",
        name: "Mina",
        seat: 1,
        position: 7,
        initials: "M",
        avatarUrl: "https://cdn.example.com/a.jpg",
      },
      {
        id: "p-2",
        name: "Omar",
        seat: 2,
        position: 7,
        initials: "O",
        avatarUrl: "https://cdn.example.com/b.jpg",
      },
    ]);

    // Then the second plate is offset by the faced plate's real width (28px) plus
    // the 1px dock seam — 57px of a ~93px usable dock, so both fit.
    expect(markup).toContain('data-board-token-density="full"');
    expect(markup).toContain("translateX(29px)");
  });

  it("still renders a plate outside the board grid, for a roster or a legend", () => {
    // Given no cell
    const markup = renderToStaticMarkup(
      <PlayerToken
        player={{
          id: "p-1",
          name: "Mina",
          seat: 3,
          position: 0,
          initials: "M",
          avatarUrl: "/avatars/mina.png",
        }}
      />,
    );

    // Then — same face, same seat glyph, no travel or dock machinery.
    expect(markup).toContain('data-board-seat="3"');
    expect(markup).toContain('src="/avatars/mina.png"');
    expect(markup).toContain('class="board-token-seat">3<');
    expect(markup).not.toContain("board-token-travel");
  });
});

describe("avatar url gate", () => {
  it("accepts only https absolute urls and root-relative same-origin paths", () => {
    // Then
    expect(renderableAvatarUrl("https://cdn.example.com/u/1.png")).toBe(
      "https://cdn.example.com/u/1.png",
    );
    expect(renderableAvatarUrl("HTTPS://cdn.example.com/u/1.png")).toBe(
      "HTTPS://cdn.example.com/u/1.png",
    );
    expect(renderableAvatarUrl("/avatars/1.png")).toBe("/avatars/1.png");
    expect(renderableAvatarUrl("  /avatars/1.png  ")).toBe("/avatars/1.png");
  });

  it("rejects every scheme and shape that must never reach an img src", () => {
    // Then — the server already guarantees this; the render boundary checks it
    // again rather than trusting a value that arrived over the wire.
    expect(renderableAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(renderableAvatarUrl("data:image/svg+xml,<svg/>")).toBeNull();
    expect(renderableAvatarUrl("blob:https://example.com/x")).toBeNull();
    expect(renderableAvatarUrl("file:///etc/passwd")).toBeNull();
    expect(renderableAvatarUrl("http://cdn.example.com/u/1.png")).toBeNull();
    // Protocol-relative inherits the page scheme and is not same-origin.
    expect(renderableAvatarUrl("//cdn.example.com/u/1.png")).toBeNull();
    // Attribute-terminating and control characters.
    expect(renderableAvatarUrl('https://x/a" onerror="alert(1)')).toBeNull();
    expect(renderableAvatarUrl("https://x/a'b")).toBeNull();
    expect(renderableAvatarUrl("https://x/a\nb")).toBeNull();
    expect(renderableAvatarUrl("https://x/a b")).toBeNull();
  });

  it("treats absent, empty and over-long values as no avatar", () => {
    // Then
    expect(renderableAvatarUrl(null)).toBeNull();
    expect(renderableAvatarUrl(undefined)).toBeNull();
    expect(renderableAvatarUrl("   ")).toBeNull();
    expect(renderableAvatarUrl(`https://x/${"a".repeat(600)}`)).toBeNull();
  });

  it("never places a rejected url in the markup", () => {
    // Given a hostile value that somehow reached a projection
    const markup = board([
      {
        id: "p-1",
        name: "Mina",
        seat: 1,
        position: 2,
        initials: "M",
        avatarUrl: "javascript:alert(1)",
      },
    ]);

    // Then it degrades to the same fallback as "no avatar".
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("<img");
    expect(markup).toContain('data-board-face="initial"');
  });
});

/*
 * Measured in headless Chrome at the shell's real 1184px, where a tile is
 * 97.5x50.7 and the plate 14px tall. Two findings from that pass, neither of which
 * `renderToStaticMarkup` can see.
 */
describe("token photo geometry", () => {
  const stylesheet = readFileSync(
    fileURLToPath(new URL("../../../styles/board.css", import.meta.url)),
    "utf8",
  );

  it("covers the fixed face cell without cropping the plate or rounding it", () => {
    // Given
    const face = stylesheet.slice(
      stylesheet.indexOf(".board-token-face {"),
      stylesheet.indexOf("}", stylesheet.indexOf(".board-token-face {")),
    );
    const photo = stylesheet.slice(
      stylesheet.indexOf(".board-token-photo {"),
      stylesheet.indexOf("}", stylesheet.indexOf(".board-token-photo {")),
    );

    // Then — a definite 14px cell with the photo absolutely positioned over the
    // initial, so a missing, blocked or broken avatar changes no geometry.
    // Measured: 27.6px plate with a loaded photo, a failed photo, and no photo.
    expect(face).toContain("width: 14px");
    expect(face).toContain("position: relative");
    expect(photo).toContain("position: absolute");
    expect(photo).toContain("object-fit: cover");
    // Board pieces are square (DESIGN.md §4.2) — a round avatar reads as a social
    // app rather than a terminal.
    expect(photo).toContain("border-radius: 0");
  });

  it("marks a bot without overwriting the seat's own pattern", () => {
    // Then — the machine rule is a pseudo-element, not a second background-image:
    // the per-seat pattern IS a background-image, and overwriting it would trade
    // one §8 guarantee for another. Measured: both survive on a bot plate.
    expect(stylesheet).toContain(
      '.board-token[data-board-token-bot="true"] .board-token-plate::after',
    );
    expect(stylesheet).toContain('.board-token-plate[data-board-bot="true"]::after');
  });
});
