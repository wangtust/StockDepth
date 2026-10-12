CREATE TABLE "admin_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_user_id" integer NOT NULL,
	"action" varchar(120) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_id" integer,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "role" = 'member' WHERE "role" = 'owner';--> statement-breakpoint
UPDATE "users"
SET "role" = 'super_admin', "status" = 'active', "updated_at" = now()
WHERE "id" = (
	SELECT "id"
	FROM "users"
	WHERE "deleted_at" IS NULL
	ORDER BY "id" ASC
	LIMIT 1
)
AND NOT EXISTS (
	SELECT 1
	FROM "users"
	WHERE "role" = 'super_admin'
		AND "deleted_at" IS NULL
);--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_target_idx" ON "admin_audit_logs" USING btree ("target_type","target_id");
