import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** Stale node_modules/.prisma after schema change → delegates missing → runtime `.findMany` on undefined */
const delegates = prisma as unknown as Record<string, unknown>;
const requiredDelegates = [
  "tenantMember",
  "walletRechargeOrder",
  "invoiceRequest",
  "tenantRoutingStrategy",
  "tenantCacheSettings",
  "auditLog",
] as const;
for (const name of requiredDelegates) {
  const d = delegates[name];
  if (typeof d !== "object" || d == null) {
    throw new Error(
      `Prisma Client is out of sync with schema (missing ${name}). In server/: use Node >= 20, run \`npm install\` then \`npx prisma generate\`, then restart the API.`
    );
  }
}
