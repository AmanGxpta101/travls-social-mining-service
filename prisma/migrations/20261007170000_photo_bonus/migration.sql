-- Extra points for posting a challenge with a photo of your own.
ALTER TABLE "share_task" ADD COLUMN "photo_bonus" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "social_share" ADD COLUMN "photo_bonus" INTEGER NOT NULL DEFAULT 0;
