-- Add playlist subscription fields to subscriptions table
-- Note: These columns are also added conditionally in initialization.ts as a safety net
-- If this migration fails due to duplicate columns, initialization.ts will ensure they exist
ALTER TABLE subscriptions ADD COLUMN playlist_id text;--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN playlist_title text;--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN subscription_type text DEFAULT 'author';--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN collection_id text;
