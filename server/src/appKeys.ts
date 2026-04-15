import { createHash, randomBytes } from "node:crypto";
import { commercialConfig } from "./config.js";

export type AppKeyScope =
  | "chat:complete"
  | "usage:read"
  | "billing:read"
  | "admin:ops";

export type AppKeyEnvironment =
  | "production"
  | "staging"
  | "development"
  | "sandbox";

export function hashAppKey(token: string): string {
  return createHash("sha256")
    .update(`${commercialConfig.appKeyPepper}:${token}`)
    .digest("hex");
}

export function generateAppKeyToken(): string {
  return `sk-live-${randomBytes(24).toString("hex")}`;
}

export function buildAppKeyPreview(token: string): string {
  const head = token.slice(0, 10);
  const tail = token.slice(-4);
  return `${head}…${tail}`;
}

export function normalizeScopes(raw: unknown): AppKeyScope[] {
  if (!Array.isArray(raw)) return ["chat:complete"];
  const allowed = new Set<AppKeyScope>([
    "chat:complete",
    "usage:read",
    "billing:read",
    "admin:ops",
  ]);
  const picked = raw.filter(
    (item): item is AppKeyScope =>
      typeof item === "string" && allowed.has(item as AppKeyScope)
  );
  return picked.length > 0 ? picked : ["chat:complete"];
}
