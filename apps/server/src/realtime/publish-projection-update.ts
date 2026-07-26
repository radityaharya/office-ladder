import { parseProjectionUpdated } from "@office-ladder/contracts";
import type { ProjectionUpdated } from "@office-ladder/contracts";
import { projectPlayerView, projectPublicView } from "@office-ladder/engine";
import type {
  GameState,
  LogicalTimestamp,
  PlayerGameProjection,
  PlayerId,
  PublicGameProjection,
  ReactionWindowState,
} from "@office-ladder/engine";
import { log, logException } from "@/observability/log";
import { publishRoomUpdatePerSocket } from "./publish-room-update";
import { parseRoomTopic } from "./room-topic";
import { roomSubscriberIds } from "./ws-hub";

/**
 * The room id *is* the Realtime topic: `apps/web`'s subscribeRoomUpdates()
 * connects to /ws/rooms/:roomTopic with the room id, and a randomUUID room id
 * satisfies both parseOpaqueId and publish-room-update's
 * opaqueRoomTopicPattern. The revision returned by the mutation that just
 * committed is the same number a bootstrap would report, so no extra read is
 * needed to *announce* it.
 *
 * Lives in its own module so both the HTTP routes and the bot driver can push
 * updates without the routes and the room/bot singletons importing each other.
 *
 * Never throws and never rejects: the command it announces is already committed,
 * so a failed broadcast must not fail the request or abandon the remaining bot
 * turns — clients still poll. It is reported rather than discarded, because a
 * rejected payload drops the broadcast entirely, which is precisely the
 * silently-dead realtime path this helper exists to fix.
 *
 * ## Why this is per socket
 *
 * It used to publish one payload to a topic. That is safe only while no game
 * state is secret, and v2 makes several things secret at once — hands, secret
 * objectives, hidden sabotage, sealed ballots, `owner-only` placements. A single
 * shared frame carrying any of them is a leak by construction, whatever the UI
 * chooses to render (spec §7.2, §11.3). So every socket now receives
 * `projectPlayerView(state, thatViewersPlayerId)`, and a viewer with no seat in
 * the match receives `projectPublicView(state)`.
 *
 * The viewer is the subscriber id the hub was registered with, which
 * authorize-room-socket.ts resolved from the **authenticated session** at
 * upgrade time. Nothing a client sends over the socket is read anywhere in this
 * path, so there is no message a player can send that makes them somebody else.
 */
export const PROJECTION_CHANGE_AREAS_ON_COMMAND = [
  "room",
  "game",
  "players",
  "prompts",
  "reactions",
  "legal-actions",
  "history",
  // The v2 shared state (projects, agreements, ballots, placements, economy,
  // quarters) moves on the same commands the v1 areas do, and a client that
  // re-fetched on every other area but not this one would render a stale market
  // beside a fresh board.
  "gameplay",
] as const satisfies ProjectionUpdated["changed"];

/**
 * A push frame that carries one viewer's whole state, as opposed to
 * `projection-updated`, which carries only the news that state moved.
 *
 * `viewerId` is echoed so a client can assert the frame is addressed to it
 * rather than assume — the server resolved that id from the session, and a
 * client that finds somebody else's id here should discard the frame and
 * reconnect rather than render it.
 */
export type ProjectionPush = {
  readonly kind: "projection";
  readonly messageId: string;
  readonly aggregateVersion: number;
  readonly projectionRevision: number;
  /** `null` for a member with no seat in this match — a spectator's view. */
  readonly viewerId: PlayerId | null;
  readonly seated: boolean;
  readonly projection: PlayerGameProjection | PublicGameProjection;
};

/**
 * A reaction window appearing or disappearing, pushed to the players eligible
 * for it and to nobody else.
 *
 * This exists because of the clock, not because of the data: an eight-second
 * window that arrives on the next poll is not a mechanic (spec §11.3). The
 * window is already inside the `projection` frame that precedes it; this frame
 * is the *interrupt*, so a client can raise the prompt immediately instead of
 * diffing two projections to notice.
 */
export type ReactionWindowPush = {
  readonly kind: "window-opened" | "window-closed";
  readonly messageId: string;
  readonly projectionRevision: number;
  readonly windowId: string;
  readonly windowKind: ReactionWindowState["kind"];
  readonly deadlineAt: LogicalTimestamp | null;
  readonly hasPriority: boolean;
};

export type RoomProjectionPush =
  | ProjectionUpdated
  | ProjectionPush
  | ReactionWindowPush;

/**
 * Just enough of a stored room to project it. Deliberately structural rather
 * than `StoredRoom`: this module needs the canonical game and nothing else, and
 * a narrow shape is what lets a test supply one without a repository.
 */
export type RoomRealtimeSnapshot = {
  readonly game: GameState | null;
};

export type RoomSnapshotSource = (
  roomId: string,
) => Promise<RoomRealtimeSnapshot | null>;

let snapshotSource: RoomSnapshotSource | null = null;

/**
 * Overrides where the canonical game comes from. Tests use this; production
 * leaves it unset and gets the room repository (see `loadSnapshot`).
 *
 * Pass `null` to restore the default — tests that set it must restore it, or a
 * later test in the same process inherits a source it never asked for.
 */
export function setRoomSnapshotSource(source: RoomSnapshotSource | null): void {
  snapshotSource = source;
}

/**
 * The canonical game for a room.
 *
 * Resolved through a **deferred** import on purpose. This module exists so that
 * routes/rooms.ts and the bot driver can publish without importing the room and
 * bot singletons through each other; a static `import { roomRepository }` would
 * put that cycle back (bots/default-driver.ts imports *this* file). Importing at
 * call time, after every module is loaded, keeps the module graph acyclic while
 * still giving the fan-out the state it cannot be handed — none of the four call
 * sites has the `GameState` in hand, they all hold a summary with a revision.
 */
async function loadSnapshot(roomId: string): Promise<RoomRealtimeSnapshot | null> {
  if (snapshotSource !== null) return snapshotSource(roomId);
  const { roomRepository } = await import("@/rooms/default-service");
  return roomRepository.get(roomId);
}

type TrackedWindow = {
  readonly kind: ReactionWindowState["kind"];
  readonly eligiblePlayerIds: readonly PlayerId[];
  readonly priorityPlayerId: PlayerId | null;
  readonly deadlineAt: LogicalTimestamp | null;
};

/**
 * The reaction windows this instance last saw open, per room, so opening and
 * closing can be published as edges rather than as a state a client has to
 * diff for itself.
 *
 * Per instance and in memory on purpose: sockets are per instance too, so the
 * only windows worth diffing here are the ones this instance's sockets would be
 * told about. The map is evicted the moment a room has no subscribers, which
 * bounds it by "rooms being watched on this box" rather than by "rooms".
 *
 * The cost of that eviction is that a window which opened while nobody was
 * connected produces no `window-opened` edge for the first client to arrive.
 * That client is bootstrapping over HTTP anyway and sees the window in its
 * projection; the edge is an interrupt for clients already watching.
 */
const openWindowsByRoom = new Map<string, ReadonlyMap<string, TrackedWindow>>();

export async function publishProjectionUpdate(
  roomId: string,
  revision: number,
  messageId: string,
): Promise<void> {
  try {
    try {
      // Cheapest refusal first, and the one that must precede the repository
      // read: a code-shaped topic is refused by the publish path anyway (see
      // room-topic.ts), so discovering that *after* loading the game would be a
      // free database round trip for anyone who can provoke one.
      parseRoomTopic(roomId);
    } catch {
      log("error", "realtime.publish-rejected", {
        room: roomId,
        revision,
        message: messageId,
        reason: "invalid_room_topic",
      });
      return;
    }

    let invalidation: ProjectionUpdated;
    try {
      invalidation = parseProjectionUpdated({
        kind: "projection-updated",
        messageId,
        aggregateVersion: revision,
        projectionRevision: revision,
        changed: PROJECTION_CHANGE_AREAS_ON_COMMAND,
      });
    } catch {
      // The payload this function built itself was refused, so *no* client can
      // be told the command landed. Nothing retries this — the room is silently
      // stale until somebody's next poll.
      log("error", "realtime.publish-rejected", {
        room: roomId,
        revision,
        message: messageId,
        reason: "invalid_projection_update",
      });
      return;
    }

    const subscribers = roomSubscriberIds(roomId);
    if (subscribers.length === 0) {
      // Nobody is watching this room on this instance. Skipping the repository
      // read here is what keeps the common cases free: a bot-only match, and a
      // host who starts before anyone's socket is open.
      openWindowsByRoom.delete(roomId);
      return;
    }

    const state = await loadState(roomId, messageId);
    const build = createViewBuilder(state, invalidation, roomId);

    const published = await publishRoomUpdatePerSocket({
      roomTopic: roomId,
      messageId,
      build,
    });
    if (!published.ok) {
      log("error", "realtime.publish-rejected", {
        room: roomId,
        revision,
        message: messageId,
        reason: published.error.kind,
      });
    }
  } catch (error) {
    logException("error", "realtime.publish-failed", error, {
      room: roomId,
      revision,
      message: messageId,
    });
  }
}

/**
 * The canonical game, or `null` if it cannot be read.
 *
 * A failed read degrades to the invalidation-only broadcast this function used
 * to be — every client re-fetches its own bootstrap on an invalidation, so the
 * room stays correct, just one round trip slower. Losing the announcement
 * *entirely* because a read failed would be strictly worse.
 */
async function loadState(
  roomId: string,
  messageId: string,
): Promise<GameState | null> {
  try {
    const snapshot = await loadSnapshot(roomId);
    return snapshot?.game ?? null;
  } catch (error) {
    logException("warn", "realtime.projection-source-failed", error, {
      room: roomId,
      message: messageId,
    });
    return null;
  }
}

/**
 * Builds the frames one viewer gets: the invalidation, then that viewer's own
 * projection, then the reaction-window edges that viewer is eligible for.
 *
 * Order matters. The projection carries the window, so a client that acts on
 * `window-opened` has already applied the state the window refers to.
 */
function createViewBuilder(
  state: GameState | null,
  invalidation: ProjectionUpdated,
  roomId: string,
) {
  if (state === null) {
    openWindowsByRoom.delete(roomId);
    return () => [invalidation];
  }

  const edges = diffReactionWindows(roomId, state);
  // Every unseated viewer gets the identical table view, so it is computed at
  // most once for the whole fan-out rather than once per spectator.
  let publicView: PublicGameProjection | null = null;

  return (subscriberId: string): readonly RoomProjectionPush[] => {
    const viewerId = subscriberId as PlayerId;
    // `Object.hasOwn`, not `in` and not a truthiness check: `players` is a plain
    // object decoded from JSON, so `players["constructor"]` answers with
    // `Object`'s and a viewer called `constructor` would be treated as seated
    // and then crash the projection. The id comes from an authenticated session
    // and is therefore not freely chosen, but "not freely chosen" is not the
    // same as "cannot be that".
    const seated =
      Object.hasOwn(state.players, viewerId) && state.players[viewerId] !== undefined;
    if (!seated && publicView === null) {
      publicView = projectPublicView(state);
    }

    const projection: ProjectionPush = {
      kind: "projection",
      messageId: invalidation.messageId,
      aggregateVersion: invalidation.aggregateVersion,
      projectionRevision: invalidation.projectionRevision,
      viewerId: seated ? viewerId : null,
      seated,
      projection: seated
        ? projectPlayerView(state, viewerId)
        : (publicView as PublicGameProjection),
    };

    const frames: RoomProjectionPush[] = [invalidation, projection];
    if (!seated) return frames;

    for (const edge of edges) {
      if (!edge.window.eligiblePlayerIds.includes(viewerId)) continue;
      frames.push({
        kind: edge.kind,
        messageId: invalidation.messageId,
        projectionRevision: invalidation.projectionRevision,
        windowId: edge.windowId,
        windowKind: edge.window.kind,
        deadlineAt: edge.window.deadlineAt,
        hasPriority: edge.window.priorityPlayerId === viewerId,
      });
    }
    return frames;
  };
}

type ReactionWindowEdge = {
  readonly kind: "window-opened" | "window-closed";
  readonly windowId: string;
  readonly window: TrackedWindow;
};

/**
 * Which windows appeared and which disappeared since this instance's last
 * publish for this room.
 *
 * A closed window is described from what was *remembered*, not from current
 * state — by the time it closes it is gone from `state.reactionWindows`, and
 * the eligibility list is the only thing that says who should be told it is
 * over.
 */
function diffReactionWindows(
  roomId: string,
  state: GameState,
): readonly ReactionWindowEdge[] {
  const previous = openWindowsByRoom.get(roomId) ?? new Map<string, TrackedWindow>();
  const current = new Map<string, TrackedWindow>();
  for (const window of state.reactionWindows) {
    current.set(window.id, {
      kind: window.kind,
      eligiblePlayerIds: [...window.eligiblePlayerIds],
      priorityPlayerId: window.priorityPlayerId,
      deadlineAt: window.deadlineAt,
    });
  }

  const edges: ReactionWindowEdge[] = [];
  for (const [windowId, window] of current) {
    if (!previous.has(windowId)) {
      edges.push({ kind: "window-opened", windowId, window });
    }
  }
  for (const [windowId, window] of previous) {
    if (!current.has(windowId)) {
      edges.push({ kind: "window-closed", windowId, window });
    }
  }

  if (current.size === 0) {
    openWindowsByRoom.delete(roomId);
  } else {
    openWindowsByRoom.set(roomId, current);
  }
  return edges;
}

/**
 * Forgets every remembered reaction window. Tests only — the module-level map
 * outlives an individual test, and a leftover entry would suppress the
 * `window-opened` edge the next test is asserting on.
 */
export function resetReactionWindowTracking(): void {
  openWindowsByRoom.clear();
}
