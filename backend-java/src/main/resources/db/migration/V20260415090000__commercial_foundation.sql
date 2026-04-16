ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platform_role" TEXT NOT NULL DEFAULT 'user';

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_email" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "contact_sales_email" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "monthly_budget_usd" DECIMAL(12,4);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "spend_cap_enforced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "contract_code" TEXT;

ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "provider_type" TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "api_key_ciphertext" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "model_catalog" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "rate_limit_qps" INTEGER;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "timeout_ms" INTEGER NOT NULL DEFAULT 30000;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_status" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_checked_at" TIMESTAMP(3);
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "supports_streaming" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "app_keys" ADD COLUMN IF NOT EXISTS "token_hash" TEXT;
ALTER TABLE "app_keys" ADD COLUMN IF NOT EXISTS "token_preview" TEXT;
ALTER TABLE "app_keys" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "app_keys" ADD COLUMN IF NOT EXISTS "scopes" JSONB NOT NULL DEFAULT '["chat:complete"]';
ALTER TABLE "app_keys" ADD COLUMN IF NOT EXISTS "monthly_budget_usd" DECIMAL(12,4);
ALTER TABLE "app_keys" ADD COLUMN IF NOT EXISTS "last_used_ip" TEXT;
UPDATE "app_keys"
SET "token_hash" = COALESCE("token_hash", COALESCE("token", '')),
    "token_preview" = COALESCE("token_preview", CASE
      WHEN "token" IS NULL THEN 'sk-migrated'
      WHEN length("token") <= 14 THEN "token"
      ELSE left("token", 10) || '…' || right("token", 4)
    END)
WHERE "token_hash" IS NULL OR "token_preview" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "app_keys_token_hash_key" ON "app_keys"("token_hash");

ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "request_id" TEXT;
ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "trace_id" TEXT;
ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "provider_error_code" TEXT;
ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "request_source_ip" TEXT;

ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "subtotal_usd" DECIMAL(12,6) NOT NULL DEFAULT 0;
ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "input_unit_price_usd" DECIMAL(12,6) NOT NULL DEFAULT 0;
ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "output_unit_price_usd" DECIMAL(12,6) NOT NULL DEFAULT 0;
ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "quantity_prompt_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "quantity_completion_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "tax_rate_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "tax_amount_usd" DECIMAL(12,6) NOT NULL DEFAULT 0;
ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "reconciliation_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "billing_records" ADD COLUMN IF NOT EXISTS "invoice_status" TEXT NOT NULL DEFAULT 'not_requested';

CREATE TABLE IF NOT EXISTS "tenant_routing_strategies" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'balance',
  "primary_provider_type" TEXT,
  "fallback_provider_types" JSONB NOT NULL DEFAULT '[]',
  "max_retries" INTEGER NOT NULL DEFAULT 1,
  "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_routing_strategies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_routing_strategies_tenant_id_key" ON "tenant_routing_strategies"("tenant_id");

CREATE TABLE IF NOT EXISTS "tenant_cache_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "mode" TEXT NOT NULL DEFAULT 'semantic',
  "similarity_threshold" DECIMAL(4,3) NOT NULL DEFAULT 0.920,
  "ttl_seconds" INTEGER NOT NULL DEFAULT 86400,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_cache_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_cache_settings_tenant_id_key" ON "tenant_cache_settings"("tenant_id");

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "user_id" TEXT,
  "actor_type" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "ip" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");
