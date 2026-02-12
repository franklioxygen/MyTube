-- Add channel_url column to videos table
-- Note: SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- This migration assumes the column doesn't exist yet
ALTER TABLE "videos" ADD "channel_url" text;