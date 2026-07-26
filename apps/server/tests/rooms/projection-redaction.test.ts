import { describe, expect, it } from "vitest";

import { deadlineDashModes } from "@office-ladder/content";
import { createStableId, type GameState, type PlayerId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import { createBootstrap } from "../../src/rooms/service/projections";
import type { ActiveStoredRoom, RoomService } from "../../src/rooms/service/types";

/**
 * Spec §7.2: "a viewer's payload cannot contain another player's hand, secret
 * objective, hidden sabotage, or `owner-only` placement."
 *
 * The engine already redacts per viewer; what this file covers is the *server's*
 * half — the partition in `service/projections.ts` that splits each per-viewer
 * array into a public DTO and a `self` DTO. A partition bug there is exactly how
 * a redacted engine projection turns back into a leak: the private half only has
 * to be assigned into a public array once.
 *
 * The assertions are deliberately made against the serialized payload rather
 * than against named fields. A field-by-field check only proves the fields
 * somebody thought to check are clean; searching the whole payload for a value
 * that is supposed to be secret catches the field nobody thought of, which is
 * the one that leaks.
 */

const roomId = "room-redaction";

const players = {
  alice: "user-alice",
  bob: "user-bob",
  carol: "user-carol",
} as const;

const seat = (userId: string): PlayerId => createStableId("PlayerId", userId);

/** Values that must never appear in a payload belonging to somebody else. */
const secrets = {
  bobsCard: "card.event.bobs-private-hand",
  bobsObjective: "objective.bobs-secret-plan",
  bobsPlacementNote: "bob-watched-this-tile",
  bobsSabotageAmount: 4242,
  bobsBid: 31337,
} as const;

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-27T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "RED123",
      gameId: () => createStableId("GameId", "game-redaction"),
      commandId: () => createStableId("CommandId", "command-redaction"),
    },
    gameSeed: () => "redaction-seed",
    turnTimeoutMs: 0,
  });
}

/**
 * A started match with one of every hidden thing, all of them Bob's.
 *
 * Written straight onto canonical state rather than played into existence: the
 * transitions that create placements, secret objectives and sealed ballots are
 * gated on mode switches and on board position, and the redaction contract has
 * to hold for *any* state that carries them, not only for the ones the current
 * content pack can reach.
 */
async function matchWithBobsSecrets(): Promise<ActiveStoredRoom> {
  const repository = new InMemoryRoomRepository();
  const service = createService(repository);
  await service.create({
    hostId: players.alice,
    playerName: "Alice",
    modeId: "mode.quick",
  });
  await service.join({ roomId, actorId: players.bob, playerName: "Bob" });
  await service.join({ roomId, actorId: players.carol, playerName: "Carol" });
  await service.setModeRules({
    roomId,
    actorId: players.alice,
    // A preset with hidden hands, secret objectives, projects, placements and
    // auctions all switched on, so nothing below is unreachable by construction.
    rules: deadlineDashModes["mode.campaign"].rules,
  });
  const started = await service.start({
    roomId,
    actorId: players.alice,
    actorKind: "human",
  });
  if (!started.ok) throw new Error(`start failed: ${started.error.code}`);

  const bob = seat(players.bob);
  const base = started.value.game;
  const cardId = createStableId("CardInstanceId", "card-bob-1");
  const tileId = base.tileIds[3];
  if (tileId === undefined) throw new Error("board has no tiles");

  const game: GameState = {
    ...base,
    cards: {
      ...base.cards,
      [cardId]: {
        id: cardId,
        definitionId: createStableId("CardDefinitionId", secrets.bobsCard),
        deckId: createStableId("DeckId", "deck.event"),
        zone: "hand",
        ownerId: bob,
        faceUp: false,
        data: {},
      },
    },
    players: {
      ...base.players,
      [bob]: { ...base.players[bob]!, hand: [cardId] },
    },
    placements: [
      {
        id: createStableId("PlacementId", "placement-bob-1"),
        kind: "placement.surveillance",
        tileId,
        ownerId: bob,
        charges: 1,
        visibility: "owner-only",
        placedAtRound: 1,
        data: { note: secrets.bobsPlacementNote },
      },
    ],
    objectives: [
      {
        id: createStableId("ObjectiveId", "objective-bob-1"),
        definitionId: secrets.bobsObjective,
        ownerId: bob,
        progress: 3,
        target: 9,
        completedAtRound: null,
        visibility: "secret",
        rewardPoints: 7,
        rewardMoney: 700,
      },
    ],
    projects: [
      {
        id: createStableId("ProjectId", "project-1"),
        definitionId: "project.quarterly-report",
        leadPlayerId: seat(players.carol),
        tileId: null,
        status: "open",
        requiredMoney: 1000,
        requiredWork: 10,
        contributions: [],
        sabotage: [
          {
            playerId: bob,
            amount: secrets.bobsSabotageAmount,
            hidden: true,
            atRound: 1,
          },
        ],
        deadlineRound: 8,
        payout: { money: 2000, reputation: 3, objectiveProgress: 1 },
        openToJoin: true,
        leadBonusBasisPoints: 1000,
      },
    ],
    ballots: [
      {
        id: createStableId("BallotId", "ballot-1"),
        kind: "auction",
        subjectId: "auction.corner-office",
        subject: { minBid: 100 },
        audience: [seat(players.alice), bob, seat(players.carol)],
        castBy: { [bob]: secrets.bobsBid },
        deadlineAt: null,
        closesAtRound: 4,
        visibility: "sealed",
        resolution: null,
      },
    ],
  };

  return { ...started.value, game };
}

function payloadFor(room: ActiveStoredRoom, userId: string): string {
  return JSON.stringify(createBootstrap(room, seat(userId), "2026-07-27T12:00:00.000Z"));
}

describe("per-viewer redaction", () => {
  it.each([
    ["Bob's hand", secrets.bobsCard],
    ["Bob's secret objective", secrets.bobsObjective],
    ["Bob's owner-only placement", secrets.bobsPlacementNote],
    ["Bob's hidden sabotage", String(secrets.bobsSabotageAmount)],
    ["Bob's sealed bid", String(secrets.bobsBid)],
  ])(
    "Given %s, When another player's bootstrap is built, Then the value is absent from the whole payload",
    async (_label, secret) => {
      const room = await matchWithBobsSecrets();

      expect(payloadFor(room, players.alice)).not.toContain(secret);
      expect(payloadFor(room, players.carol)).not.toContain(secret);
    },
  );

  it("Given Bob's own bootstrap, When it is built, Then he can see every one of his own hidden things", async () => {
    const room = await matchWithBobsSecrets();

    // The other half of the contract: redaction that also hides a player's own
    // state is not redaction, it is a broken game.
    const payload = payloadFor(room, players.bob);

    for (const secret of Object.values(secrets)) {
      expect(payload).toContain(String(secret));
    }
  });

  it("Given a sealed ballot, When any viewer's bootstrap is built, Then no in-flight cast is reported, keys included", async () => {
    const room = await matchWithBobsSecrets();
    const bootstrap = createBootstrap(
      room,
      seat(players.alice),
      "2026-07-27T12:00:00.000Z",
    );

    const ballot = bootstrap.gameplay.ballots[0];
    expect(ballot?.visibility).toBe("sealed");
    // A sealed ballot has no `castBy` field at all rather than an emptied one:
    // the keys are voter ids, so a stripped record still says who has committed.
    expect(ballot).not.toHaveProperty("castBy");
    expect(ballot?.visibility === "sealed" ? ballot.castCount : -1).toBe(1);
    expect(ballot?.visibility === "sealed" ? ballot.viewerHasCast : true).toBe(false);
    expect(JSON.stringify(bootstrap)).not.toContain(seat(players.bob) + '":31337');
  });

  it("Given Bob's own sealed bid, When his bootstrap is built, Then he can see it and the ballot still reports him as having cast", async () => {
    const room = await matchWithBobsSecrets();
    const bootstrap = createBootstrap(room, seat(players.bob), "2026-07-27T12:00:00.000Z");

    const ballot = bootstrap.gameplay.ballots[0];
    expect(ballot?.visibility === "sealed" ? ballot.viewerHasCast : false).toBe(true);
    expect(bootstrap.gameplay.self.ballotCasts).toEqual({
      [createStableId("BallotId", "ballot-1")]: secrets.bobsBid,
    });
  });

  it("Given a secret objective, When a non-owner's bootstrap is built, Then it projects as existence only", async () => {
    const room = await matchWithBobsSecrets();
    const bootstrap = createBootstrap(
      room,
      seat(players.alice),
      "2026-07-27T12:00:00.000Z",
    );

    const objective = bootstrap.gameplay.objectives[0];
    expect(objective).toEqual({
      visibility: "secret",
      id: createStableId("ObjectiveId", "objective-bob-1"),
      ownerId: seat(players.bob),
      completedAtRound: null,
    });
    // Existence-only means the shape has nowhere to put the detail, not that the
    // detail was set to a placeholder.
    expect(objective).not.toHaveProperty("progress");
    expect(objective).not.toHaveProperty("definitionId");
    expect(bootstrap.gameplay.self.objectives).toEqual([]);
  });

  it("Given an owner-only placement, When a non-owner's bootstrap is built, Then the tile looks empty rather than occupied", async () => {
    const room = await matchWithBobsSecrets();
    const bootstrap = createBootstrap(
      room,
      seat(players.carol),
      "2026-07-27T12:00:00.000Z",
    );

    // Absent, not masked: a redacted placeholder still tells the table that
    // something is waiting on that tile, which is the whole of what an
    // owner-only placement hides.
    expect(bootstrap.gameplay.placements).toEqual([]);
    expect(bootstrap.gameplay.self.ownPlacements).toEqual([]);
  });

  it("Given hidden sabotage on an open project, When a non-saboteur's bootstrap is built, Then the project reports none", async () => {
    const room = await matchWithBobsSecrets();
    const bootstrap = createBootstrap(
      room,
      seat(players.alice),
      "2026-07-27T12:00:00.000Z",
    );

    // Knowing a project *has* been sabotaged is most of what the lead would want
    // to know, so an unresolved hidden entry is not summarised or counted.
    expect(bootstrap.gameplay.projects[0]?.sabotage).toEqual([]);
    expect(bootstrap.gameplay.self.sabotage).toEqual([]);
  });

  it("Given a hidden hand, When any bootstrap is built, Then every other seat projects as a count", async () => {
    const room = await matchWithBobsSecrets();
    const bootstrap = createBootstrap(
      room,
      seat(players.alice),
      "2026-07-27T12:00:00.000Z",
    );

    const bobsRow = bootstrap.gameplay.players.find(
      (player) => player.playerId === seat(players.bob),
    );
    expect(bobsRow?.handCount).toBe(1);
    expect(bobsRow).not.toHaveProperty("hand");
    expect(bootstrap.self.hand).toEqual([]);
  });

  it("Given the running match, When a bootstrap is built, Then it carries the ruleset the match was started under", async () => {
    const room = await matchWithBobsSecrets();
    const bootstrap = createBootstrap(
      room,
      seat(players.alice),
      "2026-07-27T12:00:00.000Z",
    );

    expect(bootstrap.gameplay.rules).toEqual(deadlineDashModes["mode.campaign"].rules);
    expect(bootstrap.gameplay.rules).not.toEqual(deadlineDashModes["mode.quick"].rules);
  });
});
