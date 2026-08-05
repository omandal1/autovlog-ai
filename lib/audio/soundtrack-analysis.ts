import path from "path";

import { SOUNDTRACK_UPLOAD_POLICY } from "@/lib/constants";
import type { SoundtrackAnalysis, UploadedSoundtrack } from "@/lib/types";
import { probeFile, runFfmpeg } from "@/scripts/ffmpeg";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseVolume(stderr: string) {
  const mean = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  const peak = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  return {
    meanVolumeDb: mean ? Number(mean[1]) : undefined,
    maxVolumeDb: peak ? Number(peak[1]) : undefined
  };
}

function estimateEnergy(meanVolumeDb?: number, maxVolumeDb?: number) {
  if (typeof meanVolumeDb !== "number") {
    return 0.52;
  }
  const loudnessScore = clamp((meanVolumeDb + 36) / 22, 0, 1);
  const peakScore =
    typeof maxVolumeDb === "number" ? clamp((maxVolumeDb + 18) / 18, 0, 1) : 0.5;
  return Number(clamp(loudnessScore * 0.68 + peakScore * 0.32, 0.18, 0.94).toFixed(3));
}

function estimateBpm(filename: string, energyScore: number) {
  const lower = filename.toLowerCase();
  if (/\b(120|124|128|130|140|150)\b/.test(lower)) {
    return Number(lower.match(/\b(120|124|128|130|140|150)\b/)![1]);
  }
  if (lower.includes("lofi") || lower.includes("chill") || lower.includes("slow")) {
    return 82;
  }
  if (lower.includes("party") || lower.includes("dance") || lower.includes("hype")) {
    return 126;
  }
  return energyScore > 0.7 ? 122 : energyScore < 0.42 ? 88 : 104;
}

export function isSupportedMp3File(file: File) {
  const extension = path.extname(file.name).toLowerCase();
  return (
    SOUNDTRACK_UPLOAD_POLICY.supportedExtensions.includes(
      extension as (typeof SOUNDTRACK_UPLOAD_POLICY.supportedExtensions)[number]
    ) &&
    SOUNDTRACK_UPLOAD_POLICY.supportedMimeTypes.includes(
      (file.type || "application/octet-stream") as (typeof SOUNDTRACK_UPLOAD_POLICY.supportedMimeTypes)[number]
    )
  );
}

export function validateMp3Upload(file: File) {
  if (!isSupportedMp3File(file)) {
    throw new Error(`${file.name} is not a supported MP3 file.`);
  }
  if (file.size > SOUNDTRACK_UPLOAD_POLICY.maxTrackBytes) {
    throw new Error(
      `${file.name} is too large. MP3 files must be ${Math.round(
        SOUNDTRACK_UPLOAD_POLICY.maxTrackBytes / 1024 / 1024
      )} MB or smaller.`
    );
  }
}

export async function analyzeMp3File(filePath: string, filename: string): Promise<SoundtrackAnalysis> {
  const probe = await probeFile(filePath);
  const format = probe.format as
    | {
        duration?: string;
        bit_rate?: string;
      }
    | undefined;
  const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio") as
    | {
        codec_type?: string;
        bit_rate?: string;
        sample_rate?: string;
        channels?: number;
      }
    | undefined;
  const durationSec = Number(format?.duration ?? "0") || undefined;
  if (!durationSec || durationSec < SOUNDTRACK_UPLOAD_POLICY.minimumUsableDurationSec) {
    throw new Error(`${filename} is too short or could not be read as usable audio.`);
  }

  let meanVolumeDb: number | undefined;
  let maxVolumeDb: number | undefined;
  try {
    const target = process.platform === "win32" ? "NUL" : "/dev/null";
    const { stderr } = await runFfmpeg([
      "-y",
      "-i",
      filePath,
      "-af",
      "volumedetect",
      "-f",
      "null",
      target
    ]);
    const parsed = parseVolume(stderr);
    meanVolumeDb = parsed.meanVolumeDb;
    maxVolumeDb = parsed.maxVolumeDb;
  } catch {
    // Probe metadata is enough for a reliable fallback plan.
  }

  const energyScore = estimateEnergy(meanVolumeDb, maxVolumeDb);
  const stableStartSec = Number(clamp(durationSec * 0.035, 0, 5).toFixed(3));
  const stableEndSec = Number(Math.max(stableStartSec + 3, durationSec - clamp(durationSec * 0.035, 0, 5)).toFixed(3));

  return {
    durationSec,
    bitrateKbps:
      Number(audioStream?.bit_rate ?? format?.bit_rate ?? "0") > 0
        ? Math.round(Number(audioStream?.bit_rate ?? format?.bit_rate) / 1000)
        : undefined,
    sampleRateHz: audioStream?.sample_rate ? Number(audioStream.sample_rate) : undefined,
    channels: audioStream?.channels,
    loudnessMeanDb: meanVolumeDb,
    loudnessPeakDb: maxVolumeDb,
    silenceStartSec: stableStartSec,
    silenceEndSec: Math.max(0, durationSec - stableEndSec),
    estimatedBpm: estimateBpm(filename, energyScore),
    energyScore,
    stableStartSec,
    stableEndSec,
    confidence: typeof meanVolumeDb === "number" ? 0.74 : 0.42,
    source: typeof meanVolumeDb === "number" ? "ffprobe" : "heuristic"
  };
}

export async function analyzeMp3FileWithFallback(
  filePath: string,
  filename: string
): Promise<SoundtrackAnalysis> {
  try {
    return await analyzeMp3File(filePath, filename);
  } catch (analysisError) {
    try {
      const probe = await probeFile(filePath);
      const durationSec = Number(probe.format?.duration ?? "0") || 0;
      if (durationSec < SOUNDTRACK_UPLOAD_POLICY.minimumUsableDurationSec) {
        throw analysisError;
      }
      const edgeTrimSec = Number(clamp(durationSec * 0.02, 0, 3).toFixed(3));
      return {
        durationSec,
        energyScore: 0.52,
        stableStartSec: edgeTrimSec,
        stableEndSec: Number(Math.max(edgeTrimSec + 3, durationSec - edgeTrimSec).toFixed(3)),
        confidence: 0.22,
        source: "fallback"
      };
    } catch {
      throw analysisError;
    }
  }
}

export function soundtrackDuration(track: UploadedSoundtrack) {
  return track.analysis?.durationSec ?? 0;
}
