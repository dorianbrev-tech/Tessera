"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { Wordmark } from "@/components/logo";
import { api, ApiError } from "@/lib/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api(`/api/auth/${mode}`, { method: "POST", json: mode === "signup" ? { name, email, password } : { email, password } });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-[340px]">
        <Link href="/" className="mb-10 inline-block">
          <Wordmark />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 text-[13px] text-fg-3">{mode === "login" ? "Sign in to continue to your projects." : "Projects are saved to your account and private to you."}</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password" hint={mode === "signup" ? "10+ characters" : undefined}>Password</Label>
            <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 10 : 1} />
          </div>
          {error && <p className="rounded-md border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-fg-3">
          {mode === "login" ? (
            <>No account yet? <Link href="/signup" className="text-fg hover:underline">Create one</Link></>
          ) : (
            <>Already have an account? <Link href="/login" className="text-fg hover:underline">Sign in</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
