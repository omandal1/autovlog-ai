import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { updateAssetUserState } from "@/lib/project-service";
import type { UserMediaState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
    assetId: string;
  }>;
}

export async function PATCH(request: Request, { params }: RouteProps) {
  try {
    const body = (await request.json()) as Partial<UserMediaState>;
    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    const project = await updateAssetUserState(
      resolvedParams.projectId,
      resolvedParams.assetId,
      body,
      user?.id
    );
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update media state." },
      { status: 400 }
    );
  }
}
