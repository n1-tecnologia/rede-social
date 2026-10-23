-- tenant_projects_pending_invite (09.2-13, D-542) — generated from the Drizzle central schema.
--
-- Holds the first admin's `{ email, createdBy }` from the create call to the bootstrap's `invite` step, which
-- creates the invite inside the tenant's project and clears the column. Personal data in the control plane
-- for the length of a bootstrap only. Nullable: every existing binding has none. Central set only.
ALTER TABLE "platform"."tenant_projects" ADD COLUMN "pending_invite" jsonb;