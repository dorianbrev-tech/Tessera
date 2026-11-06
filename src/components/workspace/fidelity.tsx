"use client";
import { useEffect, useMemo, useState } from "react";
import { ScanEye, Wand2 } from "lucide-react";
import { Badge, Button, Empty, ScoreRing, Segmented, Spinner } from "@/components/ui";
import { api, cx, mediaUrl, timeAgo } from "@/lib/client";
import type { FidelityIssue, FidelityMetrics } from "@/lib/types";

type Report = {
  id: string;
  path: string;
  viewport: "desktop" | "tablet" | "mobile";
  iteration: number;
  score: number;
  metrics: FidelityMetrics;
  issues: FidelityIssue[];
  images: { reference?: string; generated?: string; diff?: string };
  createdAt: string;
  jobId: string | null;
};

const METRICS: { key: keyof FidelityMetrics; label: string; hint: string }[] = [
  { key: "structural", label: "Structure", hint: "Block-level SSIM of the rendered pages" },
  { key: "layout", label: "Layout", hint: "Vertical rhythm: luminance and edge profiles" },
  { key: "pixel", label: "Pixels", hint: "Share of matching pixels" },
  { key: "color", label: "Color", hint: "Palette agreement (ΔE)" },
  { key: "typography", label: "Typography", hint: "Families, sizes, casing, tracking" },
  { key: "sections", label: "Sections", hint: "Section order and columns" },
  { key: "media", label: "Media", hint: "Images and video" },
];

function Compare({ r }: { r: Report }) {
  const [mode, setMode] = useState<"side" | "swipe" | "diff">("side");
  const [pos, setPos] = useState(50);
  const ref = r.images.reference ? mediaUrl(r.images.reference) : null;
  const gen = r.images.generated ? mediaUrl(r.images.generated) : null;
  const width = r.viewport === "desktop" ? "100%" : r.viewport === "tablet" ? 560 : 340;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: "side", label: "Side by side" }, { value: "swipe", label: "Swipe" }, { value: "diff", label: "Difference" }]} />
        {mode === "swipe" && <input aria-label="Swipe position" type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="w-48 accent-[var(--color-accent-strong)]" />}
      </div>
      <div className="checker max-h-[calc(100vh-260px)] overflow-y-auto rounded-lg border border-line p-3">
        {mode === "side" && (
          <div className="grid grid-cols-2 gap-3">
            {[["Reference", ref], ["Generated", gen]].map(([label, src]) => (
              <div key={label as string}>
                <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-3 uppercase">{label}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src ? <img src={src as string} alt={label as string} className="mx-auto block w-full" style={{ maxWidth: width }} /> : <div className="text-xs text-fg-4">Missing</div>}
              </div>
            ))}
          </div>
        )}
        {mode === "swipe" && ref && gen && (
          <div className="relative mx-auto" style={{ maxWidth: width }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gen} alt="Generated" className="block w-full" />
            <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ref} alt="Reference" className="block w-full" />
            </div>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: `${pos}%` }} />
            <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">Reference</div>
            <div className="pointer-events-none absolute top-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">Generated</div>
          </div>
        )}
        {mode === "diff" && r.images.diff && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(r.images.diff)} alt="Difference" className="mx-auto block w-full [image-rendering:pixelated]" style={{ maxWidth: width }} />
        )}
      </div>
    </div>
  );
}

export function FidelityView({ projectId, reloadSignal, onRun, busy, hasPixelRefs, aiEnabled, target }: { projectId: string; reloadSignal: number; onRun: (autoFix: boolean) => void; busy: boolean; hasPixelRefs: boolean; aiEnabled: boolean; target: number }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  useEffect(() => {
    api<{ reports: Report[] }>(`/api/projects/${projectId}/fidelity`).then((d) => setReports(d.reports)).catch(() => setReports([]));
  }, [projectId, reloadSignal]);

  const latest = useMemo(() => {
    const m = new Map<string, Report & { history: Report[] }>();
    for (const r of reports ?? []) {
      const k = `${r.path}@${r.viewport}`;
      const e = m.get(k);
      if (!e) m.set(k, { ...r, history: [r] });
      else e.history.push(r);
    }
    return [...m.values()];
  }, [reports]);
  const selected = (reports ?? []).find((r) => r.id === selId) ?? latest[0] ?? null;
  const avg = latest.length ? latest.reduce((s, r) => s + r.score, 0) / latest.length : 0;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center gap-3">
            <ScoreRing score={avg} size={44} />
            <div>
              <div className="text-[13px] font-medium">Visual fidelity</div>
              <div className="text-xs text-fg-3">{latest.length ? `Average of ${latest.length} · target ${target}` : `Target ${target}`}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" icon={<ScanEye className="size-3.5" />} onClick={() => onRun(false)} disabled={busy || !hasPixelRefs}>Run check</Button>
            <Button size="sm" variant="accent" className="flex-1" icon={<Wand2 className="size-3.5" />} onClick={() => onRun(true)} disabled={busy || !hasPixelRefs || !aiEnabled} title={aiEnabled ? "Compare, then let the AI fix the differences" : "Requires ANTHROPIC_API_KEY"}>Check & fix</Button>
          </div>
          {!hasPixelRefs && <p className="text-xs text-fg-3">Give a reference the “Full recreation” or “Layout” role to compare against it.</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {reports === null ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            latest.map((r) => (
              <button key={r.id} onClick={() => setSelId(r.id)} className={cx("flex w-full items-center gap-3 px-4 py-2 text-left", selected?.id === r.id || selected?.path + selected?.viewport === r.path + r.viewport ? "bg-hover" : "hover:bg-hover/60")}>
                <ScoreRing score={r.score} size={32} />
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-fg">{r.path}</div>
                  <div className="text-2xs text-fg-3">{r.viewport} · {r.history.length} run{r.history.length > 1 ? "s" : ""} · {timeAgo(r.createdAt)}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {!selected ? (
          <Empty icon={<ScanEye className="size-4" />} title="No comparisons yet">Fidelity checks render each generated page, compare it with its reference, and list what differs.</Empty>
        ) : (
          <div className="mx-auto grid max-w-7xl gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              <div className="mb-4 flex items-baseline gap-3">
                <h2 className="font-mono text-base text-fg">{selected.path}</h2>
                <span className="text-xs text-fg-3">{selected.viewport} · round {selected.iteration} · {timeAgo(selected.createdAt)}</span>
              </div>
              <Compare key={selected.id} r={selected} />
            </div>
            <div className="min-w-0 space-y-6">
              <div className="flex items-center gap-3">
                <ScoreRing score={selected.score} size={56} />
                <div>
                  <div className="text-2xl font-semibold tabular-nums">{selected.score.toFixed(1)}</div>
                  <div className="text-xs text-fg-3">Height {selected.metrics.generatedHeight}px vs {selected.metrics.referenceHeight}px</div>
                </div>
              </div>
              <div className="space-y-2">
                {METRICS.map((m) => {
                  const v = Number(selected.metrics[m.key]) || 0;
                  return (
                    <div key={m.key} title={m.hint}>
                      <div className="mb-1 flex justify-between text-xs"><span className="text-fg-2">{m.label}</span><span className="font-mono text-fg-3 tabular-nums">{(v * 100).toFixed(0)}</span></div>
                      <div className="h-1 overflow-hidden rounded-full bg-line"><div className={cx("h-full rounded-full", v >= 0.85 ? "bg-ok" : v >= 0.65 ? "bg-warn" : "bg-bad")} style={{ width: `${v * 100}%` }} /></div>
                    </div>
                  );
                })}
              </div>
              <div>
                <h3 className="mb-2 text-2xs font-medium tracking-wider text-fg-3 uppercase">Issues · {selected.issues.length}</h3>
                {selected.issues.length === 0 ? (
                  <p className="text-xs text-fg-3">No specific issues detected.</p>
                ) : (
                  <ul className="space-y-2">
                    {selected.issues.map((i, k) => (
                      <li key={k} className="flex gap-2 text-xs leading-5">
                        <Badge tone={i.severity === "high" ? "bad" : i.severity === "medium" ? "warn" : "neutral"} className="mt-px shrink-0">{i.kind}</Badge>
                        <span className="text-fg-2">{i.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
