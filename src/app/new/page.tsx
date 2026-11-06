import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/app-header";
import { NewProject } from "@/components/new-project";
import { capabilities } from "@/lib/env";

export const metadata = { title: "New project" };

export default async function NewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <NewProject capabilities={capabilities()} />
    </div>
  );
}
