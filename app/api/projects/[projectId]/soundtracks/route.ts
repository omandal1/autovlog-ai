import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { addProjectSoundtracks, removeProjectSoundtrack } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
  }>;
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("soundtracks")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    const project = await addProjectSoundtracks(resolvedParams.projectId, files, user?.id);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to add soundtrack files." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  try {
    const body = (await request.json()) as { soundtrackId?: string };
    if (!body.soundtrackId) {
      throw new Error("Choose a soundtrack to remove.");
    }
    const resolvedParams = await params;
    const user = await getOptionalSessionUser();
    const project = await removeProjectSoundtrack(
      resolvedParams.projectId,
      body.soundtrackId,
      user?.id
    );
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to remove soundtrack." },
      { status: 400 }
    );
  }
}
