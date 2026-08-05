import type { Timeline, TimelineClip } from "@/lib/types";

import { probeFile, runFfmpeg } from "@/scripts/ffmpeg";

function parseVolumeMetric(stderr: string, metric: "mean_volume" | "max_volume") {
  const match = stderr.match(new RegExp(`${metric}:\\s*(-?[\\d.]+)\\s*dB`, "i"));
  return match ? Number(match[1]) : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveSourceGainDb(meanVolumeDb?: number) {
  if (meanVolumeDb === undefined || !Number.isFinite(meanVolumeDb)) {
    return 0;
  }
  if (meanVolumeDb <= -34) {
    return 7;
  }
  if (meanVolumeDb <= -28) {
    return 5;
  }
  if (meanVolumeDb <= -23) {
    return 3;
  }
  if (meanVolumeDb >= -12) {
    return -1.5;
  }
  if (meanVolumeDb >= -16) {
    return -0.5;
  }
  return 1;
}

function resolveMusicDuckDb(meanVolumeDb?: number, hasAudio?: boolean) {
  if (!hasAudio) {
    return 0;
  }
  if (meanVolumeDb === undefined || !Number.isFinite(meanVolumeDb)) {
    return -14;
  }
  if (meanVolumeDb >= -12) {
    return -18;
  }
  if (meanVolumeDb >= -18) {
    return -16;
  }
  if (meanVolumeDb >= -24) {
    return -13;
  }
  return -10;
}

async function analyzeClipAudio(clip: TimelineClip) {
  if (clip.mediaType !== "video" || !clip.audioSourcePath) {
    return {
      hasAudio: false,
      gainDb: 0,
      musicDuckDb: 0
    };
  }

  const probe = await probeFile(clip.audioSourcePath);
  const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!audioStream) {
    return {
      hasAudio: false,
      gainDb: 0,
      musicDuckDb: 0
    };
  }

  let meanVolumeDb: number | undefined;
  let maxVolumeDb: number | undefined;
  try {
    const { stderr } = await runFfmpeg([
      "-ss",
      clip.trimStartSec.toFixed(3),
      "-t",
      clip.trimDurationSec.toFixed(3),
      "-i",
      clip.audioSourcePath,
      "-vn",
      "-af",
      "volumedetect",
      "-f",
      "null",
      process.platform === "win32" ? "NUL" : "/dev/null"
    ]);
    meanVolumeDb = parseVolumeMetric(stderr, "mean_volume");
    maxVolumeDb = parseVolumeMetric(stderr, "max_volume");
  } catch {
    meanVolumeDb = undefined;
    maxVolumeDb = undefined;
  }

  const gainDb = resolveSourceGainDb(meanVolumeDb);
  const musicDuckDb = resolveMusicDuckDb(meanVolumeDb, true);
  return {
    hasAudio: true,
    meanVolumeDb,
    maxVolumeDb,
    gainDb: Number(clamp(gainDb, -3, 8).toFixed(2)),
    musicDuckDb: Number(clamp(musicDuckDb, -20, 0).toFixed(2))
  };
}

export async function analyzeTimelineSourceAudio(timeline: Timeline) {
  const cache = new Map<string, Awaited<ReturnType<typeof analyzeClipAudio>>>();
  const clips: TimelineClip[] = [];

  for (const clip of timeline.clips) {
    if (clip.mediaType !== "video" || !clip.audioSourcePath) {
      clips.push({
        ...clip,
        sourceAudio: {
          hasAudio: false,
          gainDb: 0,
          musicDuckDb: 0
        }
      });
      continue;
    }

    const cacheKey = `${clip.audioSourcePath}:${clip.trimStartSec.toFixed(3)}:${clip.trimDurationSec.toFixed(3)}`;
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, await analyzeClipAudio(clip));
    }

    clips.push({
      ...clip,
      sourceAudio: cache.get(cacheKey)!
    });
  }

  return {
    ...timeline,
    clips
  };
}
