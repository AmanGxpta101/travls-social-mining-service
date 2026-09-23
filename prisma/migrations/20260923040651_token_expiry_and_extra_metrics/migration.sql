-- AlterTable
ALTER TABLE "engagement_snapshot" ADD COLUMN     "bookmark_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "impression_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_social_account" ADD COLUMN     "access_token_expires_at" TIMESTAMP(3);
