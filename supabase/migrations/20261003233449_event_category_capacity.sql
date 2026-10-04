ALTER TABLE "events" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_chk" CHECK ("events"."category" is null or (length(btrim("events"."category")) between 1 and 40));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_capacity_chk" CHECK ("events"."capacity" is null or "events"."capacity" between 1 and 100000);