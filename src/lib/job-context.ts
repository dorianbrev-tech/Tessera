import type { Job } from "@/lib/db/schema";
import type { JobEventType } from "@/lib/types";

/** What a job handler can do while running inside the worker. */
export interface JobContext {
  job: Job;
  emit(type: JobEventType, data?: Record<string, unknown>): Promise<void>;
  log(message: string, level?: "info" | "warn" | "error"): Promise<void>;
  progress(fraction: number, stage?: string): Promise<void>;
  isCancelled(): Promise<boolean>;
}

export class JobCancelled extends Error {
  constructor() {
    super("Job cancelled");
  }
}
