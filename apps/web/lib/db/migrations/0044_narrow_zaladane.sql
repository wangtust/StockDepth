-- Stop application writers and back up before applying this contraction.
-- Credentials must be encrypted by prepare-model-normalization.cjs first.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users u LEFT JOIN billing_accounts b ON b.user_id=u.id
    WHERE b.user_id IS NULL OR (u.analysis_credits,u.stripe_customer_id,u.stripe_subscription_id,u.stripe_product_id,u.plan_name,u.subscription_status)
      IS DISTINCT FROM (b.analysis_credits,b.stripe_customer_id,b.stripe_subscription_id,b.stripe_product_id,b.plan_name,b.subscription_status)) THEN
    RAISE EXCEPTION 'Billing normalization requires reconciled accounts';
  END IF;
  IF EXISTS (SELECT 1 FROM llm_model_configs WHERE api_key <> '' AND api_key NOT LIKE 'sdkey:%') THEN
    RAISE EXCEPTION 'Run model credential normalization preflight before migration';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "analysis_job_legacy_configs" (
	"job_id" integer PRIMARY KEY NOT NULL,
	"evidence" jsonb NOT NULL,
	CONSTRAINT "job_legacy_evidence_object" CHECK (jsonb_typeof("analysis_job_legacy_configs"."evidence") = 'object')
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_stripe_customer_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_stripe_subscription_id_unique";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP CONSTRAINT "analysis_jobs_configuration_state";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_analysis_credits_nonnegative";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP CONSTRAINT "analysis_jobs_model_config_id_llm_model_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP CONSTRAINT "analysis_jobs_quick_model_config_id_llm_model_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP CONSTRAINT "analysis_jobs_deep_model_config_id_llm_model_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP CONSTRAINT "analysis_jobs_quick_version_config_fk";
--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP CONSTRAINT "analysis_jobs_deep_version_config_fk";
--> statement-breakpoint
ALTER TABLE "llm_model_config_versions" ALTER COLUMN "encrypted_api_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_job_legacy_configs" ADD CONSTRAINT "analysis_job_legacy_configs_job_id_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Keep incomplete historical evidence outside the hot task table. Never invent lineage.
INSERT INTO analysis_job_legacy_configs(job_id,evidence)
SELECT id,jsonb_build_object('provider',provider,'baseUrl',base_url,'quickModel',quick_model,'deepModel',deep_model,
  'modelConfigId',model_config_id,'quickModelConfigId',quick_model_config_id,'deepModelConfigId',deep_model_config_id,
  'quickConfigSnapshot',quick_config_snapshot,'deepConfigSnapshot',deep_config_snapshot)
FROM analysis_jobs WHERE configuration_state='legacy_unknown';
--> statement-breakpoint
-- Copy the current editable parameters once, preserving any previously pinned versions.
INSERT INTO llm_model_config_versions(config_id,version,provider,base_url,model_name,model_options,
  encrypted_api_key,input_price,cache_price,output_price,provenance)
SELECT c.id,coalesce((select max(v.version) from llm_model_config_versions v where v.config_id=c.id),0)+1,
  c.provider,c.base_url,c.model_name,c.model_options,nullif(c.api_key,''),c.input_price,c.cache_price,c.output_price,'configured'
FROM llm_model_configs c LEFT JOIN llm_model_config_versions v ON v.id=c.current_version_id AND v.config_id=c.id
WHERE v.id IS NULL OR (c.provider,c.base_url,c.model_name,c.model_options,nullif(c.api_key,''),c.input_price,c.cache_price,c.output_price)
 IS DISTINCT FROM (v.provider,v.base_url,v.model_name,v.model_options,v.encrypted_api_key,v.input_price,v.cache_price,v.output_price);
--> statement-breakpoint
UPDATE llm_model_configs c SET current_version_id=(SELECT id FROM llm_model_config_versions v WHERE v.config_id=c.id ORDER BY version DESC LIMIT 1);
--> statement-breakpoint
UPDATE llm_model_configs c SET is_active=false,is_default=false WHERE EXISTS
 (SELECT 1 FROM llm_model_config_versions v WHERE v.id=c.current_version_id AND v.encrypted_api_key IS NULL);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "base_url";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "quick_model";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "deep_model";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "model_config_id";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "quick_model_config_id";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "deep_model_config_id";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "quick_config_snapshot";--> statement-breakpoint
ALTER TABLE "analysis_jobs" DROP COLUMN "deep_config_snapshot";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "base_url";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "api_key";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "model_name";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "model_options";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "input_price";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "cache_price";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "output_price";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "analysis_credits";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "stripe_customer_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "stripe_product_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "plan_name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "subscription_status";--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_configuration_state" CHECK (("analysis_jobs"."configuration_state" = 'legacy_unknown' AND "analysis_jobs"."quick_model_version_id" IS NULL AND "analysis_jobs"."deep_model_version_id" IS NULL) OR ("analysis_jobs"."configuration_state" = 'versioned' AND "analysis_jobs"."quick_model_version_id" IS NOT NULL AND "analysis_jobs"."deep_model_version_id" IS NOT NULL));
--> statement-breakpoint
-- Internal, transaction-scoped permits are inaccessible to ordinary business roles.
-- Database owners are inherently trusted (they can drop triggers); never grant their credentials to end users.
CREATE SCHEMA IF NOT EXISTS stockdepth_internal;
REVOKE ALL ON SCHEMA stockdepth_internal FROM PUBLIC;
CREATE TABLE stockdepth_internal.call_correction_permits (
  transaction_id bigint NOT NULL,
  table_name text NOT NULL,
  call_id integer NOT NULL,
  after_row jsonb NOT NULL,
  PRIMARY KEY (transaction_id, table_name, call_id)
);
REVOKE ALL ON stockdepth_internal.call_correction_permits FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.protect_terminal_model_call() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE permitted integer;
BEGIN
  IF OLD.status = 'running' OR NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  DELETE FROM stockdepth_internal.call_correction_permits
    WHERE transaction_id = txid_current() AND table_name = TG_TABLE_NAME
      AND call_id = OLD.id AND after_row = to_jsonb(NEW)
    RETURNING call_id INTO permitted;
  IF permitted IS NULL THEN
    RAISE EXCEPTION 'Terminal model call usage is immutable; use authorized correction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_terminal_model_call() FROM PUBLIC;
CREATE TRIGGER analysis_model_calls_terminal_guard BEFORE UPDATE ON public.analysis_model_calls
FOR EACH ROW EXECUTE FUNCTION public.protect_terminal_model_call();
CREATE TRIGGER paper_model_calls_terminal_guard BEFORE UPDATE ON public.paper_model_calls
FOR EACH ROW EXECUTE FUNCTION public.protect_terminal_model_call();
--> statement-breakpoint
-- DBA-only interface. An operator must explicitly grant EXECUTE to a dedicated correction role.
-- An authenticated application endpoint must additionally authorize its actual session user.
CREATE FUNCTION public.correct_model_call_usage(call_table text, row_id integer, actor_id integer, reason text, patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE before_row jsonb; after_row jsonb; allowed text[]; key text; assignment text; parent_job integer;
BEGIN
  IF call_table NOT IN ('analysis_model_calls','paper_model_calls') THEN RAISE EXCEPTION 'Unsupported call table'; END IF;
  IF reason IS NULL OR length(btrim(reason)) < 10 THEN RAISE EXCEPTION 'A detailed correction reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=actor_id AND role='super_admin' AND status='active' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Correction requires an active super administrator';
  END IF;
  IF patch IS NULL OR jsonb_typeof(patch) <> 'object' OR patch = '{}'::jsonb THEN RAISE EXCEPTION 'Correction patch must be a nonempty object'; END IF;
  allowed := ARRAY['input_tokens','output_tokens','cached_input_tokens','raw_usage','pricing_snapshot','estimated_cost','cost_complete','cost_currency'];
  IF call_table='analysis_model_calls' THEN allowed := allowed || ARRAY['total_tokens','usage_available']; END IF;
  FOR key IN SELECT jsonb_object_keys(patch) LOOP
    IF NOT key = ANY(allowed) THEN RAISE EXCEPTION 'Unsupported correction field: %',key; END IF;
    IF key IN ('input_tokens','output_tokens','cached_input_tokens','total_tokens','estimated_cost')
      AND patch->key <> 'null'::jsonb AND (patch->>key)::numeric < 0 THEN
      RAISE EXCEPTION 'Usage and cost cannot be negative';
    END IF;
  END LOOP;
  -- Match the worker lock order (job, then call) to avoid correction/sync deadlocks.
  IF call_table='analysis_model_calls' THEN
    SELECT job_id INTO parent_job FROM public.analysis_model_calls WHERE id=row_id;
    PERFORM 1 FROM public.analysis_jobs WHERE id=parent_job FOR UPDATE;
  END IF;
  EXECUTE format('SELECT to_jsonb(c) FROM public.%I c WHERE id=$1 FOR UPDATE',call_table) INTO before_row USING row_id;
  IF before_row IS NULL THEN RAISE EXCEPTION 'Model call not found'; END IF;
  IF before_row->>'status'='running' THEN RAISE EXCEPTION 'Only terminal model calls can be corrected'; END IF;
  -- Populate typed record first so the permit is bound to the exact stored values.
  EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::public.%I,$1))',call_table) INTO after_row USING before_row || patch;
  INSERT INTO stockdepth_internal.call_correction_permits VALUES(txid_current(),call_table,row_id,after_row);
  SELECT string_agg(format('%I = r.%I', k,k),',') INTO assignment FROM jsonb_object_keys(patch) k;
  EXECUTE format('UPDATE public.%I c SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE c.id=$2',call_table,assignment,call_table) USING after_row,row_id;
  -- Same-value corrections may skip the guard; leave no transaction-local authorization behind.
  DELETE FROM stockdepth_internal.call_correction_permits WHERE transaction_id=txid_current() AND table_name=call_table AND call_id=row_id;
  IF call_table='analysis_model_calls' THEN
    UPDATE public.analysis_jobs j SET
      input_tokens = t.input_tokens, output_tokens = t.output_tokens, total_tokens = t.total_tokens,
      token_usage_complete = j.token_usage_complete AND t.complete
    FROM (SELECT coalesce(sum(input_tokens),0) input_tokens, coalesce(sum(output_tokens),0) output_tokens,
      coalesce(sum(total_tokens),0) total_tokens, coalesce(bool_and(usage_available),false) complete
      FROM public.analysis_model_calls WHERE job_id=(before_row->>'job_id')::integer) t
    WHERE j.id=(before_row->>'job_id')::integer;
  END IF;
  INSERT INTO public.admin_audit_logs(admin_user_id,action,target_type,target_id,metadata)
    VALUES(actor_id,'model_call.usage_corrected',call_table,row_id,jsonb_build_object('reason',btrim(reason),'before',before_row,'after',after_row,'database_actor',session_user)::text);
END $$;
REVOKE ALL ON FUNCTION public.correct_model_call_usage(text,integer,integer,text,jsonb) FROM PUBLIC;
