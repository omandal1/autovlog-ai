import { readFile, stat } from "fs/promises";

import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { getProject } from "@/lib/project-service";
import type { AssetVariant } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{
    projectId: string;
    assetId: string;
    variant: string;
  }>;
}

async function pathExists(filePath?: string) {
  if (!filePath) {
    return false;
  }
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function firstExistingPath(paths: Array<string | undefined>) {
  for (const filePath of paths) {
    if (await pathExists(filePath)) {
      return filePath;
    }
  }
  return undefined;
}

async function resolveAssetPath(
  asset: Awaited<ReturnType<typeof getProject>>["assets"][number],
  variant: AssetVariant
) {
  if (variant === "thumbnail") {
    return firstExistingPath(
      asset.mediaType === "image"
        ? [asset.storage.thumbnailPath, asset.storage.normalizedPath, asset.storage.originalPath]
        : [asset.storage.thumbnailPath]
    );
  }
  if (variant === "normalized") {
    return firstExistingPath([asset.storage.normalizedPath, asset.storage.thumbnailPath, asset.storage.originalPath]);
  }
  if (variant === "proxy") {
    return firstExistingPath([asset.storage.proxyPath, asset.storage.originalPath]);
  }
  return firstExistingPath([asset.storage.originalPath]);
}

function resolveMimeType(asset: Awaited<ReturnType<typeof getProject>>["assets"][number], variant: AssetVariant) {
  if (variant === "proxy") {
    return "video/mp4";
  }
  if (variant === "thumbnail" || variant === "normalized") {
    return "image/jpeg";
  }
  return asset.metadata.mimeType || "application/octet-stream";
}

export async function GET(_: Request, { params }: RouteProps) {
  try {
    const resolvedParams = await params;
    const variant = resolvedParams.variant as AssetVariant;
    const user = await getOptionalSessionUser();
    const project = await getProject(resolvedParams.projectId, user?.id);
    const asset = project.assets.find((entry) => entry.id === resolvedParams.assetId);
    if (!asset) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const filePath = await resolveAssetPath(asset, variant);
    if (!filePath) {
      return NextResponse.json({ error: "Asset file not found." }, { status: 404 });
    }
    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": resolveMimeType(asset, variant)
      }
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
