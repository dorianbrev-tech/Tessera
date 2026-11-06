"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, FileImage, Globe, Palette, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { Badge, Button, Empty, Markdown, Segmented, Spinner } from "@/components/ui";
import { api, cx, mediaUrl } from "@/lib/client";
import type { DesignSystem, PageExtraction, ScreenshotSet, SectionInfo } from "@/lib/types";
import { REFERENCE_ROLES } from "@/lib/types";
import type { ReferenceSummary } from "./types";

type AnalysisPage = {
  id: string;
  url: string;
  path: string;
  title: string | null;
  screenshots: ScreenshotSet;
  sections: SectionInfo[];
  extraction: (Omit<PageExtraction, "images" | "videos"> & { images: number; videos: number }) | null;
};
type AnalysisRef = ReferenceSummary & { analysis: { pages: { path: string; status: string; error?: string }[]; skipped: { url: string; reason: string }[]; durationMs: number; tech: string[]; robots: { checked: boolean } ; palette?: { hex: string; weight: number }[]; image?: { width: number; height: number } } | null; design: DesignSystem | null; pages: AnalysisPage[] };
type Data = { design: DesignSystem | null; references: AnalysisRef[] };

const roleLabel = (r: string) => REFERENCE_ROLES.find((x) => x.id === r)?.label ?? r;

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-line py-5 last:border-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-2xs font-medium tracking-wider text-fg-3 uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Swatch({ hex, label, sub }: { hex: string; label?: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="h-14 rounded-md border border-white/10" style={{ background: hex }} />
      <div className="mt-1.5 font-mono text-[11px] text-fg">{hex}</div>
      {label && <div className="truncate text-[11px] text-fg-2">{label}</div>}
      {sub && <div className="truncate text-[11px] text-fg-3">{sub}</div>}
    </div>
  );
}

function DesignSystemView({ d }: { d: DesignSystem }) {
  return (
    <div>
      <Section title="Summary" aside={<Badge tone={d.source === "ai" ? "accent" : "neutral"}>{d.source === "ai" ? "Synthesised by Claude" : "Measured"}</Badge>}>
        <Markdown text={d.summary} className="text-[13px] leading-6 text-fg-2" />
        {d.personality.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{d.personality.map((p) => <Badge key={p}>{p}</Badge>)}</div>}
      </Section>
      {d.colors.length > 0 && (
        <Section title="Color">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">{d.colors.map((c) => <Swatch key={c.hex + c.name} hex={c.hex} label={c.name} sub={c.role} />)}</div>
        </Section>
      )}
      {d.typography.length > 0 && (
        <Section title="Typography">
          <div className="grid gap-3 sm:grid-cols-2">
            {d.typography.map((t) => (
              <div key={t.family + t.role} className="rounded-lg border border-line p-3">
                <div className="truncate text-2xl text-fg" style={{ fontFamily: `"${t.family}", ${t.fallback.includes("serif") && !t.fallback.includes("sans") ? "serif" : "sans-serif"}` }}>{t.family}</div>
                <div className="mt-1 text-xs text-fg-2">{t.role} · weights {t.weights.join(", ") || "—"}</div>
                <div className="mt-0.5 text-xs text-fg-3">{t.source} · fallback {t.fallback}</div>
                {t.notes && <div className="mt-1 text-xs text-fg-3">{t.notes}</div>}
              </div>
            ))}
          </div>
          {d.typeScale.length > 0 && (
            <table className="mt-4 w-full text-left text-xs">
              <thead className="text-fg-3">
                <tr className="border-b border-line">
                  {["Token", "Size", "Line height", "Weight", "Tracking", "Transform"].map((h) => <th key={h} className="py-1.5 pr-3 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody className="font-mono text-[11px] text-fg-2">
                {d.typeScale.map((t) => (
                  <tr key={t.token} className="border-b border-line/60">
                    <td className="py-1.5 pr-3 font-sans text-fg">{t.token}</td>
                    <td className="pr-3">{t.size}</td>
                    <td className="pr-3">{t.lineHeight}</td>
                    <td className="pr-3">{t.weight}</td>
                    <td className="pr-3">{t.letterSpacing}</td>
                    <td className="pr-3">{t.transform}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
      <Section title="Layout & spacing">
        <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <div><span className="text-fg-3">Container</span> <span className="font-mono text-fg-2">{d.spacing.containerMaxWidth || "—"}</span></div>
          <div><span className="text-fg-3">Section padding</span> <span className="font-mono text-fg-2">{d.spacing.sectionPaddingY || "—"}</span></div>
          <div><span className="text-fg-3">Gutter</span> <span className="font-mono text-fg-2">{d.spacing.gutter || "—"}</span></div>
        </div>
        {d.spacing.notes && <p className="mt-2 text-xs text-fg-3">{d.spacing.notes}</p>}
        {d.layoutPatterns.length > 0 && <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-xs text-fg-2 marker:text-fg-4">{d.layoutPatterns.slice(0, 16).map((l, i) => <li key={i}>{l}</li>)}</ol>}
        {(d.radii.length > 0 || d.shadows.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {d.radii.map((r) => <Badge key={r}>radius {r}</Badge>)}
            {d.shadows.map((s) => <Badge key={s} className="max-w-full truncate">shadow {s}</Badge>)}
          </div>
        )}
      </Section>
      {d.components.length > 0 && (
        <Section title="Components">
          <div className="space-y-2">{d.components.map((c, i) => <div key={i} className="text-xs"><span className="font-medium text-fg">{c.name}</span> <span className="text-fg-2">— {c.description}</span></div>)}</div>
        </Section>
      )}
      {d.motion.length > 0 && (
        <Section title="Motion & interaction">
          <div className="space-y-2">
            {d.motion.map((m, i) => (
              <div key={i} className="grid gap-x-4 text-xs sm:grid-cols-[180px_1fr]">
                <span className="font-medium text-fg">{m.name}</span>
                <span className="text-fg-2">{m.description}<span className="text-fg-3"> · {m.implementation}</span></span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title="Imagery & navigation">
        <div className="grid gap-4 text-xs sm:grid-cols-2">
          <div className="space-y-1 text-fg-2">
            <div>{d.imagery.style || "—"}</div>
            <div className="text-fg-3">{d.imagery.treatment}</div>
            {d.imagery.aspectRatios.length > 0 && <div className="flex flex-wrap gap-1 pt-1">{d.imagery.aspectRatios.map((r) => <Badge key={r}>{r}</Badge>)}</div>}
          </div>
          <div className="space-y-1 text-fg-2">
            <div><span className="text-fg-3">Desktop</span> {d.navigation.desktop || "—"}</div>
            <div><span className="text-fg-3">Mobile</span> {d.navigation.mobile || "—"}</div>
            {d.navigation.items.length > 0 && <div className="flex flex-wrap gap-1 pt-1">{d.navigation.items.map((n, i) => <Badge key={i}>{n}</Badge>)}</div>}
          </div>
        </div>
      </Section>
      {d.pages.length > 0 && (
        <Section title={`Page map · ${d.pages.length}`}>
          <div className="space-y-2">
            {d.pages.map((p) => (
              <div key={p.path} className="rounded-md border border-line px-3 py-2 text-xs">
                <div className="flex items-baseline gap-2"><span className="font-mono text-fg">{p.path}</span><span className="text-fg-2">{p.title}</span><span className="ml-auto text-fg-3">{p.purpose}</span></div>
                {p.sections.length > 0 && <div className="mt-1 text-fg-3">{p.sections.join(" → ")}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {d.responsive.length > 0 && (
        <Section title="Responsive behaviour">
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-2 marker:text-fg-4">{d.responsive.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}

function PageView({ page }: { page: AnalysisPage }) {
  const shots = (["desktop", "tablet", "mobile", "mobileMenu"] as const).filter((k) => page.screenshots[k]);
  const [shot, setShot] = useState<(typeof shots)[number]>(shots[0] ?? "desktop");
  const ex = page.extraction;
  const s = page.screenshots[shot];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Segmented size="sm" value={shot} onChange={setShot} options={shots.map((k) => ({ value: k, label: k === "mobileMenu" ? "Mobile menu" : k[0].toUpperCase() + k.slice(1) }))} />
          {s && <span className="font-mono text-2xs text-fg-3">{s.width}×{s.height}{s.truncated ? " (truncated)" : ""}</span>}
        </div>
        <div className="checker max-h-[calc(100vh-220px)] overflow-y-auto rounded-lg border border-line">
          {s ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(s.key)} alt={`${page.path} ${shot}`} className={cx("mx-auto block", shot === "desktop" ? "w-full" : "w-[390px] max-w-full")} />
          ) : (
            <Empty title="No screenshot" />
          )}
        </div>
      </div>
      <div className="min-w-0 text-xs">
        {ex && (
          <>
            <Section title="Pixel palette">
              <div className="flex h-6 overflow-hidden rounded-md border border-white/10">
                {(ex.screenshotPalette ?? []).map((c) => <div key={c.hex} title={`${c.hex} · ${(c.weight * 100).toFixed(1)}%`} style={{ background: c.hex, flexGrow: c.weight }} />)}
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {[
                  ...ex.colors.background.slice(0, 4).map((c) => ({ ...c, use: "background" })),
                  ...ex.colors.text.slice(0, 3).map((c) => ({ ...c, use: "text" })),
                  ...ex.colors.accent.slice(0, 2).map((c) => ({ ...c, use: "accent" })),
                ]
                  .filter((c, i, all) => all.findIndex((x) => x.hex === c.hex) === i)
                  .map((c) => <Swatch key={c.hex} hex={c.hex} sub={c.use} />)}
              </div>
            </Section>
            <Section title={`Type styles · ${ex.typography.length}`}>
              <div className="space-y-1.5">
                {ex.typography.slice(0, 12).map((t, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <span className="w-14 shrink-0 font-mono text-[11px] text-fg-3">{t.role}</span>
                    <span className="truncate text-fg-2">{t.fontFamily.split(",")[0].replace(/["']/g, "")}</span>
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-3">{t.fontSize}/{t.lineHeight} · {t.fontWeight}{t.textTransform !== "none" ? ` · ${t.textTransform}` : ""}</span>
                  </div>
                ))}
              </div>
              {ex.fonts.faces.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{[...new Set(ex.fonts.faces.map((f) => `${f.family} · ${f.provider}`))].slice(0, 8).map((f) => <Badge key={f}>{f}</Badge>)}</div>}
            </Section>
            <Section title={`Sections · ${page.sections.length}`}>
              <div className="space-y-2">
                {page.sections.map((sec) => (
                  <div key={sec.index} className="flex gap-2.5">
                    <div className="checker h-12 w-20 shrink-0 overflow-hidden rounded border border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {sec.cropKey && <img src={mediaUrl(sec.cropKey)} alt="" className="size-full object-cover object-top" loading="lazy" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5"><span className="font-medium text-fg">{sec.kind}</span><span className="font-mono text-[11px] text-fg-3">{sec.height}px{sec.columns > 1 ? ` · ${sec.columns} cols` : ""}</span><span className="size-2.5 rounded-sm border border-white/15" style={{ background: sec.background }} /></div>
                      <div className="truncate text-fg-3">{sec.headings[0] ?? sec.excerpt}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Motion">
              <div className="space-y-1 text-fg-2">
                {ex.animations.scrollReveals.slice(0, 4).map((r, i) => <div key={i}>Reveal ×{r.count} <span className="text-fg-3">{r.selector}: {r.from.opacity}→{r.to.opacity}, {r.from.transform}→{r.to.transform}</span></div>)}
                {ex.animations.hoverEffects.slice(0, 4).map((h, i) => <div key={i}>Hover <span className="text-fg-3">{h.selector}: {Object.keys(h.changes).join(", ")}</span></div>)}
                {ex.animations.parallax.map((p, i) => <div key={i}>Parallax <span className="text-fg-3">{p.selector} × {p.ratio}</span></div>)}
                {ex.animations.sticky.map((p, i) => <div key={i}>Sticky <span className="text-fg-3">{p.selector} ({p.position})</span></div>)}
                {ex.animations.marquees > 0 && <div>Marquee <span className="text-fg-3">×{ex.animations.marquees}</span></div>}
                {ex.animations.libraries.length > 0 && <div>Libraries <span className="text-fg-3">{ex.animations.libraries.join(", ")}</span></div>}
                {!ex.animations.scrollReveals.length && !ex.animations.hoverEffects.length && !ex.animations.parallax.length && <div className="text-fg-3">No significant motion measured.</div>}
              </div>
            </Section>
            <Section title="Components">
              <div className="space-y-1 text-fg-2">
                {ex.buttons.slice(0, 4).map((b, i) => <div key={i} className="truncate">“{b.text}” <span className="text-fg-3">bg {b.background} · border {b.border} · r {b.radius} · {b.padding}</span></div>)}
                <div>Header <span className="text-fg-3">{ex.navigation.header.position || "static"} · {ex.navigation.header.height}px · {ex.navigation.header.links.length} links</span></div>
                <div>Media <span className="text-fg-3">{ex.images} images · {ex.videos} videos</span></div>
                {ex.forms.length > 0 && <div>Forms <span className="text-fg-3">{ex.forms.length}</span></div>}
                {(ex.tech.framework.length > 0 || ex.tech.generator) && <div>Built with <span className="text-fg-3">{[...ex.tech.framework, ex.tech.generator].filter(Boolean).join(", ")}</span></div>}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

export function AnalysisView({ projectId, reloadSignal, canGenerate, hasFiles, onGenerate, onReanalyze, busy }: { projectId: string; reloadSignal: number; canGenerate: boolean; hasFiles: boolean; onGenerate: () => void; onReanalyze: (refId?: string) => void; busy: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<{ kind: "design" } | { kind: "ref"; refId: string; pageId?: string }>({ kind: "design" });
  useEffect(() => {
    api<Data>(`/api/projects/${projectId}/analysis`).then(setData).catch(() => setData({ design: null, references: [] }));
  }, [projectId, reloadSignal]);

  const current = useMemo(() => {
    if (!data || sel.kind !== "ref") return null;
    const ref = data.references.find((r) => r.id === sel.refId);
    const page = ref?.pages.find((p) => p.id === sel.pageId) ?? ref?.pages[0];
    return ref ? { ref, page } : null;
  }, [data, sel]);

  if (!data) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-60 shrink-0 overflow-y-auto border-r border-line bg-panel py-2">
        <button onClick={() => setSel({ kind: "design" })} className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]", sel.kind === "design" ? "bg-hover text-fg" : "text-fg-2 hover:text-fg")}>
          <Palette className="size-3.5 text-fg-3" /> Design system
        </button>
        {data.references.map((r) => (
          <div key={r.id} className="mt-3">
            <div className="flex items-center gap-1.5 px-3 pb-1 text-2xs text-fg-3">
              {r.kind === "url" ? <Globe className="size-3" /> : <FileImage className="size-3" />}
              <span className="truncate">{r.kind === "url" ? (r.url ?? "").replace(/^https?:\/\/(www\.)?/, "") : r.title ?? "Screenshot"}</span>
              {r.status !== "done" && <Badge tone={r.status === "error" || r.status === "blocked" ? "bad" : "accent"} className="ml-auto">{r.status}</Badge>}
            </div>
            {r.kind === "url" ? (
              r.pages.map((p) => (
                <button key={p.id} onClick={() => setSel({ kind: "ref", refId: r.id, pageId: p.id })} className={cx("block w-full truncate py-1 pr-3 pl-7 text-left font-mono text-xs", current?.page?.id === p.id ? "bg-hover text-fg" : "text-fg-2 hover:text-fg")}>
                  {p.path}
                </button>
              ))
            ) : (
              <button onClick={() => setSel({ kind: "ref", refId: r.id })} className={cx("block w-full py-1 pr-3 pl-7 text-left text-xs", current?.ref.id === r.id ? "bg-hover text-fg" : "text-fg-2 hover:text-fg")}>View screenshot</button>
            )}
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-6">
          {sel.kind === "design" ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Design analysis</h2>
                  <p className="text-xs text-fg-3">What Tessera measured on your references, and the design system the generator follows.</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => onReanalyze()} disabled={busy}>Re-analyse</Button>
                  {canGenerate && <Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} onClick={onGenerate} disabled={busy}>{hasFiles ? "Regenerate website" : "Generate website"}</Button>}
                </div>
              </div>
              {data.design ? <DesignSystemView d={data.design} /> : <Empty icon={<Sparkles className="size-4" />} title="No design analysis yet">Run the analysis to measure your references.</Empty>}
            </>
          ) : current ? (
            <>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold tracking-tight">{current.page?.title || current.ref.title || current.ref.url}</h2>
                    {current.ref.url && <a href={current.page?.url ?? current.ref.url} target="_blank" rel="noreferrer" className="text-fg-3 hover:text-fg"><ExternalLink className="size-3.5" /></a>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">{current.ref.roles.map((r) => <Badge key={r} tone="accent">{roleLabel(r)}</Badge>)}</div>
                </div>
                <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => onReanalyze(current.ref.id)} disabled={busy}>Re-analyse</Button>
              </div>
              {(current.ref.status === "error" || current.ref.status === "blocked") && (
                <div className="mb-4 flex gap-2 rounded-lg border border-bad/25 bg-bad/5 px-3 py-2 text-xs text-fg-2"><AlertTriangle className="size-4 shrink-0 text-bad" />{current.ref.error}</div>
              )}
              {current.ref.analysis?.skipped?.length ? <p className="mb-4 text-xs text-fg-3">Skipped: {current.ref.analysis.skipped.slice(0, 6).map((s) => `${new URL(s.url).pathname} (${s.reason})`).join(" · ")}</p> : null}
              {current.ref.kind === "image" && current.ref.storageKey ? (
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(current.ref.storageKey)} alt="Screenshot reference" className="w-full rounded-lg border border-line" />
                  <div>{current.ref.analysis?.palette && <Section title="Palette"><div className="grid grid-cols-3 gap-2">{current.ref.analysis.palette.map((c) => <Swatch key={c.hex} hex={c.hex} sub={`${(c.weight * 100).toFixed(0)}%`} />)}</div></Section>}</div>
                </div>
              ) : current.page ? (
                <PageView key={current.page.id} page={current.page} />
              ) : (
                <Empty title="No pages captured yet" />
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
