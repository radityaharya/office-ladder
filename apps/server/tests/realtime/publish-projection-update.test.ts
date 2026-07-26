import { randomUUID } from "node:crypto";

import type { WSContext } from "hono/ws";
import { afterEach, describe, expect, it } from "vitest";

import { parseProjectionUpdated } from "@office-ladder/contracts";
import { createDeadlineDashGame, createStableId } from "@office-ladder/engine";
import type {
  BallotId,
  CardDefinitionId,
  CardInstanceId,
  DeckId,
  DecisionPointId,
  FrameId,
  GameId,
  GameState,
  ModeId,
  ObjectiveId,
  PlacementId,
  PlayerId,
  ProjectId,
  RoleId,
  StatusId,
  TileId,
} from "@office-ladder/engine";
import {
  publishProjectionUpdate,
  resetReactionWindowTracking,
  setRoomSnapshotSource,
  type ProjectionPush,
  type ReactionWindowPush,
  type RoomProjectionPush,
} from "../../src/realtime/publish-projection-update";
import { registerRoomSocket } from "../../src/realtime/ws-hub";

/**
 * publishProjectionUpdate is what routes/rooms.ts calls after every committed
 * roll/start/respond and every bot seat change, and what the bot driver calls
 * after each bot command. It builds the payloads itself and then discards the
 * publish result, so an invalid payload would drop the broadcast with no trace.
 *
 * Two things are pinned here. The transport chain — the room id the browser
 * subscribes with -> the topic the hub registers -> a payload the client's own
 * parser accepts — and, since v2 introduced hidden information, the far more
 * important property: **what one viewer receives cannot contain another
 * viewer's secrets** (spec §7.2, §11.3).
 *
 * The leak assertions below serialise a viewer's *entire* delivery and look for
 * a sentinel anywhere in the resulting string. Reading the fields a secret is
 * expected to live in is exactly the test that passes while the secret quietly
 * turns up nested somewhere new — under `data`, inside a prompt option, in an
 * outcome blob — which is how this class of bug ships.
 */
type RecordingSocket = {
  readonly sent: string[];
  readonly ws: WSContext;
};

function recordingSocket(): RecordingSocket {
  const sent: string[] = [];
  return {
    sent,
    ws: {
      send(message: string) {
        sent.push(message);
      },
    } as unknown as WSContext,
  };
}

/**
 * Registration can be refused (the per-subscriber socket cap), so these tests
 * assert it succeeded rather than silently testing an unregistered socket.
 */
function subscribe(
  roomTopic: string,
  subscriberId: string,
  ws: WSContext,
): () => void {
  const registered = registerRoomSocket({ roomTopic, subscriberId, ws });
  if (!registered.ok) {
    throw new Error(`socket registration refused: ${registered.error.code}`);
  }
  return registered.value.unregister;
}

const brand = <Id extends string>(value: string): Id => value as Id;

const alice = createStableId("PlayerId", "user-alice");
const bob = createStableId("PlayerId", "user-bob");
const carol = createStableId("PlayerId", "user-carol");

/**
 * Every secret that belongs to Bob. Each is a string that appears nowhere else
 * in a projection, so `expect(json).not.toContain(sentinel)` is a real search
 * rather than a coincidence.
 *
 * `sabotageAmount` is a number and therefore searched as the JSON fragment
 * `"amount":<n>`: hidden sabotage leaks by the entry existing at all, and its
 * amount is the only field on it that can be made unmistakable.
 */
const bobSecrets = {
  handCard: "card-bob-hand-secret",
  handDefinition: "definition-bob-hand-secret",
  privateStatus: "status-bob-private-secret",
  roleId: "role-bob-secret",
  objectiveDefinition: "objective-bob-secret-definition",
  sealedBid: "ballot-bob-sealed-bid-secret",
  ownerOnlyPlacement: "placement-bob-owner-only-secret",
  ownerOnlyPlacementData: "placement-bob-owner-only-data-secret",
} as const;

const BOB_SABOTAGE_AMOUNT = 917331;
const SABOTAGE_SENTINEL = `"amount":${BOB_SABOTAGE_AMOUNT}`;

/** Alice's own equivalents — the positive control for every leak assertion. */
const aliceSecrets = {
  handCard: "card-alice-hand-secret",
  handDefinition: "definition-alice-hand-secret",
} as const;

const everyBobSentinel: readonly string[] = [
  ...Object.values(bobSecrets),
  SABOTAGE_SENTINEL,
];

/**
 * A real three-seat match, created through the engine's own setup rather than
 * hand-written: the projection walks decks, cards, rules and turn state, and a
 * fixture that skipped any of them would test a shape production never produces.
 */
function startedGame(): GameState {
  const created = createDeadlineDashGame(
    {
      gameId: brand<GameId>("game-per-socket-projection-test"),
      modeId: brand<ModeId>("mode.standard"),
      authorizedStarterId: alice,
      players: [
        {
          id: alice,
          order: 0,
          characterId: brand("character.workaholic"),
          role: { id: brand<RoleId>("role-alice-public"), kind: "role.worker" },
        },
        {
          id: bob,
          order: 1,
          characterId: brand("character.social-butterfly"),
          role: {
            id: brand<RoleId>(bobSecrets.roleId),
            kind: "role.management",
          },
        },
        {
          id: carol,
          order: 2,
          characterId: brand("character.sales-star"),
          role: { id: brand<RoleId>("role-carol-public"), kind: "role.worker" },
        },
      ],
    },
    "seed-per-socket-projection-test",
  );
  if (!created.ok) {
    throw new Error(`fixture setup failed: ${created.error.code}`);
  }
  return created.value;
}

/**
 * The same match with one of every hidden-information kind the spec names,
 * all of it belonging to Bob except Alice's own hand.
 */
function gameWithSecrets(): GameState {
  const base = startedGame();
  const aliceCard = brand<CardInstanceId>(aliceSecrets.handCard);
  const bobCard = brand<CardInstanceId>(bobSecrets.handCard);
  const deckId = brand<DeckId>("deck.work");

  const alicePlayer = base.players[alice];
  const bobPlayer = base.players[bob];
  if (!alicePlayer || !bobPlayer) throw new Error("fixture lost a seat");

  return {
    ...base,
    players: {
      ...base.players,
      [alice]: { ...alicePlayer, hand: [aliceCard] },
      [bob]: {
        ...bobPlayer,
        hand: [bobCard],
        statuses: [
          {
            id: brand<StatusId>(bobSecrets.privateStatus),
            sourceId: null,
            stacks: 1,
            remainingTurns: null,
            expiresAtRound: null,
            visibility: "private",
            data: {},
          },
        ],
      },
    },
    cards: {
      ...base.cards,
      [aliceCard]: {
        id: aliceCard,
        definitionId: brand<CardDefinitionId>(aliceSecrets.handDefinition),
        deckId,
        zone: "hand",
        ownerId: alice,
        faceUp: false,
        data: {},
      },
      [bobCard]: {
        id: bobCard,
        definitionId: brand<CardDefinitionId>(bobSecrets.handDefinition),
        deckId,
        zone: "hand",
        ownerId: bob,
        faceUp: false,
        data: {},
      },
    },
    placements: [
      {
        id: brand<PlacementId>(bobSecrets.ownerOnlyPlacement),
        kind: "placement.sabotage",
        tileId: brand<TileId>("tile-3"),
        ownerId: bob,
        charges: 1,
        visibility: "owner-only",
        placedAtRound: 1,
        data: { marker: bobSecrets.ownerOnlyPlacementData },
      },
    ],
    projects: [
      {
        id: brand<ProjectId>("project-quarterly-report"),
        definitionId: "project.quarterly-report",
        leadPlayerId: carol,
        tileId: null,
        status: "open",
        requiredMoney: 100,
        requiredWork: 10,
        contributions: [],
        sabotage: [
          {
            playerId: bob,
            amount: BOB_SABOTAGE_AMOUNT,
            hidden: true,
            atRound: 1,
          },
        ],
        deadlineRound: 9,
        payout: { money: 500, reputation: 2, objectiveProgress: 1 },
        openToJoin: true,
        leadBonusBasisPoints: 1000,
      },
    ],
    objectives: [
      {
        id: brand<ObjectiveId>("objective-bob"),
        definitionId: bobSecrets.objectiveDefinition,
        ownerId: bob,
        progress: 2,
        target: 5,
        completedAtRound: null,
        visibility: "secret",
        rewardPoints: 3,
        rewardMoney: 250,
      },
    ],
    ballots: [
      {
        id: brand<BallotId>("ballot-promotion-block"),
        kind: "auction",
        subjectId: "subject-corner-office",
        subject: {},
        audience: [alice, bob, carol],
        castBy: { [bob]: bobSecrets.sealedBid },
        deadlineAt: null,
        closesAtRound: 4,
        visibility: "sealed",
        resolution: null,
      },
    ],
  };
}

/** A room whose game is `state`, served without touching a repository. */
function useSnapshot(state: GameState | null): void {
  setRoomSnapshotSource(async () => ({ game: state }));
}

function withReactionWindow(
  state: GameState,
  windowId: string,
  eligiblePlayerIds: readonly PlayerId[],
): GameState {
  return {
    ...state,
    reactionWindows: [
      {
        id: brand<DecisionPointId>(windowId),
        frameId: brand<FrameId>("frame-window-test"),
        kind: "promotion-block",
        eligiblePlayerIds: [...eligiblePlayerIds],
        priorityPlayerId: eligiblePlayerIds[0] ?? null,
        passedPlayerIds: [],
        playedByPlayerIds: [],
        deadlineAt: "2026-07-27T00:00:08.000Z",
        pendingEffectId: null,
      },
    ],
  };
}

const framesOf = (socket: RecordingSocket): readonly RoomProjectionPush[] =>
  socket.sent.map((message) => JSON.parse(message) as RoomProjectionPush);

const projectionFrame = (socket: RecordingSocket): ProjectionPush => {
  const frame = framesOf(socket).find(
    (candidate): candidate is ProjectionPush => candidate.kind === "projection",
  );
  if (!frame) throw new Error("no projection frame was delivered");
  return frame;
};

const windowFrames = (socket: RecordingSocket): readonly ReactionWindowPush[] =>
  framesOf(socket).filter(
    (frame): frame is ReactionWindowPush =>
      frame.kind === "window-opened" || frame.kind === "window-closed",
  );

/**
 * Everything this socket was sent, as one string. The unit of the leak
 * assertion is the whole delivery, not one frame: a secret that escapes into
 * the `window-opened` frame is exactly as leaked as one in the projection.
 */
const wholeDelivery = (socket: RecordingSocket): string => socket.sent.join("\n");

afterEach(() => {
  setRoomSnapshotSource(null);
  resetReactionWindowTracking();
});

describe("publishProjectionUpdate: the invalidation frame", () => {
  it("Given a socket subscribed with the room id, When a committed command publishes, Then the browser's own parser accepts what arrives", async () => {
    // Exactly what apps/web's subscribeRoomUpdates(roomId, ...) registers, and
    // exactly what ids.roomId (randomUUID) produces.
    const roomId = randomUUID();
    const commandId = randomUUID();
    const socket = recordingSocket();
    useSnapshot(null);
    const unregister = subscribe(roomId, randomUUID(), socket.ws);

    await publishProjectionUpdate(roomId, 7, commandId);
    unregister();

    expect(socket.sent).toHaveLength(1);
    // parseProjectionUpdated is the client-side gate too: if the hardcoded
    // `changed` list or the revision fields were wrong, the payload would never
    // have reached the socket at all, and the client would reject it if it did.
    const update = parseProjectionUpdated(JSON.parse(socket.sent[0] ?? "null"));
    expect(update).toEqual({
      kind: "projection-updated",
      messageId: commandId,
      aggregateVersion: 7,
      projectionRevision: 7,
      changed: [
        "room",
        "game",
        "players",
        "prompts",
        "reactions",
        "legal-actions",
        "history",
        "gameplay",
      ],
    });
  });

  it("Given a bot seat change, When it publishes with the bot member id as the messageId, Then the update still reaches the room", async () => {
    // The add/remove-bot routes have no client-supplied commandId, so they pass
    // the bot's member id instead. Colons are legal in contracts' ID_PATTERN,
    // but the payload is validated before broadcast, so this needs proving.
    const roomId = randomUUID();
    const socket = recordingSocket();
    useSnapshot(null);
    const unregister = subscribe(roomId, randomUUID(), socket.ws);

    await publishProjectionUpdate(roomId, 1, `bot:${roomId}:0`);
    unregister();

    expect(socket.sent).toHaveLength(1);
    expect(parseProjectionUpdated(JSON.parse(socket.sent[0] ?? "null"))).toMatchObject({
      messageId: `bot:${roomId}:0`,
      projectionRevision: 1,
    });
  });

  it("Given consecutive bot turns, When each publishes its own revision, Then the client's monotonic revision filter would keep every one", async () => {
    const roomId = randomUUID();
    const socket = recordingSocket();
    useSnapshot(null);
    const unregister = subscribe(roomId, randomUUID(), socket.ws);

    for (const revision of [4, 5, 6]) {
      await publishProjectionUpdate(roomId, revision, `bot:game:${revision}:roll`);
    }
    unregister();

    const revisions = socket.sent.map(
      (message) => parseProjectionUpdated(JSON.parse(message)).projectionRevision,
    );
    expect(revisions).toEqual([4, 5, 6]);
  });

  it("Given a room nobody is subscribed to, When it publishes, Then nothing throws, no other room is notified, and the state is never read", async () => {
    const other = recordingSocket();
    let reads = 0;
    setRoomSnapshotSource(async () => {
      reads += 1;
      return { game: null };
    });
    const unregister = subscribe(randomUUID(), randomUUID(), other.ws);

    await expect(
      publishProjectionUpdate(randomUUID(), 2, randomUUID()),
    ).resolves.toBeUndefined();
    unregister();

    expect(other.sent).toEqual([]);
    // A bot-only match and a host who starts before anyone connects both land
    // here, and neither should cost a repository read.
    expect(reads).toBe(0);
  });
});

describe("publishProjectionUpdate: per-viewer projections", () => {
  it("Given two seated players on one room, When a command publishes, Then each socket receives its own projectPlayerView", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const aliceSocket = recordingSocket();
    const bobSocket = recordingSocket();
    const releaseAlice = subscribe(roomId, alice, aliceSocket.ws);
    const releaseBob = subscribe(roomId, bob, bobSocket.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    releaseAlice();
    releaseBob();

    const aliceFrame = projectionFrame(aliceSocket);
    const bobFrame = projectionFrame(bobSocket);
    expect(aliceFrame.viewerId).toBe(alice);
    expect(aliceFrame.seated).toBe(true);
    expect(bobFrame.viewerId).toBe(bob);
    // The whole point: the two payloads are not the same payload.
    expect(JSON.stringify(aliceFrame.projection)).not.toEqual(
      JSON.stringify(bobFrame.projection),
    );
  });

  it("Given a viewer, When their projection arrives, Then it still contains their OWN hand — the leak assertions below mean nothing without this", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const socket = recordingSocket();
    const release = subscribe(roomId, alice, socket.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    release();

    const delivered = wholeDelivery(socket);
    expect(delivered).toContain(aliceSecrets.handCard);
    expect(delivered).toContain(aliceSecrets.handDefinition);
  });

  it("Given a room member with no seat in the match, When a command publishes, Then they get the public projection and no seat of their own", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const spectator = createStableId("PlayerId", "user-spectator");
    const socket = recordingSocket();
    const release = subscribe(roomId, spectator, socket.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    release();

    const frame = projectionFrame(socket);
    expect(frame.seated).toBe(false);
    expect(frame.viewerId).toBeNull();
    // projectPublicView has no `self` at all — there is no field a private
    // detail could travel in, which is the property being relied on.
    expect(frame.projection).not.toHaveProperty("self");
  });

  it("Given three tabs on one account and one on another, When a command publishes, Then every socket is served but the view is built once per viewer", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const tabs = [recordingSocket(), recordingSocket(), recordingSocket()];
    const bobSocket = recordingSocket();
    const releases = [
      ...tabs.map((tab) => subscribe(roomId, alice, tab.ws)),
      subscribe(roomId, bob, bobSocket.ws),
    ];

    await publishProjectionUpdate(roomId, 11, randomUUID());
    for (const release of releases) release();

    // Four sockets served, and all three of Alice's tabs got byte-identical
    // frames — the builder ran once for her, not three times.
    for (const tab of tabs) {
      expect(tab.sent.length).toBeGreaterThan(0);
      expect(tab.sent).toEqual(tabs[0]?.sent);
    }
    expect(bobSocket.sent.length).toBeGreaterThan(0);
  });

  it("Given the projection source fails, When a command publishes, Then the invalidation still lands and the request does not fail", async () => {
    const roomId = randomUUID();
    setRoomSnapshotSource(async () => {
      throw new Error("postgres is down");
    });
    const socket = recordingSocket();
    const release = subscribe(roomId, alice, socket.ws);

    await expect(
      publishProjectionUpdate(roomId, 3, randomUUID()),
    ).resolves.toBeUndefined();
    release();

    // Degraded, not silent: every client re-fetches its own bootstrap on an
    // invalidation, so the room stays correct — one round trip slower.
    expect(socket.sent).toHaveLength(1);
    expect(parseProjectionUpdated(JSON.parse(socket.sent[0] ?? "null"))).toMatchObject({
      projectionRevision: 3,
    });
  });
});

describe("publishProjectionUpdate: hidden information cannot cross the socket", () => {
  it("Given Bob holds every kind of secret, When Alice's socket is served, Then not one of them appears anywhere in her delivery", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const socket = recordingSocket();
    const release = subscribe(roomId, alice, socket.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    release();

    const delivered = wholeDelivery(socket);
    expect(delivered.length).toBeGreaterThan(0);
    for (const sentinel of everyBobSentinel) {
      expect(delivered).not.toContain(sentinel);
    }
  });

  it("Given Bob holds every kind of secret, When a third seat is served, Then the same holds for a viewer with no relationship to him", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const socket = recordingSocket();
    const release = subscribe(roomId, carol, socket.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    release();

    const delivered = wholeDelivery(socket);
    for (const sentinel of everyBobSentinel) {
      expect(delivered).not.toContain(sentinel);
    }
  });

  it("Given a spectator socket, When it is served, Then it carries no player's hand and none of Bob's secrets", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const socket = recordingSocket();
    const release = subscribe(
      roomId,
      createStableId("PlayerId", "user-spectator"),
      socket.ws,
    );

    await publishProjectionUpdate(roomId, 11, randomUUID());
    release();

    const delivered = wholeDelivery(socket);
    for (const sentinel of [...everyBobSentinel, ...Object.values(aliceSecrets)]) {
      expect(delivered).not.toContain(sentinel);
    }
  });

  it("Given Bob is the viewer, When he is served, Then he does see his own secrets — proving the sweep above is scoped, not blanket", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const socket = recordingSocket();
    const release = subscribe(roomId, bob, socket.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    release();

    const delivered = wholeDelivery(socket);
    expect(delivered).toContain(bobSecrets.handCard);
    expect(delivered).toContain(bobSecrets.handDefinition);
    expect(delivered).toContain(bobSecrets.objectiveDefinition);
    expect(delivered).toContain(bobSecrets.ownerOnlyPlacement);
    expect(delivered).toContain(SABOTAGE_SENTINEL);
    expect(delivered).toContain(bobSecrets.sealedBid);
    // ...but not Alice's hand, in either direction.
    expect(delivered).not.toContain(aliceSecrets.handCard);
    expect(delivered).not.toContain(aliceSecrets.handDefinition);
  });

  it("Given a socket on another room, When this room publishes, Then it receives nothing at all", async () => {
    const roomId = randomUUID();
    const otherRoomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const insider = recordingSocket();
    const outsider = recordingSocket();
    const releaseInsider = subscribe(roomId, alice, insider.ws);
    const releaseOutsider = subscribe(otherRoomId, bob, outsider.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    releaseInsider();
    releaseOutsider();

    expect(insider.sent.length).toBeGreaterThan(0);
    expect(outsider.sent).toEqual([]);
  });
});

describe("publishProjectionUpdate: reaction window edges", () => {
  it("Given a window opens for two of three seats, When it publishes, Then only the eligible seats are interrupted", async () => {
    const roomId = randomUUID();
    const windowId = "decision-promotion-block-1";
    useSnapshot(withReactionWindow(gameWithSecrets(), windowId, [alice, bob]));
    const aliceSocket = recordingSocket();
    const carolSocket = recordingSocket();
    const releaseAlice = subscribe(roomId, alice, aliceSocket.ws);
    const releaseCarol = subscribe(roomId, carol, carolSocket.ws);

    await publishProjectionUpdate(roomId, 12, randomUUID());
    releaseAlice();
    releaseCarol();

    const opened = windowFrames(aliceSocket);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      kind: "window-opened",
      windowId,
      windowKind: "promotion-block",
      deadlineAt: "2026-07-27T00:00:08.000Z",
      hasPriority: true,
    });
    // An eight-second window that arrives on the next poll is not a mechanic —
    // but neither is one that arrives for a player who cannot act in it.
    expect(windowFrames(carolSocket)).toEqual([]);
  });

  it("Given the window arrives, When the frames are read in order, Then the projection carrying it precedes the interrupt", async () => {
    const roomId = randomUUID();
    useSnapshot(withReactionWindow(gameWithSecrets(), "decision-window-order", [alice]));
    const socket = recordingSocket();
    const release = subscribe(roomId, alice, socket.ws);

    await publishProjectionUpdate(roomId, 12, randomUUID());
    release();

    expect(framesOf(socket).map((frame) => frame.kind)).toEqual([
      "projection-updated",
      "projection",
      "window-opened",
    ]);
  });

  it("Given a window that already published, When it is still open, Then it is not re-announced; when it closes, Then window-closed is", async () => {
    const roomId = randomUUID();
    const windowId = "decision-window-lifecycle";
    const open = withReactionWindow(gameWithSecrets(), windowId, [alice]);
    const socket = recordingSocket();
    const release = subscribe(roomId, alice, socket.ws);

    useSnapshot(open);
    await publishProjectionUpdate(roomId, 12, randomUUID());
    const first = windowFrames(socket).map((frame) => frame.kind);

    socket.sent.length = 0;
    await publishProjectionUpdate(roomId, 13, randomUUID());
    const second = windowFrames(socket).map((frame) => frame.kind);

    socket.sent.length = 0;
    useSnapshot({ ...open, reactionWindows: [] });
    await publishProjectionUpdate(roomId, 14, randomUUID());
    const third = windowFrames(socket);
    release();

    expect(first).toEqual(["window-opened"]);
    // Edges, not levels: a window that is merely still open is not news.
    expect(second).toEqual([]);
    expect(third).toHaveLength(1);
    expect(third[0]).toMatchObject({ kind: "window-closed", windowId });
  });

  it("Given a mode with reaction windows disabled, When a command publishes, Then no window frame is ever produced", async () => {
    const roomId = randomUUID();
    const base = gameWithSecrets();
    // A mode that switches the mechanic off produces no ReactionWindowState at
    // all, so there is nothing to diff and nothing to interrupt anyone with.
    expect(base.reactionWindows).toEqual([]);
    useSnapshot({
      ...base,
      rules: {
        ...base.rules,
        interaction: { ...base.rules.interaction, reactionWindows: false },
      },
    });
    const socket = recordingSocket();
    const release = subscribe(roomId, alice, socket.ws);

    await publishProjectionUpdate(roomId, 12, randomUUID());
    release();

    expect(windowFrames(socket)).toEqual([]);
    expect(framesOf(socket).map((frame) => frame.kind)).toEqual([
      "projection-updated",
      "projection",
    ]);
  });
});

describe("publishProjectionUpdate: hostile and degenerate input", () => {
  it("Given a subscriber id that is not a seat in the match, When it is served, Then it gets the table view rather than a crash or somebody else's seat", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const socket = recordingSocket();
    // Deliberately shaped to look like a seat. The projection is keyed by the
    // authenticated subscriber id, and an id that is not in `players` is not a
    // player, however plausible it reads.
    const release = subscribe(roomId, `${bob}-impostor`, socket.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    release();

    expect(projectionFrame(socket).seated).toBe(false);
    for (const sentinel of everyBobSentinel) {
      expect(wholeDelivery(socket)).not.toContain(sentinel);
    }
  });

  it.each(["constructor", "__proto__", "toString"])(
    "Given a subscriber id of %s, When it is served, Then it is not mistaken for a seat",
    async (subscriberId) => {
      // `state.players` is a plain object decoded from JSON, so a prototype key
      // reached through `in` or a truthiness check answers "yes, that is a
      // player" and then crashes the projection.
      const roomId = randomUUID();
      useSnapshot(gameWithSecrets());
      const socket = recordingSocket();
      const release = subscribe(roomId, subscriberId, socket.ws);

      await publishProjectionUpdate(roomId, 11, randomUUID());
      release();

      expect(projectionFrame(socket).seated).toBe(false);
      for (const sentinel of everyBobSentinel) {
        expect(wholeDelivery(socket)).not.toContain(sentinel);
      }
    },
  );

  it("Given a socket that throws on send, When the room is served, Then every other socket is still served", async () => {
    const roomId = randomUUID();
    useSnapshot(gameWithSecrets());
    const dead = {
      send: () => {
        throw new Error("socket is gone");
      },
    } as unknown as WSContext;
    const live = recordingSocket();
    const releaseDead = subscribe(roomId, bob, dead);
    const releaseLive = subscribe(roomId, alice, live.ws);

    await publishProjectionUpdate(roomId, 11, randomUUID());
    releaseDead();
    releaseLive();

    expect(live.sent.length).toBeGreaterThan(0);
  });

  it("Given a state that names a player it does not hold, When one viewer's projection throws, Then the fan-out still completes", async () => {
    const roomId = randomUUID();
    const broken = gameWithSecrets();
    // projectGameView throws on this. Before the per-viewer builder caught it,
    // the throw escaped mid-Set and cut off every socket after the bad one.
    useSnapshot({ ...broken, playerOrder: [...broken.playerOrder, "ghost" as PlayerId] });
    const socket = recordingSocket();
    const release = subscribe(roomId, alice, socket.ws);

    await expect(
      publishProjectionUpdate(roomId, 11, randomUUID()),
    ).resolves.toBeUndefined();
    release();

    // The invalidation and the projection are built together, so a projection
    // that cannot be built costs this viewer the whole frame — but it is one
    // viewer, and nothing throws out of the publish.
    expect(socket.sent).toEqual([]);
  });

  it("Given a room topic shaped like a join code, When it publishes, Then nothing is broadcast and no state is read", async () => {
    // plans/11: the six-character code is a credential and must never be a
    // topic. parseRoomTopic refuses it on both ends of the transport, and the
    // refusal has to land before the repository read or a refused topic is a
    // free database round trip.
    let reads = 0;
    setRoomSnapshotSource(async () => {
      reads += 1;
      return { game: gameWithSecrets() };
    });
    const socket = recordingSocket();
    const release = subscribe("ABC123", alice, socket.ws);

    await expect(
      publishProjectionUpdate("ABC123", 11, randomUUID()),
    ).resolves.toBeUndefined();
    release();

    expect(socket.sent).toEqual([]);
    expect(reads).toBe(0);
  });
});
