-- AlterTable
ALTER TABLE "points_ledger_entry" ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- Everything synced so far went to the in-memory stand-in (no LEDGER_API_URL yet).
UPDATE "points_ledger_entry" SET "simulated" = true WHERE "status" = 'synced';
