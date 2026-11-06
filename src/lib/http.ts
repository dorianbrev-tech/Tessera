import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "You need to sign in.", "unauthenticated");
  return user;
}

export async function parseJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(400, `${first.path.join(".") || "body"}: ${first.message}`, "invalid_input");
  }
  return parsed.data;
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
function checkOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") {
    if (origin === "null") throw new HttpError(403, "Cross-origin request rejected.");
    return;
  }
  const url = new URL(req.url);
  const allowed = new Set([new URL(env.appUrl).origin, url.origin]);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) allowed.add(`${url.protocol}//${host}`);
  if (!allowed.has(origin)) throw new HttpError(403, "Cross-origin request rejected.");
}

type Ctx<P> = { params: Promise<P> };

export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<Response>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      checkOrigin(req);
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await fn(req, params);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error("[api]", req.method, new URL(req.url).pathname, err);
      return json({ error: "Something went wrong on our side." }, { status: 500 });
    }
  };
}
