import { fromRoomSnapshot, toRoomSnapshot } from "./room-snapshot";
import type { RoomRepository, RoomWriteResult, StoredRoom } from "./service/types";

type StoredRow = {
  /**
   * The concurrency token, mirroring `room_projections.revision`: the value a
   * conditional write compares against, kept beside the blob rather than read
   * out of it.
   */
  readonly revision: number;
  /** Mirrors the `rooms.code` unique index, so the lookup never re-parses a blob. */
  readonly code: string;
  readonly snapshot: unknown;
};

/**
 * Test/dev repository that behaves like PostgresRoomRepository in every way that
 * can change an outcome: it stores the same serialized snapshot (so the engine's
 * serialization contract and the legacy-shape normalization are exercised, and
 * callers cannot mutate stored state through a shared reference), and it applies
 * the same revision predicate on save. Anything weaker would let a concurrency
 * test pass while production silently loses writes.
 */
export class InMemoryRoomRepository implements RoomRepository {
  readonly #rows = new Map<string, StoredRow>();
  readonly #roomIdsByCode = new Map<string, string>();

  async create(room: StoredRoom): Promise<RoomWriteResult> {
    const snapshot = toRoomSnapshot(room);
    if (!snapshot.ok) return snapshot;
    this.#rows.set(room.id, {
      revision: room.revision,
      code: room.code,
      snapshot: snapshot.value.room,
    });
    this.#roomIdsByCode.set(room.code, room.id);
    return { ok: true };
  }

  async get(id: string): Promise<StoredRoom | null> {
    const row = this.#rows.get(id);
    return row === undefined ? null : fromRoomSnapshot(row.snapshot, row.revision);
  }

  async getByCode(code: string): Promise<StoredRoom | null> {
    const roomId = this.#roomIdsByCode.get(code);
    return roomId === undefined ? null : this.get(roomId);
  }

  async save(room: StoredRoom, expectedRevision: number): Promise<RoomWriteResult> {
    const previous = this.#rows.get(room.id);
    // Same semantics as `UPDATE ... WHERE room_id = $1 AND revision = $2`
    // matching zero rows: a missing room and a room that moved on are both a
    // stale write the caller has to redo.
    if (previous === undefined || previous.revision !== expectedRevision) {
      return { ok: false, error: { code: "STALE_REVISION" } };
    }

    const snapshot = toRoomSnapshot(room);
    if (!snapshot.ok) return snapshot;

    if (previous.code !== room.code) this.#roomIdsByCode.delete(previous.code);
    this.#rows.set(room.id, {
      revision: room.revision,
      code: room.code,
      snapshot: snapshot.value.room,
    });
    this.#roomIdsByCode.set(room.code, room.id);
    return { ok: true };
  }
}
