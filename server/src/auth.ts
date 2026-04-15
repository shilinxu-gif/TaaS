import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { authConfig, isProductionLike } from "./config.js";

const JWT_SECRET = authConfig.jwtSecret;

export type TenantRole =
  | "owner"
  | "admin"
  | "billing"
  | "developer"
  | "viewer";

if (isProductionLike() && authConfig.isWeakJwtSecret) {
  throw new Error("JWT_SECRET must be configured for staging/production");
}

export type JwtPayload = {
  sub: string;
  tenantId: string;
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
  if (!decoded?.sub || !decoded?.tenantId) {
    throw new Error("Invalid token");
  }
  return decoded;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type AuthedRequest = FastifyRequest & {
  userId: string;
  tenantId: string;
  role: TenantRole;
};

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Unauthorized" });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (token.startsWith("sk-demo-") || token.startsWith("sk-")) {
    reply.status(401).send({
      error: "Use JWT for console API; AppKey is only for POST /v1/chat/completions",
    });
    return;
  }
  try {
    const { sub, tenantId } = verifyToken(token);
    const member = await prisma.tenantMember.findFirst({
      where: { userId: sub, tenantId },
    });
    if (!member) {
      reply.status(401).send({ error: "Unauthorized" });
      return;
    }
    (request as AuthedRequest).userId = sub;
    (request as AuthedRequest).tenantId = tenantId;
    (request as AuthedRequest).role = (member.role as TenantRole) ?? "viewer";
  } catch {
    reply.status(401).send({ error: "Unauthorized" });
  }
}

export function requireTenantRole(
  request: FastifyRequest,
  reply: FastifyReply,
  allowed: TenantRole[]
): boolean {
  const role = (request as AuthedRequest).role;
  if (!allowed.includes(role)) {
    reply.status(403).send({ error: "Forbidden" });
    return false;
  }
  return true;
}
