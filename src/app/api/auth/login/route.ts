import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { HttpError, json, parseJson, route } from "@/lib/http";
import { authRateLimit } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

// Constant-time-ish failure path: verify against a dummy hash when the user doesn't exist.
const DUMMY = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export const POST = route(async (req) => {
  const body = await parseJson(req, Body);
  authRateLimit(req, "login:" + body.email);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.email));
  const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY);
  if (!user || !ok) throw new HttpError(401, "Incorrect email or password.");
  await createSession(user.id);
  return json({ user: { id: user.id, email: user.email, name: user.name } });
});
