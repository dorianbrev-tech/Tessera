"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { AlertTriangle, Code2, Globe, Wand2, X } from "lucide-react";
import { Badge, Button, IconButton, ScoreRing, Spinner } from "@/components/ui";
import { Logo } from "@/components/logo";
import { STATUS } from "@/components/dashboard";
import { api, ApiError, cx, useJobEvents, type JobEvent } from "@/lib/client";
import { ChatPanel } from "./chat";
import { PreviewPanel } from "./preview";
import { CodePanel } from "./code";
import { AnalysisView } from "./analysis";
import { FidelityView } from "./fidelity";
import { HistoryView } from "./history";
import { SettingsView } from "./settings";
import { PublishDialog } from "./publish";
import type { ChatMessage, FileEntry, JobSummary, ProjectData } from "./types";

type View = "build" | "analysis" | "fidelity" | "history" | "settings";
const VIEWS: { id: View; label: string }[] = [
  { id: "build", label: "Build" },
  { id: "analysis", label: "Analysis" },
  { id: "fidelity", label: "Fidelity" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export function Workspace({ projectId }: { projectId: string; user: { id: string; email: string; name: string | null } }) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [view, setView] = useState<View>("build");
  const [path, setPath] = useState("/");
  const [reloadSignal, setReloadSignal] = useState(0);
  const [dataSignal, setDataSignal] = useState(0);
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [codeCollapsed, setCodeCollapsed] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const codeRef = useRef<PanelImperativeHandle | null>(null);
  const fileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadProject = useCallback(async () => {
    const d = await api<ProjectData>(`/api/projects/${projectId}`);
    setData(d);
    setJob((cur) => (d.activeJob ? (cur?.id === d.activeJob.id ? { ...cur, ...d.activeJob } : d.activeJob) : null));
    return d;
  }, [projectId]);
  const loadMessages = useCallback(async () => {
    const d = await api<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/messages`);
    setMessages(d.messages);
  }, [projectId]);
  const loadFiles = useCallback(async () => {
    const d = await api<{ files: FileEntry[] }>(`/api/projects/${projectId}/files`);
    setData((cur) => (cur ? { ...cur, files: d.files } : cur));
  }, [projectId]);

  useEffect(() => {
    loadProject().then((d) => {
      // A recreation without generated files yet: land on the analysis once it exists.
      if (!d.files.length && d.project.design && !d.activeJob) setView("analysis");
    });
    loadMessages();
    const w = sessionStorage.getItem(`tessera-warning-${projectId}`);
    if (w) {
      setBanner(w);
      sessionStorage.removeItem(`tessera-warning-${projectId}`);
    }
  }, [projectId, loadProject, loadMessages]);

  const onEvent = useCallback(
    (e: JobEvent) => {
      if (e.type === "file") {
        if (fileTimer.current) clearTimeout(fileTimer.current);
        fileTimer.current = setTimeout(() => {
          loadFiles().then(() => setReloadSignal((n) => n + 1));
        }, 700);
      } else if (e.type === "stage") {
        setJob((j) => (j ? { ...j, stage: String(e.data.stage ?? j.stage), progress: typeof e.data.progress === "number" ? e.data.progress : j.progress } : j));
      } else if (e.type === "fidelity") {
        setDataSignal((n) => n + 1);
      } else if (e.type === "done") {
        setTimeout(async () => {
          const d = await loadProject();
          await loadMessages();
          await loadFiles();
          setReloadSignal((n) => n + 1);
          setDataSignal((n) => n + 1);
          if (!d.activeJob && d.files.length && view === "analysis") setView("build");
        }, 350);
      }
    },
    [loadFiles, loadMessages, loadProject, view],
  );
  const { events } = useJobEvents(job?.id ?? null, onEvent);

  const startJob = useCallback(
    async (url: string, body: unknown = {}) => {
      setActionError(null);
      try {
        const res = await api<{ job: JobSummary }>(url, { method: "POST", json: body });
        setJob(res.job);
        loadMessages();
        return res.job;
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : "Could not start");
        return null;
      }
    },
    [loadMessages],
  );

  const cancel = useCallback(async () => {
    if (job) await api(`/api/jobs/${job.id}/cancel`, { method: "POST" }).catch(() => {});
  }, [job]);

  const onPreviewError = useCallback((m: string) => setRuntimeErrors((xs) => (xs.includes(m) ? xs : [...xs.slice(-19), m])), []);
  const onPathChange = useCallback((p: string) => setPath(p), []);

  const fidelityAvg = useMemo(() => {
    const f = data?.fidelity ?? [];
    return f.length ? f.reduce((s, x) => s + x.score, 0) / f.length : null;
  }, [data?.fidelity]);

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const p = data.project;
  const st = STATUS[p.status] ?? STATUS.draft;
  const busy = !!job;
  const hasPixelRefs = data.references.some((r) => r.status === "done" && r.roles.some((x) => x === "full" || x === "layout"));
  const canGenerate = data.capabilities.ai && !busy;
  const locked = !!job && (job.type === "generate" || job.type === "chat" || (job.type === "fidelity" && job.stage?.startsWith("Working") === true));

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <Link href="/dashboard" className="flex items-center text-fg-2 hover:text-fg" title="All projects">
          <Logo />
        </Link>
        <span className="text-fg-4">/</span>
        {editingName ? (
          <input
            autoFocus
            defaultValue={p.name}
            onBlur={async (e) => {
              setEditingName(false);
              const name = e.target.value.trim();
              if (name && name !== p.name) {
                await api(`/api/projects/${projectId}`, { method: "PATCH", json: { name } });
                loadProject();
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-7 w-56 rounded border border-accent/50 bg-bg px-2 text-[13px] focus:outline-none"
          />
        ) : (
          <button onClick={() => setEditingName(true)} className="max-w-[260px] truncate rounded px-1 text-[13px] font-medium hover:bg-hover" title="Rename">
            {p.name}
          </button>
        )}
        {job ? (
          <span className="flex items-center gap-1.5 text-xs text-fg-3"><Spinner className="size-3 text-accent" /> <span className="max-w-[240px] truncate">{job.stage ?? "Working"}</span></span>
        ) : (
          <Badge tone={st.tone}>{st.label}</Badge>
        )}

        <nav className="mx-auto flex items-center gap-0.5">
          {VIEWS.map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} className={cx("h-7 rounded-md px-2.5 text-[13px] transition-colors", view === v.id ? "bg-hover text-fg" : "text-fg-3 hover:text-fg")}>
              {v.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          {!data.capabilities.ai && <Badge tone="warn">AI off</Badge>}
          {fidelityAvg !== null && (
            <button onClick={() => setView("fidelity")} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-fg-3 hover:bg-hover hover:text-fg" title="Average fidelity of the latest comparisons">
              <ScoreRing score={fidelityAvg} size={24} />
            </button>
          )}
          {view === "build" && (
            <IconButton
              label={codeCollapsed ? "Show code" : "Hide code"}
              active={!codeCollapsed}
              onClick={() => {
                const r = codeRef.current;
                if (!r) return;
                if (r.isCollapsed()) r.expand();
                else r.collapse();
              }}
            >
              <Code2 className="size-4" />
            </IconButton>
          )}
          {!data.files.length && p.design && canGenerate && (
            <Button size="sm" variant="accent" icon={<Wand2 className="size-3.5" />} onClick={() => startJob(`/api/projects/${projectId}/generate`)}>Generate</Button>
          )}
          <Button size="sm" variant="primary" icon={<Globe className="size-3.5" />} onClick={() => setPublishOpen(true)} disabled={!data.files.length}>
            {data.publishedUrl ? "Published" : "Publish"}
          </Button>
        </div>
      </header>

      {(banner || actionError) && (
        <div className="flex items-center gap-2 border-b border-warn/20 bg-warn/5 px-4 py-2 text-xs text-fg-2">
          <AlertTriangle className="size-3.5 text-warn" />
          <span>{actionError ?? banner}</span>
          <button aria-label="Dismiss" onClick={() => { setBanner(null); setActionError(null); }} className="ml-auto text-fg-3 hover:text-fg"><X className="size-3.5" /></button>
        </div>
      )}

      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel id="chat" defaultSize="380px" minSize="300px" maxSize="600px">
          <ChatPanel
            projectId={projectId}
            messages={messages}
            job={job}
            events={events}
            aiEnabled={data.capabilities.ai}
            runtimeErrors={runtimeErrors}
            currentPath={path}
            onSent={(j) => { setJob(j); loadMessages(); }}
            onCancel={cancel}
            onClearErrors={() => setRuntimeErrors([])}
          />
        </Panel>
        <Separator />
        <Panel id="main" minSize="40%">
          {view === "build" ? (
            <Group orientation="horizontal" className="h-full">
              <Panel id="preview" minSize="30%">
                <PreviewPanel base={data.previewBase} files={data.files} path={path} onPathChange={onPathChange} reloadSignal={reloadSignal} job={job} errors={runtimeErrors} onError={onPreviewError} />
              </Panel>
              <Separator />
              <Panel id="code" defaultSize="44%" minSize="340px" collapsible collapsedSize="0px" panelRef={codeRef} onResize={(s) => setCodeCollapsed(s.inPixels < 10)}>
                <CodePanel projectId={projectId} files={data.files} base={data.previewBase} locked={locked} refreshSignal={reloadSignal} onSaved={() => { setRuntimeErrors([]); loadFiles().then(() => setReloadSignal((n) => n + 1)); }} onFilesChanged={() => loadFiles().then(() => setReloadSignal((n) => n + 1))} />
              </Panel>
            </Group>
          ) : view === "analysis" ? (
            <AnalysisView
              projectId={projectId}
              reloadSignal={dataSignal}
              canGenerate={data.capabilities.ai}
              hasFiles={data.files.length > 0}
              busy={busy}
              onGenerate={async () => { if (await startJob(`/api/projects/${projectId}/generate`)) setView("build"); }}
              onReanalyze={(refId) => startJob(`/api/projects/${projectId}/analyze`, { referenceIds: refId ? [refId] : undefined, skipGenerate: data.files.length > 0 })}
            />
          ) : view === "fidelity" ? (
            <FidelityView projectId={projectId} reloadSignal={dataSignal} busy={busy} hasPixelRefs={hasPixelRefs} aiEnabled={data.capabilities.ai} target={p.settings.fidelityTarget} onRun={(autoFix) => startJob(`/api/projects/${projectId}/fidelity`, { autoFix })} />
          ) : view === "history" ? (
            <HistoryView projectId={projectId} reloadSignal={dataSignal} busy={busy} onRestored={() => { loadProject(); loadFiles().then(() => setReloadSignal((n) => n + 1)); }} />
          ) : (
            <SettingsView key={p.updatedAt} data={data} busy={busy} onChanged={() => loadProject()} onReanalyze={(ids) => startJob(`/api/projects/${projectId}/analyze`, { referenceIds: ids, skipGenerate: data.files.length > 0 })} />
          )}
        </Panel>
      </Group>

      {publishOpen && <PublishDialog open onClose={() => setPublishOpen(false)} data={data} onChanged={() => loadProject()} />}
    </div>
  );
}
