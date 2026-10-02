-- KOLs added by X handle before that account has connected.
CREATE TABLE "kol_invite" (
    "handle" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kol_invite_pkey" PRIMARY KEY ("handle")
);
