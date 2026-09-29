-- CreateEnum
CREATE TYPE "ShareTier" AS ENUM ('kol', 'community');

-- AlterTable
ALTER TABLE "social_share" ADD COLUMN     "ref_code" TEXT,
ADD COLUMN     "tier" "ShareTier" NOT NULL DEFAULT 'kol';

-- AlterTable
ALTER TABLE "reward_threshold" ADD COLUMN     "tier" "ShareTier" NOT NULL DEFAULT 'kol';

-- CreateTable
CREATE TABLE "kol_allowlist" (
    "user_id" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kol_allowlist_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_share_external_post_id_key" ON "social_share"("external_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_share_ref_code_key" ON "social_share"("ref_code");

-- CreateIndex
CREATE UNIQUE INDEX "reward_threshold_metric_tier_key" ON "reward_threshold"("metric", "tier");

