-- CreateEnum
CREATE TYPE "PointsEntryStatus" AS ENUM ('pending', 'synced', 'failed');

-- CreateTable
CREATE TABLE "points_ledger_entry" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "share_id" TEXT,
    "adjustment_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "status" "PointsEntryStatus" NOT NULL DEFAULT 'pending',
    "balance_before" INTEGER,
    "balance_after" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3),

    CONSTRAINT "points_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travls_points_balance" (
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travls_points_balance_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "points_ledger_entry_idempotency_key_key" ON "points_ledger_entry"("idempotency_key");

-- CreateIndex
CREATE INDEX "points_ledger_entry_user_id_created_at_idx" ON "points_ledger_entry"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "points_ledger_entry_status_idx" ON "points_ledger_entry"("status");

