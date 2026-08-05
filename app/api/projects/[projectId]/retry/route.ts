import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { retryProject } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
  }>;
}

export async function POST(_: Request, { params }: RouteProps) {
  try {
    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    const project = await retryProject(resolvedParams.projectId, user?.id);
    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: "Unable to retry project." }, { status: 400 });
  }
}
