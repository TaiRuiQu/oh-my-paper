import "server-only";
import { AppError } from "@/server/errors";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const secret = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!secret || secret.length < 32 || secret.startsWith("REPLACE_")) {
    throw new AppError(
      "PROVIDER_KEY_ENCRYPTION_KEY 必须配置至少 32 字符的随机密钥。",
      "ENCRYPTION_CONFIG",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptApiKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptApiKey(value: string) {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra)
    throw new AppError("保存的 AI 密钥格式无效，请重新保存 API key。", "CREDENTIAL_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError(
      "无法解密保存的 AI 密钥，请检查 Web 与 Worker 的加密密钥是否一致，或重新保存 API key。",
      "CREDENTIAL_DECRYPT",
      503,
      { cause },
    );
  }
}
