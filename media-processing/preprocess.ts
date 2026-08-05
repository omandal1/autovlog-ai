import { mkdir, readFile, readdir, rename, stat, unlink } from "fs/promises";
import path from "path";


import { runFfmpeg } from "@/scripts/ffmpeg";
import type { MediaAsset, SkipReason } from "@/lib/types";
import { getProjectPaths } from "@/storage/local-storage";

type HeicConvert = (options: {
  buffer: Buffer | Uint8Array;
  format: "JPEG" | "PNG";
  quality?: number;
}) => Promise<Buffer | Uint8Array>;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function tempOutputPath(filePath: string) {
  const parsed = path.parse(filePath);
  return path.join(
    parsed.dir,
    `${parsed.name}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${parsed.ext}`
  );
}

async function removeIfExists(filePath: string) {
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

async function writeImageAtomically(
  outputPath: string,
  writer: (temporaryPath: string) => Promise<void>
) {
  const temporaryPath = tempOutputPath(outputPath);
  try {
    await writer(temporaryPath);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await removeIfExists(temporaryPath);
    throw error;
  }
}

async function writeUnsupportedImageFallback(options: {
  normalizedPath: string;
  thumbnailPath: string;
  label: string;
}) {
  const { default: sharp } = await import("sharp");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <rect width="1280" height="720" fill="#ede5d7"/>
  <rect x="80" y="70" width="1120" height="580" rx="26" fill="#f8f0e3" stroke="#d0baa0" stroke-width="3"/>
  <line x1="160" y1="190" x2="1120" y2="190" stroke="#dacbb8" stroke-width="2"/>
  <line x1="160" y1="260" x2="1120" y2="260" stroke="#dacbb8" stroke-width="2"/>
  <line x1="160" y1="330" x2="1120" y2="330" stroke="#dacbb8" stroke-width="2"/>
  <line x1="160" y1="400" x2="1120" y2="400" stroke="#dacbb8" stroke-width="2"/>
  <line x1="160" y1="470" x2="1120" y2="470" stroke="#dacbb8" stroke-width="2"/>
  <text x="640" y="325" text-anchor="middle" font-family="Georgia, serif" font-size="54" fill="#67584b">${options.label}</text>
  <text x="640" y="382" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#897968">Original photo format is not decodable on this machine.</text>
</svg>`;
  await writeImageAtomically(options.normalizedPath, async (temporaryPath) => {
    await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(temporaryPath);
  });
  await writeImageAtomically(options.thumbnailPath, async (temporaryPath) => {
    await sharp(options.normalizedPath)
      .resize(480, 320, {
        fit: "cover",
        position: "attention"
      })
      .jpeg({ quality: 76, mozjpeg: true })
      .toFile(temporaryPath);
  });
}

async function normalizeImageWithSharp(options: {
  originalPath: string;
  normalizedPath: string;
  thumbnailPath: string;
}) {
  const { default: sharp } = await import("sharp");
  await writeImageAtomically(options.normalizedPath, async (temporaryPath) => {
    await sharp(options.originalPath)
      .rotate()
      .resize(1920, 1920, {
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(temporaryPath);
  });

  await writeImageAtomically(options.thumbnailPath, async (temporaryPath) => {
    await sharp(options.normalizedPath)
      .resize(480, 320, {
        fit: "cover",
        position: "attention"
      })
      .jpeg({ quality: 76, mozjpeg: true })
      .toFile(temporaryPath);
  });
}

async function normalizeImageWithHeicConvert(options: {
  originalPath: string;
  normalizedPath: string;
  thumbnailPath: string;
}) {
  const { default: sharp } = await import("sharp");
  const convert = require("heic-convert") as HeicConvert;
  const inputBuffer = await readFile(options.originalPath);
  const convertedBuffer = Buffer.from(
    await convert({
      buffer: inputBuffer,
      format: "JPEG",
      quality: 0.92
    })
  );

  await writeImageAtomically(options.normalizedPath, async (temporaryPath) => {
    await sharp(convertedBuffer)
      .rotate()
      .resize(1920, 1920, {
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(temporaryPath);
  });

  await writeImageAtomically(options.thumbnailPath, async (temporaryPath) => {
    await sharp(options.normalizedPath)
      .resize(480, 320, {
        fit: "cover",
        position: "attention"
      })
      .jpeg({ quality: 76, mozjpeg: true })
      .toFile(temporaryPath);
  });
}

async function normalizeImageWithFfmpeg(options: {
  originalPath: string;
  normalizedPath: string;
  thumbnailPath: string;
}) {
  await writeImageAtomically(options.normalizedPath, async (temporaryPath) => {
    await runFfmpeg([
      "-y",
      "-i",
      options.originalPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=1920:1920:force_original_aspect_ratio=decrease,format=yuvj420p",
      "-q:v",
      "2",
      temporaryPath
    ]);
  });
  await writeImageAtomically(options.thumbnailPath, async (temporaryPath) => {
    await runFfmpeg([
      "-y",
      "-i",
      options.normalizedPath,
      "-vf",
      "scale=480:320:force_original_aspect_ratio=increase,crop=480:320",
      "-q:v",
      "4",
      temporaryPath
    ]);
  });
}

function unsupportedImageSkipReason(error: unknown): SkipReason {
  return {
    kind: "weak-quality",
    label: "Unsupported image format",
    detail:
      error instanceof Error
        ? `Could not decode this still image locally: ${error.message}`
        : "Could not decode this still image locally."
  };
}

export async function preprocessAsset(asset: MediaAsset) {
  const paths = getProjectPaths(asset.projectId);

  if (asset.mediaType === "image") {
    const normalizedPath = path.join(paths.normalizedDir, `${asset.id}.jpg`);
    const thumbnailPath = path.join(paths.thumbnailsDir, `${asset.id}.jpg`);
    let usedFallback = false;
    let fallbackError: unknown;

    try {
      await normalizeImageWithSharp({
        originalPath: asset.storage.originalPath,
        normalizedPath,
        thumbnailPath
      });
    } catch (sharpError) {
      try {
        await normalizeImageWithHeicConvert({
          originalPath: asset.storage.originalPath,
          normalizedPath,
          thumbnailPath
        });
      } catch (heicConvertError) {
        try {
          await normalizeImageWithFfmpeg({
            originalPath: asset.storage.originalPath,
            normalizedPath,
            thumbnailPath
          });
        } catch {
          usedFallback = true;
          fallbackError = heicConvertError ?? sharpError;
          await writeUnsupportedImageFallback({
            normalizedPath,
            thumbnailPath,
            label: "Photo unavailable"
          });
        }
      }
    }

    return {
      ...asset,
      storage: {
        ...asset.storage,
        normalizedPath,
        thumbnailPath
      },
      analysis: {
        ...asset.analysis,
        skipReasons: usedFallback
          ? [
              ...(asset.analysis?.skipReasons ?? []),
              unsupportedImageSkipReason(fallbackError)
            ]
          : asset.analysis?.skipReasons
      }
    };
  }

  const thumbnailPath = path.join(paths.thumbnailsDir, `${asset.id}.jpg`);
  const proxyPath = path.join(paths.proxiesDir, `${asset.id}.mp4`);
  const keyframeDir = path.join(paths.keyframesDir, asset.id);
  await mkdir(keyframeDir, { recursive: true });
  const durationSec = asset.metadata.durationSec ?? 2;
  const thumbnailSeekSec =
    durationSec <= 0.35
      ? 0
      : clamp(durationSec * 0.15, 0.04, Math.min(1.5, Math.max(0.04, durationSec - 0.04)));

  try {
    await runFfmpeg([
      "-y",
      "-ss",
      thumbnailSeekSec.toFixed(3),
      "-i",
      asset.storage.originalPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=480:320:force_original_aspect_ratio=decrease,pad=480:320:(ow-iw)/2:(oh-ih)/2:color=black",
      thumbnailPath
    ]);
  } catch {
    try {
      await runFfmpeg([
        "-y",
        "-i",
        asset.storage.originalPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=480:320:force_original_aspect_ratio=decrease,pad=480:320:(ow-iw)/2:(oh-ih)/2:color=black",
        thumbnailPath
      ]);
    } catch {
      // Ultra-short or odd videos can fail thumbnail extraction; scoring has a deterministic fallback.
    }
  }

  try {
    await runFfmpeg([
      "-y",
      "-i",
      asset.storage.originalPath,
      "-vf",
      "scale='min(960,iw)':-2",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "24",
      proxyPath
    ]);
  } catch {
    // Keep the original video as the render source when proxy generation fails.
  }

  try {
    await runFfmpeg([
      "-y",
      "-i",
      asset.storage.originalPath,
      "-vf",
      "fps=1/3,scale=640:-2",
      path.join(keyframeDir, "frame-%03d.jpg")
    ]);
  } catch {
    // Keyframes are useful for scoring, but missing keyframes should not fail the project.
  }

  const [keyframeFiles, hasProxy] = await Promise.all([
    readdir(keyframeDir).catch(() => []),
    pathExists(proxyPath)
  ]);
  return {
    ...asset,
    storage: {
      ...asset.storage,
      thumbnailPath,
      proxyPath: hasProxy ? proxyPath : undefined,
      keyframeDir
    },
    analysis: {
      ...asset.analysis,
      keyframeCount: keyframeFiles.length
    }
  };
}
