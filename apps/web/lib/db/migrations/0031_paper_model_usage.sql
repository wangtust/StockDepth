CREATE TABLE "paper_model_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"paper_run_id" integer NOT NULL,
	"call_id" varchar(100) NOT NULL,
	"model_config_id" integer,
	"provider" varchar(80) NOT NULL,
	"model" text NOT NULL,
	"status" varchar(30) NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cached_input_tokens" bigint,
	"raw_usage" text,
	"pricing_snapshot" text,
	"estimated_cost" numeric(24, 12),
	"cost_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_model_calls" ADD CONSTRAINT "paper_model_calls_paper_run_id_paper_analysis_runs_id_fk" FOREIGN KEY ("paper_run_id") REFERENCES "public"."paper_analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_model_calls_run_call_idx" ON "paper_model_calls" USING btree ("paper_run_id","call_id");