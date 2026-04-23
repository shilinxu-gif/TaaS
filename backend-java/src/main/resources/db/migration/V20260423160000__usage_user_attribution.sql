ALTER TABLE "app_keys" ADD COLUMN IF NOT EXISTS "owner_user_id" TEXT;
CREATE INDEX IF NOT EXISTS "app_keys_owner_user_id_idx" ON "app_keys"("owner_user_id");

ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
CREATE INDEX IF NOT EXISTS "api_request_logs_user_id_created_at_idx"
  ON "api_request_logs"("user_id", "created_at");
