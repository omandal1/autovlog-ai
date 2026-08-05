import { randomUUID } from "crypto";
import { mkdir, rename, stat, unlink } from "fs/promises";
import path from "path";

import { probeFile, runFfmpeg } from "@/scripts/ffmpeg";

export interface VideoProbeSummary {
  path: string;
  sizeBytes: number;
  durationSec: number;
  codecName?: string;
  pixelFormat?: string;
  width?: number;
  height?: number;
  fps?: number;
  sampleAspectRatio?: string;
  displayAspectRatio?: string;
}

export interface VideoValidationOptions {
  label?: string;
  minBytes?: number;
  minDurationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  requireH264?: boolean;
  requireYuv420p?: boolean;
  decode?: boolean;
}

export interface VideoValidationResult {
  valid: boolean;
  reason?: string;
  metadata?: VideoProbeSummary;
}

function parseFiniteNumber(value: string | number | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseRate(value?: string) {
  if (!value || value === "0/0") {
    return undefined;
  }
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  return numerator / denominator;
}

function summarizeError(error: unknown) {
  const details =
    typeof error === "object" && error
      ? `${"stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : ""}\n${
          "message" in error ? String((error as { message?: unknown }).message ?? "") : ""
        }`
      : String(error);
  return details.replace(/\s+/g, " ").trim().slice(0, 1800);
}

function invalid(reason: string, metadata?: VideoProbeSummary): VideoValidationResult {
  return {
    valid: false,
    reason,
    metadata
  };
}

export function formatVideoDiagnostics(result: VideoValidationResult) {
  const metadata = result.metadata;
  const details = metadata
    ? `path=${metadata.path}; size=${metadata.sizeBytes}; duration=${metadata.durationSec.toFixed(
        3
      )}; codec=${metadata.codecName ?? "unknown"}; pix_fmt=${
        metadata.pixelFormat ?? "unknown"
      }; resolution=${metadata.width ?? "?"}x${metadata.height ?? "?"}; fps=${
        metadata.fps ? metadata.fps.toFixed(3) : "unknown"
      }; sar=${metadata.sampleAspectRatio ?? "unknown"}`
    : "metadata unavailable";
  return `${result.reason ?? "unknown validation failure"} (${details})`;
}

export async function probeVideoSummary(filePath: string): Promise<VideoProbeSummary> {
  const fileStat = await stat(filePath);
  const probe = await probeFile(filePath);
  const stream = probe.streams?.find((item) => item.codec_type === "video");
  const durationSec =
    parseFiniteNumber(stream?.duration) ??
    parseFiniteNumber(probe.format?.duration) ??
    0;
  const fps = parseRate(stream?.avg_frame_rate) ?? parseRate(stream?.r_frame_rate);

  return {
    path: filePath,
    sizeBytes: fileStat.size,
    durationSec,
    codecName: stream?.codec_name,
    pixelFormat: stream?.pix_fmt,
    width: stream?.width,
    height: stream?.height,
    fps,
    sampleAspectRatio: stream?.sample_aspect_ratio,
    displayAspectRatio: stream?.display_aspect_ratio
  };
}

export async function validateVideoFile(
  filePath: string,
  options: VideoValidationOptions = {}
): Promise<VideoValidationResult> {
  const label = options.label ?? filePath;
  const minBytes = options.minBytes ?? 1024;
  let metadata: VideoProbeSummary;

  try {
    metadata = await probeVideoSummary(filePath);
  } catch (error) {
    return invalid(`${label} could not be probed: ${summarizeError(error)}`);
  }

  if (metadata.sizeBytes < minBytes) {
    return invalid(`${label} is too small to be a valid MP4`, metadata);
  }
  if (!metadata.durationSec || metadata.durationSec <= 0) {
    return invalid(`${label} has no valid duration`, metadata);
  }
  if (options.minDurationSec !== undefined && metadata.durationSec + 0.06 < options.minDurationSec) {
    return invalid(
      `${label} is shorter than required (${metadata.durationSec.toFixed(3)}s < ${options.minDurationSec.toFixed(
        3
      )}s)`,
      metadata
    );
  }
  if (!metadata.width || !metadata.height) {
    return invalid(`${label} has no usable video dimensions`, metadata);
  }
  if (options.width && metadata.width !== options.width) {
    return invalid(`${label} width ${metadata.width} did not match ${options.width}`, metadata);
  }
  if (options.height && metadata.height !== options.height) {
    return invalid(`${label} height ${metadata.height} did not match ${options.height}`, metadata);
  }
  if (options.fps && metadata.fps && Math.abs(metadata.fps - options.fps) > 0.45) {
    return invalid(`${label} fps ${metadata.fps.toFixed(3)} did not match ${options.fps}`, metadata);
  }
  if (options.requireH264 && metadata.codecName !== "h264") {
    return invalid(`${label} codec ${metadata.codecName ?? "unknown"} is not h264`, metadata);
  }
  if (options.requireYuv420p && metadata.pixelFormat !== "yuv420p") {
    return invalid(`${label} pixel format ${metadata.pixelFormat ?? "unknown"} is not yuv420p`, metadata);
  }

  if (options.decode !== false) {
    try {
      await runFfmpeg([
        "-v",
        "error",
        "-xerror",
        "-i",
        filePath,
        "-map",
        "0:v:0",
        "-f",
        "null",
        "-"
      ]);
    } catch (error) {
      return invalid(`${label} failed decode validation: ${summarizeError(error)}`, metadata);
    }
  }

  return {
    valid: true,
    metadata
  };
}

export async function assertValidVideoFile(
  filePath: string,
  options: VideoValidationOptions = {}
) {
  const result = await validateVideoFile(filePath, options);
  if (!result.valid) {
    throw new Error(formatVideoDiagnostics(result));
  }
  return result.metadata!;
}

function buildAtomicTempPath(outputPath: string) {
  const parsed = path.parse(outputPath);
  const token = randomUUID().slice(0, 8);
  return path.join(parsed.dir, `${parsed.name}.tmp-${process.pid}-${token}${parsed.ext}`);
}

async function unlinkIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch {
    // Missing stale temp/final files are expected.
  }
}

export async function writeAtomicVideo(options: {
  outputPath: string;
  label: string;
  validation: VideoValidationOptions;
  render: (temporaryOutputPath: string) => Promise<unknown>;
}) {
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  const temporaryOutputPath = buildAtomicTempPath(options.outputPath);

  try {
    await unlinkIfPresent(temporaryOutputPath);
    await options.render(temporaryOutputPath);

    const temporaryValidation = await validateVideoFile(temporaryOutputPath, {
      ...options.validation,
      label: `${options.label} temporary output`,
      decode: options.validation.decode ?? true
    });
    if (!temporaryValidation.valid) {
      console.error(`[render] Invalid temporary video: ${formatVideoDiagnostics(temporaryValidation)}`);
      throw new Error(formatVideoDiagnostics(temporaryValidation));
    }

    await unlinkIfPresent(options.outputPath);
    await rename(temporaryOutputPath, options.outputPath);

    return assertValidVideoFile(options.outputPath, {
      ...options.validation,
      label: options.label,
      decode: false
    });
  } catch (error) {
    await unlinkIfPresent(temporaryOutputPath);
    throw error;
  }
}
