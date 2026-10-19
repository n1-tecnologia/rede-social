CREATE TABLE "email_allowlist" (
	"email" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'liberado' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_allowlist_status_chk" CHECK ("email_allowlist"."status" in ('liberado','bloqueado')),
	CONSTRAINT "email_allowlist_email_lower_chk" CHECK ("email_allowlist"."email" = lower(btrim("email_allowlist"."email")))
);
--> statement-breakpoint
ALTER TABLE "email_allowlist" ENABLE ROW LEVEL SECURITY;