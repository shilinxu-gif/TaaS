ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "platform_role" TEXT NOT NULL DEFAULT 'user';

ALTER TABLE "tenants"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN "trial_ends_at" TIMESTAMP(3),
  ADD COLUMN "billing_email" TEXT,
  ADD COLUMN "contact_sales_email" TEXT,
  ADD COLUMN "monthly_budget_usd" DECIMAL(12,4),
  ADD COLUMN "spend_cap_enforced" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contract_code" TEXT;

ALTER TABLE "providers"
  ADD COLUMN "provider_type" TEXT NOT NULL DEFAULT 'openai',
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "api_key_ciphertext" TEXT,
  ADD COLUMN "model_catalog" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "rate_limit_qps" INTEGER,
  ADD COLUMN "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
  ADD COLUMN "health_status" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "last_checked_at" TIMESTAMP(3),
  ADD COLUMN "supports_streaming" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "app_keys"
  ADD COLUMN "token_hash" TEXT,
  ADD COLUMN "token_preview" TEXT,
  ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production',
  ADD COLUMN "scopes" JSONB NOT NULL DEFAULT '["chat:complete"]',
  ADD COLUMN "monthly_budget_usd" DECIMAL(12,4),
  ADD COLUMN "last_used_ip" TEXT;

UPDATE "app_keys"
SET
  "token_hash" = COALESCE("token", ''),
  "token_preview" = CASE
    WHEN "token" IS NULL THEN 'sk-migrated'
    WHEN length("token") <= 14 THEN "token"
    ELSE left("token", 10) || '…' || right("token", 4)
  END;

ALTER TABLE "app_keys"
  ALTER COLUMN "token" DROP NOT NULL,
  ALTER COLUMN "token_hash" SET NOT NULL,
  ALTER COLUMN "token_preview" SET NOT NULL;

CREATE UNIQUE INDEX "app_keys_token_hash_key" ON "app_keys"("token_hash");

ALTER TABLE "api_request_logs"
  ADD COLUMN "request_id" TEXT,
  ADD COLUMN "trace_id" TEXT,
  ADD COLUMN "provider_error_code" TEXT,
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "request_source_ip" TEXT;

ALTER TABLE "billing_records"
  ADD COLUMN "subtotal_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN "input_unit_price_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN "output_unit_price_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN "quantity_prompt_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "quantity_completion_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tax_rate_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "tax_amount_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN "reconciliation_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "invoice_status" TEXT NOT NULL DEFAULT 'not_requested';

CREATE TABLE "tenant_routing_strategies" (
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

CREATE UNIQUE INDEX "tenant_routing_strategies_tenant_id_key"
  ON "tenant_routing_strategies"("tenant_id");

ALTER TABLE "tenant_routing_strategies"
  ADD CONSTRAINT "tenant_routing_strategies_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tenant_cache_settings" (
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

CREATE UNIQUE INDEX "tenant_cache_settings_tenant_id_key"
  ON "tenant_cache_settings"("tenant_id");

ALTER TABLE "tenant_cache_settings"
  ADD CONSTRAINT "tenant_cache_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "audit_logs" (
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

CREATE INDEX "audit_logs_tenant_id_created_at_idx"
  ON "audit_logs"("tenant_id", "created_at");

CREATE INDEX "audit_logs_user_id_created_at_idx"
  ON "audit_logs"("user_id", "created_at");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
