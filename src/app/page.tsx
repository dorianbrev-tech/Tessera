import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Layers, ScanSearch, SplitSquareHorizontal, Wand2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { Wordmark } from "@/components/logo";

export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Wordmark />
        <nav className="flex items-center gap-1 text-[13px]">
          <Link href="/login" className="rounded-md px-3 py-1.5 text-fg-2 hover:text-fg">Sign in</Link>
          <Link href="/signup" className="rounded-md bg-fg px-3 py-1.5 font-medium text-bg hover:bg-white">Get started</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="pt-24 pb-16">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-fg-2">
            <span className="size-1.5 rounded-full bg-accent" /> Analyse · Recreate · Generate
          </p>
          <h1 className="max-w-3xl text-[56px] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
            Any website, understood — then rebuilt to the pixel.
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-6 text-fg-2">
            Paste a URL. Tessera visits every page in a real browser, measures its colors, type, spacing, motion and responsive behaviour, and builds a complete multi-page site that matches it — then keeps comparing and correcting until it does.
          </p>
          <div className="mt-8 flex gap-2">
            <Link href="/signup" className="inline-flex h-10 items-center gap-2 rounded-lg bg-fg px-4 text-sm font-medium text-bg hover:bg-white">
              Start a project <ArrowRight className="size-4" />
            </Link>
            <Link href="/login" className="inline-flex h-10 items-center rounded-lg border border-line-strong px-4 text-sm text-fg-2 hover:text-fg">
              Sign in
            </Link>
          </div>
        </section>

        <section aria-label="Workspace preview" className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex h-9 items-center gap-2 border-b border-line px-3">
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="ml-3 font-mono text-2xs text-fg-3">maison-verre · workspace</span>
          </div>
          <div className="grid h-[340px] grid-cols-[260px_1fr_300px]">
            <div className="space-y-3 border-r border-line p-4">
              <div className="ml-auto w-4/5 rounded-lg bg-raised px-3 py-2 text-xs text-fg-2">Recreate maison-verre.com — all pages</div>
              <div className="space-y-1.5 font-mono text-2xs text-fg-3">
                <div>✓ Captured 6 pages · 3 viewports</div>
                <div>✓ Design system: 9 colors, 2 families</div>
                <div>✓ Wrote index.html, styles.css …</div>
                <div className="text-accent">◷ Comparing / — 92.4 / 100</div>
              </div>
            </div>
            <div className="checker flex items-center justify-center p-6">
              <div className="h-full w-full max-w-md rounded-md bg-[#f6f1ea] p-5 text-[#1b1714] shadow-2xl">
                <div className="mb-4 flex justify-between text-[8px] tracking-[0.2em] uppercase"><span>Women · Men</span><span className="tracking-[0.3em]">Maison Verre</span><span>Journal</span></div>
                <div className="flex h-36 items-end rounded-sm bg-gradient-to-b from-[#8c6d58] to-[#2b2420] p-4 font-serif text-3xl text-white">The quiet season</div>
                <div className="mt-3 grid grid-cols-4 gap-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className="aspect-[3/4] rounded-sm bg-[#e8dfd3]" />)}</div>
              </div>
            </div>
            <div className="border-l border-line p-4 font-mono text-2xs leading-5 text-fg-3">
              <div className="text-fg-2">assets/css/styles.css</div>
              <div className="mt-2"><span className="text-accent">:root</span> {"{"}</div>
              <div className="pl-3">--paper: <span className="text-fg-2">#f6f1ea</span>;</div>
              <div className="pl-3">--ink: <span className="text-fg-2">#1b1714</span>;</div>
              <div className="pl-3">--serif: <span className="text-fg-2">&quot;Maison Serif&quot;</span>;</div>
              <div>{"}"}</div>
              <div className="mt-2"><span className="text-accent">.hero h1</span> {"{"}</div>
              <div className="pl-3">font-size: <span className="text-fg-2">112px</span>;</div>
              <div className="pl-3">letter-spacing: <span className="text-fg-2">-0.02em</span>;</div>
              <div>{"}"}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-xl border border-line bg-line py-0 my-20 md:grid-cols-4">
          {[
            { icon: ScanSearch, t: "Real analysis", d: "Playwright crawls the site at desktop, tablet and mobile and measures the live DOM — nothing is guessed." },
            { icon: Layers, t: "Multiple references", d: "Take colors from one site, navigation from another and motion from a third. Each reference gets a role." },
            { icon: SplitSquareHorizontal, t: "Visual fidelity loop", d: "Every page is rendered, diffed against its reference and corrected until it meets your target score." },
            { icon: Wand2, t: "Edit by conversation", d: "Ask for changes in plain language, or open the code. Every change is versioned and reversible." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="bg-bg p-6">
              <Icon className="size-4 text-accent" />
              <h3 className="mt-4 text-sm font-medium">{t}</h3>
              <p className="mt-1.5 text-xs leading-5 text-fg-3">{d}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="mx-auto max-w-6xl border-t border-line px-6 py-8 text-xs text-fg-3">Tessera respects robots.txt and never bypasses logins or bot protection.</footer>
    </div>
  );
}
