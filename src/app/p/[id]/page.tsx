import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getOwnedProject, NotFoundError } from "@/lib/projects";
import { Workspace } from "@/components/workspace/workspace";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "Project" };
  try {
    const p = await getOwnedProject(user.id, id);
    return { title: p.name };
  } catch {
    return { title: "Project" };
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  try {
    await getOwnedProject(user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return <Workspace projectId={id} user={user} />;
}
