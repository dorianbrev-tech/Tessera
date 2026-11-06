// Form submissions from generated sites. Submissions are stored for the project owner.
// Credential-like fields are dropped server-side so generated sites can never be used to
// harvest passwords or card numbers.
import { createHash } from "node:crypto";
import { db, schema } from "@/lib/db";

const SENSITIVE = /(pass(word|wd|code)?|pwd|pin|otp|cvv|cvc|card|cc-?num|ccnum|credit|iban|routing|account.?num|ssn|social.?security|secret|token|2fa|mfa)/i;
const MAX_FIELDS = 40;
const MAX_VALUE = 5000;

const hits = new Map<string, { n: number; t: number }>();
function rateLimited(key: string) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now - e.t > 60_000) {
    hits.set(key, { n: 1, t: now });
    return false;
  }
  e.n++;
  return e.n > 20;
}

/** Drops credential/payment-like fields and internal (_-prefixed) fields. Pure, for testing. */
export function sanitizeFormData(input: Record<string, string>) {
  const data: Record<string, string> = {};
  const stripped: string[] = [];
  let next: string | undefined;
  for (const [k, v] of Object.entries(input)) {
    if (k === "_next") next = v;
    else if (k.startsWith("_")) continue;
    else if (SENSITIVE.test(k)) stripped.push(k);
    else data[k] = v;
  }
  return { data, stripped, next };
}

export async function handleFormSubmission(req: Request, projectId: string, formName: string, pagePath: string | null) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const ipHash = createHash("sha256").update(ip + projectId).digest("hex").slice(0, 16);
  if (rateLimited(ipHash)) return new Response("Too many submissions, please try again later.", { status: 429 });

  const data: Record<string, string> = {};
  const stripped: string[] = [];
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body).slice(0, MAX_FIELDS)) data[k] = String(v).slice(0, MAX_VALUE);
    } else {
      const fd = await req.formData();
      let n = 0;
      for (const [k, v] of fd.entries()) {
        if (n++ >= MAX_FIELDS) break;
        if (typeof v !== "string") continue; // files are not accepted
        data[k] = v.slice(0, MAX_VALUE);
      }
    }
  } catch {
    return new Response("Invalid form submission.", { status: 400 });
  }
  const clean = sanitizeFormData(data);
  stripped.push(...clean.stripped);
  const next = clean.next;
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, clean.data);
  // Honeypot field: silently accept bots without storing.
  if (data.website_url) return thankYou(req, next);

  await db.insert(schema.formSubmissions).values({
    projectId,
    formName: formName.slice(0, 80),
    path: pagePath?.slice(0, 200) ?? null,
    data,
    strippedFields: stripped,
  });
  return thankYou(req, next);
}

function thankYou(req: Request, next?: string) {
  if ((req.headers.get("accept") ?? "").includes("application/json")) return Response.json({ ok: true });
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return new Response(null, { status: 303, headers: { Location: next } });
  }
  const back = req.headers.get("referer");
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#111}main{text-align:center;padding:24px}a{color:inherit}</style><main><h1 style="font-weight:500">Thank you</h1><p>Your message has been received.</p>${back ? `<p><a href="${back.replace(/"/g, "")}">Go back</a></p>` : ""}</main>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
