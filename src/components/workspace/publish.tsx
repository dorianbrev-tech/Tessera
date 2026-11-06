"use client";
import { useState } from "react";
import { Check, Copy, Download, ExternalLink, Globe } from "lucide-react";
import { Button, Input, Label, Modal, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import type { ProjectData } from "./types";

export function PublishDialog({ open, onClose, data, onChanged }: { open: boolean; onClose: () => void; data: ProjectData; onChanged: () => void }) {
  const p = data.project;
  const [slug, setSlug] = useState(p.publishedSlug ?? "");
  const [indexable, setIndexable] = useState(p.publishIndexable);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = data.publishedUrl;

  async function publish() {
    setWorking(true);
    setError(null);
    try {
      await api(`/api/projects/${p.id}/publish`, { method: "POST", json: { slug: slug || undefined, indexable } });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Publishing failed");
    }
    setWorking(false);
  }

  return (
    <Modal open={open} onClose={onClose} title="Publish & export" width={520}>
      <div className="space-y-5">
        {url && (
          <div className="flex items-center gap-2 rounded-lg border border-ok/25 bg-ok/5 px-3 py-2">
            <Globe className="size-4 shrink-0 text-ok" />
            <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs text-fg hover:underline">{url}</a>
            <button aria-label="Copy URL" onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="text-fg-3 hover:text-fg">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button>
            <a href={url} target="_blank" rel="noreferrer" aria-label="Open" className="text-fg-3 hover:text-fg"><ExternalLink className="size-3.5" /></a>
          </div>
        )}
        <div>
          <Label htmlFor="slug" hint="Lowercase letters, digits and dashes">Address</Label>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-fg-3">/s/</span>
            <Input id="slug" placeholder="my-site" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
          </div>
        </div>
        <Toggle checked={indexable} onChange={setIndexable} label="Allow search engines to index" description="Off by default: published sites carry noindex until you opt in." />
        <p className="text-xs text-fg-3">Publishing snapshots the current files; later edits go live only when you publish again.</p>
        {error && <p className="text-xs text-bad">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" loading={working} onClick={publish} icon={<Globe className="size-3.5" />}>{url ? "Publish changes" : "Publish"}</Button>
          {url && (
            <Button variant="ghost" onClick={async () => { await api(`/api/projects/${p.id}/publish`, { method: "DELETE" }); onChanged(); }}>Unpublish</Button>
          )}
          <a href={`/api/projects/${p.id}/export`} className="ml-auto">
            <Button variant="secondary" icon={<Download className="size-3.5" />} disabled={!data.files.length}>Download source (.zip)</Button>
          </a>
        </div>
      </div>
    </Modal>
  );
}
