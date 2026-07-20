import type { RoomRepository, StoredRoom } from "./service";

export class InMemoryRoomRepository implements RoomRepository {
  readonly #rooms = new Map<string, StoredRoom>();
  readonly #roomIdsByCode = new Map<string, string>();

  async create(room: StoredRoom): Promise<void> {
    this.#rooms.set(room.id, room);
    this.#roomIdsByCode.set(room.code, room.id);
  }

  async get(id: string): Promise<StoredRoom | null> {
    return this.#rooms.get(id) ?? null;
  }

  async getByCode(code: string): Promise<StoredRoom | null> {
    const roomId = this.#roomIdsByCode.get(code);
    return roomId === undefined ? null : (this.#rooms.get(roomId) ?? null);
  }

  async save(room: StoredRoom): Promise<void> {
    const previous = this.#rooms.get(room.id);
    if (previous !== undefined && previous.code !== room.code) {
      this.#roomIdsByCode.delete(previous.code);
    }
    this.#rooms.set(room.id, room);
    this.#roomIdsByCode.set(room.code, room.id);
  }
}
