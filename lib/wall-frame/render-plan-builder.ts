import { hashWallFrameSeed, planWallFrameSections } from "@/lib/wall-frame/layout-planner";
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
      durationSec: 0
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
  return {
    ...soundtrackPlan,
    segments: soundtrackPlan.segments
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
          sourceOffsetSec: Number(Math.max(0, segment.sourceOffsetSec).toFixed(3)),
          durationSec: Number(fittedDuration.toFixed(3)),
          crossfadeSec: Number(
            Math.max(0, Math.min(segment.crossfadeSec, fittedDuration / 2)).toFixed(3)
          )
        };
      })
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
  const wallSections = planWallFrameSections({
    projectId: input.projectId,
    assets,
    settings
  });
  const durationSec = calculateWallFrameDuration(wallSections);
  const planSeed = hashWallFrameSeed(
    `${input.projectId}:${assets.map((asset) => asset.id).join(":")}:${JSON.stringify(settings)}`
  );
  const basePlan: WallFrameRenderPlan = {
    id: `wall_frame_${planSeed.toString(36)}`,
    projectId: input.projectId,
    outputType: "wall-frame",
    title: input.title.trim() || "Wall Frame Memories",
    wallSections,
    cameraMoves: wallSections.map((section) => section.cameraPath),
    soundtrackPlan: fitSoundtrackPlanToDuration(
      input.soundtrackPlan ?? defaultSoundtrackPlan(),
      durationSec
    ),
    durationSec,
    renderSize: { width, height, fps },
    settings,
    validationReport: emptyValidationReport(),
    fallbackLevel: "none"
  };

  return validateAndRepairWallFramePlan(basePlan).plan;
}
