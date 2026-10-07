import {
  buildCameraPath,
  buildSectionMotionBeats,
  getSafeLayoutTemplate
} from "@/lib/wall-frame/layout-planner";
import { getCameraMotionDefinition } from "@/lib/wall-frame/style-registry";
import {
  calculateWallFrameDuration,
  clampTransitionDuration
} from "@/lib/wall-frame/timing";
import type {
  CameraKeyframe,
  CameraTransform,
  MemoryFrame,
  NormalizedBounds,
  WallFrameRenderPlan,
  WallFrameMediaCoverage,
  WallFrameRepairAction,
  WallFrameValidationIssue,
  WallFrameValidationReport,
  WallSection
} from "@/lib/wall-frame/types";

const SAFE_MARGIN = 0.018;
const MIN_FRAME_SIZE = 0.08;
const OVERLAP_TOLERANCE = 0.0012;
const MAX_MEANINGFUL_MOTION_GAP_SEC = 6;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number) {
  return Number.isFinite(value);
}

function round(value: number, places = 4) {
  return Number(value.toFixed(places));
}

function refreshCoverage(plan: WallFrameRenderPlan): Pick<
  WallFrameRenderPlan,
  "mediaCoverage" | "coverageMetrics"
> {
  const previous = new Map(plan.mediaCoverage.map((item) => [item.mediaAssetId, item]));
  const selectedIds = plan.selectedMasterMedia;
  const coverage = new Map<string, WallFrameMediaCoverage>();
  selectedIds.forEach((mediaAssetId) => {
    const prior = previous.get(mediaAssetId);
    coverage.set(mediaAssetId, {
      mediaAssetId,
      selectedForMaster: plan.outputRole === "master",
      heroAppearanceCount: 0,
      supportingAppearanceCount: 0,
      hasBeenHero: false,
      coveragePriority: prior?.coveragePriority ?? 0,
      importanceScore: prior?.importanceScore ?? 0.5,
      editorialScore: prior?.editorialScore ?? 0.5,
      clusterId: prior?.clusterId
    });
  });

  plan.wallSections.forEach((section, sectionIndex) => {
    section.frames.forEach((frame) => {
      const item = coverage.get(frame.mediaAssetId);
      if (!item) return;
      if (frame.role === "hero") {
        item.heroAppearanceCount += 1;
        item.hasBeenHero = true;
        item.firstHeroSceneIndex ??= sectionIndex;
        item.lastHeroSceneIndex = sectionIndex;
      } else {
        item.supportingAppearanceCount += 1;
        item.lastSupportingSceneIndex = sectionIndex;
      }
    });
  });

  const mediaCoverage = [...coverage.values()];
  const allFrames = plan.wallSections.flatMap((section) => section.frames);
  const appearanceCounts = new Map<string, number>();
  allFrames.forEach((frame) => {
    appearanceCounts.set(frame.mediaAssetId, (appearanceCounts.get(frame.mediaAssetId) ?? 0) + 1);
  });
  const heroCounts = mediaCoverage.map((item) => item.heroAppearanceCount);
  const heroCoveredMediaCount = mediaCoverage.filter((item) => item.hasBeenHero).length;
  return {
    mediaCoverage,
    coverageMetrics: {
      selectedMediaCount: selectedIds.length,
      heroCoveredMediaCount,
      heroCoverageRatio: selectedIds.length ? heroCoveredMediaCount / selectedIds.length : 0,
      averageHeroAppearances: selectedIds.length
        ? heroCounts.reduce((sum, count) => sum + count, 0) / selectedIds.length
        : 0,
      maxHeroAppearancesForSingleAsset: Math.max(0, ...heroCounts),
      uniqueFrameStylesUsed: new Set(allFrames.map((frame) => frame.frameStyle)).size,
      uniqueFrameShapesUsed: new Set(allFrames.map((frame) => frame.frameShape)).size,
      wallSectionCount: plan.wallSections.length,
      clusterVideoCount: plan.coverageMetrics.clusterVideoCount,
      duplicateUsageCount: [...appearanceCounts.values()].reduce(
        (sum, count) => sum + Math.max(0, count - 1),
        0
      ),
      estimatedHeroCapacity: Math.max(
        plan.coverageMetrics.estimatedHeroCapacity,
        allFrames.filter((frame) => frame.role === "hero").length
      )
    }
  };
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

function isCameraTransformValid(transform: CameraTransform) {
  return (
    finite(transform.x) &&
    finite(transform.y) &&
    finite(transform.scale) &&
    finite(transform.rotation) &&
    finite(transform.perspective) &&
    finite(transform.blur) &&
    finite(transform.depth) &&
    transform.x >= 0 &&
    transform.x <= 1 &&
    transform.y >= 0 &&
    transform.y <= 1 &&
    transform.scale >= 0.85 &&
    transform.scale <= 4 &&
    Math.abs(transform.rotation) <= 12 &&
    transform.perspective >= 0 &&
    transform.perspective <= 1 &&
    transform.blur >= 0 &&
    transform.blur <= 1 &&
    transform.depth >= 0 &&
    transform.depth <= 1
  );
}

function buildReport(plan: WallFrameRenderPlan): WallFrameValidationReport {
  const errors: WallFrameValidationIssue[] = [];
  const warnings: WallFrameValidationIssue[] = [];
  const seenAssets = new Set<string>();
  const heroCounts = new Map<string, number>();
  const appearanceCounts = new Map<string, number>();
  const frameStyles = new Set<string>();
  const frameShapes = new Set<string>();
  const seenMotionTypes = new Set<string>();

  if (!plan.wallSections.length) {
    errors.push({ code: "no-sections", message: "The Wall Frame plan has no wall sections." });
  }

  for (const section of plan.wallSections) {
    const sectionAssets = new Set<string>();
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
    if (!section.frames.some((frame) => frame.role === "hero")) {
      errors.push({
        code: "missing-motion-pattern",
        message: `Section ${section.id} has no hero memory frame.`,
        sectionId: section.id
      });
    }
    const frameIds = new Set(section.frames.map((frame) => frame.id));
    const orderedBeats = [...(section.motionBeats ?? [])].sort(
      (a, b) => a.startTimeSec - b.startTimeSec
    );
    for (const hero of section.frames.filter((frame) => frame.role === "hero")) {
      if (!orderedBeats.some((beat) =>
        beat.type === "hero-focus-hold" && beat.activeFrameIds.includes(hero.id) &&
        beat.durationSec > 0 && beat.cameraTransformEnd.scale > 1.3
      )) {
        errors.push({
          code: "incomplete-hero-coverage",
          message: `Hero ${hero.id} has no actual camera focus moment.`,
          sectionId: section.id,
          frameId: hero.id
        });
      }
    }
    if (!orderedBeats.length) {
      errors.push({
        code: "invalid-motion-beat",
        message: `Section ${section.id} has no planned motion beats.`,
        sectionId: section.id
      });
    }
    let previousEventTime = 0;
    for (const beat of orderedBeats) {
      seenMotionTypes.add(beat.type);
      const beatEnd = beat.startTimeSec + beat.durationSec;
      if (
        !finite(beat.startTimeSec) ||
        !finite(beat.durationSec) ||
        beat.startTimeSec < 0 ||
        beat.durationSec <= 0 ||
        beatEnd > section.durationSec + 0.12 ||
        !isCameraTransformValid(beat.cameraTransformStart) ||
        !isCameraTransformValid(beat.cameraTransformEnd) ||
        !beat.activeFrameIds.length ||
        beat.activeFrameIds.some((id) => !frameIds.has(id))
      ) {
        errors.push({
          code: "invalid-motion-beat",
          message: `Motion beat ${beat.id} is invalid or targets a missing frame.`,
          sectionId: section.id
        });
      }
      if (beat.startTimeSec - previousEventTime > MAX_MEANINGFUL_MOTION_GAP_SEC) {
        errors.push({
          code: "motion-gap",
          message: `Section ${section.id} waits more than six seconds between meaningful motion events.`,
          sectionId: section.id
        });
      }
      previousEventTime = beat.startTimeSec;
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
      if (sectionAssets.has(frame.mediaAssetId)) {
        errors.push({
          code: "duplicate-media",
          message: `Media ${frame.mediaAssetId} is assigned more than once in the same wall section.`,
          sectionId: section.id,
          frameId: frame.id
        });
      }
      sectionAssets.add(frame.mediaAssetId);
      seenAssets.add(frame.mediaAssetId);
      appearanceCounts.set(frame.mediaAssetId, (appearanceCounts.get(frame.mediaAssetId) ?? 0) + 1);
      if (frame.role === "hero") {
        heroCounts.set(frame.mediaAssetId, (heroCounts.get(frame.mediaAssetId) ?? 0) + 1);
      }
      frameStyles.add(frame.frameStyle);
      frameShapes.add(frame.frameShape);
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

  const selectedIds = new Set(plan.selectedMasterMedia ?? []);
  const uncovered = [...selectedIds].filter((id) => (heroCounts.get(id) ?? 0) === 0);
  const heroCoveredMediaCount = selectedIds.size - uncovered.length;
  const heroCoverageRatio = selectedIds.size ? heroCoveredMediaCount / selectedIds.size : 0;
  const estimatedCapacity = plan.coverageMetrics?.estimatedHeroCapacity ?? selectedIds.size;
  if (uncovered.length && selectedIds.size <= estimatedCapacity) {
    errors.push({
      code: "incomplete-hero-coverage",
      message: `${uncovered.length} selected memories never become hero frames even though the plan has sufficient hero capacity.`
    });
  } else if (selectedIds.size && heroCoverageRatio < 0.95) {
    errors.push({
      code: "incomplete-hero-coverage",
      message: `Hero coverage ${(heroCoverageRatio * 100).toFixed(1)}% is below the required 95%.`
    });
  }
  const maxHeroAppearancesForSingleAsset = Math.max(0, ...heroCounts.values());
  if (uncovered.length && maxHeroAppearancesForSingleAsset > 1) {
    errors.push({
      code: "hero-domination",
      message: "A memory repeats as hero while other selected memories have no hero coverage."
    });
  }

  const requiredPatterns: Array<{ types: string[]; label: string }> = [
    { types: ["wall-reveal"], label: "an opening wall reveal" },
    { types: ["hero-push-in"], label: "a hero-frame push-in" },
    { types: ["hero-focus-hold"], label: "a hero-frame focus moment" },
    { types: ["snap-zoom-out", "cluster-reveal", "final-wall-reveal"], label: "a pull-back or cluster reveal" },
    { types: ["frame-flip"], label: "a frame/card flip" },
    { types: ["slide-panel", "whip-pan"], label: "a slide or whip-pan" },
    { types: ["multi-frame-pass-by"], label: "a multi-frame pass-by" },
    { types: ["final-wall-reveal"], label: "a final wall reveal" }
  ];
  for (const requirement of requiredPatterns) {
    if (!requirement.types.some((type) => seenMotionTypes.has(type))) {
      errors.push({
        code: "missing-motion-pattern",
        message: `The Wall Frame plan is missing ${requirement.label}.`
      });
    }
  }
  const flattenedBeatCount = plan.wallSections.reduce(
    (sum, section) => sum + (section.motionBeats?.length ?? 0),
    0
  );
  if (plan.motionBeats?.length !== flattenedBeatCount) {
    errors.push({
      code: "invalid-motion-beat",
      message: "The plan-level motion beat index is out of sync with its wall sections."
    });
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
      durationSec,
      heroCoveredMediaCount,
      heroCoverageRatio,
      averageHeroAppearances: selectedIds.size
        ? [...selectedIds].reduce((sum, id) => sum + (heroCounts.get(id) ?? 0), 0) / selectedIds.size
        : 0,
      maxHeroAppearancesForSingleAsset,
      uniqueFrameStylesUsed: frameStyles.size,
      uniqueFrameShapesUsed: frameShapes.size,
      duplicateUsageCount: [...appearanceCounts.values()].reduce(
        (sum, count) => sum + Math.max(0, count - 1),
        0
      )
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
  const motion = getCameraMotionDefinition(plan.settings.cameraMotion);
  let sections = plan.wallSections
    .map((section) => {
      const seenAssets = new Set<string>();
      const heroCount = Math.max(1, section.frames.filter((frame) => frame.role === "hero").length);
      const sectionDurationSec =
        finite(section.durationSec) && section.durationSec > 0.25
          ? clamp(
              section.durationSec,
              motion.minSectionDurationSec,
              Math.max(motion.maxSectionDurationSec * heroCount, 26)
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
        .slice(0, 8)
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
            frameShape: frame.frameShape ?? "landscape-rectangle",
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
            type: section.transitionToNext?.type ?? (index % 2 === 0 ? "frame-flip-y" : "whip-left"),
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
  sections = sections.map((section, index) => {
    const motionBeats = buildSectionMotionBeats({
      sectionId: section.id,
      frames: section.frames,
      durationSec: section.durationSec,
      cameraPath: section.cameraPath,
      transitionToNext: section.transitionToNext,
      sectionIndex: index,
      sectionCount: sections.length,
      settings: plan.settings
    });
    if (JSON.stringify(motionBeats) !== JSON.stringify(section.motionBeats)) {
      repairs.push({
        type: "repair-motion-beats",
        targetId: section.id,
        detail: "Rebuilt the section's cinematic motion-beat sequence."
      });
    }
    return { ...section, motionBeats };
  });
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

  let repairedPlan: WallFrameRenderPlan = {
    ...plan,
    wallSections: sections,
    cameraMoves: sections.map((section) => section.cameraPath),
    motionBeats: sections.flatMap((section) => section.motionBeats),
    soundtrackPlan: {
      ...plan.soundtrackPlan,
      segments: soundtrackSegments
    },
    durationSec,
    fallbackLevel: "repaired",
    validationReport: plan.validationReport
  };
  repairedPlan = { ...repairedPlan, ...refreshCoverage(repairedPlan) };
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
      motionBeats: [],
      transitionToNext:
        index < sourceFrames.length - 1
          ? {
              type: index % 2 === 0 ? "frame-flip-y" : "whip-left",
              durationSec: Math.min(0.55, motion.transitionDurationSec)
            }
          : undefined
    };
  });
  const animatedSections = sections.map((section, index) => ({
    ...section,
    motionBeats: buildSectionMotionBeats({
      sectionId: section.id,
      frames: section.frames,
      durationSec: section.durationSec,
      cameraPath: section.cameraPath,
      transitionToNext: section.transitionToNext,
      sectionIndex: index,
      sectionCount: sections.length,
      settings: plan.settings
    })
  }));
  const durationSec = calculateWallFrameDuration(animatedSections);
  let fallback: WallFrameRenderPlan = {
    ...plan,
    id: `${plan.id}_simple`,
    wallSections: animatedSections,
    cameraMoves: animatedSections.map((section) => section.cameraPath),
    motionBeats: animatedSections.flatMap((section) => section.motionBeats),
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
  fallback = { ...fallback, ...refreshCoverage(fallback) };
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
