"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Copy, FileImage, Globe, Layers, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Badge, Button, Input, Label, Segmented, Textarea, Toggle } from "@/components/ui";
import { api, ApiError, cx } from "@/lib/client";
import { DEFAULT_SETTINGS, REFERENCE_ROLES, type ProjectSettings, type ReferenceRole, type Viewport } from "@/lib/types";

type Mode = "recreate" | "combine" | "prompt" | "screenshots";
type Caps = { ai: boolean; model: string; stockImages: boolean; imageGeneration: string | null; storage: string };

const MODES: { id: Mode; title: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "recreate", title: "Recreate a website", desc: "Paste a URL. Every page is analysed and rebuilt as closely as possible.", icon: Copy },
  { id: "combine", title: "Combine references", desc: "Take different qualities from several sites and merge them into one.", icon: Layers },
  { id: "prompt", title: "Describe a website", desc: "Start from a brief. Optionally point at sites you like.", icon: Sparkles },
  { id: "screenshots", title: "From screenshots", desc: "Upload designs or screenshots as the visual reference.", icon: FileImage },
];

type RefRow = { url: string; roles: ReferenceRole[]; notes: string };
type Shot = { file: File; preview: string; roles: ReferenceRole[] };

function RolePicker({ value, onChange }: { value: ReferenceRole[]; onChange: (r: ReferenceRole[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {REFERENCE_ROLES.map((r) => {
        const on = value.includes(r.id);
        return (
          <button
            key={r.id}
            type="button"
            title={r.description}
            onClick={() => onChange(on ? value.filter((x) => x !== r.id) : r.id === "full" ? ["full"] : [...value.filter((x) => x !== "full"), r.id])}
            className={cx(
              "h-6 rounded-md border px-2 text-xs transition-colors",
              on ? "border-accent/40 bg-accent-soft text-accent" : "border-line-strong text-fg-3 hover:border-[#3a3a44] hover:text-fg-2",
            )}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

export function NewProject({ capabilities }: { capabilities: Caps }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("recreate");
  const [url, setUrl] = useState("");
  const [refs, setRefs] = useState<RefRow[]>([
    { url: "", roles: ["identity", "colors"], notes: "" },
    { url: "", roles: ["navigation", "layout"], notes: "" },
  ]);
  const [brief, setBrief] = useState("");
  const [name, setName] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [settings, setSettings] = useState<ProjectSettings>({ ...DEFAULT_SETTINGS });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const needsRights = mode === "recreate" || (mode === "combine" && refs.some((r) => r.url && r.roles.includes("full")));
  const promptRefs = refs.filter((r) => r.url.trim());

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 8 - shots.length).map((file) => ({ file, preview: URL.createObjectURL(file), roles: ["full"] as ReferenceRole[] }));
    setShots((s) => [...s, ...next]);
  }

  async function submit() {
    setError(null);
    let references: RefRow[] = [];
    if (mode === "recreate") {
      if (!url.trim()) return setError("Enter the URL of the website to recreate.");
      references = [{ url: url.trim(), roles: ["full"], notes: "" }];
    } else if (mode === "combine") {
      references = refs.filter((r) => r.url.trim());
      if (references.length < 1) return setError("Add at least one reference URL.");
      if (references.some((r) => !r.roles.length)) return setError("Give every reference at least one role.");
    } else if (mode === "prompt") {
      if (!brief.trim()) return setError("Describe the website you want.");
      references = promptRefs;
    } else if (mode === "screenshots") {
      if (!shots.length) return setError("Upload at least one screenshot.");
    }
    if (needsRights && !settings.rightsConfirmed) return setError("Please confirm you have the right to recreate this website.");
    setSubmitting(true);
    try {
      setStage("Creating project…");
      const { project, warning } = await api<{ project: { id: string }; warning: string | null }>("/api/projects", {
        method: "POST",
        json: { mode, name: name.trim() || undefined, brief, references, settings, start: mode !== "screenshots" },
      });
      if (mode === "screenshots") {
        for (const [i, s] of shots.entries()) {
          setStage(`Uploading screenshot ${i + 1}/${shots.length}…`);
          const fd = new FormData();
          fd.append("file", s.file);
          fd.append("purpose", "reference");
          fd.append("roles", s.roles.join(","));
          await api(`/api/projects/${project.id}/uploads`, { method: "POST", body: fd });
        }
        setStage("Starting analysis…");
        await api(`/api/projects/${project.id}/analyze`, { method: "POST", json: {} });
      }
      if (warning) sessionStorage.setItem(`tessera-warning-${project.id}`, warning);
      router.push(`/p/${project.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the project.");
      setSubmitting(false);
      setStage("");
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">New project</h1>
      <p className="mt-1 text-[13px] text-fg-3">Choose how to start. You can add references, change roles and keep editing afterwards.</p>

      {!capabilities.ai && (
        <div className="mt-6 flex gap-3 rounded-lg border border-warn/25 bg-warn/5 px-4 py-3 text-xs leading-5 text-fg-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <div>
            <span className="font-medium text-fg">Claude isn’t configured on this server.</span> Website analysis still runs and produces a measured design system, but generation and AI edits need <code className="rounded bg-overlay px-1 font-mono text-[11px]">ANTHROPIC_API_KEY</code> in the server environment.
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cx(
              "rounded-lg border p-3 text-left transition-colors",
              mode === m.id ? "border-accent/50 bg-accent-soft" : "border-line bg-panel hover:border-line-strong",
            )}
          >
            <m.icon className={cx("size-4", mode === m.id ? "text-accent" : "text-fg-3")} />
            <div className="mt-3 text-[13px] font-medium">{m.title}</div>
            <div className="mt-1 text-xs leading-4 text-fg-3">{m.desc}</div>
          </button>
        ))}
      </div>

      <section className="mt-8 space-y-6">
        {mode === "recreate" && (
          <div>
            <Label htmlFor="url">Website URL</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" />
              <Input id="url" autoFocus placeholder="https://www.example.com" value={url} onChange={(e) => setUrl(e.target.value)} className="h-11 pl-9 text-sm" onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            <p className="mt-2 text-xs text-fg-3">The homepage and up to {settings.maxPages} internal pages are captured at desktop, tablet and mobile.</p>
          </div>
        )}

        {mode === "combine" && (
          <div className="space-y-3">
            <Label hint="Each reference contributes only the roles you give it">References</Label>
            {refs.map((r, i) => (
              <div key={i} className="rounded-lg border border-line bg-panel p-3">
                <div className="flex gap-2">
                  <span className="flex h-9 w-6 shrink-0 items-center justify-center font-mono text-xs text-fg-4">{i + 1}</span>
                  <Input placeholder="https://…" value={r.url} onChange={(e) => setRefs((rs) => rs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                  <Button variant="ghost" aria-label="Remove reference" onClick={() => setRefs((rs) => rs.filter((_, j) => j !== i))} disabled={refs.length <= 1} className="h-9 px-2">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="mt-3 pl-8">
                  <RolePicker value={r.roles} onChange={(roles) => setRefs((rs) => rs.map((x, j) => (j === i ? { ...x, roles } : x)))} />
                  <Input className="mt-2 h-8 text-xs" placeholder="Notes (optional) — e.g. “only the product grid and hover effects”" value={r.notes} onChange={(e) => setRefs((rs) => rs.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} />
                </div>
              </div>
            ))}
            {refs.length < 6 && (
              <Button variant="ghost" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRefs((rs) => [...rs, { url: "", roles: ["typography"], notes: "" }])}>
                Add reference
              </Button>
            )}
          </div>
        )}

        {mode === "screenshots" && (
          <div>
            <Label hint="PNG, JPEG or WebP · up to 8">Screenshots</Label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInput.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-panel px-6 py-10 text-center transition-colors hover:border-accent/40"
            >
              <Upload className="size-5 text-fg-3" />
              <div className="mt-2 text-[13px]">Drop images here or click to browse</div>
              <div className="mt-1 text-xs text-fg-3">Full-page screenshots give the best results.</div>
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            </div>
            {shots.length > 0 && (
              <div className="mt-3 space-y-2">
                {shots.map((s, i) => (
                  <div key={i} className="flex gap-3 rounded-lg border border-line bg-panel p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.preview} alt="" className="h-16 w-24 shrink-0 rounded object-cover object-top" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-xs text-fg-2">{s.file.name}</span>
                        <button aria-label="Remove" onClick={() => setShots((xs) => xs.filter((_, j) => j !== i))} className="text-fg-3 hover:text-fg"><X className="size-3.5" /></button>
                      </div>
                      <div className="mt-2"><RolePicker value={s.roles} onChange={(roles) => setShots((xs) => xs.map((x, j) => (j === i ? { ...x, roles } : x)))} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="brief" hint={mode === "prompt" ? "Required" : "Optional"}>
            {mode === "prompt" ? "Describe the website" : "Brief"}
          </Label>
          <Textarea
            id="brief"
            rows={mode === "prompt" ? 6 : 3}
            placeholder={
              mode === "prompt"
                ? "A website for an independent perfume house in Grasse: editorial, warm and sensory. Pages: home, collection, single fragrance, the atelier, journal, contact…"
                : "Anything to change or emphasise — brand name, audience, pages to add, tone of voice…"
            }
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          {mode === "prompt" && (
            <div className="mt-3">
              <Label hint="Optional">Sites you like</Label>
              <div className="space-y-2">
                {refs.slice(0, 3).map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input placeholder="https://…" value={r.url} onChange={(e) => setRefs((rs) => rs.map((x, j) => (j === i ? { ...x, url: e.target.value, roles: ["identity"] } : x)))} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="name" hint="Optional">Project name</Label>
          <Input id="name" placeholder="Derived from the URL or brief" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="rounded-lg border border-line">
          <button onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center justify-between px-4 py-3 text-[13px] text-fg-2 hover:text-fg">
            <span>Analysis &amp; generation options</span>
            <span className="text-xs text-fg-3">{advanced ? "Hide" : `${settings.maxPages} pages · target ${settings.fidelityTarget} · ${settings.reuseMedia ? "reuse media" : "new media"}`}</span>
          </button>
          {advanced && (
            <div className="grid gap-5 border-t border-line px-4 py-4 sm:grid-cols-2">
              <div>
                <Label hint={`${settings.maxPages}`}>Pages to analyse per site</Label>
                <input type="range" min={1} max={20} value={settings.maxPages} onChange={(e) => set("maxPages", Number(e.target.value))} className="w-full accent-[var(--color-accent-strong)]" />
              </div>
              <div>
                <Label>Viewports</Label>
                <Segmented
                  size="sm"
                  value={settings.viewports.join(",")}
                  onChange={(v) => set("viewports", v.split(",") as Viewport[])}
                  options={[
                    { value: "desktop", label: "Desktop" },
                    { value: "desktop,mobile", label: "+ Mobile" },
                    { value: "desktop,tablet,mobile", label: "All three" },
                  ]}
                />
              </div>
              <div>
                <Label hint={`${settings.fidelityTarget}/100`}>Fidelity target</Label>
                <input type="range" min={60} max={98} value={settings.fidelityTarget} onChange={(e) => set("fidelityTarget", Number(e.target.value))} className="w-full accent-[var(--color-accent-strong)]" />
              </div>
              <div>
                <Label hint={`${settings.fidelityIterations}`}>Correction rounds per page</Label>
                <input type="range" min={0} max={5} value={settings.fidelityIterations} onChange={(e) => set("fidelityIterations", Number(e.target.value))} className="w-full accent-[var(--color-accent-strong)]" />
              </div>
              <div>
                <Label>Images</Label>
                <Segmented
                  size="sm"
                  value={settings.imageStrategy}
                  onChange={(v) => set("imageStrategy", v)}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "reference", label: "Reference" },
                    { value: "stock", label: "Stock", title: capabilities.stockImages ? "" : "Needs UNSPLASH_ACCESS_KEY or PEXELS_API_KEY" },
                    { value: "generate", label: "AI", title: capabilities.imageGeneration ? "" : "Needs OPENAI_API_KEY or REPLICATE_API_TOKEN" },
                  ]}
                />
              </div>
              <div className="space-y-3 sm:col-span-2">
                <Toggle checked={settings.autoGenerate} onChange={(v) => set("autoGenerate", v)} label="Generate automatically after analysis" description="Turn off to review the design analysis first." disabled={!capabilities.ai} />
                <Toggle checked={settings.reuseMedia} onChange={(v) => set("reuseMedia", v)} label="Reuse images from the references" description="Only when you own them or have permission. Otherwise stock or AI images are used." />
              </div>
            </div>
          )}
        </div>

        {needsRights && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <input type="checkbox" checked={settings.rightsConfirmed} onChange={(e) => set("rightsConfirmed", e.target.checked)} className="mt-0.5 accent-[var(--color-accent-strong)]" />
            <span className="text-xs leading-5 text-fg-2">
              I own this website, or I have permission to recreate its design and reuse its content. I won’t use the result to impersonate another brand.
            </span>
          </label>
        )}

        {error && <p className="rounded-md border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

        <div className="flex items-center justify-between border-t border-line pt-6">
          <div className="text-xs text-fg-3">
            {capabilities.ai ? <>Generation by <Badge>{capabilities.model}</Badge></> : "Analysis only until Claude is configured"}
          </div>
          <Button variant="primary" size="lg" loading={submitting} onClick={submit}>
            {submitting ? stage : mode === "recreate" ? "Analyse & recreate" : mode === "prompt" ? "Generate website" : "Analyse references"}
            {!submitting && <ArrowRight className="size-4" />}
          </Button>
        </div>
      </section>
    </main>
  );
}
