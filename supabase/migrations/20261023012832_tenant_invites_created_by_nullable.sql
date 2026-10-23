-- tenant_invites_created_by_nullable (09.2-13, DBT-36, D-533/D-542) — expand-only, generated from the Drizzle schema.
--
-- The creator of a first-admin invite is a CENTRAL super_admin, and a tenant project's own `users` has no
-- row for that person: the bootstrap's `invite` step runs in the tenant's project, so the foreign key to
-- `users` could never be satisfied there. The column becomes nullable and loses its constraint; no data is
-- rewritten and every writer that passes an id keeps working. (`access_grants.created_by_user_id` already
-- has no foreign key.)
ALTER TABLE "tenant_invites" DROP CONSTRAINT "tenant_invites_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tenant_invites" ALTER COLUMN "created_by" DROP NOT NULL;