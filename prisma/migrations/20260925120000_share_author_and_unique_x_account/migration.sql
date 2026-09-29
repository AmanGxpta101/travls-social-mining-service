-- AlterTable
ALTER TABLE "social_share" ADD COLUMN     "author_handle" TEXT,
ADD COLUMN     "author_x_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_social_account_platform_external_user_id_key" ON "user_social_account"("platform", "external_user_id");

