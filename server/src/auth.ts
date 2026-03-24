import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-change-me";

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

export type AuthedRequest = FastifyRequest & { userId: string; tenantId: string };

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
  } catch {
    reply.status(401).send({ error: "Unauthorized" });
  }
}
