import { HttpError, json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { getVersion, NotFoundError } from "@/lib/projects";

export const GET = route<{ id: string; vid: string }>(async (_req, { id, vid }) => {
  await ownedProject(id);
  try {
    const v = await getVersion(id, vid);
    return json({ version: { ...v, files: v.files.map((f) => ({ path: f.path, size: f.size, mime: f.mime })) } });
  } catch (e) {
    if (e instanceof NotFoundError) throw new HttpError(404, "Version not found.");
    throw e;
  }
});
