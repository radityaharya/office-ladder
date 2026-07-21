import { eq } from "drizzle-orm";

import { db } from "@office-ladder/db";
import { rooms, roomProjections } from "@office-ladder/db/schema";
import type { RoomRepository, StoredRoom } from "./service";

/**
 * Maps StoredRoom.status onto the schema's coarser room_lifecycle enum.
 * The full StoredRoom is stored verbatim as a JSONB snapshot in
 * room_projections.projection — rooms.lifecycle exists for indexed
 * queries/administration (e.g. "find open rooms"), not as the source of
 * truth for room state.
 */
function toLifecycle(status: StoredRoom["status"]): "open" | "active" | "closed" {
  if (status === "open" || status === "starting") return "open";
  if (status === "active") return "active";
  return "closed";
}

/**
 * Postgres-backed room repository. Deliberately simpler than the full
 * event-sourced schema in packages/db/src/game-schema.ts suggests: it
 * stores the entire StoredRoom (including the canonical GameState) as one
 * JSONB snapshot in room_projections.projection, rather than normalizing
 * into room_members/games/game_events/command_receipts/game_outbox. Those
 * tables exist and are ready for a proper event-sourced read model later,
 * but building that out is a separate, larger effort — this repository
 * only needs to make rooms survive a server restart, which it does.
 */
/** Round-trips through JSON so the jsonb column sees a plain value — branded ID types etc. are just strings at runtime anyway. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb column boundary; see comment above
function toJsonSnapshot(room: StoredRoom): any {
  return JSON.parse(JSON.stringify(room));
}

export class PostgresRoomRepository implements RoomRepository {
  async create(room: StoredRoom): Promise<void> {
    await db.insert(rooms).values({
      id: room.id,
      code: room.code,
      hostUserId: room.hostId,
      lifecycle: toLifecycle(room.status),
    });
    await db.insert(roomProjections).values({
      roomId: room.id,
      gameId: null,
      revision: room.revision,
      projection: toJsonSnapshot(room),
    });
  }

  async get(id: string): Promise<StoredRoom | null> {
    const [row] = await db
      .select({ projection: roomProjections.projection })
      .from(roomProjections)
      .where(eq(roomProjections.roomId, id))
      .limit(1);
    return row === undefined ? null : (row.projection as unknown as StoredRoom);
  }

  async getByCode(code: string): Promise<StoredRoom | null> {
    const [row] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.code, code))
      .limit(1);
    return row === undefined ? null : this.get(row.id);
  }

  async save(room: StoredRoom): Promise<void> {
    await db
      .update(rooms)
      .set({ lifecycle: toLifecycle(room.status) })
      .where(eq(rooms.id, room.id));
    await db
      .update(roomProjections)
      .set({
        gameId: room.game?.gameId ?? null,
        revision: room.revision,
        projection: toJsonSnapshot(room),
        updatedAt: new Date(),
      })
      .where(eq(roomProjections.roomId, room.id));
  }
}
