import { HostedProjectApp } from "@/components/hosted-project-app";

interface ProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  return <HostedProjectApp projectId={projectId} />;
}
