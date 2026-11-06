export function Logo({ className = "size-5" }: { className?: string }) {
  // Four offset tiles — a tessera is a single mosaic tile.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.3" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" fill="var(--color-accent)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-fg">
      <Logo />
      Tessera
    </span>
  );
}
