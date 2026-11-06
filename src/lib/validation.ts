import { z } from "zod";

export const roleEnum = z.enum(["full", "identity", "colors", "typography", "layout", "navigation", "animations", "photography", "components", "content"]);

export const SettingsSchema = z
  .object({
    maxPages: z.number().int().min(1).max(20),
    viewports: z.array(z.enum(["desktop", "tablet", "mobile"])).min(1),
    reuseMedia: z.boolean(),
    autoGenerate: z.boolean(),
    fidelityIterations: z.number().int().min(0).max(5),
    fidelityTarget: z.number().min(50).max(100),
    imageStrategy: z.enum(["auto", "reference", "stock", "generate"]),
    rightsConfirmed: z.boolean(),
  })
  .partial();
