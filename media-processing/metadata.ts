import { stat } from "fs/promises";
import path from "path";

// Dynamically import `exifr` inside server-only functions to avoid bundling
// it into client-side code by build tools.

import {
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS
} from "@/lib/constants";
import type { MediaAsset, MediaMetadata, MediaType } from "@/lib/types";
import { probeFile } from "@/scripts/ffmpeg";

export function inferMediaType(filename: string): MediaType | null {
  const extension = path.extname(filename).toLowerCase();
  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  return null;
}

function toIsoDate(value: unknown) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

export async function extractMetadata(options: {
  filePath: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  mediaType: MediaType;
  uploadOrder: number;
  lastModifiedMs?: number;
}) {
  const extension = path.extname(options.filename).toLowerCase();
  const fileStats = await stat(options.filePath);
  const fallbackTimestamp = new Date(
    options.lastModifiedMs && options.lastModifiedMs > 0
      ? options.lastModifiedMs
      : fileStats.birthtime.getTime()
  ).toISOString();

  if (options.mediaType === "image") {
    const { default: exifr } = await import("exifr");
    const exif = await exifr
      .parse(options.filePath, {
        pick: ["DateTimeOriginal", "CreateDate", "ImageWidth", "ImageHeight"]
      })
      .catch(() => undefined);

    const capturedAt =
      toIsoDate(exif?.DateTimeOriginal) ??
      toIsoDate(exif?.CreateDate) ??
      fallbackTimestamp;

    return {
      capturedAt,
      capturedAtSource: exif?.DateTimeOriginal || exif?.CreateDate ? "exif" : "filesystem",
      width: exif?.ImageWidth,
      height: exif?.ImageHeight,
      extension,
      mimeType: options.mimeType,
      byteSize: options.byteSize
    } satisfies MediaMetadata;
  }

  const probe = await probeFile(options.filePath);
  const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
  const capturedAt =
    toIsoDate(probe.format?.tags?.creation_time) ??
    toIsoDate(videoStream?.tags?.creation_time) ??
    fallbackTimestamp;

  return {
    capturedAt,
    capturedAtSource:
      probe.format?.tags?.creation_time || videoStream?.tags?.creation_time
        ? "video_tag"
        : "filesystem",
    durationSec: Number(probe.format?.duration ?? "0") || undefined,
    width: videoStream?.width,
    height: videoStream?.height,
    extension,
    mimeType: options.mimeType,
    byteSize: options.byteSize
  } satisfies MediaMetadata;
}

export function sortAssetsChronologically<T extends Pick<MediaAsset, "metadata" | "uploadOrder">>(
  assets: T[]
) {
  return [...assets].sort((left, right) => {
    const leftTimestamp = left.metadata.capturedAt
      ? new Date(left.metadata.capturedAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    const rightTimestamp = right.metadata.capturedAt
      ? new Date(right.metadata.capturedAt).getTime()
      : Number.MAX_SAFE_INTEGER;

    if (leftTimestamp === rightTimestamp) {
      return left.uploadOrder - right.uploadOrder;
    }
    return leftTimestamp - rightTimestamp;
  });
}
