ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_code" varchar(6);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_invite_code_unique" UNIQUE("invite_code");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
