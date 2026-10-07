import { hashWallFrameSeed, planWallFrameGallery } from "@/lib/wall-frame/layout-planner";
import { normalizeWallFrameSettings } from "@/lib/wall-frame/style-registry";
import { calculateWallFrameDuration } from "@/lib/wall-frame/timing";
import type {
  BuildWallFrameRenderPlanInput,
  WallFrameRenderPlan,
  WallFrameSoundtrackPlan,
  WallFrameValidationReport
} from "@/lib/wall-frame/types";
import { validateAndRepairWallFramePlan } from "@/lib/wall-frame/validator";

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value!)));
}

function even(value: number) {
  return value % 2 === 0 ? value : value - 1;
}

function emptyValidationReport(): WallFrameValidationReport {
  return {
    valid: false,
    errors: [],
    warnings: [],
    repairs: [],
    metrics: {
      sectionCount: 0,
      frameCount: 0,
      uniqueMediaCount: 0,
      durationSec: 0,
      heroCoveredMediaCount: 0,
      heroCoverageRatio: 0,
      averageHeroAppearances: 0,
      maxHeroAppearancesForSingleAsset: 0,
      uniqueFrameStylesUsed: 0,
      uniqueFrameShapesUsed: 0,
      duplicateUsageCount: 0
    }
  };
}

function defaultSoundtrackPlan(): WallFrameSoundtrackPlan {
  return {
    sourcePolicy: "internal-licensed",
    segments: [],
    usesInternalFallback: true
  };
}

function fitSoundtrackPlanToDuration(
  soundtrackPlan: WallFrameSoundtrackPlan,
  durationSec: number
): WallFrameSoundtrackPlan {
  const sourceSegments = soundtrackPlan.segments
      .filter(
        (segment) =>
          segment.sourcePath?.trim() &&
          Number.isFinite(segment.startSec) &&
          Number.isFinite(segment.durationSec) &&
          segment.startSec >= 0 &&
          segment.durationSec > 0 &&
          segment.startSec < durationSec
      )
      .map((segment) => {
        const fittedDuration = Math.min(segment.durationSec, durationSec - segment.startSec);
        return {
          ...segment,
          startSec: Number(segment.startSec.toFixed(3)),
          sourceOffsetSec:
            soundtrackPlan.sourcePolicy === "user-uploaded-audio"
              ? 0
              : Number(Math.max(0, segment.sourceOffsetSec).toFixed(3)),
          durationSec: Number(fittedDuration.toFixed(3)),
          crossfadeSec: Number(
            Math.max(0, Math.min(segment.crossfadeSec, fittedDuration / 2)).toFixed(3)
          )
        };
      });
  const segments = [...sourceSegments];
  if (segments.length) {
    let cursor = segments.reduce(
      (maximum, segment) => Math.max(maximum, segment.startSec + segment.durationSec),
      0
    );
    let repeatIndex = 0;
    while (cursor < durationSec - 0.05 && repeatIndex < 256) {
      const source = sourceSegments[repeatIndex % sourceSegments.length]!;
      const crossfadeSec = Math.min(source.crossfadeSec, source.durationSec / 3, cursor);
      const startSec = Math.max(0, cursor - crossfadeSec);
      const duration = Math.min(source.durationSec, durationSec - startSec);
      if (duration <= 0.05) break;
      segments.push({
        ...source,
        id: `${source.id}_repeat_${repeatIndex + 1}`,
        startSec: Number(startSec.toFixed(3)),
        durationSec: Number(duration.toFixed(3)),
        crossfadeSec: Number(Math.min(crossfadeSec, duration / 2).toFixed(3))
      });
      cursor = startSec + duration;
      repeatIndex += 1;
    }
  }
  return {
    ...soundtrackPlan,
    segments
  };
}

export function buildWallFrameRenderPlan(
  input: BuildWallFrameRenderPlanInput
): WallFrameRenderPlan {
  const seen = new Set<string>();
  const assets = input.assets.filter((asset) => {
    if (
      !asset.id?.trim() ||
      !asset.clipId?.trim() ||
      !asset.sourcePath?.trim() ||
      seen.has(asset.id)
    ) {
      return false;
    }
    seen.add(asset.id);
    return asset.mediaType === "image" || asset.mediaType === "video";
  });
  if (!assets.length) {
    throw new Error("Wall Frame Memories requires at least one usable photo or video.");
  }

  const settings = normalizeWallFrameSettings(input.settings);
  const width = even(clampInteger(input.renderSize?.width, 1920, 640, 3840));
  const height = even(clampInteger(input.renderSize?.height, 1080, 360, 2160));
  const fps = clampInteger(input.renderSize?.fps, 30, 20, 60);
  const gallery = planWallFrameGallery({
    projectId: input.projectId,
    assets,
    settings,
    outputRole: input.outputRole ?? "master",
    clusterVideoCount: input.clusterVideoCount
  });
  const wallSections = gallery.wallSections;
  const durationSec = calculateWallFrameDuration(wallSections);
  const planSeed = hashWallFrameSeed(
    `${input.projectId}:${assets.map((asset) => asset.id).join(":")}:${JSON.stringify(settings)}`
  );
  const basePlan: WallFrameRenderPlan = {
    id: `wall_frame_${planSeed.toString(36)}`,
    projectId: input.projectId,
    outputType: "wall-frame",
    outputRole: input.outputRole ?? "master",
    clusterId: input.clusterId,
    title: input.title.trim() || "Wall Frame Memories",
    wallSections,
    cameraMoves: wallSections.map((section) => section.cameraPath),
    motionBeats: wallSections.flatMap((section) => section.motionBeats),
    soundtrackPlan: fitSoundtrackPlanToDuration(
      input.soundtrackPlan ?? defaultSoundtrackPlan(),
      durationSec
    ),
    durationSec,
    renderSize: { width, height, fps },
    settings,
    selectedMasterMedia: gallery.selectedAssets.map((asset) => asset.id),
    excludedMedia: gallery.excludedMedia,
    mediaCoverage: gallery.mediaCoverage,
    coverageMetrics: gallery.coverageMetrics,
    validationReport: emptyValidationReport(),
    fallbackLevel: "none"
  };

  return validateAndRepairWallFramePlan(basePlan).plan;
}
