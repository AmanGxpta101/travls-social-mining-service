-- Log of every call to the Travls points API, for verifying the integration.
CREATE TABLE "travls_api_call" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "user_id" TEXT,
    "request_headers" JSONB NOT NULL,
    "request_body" TEXT,
    "status" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "duration_ms" INTEGER NOT NULL,

    CONSTRAINT "travls_api_call_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "travls_api_call_at_idx" ON "travls_api_call"("at");
CREATE INDEX "travls_api_call_user_id_at_idx" ON "travls_api_call"("user_id", "at");
