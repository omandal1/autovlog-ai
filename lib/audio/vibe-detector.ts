import type { MediaAsset, ProjectRecord, Timeline, TimelineClip, VlogVibe } from "@/lib/types";

interface TimelineMetrics {
  avgMotion: number;
  avgBrightness: number;
  avgContrast: number;
  avgDisplayDuration: number;
  fastCutRatio: number;
  imageRatio: number;
  videoRatio: number;
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clipMetrics(project: ProjectRecord, clips: TimelineClip[]): TimelineMetrics {
  const assetMap = new Map(project.assets.map((asset) => [asset.id, asset]));
  const matchedAssets = clips
    .map((clip) => assetMap.get(clip.assetId))
    .filter((asset): asset is MediaAsset => Boolean(asset));

  const avgMotion = average(matchedAssets.map((asset) => asset.score?.motion ?? 0.08));
  const avgBrightness = average(
    matchedAssets.map((asset) => asset.score?.brightness ?? 0.48)
  );
  const avgContrast = average(
    matchedAssets.map((asset) => asset.score?.contrast ?? 0.28)
  );
  const avgDisplayDuration = average(
    clips.map((clip) => Math.max(0.5, clip.displayDurationSec))
  );
  const fastCutRatio =
    clips.filter((clip) => clip.displayDurationSec <= 3.25).length / Math.max(clips.length, 1);
  const imageRatio =
    clips.filter((clip) => clip.mediaType === "image").length / Math.max(clips.length, 1);
  const videoRatio = 1 - imageRatio;

  return {
    avgMotion,
    avgBrightness,
    avgContrast,
    avgDisplayDuration,
    fastCutRatio,
    imageRatio,
    videoRatio
  };
}

function preferredVibeFromSettings(
  settings: ProjectRecord["settings"]
): VlogVibe | undefined {
  const uploadedTracks = settings.musicSelection?.uploadedSoundtracks ?? [];
  if (uploadedTracks.length) {
    const averageEnergy =
      uploadedTracks.reduce((sum, track) => sum + (track.analysis?.energyScore ?? 0.52), 0) /
      uploadedTracks.length;
    if (averageEnergy > 0.72) {
      return "energetic";
    }
    if (averageEnergy < 0.42) {
      return "emotional";
    }
  }
  if (settings.musicStyle === "lofi") {
    return "chill";
  }
  if (settings.musicStyle === "cinematic" && settings.tone === "balanced") {
    return "cinematic";
  }
  if (settings.tone === "energetic") {
    return "energetic";
  }
  if (settings.tone === "emotional") {
    return "emotional";
  }
  return undefined;
}

export function detectTimelineVibe(
  project: ProjectRecord,
  timeline: Timeline,
  clips: TimelineClip[] = timeline.clips
) {
  const metrics = clipMetrics(project, clips);
  const preference = preferredVibeFromSettings(project.settings);
  const fastCutsBoost = timeline.settings.clipDensity === "fast-cuts" ? 0.18 : -0.06;

  const scores: Record<VlogVibe, number> = {
    energetic:
      metrics.avgMotion * 2.2 +
      metrics.fastCutRatio * 1.6 +
      fastCutsBoost +
      metrics.videoRatio * 0.35 +
      (preference === "energetic" ? 0.85 : 0),
    emotional:
      (1 - metrics.avgMotion) * 1.1 +
      (0.65 - Math.abs(metrics.avgBrightness - 0.56)) * 1.1 +
      (0.38 - metrics.avgContrast) * 0.8 +
      (metrics.avgDisplayDuration > 4 ? 0.45 : 0) +
      (preference === "emotional" ? 0.85 : 0),
    chill:
      (1 - metrics.avgMotion) * 1.45 +
      (metrics.avgDisplayDuration > 3.8 ? 0.65 : 0) +
      (0.42 - metrics.avgContrast) * 0.45 +
      metrics.imageRatio * 0.22 +
      (preference === "chill" ? 0.95 : 0),
    cinematic:
      metrics.avgContrast * 1.35 +
      metrics.avgBrightness * 0.55 +
      metrics.videoRatio * 0.22 +
      (metrics.avgDisplayDuration >= 3.1 && metrics.avgDisplayDuration <= 5.6 ? 0.35 : 0) +
      (preference === "cinematic" ? 0.9 : 0)
  };

  const detected = (Object.entries(scores).sort((left, right) => right[1] - left[1])[0]?.[0] ??
    "cinematic") as VlogVibe;

  return {
    vibe: detected,
    metrics
  };
}
