import { getCameraMotionDefinition } from "@/lib/wall-frame/style-registry";
import type {
  WallFrameCameraMotion,
  WallFrameSectionTiming,
  WallSection
} from "@/lib/wall-frame/types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundTime(value: number) {
  return Number(value.toFixed(3));
}

export function allocateWallSectionDurations(options: {
  frameCounts: number[];
  heroCounts?: number[];
  videoCounts?: number[];
  cameraMotion: WallFrameCameraMotion;
  durationTargetSec?: number;
}) {
  if (!options.frameCounts.length) {
    return [];
  }

  const motion = getCameraMotionDefinition(options.cameraMotion);
  const rawWeights = options.frameCounts.map((count, index) => {
    const videoCount = options.videoCounts?.[index] ?? 0;
    return 0.84 + Math.min(Math.max(count, 1), 5) * 0.09 + Math.min(videoCount, 2) * 0.07;
  });
  const defaultDurations = rawWeights.map((weight, index) => {
    const heroCount = Math.max(1, options.heroCounts?.[index] ?? 1);
    return clamp(
      motion.sectionDurationSec * weight * (1 + (heroCount - 1) * 0.7),
      motion.minSectionDurationSec,
      Math.max(motion.maxSectionDurationSec * heroCount, 26)
    );
  });

  if (!options.durationTargetSec || options.durationTargetSec <= 0) {
    return defaultDurations.map(roundTime);
  }

  const transitionTotal =
    Math.max(0, options.frameCounts.length - 1) * motion.transitionDurationSec;
  const minimumSectionTime = options.frameCounts.reduce(
    (sum, _count, index) =>
      sum + motion.minSectionDurationSec * (1 + Math.max(0, (options.heroCounts?.[index] ?? 1) - 1) * 0.55),
    0
  );
  const availableSectionTime = Math.max(
    minimumSectionTime,
    options.durationTargetSec + transitionTotal
  );
  const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0);
  const scaled = rawWeights.map((weight, index) => {
    const heroCount = Math.max(1, options.heroCounts?.[index] ?? 1);
    return clamp(
      (availableSectionTime * weight) / weightTotal,
      motion.minSectionDurationSec,
      Math.max(motion.maxSectionDurationSec * heroCount, 26)
    );
  });
  return scaled.map(roundTime);
}

export function calculateWallSectionTimings(
  sections: readonly WallSection[]
): WallFrameSectionTiming[] {
  let cursor = 0;
  return sections.map((section, index) => {
    const transitionOverlapSec =
      index < sections.length - 1
        ? clamp(section.transitionToNext?.durationSec ?? 0, 0, section.durationSec / 2)
        : 0;
    const startSec = cursor;
    const endSec = startSec + section.durationSec;
    cursor = endSec - transitionOverlapSec;
    return {
      sectionId: section.id,
      startSec: roundTime(startSec),
      endSec: roundTime(endSec),
      durationSec: roundTime(section.durationSec),
      transitionOverlapSec: roundTime(transitionOverlapSec)
    };
  });
}

export function calculateWallFrameDuration(sections: readonly WallSection[]) {
  const timings = calculateWallSectionTimings(sections);
  return roundTime(timings.at(-1)?.endSec ?? 0);
}

export function clampTransitionDuration(options: {
  requestedSec: number;
  fromDurationSec: number;
  toDurationSec: number;
  fps: number;
}) {
  const frameGuard = Math.max(2 / Math.max(1, options.fps), 0.08);
  const maximum = Math.max(
    0,
    Math.min(options.fromDurationSec, options.toDurationSec) - frameGuard
  );
  return roundTime(clamp(options.requestedSec, 0, Math.min(maximum, 1.25)));
}
