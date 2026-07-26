// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoomEntryClient } from "./room-entry-client";
import { RoomLobbyClient } from "./room-lobby-client";

const navigate = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

// The lobby's realtime subscription would open a real socket in jsdom; the
// polling path already drives every assertion here.
vi.mock("@/realtime/room-channel", () => ({
  subscribeRoomUpdates: () => () => Promise.resolve(),
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
  it("sends playerName and the default mode in the create request body", async () => {
    // Given — the default is `mode.standard` now, not the `mode.quick` literal
    // that used to be hardcoded into this call and made every room ever created
    // a Quick room.
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ room: { id: "room-created" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderClient();
    setFormValue(container, "#create-player-name", "Avery");
    setFormValue(container, "#create-character", "character.workaholic");

    // When
    await submitForm(container, "#create-player-name");

    // Then — no `rules` key at all: a preset room is the preset, not a frozen
    // copy of one.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms",
      expect.objectContaining({
        body: JSON.stringify({
          mode: "mode.standard",
          capacity: 6,
          playerName: "Avery",
        }),
      }),
    );
  });

  it("posts whichever preset the host actually picked", async () => {
    // Given
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ room: { id: "room-created" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderClient();
    setFormValue(container, "#create-player-name", "Avery");
    setFormValue(container, "#create-character", "character.workaholic");

    // When the host chooses the longest preset instead of the default.
    await clickControl(container, 'input[value="mode.campaign"]');
    await submitForm(container, "#create-player-name");

    // Then
    expect(readCreateBody(fetchMock)).toMatchObject({ mode: "mode.campaign" });
  });

  it("rides an authored ruleset on the create body, under its base preset", async () => {
    // Given
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ room: { id: "room-created" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderClient();
    setFormValue(container, "#create-player-name", "Avery");
    setFormValue(container, "#create-character", "character.workaholic");

    // When the host opens the builder and flips one switch.
    await clickControl(container, 'input[value="mode.custom"]');
    await clickControl(container, "#create-rules-elimination");
    await submitForm(container, "#create-player-name");

    // Then the room is still created as Standard — `mode.custom` is not a
    // content preset — and the complete ruleset rides alongside it.
    const body = readCreateBody(fetchMock);
    expect(body["mode"]).toBe("mode.standard");
    expect(body["rules"]).toMatchObject({ conflict: { elimination: true } });
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

describe("RoomLobbyClient bot surface", () => {
  it("posts exactly { difficulty } to /api/rooms/:roomId/bots for the host", async () => {
    // Given a lone host, so the roster is two seats short of the minimum.
    const fetchMock = stubLobbyFetch([HOST_MEMBER], HOST_MEMBER.id);
    const { container } = await renderLobby();

    // When
    await clickAction(container, '[data-action="add-bot"]');

    // Then two seats are requisitioned, one request each, body exactly { difficulty }.
    const addCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(addCalls).toHaveLength(2);
    expect(addCalls[0]?.[0]).toBe("/api/rooms/room-1/bots");
    expect(addCalls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ difficulty: "standard" }),
    });
  });

  it("deletes a bot seat by member id in the path", async () => {
    // Given a startable room that already contains a bot.
    const fetchMock = stubLobbyFetch(
      [HOST_MEMBER, GUEST_MEMBER, BOT_MEMBER],
      HOST_MEMBER.id,
    );
    const { container } = await renderLobby();

    // When
    await clickAction(container, '.shell-btn-danger');

    // Then
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.[0]).toBe("/api/rooms/room-1/bots/bot%3Aroom-1%3A0");
    expect(deleteCalls[0]?.[1]).toMatchObject({
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: BOT_MEMBER.id }),
    });
  });

  it("renders the bot seat with its difficulty in text", async () => {
    // Given
    stubLobbyFetch([HOST_MEMBER, GUEST_MEMBER, BOT_MEMBER], HOST_MEMBER.id);

    // When
    const { container } = await renderLobby();

    // Then
    expect(container.textContent).toContain("Temp Analyst");
    expect(container.textContent).toContain("Ruthless");
    expect(container.querySelector('[data-bot="true"]')).not.toBeNull();
  });

  it("gives a non-host no bot controls at all", async () => {
    // Given the viewer is the guest, not the host.
    stubLobbyFetch([HOST_MEMBER, GUEST_MEMBER, BOT_MEMBER], GUEST_MEMBER.id);

    // When
    const { container } = await renderLobby();

    // Then
    expect(container.querySelector('[data-action="add-bot"]')).toBeNull();
    expect(container.querySelector("#bot-difficulty")).toBeNull();
    expect(container.querySelector('[data-action="start-match"]')).toBeNull();
    expect(container.querySelector(".shell-btn-danger")).toBeNull();
  });

  it("maps a server error code to copy the host can act on", async () => {
    // Given the server rejects the add because the room is no longer open.
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return Promise.resolve(Response.json(bootstrapBody([HOST_MEMBER], HOST_MEMBER.id)));
      }
      return Promise.resolve(
        Response.json({ error: { code: "ROOM_NOT_OPEN" } }, { status: 409 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = await renderLobby();

    // When
    await clickAction(container, '[data-action="add-bot"]');

    // Then
    expect(container.textContent).toContain("no longer open");
  });

  it("offers all three difficulties to the host", async () => {
    // Given
    stubLobbyFetch([HOST_MEMBER], HOST_MEMBER.id);

    // When
    const { container } = await renderLobby();
    const select = container.querySelector("#bot-difficulty");

    // Then
    if (!(select instanceof HTMLSelectElement)) {
      throw new TypeError("Expected the bot difficulty select.");
    }
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      "easy",
      "standard",
      "ruthless",
    ]);
  });

  it("states the exact shortfall for a lone host and points at the fix", async () => {
    // Given
    stubLobbyFetch([HOST_MEMBER], HOST_MEMBER.id);

    // When
    const { container } = await renderLobby();

    // Then
    expect(container.textContent).toContain("2 more members required");
    expect(container.textContent).toContain("Add 2 bots");
    const add = container.querySelector('[data-action="add-bot"]');
    const start = container.querySelector('[data-action="start-match"]');
    expect(add?.className).toContain("shell-btn-primary");
    expect(start?.className).toContain("shell-btn-outline");
    expect(start).toHaveProperty("disabled", true);
  });
});

type LobbyMemberFixture = {
  readonly id: string;
  readonly displayName: string;
  readonly seat: number;
  readonly isHost: boolean;
  readonly isBot: boolean;
  readonly botDifficulty: string | null;
};

const HOST_MEMBER: LobbyMemberFixture = {
  id: "player-1",
  displayName: "Avery",
  seat: 0,
  isHost: true,
  isBot: false,
  botDifficulty: null,
};

const GUEST_MEMBER: LobbyMemberFixture = {
  id: "player-2",
  displayName: "Morgan",
  seat: 1,
  isHost: false,
  isBot: false,
  botDifficulty: null,
};

const BOT_MEMBER: LobbyMemberFixture = {
  id: "bot:room-1:0",
  displayName: "Temp Analyst",
  seat: 2,
  isHost: false,
  isBot: true,
  botDifficulty: "ruthless",
};

/** Mirrors the shape apps/server's roomProjection() actually returns. */
function bootstrapBody(
  members: readonly LobbyMemberFixture[],
  selfMemberId: string,
): unknown {
  return {
    room: {
      id: "room-1",
      code: "Q4W8ZT",
      status: "open",
      mode: "mode.quick",
      capacity: 6,
      revision: 4,
      members: members.map((member) => ({
        ...member,
        isReady: true,
        isConnected: true,
      })),
    },
    selfMemberId,
  };
}

function stubLobbyFetch(
  members: readonly LobbyMemberFixture[],
  selfMemberId: string,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return Promise.resolve(Response.json(bootstrapBody(members, selfMemberId)));
    }
    return Promise.resolve(Response.json({ room: { id: "room-1", revision: 5 } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderLobby(): Promise<RenderedClient> {
  const container = document.createElement("div");
  const root = createRoot(container);
  renderedClients.push(root);
  act(() => root.render(<RoomLobbyClient roomId="room-1" />));
  // The initial load is scheduled on a 0ms timeout, then resolves a promise.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return { container, root };
}

async function clickAction(container: ParentNode, selector: string): Promise<void> {
  const control = container.querySelector(selector);
  if (!(control instanceof HTMLElement)) {
    throw new TypeError(`Expected a control for ${selector}.`);
  }
  await act(async () => {
    control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** The parsed body of the one POST to /api/rooms. */
function readCreateBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([input]) => input === "/api/rooms");
  const init = call?.[1] as RequestInit | undefined;
  if (typeof init?.body !== "string") {
    throw new TypeError("Expected a JSON body on the create request.");
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

/**
 * Clicks a control and lets React flush. A radio or checkbox needs a real click
 * rather than an assigned `.checked`: these are controlled inputs, so only the
 * activation behaviour produces the change event React is listening for.
 */
async function clickControl(container: ParentNode, selector: string): Promise<void> {
  const control = container.querySelector(selector);
  if (!(control instanceof HTMLElement)) {
    throw new TypeError(`Expected a control for ${selector}.`);
  }
  await act(async () => {
    control.click();
    await Promise.resolve();
  });
}

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
