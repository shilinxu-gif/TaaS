import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { commercialConfig } from "./config.js";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    keyFromSecret(commercialConfig.providerSecret),
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  const [ivPart, tagPart, dataPart] = ciphertext.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Invalid secret payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFromSecret(commercialConfig.providerSecret),
    Buffer.from(ivPart, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
