// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoomCodeCopyButton } from "./room-code-copy-button";

/**
 * The copy control is the one place in the lobby where the outcome of an action
 * is not visible in the layout — the glyph swap is the only visual signal — so
 * both outcomes have to reach a live region (DESIGN.md §8: every error is
 * announced, and status is never colour/icon alone).
 *
 * This needs a real DOM: the resting state carries no announcement at all, so
 * the assertions are about what happens AFTER the click resolves.
 */

const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("RoomCodeCopyButton", () => {
  it("renders a 28px-footprint icon control with an accessible name at rest", () => {
    // Given
    const container = render();

    // Then
    const button = requireButton(container);
    expect(button.getAttribute("aria-label")).toBe("Copy room code Q4W8ZT");
    expect(button.className).toContain("shell-btn-icon");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(liveRegionText(container)).toBe("");
  });

  it("announces a successful copy rather than relying on the glyph swap", async () => {
    // Given
    stubClipboard(() => Promise.resolve());
    const container = render();

    // When
    await click(requireButton(container));

    // Then
    expect(liveRegionText(container)).toBe("Room code copied");
    expect(requireButton(container).getAttribute("aria-label")).toBe(
      "Room code Q4W8ZT copied",
    );
  });

  it("announces a failed copy and names the manual recovery", async () => {
    // Given — a changed aria-label on the already-focused button is not
    // reliably re-read, so without the live region this failure was silent.
    stubClipboard(() => Promise.reject(new Error("Clipboard write denied")));
    const container = render();

    // When
    await click(requireButton(container));

    // Then
    expect(liveRegionText(container)).toBe(
      "Copy failed. Select the room code Q4W8ZT and copy it manually.",
    );
    expect(requireButton(container).getAttribute("data-copy-state")).toBe("error");
  });
});

function render(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<RoomCodeCopyButton roomCode="Q4W8ZT" />));
  return container;
}

function requireButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError("Expected the copy control to render.");
  }
  return button;
}

function liveRegionText(container: ParentNode): string {
  return container.querySelector('[aria-live="polite"]')?.textContent ?? "";
}

function stubClipboard(writeText: () => Promise<void>): void {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}
