import { json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { createPreviewToken } from "@/lib/tokens";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const { user } = await ownedProject(id);
  const token = createPreviewToken(id, user.id);
  return json({ previewBase: `/preview/${token}` });
});
