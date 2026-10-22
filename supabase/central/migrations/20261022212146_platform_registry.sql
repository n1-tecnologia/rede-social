CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "platform"."project_bootstrap_steps" (
	"project_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"reason_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "project_bootstrap_steps_pk" PRIMARY KEY("project_id","step"),
	CONSTRAINT "project_bootstrap_steps_step_chk" CHECK ("platform"."project_bootstrap_steps"."step" in ('verify', 'roles', 'schema', 'auth', 'buckets', 'realtime', 'tenant', 'invite')),
	CONSTRAINT "project_bootstrap_steps_status_chk" CHECK ("platform"."project_bootstrap_steps"."status" in ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "platform"."project_bootstrap_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."project_health" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"detail_code" text,
	"checked_at" timestamp with time zone,
	CONSTRAINT "project_health_status_chk" CHECK ("platform"."project_health"."status" in ('healthy', 'paused', 'unreachable', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "platform"."project_health" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"label" text,
	"provider" text DEFAULT 'supabase' NOT NULL,
	"is_central" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"credential_source" text DEFAULT 'sealed' NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"secret_key_id" smallint,
	"api_url" text NOT NULL,
	"publishable_key" text,
	"plan" text,
	"state" text DEFAULT 'preparing' NOT NULL,
	"hook_ref" text,
	"database_url_tx_sealed" text,
	"database_url_session_sealed" text,
	"ddl_url_sealed" text,
	"service_key_sealed" text,
	"hook_secret_sealed" text,
	"service_key_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_ref_chk" CHECK ("platform"."projects"."ref" ~ '^[a-z][a-z0-9-]{2,39}$'),
	CONSTRAINT "projects_provider_chk" CHECK ("platform"."projects"."provider" ~ '^[a-z]{2,16}$'),
	CONSTRAINT "projects_credential_source_chk" CHECK ("platform"."projects"."credential_source" in ('env', 'sealed')),
	CONSTRAINT "projects_env_only_central_chk" CHECK ("platform"."projects"."credential_source" <> 'env' or "platform"."projects"."is_central"),
	CONSTRAINT "projects_credential_version_chk" CHECK ("platform"."projects"."credential_version" >= 1),
	CONSTRAINT "projects_secret_key_id_chk" CHECK ("platform"."projects"."secret_key_id" between 1 and 32767),
	CONSTRAINT "projects_api_url_chk" CHECK ("platform"."projects"."api_url" = '' or "platform"."projects"."api_url" ~ '^https?://'),
	CONSTRAINT "projects_state_chk" CHECK ("platform"."projects"."state" ~ '^[a-z_]{3,20}$')
);
--> statement-breakpoint
ALTER TABLE "platform"."projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."project_schema_state" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"applied_count" integer,
	"applied_head" text,
	"required_count" integer,
	"required_head" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"failed_version" text,
	"error_code" text,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_schema_state_status_chk" CHECK ("platform"."project_schema_state"."status" in ('current', 'behind', 'failed', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "platform"."project_schema_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenant_projects" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"previous_project_id" uuid,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."project_bootstrap_steps" ADD CONSTRAINT "project_bootstrap_steps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "platform"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."project_health" ADD CONSTRAINT "project_health_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "platform"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."project_schema_state" ADD CONSTRAINT "project_schema_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "platform"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_projects" ADD CONSTRAINT "tenant_projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_projects" ADD CONSTRAINT "tenant_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "platform"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_projects" ADD CONSTRAINT "tenant_projects_previous_project_id_projects_id_fk" FOREIGN KEY ("previous_project_id") REFERENCES "platform"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_ref_uq" ON "platform"."projects" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_hook_ref_uq" ON "platform"."projects" USING btree ("hook_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_one_central_uq" ON "platform"."projects" USING btree ("is_central") WHERE "platform"."projects"."is_central";--> statement-breakpoint
CREATE UNIQUE INDEX "projects_one_default_uq" ON "platform"."projects" USING btree ("is_default") WHERE "platform"."projects"."is_default";--> statement-breakpoint
CREATE INDEX "tenant_projects_project_idx" ON "platform"."tenant_projects" USING btree ("project_id");