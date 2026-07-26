import { describe, expect, it } from "vitest";

import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type {
  RoomRepository,
  RoomService,
  RoomWriteResult,
  StoredRoom,
} from "../../src/rooms/service/types";

const roomId = "room-concurrency-test";

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
} as const;

type SaveAttempt = {
  readonly expectedRevision: number;
  readonly ok: boolean;
};

type Release = () => void;

/**
 * Repository decorator that can park one save() "on the wire".
 *
 * The interleaving these tests need is constructed, not left to microtask
 * ordering: one caller must still be holding a snapshot it read *before* another
 * caller committed, which is exactly what happens when a SELECT and an UPDATE
 * from two processes overlap. It also records every write attempt, so a test can
 * tell "the engine refused this command" apart from "the engine accepted it and
 * the repository refused the write" — both answer STALE_REVISION.
 */
class HeldSaveRepository implements RoomRepository {
  readonly attempts: SaveAttempt[] = [];
  readonly #inner: RoomRepository;
  #held: Promise<void> | null = null;

  constructor(inner: RoomRepository) {
    this.#inner = inner;
  }

  /** Parks the next save() to arrive until the returned release is called. */
  holdNextSave(): Release {
    let release: Release = () => undefined;
    this.#held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async create(room: StoredRoom): Promise<RoomWriteResult> {
    return this.#inner.create(room);
  }

  async get(id: string): Promise<StoredRoom | null> {
    return this.#inner.get(id);
  }

  async getByCode(code: string): Promise<StoredRoom | null> {
    return this.#inner.getByCode(code);
  }

  async save(room: StoredRoom, expectedRevision: number): Promise<RoomWriteResult> {
    const held = this.#held;
    this.#held = null;
    if (held !== null) await held;
    const result = await this.#inner.save(room, expectedRevision);
    this.attempts.push({ expectedRevision, ok: result.ok });
    return result;
  }
}

function createService(repository: RoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "CON123",
      gameId: () => createStableId("GameId", "game-concurrency-test"),
      commandId: () => createStableId("CommandId", "command-concurrency-test"),
    },
    gameSeed: () => "concurrency-seed",
    // Off unless a test needs the clock: an armed deadline in an unrelated
    // test would be enforcement nobody asked for.
    turnTimeoutMs: 0,
  });
}

/** Lets every already-queued microtask run, so a parked call has reached its gate. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Two RoomService instances over one repository stand in for two server
 * processes over one database: each has its own per-room lock, so the only thing
 * between them is the revision predicate on the write itself.
 *
 * Without that predicate every case below is a silent lost update — the loser is
 * told 200 and its work is simply not there afterwards.
 */
describe("room repository concurrency", () => {
  it("Given two instances joining from the same read revision, When both write, Then the loser is refused instead of dropping the other player", async () => {
    const inner = new InMemoryRoomRepository();
    const repository = new HeldSaveRepository(inner);
    const alpha = createService(repository);
    const beta = createService(repository);
    await alpha.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });

    const release = repository.holdNextSave();
    const alphaJoin = alpha.join({
      roomId,
      actorId: players.second,
      playerName: "Second",
    });
    // alpha has now read revision 0 and is parked in save().
    await settle();
    const betaJoin = await beta.join({
      roomId,
      actorId: players.third,
      playerName: "Third",
    });
    expect(betaJoin).toMatchObject({ ok: true, value: { revision: 1 } });
    release();

    // The auditor's exact defect: both readers appended themselves to
    // memberIds [host] and both wrote revision 1, so one player was silently
    // dropped and then got a permanent 403 from GET /:roomId.
    expect(await alphaJoin).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
    expect(repository.attempts).toEqual([
      { expectedRevision: 0, ok: true },
      { expectedRevision: 0, ok: false },
    ]);

    const final = await inner.get(roomId);
    expect(final?.memberIds).toEqual([players.host, players.third]);
    expect(final?.memberNames).toEqual({ [players.host]: "Host", [players.third]: "Third" });
    expect(final?.revision).toBe(1);
  });

  it("Given two instances rolling from the same game revision, When both commit, Then only one turn lands and the other is refused", async () => {
    const inner = new InMemoryRoomRepository();
    const repository = new HeldSaveRepository(inner);
    const alpha = createService(repository);
    const beta = createService(repository);
    await alpha.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
    await alpha.join({ roomId, actorId: players.second, playerName: "Second" });
    await alpha.join({ roomId, actorId: players.third, playerName: "Third" });
    const started = await alpha.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const gameRevision = started.value.game.revision;
    const release = repository.holdNextSave();
    const alphaRoll = alpha.roll({
      roomId,
      actorId: players.host,
      actorKind: "human",
      commandId: "roll-alpha",
      expectedRevision: gameRevision,
    });
    await settle();
    const betaRoll = await beta.roll({
      roomId,
      actorId: players.host,
      actorKind: "human",
      commandId: "roll-beta",
      expectedRevision: gameRevision,
    });
    expect(betaRoll.ok).toBe(true);
    if (!betaRoll.ok) return;
    release();

    expect(await alphaRoll).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
    // The last attempt proves *where* the refusal came from: alpha reached the
    // write at all, which means the engine had accepted its roll (its
    // expectedRevision matched the game revision it read), so only the write
    // predicate stood between it and a burned turn. That is exactly why the
    // engine's own expectedRevision is a time-of-check here and not a guard.
    // The predicate is on the *room* revision, which start() had already moved
    // to 3 while the game was only at revision 1.
    expect(repository.attempts.at(-1)).toEqual({
      expectedRevision: started.value.revision,
      ok: false,
    });

    const final = await inner.get(roomId);
    expect(final?.revision).toBe(started.value.revision + 1);
    expect(final?.game?.revision).toBe(gameRevision + 1);
    expect(final?.game?.lastCommandId).toBe("roll-beta");
    // The winner's history is intact — the loser's summaries were not merged in
    // and the winner's were not discarded.
    expect(final?.eventSummaries).toEqual(betaRoll.value.eventSummaries);
  });

  it("Given a bot seat added while another instance starts the match, When both write, Then the started game is not reverted to the lobby", async () => {
    const inner = new InMemoryRoomRepository();
    const repository = new HeldSaveRepository(inner);
    const alpha = createService(repository);
    const beta = createService(repository);
    await alpha.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
    await alpha.addBot({ roomId, actorId: players.host, difficulty: "standard" });
    await alpha.addBot({ roomId, actorId: players.host, difficulty: "easy" });

    const release = repository.holdNextSave();
    const addBot = alpha.addBot({ roomId, actorId: players.host, difficulty: "ruthless" });
    await settle();
    const started = await beta.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });
    expect(started.ok).toBe(true);
    release();

    expect(await addBot).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
    const final = await inner.get(roomId);
    expect(final?.status).toBe("active");
    expect(final?.game).not.toBeNull();
    expect(final?.bots.length).toBe(2);
  });
});

describe("in-memory repository revision predicate", () => {
  it("Given a room at a later revision, When a stale write arrives, Then it is refused and the stored room is untouched", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    const created = await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await service.join({ roomId, actorId: players.second, playerName: "Second" });

    const stale = await repository.save({ ...created.value, revision: 1 }, 0);

    expect(stale).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
    const final = await repository.get(roomId);
    expect(final?.memberIds).toEqual([players.host, players.second]);
    expect(final?.revision).toBe(1);
  });

  it("Given no such room, When a write arrives, Then it is refused rather than creating one", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    const created = await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await repository.save({ ...created.value, id: "room-absent" }, 0);

    expect(result).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
    expect(await repository.get("room-absent")).toBeNull();
  });
});
