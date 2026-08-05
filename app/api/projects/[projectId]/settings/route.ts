import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { updateProjectGenerationSettings } from "@/lib/project-service";
import type { GenerationSettings, ProjectSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
  }>;
}

export async function PATCH(request: Request, { params }: RouteProps) {
  try {
    const body = (await request.json()) as Partial<ProjectSettings> & {
      generation?: Partial<GenerationSettings>;
    };
    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    const project = await updateProjectGenerationSettings(
      resolvedParams.projectId,
      body,
      user?.id
    );
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update settings." },
      { status: 400 }
    );
  }
}
