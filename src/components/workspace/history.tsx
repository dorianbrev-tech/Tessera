"use client";
import { useEffect, useState } from "react";
import { Bookmark, Download, History as HistoryIcon, RotateCcw } from "lucide-react";
import { Badge, Button, Empty, Input, Modal, Spinner } from "@/components/ui";
import { api, ApiError, cx, timeAgo } from "@/lib/client";

type Version = { id: string; number: number; label: string; source: string; fileCount: number; createdAt: string };
type Job = { id: string; type: string; status: string; stage: string | null; error: string | null; createdAt: string; finishedAt: string | null };

const SOURCE: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" }> = {
  ai: { label: "AI", tone: "accent" },
  manual: { label: "Manual", tone: "neutral" },
  restore: { label: "Restore", tone: "warn" },
  duplicate: { label: "Duplicate", tone: "neutral" },
  autosave: { label: "Autosave", tone: "neutral" },
};

export function HistoryView({ projectId, reloadSignal, busy, onRestored }: { projectId: string; reloadSignal: number; busy: boolean; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [restoring, setRestoring] = useState<Version | null>(null);
  const [checkpoint, setCheckpoint] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api<{ versions: Version[] }>(`/api/projects/${projectId}/versions`).then((d) => setVersions(d.versions));
    api<{ jobs: Job[] }>(`/api/projects/${projectId}/jobs`).then((d) => setJobs(d.jobs));
  };
  useEffect(load, [projectId, reloadSignal]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Versions</h2>
              <p className="text-xs text-fg-3">A snapshot is saved after every AI change, manual save and restore.</p>
            </div>
            <Button size="sm" icon={<Bookmark className="size-3.5" />} onClick={() => setCheckpoint("")}>Save checkpoint</Button>
          </div>
          {versions === null ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : versions.length === 0 ? (
            <Empty icon={<HistoryIcon className="size-4" />} title="No versions yet">Versions appear once the site has files.</Empty>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line">
              {versions.map((v, i) => (
                <div key={v.id} className={cx("flex items-center gap-4 px-4 py-3", i > 0 && "border-t border-line")}>
                  <span className="w-10 shrink-0 font-mono text-xs text-fg-3">v{v.number}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-fg">{v.label}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-3">
                      <Badge tone={SOURCE[v.source]?.tone ?? "neutral"}>{SOURCE[v.source]?.label ?? v.source}</Badge>
                      {v.fileCount} files · {timeAgo(v.createdAt)}
                    </div>
                  </div>
                  <a href={`/api/projects/${projectId}/export?version=${v.id}`} title="Download this version" className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg">
                    <Download className="size-3.5" />
                  </a>
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} disabled={busy || i === 0} onClick={() => setRestoring(v)}>Restore</Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="mb-4 text-sm font-medium">Activity</h2>
          <div className="space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="rounded-md border border-line px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-fg">{{ analyze: "Analysis", generate: "Generation", chat: "AI edit", fidelity: "Fidelity check" }[j.type] ?? j.type}</span>
                  <Badge tone={j.status === "succeeded" ? "ok" : j.status === "failed" ? "bad" : j.status === "running" || j.status === "queued" ? "accent" : "neutral"}>{j.status}</Badge>
                </div>
                <div className="mt-1 text-fg-3">{timeAgo(j.createdAt)}{j.error ? ` · ${j.error.slice(0, 140)}` : ""}</div>
              </div>
            ))}
            {!jobs.length && <p className="text-xs text-fg-3">No activity yet.</p>}
          </div>
        </div>
      </div>

      <Modal
        open={!!restoring}
        onClose={() => setRestoring(null)}
        title={`Restore v${restoring?.number}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoring(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={working}
              onClick={async () => {
                setWorking(true);
                setError(null);
                try {
                  await api(`/api/projects/${projectId}/versions/${restoring!.id}/restore`, { method: "POST" });
                  setRestoring(null);
                  load();
                  onRestored();
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : "Restore failed");
                }
                setWorking(false);
              }}
            >
              Restore
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-2">The site’s files will be replaced with “{restoring?.label}”. Your current state is saved as a version first, so nothing is lost.</p>
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </Modal>

      <Modal
        open={checkpoint !== null}
        onClose={() => setCheckpoint(null)}
        title="Save checkpoint"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCheckpoint(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={working}
              onClick={async () => {
                setWorking(true);
                await api(`/api/projects/${projectId}/versions`, { method: "POST", json: { label: checkpoint || "Manual checkpoint" } }).catch(() => {});
                setWorking(false);
                setCheckpoint(null);
                load();
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Input autoFocus placeholder="e.g. Before changing the typography" value={checkpoint ?? ""} onChange={(e) => setCheckpoint(e.target.value)} />
      </Modal>
    </div>
  );
}
