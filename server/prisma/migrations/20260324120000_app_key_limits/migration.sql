-- AppKey metadata: description, QPS, daily budget, model allowlist
ALTER TABLE "app_keys" ADD COLUMN "description" TEXT;
ALTER TABLE "app_keys" ADD COLUMN "qps_limit" INTEGER;
ALTER TABLE "app_keys" ADD COLUMN "daily_budget_usd" DECIMAL(12,4);
ALTER TABLE "app_keys" ADD COLUMN "allowed_models" JSONB NOT NULL DEFAULT '[]';
