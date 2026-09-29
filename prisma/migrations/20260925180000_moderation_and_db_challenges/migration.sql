-- AlterEnum
ALTER TYPE "PostStatus" ADD VALUE 'invalidated';

-- AlterTable
ALTER TABLE "social_share" ADD COLUMN     "invalidated_at" TIMESTAMP(3),
ADD COLUMN     "invalidated_by" TEXT,
ADD COLUMN     "invalidated_reason" TEXT;

-- CreateTable
CREATE TABLE "share_task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_block" (
    "user_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blocked_by" TEXT NOT NULL,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_block_pkey" PRIMARY KEY ("user_id","task_id")
);

-- CreateTable
CREATE TABLE "points_adjustment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "share_id" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "issued_by" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "points_adjustment_user_id_idx" ON "points_adjustment"("user_id");

