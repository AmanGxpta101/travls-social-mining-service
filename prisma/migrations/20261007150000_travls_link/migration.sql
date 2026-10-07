-- Our userId stays put; the Travls user id is a link next to it.
ALTER TABLE "user_social_account" ADD COLUMN "travls_user_id" TEXT;
ALTER TABLE "user_social_account" ADD COLUMN "travls_linked_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "user_social_account_travls_user_id_key" ON "user_social_account"("travls_user_id");

-- Accounts connected while the session was a Travls token have a Travls id
-- (a 24-hex Mongo ObjectId) as their userId: they're already linked.
UPDATE "user_social_account"
SET "travls_user_id" = "user_id", "travls_linked_at" = "connected_at"
WHERE "user_id" ~ '^[0-9a-f]{24}$';

-- Changes that only ever reached the in-memory simulator never reached
-- Travls: hold them again so they're pushed once the user links.
UPDATE "points_ledger_entry"
SET "status" = 'pending', "attempts" = 0, "balance_before" = NULL, "balance_after" = NULL,
    "synced_at" = NULL, "last_error" = NULL
WHERE "simulated" = true;
ALTER TABLE "points_ledger_entry" DROP COLUMN "simulated";

CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);
