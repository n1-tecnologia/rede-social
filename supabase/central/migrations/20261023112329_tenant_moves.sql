CREATE TABLE "platform"."tenant_move_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"move_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "tenant_move_events_kind_chk" CHECK ("platform"."tenant_move_events"."kind" ~ '^[a-z_]{3,40}$')
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_move_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenant_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_project_id" uuid NOT NULL,
	"to_project_id" uuid NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"status_before" text NOT NULL,
	"actor" text NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fingerprint" text,
	"error_code" text,
	"lease_owner" uuid,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cutover_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"source_deleted_at" timestamp with time zone,
	CONSTRAINT "tenant_moves_projects_chk" CHECK ("platform"."tenant_moves"."from_project_id" <> "platform"."tenant_moves"."to_project_id"),
	CONSTRAINT "tenant_moves_state_chk" CHECK ("platform"."tenant_moves"."state" in ('planned', 'suspended', 'copied', 'verified', 'cutover', 'done', 'rolled_back')),
	CONSTRAINT "tenant_moves_status_before_chk" CHECK ("platform"."tenant_moves"."status_before" in ('active', 'suspended')),
	CONSTRAINT "tenant_moves_actor_chk" CHECK ("platform"."tenant_moves"."actor" ~ '^[A-Za-z0-9:_@.-]{1,64}$'),
	CONSTRAINT "tenant_moves_error_code_chk" CHECK ("platform"."tenant_moves"."error_code" is null or "platform"."tenant_moves"."error_code" ~ '^[a-z_]{3,40}$')
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."tenant_move_events" ADD CONSTRAINT "tenant_move_events_move_id_tenant_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "platform"."tenant_moves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_moves" ADD CONSTRAINT "tenant_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_moves" ADD CONSTRAINT "tenant_moves_from_project_id_projects_id_fk" FOREIGN KEY ("from_project_id") REFERENCES "platform"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_moves" ADD CONSTRAINT "tenant_moves_to_project_id_projects_id_fk" FOREIGN KEY ("to_project_id") REFERENCES "platform"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_move_events_move_idx" ON "platform"."tenant_move_events" USING btree ("move_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_moves_one_open_uq" ON "platform"."tenant_moves" USING btree ("tenant_id") WHERE "platform"."tenant_moves"."state" not in ('done', 'rolled_back');--> statement-breakpoint
CREATE INDEX "tenant_moves_to_project_idx" ON "platform"."tenant_moves" USING btree ("to_project_id");