"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OnMount, BeforeMount } from "@monaco-editor/react";
import { ChevronRight, Circle, FileCode2, FileImage, FileText, FilePlus, Folder, FolderOpen, Lock, MoreHorizontal, Pencil, Save, Trash2 } from "lucide-react";
import { Button, IconButton, Input, Menu, MenuItem, Modal, Spinner } from "@/components/ui";
import { api, ApiError, cx, formatBytes } from "@/lib/client";
import type { FileEntry } from "./types";

// Monaco is served from our own origin (public/monaco, copied at install/build time).
const Editor = dynamic(
  () =>
    import("@monaco-editor/react").then((m) => {
      m.loader.config({ paths: { vs: "/monaco/vs" } });
      return m.default;
    }),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    ),
  },
);

type Node = { name: string; path: string; children?: Node[]; file?: FileEntry };

function buildTree(files: FileEntry[]): Node[] {
  const root: Node = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) cur.children!.push({ name: part, path: p, file: f });
      else {
        let next = cur.children!.find((c) => c.children && c.name === part);
        if (!next) {
          next = { name: part, path: p, children: [] };
          cur.children!.push(next);
        }
        cur = next;
      }
    });
  }
  const sort = (n: Node[]): Node[] =>
    n
      .sort((a, b) => (a.children && !b.children ? -1 : !a.children && b.children ? 1 : a.name === "index.html" ? -1 : b.name === "index.html" ? 1 : a.name.localeCompare(b.name)))
      .map((x) => (x.children ? { ...x, children: sort(x.children) } : x));
  return sort(root.children!);
}

const LANG: Record<string, string> = { html: "html", htm: "html", css: "css", js: "javascript", mjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", json: "json", md: "markdown", svg: "xml", xml: "xml", txt: "plaintext", webmanifest: "json" };
const langOf = (p: string) => LANG[p.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";

function FileIcon({ path }: { path: string }) {
  if (/\.(png|jpe?g|gif|webp|avif|ico)$/i.test(path)) return <FileImage className="size-3.5 shrink-0 text-fg-3" />;
  if (/\.(html|css|js|ts|json|svg)$/i.test(path)) return <FileCode2 className="size-3.5 shrink-0 text-fg-3" />;
  return <FileText className="size-3.5 shrink-0 text-fg-3" />;
}

function Tree({ nodes, depth, open, selected, onToggle, onSelect }: { nodes: Node[]; depth: number; open: Set<string>; selected: string | null; onToggle: (p: string) => void; onSelect: (f: FileEntry) => void }) {
  return (
    <>
      {nodes.map((n) =>
        n.children ? (
          <div key={n.path}>
            <button onClick={() => onToggle(n.path)} className="flex h-6 w-full items-center gap-1 pr-2 text-left text-xs text-fg-2 hover:bg-hover" style={{ paddingLeft: 8 + depth * 12 }}>
              <ChevronRight className={cx("size-3 shrink-0 text-fg-4 transition-transform", open.has(n.path) && "rotate-90")} />
              {open.has(n.path) ? <FolderOpen className="size-3.5 shrink-0 text-fg-3" /> : <Folder className="size-3.5 shrink-0 text-fg-3" />}
              <span className="truncate">{n.name}</span>
            </button>
            {open.has(n.path) && <Tree nodes={n.children} depth={depth + 1} open={open} selected={selected} onToggle={onToggle} onSelect={onSelect} />}
          </div>
        ) : (
          <button
            key={n.path}
            onClick={() => onSelect(n.file!)}
            className={cx("flex h-6 w-full items-center gap-1.5 pr-2 text-left text-xs", selected === n.path ? "bg-accent-soft text-fg" : "text-fg-2 hover:bg-hover")}
            style={{ paddingLeft: 20 + depth * 12 }}
            title={`${n.path} · ${formatBytes(n.file!.size)}`}
          >
            <FileIcon path={n.path} />
            <span className="truncate">{n.name}</span>
          </button>
        ),
      )}
    </>
  );
}

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("tessera", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5c5c66", fontStyle: "italic" },
      { token: "string", foreground: "b8c4ff" },
      { token: "keyword", foreground: "8ea2ff" },
      { token: "tag", foreground: "8ea2ff" },
      { token: "attribute.name", foreground: "c9a96e" },
      { token: "attribute.value", foreground: "b8c4ff" },
      { token: "number", foreground: "e0b080" },
    ],
    colors: {
      "editor.background": "#0b0b0d",
      "editor.foreground": "#d9d9de",
      "editorLineNumber.foreground": "#3a3a43",
      "editorLineNumber.activeForeground": "#8a8a94",
      "editor.lineHighlightBackground": "#131317",
      "editor.selectionBackground": "#2c3560",
      "editorIndentGuide.background1": "#1a1a20",
      "editorWidget.background": "#131317",
      "editorWidget.border": "#2b2b33",
      "scrollbarSlider.background": "#2b2b3366",
    },
  });
};

export function CodePanel(props: { projectId: string; files: FileEntry[]; base: string; locked: boolean; refreshSignal: number; onSaved: () => void; onFilesChanged: () => void; requestedFile?: string | null }) {
  const { projectId, files, locked, onSaved, onFilesChanged } = props;
  const tree = useMemo(() => buildTree(files), [files]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["assets", "assets/css", "assets/js"]));
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [content, setContent] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "new" | "rename" | "delete"; value: string }>(null);
  const saveRef = useRef<() => void>(() => {});
  const dirty = content !== saved;

  const loadFile = useCallback(
    async (f: FileEntry) => {
      setSelected(f);
      setError(null);
      if (f.binary) {
        setContent("");
        setSaved("");
        return;
      }
      setLoading(true);
      try {
        const res = await api<{ content: string }>(`/api/projects/${projectId}/files?path=${encodeURIComponent(f.path)}`);
        setContent(res.content ?? "");
        setSaved(res.content ?? "");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not open file");
      }
      setLoading(false);
    },
    [projectId],
  );

  // Pick a sensible default file, and follow external changes (AI edits) when not dirty.
  useEffect(() => {
    if (!selected && files.length) {
      const first = files.find((f) => f.path === "index.html") ?? files.find((f) => !f.binary);
      if (first) loadFile(first);
    }
  }, [files, selected, loadFile]);
  useEffect(() => {
    if (props.refreshSignal && selected && !dirty) {
      const still = files.find((f) => f.path === selected.path);
      if (still) loadFile(still);
      else setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.refreshSignal]);
  useEffect(() => {
    if (props.requestedFile) {
      const f = files.find((x) => x.path === props.requestedFile);
      if (f) loadFile(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.requestedFile]);

  const save = useCallback(async () => {
    if (!selected || selected.binary || locked) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/files`, { method: "PUT", json: { path: selected.path, content, snapshot: true } });
      setSaved(content);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    }
    setSaving(false);
  }, [selected, content, locked, projectId, onSaved]);
  saveRef.current = save;

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
  };

  async function runDialog() {
    if (!dialog) return;
    setError(null);
    try {
      if (dialog.kind === "new") {
        await api(`/api/projects/${projectId}/files`, { method: "PUT", json: { path: dialog.value, content: "" } });
        onFilesChanged();
        setSelected({ path: dialog.value.replace(/^\/+/, ""), mime: "", size: 0, binary: false, updatedAt: "" });
        setContent("");
        setSaved("");
      } else if (dialog.kind === "rename" && selected) {
        await api(`/api/projects/${projectId}/files`, { method: "PATCH", json: { from: selected.path, to: dialog.value } });
        setSelected({ ...selected, path: dialog.value });
        onFilesChanged();
      } else if (dialog.kind === "delete" && selected) {
        await api(`/api/projects/${projectId}/files?path=${encodeURIComponent(selected.path)}`, { method: "DELETE" });
        setSelected(null);
        onFilesChanged();
      }
      setDialog(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  return (
    <div className="flex h-full min-h-0 bg-panel">
      <div className="flex w-[200px] shrink-0 flex-col border-r border-line">
        <div className="flex h-10 items-center justify-between border-b border-line pr-1 pl-3">
          <span className="text-2xs font-medium tracking-wide text-fg-3 uppercase">Files</span>
          <IconButton label="New file" disabled={locked} onClick={() => setDialog({ kind: "new", value: "" })}>
            <FilePlus className="size-3.5" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {files.length === 0 ? <div className="px-3 py-4 text-xs text-fg-4">No files yet</div> : <Tree nodes={tree} depth={0} open={open} selected={selected?.path ?? null} onToggle={(p) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; })} onSelect={loadFile} />}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          {selected ? (
            <>
              <FileIcon path={selected.path} />
              <span className="truncate font-mono text-xs text-fg-2">{selected.path}</span>
              {dirty && <Circle className="size-2 shrink-0 fill-fg-2 text-fg-2" aria-label="Unsaved changes" />}
              <div className="ml-auto flex items-center gap-1">
                {locked && (
                  <span className="flex items-center gap-1 text-2xs text-fg-3" title="The AI is editing the project">
                    <Lock className="size-3" /> Read-only
                  </span>
                )}
                {!selected.binary && (
                  <Button size="sm" variant={dirty ? "primary" : "ghost"} disabled={!dirty || locked} loading={saving} onClick={save} icon={<Save className="size-3.5" />} title="Save (⌘S)">
                    Save
                  </Button>
                )}
                <Menu trigger={(t) => <IconButton label="File actions" onClick={t} disabled={locked}><MoreHorizontal className="size-3.5" /></IconButton>}>
                  {(close) => (
                    <>
                      <MenuItem icon={<Pencil className="size-3.5" />} onClick={() => { close(); setDialog({ kind: "rename", value: selected.path }); }}>Rename</MenuItem>
                      <MenuItem icon={<Trash2 className="size-3.5" />} danger onClick={() => { close(); setDialog({ kind: "delete", value: selected.path }); }}>Delete</MenuItem>
                    </>
                  )}
                </Menu>
              </div>
            </>
          ) : (
            <span className="text-xs text-fg-4">Select a file</span>
          )}
        </div>
        {error && <div className="border-b border-bad/20 bg-bad/5 px-3 py-1.5 text-xs text-bad">{error}</div>}
        <div className="relative min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center"><Spinner /></div>
          ) : selected?.binary ? (
            <div className="checker flex h-full flex-col items-center justify-center gap-3 p-6">
              {/^image\//.test(selected.mime) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${props.base}/${selected.path}`} alt={selected.path} className="max-h-[70%] max-w-full rounded border border-line object-contain" />
              ) : (
                <FileText className="size-8 text-fg-4" />
              )}
              <div className="text-xs text-fg-3">{selected.mime} · {formatBytes(selected.size)}</div>
            </div>
          ) : selected ? (
            <Editor
              path={selected.path}
              language={langOf(selected.path)}
              value={content}
              onChange={(v) => setContent(v ?? "")}
              theme="tessera"
              beforeMount={defineTheme}
              onMount={onMount}
              options={{
                readOnly: locked,
                fontSize: 12.5,
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                lineHeight: 19,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 2,
                renderLineHighlight: "line",
                smoothScrolling: true,
                padding: { top: 10 },
                bracketPairColorization: { enabled: true },
                guides: { indentation: true },
              }}
            />
          ) : null}
        </div>
      </div>

      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "new" ? "New file" : dialog?.kind === "rename" ? "Rename file" : "Delete file"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant={dialog?.kind === "delete" ? "danger" : "primary"} onClick={runDialog}>
              {dialog?.kind === "new" ? "Create" : dialog?.kind === "rename" ? "Rename" : "Delete"}
            </Button>
          </>
        }
      >
        {dialog?.kind === "delete" ? (
          <p className="text-[13px] text-fg-2">Delete <code className="font-mono text-fg">{selected?.path}</code>? You can restore it from History.</p>
        ) : (
          <Input autoFocus placeholder="e.g. contact.html or assets/js/gallery.js" value={dialog?.value ?? ""} onChange={(e) => setDialog((d) => (d ? { ...d, value: e.target.value } : d))} onKeyDown={(e) => e.key === "Enter" && runDialog()} />
        )}
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </Modal>
    </div>
  );
}
