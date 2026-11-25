ALTER TABLE "store_product_communities" ADD COLUMN "can_like" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_product_communities" ADD COLUMN "can_comment" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_product_communities" ADD COLUMN "can_share" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_product_communities" ADD COLUMN "can_post" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_product_communities" ADD COLUMN "can_story" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story_highlights" ADD COLUMN "open_to_buyers" boolean DEFAULT false NOT NULL;