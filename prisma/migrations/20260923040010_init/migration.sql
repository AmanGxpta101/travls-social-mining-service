-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('pending_confirmation', 'confirmed', 'deleted');

-- CreateTable
CREATE TABLE "user_social_account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'x',
    "external_user_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "token_status" "TokenStatus" NOT NULL DEFAULT 'active',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_social_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_share" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "external_post_id" TEXT,
    "copy_variant" TEXT NOT NULL DEFAULT 'v1_static',
    "post_status" "PostStatus" NOT NULL DEFAULT 'pending_confirmation',
    "shared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_snapshot" (
    "id" TEXT NOT NULL,
    "share_id" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "retweets" INTEGER NOT NULL DEFAULT 0,
    "quote_count" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_oauth_state" (
    "state" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_oauth_state_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "reward_threshold" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "min_value" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reward_threshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_credit" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "share_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "issued_by" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_credit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_social_account_user_id_platform_key" ON "user_social_account"("user_id", "platform");

-- AddForeignKey
ALTER TABLE "engagement_snapshot" ADD CONSTRAINT "engagement_snapshot_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "social_share"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_credit" ADD CONSTRAINT "manual_credit_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "social_share"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
