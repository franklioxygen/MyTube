/* tsqllint-disable */
ALTER TABLE "subscriptions" ADD COLUMN "channel_name" text;
--> statement-breakpoint
UPDATE "subscriptions"
SET "channel_name" = substr("author", length("playlist_title") + 4)
WHERE "subscription_type" = 'playlist'
  AND ("channel_name" IS NULL OR "channel_name" = '')
  AND "playlist_title" IS NOT NULL
  AND "playlist_title" != ''
  AND substr("author", 1, length("playlist_title") + 3) = "playlist_title" || ' - ';
