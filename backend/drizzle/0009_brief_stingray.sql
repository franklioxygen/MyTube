CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"credential_public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text,
	"name" text,
	"created_at" text NOT NULL,
	"rp_id" text,
	"origin" text
);
