ALTER TABLE "tenant_members"
ADD COLUMN IF NOT EXISTS "allowed_models" JSONB NOT NULL DEFAULT '[]';
