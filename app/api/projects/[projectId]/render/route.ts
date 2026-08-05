import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { enqueueProjectRender, renderSelectedPreview } from "@/lib/project-service";
import { getProject } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
  }>;
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      planId?: string;
      background?: boolean;
    };

    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    await getProject(resolvedParams.projectId, user?.id);
    if (body.background) {
      void enqueueProjectRender(resolvedParams.projectId, body.planId, user?.id);
      return NextResponse.json({ queued: true });
    }

    const project = await renderSelectedPreview(resolvedParams.projectId, body.planId, user?.id);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to render selected plan." },
      { status: 400 }
    );
  }
}
