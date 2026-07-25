// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoomEntryClient } from "./room-entry-client";

const navigate = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

type RenderedClient = {
  readonly container: HTMLDivElement;
  readonly root: Root;
};

const renderedClients: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  for (const root of renderedClients.splice(0)) {
    act(() => root.unmount());
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("RoomEntryClient", () => {
  it("sends playerName in the create request body", async () => {
    // Given
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ room: { id: "room-created" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderClient();
    setFormValue(container, "#create-player-name", "Avery");
    setFormValue(container, "#create-character", "character.workaholic");

    // When
    await submitForm(container, "#create-player-name");

    // Then
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms",
      expect.objectContaining({
        body: JSON.stringify({
          mode: "mode.quick",
          capacity: 6,
          playerName: "Avery",
        }),
      }),
    );
  });

  it("sends playerName in the join request body", async () => {
    // Given
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ room: { id: "room-joined" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderClient();
    setFormValue(container, "#join-player-name", "Morgan");
    setFormValue(container, "#join-room-code", "q4w8zt");
    setFormValue(container, "#join-character", "character.socialButterfly");

    // When
    await submitForm(container, "#join-player-name");

    // Then
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/join",
      expect.objectContaining({
        body: JSON.stringify({ roomCode: "Q4W8ZT", playerName: "Morgan" }),
      }),
    );
  });
});

function renderClient(): RenderedClient {
  const container = document.createElement("div");
  const root = createRoot(container);
  renderedClients.push(root);
  act(() => root.render(<RoomEntryClient />));
  return { container, root };
}

function setFormValue(container: ParentNode, selector: string, value: string): void {
  const control = container.querySelector(selector);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
    throw new TypeError(`Expected form control for ${selector}.`);
  }
  control.value = value;
}

async function submitForm(container: ParentNode, inputSelector: string): Promise<void> {
  const input = container.querySelector(inputSelector);
  if (!(input instanceof HTMLInputElement) || input.form === null) {
    throw new TypeError(`Expected form for ${inputSelector}.`);
  }
  await act(async () => {
    input.form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
}
