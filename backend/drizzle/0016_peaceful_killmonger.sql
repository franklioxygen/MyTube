CREATE TABLE "rss_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'visitor' NOT NULL,
	"filters" text DEFAULT '{}' NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" integer,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	CONSTRAINT "rss_tokens_role_check" CHECK("role" IN ('admin', 'visitor'))
);
--> statement-breakpoint
CREATE INDEX "idx_rss_tokens_active" ON "rss_tokens" ("is_active");
--> statement-breakpoint
CREATE INDEX "idx_rss_tokens_created_at" ON "rss_tokens" ("created_at");
