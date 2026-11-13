ALTER TABLE "payment_events" DROP CONSTRAINT "payment_events_outcome_chk";--> statement-breakpoint
ALTER TABLE "payment_products" DROP CONSTRAINT "payment_products_kind_chk";--> statement-breakpoint
ALTER TABLE "payment_products" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "event_attendances" ADD COLUMN "origin" text DEFAULT 'rsvp' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_attendances" ADD COLUMN "order_provider" text;--> statement-breakpoint
ALTER TABLE "event_attendances" ADD COLUMN "order_ref" text;--> statement-breakpoint
ALTER TABLE "event_attendances" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ticket_price_cents" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_products_event_uq" ON "payment_products" USING btree ("tenant_id","event_id") WHERE "payment_products"."kind" = 'event';--> statement-breakpoint
CREATE UNIQUE INDEX "event_attendances_order_uq" ON "event_attendances" USING btree ("tenant_id","order_provider","order_ref") WHERE "event_attendances"."order_ref" is not null;--> statement-breakpoint
CREATE INDEX "event_attendances_ticket_idx" ON "event_attendances" USING btree ("tenant_id","event_id") WHERE "event_attendances"."origin" = 'ticket';--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_outcome_chk" CHECK ("payment_events"."outcome" is null or "payment_events"."outcome" in ('access_granted','access_cut','product_granted','product_revoked','stale','no_effect','currency_unsupported','ticket_granted','ticket_granted_over_limit','ticket_revoked','ticket_kept','event_ended','event_cancelled'));--> statement-breakpoint
ALTER TABLE "payment_products" ADD CONSTRAINT "payment_products_event_chk" CHECK (("payment_products"."kind" = 'event') = ("payment_products"."event_id" is not null));--> statement-breakpoint
ALTER TABLE "payment_products" ADD CONSTRAINT "payment_products_kind_chk" CHECK ("payment_products"."kind" in ('access','store_product','event'));--> statement-breakpoint
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_origin_chk" CHECK ("event_attendances"."origin" in ('rsvp','ticket','courtesy'));--> statement-breakpoint
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_order_pair_chk" CHECK (("event_attendances"."order_provider" is null) = ("event_attendances"."order_ref" is null));--> statement-breakpoint
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_order_chk" CHECK (("event_attendances"."origin" = 'ticket') = ("event_attendances"."order_ref" is not null));--> statement-breakpoint
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_order_provider_chk" CHECK ("event_attendances"."order_provider" is null or "event_attendances"."order_provider" ~ '^[a-z][a-z0-9_]{1,30}$');--> statement-breakpoint
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_refunded_chk" CHECK ("event_attendances"."refunded_at" is null or "event_attendances"."origin" = 'ticket');--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_ticket_price_chk" CHECK ("events"."ticket_price_cents" is null or "events"."ticket_price_cents" between 1 and 10000000);