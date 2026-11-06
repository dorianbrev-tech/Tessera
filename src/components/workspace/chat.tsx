"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bug,
  Check,
  ChevronRight,
  Eye,
  FilePen,
  FilePlus,
  FileText,
  Folder,
  ImageIcon,
  Monitor,
  Palette,
  Paperclip,
  Ruler,
  ScanEye,
  Search,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge, Markdown, Spinner } from "@/components/ui";
import { api, ApiError, cx, mediaUrl, timeAgo, type JobEvent } from "@/lib/client";
import type { ChatMessage, JobSummary } from "./types";

const TOOL_META: Record<string, { icon: React.ComponentType<{ className?: string }>; verb: string }> = {
  write_file: { icon: FilePlus, verb: "Writing" },
  edit_file: { icon: FilePen, verb: "Editing" },
  read_file: { icon: FileText, verb: "Reading" },
  delete_file: { icon: Trash2, verb: "Deleting" },
  list_files: { icon: Folder, verb: "Listing files" },
  get_design_system: { icon: Palette, verb: "Reading the design system" },
  get_reference_page: { icon: Ruler, verb: "Measuring reference" },
  view_reference: { icon: Eye, verb: "Looking at reference" },
  list_assets: { icon: ImageIcon, verb: "Browsing media" },
  import_asset: { icon: ImageIcon, verb: "Importing" },
  search_stock_photos: { icon: Search, verb: "Searching photos" },
  generate_image: { icon: Sparkles, verb: "Generating image" },
  render_preview: { icon: Monitor, verb: "Rendering" },
  compare_to_reference: { icon: ScanEye, verb: "Comparing" },
};

type TimelineItem =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; detail?: string; summary?: string; state: "pending" | "running" | "done"; error?: boolean }
  | { kind: "log"; message: string; level: string }
  | { kind: "shots"; items: { key: string; label: string }[] }
  | { kind: "fidelity"; path: string; viewport: string; score: number };

function buildTimeline(events: JobEvent[]) {
  const items: TimelineItem[] = [];
  const toolIndex = new Map<string, number>();
  let stage = "";
  let progress = 0;
  let error: string | null = null;
  for (const e of events) {
    const d = e.data as Record<string, unknown>;
    const last = items[items.length - 1];
    switch (e.type) {
      case "text":
        if (last?.kind === "text") last.text += String(d.delta ?? "");
        else items.push({ kind: "text", text: String(d.delta ?? "") });
        break;
      case "thinking":
        if (last?.kind === "thinking") last.text += String(d.text ?? "");
        else items.push({ kind: "thinking", text: String(d.text ?? "") });
        break;
      case "tool": {
        const id = String(d.id);
        const idx = toolIndex.get(id);
        const state = d.phase === "end" ? "done" : d.phase === "start" ? "running" : "pending";
        if (idx === undefined) {
          toolIndex.set(id, items.length);
          items.push({ kind: "tool", id, name: String(d.name), detail: d.detail as string | undefined, summary: d.summary as string | undefined, state, error: Boolean(d.error) });
        } else {
          const t = items[idx] as Extract<TimelineItem, { kind: "tool" }>;
          t.state = state;
          if (d.detail) t.detail = String(d.detail);
          if (d.summary) t.summary = String(d.summary);
          t.error = Boolean(d.error);
        }
        break;
      }
      case "log":
        items.push({ kind: "log", message: String(d.message ?? ""), level: String(d.level ?? "info") });
        break;
      case "screenshot":
        if (last?.kind === "shots") last.items.push({ key: String(d.key), label: String(d.label ?? "") });
        else items.push({ kind: "shots", items: [{ key: String(d.key), label: String(d.label ?? "") }] });
        break;
      case "fidelity":
        items.push({ kind: "fidelity", path: String(d.path), viewport: String(d.viewport), score: Number(d.score) });
        break;
      case "stage":
        stage = String(d.stage ?? stage);
        if (typeof d.progress === "number") progress = d.progress;
        break;
      case "error":
        error = String(d.message ?? "Failed");
        break;
    }
  }
  return { items, stage, progress, error };
}

function ToolLine({ t }: { t: Extract<TimelineItem, { kind: "tool" }> }) {
  const meta = TOOL_META[t.name] ?? { icon: ChevronRight, verb: t.name };
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className={cx("flex size-4 shrink-0 items-center justify-center", t.error ? "text-bad" : t.state === "done" ? "text-fg-3" : "text-accent")}>
        {t.state === "done" ? t.error ? <TriangleAlert className="size-3.5" /> : <Icon className="size-3.5" /> : <Spinner className="size-3 text-accent" />}
      </span>
      <span className={cx("truncate", t.state === "done" ? "text-fg-3" : "text-fg-2")}>
        {t.state === "done" && t.summary ? t.summary : `${meta.verb}${t.detail ? ` ${t.detail}` : "…"}`}
      </span>
    </div>
  );
}

function Timeline({ items, live }: { items: TimelineItem[]; live: boolean }) {
  // Collapse long runs of logs/tools so the panel stays readable.
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => {
        if (it.kind === "text") return it.text.trim() ? <Markdown key={i} text={it.text} className="text-[13px] leading-5 text-fg-2" /> : null;
        if (it.kind === "thinking") return it.text.trim() ? <p key={i} className="border-l border-line-strong pl-2.5 text-xs leading-5 text-fg-3 italic">{it.text.trim()}</p> : null;
        if (it.kind === "tool") return <ToolLine key={i} t={it} />;
        if (it.kind === "log")
          return (
            <div key={i} className={cx("font-mono text-[11px] leading-4", it.level === "error" ? "text-bad" : it.level === "warn" ? "text-warn" : "text-fg-3")}>
              {it.message}
            </div>
          );
        if (it.kind === "fidelity")
          return (
            <div key={i} className="flex items-center gap-2 py-0.5 text-xs text-fg-2">
              <ScanEye className="size-3.5 text-fg-3" /> {it.path} · {it.viewport}
              <Badge tone={it.score >= 85 ? "ok" : it.score >= 65 ? "warn" : "bad"}>{it.score.toFixed(1)}</Badge>
            </div>
          );
        if (it.kind === "shots")
          return (
            <div key={i} className="grid grid-cols-3 gap-1.5 py-1">
              {it.items.slice(-6).map((s) => (
                <a key={s.key} href={mediaUrl(s.key)} target="_blank" rel="noreferrer" title={s.label} className="group overflow-hidden rounded border border-line bg-raised">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(s.key)} alt={s.label} className="aspect-[4/3] w-full object-cover object-top opacity-90 transition-opacity group-hover:opacity-100" loading="lazy" />
                  <div className="truncate px-1.5 py-0.5 text-[10px] text-fg-3">{s.label}</div>
                </a>
              ))}
            </div>
          );
        return null;
      })}
      {live && items.length === 0 && <div className="shimmer-text text-xs">Starting…</div>}
    </div>
  );
}

const JOB_LABEL: Record<string, string> = { analyze: "Analysing references", generate: "Building the website", chat: "Working on your request", fidelity: "Checking visual fidelity" };

export function LiveRun({ job, events, onCancel }: { job: JobSummary; events: JobEvent[]; onCancel: () => void }) {
  const { items, stage, progress, error } = useMemo(() => buildTimeline(events), [events]);
  const pct = Math.round((progress || job.progress || 0) * 100);
  return (
    <div className="animate-rise rounded-lg border border-line bg-raised/60">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Spinner className="size-3.5 text-accent" />
        <span className="text-xs font-medium text-fg">{JOB_LABEL[job.type] ?? "Working"}</span>
        <span className="truncate text-xs text-fg-3">{stage}</span>
        <button onClick={onCancel} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-fg-3 hover:bg-hover hover:text-fg" title="Stop">
          <Square className="size-3" /> Stop
        </button>
      </div>
      <div className="h-px bg-line">
        <div className="h-px bg-accent transition-all duration-700" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <div className="max-h-[46vh] overflow-y-auto px-3 py-2.5">
        <Timeline items={items.slice(-120)} live />
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </div>
    </div>
  );
}

function MessageView({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false);
  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {m.attachments.length > 0 && (
          <div className="flex gap-1.5">
            {m.attachments.map((a) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={a.storageKey} src={mediaUrl(a.storageKey)} alt={a.name} className="h-14 w-20 rounded border border-line object-cover" />
            ))}
          </div>
        )}
        <div className="max-w-[88%] rounded-lg rounded-br-sm bg-overlay px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap text-fg">{m.content}</div>
      </div>
    );
  }
  const activity = m.meta.activity ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-2xs text-fg-3">
        <span className={cx("size-1.5 rounded-full", m.meta.error ? "bg-bad" : "bg-accent")} />
        Tessera · {timeAgo(m.createdAt)}
        {m.meta.versionNumber ? <Badge className="ml-1">v{m.meta.versionNumber}</Badge> : null}
      </div>
      <Markdown text={m.content} className={cx("text-[13px] leading-5", m.meta.error ? "text-bad" : "text-fg-2")} />
      {!!m.meta.fidelity?.length && (
        <div className="flex flex-wrap gap-1.5">
          {latestScores(m.meta.fidelity).map((f) => (
            <Badge key={`${f.path}@${f.viewport}`} tone={f.score >= 85 ? "ok" : f.score >= 65 ? "warn" : "bad"}>
              {f.path} · {f.viewport} · {f.score.toFixed(1)}
            </Badge>
          ))}
        </div>
      )}
      {activity.length > 0 && (
        <div>
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-2xs text-fg-3 hover:text-fg-2">
            <ChevronRight className={cx("size-3 transition-transform", open && "rotate-90")} />
            {activity.length} steps{m.meta.changedFiles?.length ? ` · ${m.meta.changedFiles.length} files changed` : ""}
          </button>
          {open && (
            <div className="mt-1.5 space-y-0.5 border-l border-line pl-3">
              {activity.map((a, i) => {
                const Icon = TOOL_META[a.tool]?.icon ?? Check;
                return (
                  <div key={i} className={cx("flex items-center gap-2 text-xs", a.error ? "text-bad" : "text-fg-3")}>
                    <Icon className="size-3 shrink-0" /> <span className="truncate">{a.summary}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function latestScores(list: { path: string; viewport: string; score: number }[]) {
  const m = new Map<string, { path: string; viewport: string; score: number }>();
  for (const f of list) m.set(`${f.path}@${f.viewport}`, f);
  return [...m.values()];
}

const SUGGESTIONS = [
  "Make the homepage feel more luxurious",
  "Use a more editorial typography",
  "Improve the mobile version",
  "Add a contact page with a form",
  "Add a full-screen video background to the hero",
  "Make the navigation identical to the reference",
];

export function ChatPanel(props: {
  projectId: string;
  messages: ChatMessage[];
  job: JobSummary | null;
  events: JobEvent[];
  aiEnabled: boolean;
  runtimeErrors: string[];
  currentPath: string;
  onSent: (job: JobSummary) => void;
  onCancel: () => void;
  onClearErrors: () => void;
}) {
  const { messages, job, events } = props;
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<{ storageKey: string; mime: string; name: string }[]>([]);
  const [includeErrors, setIncludeErrors] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, events.length]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(200, el.scrollHeight) + "px";
  }, [text]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of [...files].slice(0, 6 - attachments.length)) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("purpose", "attachment");
        const res = await api<{ storageKey: string; mime: string; name: string }>(`/api/projects/${props.projectId}/uploads`, { method: "POST", body: fd });
        setAttachments((a) => [...a, res]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    }
    setUploading(false);
  }

  async function send(value = text) {
    const t = value.trim();
    if (!t || sending || job) return;
    setSending(true);
    setError(null);
    try {
      const res = await api<{ job: JobSummary }>(`/api/projects/${props.projectId}/messages`, {
        method: "POST",
        json: { text: t, attachments, runtimeErrors: includeErrors ? props.runtimeErrors : [], currentPath: props.currentPath },
      });
      setText("");
      setAttachments([]);
      if (includeErrors && props.runtimeErrors.length) props.onClearErrors();
      props.onSent(res.job);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send");
    }
    setSending(false);
  }

  const onlyBrief = messages.length <= 1 && !job;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {messages.map((m) => <MessageView key={m.id} m={m} />)}
        {job && <LiveRun job={job} events={events} onCancel={props.onCancel} />}
        {onlyBrief && props.aiEnabled && (
          <div className="pt-2">
            <div className="mb-2 text-2xs font-medium tracking-wide text-fg-3 uppercase">Try</div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => setText(s)} className="rounded-md border border-line px-2 py-1 text-xs text-fg-2 transition-colors hover:border-line-strong hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        {props.runtimeErrors.length > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-bad/20 bg-bad/5 px-2 py-1.5 text-xs text-fg-2">
            <Bug className="size-3.5 text-bad" />
            <span className="truncate">{props.runtimeErrors.length} error{props.runtimeErrors.length > 1 ? "s" : ""} in the preview</span>
            <label className="ml-auto flex items-center gap-1 text-fg-3">
              <input type="checkbox" checked={includeErrors} onChange={(e) => setIncludeErrors(e.target.checked)} className="accent-[var(--color-accent-strong)]" /> include
            </label>
            {!job && props.aiEnabled && (
              <button onClick={() => send("Fix the errors reported by the preview.")} className="rounded bg-raised px-1.5 py-0.5 text-fg hover:bg-hover">Fix</button>
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex gap-1.5">
            {attachments.map((a, i) => (
              <div key={a.storageKey} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(a.storageKey)} alt={a.name} className="h-12 w-16 rounded border border-line object-cover" />
                <button aria-label="Remove attachment" onClick={() => setAttachments((xs) => xs.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 rounded-full border border-line bg-overlay p-0.5 text-fg-3 hover:text-fg">
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={cx("rounded-lg border bg-bg transition-colors focus-within:border-accent/50", props.aiEnabled ? "border-line-strong" : "border-line")}>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            disabled={!props.aiEnabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={props.aiEnabled ? (job ? "Tessera is working — you can queue your next request after it finishes" : "Ask for a change…") : "Set ANTHROPIC_API_KEY on the server to enable AI edits"}
            className="block max-h-[200px] w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] leading-5 text-fg placeholder:text-fg-4 focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1">
              <button onClick={() => fileRef.current?.click()} disabled={!props.aiEnabled || uploading} title="Attach an image (screenshot, mood, reference)" className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg disabled:opacity-40">
                {uploading ? <Spinner /> : <Paperclip className="size-4" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
              {props.currentPath !== "/" && <span className="font-mono text-2xs text-fg-4">on {props.currentPath}</span>}
            </div>
            {job ? (
              <button onClick={props.onCancel} title="Stop" className="flex size-7 items-center justify-center rounded-md bg-raised text-fg hover:bg-hover">
                <Square className="size-3.5" />
              </button>
            ) : (
              <button onClick={() => send()} disabled={!text.trim() || sending || !props.aiEnabled} title="Send (Enter)" className="flex size-7 items-center justify-center rounded-md bg-fg text-bg transition-opacity disabled:opacity-25">
                {sending ? <Spinner className="text-bg" /> : <ArrowUp className="size-4" />}
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </div>
    </div>
  );
}
