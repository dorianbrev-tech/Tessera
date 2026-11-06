import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "tessera_session";
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const h = await headers();
  await db.insert(schema.sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.secureCookies,
    path: "/",
    expires: expiresAt,
  });
  // Opportunistic cleanup of expired sessions.
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

export type SessionUser = { id: string; email: string; name: string | null };

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hashToken(token);
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Sliding expiry: extend sessions past half their lifetime.
  if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * 86400_000) {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) })
      .where(eq(schema.sessions.id, id));
  }
  return { id: row.id, email: row.email, name: row.name };
});
