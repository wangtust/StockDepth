ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "analysis_credits" integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_product_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_name" varchar(50);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_status" varchar(20);
--> statement-breakpoint
WITH membership AS (
  SELECT DISTINCT ON (tm."user_id")
    tm."user_id",
    t."analysis_credits",
    t."plan_name",
    t."subscription_status"
  FROM "team_members" tm
  JOIN "teams" t ON t."id" = tm."team_id"
  ORDER BY tm."user_id", CASE WHEN tm."role" = 'owner' THEN 0 ELSE 1 END, tm."id"
)
UPDATE "users" u
SET
  "analysis_credits" = membership."analysis_credits",
  "plan_name" = membership."plan_name",
  "subscription_status" = membership."subscription_status",
  "updated_at" = now()
FROM membership
WHERE u."id" = membership."user_id";
--> statement-breakpoint
WITH stripe_owner AS (
  SELECT DISTINCT ON (tm."team_id")
    tm."team_id",
    tm."user_id"
  FROM "team_members" tm
  ORDER BY tm."team_id", CASE WHEN tm."role" = 'owner' THEN 0 ELSE 1 END, tm."id"
)
UPDATE "users" u
SET
  "stripe_customer_id" = t."stripe_customer_id",
  "stripe_subscription_id" = t."stripe_subscription_id",
  "stripe_product_id" = t."stripe_product_id",
  "updated_at" = now()
FROM stripe_owner so
JOIN "teams" t ON t."id" = so."team_id"
WHERE u."id" = so."user_id"
  AND (
    t."stripe_customer_id" IS NOT NULL
    OR t."stripe_subscription_id" IS NOT NULL
    OR t."stripe_product_id" IS NOT NULL
  );
--> statement-breakpoint
WITH team_account AS (
  SELECT DISTINCT ON (tm."team_id")
    tm."team_id",
    tm."user_id"
  FROM "team_members" tm
  ORDER BY tm."team_id", CASE WHEN tm."role" = 'owner' THEN 0 ELSE 1 END, tm."id"
)
UPDATE "activity_logs" al
SET "user_id" = COALESCE(al."user_id", team_account."user_id")
FROM team_account
WHERE al."team_id" = team_account."team_id";
--> statement-breakpoint
WITH team_account AS (
  SELECT DISTINCT ON (tm."team_id")
    tm."team_id",
    tm."user_id"
  FROM "team_members" tm
  ORDER BY tm."team_id", CASE WHEN tm."role" = 'owner' THEN 0 ELSE 1 END, tm."id"
)
UPDATE "credit_transactions" ct
SET "user_id" = COALESCE(
  (SELECT aj."user_id" FROM "analysis_jobs" aj WHERE aj."id" = ct."job_id"),
  team_account."user_id",
  ct."user_id"
)
FROM team_account
WHERE ct."team_id" = team_account."team_id";
--> statement-breakpoint
ALTER TABLE "activity_logs" DROP CONSTRAINT IF EXISTS "activity_logs_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP CONSTRAINT IF EXISTS "analysis_jobs_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "analysis_reports" DROP CONSTRAINT IF EXISTS "analysis_reports_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_transactions" DROP CONSTRAINT IF EXISTS "credit_transactions_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_team_id_teams_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "analysis_jobs_user_team_created_at_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analysis_jobs_user_created_at_idx"
ON "analysis_jobs" USING btree ("user_id", "created_at");
--> statement-breakpoint
ALTER TABLE "activity_logs" DROP COLUMN IF EXISTS "team_id";
--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN IF EXISTS "team_id";
--> statement-breakpoint
ALTER TABLE "analysis_reports" DROP COLUMN IF EXISTS "team_id";
--> statement-breakpoint
ALTER TABLE "credit_transactions" DROP COLUMN IF EXISTS "team_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "invitations";
--> statement-breakpoint
DROP TABLE IF EXISTS "team_members";
--> statement-breakpoint
DROP TABLE IF EXISTS "teams";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
