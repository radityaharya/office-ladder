ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "display_username" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_username_unique" ON "user" USING btree ("username");
--> statement-breakpoint
CREATE TYPE "public"."command_receipt_status" AS ENUM('accepted', 'rejected');
--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('setup', 'active', 'paused', 'quarantined', 'ended');
--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'left');
--> statement-breakpoint
CREATE TYPE "public"."game_outbox_status" AS ENUM('pending', 'published');
--> statement-breakpoint
CREATE TYPE "public"."room_lifecycle" AS ENUM('open', 'active', 'closed');
--> statement-breakpoint
CREATE TYPE "public"."room_role" AS ENUM('host', 'player');
--> statement-breakpoint
CREATE TABLE "command_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"command_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"request_hash" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"status" "command_receipt_status" NOT NULL,
	"response_payload" jsonb NOT NULL,
	"resulting_revision" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipts_game_command_unique" UNIQUE("game_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"revision" integer NOT NULL,
	"command_id" text NOT NULL,
	"actor_id" text,
	"type" text NOT NULL,
	"schema_version" integer NOT NULL,
	"canonical_payload" jsonb NOT NULL,
	"logical_timestamp" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_events_game_sequence_unique" UNIQUE("game_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "game_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"revision" integer NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "game_outbox_status" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"status" "game_status" DEFAULT 'setup' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"event_sequence" integer DEFAULT 0 NOT NULL,
	"canonical_state" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"ruleset_version" text NOT NULL,
	"content_version" text NOT NULL,
	"state_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	CONSTRAINT "games_room_id_unique" UNIQUE("room_id")
);
--> statement-breakpoint
CREATE TABLE "player_projections" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"room_member_id" text NOT NULL,
	"revision" integer NOT NULL,
	"projection" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_projections_game_member_unique" UNIQUE("game_id","room_member_id")
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "room_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"seat" integer,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	CONSTRAINT "room_members_room_user_unique" UNIQUE("room_id","user_id"),
	CONSTRAINT "room_members_room_seat_unique" UNIQUE("room_id","seat")
);
--> statement-breakpoint
CREATE TABLE "room_projections" (
	"room_id" text PRIMARY KEY NOT NULL,
	"game_id" text,
	"revision" integer NOT NULL,
	"projection" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"host_user_id" text NOT NULL,
	"lifecycle" "room_lifecycle" DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "rooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_outbox" ADD CONSTRAINT "game_outbox_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_projections" ADD CONSTRAINT "player_projections_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_projections" ADD CONSTRAINT "player_projections_room_member_id_room_members_id_fk" FOREIGN KEY ("room_member_id") REFERENCES "public"."room_members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "room_projections" ADD CONSTRAINT "room_projections_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "room_projections" ADD CONSTRAINT "room_projections_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "command_receipts_game_created_idx" ON "command_receipts" USING btree ("game_id","created_at");
--> statement-breakpoint
CREATE INDEX "game_events_game_revision_idx" ON "game_events" USING btree ("game_id","revision");
--> statement-breakpoint
CREATE INDEX "game_outbox_status_available_idx" ON "game_outbox" USING btree ("status","available_at");
--> statement-breakpoint
CREATE INDEX "game_outbox_game_revision_idx" ON "game_outbox" USING btree ("game_id","revision");
--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "games" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "room_members_user_idx" ON "room_members" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "room_members_room_status_idx" ON "room_members" USING btree ("room_id","status");
--> statement-breakpoint
CREATE INDEX "rooms_lifecycle_idx" ON "rooms" USING btree ("lifecycle");
