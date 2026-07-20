import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

type JsonValue =
  | boolean
  | null
  | number
  | string
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

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

export const rooms = pgTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    hostUserId: text("host_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    lifecycle: roomLifecycle("lifecycle").default("open").notNull(),
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
    canonicalState: jsonb("canonical_state").$type<JsonValue>().notNull(),
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
    canonicalPayload: jsonb("canonical_payload").$type<JsonValue>().notNull(),
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
    responsePayload: jsonb("response_payload").$type<JsonValue>().notNull(),
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
  projection: jsonb("projection").$type<JsonValue>().notNull(),
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
    projection: jsonb("projection").$type<JsonValue>().notNull(),
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
    payload: jsonb("payload").$type<JsonValue>().notNull(),
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

export const roomsRelations = relations(rooms, ({ many, one }) => ({
  host: one(user, { fields: [rooms.hostUserId], references: [user.id] }),
  members: many(roomMembers),
  game: one(games),
  projection: one(roomProjections),
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
