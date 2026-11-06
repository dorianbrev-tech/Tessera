// URL validation and SSRF protection for everything the crawler fetches.
import { lookup } from "node:dns/promises";
import net from "node:net";
import { env } from "@/lib/env";

export class UnsafeUrlError extends Error {}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

const hostCache = new Map<string, Promise<boolean>>();

/** True when the host resolves only to public addresses (or private hosts are allowed). */
export function isAllowedHost(hostname: string): Promise<boolean> {
  if (env.allowPrivateHosts) return Promise.resolve(true);
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return Promise.resolve(false);
  if (net.isIP(h)) return Promise.resolve(!isPrivateIp(h));
  let p = hostCache.get(h);
  if (!p) {
    p = lookup(h, { all: true })
      .then((addrs) => addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address)))
      .catch(() => false);
    hostCache.set(h, p);
    setTimeout(() => hostCache.delete(h), 5 * 60_000).unref?.();
  }
  return p;
}

export function normalizeInputUrl(raw: string): URL {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new UnsafeUrlError(`"${raw}" is not a valid URL`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs can be analysed");
  if (u.username || u.password) throw new UnsafeUrlError("URLs with embedded credentials are not supported");
  u.hash = "";
  return u;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = normalizeInputUrl(raw);
  if (!(await isAllowedHost(u.hostname))) {
    throw new UnsafeUrlError(`${u.hostname} resolves to a private or reserved address and cannot be analysed`);
  }
  return u;
}

/** fetch() with SSRF checks on every redirect hop, a timeout and a size cap. */
export async function safeFetch(
  url: string,
  init: RequestInit & { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ status: number; headers: Headers; body: Buffer; url: string }> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
    try {
      const res = await fetch(current, { ...init, redirect: "manual", signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current).toString();
        continue;
      }
      const max = init.maxBytes ?? 15_000_000;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > max) throw new Error(`Response too large (${len} bytes)`);
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > max) {
            ctrl.abort();
            throw new Error("Response too large");
          }
          chunks.push(value);
        }
      }
      return { status: res.status, headers: res.headers, body: Buffer.concat(chunks), url: current };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}
