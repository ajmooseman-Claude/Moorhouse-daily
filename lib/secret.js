// Encrypts mailbox passwords and tokens before they're stored (AES-256-GCM, key derived from SESSION_SECRET).
import crypto from "node:crypto";

function key() {
  const s = process.env.MAIL_SECRET || process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return crypto.createHash("sha256").update("moorhouse-mail:" + s).digest();
}
export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
export function open(sealed) {
  const [iv, tag, data] = String(sealed).split(".").map((s) => Buffer.from(s, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
}
