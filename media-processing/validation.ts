import { stat } from "node:fs/promises";

import type { MediaType } from "@/lib/types";
import { probeFile, runFfmpeg } from "@/scripts/ffmpeg";

export interface SourceValidationResult {
  valid: boolean;
  reason?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  codec?: string;
  fps?: number;
}

function finitePositive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseRate(value?: string) {
  if (!value || value === "0/0") return undefined;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !denominator) {
    return undefined;
  }
  return numerator / denominator;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 900);
}

async function requireNonemptyFile(filePath: string) {
  const file = await stat(filePath);
  if (!file.isFile() || file.size <= 0) {
    throw new Error("file is empty or is not a regular file");
  }
}

async function smokeDecode(filePath: string, stream: "video" | "audio") {
  await runFfmpeg([
    "-v",
    "error",
    "-xerror",
    "-t",
    "1",
    "-i",
    filePath,
    "-map",
    stream === "video" ? "0:v:0" : "0:a:0",
    "-f",
    "null",
    "-"
  ]);
}

export async function validateMediaSource(
  filePath: string,
  mediaType: MediaType
): Promise<SourceValidationResult> {
  try {
    await requireNonemptyFile(filePath);

    if (mediaType === "image") {
      try {
        const { default: sharp } = await import("sharp");
        const image = sharp(filePath, { failOn: "error" });
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height) {
          throw new Error("decoded image has no usable dimensions");
        }
        await image.clone().resize(1, 1).raw().toBuffer();
        return { valid: true, width: metadata.width, height: metadata.height };
      } catch (sharpError) {
        const probe = await probeFile(filePath);
        const stream = probe.streams?.find((item) => item.codec_type === "video");
        if (!stream?.width || !stream.height) throw sharpError;
        await smokeDecode(filePath, "video");
        return { valid: true, width: stream.width, height: stream.height, codec: stream.codec_name };
      }
    }

    const probe = await probeFile(filePath);
    const stream = probe.streams?.find((item) => item.codec_type === "video");
    const durationSec =
      finitePositive(stream?.duration) ?? finitePositive(probe.format?.duration);
    const fps = parseRate(stream?.avg_frame_rate) ?? parseRate(stream?.r_frame_rate);
    if (!stream) throw new Error("no video stream was found");
    if (!durationSec) throw new Error("video duration is missing or invalid");
    if (!stream.width || !stream.height) throw new Error("video dimensions are missing");
    if (!stream.codec_name) throw new Error("video codec is missing");
    if (!fps) throw new Error("video frame rate is missing or invalid");
    await smokeDecode(filePath, "video");
    return {
      valid: true,
      durationSec,
      width: stream.width,
      height: stream.height,
      codec: stream.codec_name,
      fps
    };
  } catch (error) {
    return { valid: false, reason: errorMessage(error) || "media validation failed" };
  }
}

export async function validateSoundtrackSource(
  filePath: string
): Promise<SourceValidationResult> {
  try {
    await requireNonemptyFile(filePath);
    const probe = await probeFile(filePath);
    const stream = probe.streams?.find((item) => item.codec_type === "audio");
    const durationSec =
      finitePositive(stream?.duration) ?? finitePositive(probe.format?.duration);
    if (!stream) throw new Error("no audio stream was found");
    if (!durationSec) throw new Error("audio duration is missing or invalid");
    if (!stream.codec_name) throw new Error("audio codec is missing");
    await smokeDecode(filePath, "audio");
    return { valid: true, durationSec, codec: stream.codec_name };
  } catch (error) {
    return { valid: false, reason: errorMessage(error) || "soundtrack validation failed" };
  }
}
