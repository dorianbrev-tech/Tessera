import { HttpError, requireUser, route } from "@/lib/http";
import { getOwnedProject } from "@/lib/projects";
import { storage } from "@/lib/storage";
import { mimeFromPath } from "@/lib/mime";

/** Serves stored objects (screenshots, crops, uploads, renders) to the project owner. */
export const GET = route<{ key: string[] }>(async (_req, { key }) => {
  const user = await requireUser();
  const path = key.map(decodeURIComponent).join("/");
  const m = path.match(/^projects\/([0-9a-f-]{36})\//i);
  if (!m || path.includes("..")) throw new HttpError(404, "Not found.");
  await getOwnedProject(user.id, m[1]).catch(() => {
    throw new HttpError(404, "Not found.");
  });
  const data = await storage().get(path);
  if (!data) throw new HttpError(404, "Not found.");
  return new Response(new Uint8Array(data), {
    headers: { "content-type": mimeFromPath(path), "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
});
