CREATE TABLE "platform"."payment_integration_routes" (
	"integration_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_integration_routes_provider_chk" CHECK ("platform"."payment_integration_routes"."provider" ~ '^[a-z][a-z0-9_]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "platform"."payment_integration_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."payment_product_routes" (
	"provider" text NOT NULL,
	"external_product_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_product_routes_pk" PRIMARY KEY("provider","external_product_id"),
	CONSTRAINT "payment_product_routes_provider_chk" CHECK ("platform"."payment_product_routes"."provider" ~ '^[a-z][a-z0-9_]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "platform"."payment_product_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."video_asset_routes" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_asset_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."video_asset_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."payment_integration_routes" ADD CONSTRAINT "payment_integration_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."payment_product_routes" ADD CONSTRAINT "payment_product_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."video_asset_routes" ADD CONSTRAINT "video_asset_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_integration_routes_tenant_idx" ON "platform"."payment_integration_routes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_product_routes_tenant_idx" ON "platform"."payment_product_routes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_asset_routes_provider_asset_uq" ON "platform"."video_asset_routes" USING btree ("provider_asset_id") WHERE "platform"."video_asset_routes"."provider_asset_id" is not null;--> statement-breakpoint
CREATE INDEX "video_asset_routes_tenant_idx" ON "platform"."video_asset_routes" USING btree ("tenant_id");