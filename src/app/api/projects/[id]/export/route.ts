import { HttpError, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";
import { buildExportZip, currentFiles, slugify } from "@/lib/export";
import { getVersion, NotFoundError } from "@/lib/projects";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const { project } = await ownedProject(id);
  const versionId = new URL(req.url).searchParams.get("version");
  let files;
  let suffix = "";
  if (versionId) {
    try {
      const v = await getVersion(id, versionId);
      files = v.files;
      suffix = `-v${v.number}`;
    } catch (e) {
      if (e instanceof NotFoundError) throw new HttpError(404, "Version not found.");
      throw e;
    }
  } else files = await currentFiles(id);
  if (!files.length) throw new HttpError(400, "This project has no files to export yet.");
  const zip = await buildExportZip(id, files, project.name);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${slugify(project.name)}${suffix}.zip"`,
      "cache-control": "no-store",
    },
  });
});
