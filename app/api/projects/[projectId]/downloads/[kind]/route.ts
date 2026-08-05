import { readFile } from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { getProject } from "@/lib/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
    kind: string;
  }>;
}

export async function GET(_: Request, { params }: RouteProps) {
  const resolvedParams = await params;
  const user = await getOptionalSessionUser();
  const project = await getProject(resolvedParams.projectId, user?.id);
  const output = project.outputs.find((entry) => entry.id === resolvedParams.kind);
  if (!output) {
    return NextResponse.json({ error: "Rendered output not found." }, { status: 404 });
  }

  const buffer = await readFile(output.outputPath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `inline; filename="${path.basename(output.outputPath)}"`
    }
  });
}
