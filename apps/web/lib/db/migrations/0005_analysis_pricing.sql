CREATE TABLE IF NOT EXISTS "analysis_pricing" (
  "depth" integer PRIMARY KEY NOT NULL,
  "label" varchar(40) NOT NULL,
  "credit_cost" integer NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "analysis_pricing" ("depth", "label", "credit_cost")
VALUES
  (1, 'Shallow', 1),
  (3, 'Medium', 3),
  (5, 'Deep', 5)
ON CONFLICT ("depth") DO NOTHING;
