import type { DesignSystem, ProjectSettings, ReferenceRole } from "@/lib/types";

export type FileEntry = { path: string; mime: string; size: number; binary: boolean; updatedAt: string };

export type ReferenceSummary = {
  id: string;
  kind: "url" | "image";
  url: string | null;
  storageKey: string | null;
  title: string | null;
  roles: ReferenceRole[];
  notes: string;
  status: "pending" | "analyzing" | "done" | "error" | "blocked";
  error: string | null;
  analyzedAt: string | null;
  position: number;
};

export type JobSummary = {
  id: string;
  type: "analyze" | "generate" | "chat" | "fidelity";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  stage: string | null;
  error?: string | null;
  createdAt: string;
};

export type ProjectData = {
  project: {
    id: string;
    name: string;
    mode: string;
    status: string;
    brief: string;
    settings: ProjectSettings;
    design: DesignSystem | null;
    publishedSlug: string | null;
    publishedAt: string | null;
    publishIndexable: boolean;
    updatedAt: string;
  };
  references: ReferenceSummary[];
  files: FileEntry[];
  activeJob: JobSummary | null;
  versionCount: number;
  fidelity: { id: string; path: string; viewport: string; score: number; createdAt: string }[];
  previewBase: string;
  publishedUrl: string | null;
  capabilities: { ai: boolean; model: string; stockImages: boolean; imageGeneration: string | null; storage: string };
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: { storageKey: string; mime: string; name: string }[];
  jobId: string | null;
  meta: {
    activity?: { tool: string; summary: string; error?: boolean }[];
    changedFiles?: string[];
    versionNumber?: number | null;
    fidelity?: { path: string; viewport: string; score: number }[];
    usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
    error?: boolean;
    kind?: string;
  };
  createdAt: string;
};
