"use client";
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cx } from "@/lib/client";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-fg text-bg hover:bg-white disabled:bg-fg/40",
  accent: "bg-accent-strong text-white hover:bg-accent disabled:opacity-50",
  secondary: "bg-raised text-fg border border-line-strong hover:bg-hover hover:border-[#383842] disabled:opacity-50",
  ghost: "text-fg-2 hover:text-fg hover:bg-hover disabled:opacity-40",
  danger: "bg-bad/10 text-bad border border-bad/25 hover:bg-bad/15 disabled:opacity-50",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-2 rounded-md",
  lg: "h-10 px-4 text-sm gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx("inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none", variants[variant], sizes[size], className)}
        {...rest}
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, className, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40",
        active && "bg-hover text-fg",
        className,
      )}
      {...rest}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        "h-9 w-full rounded-md border border-line-strong bg-panel px-3 text-[13px] text-fg placeholder:text-fg-4 transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/15",
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        "w-full resize-none rounded-md border border-line-strong bg-panel px-3 py-2 text-[13px] leading-5 text-fg placeholder:text-fg-4 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/15",
        className,
      )}
      {...rest}
    />
  );
});

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-fg-2">
      <span>{children}</span>
      {hint && <span className="font-normal text-fg-3">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3", disabled && "cursor-default opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-[18px] w-[30px] shrink-0 rounded-full border transition-colors", checked ? "border-accent-strong bg-accent-strong" : "border-line-strong bg-raised")}
      >
        <span className={cx("absolute top-[2px] size-3 rounded-full bg-white transition-all", checked ? "left-[14px]" : "left-[2px] bg-fg-3")} />
      </button>
      <span className="min-w-0">
        <span className="block text-[13px] text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-fg-3">{description}</span>}
      </span>
    </label>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "bad"; className?: string }) {
  const tones = {
    neutral: "bg-raised text-fg-2 border-line-strong",
    accent: "bg-accent-soft text-accent border-accent/20",
    ok: "bg-ok/10 text-ok border-ok/20",
    warn: "bg-warn/10 text-warn border-warn/20",
    bad: "bg-bad/10 text-bad border-bad/20",
  };
  return <span className={cx("inline-flex h-5 items-center gap-1 rounded border px-1.5 text-2xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-3.5 animate-spin text-fg-3", className)} />;
}

export function Segmented<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex items-center rounded-md border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors",
            size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
            value === o.value ? "bg-overlay text-fg shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-fg-3 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-full rounded-xl border border-line-strong bg-raised shadow-2xl shadow-black/50 animate-rise" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Menu({ trigger, children, align = "end" }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={cx("absolute top-full z-40 mt-1 min-w-44 rounded-lg border border-line-strong bg-overlay p-1 shadow-xl shadow-black/40 animate-fade-in", align === "end" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, danger, icon }: { children: ReactNode; onClick: () => void; danger?: boolean; icon?: ReactNode }) {
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover", danger ? "text-bad" : "text-fg-2 hover:text-fg")}>
      {icon && <span className="text-fg-3">{icon}</span>}
      {children}
    </button>
  );
}

export function ScoreRing({ score, size = 36 }: { score: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const tone = score >= 85 ? "var(--color-ok)" : score >= 65 ? "var(--color-warn)" : "var(--color-bad)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="2.5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, score) / 100)} strokeLinecap="round" />
      </svg>
      <span className={cx("absolute inset-0 flex items-center justify-center font-mono tabular-nums text-fg", size < 30 ? "text-[8.5px] tracking-tighter" : "text-2xs")}>{Math.round(score)}</span>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-line bg-raised text-fg-3">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {children && <div className="mt-1 max-w-sm text-xs leading-5 text-fg-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Minimal, safe markdown: paragraphs, lists, **bold**, `code`, [links](url). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (s: string, key: string) => {
    const out: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      const t = m[0];
      if (t.startsWith("**")) out.push(<strong key={`${key}-${i++}`} className="font-medium text-fg">{t.slice(2, -2)}</strong>);
      else if (t.startsWith("`")) out.push(<code key={`${key}-${i++}`} className="rounded bg-overlay px-1 py-px font-mono text-[12px] text-fg">{t.slice(1, -1)}</code>);
      else {
        const label = t.slice(1, t.indexOf("]"));
        out.push(<a key={`${key}-${i++}`} href={m[2]} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">{label}</a>);
      }
      last = m.index + t.length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  return (
    <div className={cx("space-y-2", className)}>
      {blocks.map((b, bi) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-4 marker:text-fg-4">
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        if (/^#{1,4}\s/.test(b)) return <div key={bi} className="font-medium text-fg">{inline(b.replace(/^#{1,4}\s+/, ""), `${bi}`)}</div>;
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
