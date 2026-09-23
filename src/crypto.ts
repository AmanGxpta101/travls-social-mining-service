import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

// AES-256-GCM fallback per plan §6, "if neither [KMS] is set up".
// Swap for AWS/GCP KMS calls behind this same interface once the org's KMS is confirmed.

function key(): Buffer {
  const raw = env.tokenEncryptionKey;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  return Buffer.from(raw, "base64").subarray(0, 32);
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptToken(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
