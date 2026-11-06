import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/app-header";
import { ProjectGrid } from "@/components/dashboard";

export const metadata = { title: "Projects" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <ProjectGrid />
    </div>
  );
}
