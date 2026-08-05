import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { getProject } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
  }>;
}

export async function GET(_: Request, { params }: RouteProps) {
  try {
    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    const project = await getProject(resolvedParams.projectId, user?.id);
    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
}
