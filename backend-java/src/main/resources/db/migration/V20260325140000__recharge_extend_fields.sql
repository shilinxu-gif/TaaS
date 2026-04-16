ALTER TABLE "wallet_recharge_orders" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE "wallet_recharge_orders" ADD COLUMN IF NOT EXISTS "payer_name" TEXT;
ALTER TABLE "wallet_recharge_orders" ADD COLUMN IF NOT EXISTS "need_invoice" BOOLEAN NOT NULL DEFAULT false;
UPDATE "wallet_recharge_orders" SET "status" = 'pending_payment' WHERE "status" IN ('pending', 'processing');
ALTER TABLE "wallet_recharge_orders" ALTER COLUMN "status" SET DEFAULT 'pending_payment';
