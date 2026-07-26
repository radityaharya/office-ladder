import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { jsonbValue } from "./json-column";

export const roomLifecycle = pgEnum("room_lifecycle", ["open", "active", "closed"]);
export const membershipStatus = pgEnum("membership_status", ["active", "left"]);
export const roomRole = pgEnum("room_role", ["host", "player"]);
export const gameStatus = pgEnum("game_status", [
  "setup",
  "active",
  "paused",
  "quarantined",
  "ended",
]);
export const commandReceiptStatus = pgEnum("command_receipt_status", ["accepted", "rejected"]);
export const outboxStatus = pgEnum("game_outbox_status", ["pending", "published"]);
/**
 * `quick-phrase` is deliberately its own kind rather than a flag on `chat`:
 * plans/24-gameplay-v2-spec.md §8.1 makes `ChatMode: "quick"` a distinct gate
 * (a fixed phrase set, and the only mode bots can meaningfully use), so the
 * server has to be able to tell a free-text message from a canned one after
 * the fact — e.g. when a room is switched from `full` to `quick` mid-match.
 */
export const roomMessageKind = pgEnum("room_message_kind", ["chat", "quick-phrase", "system"]);

export const rooms = pgTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    hostUserId: text("host_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    lifecycle: roomLifecycle("lifecycle").default("open").notNull(),
    /**
     * The lobby-authored `ModeRules` object for a custom mode, or NULL when the
     * room just uses its mode preset's own rules from the content pack.
     *
     * A column on `rooms` rather than a `room_rules` table, on purpose: the
     * relationship is strictly zero-or-one per room, the value is only ever
     * fetched *with* its room, and nothing filters or joins on anything inside
     * it. A separate table would buy no integrity (the DB does not validate the
     * shape either way) and would add a second insert to room creation — i.e. a
     * foreign-key ordering hazard, which is the class of bug that has already
     * shipped here once. Deleting a room drops the rules with it for free.
     *
     * Typed as opaque JSON here, not as `ModeRules`: `packages/db` must not
     * depend on `@office-ladder/content`, and the DB is not the validation
     * boundary anyway. Spec §8.4 puts validation in `packages/contracts` —
     * "never trust a client-supplied rules object" — so the server must parse
     * this on the way in *and* on the way out, exactly as it already does for
     * `room_projections.projection` via `rooms/room-snapshot.ts`.
     *
     * This column is the authoritative store for authored rules. `GameState`
     * gets its own frozen snapshot of the resolved rules at `game.start`
     * (spec §5.9), and that snapshot — not this column — is what a match
     * replays against, so editing this row cannot retroactively change a game
     * already in progress.
     */
    customRules: jsonbValue("custom_rules"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
  },
  (table) => [index("rooms_lifecycle_idx").on(table.lifecycle)],
);

export const roomMembers = pgTable(
  "room_members",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: roomRole("role").notNull(),
    status: membershipStatus("status").default("active").notNull(),
    seat: integer("seat"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    leftAt: timestamp("left_at"),
  },
  (table) => [
    unique("room_members_room_user_unique").on(table.roomId, table.userId),
    unique("room_members_room_seat_unique").on(table.roomId, table.seat),
    index("room_members_user_idx").on(table.userId),
    index("room_members_room_status_idx").on(table.roomId, table.status),
  ],
);

export const games = pgTable(
  "games",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "restrict" })
      .unique(),
    status: gameStatus("status").default("setup").notNull(),
    revision: integer("revision").default(0).notNull(),
    eventSequence: integer("event_sequence").default(0).notNull(),
    canonicalState: jsonbValue("canonical_state").notNull(),
    engineVersion: text("engine_version").notNull(),
    rulesetVersion: text("ruleset_version").notNull(),
    contentVersion: text("content_version").notNull(),
    stateHash: text("state_hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    endedAt: timestamp("ended_at"),
  },
  (table) => [index("games_status_idx").on(table.status)],
);

export const gameEvents = pgTable(
  "game_events",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    revision: integer("revision").notNull(),
    commandId: text("command_id").notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    canonicalPayload: jsonbValue("canonical_payload").notNull(),
    logicalTimestamp: text("logical_timestamp").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("game_events_game_sequence_unique").on(table.gameId, table.sequence),
    index("game_events_game_revision_idx").on(table.gameId, table.revision),
  ],
);

export const commandReceipts = pgTable(
  "command_receipts",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    commandId: text("command_id").notNull(),
    actorId: text("actor_id").notNull(),
    type: text("type").notNull(),
    requestHash: text("request_hash").notNull(),
    expectedRevision: integer("expected_revision").notNull(),
    status: commandReceiptStatus("status").notNull(),
    responsePayload: jsonbValue("response_payload").notNull(),
    resultingRevision: integer("resulting_revision"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("command_receipts_game_command_unique").on(table.gameId, table.commandId),
    index("command_receipts_game_created_idx").on(table.gameId, table.createdAt),
  ],
);

export const roomProjections = pgTable("room_projections", {
  roomId: text("room_id")
    .primaryKey()
    .references(() => rooms.id, { onDelete: "cascade" }),
  gameId: text("game_id").references(() => games.id, { onDelete: "set null" }),
  revision: integer("revision").notNull(),
  projection: jsonbValue("projection").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const playerProjections = pgTable(
  "player_projections",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    roomMemberId: text("room_member_id")
      .notNull()
      .references(() => roomMembers.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    projection: jsonbValue("projection").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("player_projections_game_member_unique").on(table.gameId, table.roomMemberId),
  ],
);

export const gameOutbox = pgTable(
  "game_outbox",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    topic: text("topic").notNull(),
    payload: jsonbValue("payload").notNull(),
    status: outboxStatus("status").default("pending").notNull(),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("game_outbox_status_available_idx").on(table.status, table.availableAt),
    index("game_outbox_game_revision_idx").on(table.gameId, table.revision),
  ],
);

/**
 * Room chat. Explicitly **not** game state (spec §8.1): nothing here is
 * reachable from `GameState`, so it never enters the engine, never affects
 * replay, and is not part of the `room_projections.projection` snapshot.
 *
 * `authorId` carries no foreign key, and that is load-bearing rather than
 * sloppy. Two of the three author kinds have no `user` row to point at:
 *
 * - **bots** are ordinary room members whose `playerId` is a synthesized stable
 *   id (`apps/server/src/rooms/bots/bot-seats.ts`), not an auth subject, and
 *   spec §8.1 makes `quick` mode "the only mode bots can meaningfully use" —
 *   i.e. bots are expected authors;
 * - **system** messages have no author at all, hence nullable.
 *
 * `room_members.id` is equally unusable as a target: that table is provisioned
 * but never written by `PostgresRoomRepository`, so every insert would violate
 * the constraint. Pointing this at either table is precisely the shape of the
 * foreign-key bug that already shipped once here. `roomId` *is* a real foreign
 * key, because `rooms` rows genuinely exist before any message can be sent.
 */
export const roomMessages = pgTable(
  "room_messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    /** Author's `PlayerId` (human or bot member). NULL for `system` messages. */
    authorId: text("author_id"),
    kind: roomMessageKind("kind").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    /**
     * The only query the UI needs: "latest N messages in this room".
     *
     * **Ascending, deliberately — do not "fix" this to `.desc()`.** A descending
     * index looks like the obvious choice and is a trap: Drizzle's `desc(col)`
     * emits bare `ORDER BY created_at DESC`, which in Postgres means
     * `DESC NULLS FIRST`, while `.desc()` here generates
     * `created_at DESC NULLS LAST`. The two do not match, so the planner reads
     * every row for the room and sorts. Measured against 93k rows with the
     * descending index in place: `Index Scan … (actual rows=3000)` plus a
     * top-N heapsort. A plain ascending index is read *backwards* to satisfy
     * `DESC NULLS FIRST` exactly — same query, `Index Scan Backward …
     * (actual rows=30)`, no sort node — and still serves an oldest-first
     * scroll forwards. `created_at` is `NOT NULL`, so the NULLS distinction is
     * vacuous in the data and purely an index-matching artefact.
     *
     * Also serves the keyset form (`created_at < cursor`) for scrolling back.
     * No index on `authorId`: nothing looks messages up by author, and
     * moderation-by-author is not a v1 feature.
     */
    index("room_messages_room_created_idx").on(table.roomId, table.createdAt),
  ],
);

/**
 * Emote reactions on a message (spec §8.2 — unrelated to the engine's
 * `reaction.play` command despite the shared word).
 *
 * `playerId` is a room member's `PlayerId`, and like `room_messages.authorId`
 * it deliberately has no foreign key: bots and system-authored feed items are
 * not auth subjects. The uniqueness constraint is the actual point of this
 * table — one player cannot stack the same emote on the same message, so a
 * repeated click is an idempotent insert (or a delete, for un-reacting) rather
 * than a counter the client can inflate. Per-player *variety* caps ("at most 3
 * distinct emotes per message") are a server concern; they need a count, which
 * a unique constraint cannot express.
 */
export const roomMessageReactions = pgTable(
  "room_message_reactions",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => roomMessages.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull(),
    emote: text("emote").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("room_message_reactions_message_player_emote_unique").on(
      table.messageId,
      table.playerId,
      table.emote,
    ),
    /**
     * No separate `message_id` index: the unique constraint above is backed by
     * a btree whose leading column is `message_id`, which already serves
     * "reactions for these N messages".
     */
  ],
);

export const roomsRelations = relations(rooms, ({ many, one }) => ({
  host: one(user, { fields: [rooms.hostUserId], references: [user.id] }),
  members: many(roomMembers),
  game: one(games),
  projection: one(roomProjections),
  messages: many(roomMessages),
}));

export const roomMessagesRelations = relations(roomMessages, ({ one, many }) => ({
  room: one(rooms, { fields: [roomMessages.roomId], references: [rooms.id] }),
  reactions: many(roomMessageReactions),
}));

export const roomMessageReactionsRelations = relations(roomMessageReactions, ({ one }) => ({
  message: one(roomMessages, {
    fields: [roomMessageReactions.messageId],
    references: [roomMessages.id],
  }),
}));

export const roomMembersRelations = relations(roomMembers, ({ one, many }) => ({
  room: one(rooms, { fields: [roomMembers.roomId], references: [rooms.id] }),
  user: one(user, { fields: [roomMembers.userId], references: [user.id] }),
  playerProjections: many(playerProjections),
}));

export const gamesRelations = relations(games, ({ one, many }) => ({
  room: one(rooms, { fields: [games.roomId], references: [rooms.id] }),
  events: many(gameEvents),
  commandReceipts: many(commandReceipts),
  roomProjections: many(roomProjections),
  playerProjections: many(playerProjections),
  outboxEntries: many(gameOutbox),
}));

export const gameEventsRelations = relations(gameEvents, ({ one }) => ({
  game: one(games, { fields: [gameEvents.gameId], references: [games.id] }),
}));

export const commandReceiptsRelations = relations(commandReceipts, ({ one }) => ({
  game: one(games, { fields: [commandReceipts.gameId], references: [games.id] }),
}));

export const roomProjectionsRelations = relations(roomProjections, ({ one }) => ({
  room: one(rooms, { fields: [roomProjections.roomId], references: [rooms.id] }),
  game: one(games, { fields: [roomProjections.gameId], references: [games.id] }),
}));

export const playerProjectionsRelations = relations(playerProjections, ({ one }) => ({
  game: one(games, { fields: [playerProjections.gameId], references: [games.id] }),
  roomMember: one(roomMembers, {
    fields: [playerProjections.roomMemberId],
    references: [roomMembers.id],
  }),
}));

export const gameOutboxRelations = relations(gameOutbox, ({ one }) => ({
  game: one(games, { fields: [gameOutbox.gameId], references: [games.id] }),
}));
