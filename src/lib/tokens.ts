// Signed, expiring tokens for preview URLs. The preview is served from a path that
// carries the token (/preview/<token>/...), so relative links inside generated sites
// keep working and no cookie is needed inside the sandboxed iframe.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

type PreviewClaims = { p: string; u: string; e: number };

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (data: string) => createHmac("sha256", env.sessionSecret).update(data).digest("base64url").slice(0, 32);

export function createPreviewToken(projectId: string, userId: string, ttlSeconds = 12 * 3600) {
  const payload = b64(JSON.stringify({ p: projectId, u: userId, e: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${payload}.${sign("preview:" + payload)}`;
}

export function verifyPreviewToken(token: string): PreviewClaims | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign("preview:" + payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as PreviewClaims;
    if (claims.e < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}
