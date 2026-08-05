import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { selectPreviewPlan } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
  }>;
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const body = (await request.json()) as { planId?: string };
    if (!body.planId) {
      return NextResponse.json({ error: "planId is required." }, { status: 400 });
    }

    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    const project = await selectPreviewPlan(resolvedParams.projectId, body.planId, user?.id);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to select preview plan." },
      { status: 400 }
    );
  }
}
