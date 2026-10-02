-- Connecting X is now how a user gets their ID, so an in-flight OAuth
-- handshake no longer belongs to a user.
ALTER TABLE "pending_oauth_state" ALTER COLUMN "user_id" DROP NOT NULL;
