import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  real,
  boolean,
  bigserial,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type {
  ProjectSettings,
  ReferenceRole,
  DesignSystem,
  PageExtraction,
  ScreenshotSet,
  SectionInfo,
  VersionFile,
  FidelityMetrics,
  FidelityIssue,
  SiteAnalysis,
} from "@/lib/types";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    // sha256(token) — the raw token only ever lives in the user's httpOnly cookie.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: text("mode").$type<"recreate" | "combine" | "prompt" | "screenshots">().notNull(),
    status: text("status")
      .$type<"draft" | "analyzing" | "analyzed" | "generating" | "ready" | "error">()
      .notNull()
      .default("draft"),
    brief: text("brief").notNull().default(""),
    settings: jsonb("settings").$type<ProjectSettings>().notNull(),
    design: jsonb("design").$type<DesignSystem | null>(),
    thumbnailKey: text("thumbnail_key"),
    publishedSlug: text("published_slug").unique(),
    publishedVersionId: uuid("published_version_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishIndexable: boolean("publish_indexable").notNull().default(false),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("projects_user_idx").on(t.userId, t.updatedAt)],
);

export const projectFiles = pgTable(
  "project_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    // Text files keep their content inline; binary files (images, fonts, video) live in storage.
    content: text("content"),
    storageKey: text("storage_key"),
    mime: text("mime").notNull(),
    size: integer("size").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("project_files_path_idx").on(t.projectId, t.path)],
);

export const projectVersions = pgTable(
  "project_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    label: text("label").notNull(),
    source: text("source").$type<"ai" | "manual" | "restore" | "duplicate" | "autosave">().notNull(),
    jobId: uuid("job_id"),
    files: jsonb("files").$type<VersionFile[]>().notNull(),
    fileCount: integer("file_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("project_versions_num_idx").on(t.projectId, t.number)],
);

export const referenceSites = pgTable(
  "reference_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"url" | "image">().notNull(),
    url: text("url"),
    storageKey: text("storage_key"),
    title: text("title"),
    roles: jsonb("roles").$type<ReferenceRole[]>().notNull(),
    notes: text("notes").notNull().default(""),
    position: integer("position").notNull().default(0),
    status: text("status")
      .$type<"pending" | "analyzing" | "done" | "error" | "blocked">()
      .notNull()
      .default("pending"),
    error: text("error"),
    analysis: jsonb("analysis").$type<SiteAnalysis | null>(),
    design: jsonb("design").$type<DesignSystem | null>(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("reference_sites_project_idx").on(t.projectId)],
);

export const referencePages = pgTable(
  "reference_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => referenceSites.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    path: text("path").notNull(),
    title: text("title"),
    depth: integer("depth").notNull().default(0),
    status: text("status").$type<"done" | "error">().notNull().default("done"),
    error: text("error"),
    extraction: jsonb("extraction").$type<PageExtraction | null>(),
    screenshots: jsonb("screenshots").$type<ScreenshotSet>().notNull().default({}),
    sections: jsonb("sections").$type<SectionInfo[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("reference_pages_ref_idx").on(t.referenceId)],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id"),
    source: text("source").$type<"reference" | "stock" | "generated" | "upload">().notNull(),
    kind: text("kind").$type<"image" | "video" | "background" | "font" | "icon">().notNull(),
    url: text("url"),
    storageKey: text("storage_key"),
    mime: text("mime"),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt"),
    license: text("license"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("assets_project_idx").on(t.projectId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    type: text("type").$type<"analyze" | "generate" | "chat" | "fidelity">().notNull(),
    status: text("status")
      .$type<"queued" | "running" | "succeeded" | "failed" | "cancelled">()
      .notNull()
      .default("queued"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    error: text("error"),
    progress: real("progress").notNull().default(0),
    stage: text("stage"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    lockedBy: text("locked_by"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("jobs_status_idx").on(t.status, t.createdAt), index("jobs_project_idx").on(t.projectId, t.createdAt)],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.id)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    attachments: jsonb("attachments").$type<{ storageKey: string; mime: string; name: string }[]>().notNull().default([]),
    jobId: uuid("job_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("messages_project_idx").on(t.projectId, t.createdAt)],
);

export const fidelityReports = pgTable(
  "fidelity_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    referenceId: uuid("reference_id"),
    referencePageId: uuid("reference_page_id"),
    path: text("path").notNull(),
    viewport: text("viewport").$type<"desktop" | "tablet" | "mobile">().notNull(),
    iteration: integer("iteration").notNull().default(0),
    score: real("score").notNull(),
    metrics: jsonb("metrics").$type<FidelityMetrics>().notNull(),
    issues: jsonb("issues").$type<FidelityIssue[]>().notNull().default([]),
    images: jsonb("images").$type<{ reference?: string; generated?: string; diff?: string }>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("fidelity_project_idx").on(t.projectId, t.createdAt)],
);

export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    formName: text("form_name"),
    path: text("path"),
    data: jsonb("data").$type<Record<string, string>>().notNull(),
    strippedFields: jsonb("stripped_fields").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("form_submissions_project_idx").on(t.projectId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type ProjectVersion = typeof projectVersions.$inferSelect;
export type ReferenceSite = typeof referenceSites.$inferSelect;
export type ReferencePage = typeof referencePages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobEvent = typeof jobEvents.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type FidelityReport = typeof fidelityReports.$inferSelect;
