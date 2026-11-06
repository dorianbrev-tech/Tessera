"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Menu, MenuItem } from "@/components/ui";
import { Wordmark } from "@/components/logo";
import { api } from "@/lib/client";

export function AppHeader({ user, children }: { user: { name: string | null; email: string }; children?: React.ReactNode }) {
  const router = useRouter();
  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link href="/dashboard">
            <Wordmark />
          </Link>
          {children}
        </div>
        <Menu
          trigger={(toggle) => (
            <button onClick={toggle} className="flex size-7 items-center justify-center rounded-full border border-line-strong bg-raised text-2xs font-medium text-fg-2 hover:text-fg" aria-label="Account menu">
              {initials}
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="border-b border-line px-2 pt-1.5 pb-2">
                <div className="text-[13px] text-fg">{user.name}</div>
                <div className="text-xs text-fg-3">{user.email}</div>
              </div>
              <div className="pt-1">
                <MenuItem
                  icon={<LogOut className="size-3.5" />}
                  onClick={async () => {
                    close();
                    await api("/api/auth/logout", { method: "POST" });
                    router.push("/login");
                    router.refresh();
                  }}
                >
                  Sign out
                </MenuItem>
              </div>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}
