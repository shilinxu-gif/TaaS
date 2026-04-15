import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

type AuditLogInput = {
  tenantId?: string | null;
  userId?: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        ip: input.ip ?? null,
        metadata: input.metadata,
      },
    });
  } catch {
    // 审计失败不应阻断主流程。
  }
}
