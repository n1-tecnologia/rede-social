import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 09.2-02 (D-540, D-547): the PLATFORM schema. CENTRAL SET ONLY: `supabase/central/migrations` creates
 * it, the runner applies it with its own ledger (`supabase_migrations.central_migrations`), and it is never
 * applied to a tenant's project (`tenant-set-no-platform.test.ts` and pgTAP over `rede_tenant_b` prove it).
 * Every table below is born with RLS on and ZERO policies, deliberately: no tenant lane may read the registry,
 * because it names every project and holds their sealed credentials. Only `service_role` (reached by
 * `set local role service_role` in the platform lane, plan 04) reads and writes. Adding a policy for
 * `authenticated` here is always a bug (SCHEMA-CONVENTIONS (i)).
 */
export const platform = pgSchema('platform');

/**
 * One row per Supabase project the platform owns. "Project 0" is the shared project every tenant lives in
 * today (`is_central`, `is_default`, `credential_source = 'env'`: its credentials stay in the environment).
 * Every other row is a project the platform created, whose credentials are SEALED in the `*_sealed` columns
 * (`v1:<keyId>:<iv>:<tag>:<ciphertext>`, AES-256-GCM with AAD = the row id, plan 05).
 *
 * `state`, `provider` and `credential_source` are FORMATS, never enums: the set of states and providers is
 * code, so a new one needs no migration. `plan` is information only (the platform never branches on it).
 * `secret_key_id` (smallint, 1..32767) and `credential_version` (integer, >= 1) only ever go up, so a key id
 * never wraps and a version never goes back (P2).
 *
 * Several tenants may bind ONE project (D-540): nothing here makes `project_id` unique in `tenant_projects`.
 * The rule that production refuses a second tenant is an application rule (plan 14), not a database rule.
 */
export const projects = platform
  .table(
    'projects',
    {
      id: uuid().primaryKey().defaultRandom(),
      /** Hosted refs are 20 letters (validated by the API); local fake refs are looser, so this is a format. */
      ref: text().notNull(),
      label: text(),
      provider: text().notNull().default('supabase'),
      isCentral: boolean('is_central').notNull().default(false),
      /** At most one project is the default binding target of a raw tenant insert (see `bind_default_project`). */
      isDefault: boolean('is_default').notNull().default(false),
      credentialSource: text('credential_source').notNull().default('sealed'),
      credentialVersion: integer('credential_version').notNull().default(1),
      secretKeyId: smallint('secret_key_id'),
      /** Empty string until `ensureProjectZero` (plan 04) fills it from the environment. */
      apiUrl: text('api_url').notNull(),
      publishableKey: text('publishable_key'),
      plan: text(),
      state: text().notNull().default('preparing'),
      hookRef: text('hook_ref'),
      databaseUrlTxSealed: text('database_url_tx_sealed'),
      databaseUrlSessionSealed: text('database_url_session_sealed'),
      ddlUrlSealed: text('ddl_url_sealed'),
      serviceKeySealed: text('service_key_sealed'),
      hookSecretSealed: text('hook_secret_sealed'),
      serviceKeyKind: text('service_key_kind'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check('projects_ref_chk', sql`${t.ref} ~ '^[a-z][a-z0-9-]{2,39}$'`),
      check('projects_provider_chk', sql`${t.provider} ~ '^[a-z]{2,16}$'`),
      check('projects_credential_source_chk', sql`${t.credentialSource} in ('env', 'sealed')`),
      check('projects_env_only_central_chk', sql`${t.credentialSource} <> 'env' or ${t.isCentral}`),
      check('projects_credential_version_chk', sql`${t.credentialVersion} >= 1`),
      check('projects_secret_key_id_chk', sql`${t.secretKeyId} between 1 and 32767`),
      check('projects_api_url_chk', sql`${t.apiUrl} = '' or ${t.apiUrl} ~ '^https?://'`),
      check('projects_state_chk', sql`${t.state} ~ '^[a-z_]{3,20}$'`),
      uniqueIndex('projects_ref_uq').on(t.ref),
      uniqueIndex('projects_hook_ref_uq').on(t.hookRef),
      uniqueIndex('projects_one_central_uq').on(t.isCentral).where(sql`${t.isCentral}`),
      uniqueIndex('projects_one_default_uq').on(t.isDefault).where(sql`${t.isDefault}`),
    ],
  )
  .enableRLS();
