-- platform_tenant_apps (13-05, D-605, D-615, D-617, D-539) — the control-plane half of the "App" tab: the
-- non-secret facts of a tenant's native app (`platform.tenant_apps`) and its sealed store credentials, one row
-- per kind (`platform.tenant_app_credentials`). Nothing reads or writes them yet; the platform routes do (plan 09).
--
-- EXPAND-ONLY. Two new tables, nothing dropped, renamed or rewritten, so an OLD API running on the new database
-- ignores them. A tenant with no `tenant_apps` row has no app; both purchase switches default to false (D-617),
-- and no migration, trigger or seed ever sets either to true.
--
-- CENTRAL SET ONLY. `platform.*` is never applied to a tenant's project (`tenant-set-no-platform.test.ts` and
-- `scripts/db-two-databases.sh --assert-no-platform` prove it). No column below can hold a credential, a prefix, a
-- hash, a length or a Key ID in clear; `sealed` holds only an AES-256-GCM value with AAD `<rowId>:<kind>`. Both
-- tables are born with RLS ON and ZERO policies; the closing hardening migration is the next file.
CREATE TABLE "platform"."tenant_app_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sealed" text NOT NULL,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_app_credentials_kind_chk" CHECK ("platform"."tenant_app_credentials"."kind" in ('asc_key', 'play_service_account', 'apns_key', 'ios_distribution', 'android_keystore', 'reviewer_password'))
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_app_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenant_apps" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"bundle_id" text,
	"application_id" text,
	"ids_locked_at" timestamp with time zone,
	"team_id" text,
	"android_sha256" text[] DEFAULT '{}' NOT NULL,
	"purchase_ios" boolean DEFAULT false NOT NULL,
	"purchase_android" boolean DEFAULT false NOT NULL,
	"privacy_url" text,
	"min_version_ios" text,
	"min_version_android" text,
	"store_url_ios" text,
	"store_url_android" text,
	"last_ios_version" text,
	"last_ios_build" integer,
	"last_ios_at" timestamp with time zone,
	"last_android_version" text,
	"last_android_build" integer,
	"last_android_at" timestamp with time zone,
	"manual_apple_account" boolean DEFAULT false NOT NULL,
	"manual_play_account" boolean DEFAULT false NOT NULL,
	"manual_screenshots" boolean DEFAULT false NOT NULL,
	"manual_submitted" boolean DEFAULT false NOT NULL,
	"manual_published" boolean DEFAULT false NOT NULL,
	"reviewer_email" text,
	"reviewer_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_apps_team_id_chk" CHECK ("platform"."tenant_apps"."team_id" is null or "platform"."tenant_apps"."team_id" ~ '^[A-Z0-9]{10}$'),
	CONSTRAINT "tenant_apps_sha256_chk" CHECK (cardinality("platform"."tenant_apps"."android_sha256") <= 10 and array_position("platform"."tenant_apps"."android_sha256", null::text) is null and array_to_string("platform"."tenant_apps"."android_sha256", ',') ~ '^([0-9A-F]{2}(:[0-9A-F]{2}){31}(,[0-9A-F]{2}(:[0-9A-F]{2}){31})*)?$' and cardinality(string_to_array(array_to_string("platform"."tenant_apps"."android_sha256", ','), ',')) = cardinality("platform"."tenant_apps"."android_sha256")),
	CONSTRAINT "tenant_apps_privacy_url_chk" CHECK (("platform"."tenant_apps"."privacy_url" is null or "platform"."tenant_apps"."privacy_url" ~ '^https://.') and ("platform"."tenant_apps"."store_url_ios" is null or "platform"."tenant_apps"."store_url_ios" ~ '^https://.') and ("platform"."tenant_apps"."store_url_android" is null or "platform"."tenant_apps"."store_url_android" ~ '^https://.')),
	CONSTRAINT "tenant_apps_versions_chk" CHECK (("platform"."tenant_apps"."min_version_ios" is null or "platform"."tenant_apps"."min_version_ios" ~ '^[0-9]+[.][0-9]+[.][0-9]+$') and ("platform"."tenant_apps"."min_version_android" is null or "platform"."tenant_apps"."min_version_android" ~ '^[0-9]+[.][0-9]+[.][0-9]+$')),
	CONSTRAINT "tenant_apps_ids_chk" CHECK (("platform"."tenant_apps"."bundle_id" is null or (length("platform"."tenant_apps"."bundle_id") <= 160 and "platform"."tenant_apps"."bundle_id" ~ '^[A-Za-z][A-Za-z0-9-]*([.][A-Za-z][A-Za-z0-9-]*)+$')) and ("platform"."tenant_apps"."application_id" is null or (length("platform"."tenant_apps"."application_id") <= 160 and "platform"."tenant_apps"."application_id" ~ '^[A-Za-z][A-Za-z0-9_]*([.][A-Za-z][A-Za-z0-9_]*)+$'))),
	CONSTRAINT "tenant_apps_ids_locked_chk" CHECK ("platform"."tenant_apps"."ids_locked_at" is null or ("platform"."tenant_apps"."bundle_id" is not null and "platform"."tenant_apps"."application_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_apps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."tenant_app_credentials" ADD CONSTRAINT "tenant_app_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_apps" ADD CONSTRAINT "tenant_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_app_credentials_tenant_kind_uq" ON "platform"."tenant_app_credentials" USING btree ("tenant_id","kind");