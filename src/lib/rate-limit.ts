import { HttpError } from "@/lib/http";

// Simple fixed-window limiter for authentication endpoints (per process).
const buckets = new Map<string, { count: number; reset: number }>();

export function authRateLimit(req: Request, key: string, limit = 10, windowMs = 10 * 60_000) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const k = `${ip}:${key}`;
  const now = Date.now();
  const b = buckets.get(k);
  if (!b || b.reset < now) {
    buckets.set(k, { count: 1, reset: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > limit) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
}
