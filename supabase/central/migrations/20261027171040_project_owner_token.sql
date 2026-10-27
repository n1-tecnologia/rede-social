-- project_owner_token (09.4-02, D-566, D-568, D-571, D-573, D-539) — the registry half of the customer-owned
-- project: who owns a project, the Supabase organisation it is pinned to, its SEALED management token and the
-- expiry date the operator typed, the outcome of the last token check beside the database health, and the
-- append-only audit table of token registrations (its closing hardening is the next migration).
--
-- EXPAND-ONLY. Every existing row satisfies the defaults (`owner = 'platform'`, no pin, no token, no expiry), so
-- projects_owner_token_chk holds for all of them, and an OLD API running on the new database keeps working: it
-- ignores the new columns and never touches the new table. Nothing is dropped, renamed or rewritten.
--
-- CENTRAL SET ONLY. `platform.*` is never applied to a tenant's project (`tenant-set-no-platform.test.ts` and
-- `scripts/db-two-databases.sh --assert-no-platform` prove it). No column below can hold a token, a prefix, a
-- hash or a length in clear; `mgmt_token_sealed` holds only an AES-256-GCM value (plan 07).
CREATE TABLE "platform"."project_token_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"project_id" uuid,
	"project_ref" text NOT NULL,
	"actor" text NOT NULL,
	"outcome" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_token_events_kind_chk" CHECK ("platform"."project_token_events"."kind" in ('registered', 'replaced', 'owner_changed', 'repinned')),
	CONSTRAINT "project_token_events_ref_chk" CHECK ("platform"."project_token_events"."project_ref" ~ '^[a-z][a-z0-9-]{2,39}$'),
	CONSTRAINT "project_token_events_actor_chk" CHECK ("platform"."project_token_events"."actor" ~ '^[A-Za-z0-9:_@.-]{1,64}$'),
	CONSTRAINT "project_token_events_outcome_chk" CHECK ("platform"."project_token_events"."outcome" in ('ok', 'token_invalid', 'token_forbidden', 'token_other_project', 'token_account_wide', 'token_expiry_invalid', 'org_mismatch', 'not_found', 'unchecked'))
);
--> statement-breakpoint
ALTER TABLE "platform"."project_token_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."project_health" ADD COLUMN "token_check" text;--> statement-breakpoint
ALTER TABLE "platform"."project_health" ADD COLUMN "token_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform"."projects" ADD COLUMN "owner" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."projects" ADD COLUMN "org_slug" text;--> statement-breakpoint
ALTER TABLE "platform"."projects" ADD COLUMN "mgmt_token_sealed" text;--> statement-breakpoint
ALTER TABLE "platform"."projects" ADD COLUMN "mgmt_token_expires_at" date;--> statement-breakpoint
ALTER TABLE "platform"."project_token_events" ADD CONSTRAINT "project_token_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "platform"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_token_events_project_idx" ON "platform"."project_token_events" USING btree ("project_id","at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "platform"."project_health" ADD CONSTRAINT "project_health_token_check_chk" CHECK ("platform"."project_health"."token_check" is null or "platform"."project_health"."token_check" in ('ok', 'invalid', 'forbidden', 'org_mismatch'));--> statement-breakpoint
ALTER TABLE "platform"."projects" ADD CONSTRAINT "projects_owner_chk" CHECK ("platform"."projects"."owner" in ('platform', 'customer'));--> statement-breakpoint
ALTER TABLE "platform"."projects" ADD CONSTRAINT "projects_org_slug_chk" CHECK ("platform"."projects"."org_slug" is null or "platform"."projects"."org_slug" ~ '^[A-Za-z0-9_-]{1,128}$');--> statement-breakpoint
ALTER TABLE "platform"."projects" ADD CONSTRAINT "projects_owner_token_chk" CHECK (("platform"."projects"."owner" = 'platform' and "platform"."projects"."mgmt_token_sealed" is null and "platform"."projects"."org_slug" is null and "platform"."projects"."mgmt_token_expires_at" is null) or ("platform"."projects"."owner" = 'customer' and "platform"."projects"."mgmt_token_sealed" is not null and "platform"."projects"."org_slug" is not null));