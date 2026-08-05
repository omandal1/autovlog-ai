import { buildCameraPath, getSafeLayoutTemplate } from "@/lib/wall-frame/layout-planner";
import { getCameraMotionDefinition } from "@/lib/wall-frame/style-registry";
import {
  calculateWallFrameDuration,
  clampTransitionDuration
} from "@/lib/wall-frame/timing";
import type {
  CameraKeyframe,
  MemoryFrame,
  NormalizedBounds,
  WallFrameRenderPlan,
  WallFrameRepairAction,
  WallFrameValidationIssue,
  WallFrameValidationReport,
  WallSection
} from "@/lib/wall-frame/types";

const SAFE_MARGIN = 0.018;
const MIN_FRAME_SIZE = 0.08;
const OVERLAP_TOLERANCE = 0.0012;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number) {
  return Number.isFinite(value);
}

function round(value: number, places = 4) {
  return Number(value.toFixed(places));
}

function intersectionArea(a: NormalizedBounds, b: NormalizedBounds) {
  const width = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const height = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  return width * height;
}

function isBoundsValid(bounds: NormalizedBounds) {
  return (
    finite(bounds.x) &&
    finite(bounds.y) &&
    finite(bounds.width) &&
    finite(bounds.height) &&
    bounds.width >= MIN_FRAME_SIZE &&
    bounds.height >= MIN_FRAME_SIZE &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.x + bounds.width <= 1 &&
    bounds.y + bounds.height <= 1
  );
}

function isCameraKeyframeValid(keyframe: CameraKeyframe) {
  return (
    finite(keyframe.x) &&
    finite(keyframe.y) &&
    finite(keyframe.zoom) &&
    keyframe.x >= 0 &&
    keyframe.x <= 1 &&
    keyframe.y >= 0 &&
    keyframe.y <= 1 &&
    keyframe.zoom >= 0.98 &&
    keyframe.zoom <= 1.2
  );
}

function buildReport(plan: WallFrameRenderPlan): WallFrameValidationReport {
  const errors: WallFrameValidationIssue[] = [];
  const warnings: WallFrameValidationIssue[] = [];
  const seenAssets = new Set<string>();

  if (!plan.wallSections.length) {
    errors.push({ code: "no-sections", message: "The Wall Frame plan has no wall sections." });
  }

  for (const section of plan.wallSections) {
    if (!finite(section.durationSec) || section.durationSec <= 0.25) {
      errors.push({
        code: "invalid-duration",
        message: `Section ${section.id} has an invalid duration.`,
        sectionId: section.id
      });
    }
    if (!section.frames.length) {
      errors.push({
        code: "empty-section",
        message: `Section ${section.id} has no assigned memories.`,
        sectionId: section.id
      });
    }
    if (
      !isCameraKeyframeValid(section.cameraPath.start) ||
      !isCameraKeyframeValid(section.cameraPath.end)
    ) {
      errors.push({
        code: "invalid-camera-path",
        message: `Section ${section.id} has an invalid camera path.`,
        sectionId: section.id
      });
    }

    for (let index = 0; index < section.frames.length; index += 1) {
      const frame = section.frames[index]!;
      if (!frame.mediaAssetId.trim() || !frame.clipId.trim() || !frame.sourcePath.trim()) {
        errors.push({
          code: "invalid-media",
          message: `Frame ${frame.id} has no usable media assignment.`,
          sectionId: section.id,
          frameId: frame.id
        });
      }
      if (seenAssets.has(frame.mediaAssetId)) {
        errors.push({
          code: "duplicate-media",
          message: `Media ${frame.mediaAssetId} is assigned more than once.`,
          sectionId: section.id,
          frameId: frame.id
        });
      }
      seenAssets.add(frame.mediaAssetId);
      if (!isBoundsValid(frame.bounds)) {
        errors.push({
          code: "out-of-bounds",
          message: `Frame ${frame.id} is outside the wall canvas.`,
          sectionId: section.id,
          frameId: frame.id
        });
      }
      if (!finite(frame.durationSec) || frame.durationSec <= 0) {
        errors.push({
          code: "invalid-duration",
          message: `Frame ${frame.id} has an invalid duration.`,
          sectionId: section.id,
          frameId: frame.id
        });
      }

      for (let nextIndex = index + 1; nextIndex < section.frames.length; nextIndex += 1) {
        const next = section.frames[nextIndex]!;
        if (intersectionArea(frame.bounds, next.bounds) > OVERLAP_TOLERANCE) {
          errors.push({
            code: "frame-overlap",
            message: `Frames ${frame.id} and ${next.id} overlap.`,
            sectionId: section.id,
            frameId: frame.id
          });
        }
      }
    }
  }

  for (const segment of plan.soundtrackPlan.segments) {
    if (
      !segment.sourcePath.trim() ||
      !finite(segment.startSec) ||
      !finite(segment.sourceOffsetSec) ||
      !finite(segment.durationSec) ||
      segment.startSec < 0 ||
      segment.sourceOffsetSec < 0 ||
      segment.durationSec <= 0 ||
      segment.startSec >= Math.max(plan.durationSec, 0.01)
    ) {
      errors.push({
        code: "invalid-soundtrack",
        message: `Soundtrack segment ${segment.id} is invalid.`
      });
    } else if (segment.startSec + segment.durationSec > plan.durationSec + 0.1) {
      warnings.push({
        code: "invalid-soundtrack",
        message: `Soundtrack segment ${segment.id} extends beyond the render and will be trimmed.`
      });
    }
  }

  const durationSec = calculateWallFrameDuration(plan.wallSections);
  if (Math.abs(durationSec - plan.durationSec) > 0.12) {
    errors.push({
      code: "invalid-duration",
      message: `Plan duration ${plan.durationSec.toFixed(3)}s does not match section timing ${durationSec.toFixed(3)}s.`
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    repairs: [],
    metrics: {
      sectionCount: plan.wallSections.length,
      frameCount: plan.wallSections.reduce((sum, section) => sum + section.frames.length, 0),
      uniqueMediaCount: seenAssets.size,
      durationSec
    }
  };
}

export function validateWallFrameRenderPlan(plan: WallFrameRenderPlan) {
  return buildReport(plan);
}

function clampBounds(bounds: NormalizedBounds) {
  const width = round(clamp(finite(bounds.width) ? bounds.width : 0.3, MIN_FRAME_SIZE, 0.78));
  const height = round(
    clamp(finite(bounds.height) ? bounds.height : 0.3, MIN_FRAME_SIZE, 0.78)
  );
  return {
    x: round(clamp(finite(bounds.x) ? bounds.x : 0.1, SAFE_MARGIN, 1 - SAFE_MARGIN - width)),
    y: round(clamp(finite(bounds.y) ? bounds.y : 0.1, SAFE_MARGIN, 1 - SAFE_MARGIN - height)),
    width,
    height
  };
}

function repairCameraKeyframe(keyframe: CameraKeyframe) {
  return {
    x: round(clamp(finite(keyframe.x) ? keyframe.x : 0.5, 0, 1)),
    y: round(clamp(finite(keyframe.y) ? keyframe.y : 0.5, 0, 1)),
    zoom: round(clamp(finite(keyframe.zoom) ? keyframe.zoom : 1.03, 0.98, 1.2))
  };
}

function reflowSection(section: WallSection, repairs: WallFrameRepairAction[]) {
  const template = getSafeLayoutTemplate(section.frames.length);
  const reflowedFrames = section.frames.map((frame, index) => ({
    ...frame,
    bounds: { ...template[index]!.bounds },
    role: template[index]!.role,
    durationSec: section.durationSec,
    startTimeSec: 0
  }));
  repairs.push({
    type: "reflow-section",
    targetId: section.id,
    detail: "Reflowed the wall section into a collision-free deterministic layout."
  });
  return reflowedFrames;
}

export function validateAndRepairWallFramePlan(plan: WallFrameRenderPlan) {
  const initialReport = buildReport(plan);
  if (initialReport.valid) {
    return {
      plan: { ...plan, validationReport: initialReport, fallbackLevel: "none" as const },
      report: initialReport
    };
  }

  const repairs: WallFrameRepairAction[] = [];
  const seenAssets = new Set<string>();
  const motion = getCameraMotionDefinition(plan.settings.cameraMotion);
  let sections = plan.wallSections
    .map((section) => {
      const sectionDurationSec =
        finite(section.durationSec) && section.durationSec > 0.25
          ? clamp(
              section.durationSec,
              motion.minSectionDurationSec,
              motion.maxSectionDurationSec
            )
          : motion.sectionDurationSec;
      if (sectionDurationSec !== section.durationSec) {
        repairs.push({
          type: "repair-duration",
          targetId: section.id,
          detail: `Set the section duration to ${sectionDurationSec.toFixed(3)} seconds.`
        });
      }

      const frames = section.frames
        .filter((frame) => {
          if (!frame.mediaAssetId?.trim() || !frame.clipId?.trim() || !frame.sourcePath?.trim()) {
            repairs.push({
              type: "remove-frame",
              targetId: frame.id,
              detail: "Removed a frame without a usable media assignment."
            });
            return false;
          }
          if (seenAssets.has(frame.mediaAssetId)) {
            repairs.push({
              type: "remove-frame",
              targetId: frame.id,
              detail: "Removed a duplicate media assignment."
            });
            return false;
          }
          seenAssets.add(frame.mediaAssetId);
          return true;
        })
        .slice(0, 5)
        .map((frame) => {
          const bounds = clampBounds(frame.bounds);
          if (JSON.stringify(bounds) !== JSON.stringify(frame.bounds)) {
            repairs.push({
              type: "clamp-frame",
              targetId: frame.id,
              detail: "Clamped the frame to the safe wall canvas."
            });
          }
          return {
            ...frame,
            bounds,
            trimStartSec: Math.max(0, finite(frame.trimStartSec) ? frame.trimStartSec : 0),
            startTimeSec: 0,
            durationSec: sectionDurationSec
          };
        });

      const repairedCamera = {
        ...section.cameraPath,
        start: repairCameraKeyframe(section.cameraPath.start),
        end: repairCameraKeyframe(section.cameraPath.end)
      };
      if (JSON.stringify(repairedCamera) !== JSON.stringify(section.cameraPath)) {
        repairs.push({
          type: "repair-camera",
          targetId: section.id,
          detail: "Clamped the camera path to stable wall coordinates."
        });
      }

      const provisional = {
        ...section,
        durationSec: round(sectionDurationSec, 3),
        frames,
        cameraPath: repairedCamera
      };
      const hasCollision = frames.some((frame, index) =>
        frames
          .slice(index + 1)
          .some((next) => intersectionArea(frame.bounds, next.bounds) > OVERLAP_TOLERANCE)
      );
      const hasInvalidBounds = frames.some((frame) => !isBoundsValid(frame.bounds));
      return {
        ...provisional,
        frames:
          hasCollision || hasInvalidBounds ? reflowSection(provisional, repairs) : provisional.frames
      };
    })
    .filter((section) => {
      if (section.frames.length) {
        return true;
      }
      repairs.push({
        type: "remove-frame",
        targetId: section.id,
        detail: "Removed an empty wall section."
      });
      return false;
    });

  sections = sections.map((section, index) => ({
    ...section,
    transitionToNext:
      index < sections.length - 1
        ? {
            type: section.transitionToNext?.type ?? "fade",
            durationSec: clampTransitionDuration({
              requestedSec:
                section.transitionToNext?.durationSec ?? motion.transitionDurationSec,
              fromDurationSec: section.durationSec,
              toDurationSec: sections[index + 1]!.durationSec,
              fps: plan.renderSize.fps
            })
          }
        : undefined
  }));
  const durationSec = calculateWallFrameDuration(sections);
  const soundtrackSegments = plan.soundtrackPlan.segments
    .filter(
      (segment) =>
        segment.sourcePath?.trim() &&
        finite(segment.startSec) &&
        finite(segment.sourceOffsetSec) &&
        finite(segment.durationSec) &&
        segment.startSec >= 0 &&
        segment.sourceOffsetSec >= 0 &&
        segment.durationSec > 0 &&
        segment.startSec < durationSec
    )
    .map((segment) => {
      const trimmedDuration = round(Math.min(segment.durationSec, durationSec - segment.startSec), 3);
      if (trimmedDuration !== segment.durationSec) {
        repairs.push({
          type: "trim-soundtrack",
          targetId: segment.id,
          detail: "Trimmed the soundtrack segment to the wall render duration."
        });
      }
      return {
        ...segment,
        startSec: round(segment.startSec, 3),
        sourceOffsetSec: round(segment.sourceOffsetSec, 3),
        durationSec: trimmedDuration,
        crossfadeSec: round(clamp(segment.crossfadeSec, 0, trimmedDuration / 2), 3)
      };
    });

  const repairedPlan: WallFrameRenderPlan = {
    ...plan,
    wallSections: sections,
    cameraMoves: sections.map((section) => section.cameraPath),
    soundtrackPlan: {
      ...plan.soundtrackPlan,
      segments: soundtrackSegments
    },
    durationSec,
    fallbackLevel: "repaired",
    validationReport: plan.validationReport
  };
  const report = buildReport(repairedPlan);
  report.repairs = repairs;
  return {
    plan: { ...repairedPlan, validationReport: report },
    report
  };
}

export function buildSimpleWallFrameFallback(plan: WallFrameRenderPlan) {
  const uniqueFrames = new Map<string, MemoryFrame>();
  for (const section of plan.wallSections) {
    for (const frame of section.frames) {
      if (frame.mediaAssetId && frame.sourcePath && !uniqueFrames.has(frame.mediaAssetId)) {
        uniqueFrames.set(frame.mediaAssetId, frame);
      }
    }
  }
  const motion = getCameraMotionDefinition(plan.settings.cameraMotion);
  const singleTemplate = getSafeLayoutTemplate(1)[0]!;
  const sourceFrames = [...uniqueFrames.values()];
  const sections: WallSection[] = sourceFrames.map((frame, index) => {
    const durationSec = round(
      clamp(
        frame.mediaType === "video"
          ? Math.min(frame.sourceDurationSec ?? motion.sectionDurationSec, motion.sectionDurationSec)
          : motion.sectionDurationSec,
        motion.minSectionDurationSec,
        motion.maxSectionDurationSec
      ),
      3
    );
    return {
      id: `simple_${String(index + 1).padStart(3, "0")}_${frame.id}`,
      frames: [
        {
          ...frame,
          bounds: { ...singleTemplate.bounds },
          role: "hero",
          startTimeSec: 0,
          durationSec,
          zDepth: 0.8
        }
      ],
      backgroundStyle: plan.settings.wallStyle,
      durationSec,
      cameraPath: buildCameraPath(index, plan.settings, index * 97 + 11),
      transitionToNext:
        index < sourceFrames.length - 1
          ? { type: "fade", durationSec: Math.min(0.45, motion.transitionDurationSec) }
          : undefined
    };
  });
  const durationSec = calculateWallFrameDuration(sections);
  const fallback: WallFrameRenderPlan = {
    ...plan,
    id: `${plan.id}_simple`,
    wallSections: sections,
    cameraMoves: sections.map((section) => section.cameraPath),
    durationSec,
    soundtrackPlan: {
      ...plan.soundtrackPlan,
      segments: plan.soundtrackPlan.segments
        .filter((segment) => segment.startSec < durationSec)
        .map((segment) => ({
          ...segment,
          durationSec: round(Math.min(segment.durationSec, durationSec - segment.startSec), 3)
        }))
    },
    fallbackLevel: "simple",
    validationReport: plan.validationReport
  };
  const report = buildReport(fallback);
  report.repairs = [
    ...plan.validationReport.repairs,
    {
      type: "simple-fallback",
      targetId: fallback.id,
      detail: "Rebuilt the montage as one centered memory per wall section."
    }
  ];
  return { ...fallback, validationReport: report };
}

export function assertValidWallFramePlan(plan: WallFrameRenderPlan) {
  const report = buildReport(plan);
  if (!report.valid) {
    throw new Error(
      `Invalid Wall Frame render plan: ${report.errors.map((issue) => issue.message).join(" ")}`
    );
  }
  return report;
}
