import { APP_CREDENTIAL_KINDS } from '@rede-social/contracts/native';
import { sql } from 'drizzle-orm';
import { boolean, check, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '../schema/tenants';
import { platform } from './projects';

/**
 * Phase 13-05 (D-605, D-615, D-617, D-539): the control-plane half of the platform panel's "App" tab. CENTRAL
 * SET ONLY, like everything in the `platform` schema: `supabase/central/migrations` creates both tables, the
 * runner applies them with the central ledger, and they never reach a tenant's project
 * (`scripts/db-two-databases.sh --assert-no-platform` proves it).
 *
 * Both tables are born with RLS on and ZERO policies, deliberately. No tenant lane may read them, because
 * `tenant_app_credentials` holds the store credentials of every tenant. Only `service_role` (reached by
 * `set local role service_role` in the platform lane) reads and writes, and the closing hardening migration
 * revokes every privilege from `anon`, `authenticated` and the bare `api_user`. Adding a policy for
 * `authenticated` to either table is always a bug (SCHEMA-CONVENTIONS (i)).
 *
 * No column of either table holds a credential, a prefix, a hash, a length or a Key ID in clear. The sealed
 * value (`v1:<keyId>:<iv>:<tag>:<ciphertext>`, AES-256-GCM, AAD `<rowId>:<kind>`) is the only place a secret
 * exists; the Key ID and Issuer ID of an App Store Connect key travel INSIDE it (UI-D-628).
 */

/**
 * The credentials the platform GENERATES itself (NATIVE-27), beside the three the operator ENTERS
 * (`APP_CREDENTIAL_KINDS`). A new kind needs no migration for the layout, only a new value here and in the
 * CHECK of the next migration (the credential-per-row layout, D-605).
 */
export const GENERATED_CREDENTIAL_KINDS = [
  'ios_distribution',
  'android_keystore',
  'reviewer_password',
] as const;

/** Every kind a `tenant_app_credentials` row may carry: the entered three, then the generated three. */
export const ALL_CREDENTIAL_KINDS = [
  ...APP_CREDENTIAL_KINDS,
  ...GENERATED_CREDENTIAL_KINDS,
] as const;
export type AppCredentialRowKind = (typeof ALL_CREDENTIAL_KINDS)[number];

/** `sql` list literal for the kind CHECK, built from the constants so the code and the migration cannot drift. */
const kindList = sql.raw(ALL_CREDENTIAL_KINDS.map((kind) => `'${kind}'`).join(', '));

/**
 * One row per tenant that has started an app; a tenant with NO row is a tenant with no app (the state `none`).
 * The NON-secret facts only: the store ids and the lock on them, the Apple Team ID, the Android signing
 * fingerprints, the two purchase switches, the privacy URL, the minimum versions and store links, the last
 * build per store, the five manual checklist flags and the reviewer account.
 *
 * D-617 (`reversible`): `purchase_ios` and `purchase_android` are `boolean not null default false`. The first
 * value in the App tab is OFF in both stores and a missing row also reads as OFF (fail closed); no migration,
 * trigger or seed ever sets either to true.
 *
 * `ids_locked_at` can be set only once both ids exist (`tenant_apps_ids_locked_chk`). `reviewer_user_id` is
 * a plain uuid with no foreign key: the reviewer is a user of the tenant's own project, which may be another
 * database than this one.
 */
export const tenantApps = platform
  .table(
    'tenant_apps',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      bundleId: text('bundle_id'),
      applicationId: text('application_id'),
      idsLockedAt: timestamp('ids_locked_at', { withTimezone: true }),
      teamId: text('team_id'),
      androidSha256: text('android_sha256').array().notNull().default(sql`'{}'`),
      purchaseIos: boolean('purchase_ios').notNull().default(false),
      purchaseAndroid: boolean('purchase_android').notNull().default(false),
      privacyUrl: text('privacy_url'),
      minVersionIos: text('min_version_ios'),
      minVersionAndroid: text('min_version_android'),
      storeUrlIos: text('store_url_ios'),
      storeUrlAndroid: text('store_url_android'),
      lastIosVersion: text('last_ios_version'),
      lastIosBuild: integer('last_ios_build'),
      lastIosAt: timestamp('last_ios_at', { withTimezone: true }),
      lastAndroidVersion: text('last_android_version'),
      lastAndroidBuild: integer('last_android_build'),
      lastAndroidAt: timestamp('last_android_at', { withTimezone: true }),
      manualAppleAccount: boolean('manual_apple_account').notNull().default(false),
      manualPlayAccount: boolean('manual_play_account').notNull().default(false),
      manualScreenshots: boolean('manual_screenshots').notNull().default(false),
      manualSubmitted: boolean('manual_submitted').notNull().default(false),
      manualPublished: boolean('manual_published').notNull().default(false),
      reviewerEmail: text('reviewer_email'),
      reviewerUserId: uuid('reviewer_user_id'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check('tenant_apps_team_id_chk', sql`${t.teamId} is null or ${t.teamId} ~ '^[A-Z0-9]{10}$'`),
      check(
        'tenant_apps_sha256_chk',
        sql`cardinality(${t.androidSha256}) <= 10 and array_position(${t.androidSha256}, null::text) is null and array_to_string(${t.androidSha256}, ',') ~ '^([0-9A-F]{2}(:[0-9A-F]{2}){31}(,[0-9A-F]{2}(:[0-9A-F]{2}){31})*)?$' and cardinality(string_to_array(array_to_string(${t.androidSha256}, ','), ',')) = cardinality(${t.androidSha256})`,
      ),
      check(
        'tenant_apps_privacy_url_chk',
        sql`(${t.privacyUrl} is null or ${t.privacyUrl} ~ '^https://.') and (${t.storeUrlIos} is null or ${t.storeUrlIos} ~ '^https://.') and (${t.storeUrlAndroid} is null or ${t.storeUrlAndroid} ~ '^https://.')`,
      ),
      check(
        'tenant_apps_versions_chk',
        sql`(${t.minVersionIos} is null or ${t.minVersionIos} ~ '^[0-9]+[.][0-9]+[.][0-9]+$') and (${t.minVersionAndroid} is null or ${t.minVersionAndroid} ~ '^[0-9]+[.][0-9]+[.][0-9]+$')`,
      ),
      check(
        'tenant_apps_ids_chk',
        sql`(${t.bundleId} is null or (length(${t.bundleId}) <= 160 and ${t.bundleId} ~ '^[A-Za-z][A-Za-z0-9-]*([.][A-Za-z][A-Za-z0-9-]*)+$')) and (${t.applicationId} is null or (length(${t.applicationId}) <= 160 and ${t.applicationId} ~ '^[A-Za-z][A-Za-z0-9_]*([.][A-Za-z][A-Za-z0-9_]*)+$'))`,
      ),
      check(
        'tenant_apps_ids_locked_chk',
        sql`${t.idsLockedAt} is null or (${t.bundleId} is not null and ${t.applicationId} is not null)`,
      ),
    ],
  )
  .enableRLS();

/**
 * One SEALED credential per row (D-605, D-539, `costly`): `(tenant_id, kind)` is unique, so a new kind needs no
 * migration, a replace is `update ... where tenant_id = $1 and kind = $2` that keeps the row `id` (the sealed
 * AAD is `<id>:<kind>`, so the value stays readable), and two sessions replacing the same pair leave exactly
 * one row. Whether a credential is held is the presence of the row (`held_at`); the value never leaves the
 * server. The row cascades away with its tenant, so there is never an orphan credential.
 */
export const tenantAppCredentials = platform
  .table(
    'tenant_app_credentials',
    {
      id: uuid().primaryKey().defaultRandom(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      kind: text('kind').notNull(),
      sealed: text('sealed').notNull(),
      heldAt: timestamp('held_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check('tenant_app_credentials_kind_chk', sql`${t.kind} in (${kindList})`),
      uniqueIndex('tenant_app_credentials_tenant_kind_uq').on(t.tenantId, t.kind),
    ],
  )
  .enableRLS();
