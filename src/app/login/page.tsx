import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <AuthForm mode="login" />;
}
