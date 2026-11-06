import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { json, route } from "@/lib/http";
import { ownedProject } from "@/lib/api";

/** Everything the Design Analysis view shows: references, captured pages, measurements, designs. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const { project } = await ownedProject(id);
  const refs = await db.select().from(schema.referenceSites).where(eq(schema.referenceSites.projectId, id)).orderBy(asc(schema.referenceSites.position));
  const pages = await db.select().from(schema.referencePages).where(eq(schema.referencePages.projectId, id)).orderBy(asc(schema.referencePages.depth), asc(schema.referencePages.createdAt));
  return json({
    design: project.design,
    references: refs.map((r) => ({
      ...r,
      pages: pages
        .filter((p) => p.referenceId === r.id)
        .map((p) => ({
          id: p.id,
          url: p.url,
          path: p.path,
          title: p.title,
          screenshots: p.screenshots,
          sections: p.sections,
          extraction: p.extraction
            ? {
                colors: p.extraction.colors,
                screenshotPalette: p.extraction.screenshotPalette,
                gradients: p.extraction.gradients,
                typography: p.extraction.typography,
                fonts: p.extraction.fonts,
                spacing: p.extraction.spacing,
                radii: p.extraction.radii,
                shadows: p.extraction.shadows,
                buttons: p.extraction.buttons,
                navigation: { ...p.extraction.navigation, footer: { columns: p.extraction.navigation.footer.columns, links: p.extraction.navigation.footer.links.slice(0, 30) } },
                animations: p.extraction.animations,
                images: p.extraction.images.length,
                videos: p.extraction.videos.length,
                forms: p.extraction.forms,
                tech: p.extraction.tech,
                responsive: p.extraction.responsive,
                documentHeight: p.extraction.documentHeight,
                meta: p.extraction.meta,
              }
            : null,
        })),
    })),
  });
});
