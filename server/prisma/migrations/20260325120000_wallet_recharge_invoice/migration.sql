-- CreateTable
CREATE TABLE "wallet_recharge_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "amount_cny" DECIMAL(12,2) NOT NULL,
    "pay_channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "credited_tokens" DECIMAL(18,2) NOT NULL,
    "remark" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_recharge_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "request_no" TEXT NOT NULL,
    "title_type" TEXT NOT NULL,
    "invoice_type" TEXT NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "buyer_tax_no" TEXT NOT NULL,
    "buyer_address_phone" TEXT,
    "buyer_bank_account" TEXT,
    "amount_cny" DECIMAL(12,2) NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "invoice_no" TEXT,
    "invoice_code" TEXT,
    "pdf_url" TEXT,
    "reject_reason" TEXT,
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_recharge_orders_order_no_key" ON "wallet_recharge_orders"("order_no");

-- CreateIndex
CREATE INDEX "wallet_recharge_orders_tenant_id_created_at_idx" ON "wallet_recharge_orders"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_requests_request_no_key" ON "invoice_requests"("request_no");

-- CreateIndex
CREATE INDEX "invoice_requests_tenant_id_created_at_idx" ON "invoice_requests"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "wallet_recharge_orders" ADD CONSTRAINT "wallet_recharge_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
