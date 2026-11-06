"use client";
// Browser-side helpers: API calls, formatting, job event streaming.
import { useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code);
  return data as T;
}

export const mediaUrl = (key: string) => `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;

export function timeAgo(d: string | Date) {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type JobEvent = { id: number; type: string; data: Record<string, unknown>; at: string };

/** Subscribes to a job's persisted event log over SSE (replays from the start, then live). */
export function useJobEvents(jobId: string | null, onEvent?: (e: JobEvent) => void) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [status, setStatus] = useState<"idle" | "streaming" | "ended">("idle");
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    setEvents([]);
    if (!jobId) {
      setStatus("idle");
      return;
    }
    setStatus("streaming");
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as JobEvent;
        setEvents((prev) => (prev.length && prev[prev.length - 1].id >= e.id ? prev : [...prev, e]));
        cb.current?.(e);
      } catch {
        /* ignore malformed */
      }
    };
    es.addEventListener("end", () => {
      setStatus("ended");
      es.close();
    });
    return () => es.close();
  }, [jobId]);
  return { events, status };
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
