import { getCurrentUser } from "@/lib/auth/session";
import { json, route } from "@/lib/http";
import { capabilities } from "@/lib/env";

export const GET = route(async () => {
  const user = await getCurrentUser();
  return json({ user, capabilities: capabilities() });
});
