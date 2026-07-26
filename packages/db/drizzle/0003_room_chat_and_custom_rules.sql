CREATE TYPE "public"."room_message_kind" AS ENUM('chat', 'quick-phrase', 'system');--> statement-breakpoint
CREATE TABLE "room_message_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"player_id" text NOT NULL,
	"emote" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_message_reactions_message_player_emote_unique" UNIQUE("message_id","player_id","emote")
);
--> statement-breakpoint
CREATE TABLE "room_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"author_id" text,
	"kind" "room_message_kind" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "custom_rules" jsonb;--> statement-breakpoint
ALTER TABLE "room_message_reactions" ADD CONSTRAINT "room_message_reactions_message_id_room_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."room_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_messages_room_created_idx" ON "room_messages" USING btree ("room_id","created_at");