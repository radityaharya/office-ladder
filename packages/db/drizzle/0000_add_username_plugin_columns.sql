ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "display_username" text;
CREATE UNIQUE INDEX IF NOT EXISTS "user_username_unique" ON "user" ("username");
