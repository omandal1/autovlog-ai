import { notFound } from "next/navigation";

import { ProjectDashboard } from "@/components/project-dashboard";
import { getOptionalSessionUser } from "@/lib/auth/session";
import { getProject } from "@/lib/project-service";

interface ProjectPageProps {
  params: {
    projectId: string;
  };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  try {
    const resolvedParams = (await params) as { projectId: string };
    const user = await getOptionalSessionUser();
    const project = await getProject(resolvedParams.projectId, user?.id);
    return (
      <main className="mx-auto min-h-screen max-w-7xl px-4 py-10 md:px-8">
        <ProjectDashboard initialProject={project} />
      </main>
    );
  } catch {
    notFound();
  }
}
