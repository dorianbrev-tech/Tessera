"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileImage, Globe, Inbox, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge, Button, Input, Label, Modal, Segmented, Textarea, Toggle } from "@/components/ui";
import { api, ApiError, cx, mediaUrl, timeAgo } from "@/lib/client";
import { REFERENCE_ROLES, type ProjectSettings, type ReferenceRole } from "@/lib/types";
import type { ProjectData, ReferenceSummary } from "./types";

function Roles({ value, onChange }: { value: ReferenceRole[]; onChange: (r: ReferenceRole[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {REFERENCE_ROLES.map((r) => {
        const on = value.includes(r.id);
        return (
          <button key={r.id} title={r.description} onClick={() => { const next = on ? value.filter((x) => x !== r.id) : r.id === "full" ? ["full" as const] : [...value.filter((x) => x !== "full"), r.id]; if (next.length) onChange(next); }}
            className={cx("h-6 rounded-md border px-2 text-xs transition-colors", on ? "border-accent/40 bg-accent-soft text-accent" : "border-line-strong text-fg-3 hover:text-fg-2")}>
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="border-b border-line px-5 py-3.5">
        <h3 className="text-[13px] font-medium">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

export function SettingsView({ data, onChanged, onReanalyze, busy }: { data: ProjectData; onChanged: () => void; onReanalyze: (refIds?: string[]) => void; busy: boolean }) {
  const router = useRouter();
  const p = data.project;
  const [name, setName] = useState(p.name);
  const [brief, setBrief] = useState(p.brief);
  const [settings, setSettings] = useState<ProjectSettings>(p.settings);
  const [saving, setSaving] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newRoles, setNewRoles] = useState<ReferenceRole[]>(["identity"]);
  const [error, setError] = useState<string | null>(null);
  const [subs, setSubs] = useState<{ id: string; formName: string | null; data: Record<string, string>; strippedFields: string[]; createdAt: string }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ submissions: typeof subs }>(`/api/projects/${p.id}/forms`).then((d) => setSubs(d.submissions)).catch(() => {});
  }, [p.id]);

  const dirty = name !== p.name || brief !== p.brief || JSON.stringify(settings) !== JSON.stringify(p.settings);
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/projects/${p.id}`, { method: "PATCH", json: { name, brief, settings } });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    }
    setSaving(false);
  }

  async function updateRef(r: ReferenceSummary, patch: Partial<Pick<ReferenceSummary, "roles" | "notes">>) {
    await api(`/api/projects/${p.id}/references/${r.id}`, { method: "PATCH", json: patch }).catch(() => {});
    onChanged();
  }

  async function addRef() {
    setError(null);
    try {
      await api(`/api/projects/${p.id}/references`, { method: "POST", json: { url: newUrl, roles: newRoles } });
      setNewUrl("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add reference");
    }
  }

  async function uploadRef(files: FileList | null) {
    if (!files?.[0]) return;
    const fd = new FormData();
    fd.append("file", files[0]);
    fd.append("purpose", "reference");
    fd.append("roles", newRoles.join(","));
    try {
      await api(`/api/projects/${p.id}/uploads`, { method: "POST", body: fd });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    }
  }

  const pending = data.references.filter((r) => r.status === "pending").map((r) => r.id);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
        <Card title="Project">
          <div>
            <Label htmlFor="pname">Name</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pbrief" hint="Used as context for every AI request">Brief</Label>
            <Textarea id="pbrief" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} />
          </div>
        </Card>

        <Card title="References" description="Each reference contributes only the aspects you assign to it.">
          {data.references.map((r) => (
            <div key={r.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                {r.kind === "url" ? <Globe className="size-3.5 shrink-0 text-fg-3" /> : <FileImage className="size-3.5 shrink-0 text-fg-3" />}
                <span className="min-w-0 flex-1 truncate text-[13px]">{r.kind === "url" ? r.url : r.title}</span>
                <Badge tone={r.status === "done" ? "ok" : r.status === "error" || r.status === "blocked" ? "bad" : r.status === "analyzing" ? "accent" : "neutral"}>{r.status}</Badge>
                <button aria-label="Remove reference" onClick={async () => { await api(`/api/projects/${p.id}/references/${r.id}`, { method: "DELETE" }); onChanged(); }} className="text-fg-3 hover:text-bad"><Trash2 className="size-3.5" /></button>
              </div>
              {r.kind === "image" && r.storageKey && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(r.storageKey)} alt="" className="mt-2 h-20 rounded border border-line object-cover object-top" />
              )}
              {r.error && <p className="mt-2 text-xs text-bad">{r.error}</p>}
              <div className="mt-3"><Roles value={r.roles} onChange={(roles) => updateRef(r, { roles })} /></div>
              <Input className="mt-2 h-8 text-xs" placeholder="Notes for the AI (optional)" defaultValue={r.notes} onBlur={(e) => e.target.value !== r.notes && updateRef(r, { notes: e.target.value })} />
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-line-strong p-3">
            <div className="flex gap-2">
              <Input placeholder="Add a reference URL…" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newUrl && addRef()} />
              <Button icon={<Plus className="size-3.5" />} onClick={addRef} disabled={!newUrl}>Add</Button>
              <Button variant="ghost" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()} title="Upload a screenshot reference">Image</Button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => uploadRef(e.target.files)} />
            </div>
            <div className="mt-2"><Roles value={newRoles} onChange={setNewRoles} /></div>
          </div>
          {pending.length > 0 && (
            <Button size="sm" variant="accent" icon={<RefreshCw className="size-3.5" />} disabled={busy} onClick={() => onReanalyze(pending)}>
              Analyse {pending.length} new reference{pending.length > 1 ? "s" : ""}
            </Button>
          )}
        </Card>

        <Card title="Analysis & generation">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label hint={`${settings.maxPages}`}>Pages per reference</Label>
              <input type="range" min={1} max={20} value={settings.maxPages} onChange={(e) => set("maxPages", Number(e.target.value))} className="w-full accent-[var(--color-accent-strong)]" />
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
              <Segmented size="sm" value={settings.imageStrategy} onChange={(v) => set("imageStrategy", v)} options={[{ value: "auto", label: "Auto" }, { value: "reference", label: "Reference" }, { value: "stock", label: "Stock" }, { value: "generate", label: "AI" }]} />
            </div>
          </div>
          <Toggle checked={settings.autoGenerate} onChange={(v) => set("autoGenerate", v)} label="Generate automatically after analysis" />
          <Toggle checked={settings.reuseMedia} onChange={(v) => set("reuseMedia", v)} label="Reuse images from the references" description="Only when you own them or have permission." />
          <Toggle checked={settings.rightsConfirmed} onChange={(v) => set("rightsConfirmed", v)} label="I own or have permission to recreate the referenced sites" description="Required for the Full recreation role." />
        </Card>

        <Card title={`Form submissions · ${subs.length}`} description="Forms on generated sites post here. Password and card fields are always discarded.">
          {subs.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-fg-3"><Inbox className="size-3.5" /> No submissions yet.</div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {subs.map((s) => (
                <div key={s.id} className="rounded-md border border-line px-3 py-2 text-xs">
                  <div className="mb-1 flex justify-between text-fg-3"><span>{s.formName}</span><span>{timeAgo(s.createdAt)}</span></div>
                  {Object.entries(s.data).map(([k, v]) => <div key={k}><span className="text-fg-3">{k}:</span> <span className="text-fg-2">{v}</span></div>)}
                  {s.strippedFields.length > 0 && <div className="mt-1 text-warn">Discarded sensitive fields: {s.strippedFields.join(", ")}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Danger zone">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-fg-3">Deleting removes the project, its versions, analyses and published site.</p>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete project</Button>
          </div>
        </Card>

        {error && <p className="text-xs text-bad">{error}</p>}
        <div className={cx("sticky bottom-4 flex justify-end transition-opacity", dirty ? "opacity-100" : "pointer-events-none opacity-0")}>
          <div className="flex gap-2 rounded-lg border border-line-strong bg-overlay p-2 shadow-xl">
            <Button variant="ghost" size="sm" onClick={() => { setName(p.name); setBrief(p.brief); setSettings(p.settings); }}>Discard</Button>
            <Button variant="primary" size="sm" loading={saving} onClick={save}>Save changes</Button>
          </div>
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete project"
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={async () => { await api(`/api/projects/${p.id}`, { method: "DELETE" }); router.push("/dashboard"); }}>Delete permanently</Button></>}>
        <p className="text-[13px] text-fg-2">“{p.name}” will be permanently deleted.</p>
      </Modal>
    </div>
  );
}
