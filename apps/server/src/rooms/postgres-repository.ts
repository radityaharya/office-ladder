import { and, eq } from "drizzle-orm";

import { db } from "@office-ladder/db";
import { games, rooms, roomProjections } from "@office-ladder/db/schema";
import { log } from "@/observability/log";
import { fromRoomSnapshot, toRoomSnapshot } from "./room-snapshot";
import type { RoomRepository, RoomWriteResult, StoredRoom } from "./service/types";

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

const STALE: RoomWriteResult = { ok: false, error: { code: "STALE_REVISION" } };

/**
 * Thrown to abort a save transaction when the guarded update matched no row.
 * A lost race must leave *nothing* behind, and the `games` upsert now runs
 * before the guarded update (see `save`), so returning early is no longer
 * enough — only a rollback undoes it.
 */
class StaleWriteSignal extends Error {
  readonly name = "StaleWriteSignal";
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
 *
 * Two properties are load-bearing and easy to lose:
 *
 * - **Every write is conditional on the revision the caller read** and runs in
 *   one transaction. An unconditional overwrite silently discards a concurrent
 *   mutation (a dropped join, a burned turn) while answering 200 to both
 *   callers, and the room service's per-process lock cannot see a second server
 *   instance.
 * - **Every value crossing this boundary goes through rooms/room-snapshot.ts**,
 *   which validates the GameState with the engine's own serialization contract
 *   and repairs legacy shapes on the way out, instead of the JSON.parse(
 *   JSON.stringify(...)) round trip that used to silently drop whatever JSON
 *   could not express.
 */
export class PostgresRoomRepository implements RoomRepository {
  async create(room: StoredRoom): Promise<RoomWriteResult> {
    const snapshot = toRoomSnapshot(room);
    if (!snapshot.ok) return snapshot;

    // One transaction: a room row without its projection is a room that answers
    // 404 on GET while still holding its code in the unique index.
    await db.transaction(async (tx) => {
      await tx.insert(rooms).values({
        id: room.id,
        code: room.code,
        hostUserId: room.hostId,
        lifecycle: toLifecycle(room.status),
      });
      await tx.insert(roomProjections).values({
        roomId: room.id,
        gameId: null,
        revision: room.revision,
        projection: snapshot.value.room,
      });
    });
    return { ok: true };
  }

  async get(id: string): Promise<StoredRoom | null> {
    const [row] = await db
      .select({ projection: roomProjections.projection, revision: roomProjections.revision })
      .from(roomProjections)
      .where(eq(roomProjections.roomId, id))
      .limit(1);
    // The revision *column* wins over the one inside the blob: it is what the
    // conditional UPDATE in save() compares against, so a room whose two copies
    // ever disagreed would otherwise be unwritable forever.
    return row === undefined ? null : fromRoomSnapshot(row.projection, row.revision);
  }

  async getByCode(code: string): Promise<StoredRoom | null> {
    const [row] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.code, code))
      .limit(1);
    if (row === undefined) return null;

    const room = await this.get(row.id);
    if (room === null) {
      // `rooms` and `room_projections` are written in the same transaction, so a
      // room row with no readable projection is torn data — not a cache miss.
      // Returning null makes it indistinguishable from a mistyped code, which is
      // exactly what the player would be told. The code itself is a join
      // credential and is deliberately not logged.
      log("error", "room.projection-missing", { room: row.id });
    }
    return room;
  }

  async save(room: StoredRoom, expectedRevision: number): Promise<RoomWriteResult> {
    const snapshot = toRoomSnapshot(room);
    if (!snapshot.ok) return snapshot;

    try {
      return await db.transaction(async (tx) => {
        // `games` MUST be written before the guarded update, not after:
        // room_projections.game_id carries a foreign key to games.id
        // (room_projections_game_id_games_id_fk), so on the first save of a
        // newly started match the referenced row does not exist yet and setting
        // game_id aborts the whole transaction — meaning `game.start` could
        // never persist at all. Ordering it first keeps the reference
        // satisfiable; the rollback below is what preserves the "a lost race
        // leaves no partial effect" property that returning early used to give.
        //
        // `games` itself is a denormalized mirror for administration and for the
        // event-sourced read model still to be built; the projection snapshot
        // stays the source of truth.
        const game = room.game;
        if (game !== null && snapshot.value.game !== null) {
          const gameRow = {
            id: game.gameId,
            roomId: room.id,
            status: game.status,
            revision: game.revision,
            eventSequence: game.eventSequence,
            canonicalState: snapshot.value.game,
            engineVersion: game.versions.engineVersion,
            rulesetVersion: game.versions.rulesetId,
            contentVersion: game.versions.contentReleaseId,
            stateHash: game.stateHash,
          };
          await tx
            .insert(games)
            .values(gameRow)
            .onConflictDoUpdate({ target: games.id, set: gameRow });
        }

        const updated = await tx
          .update(roomProjections)
          .set({
            gameId: room.game?.gameId ?? null,
            revision: room.revision,
            projection: snapshot.value.room,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(roomProjections.roomId, room.id),
              eq(roomProjections.revision, expectedRevision),
            ),
          )
          .returning({ roomId: roomProjections.roomId });
        if (updated.length === 0) throw new StaleWriteSignal();

        await tx
          .update(rooms)
          .set({ lifecycle: toLifecycle(room.status) })
          .where(eq(rooms.id, room.id));

        return { ok: true };
      });
    } catch (error) {
      if (error instanceof StaleWriteSignal) return STALE;
      throw error;
    }
  }
}
