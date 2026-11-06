"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Copy, Globe, LayoutGrid, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Empty, Input, Menu, MenuItem, Modal, Spinner } from "@/components/ui";
import { api, ApiError, mediaUrl, timeAgo } from "@/lib/client";

type ProjectRow = {
  id: string;
  name: string;
  mode: string;
  status: string;
  thumbnailKey: string | null;
  publishedSlug: string | null;
  updatedAt: string;
  fileCount: number;
  refs: string[];
};

export const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "bad" }> = {
  draft: { label: "Draft", tone: "neutral" },
  analyzing: { label: "Analysing", tone: "accent" },
  analyzed: { label: "Analysed", tone: "neutral" },
  generating: { label: "Building", tone: "accent" },
  ready: { label: "Ready", tone: "ok" },
  error: { label: "Needs attention", tone: "bad" },
};

const MODE: Record<string, string> = { recreate: "Recreation", combine: "Multi-reference", prompt: "From brief", screenshots: "From screenshots" };

export function ProjectGrid() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [renaming, setRenaming] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    const data = await api<{ projects: ProjectRow[] }>("/api/projects");
    setProjects(data.projects);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function duplicate(p: ProjectRow) {
    const { project } = await api<{ project: { id: string } }>(`/api/projects/${p.id}/duplicate`, { method: "POST" });
    await load();
    router.push(`/p/${project.id}`);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-[13px] text-fg-3">Recreations, combinations and original sites — all saved automatically.</p>
        </div>
        <Link href="/new">
          <Button variant="primary" icon={<Plus className="size-4" />}>New project</Button>
        </Link>
      </div>

      {projects === null ? (
        <div className="flex justify-center py-24"><Spinner /></div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong">
          <Empty icon={<LayoutGrid className="size-4" />} title="No projects yet" action={<Link href="/new"><Button variant="primary" icon={<Plus className="size-4" />}>Create your first project</Button></Link>}>
            Paste the URL of a site to recreate, combine several references, or describe something new.
          </Empty>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const st = STATUS[p.status] ?? STATUS.draft;
            return (
              <div key={p.id} className="group relative overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-line-strong">
                <Link href={`/p/${p.id}`} className="block">
                  <div className="checker relative aspect-[16/10] overflow-hidden border-b border-line">
                    {p.thumbnailKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(p.thumbnailKey)} alt="" className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.015]" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-fg-4">{p.status === "analyzing" || p.status === "generating" ? <span className="shimmer-text">{st.label}…</span> : "No preview yet"}</div>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="truncate text-[13px] font-medium">{p.name}</h2>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-fg-3">
                      <span>{MODE[p.mode] ?? p.mode}</span>
                      <span className="text-fg-4">·</span>
                      <span>{p.fileCount} files</span>
                      <span className="text-fg-4">·</span>
                      <span>{timeAgo(p.updatedAt)}</span>
                      {p.publishedSlug && <Globe className="ml-auto size-3.5 text-ok" aria-label="Published" />}
                    </div>
                  </div>
                </Link>
                <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Menu
                    trigger={(toggle) => (
                      <button onClick={toggle} aria-label="Project actions" className="flex size-7 items-center justify-center rounded-md border border-line-strong bg-overlay/90 text-fg-2 backdrop-blur hover:text-fg">
                        <MoreHorizontal className="size-4" />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem icon={<Pencil className="size-3.5" />} onClick={() => { close(); setName(p.name); setRenaming(p); }}>Rename</MenuItem>
                        <MenuItem icon={<Copy className="size-3.5" />} onClick={() => { close(); duplicate(p); }}>Duplicate</MenuItem>
                        <MenuItem icon={<Trash2 className="size-3.5" />} danger onClick={() => { close(); setDeleting(p); }}>Delete</MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await api(`/api/projects/${renaming!.id}`, { method: "PATCH", json: { name } }).catch(() => {});
                setBusy(false);
                setRenaming(null);
                load();
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/api/projects/${deleting!.id}`, { method: "DELETE" });
                } catch (e) {
                  alert(e instanceof ApiError ? e.message : "Could not delete");
                }
                setBusy(false);
                setDeleting(null);
                load();
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-2">
          “{deleting?.name}” and all its versions, analyses and published site will be removed. This cannot be undone.
        </p>
      </Modal>
    </main>
  );
}
