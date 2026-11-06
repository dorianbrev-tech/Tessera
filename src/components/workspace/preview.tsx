"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bug, ChevronDown, ExternalLink, Maximize2, Minimize2, Monitor, RotateCw, Smartphone, Tablet } from "lucide-react";
import { IconButton, Menu, MenuItem, Spinner } from "@/components/ui";
import { cx } from "@/lib/client";
import type { FileEntry, JobSummary } from "./types";

type Device = "desktop" | "tablet" | "mobile";
const DEVICES: Record<Device, { w: number; h: number; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  desktop: { w: 1440, h: 900, icon: Monitor, label: "Desktop · 1440" },
  tablet: { w: 834, h: 1112, icon: Tablet, label: "Tablet · 834" },
  mobile: { w: 390, h: 844, icon: Smartphone, label: "Mobile · 390" },
};

export function pagesFromFiles(files: FileEntry[]) {
  return files
    .filter((f) => f.path.endsWith(".html"))
    .map((f) => {
      const p = "/" + f.path.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
      return p === "/" ? "/" : p.replace(/\/$/, "/");
    })
    .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
}

export function PreviewPanel(props: {
  base: string;
  files: FileEntry[];
  path: string;
  onPathChange: (p: string) => void;
  reloadSignal: number;
  job: JobSummary | null;
  errors: string[];
  onError: (msg: string) => void;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const canvas = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const pages = useMemo(() => pagesFromFiles(props.files), [props.files]);
  const hasSite = pages.length > 0;
  const { onPathChange, onError } = props;

  // Reload when files change (debounced in the parent through reloadSignal).
  useEffect(() => {
    if (props.reloadSignal) setReloadKey((k) => k + 1);
  }, [props.reloadSignal]);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen]);

  // Messages from the preview bridge (navigation, runtime errors).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; path?: string; message?: string };
      if (d?.source !== "tessera-preview") return;
      if (d.type === "location" && d.path) onPathChange(d.path);
      if (d.type === "error" && d.message) onError(d.message.slice(0, 400));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onPathChange, onError]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const navigate = useCallback(
    (p: string) => {
      onPathChange(p);
      setReloadKey((k) => k + 1);
    },
    [onPathChange],
  );

  const d = DEVICES[device];
  const pad = device === "desktop" ? 0 : 32;
  const scale = device === "desktop" ? Math.min(1, box.w / d.w) : Math.min(1, (box.w - pad * 2) / d.w, (box.h - pad * 2) / d.h);
  const frameH = device === "desktop" ? box.h / scale : d.h;
  // The src only changes on explicit navigation/reload; in-frame navigation is tracked via the bridge.
  const [src, setSrc] = useState(`${props.base}${props.path}`);
  useEffect(() => {
    setSrc(`${props.base}${props.path === "/" ? "/" : props.path}?_r=${reloadKey}`);
    setLoading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, props.base]);

  return (
    <div className={cx("flex h-full min-h-0 flex-col bg-bg", fullscreen && "fixed inset-0 z-50")}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2">
        <Menu
          align="start"
          trigger={(toggle) => (
            <button onClick={toggle} disabled={!hasSite} className="flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-line bg-panel px-2 font-mono text-xs text-fg-2 hover:border-line-strong hover:text-fg disabled:opacity-50">
              <span className="max-w-[220px] truncate">{props.path}</span>
              <ChevronDown className="size-3 shrink-0 text-fg-3" />
            </button>
          )}
        >
          {(close) => (
            <div className="max-h-80 overflow-y-auto">
              {pages.map((p) => (
                <MenuItem key={p} onClick={() => { close(); navigate(p); }}>
                  <span className={cx("font-mono text-xs", p === props.path && "text-accent")}>{p}</span>
                </MenuItem>
              ))}
            </div>
          )}
        </Menu>
        <div className="mx-auto flex items-center gap-0.5 rounded-md border border-line bg-panel p-0.5">
          {(Object.keys(DEVICES) as Device[]).map((k) => {
            const Icon = DEVICES[k].icon;
            return (
              <button key={k} title={DEVICES[k].label} aria-label={DEVICES[k].label} onClick={() => setDevice(k)} className={cx("flex h-6 w-7 items-center justify-center rounded-[5px] transition-colors", device === k ? "bg-overlay text-fg" : "text-fg-3 hover:text-fg")}>
                <Icon className="size-3.5" />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-0.5">
          {props.errors.length > 0 && (
            <span title={props.errors.slice(-5).join("\n")} className="mr-1 flex items-center gap-1 rounded bg-bad/10 px-1.5 py-0.5 text-2xs text-bad">
              <Bug className="size-3" /> {props.errors.length}
            </span>
          )}
          <span className="mr-1 font-mono text-2xs text-fg-4 tabular-nums">{Math.round(scale * 100)}%</span>
          <IconButton label="Reload preview" onClick={() => setReloadKey((k) => k + 1)}>
            <RotateCw className="size-3.5" />
          </IconButton>
          <IconButton label="Open in new tab" onClick={() => window.open(`${props.base}${props.path}`, "_blank", "noopener")} disabled={!hasSite}>
            <ExternalLink className="size-3.5" />
          </IconButton>
          <IconButton label={fullscreen ? "Exit full screen (Esc)" : "Full screen"} onClick={() => setFullscreen((f) => !f)}>
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </IconButton>
        </div>
      </div>

      <div ref={canvas} className={cx("relative min-h-0 flex-1 overflow-hidden", device !== "desktop" && "checker")}>
        {!hasSite ? (
          <div className="checker flex h-full items-center justify-center">
            <div className="text-center">
              {props.job ? (
                <>
                  <div className="shimmer-text text-sm font-medium">{props.job.type === "analyze" ? "Analysing references…" : "Building your website…"}</div>
                  <div className="mt-1 text-xs text-fg-3">{props.job.stage ?? "The preview appears as soon as the first page is written."}</div>
                </>
              ) : (
                <>
                  <div className="text-sm text-fg-2">No pages yet</div>
                  <div className="mt-1 text-xs text-fg-3">Generate the site or ask for one in the chat.</div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-start justify-center" style={{ padding: device === "desktop" ? 0 : pad }}>
            <div
              className={cx("relative origin-top overflow-hidden bg-white", device !== "desktop" && "rounded-[18px] shadow-[0_0_0_1px_#2b2b33,0_20px_60px_rgba(0,0,0,.5)]")}
              style={{ width: d.w, height: frameH, transform: `scale(${scale})`, transformOrigin: device === "desktop" ? "top left" : "top center", position: device === "desktop" ? "absolute" : "relative", left: 0, top: 0 }}
            >
              <iframe
                key={src}
                ref={frame}
                src={src}
                title="Website preview"
                onLoad={() => setLoading(false)}
                sandbox="allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox"
                className="size-full border-0 bg-white"
              />
            </div>
            {loading && (
              <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-1.5 rounded-md bg-overlay/90 px-2 py-1 text-2xs text-fg-2">
                <Spinner className="size-3" /> Loading
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
