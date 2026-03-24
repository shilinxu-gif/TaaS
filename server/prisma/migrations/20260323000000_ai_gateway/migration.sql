-- AI Gateway demo schema (replaces CRM)

DROP TABLE IF EXISTS "activities" CASCADE;
DROP TABLE IF EXISTS "opportunities" CASCADE;
DROP TABLE IF EXISTS "leads" CASCADE;
DROP TABLE IF EXISTS "contacts" CASCADE;
DROP TABLE IF EXISTS "accounts" CASCADE;
DROP TABLE IF EXISTS "customers" CASCADE;
DROP TABLE IF EXISTS "organization_members" CASCADE;
DROP TABLE IF EXISTS "organizations" CASCADE;

-- plans (before tenants FK)
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "monthly_token_quota" INTEGER NOT NULL,
    "price_per_million_tokens" DECIMAL(10,4) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan_id" TEXT,
    "balance_tokens" DECIMAL(18,2) NOT NULL DEFAULT 500000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

CREATE TABLE "tenant_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_members_user_id_tenant_id_key" ON "tenant_members"("user_id", "tenant_id");

CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "base_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "providers_slug_key" ON "providers"("slug");

CREATE TABLE "app_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_keys_token_key" ON "app_keys"("token");
CREATE INDEX "app_keys_tenant_id_idx" ON "app_keys"("tenant_id");

CREATE TABLE "api_request_logs" (
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
CREATE INDEX "api_request_logs_tenant_id_created_at_idx" ON "api_request_logs"("tenant_id", "created_at");

CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "log_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "usage_records_log_id_key" ON "usage_records"("log_id");
CREATE INDEX "usage_records_tenant_id_period_idx" ON "usage_records"("tenant_id", "period");

CREATE TABLE "billing_records" (
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
CREATE UNIQUE INDEX "billing_records_log_id_key" ON "billing_records"("log_id");
CREATE INDEX "billing_records_tenant_id_created_at_idx" ON "billing_records"("tenant_id", "created_at");

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_keys" ADD CONSTRAINT "app_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_app_key_id_fkey" FOREIGN KEY ("app_key_id") REFERENCES "app_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "api_request_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "api_request_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
