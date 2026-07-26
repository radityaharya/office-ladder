/**
 * Postgres-backed chat storage: `room_messages` and `room_message_reactions`.
 *
 * Two things here are about the real database rather than about chat, and both
 * were chosen because the in-memory implementation cannot fail the way Postgres
 * can:
 *
 * - **Foreign key ordering.** `room_messages.room_id` references `rooms.id`, and
 *   `room_message_reactions.message_id` references `room_messages.id`. The
 *   service loads the room before inserting a message and the message before
 *   inserting a reaction, so both parents exist by the time a child row is
 *   written. A test suite run only against an in-memory store has no foreign
 *   keys and would pass with the writes in either order.
 * - **Duplicate emotes are refused by the database, not by a read.** The insert
 *   is `ON CONFLICT DO NOTHING … RETURNING`, so a concurrent double-click
 *   produces a clean `"duplicate"` value rather than a thrown unique violation
 *   surfacing as a 500.
 */
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";

import type { ChatMessageKind, Emote } from "@office-ladder/contracts";
import { db } from "@office-ladder/db";
import { roomMessageReactions, roomMessages } from "@office-ladder/db/schema";
import { createStableId, type PlayerId } from "@office-ladder/engine";
import type {
  ChatMessageRecord,
  ChatReactionRecord,
  ChatRepository,
  InsertReactionResult,
} from "./types";

/**
 * The wire vocabulary is `text` / `quick`; the column's enum is
 * `chat` / `quick-phrase` / `system`. The two were authored independently and
 * are mapped here rather than either being renamed: the enum is already in the
 * live database, and the contract is already on the wire.
 *
 * `system` has no contract counterpart because nothing writes one yet. A stored
 * `system` row is read as `text`, which is what it is from a client's point of
 * view — a line with no author.
 */
const KIND_TO_COLUMN = {
  text: "chat",
  quick: "quick-phrase",
} as const satisfies Record<ChatMessageKind, "chat" | "quick-phrase">;

function kindFromColumn(value: "chat" | "quick-phrase" | "system"): ChatMessageKind {
  return value === "quick-phrase" ? "quick" : "text";
}

type MessageRow = {
  readonly id: string;
  readonly roomId: string;
  readonly authorId: string | null;
  readonly kind: "chat" | "quick-phrase" | "system";
  readonly body: string;
  readonly createdAt: Date;
};

function toRecord(row: MessageRow): ChatMessageRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    authorId: row.authorId === null ? null : createStableId("PlayerId", row.authorId),
    kind: kindFromColumn(row.kind),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PostgresChatRepository implements ChatRepository {
  async insertMessage(message: ChatMessageRecord): Promise<void> {
    await db.insert(roomMessages).values({
      id: message.id,
      roomId: message.roomId,
      authorId: message.authorId,
      kind: KIND_TO_COLUMN[message.kind],
      body: message.body,
      createdAt: new Date(message.createdAt),
    });
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    const rows = await db
      .select()
      .from(roomMessages)
      .where(eq(roomMessages.id, messageId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async listMessages(input: {
    readonly roomId: string;
    readonly before: ChatMessageRecord | null;
    readonly limit: number;
  }): Promise<readonly ChatMessageRecord[]> {
    const cursor = input.before;
    // Keyset, not OFFSET: a room being chatted in while somebody scrolls back
    // would shift every offset page by one and duplicate or skip a line. `id`
    // breaks ties on identical timestamps, which the millisecond-resolution
    // column makes ordinary rather than exotic.
    const olderThanCursor =
      cursor === null
        ? undefined
        : or(
            lt(roomMessages.createdAt, new Date(cursor.createdAt)),
            and(
              eq(roomMessages.createdAt, new Date(cursor.createdAt)),
              lt(roomMessages.id, cursor.id),
            ),
          );

    const rows = await db
      .select()
      .from(roomMessages)
      .where(and(eq(roomMessages.roomId, input.roomId), olderThanCursor))
      .orderBy(desc(roomMessages.createdAt), desc(roomMessages.id))
      .limit(input.limit);

    return rows.map(toRecord);
  }

  async listReactions(
    messageIds: readonly string[],
  ): Promise<readonly ChatReactionRecord[]> {
    if (messageIds.length === 0) return [];

    const rows = await db
      .select()
      .from(roomMessageReactions)
      .where(inArray(roomMessageReactions.messageId, [...messageIds]))
      .orderBy(asc(roomMessageReactions.createdAt));

    return rows.map((row) => ({
      messageId: row.messageId,
      playerId: createStableId("PlayerId", row.playerId),
      emote: row.emote as Emote,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async insertReaction(
    reaction: ChatReactionRecord,
    maxPerPlayerPerMessage: number,
  ): Promise<InsertReactionResult> {
    return db.transaction(async (tx) => {
      const held = await tx
        .select({ emote: roomMessageReactions.emote })
        .from(roomMessageReactions)
        .where(
          and(
            eq(roomMessageReactions.messageId, reaction.messageId),
            eq(roomMessageReactions.playerId, reaction.playerId),
          ),
        );

      if (held.some((row) => row.emote === reaction.emote)) return "duplicate";
      if (held.length >= maxPerPlayerPerMessage) return "limit-reached";

      // The id is derived, not random: `(message, player, emote)` is already the
      // unique key, so deriving the primary key from it makes the row's identity
      // and its uniqueness the same fact instead of two that can drift.
      const inserted = await tx
        .insert(roomMessageReactions)
        .values({
          id: reactionRowId(reaction.messageId, reaction.playerId, reaction.emote),
          messageId: reaction.messageId,
          playerId: reaction.playerId,
          emote: reaction.emote,
          createdAt: new Date(reaction.createdAt),
        })
        .onConflictDoNothing()
        .returning({ id: roomMessageReactions.id });

      // Zero rows means another transaction inserted the same emote between the
      // select above and this insert. The count check has a matching race, which
      // at READ COMMITTED can let a player briefly hold one emote more than the
      // cap; the duplicate case — the one a user can actually trigger by
      // double-clicking — is closed by the constraint itself.
      return inserted.length === 0 ? "duplicate" : "inserted";
    });
  }

  async deleteReaction(input: {
    readonly messageId: string;
    readonly playerId: PlayerId;
    readonly emote: Emote;
  }): Promise<boolean> {
    const removed = await db
      .delete(roomMessageReactions)
      .where(
        and(
          eq(roomMessageReactions.messageId, input.messageId),
          eq(roomMessageReactions.playerId, input.playerId),
          eq(roomMessageReactions.emote, input.emote),
        ),
      )
      .returning({ id: roomMessageReactions.id });

    return removed.length > 0;
  }
}

/**
 * A deterministic primary key for a reaction row.
 *
 * The parts are joined with a character that cannot appear in any of them —
 * emote ids and player ids are both `[A-Za-z0-9._:-]`-shaped — so two different
 * triples cannot collide into one id.
 */
function reactionRowId(messageId: string, playerId: string, emote: string): string {
  return `${messageId}|${playerId}|${emote}`;
}
