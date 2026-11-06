import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { HttpError, json, parseJson, route } from "@/lib/http";
import { authRateLimit } from "@/lib/rate-limit";

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
});

export const POST = route(async (req) => {
  authRateLimit(req, "signup");
  const body = await parseJson(req, Body);
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, body.email));
  if (existing) throw new HttpError(409, "An account with this email already exists.");
  const [user] = await db
    .insert(schema.users)
    .values({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password) })
    .returning({ id: schema.users.id, email: schema.users.email, name: schema.users.name });
  await createSession(user.id);
  return json({ user });
});
