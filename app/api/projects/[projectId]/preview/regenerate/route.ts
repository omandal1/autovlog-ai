import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { regenerateProjectPreview } from "@/lib/project-service";
import type { PreviewRegenerationMode } from "@/lib/types";

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
      mode?: PreviewRegenerationMode;
    };
    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    const project = await regenerateProjectPreview(
      resolvedParams.projectId,
      body.mode ?? "full-plan",
      user?.id
    );
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to regenerate preview plan." },
      { status: 400 }
    );
  }
}
