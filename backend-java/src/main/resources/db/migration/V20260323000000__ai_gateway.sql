-- AI Gateway schema (replaces CRM)
DROP TABLE IF EXISTS "activities" CASCADE;
DROP TABLE IF EXISTS "opportunities" CASCADE;
DROP TABLE IF EXISTS "leads" CASCADE;
DROP TABLE IF EXISTS "contacts" CASCADE;
DROP TABLE IF EXISTS "accounts" CASCADE;
DROP TABLE IF EXISTS "customers" CASCADE;
DROP TABLE IF EXISTS "organization_members" CASCADE;
DROP TABLE IF EXISTS "organizations" CASCADE;

CREATE TABLE IF NOT EXISTS "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "monthly_token_quota" INTEGER NOT NULL,
    "price_per_million_tokens" DECIMAL(10,4) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plans_code_key" ON "plans"("code");

CREATE TABLE IF NOT EXISTS "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan_id" TEXT,
    "balance_tokens" DECIMAL(18,2) NOT NULL DEFAULT 500000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");

CREATE TABLE IF NOT EXISTS "tenant_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_members_user_id_tenant_id_key" ON "tenant_members"("user_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "base_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "providers_slug_key" ON "providers"("slug");

CREATE TABLE IF NOT EXISTS "app_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "app_keys_token_key" ON "app_keys"("token");
CREATE INDEX IF NOT EXISTS "app_keys_tenant_id_idx" ON "app_keys"("tenant_id");

CREATE TABLE IF NOT EXISTS "api_request_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_key_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "routing_primary" TEXT,
    "routing_actual" TEXT,
    "routing_reason" TEXT,
    "status_code" INTEGER NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "api_request_logs_tenant_id_created_at_idx" ON "api_request_logs"("tenant_id", "created_at");

CREATE TABLE IF NOT EXISTS "usage_records" (
    "id" TEXT NOT NULL,
    "log_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "usage_records_log_id_key" ON "usage_records"("log_id");
CREATE INDEX IF NOT EXISTS "usage_records_tenant_id_period_idx" ON "usage_records"("tenant_id", "period");

CREATE TABLE IF NOT EXISTS "billing_records" (
    "id" TEXT NOT NULL,
    "log_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "amount_usd" DECIMAL(12,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "type" TEXT NOT NULL DEFAULT 'usage',
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_records_log_id_key" ON "billing_records"("log_id");
CREATE INDEX IF NOT EXISTS "billing_records_tenant_id_created_at_idx" ON "billing_records"("tenant_id", "created_at");
