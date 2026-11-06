import { json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { duplicateProject } from "@/lib/projects";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const { user } = await ownedProject(id);
  const copy = await duplicateProject(user.id, id);
  return json({ project: copy }, { status: 201 });
});
