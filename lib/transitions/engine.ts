import { createId } from "@/lib/ids";
import type {
  MotionEffect,
  ProjectRecord,
  Timeline,
  TimelineClip,
  TimelineTransition,
  TransitionType,
  VlogVibe
} from "@/lib/types";

import { detectTimelineVibe } from "@/lib/audio/vibe-detector";
import { calculateBookClipTimings } from "@/lib/transitions/page-turn-engine";

interface TransitionProfile {
  transitionPool: TransitionType[];
  highlightPool: TransitionType[];
  chapterPool: TransitionType[];
  imageMotionPool: MotionEffect[];
  durationRange: [number, number];
  chapterDurationRange: [number, number];
  highlightDurationRange: [number, number];
}

const PROFILES: Record<VlogVibe, TransitionProfile> = {
  energetic: {
    transitionPool: ["crossfade", "slide-left", "slide-right", "soft-wipe-left", "blur-fade"],
    highlightPool: ["slide-left", "slide-right", "crossfade", "zoom-blend"],
    chapterPool: ["slide-left", "blur-fade", "slide-right", "soft-wipe-right"],
    imageMotionPool: ["zoom-in", "pan-left", "zoom-out", "pan-right"],
    durationRange: [0.5, 0.72],
    chapterDurationRange: [0.72, 0.95],
    highlightDurationRange: [0.5, 0.65]
  },
  emotional: {
    transitionPool: ["fade", "crossfade", "blur-fade", "zoom-blend"],
    highlightPool: ["blur-fade", "crossfade", "zoom-blend", "fade"],
    chapterPool: ["page-flip", "fade", "blur-fade", "crossfade"],
    imageMotionPool: ["zoom-in", "pan-right", "zoom-out", "pan-left"],
    durationRange: [0.78, 1.12],
    chapterDurationRange: [1.08, 1.42],
    highlightDurationRange: [0.86, 1.18]
  },
  chill: {
    transitionPool: ["crossfade", "blur-fade", "fade", "soft-wipe-left", "zoom-blend"],
    highlightPool: ["crossfade", "blur-fade", "zoom-blend", "soft-wipe-left"],
    chapterPool: ["page-flip", "blur-fade", "crossfade", "fade"],
    imageMotionPool: ["pan-left", "zoom-in", "pan-right", "zoom-out"],
    durationRange: [0.68, 0.96],
    chapterDurationRange: [1.02, 1.28],
    highlightDurationRange: [0.7, 1]
  },
  cinematic: {
    transitionPool: [
      "crossfade",
      "blur-fade",
      "zoom-blend",
      "soft-wipe-left",
      "soft-wipe-right",
      "fade"
    ],
    highlightPool: ["blur-fade", "crossfade", "zoom-blend", "slide-left"],
    chapterPool: ["page-flip", "crossfade", "blur-fade", "zoom-blend"],
    imageMotionPool: ["zoom-out", "pan-left", "zoom-in", "pan-right"],
    durationRange: [0.62, 0.92],
    chapterDurationRange: [0.96, 1.26],
    highlightDurationRange: [0.68, 0.9]
  }
};

function hashSeed(value: string) {
  return value.split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

function cloneTimeline(timeline: Timeline): Timeline {
  return {
    ...timeline,
    clips: timeline.clips.map((clip) => ({ ...clip })),
    transitions: timeline.transitions?.map((transition) => ({ ...transition })),
    audioTracks: timeline.audioTracks?.map((track) => ({ ...track })),
    book: timeline.book
      ? {
          ...timeline.book,
          pages: timeline.book.pages.map((page) => ({
            ...page,
            slots: page.slots.map((slot) => ({ ...slot })),
            audioStrategy: { ...page.audioStrategy }
          })),
          transitions: timeline.book.transitions.map((transition) => ({ ...transition })),
          cover: { ...timeline.book.cover },
          uniqueAssetIds: [...timeline.book.uniqueAssetIds],
          validationNotes: timeline.book.validationNotes
            ? [...timeline.book.validationNotes]
            : undefined
        }
      : undefined
  };
}

function mapTransitionFilter(type: TransitionType) {
  switch (type) {
    case "soft-wipe-left":
      return "smoothleft";
    case "soft-wipe-right":
      return "smoothright";
    case "slide-left":
      return "slideleft";
    case "slide-right":
      return "slideright";
    case "blur-fade":
      return "hblur";
    case "zoom-blend":
      return "zoomin";
    case "page-flip":
      return "pageflip-approx";
    case "crossfade":
      return "fade";
    default:
      return "fade";
  }
}

function chooseFromPool<T>(pool: readonly T[], seed: number, previous?: T) {
  if (!pool.length) {
    throw new Error("Transition pool is empty.");
  }

  let choice = pool[seed % pool.length]!;
  if (pool.length > 1 && choice === previous) {
    choice = pool[(seed + 1) % pool.length]!;
  }
  return choice;
}

function chooseDuration(
  range: [number, number],
  seed: number,
  previousClip: TimelineClip,
  nextClip: TimelineClip
) {
  const span = range[1] - range[0];
  const base = range[0] + ((seed % 100) / 100) * span;
  const floor = range[0];
  const maxAllowed = Math.min(
    1.5,
    Math.max(floor, previousClip.displayDurationSec / 2.8),
    Math.max(floor, nextClip.displayDurationSec / 2.8)
  );
  return Number(clamp(base, floor, maxAllowed).toFixed(3));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function maxClipDuration(clip: TimelineClip) {
  if (clip.mediaType === "image") {
    return clip.storyRole === "opening" || clip.storyRole === "closing" ? 12 : 8.8;
  }
  return Math.max(clip.trimDurationSec, Math.min(10, clip.trimDurationSec + 1.8));
}

function minClipDuration(clip: TimelineClip) {
  return clip.mediaType === "image" ? 2 : 1.8;
}

export function calculateTimelineDuration(timeline: Timeline) {
  const overlap = averageTransitionDuration(timeline);
  return Number(
    Math.max(
      0,
      timeline.clips.reduce((sum, clip) => sum + clip.displayDurationSec, 0) - overlap
    ).toFixed(2)
  );
}

function averageTransitionDuration(timeline: Timeline) {
  const transitions = timeline.transitions ?? [];
  return transitions.reduce((sum, transition) => sum + transition.durationSec, 0);
}

export function calculateClipTimings(timeline: Timeline) {
  if (timeline.book?.pages?.length) {
    return calculateBookClipTimings(timeline.book);
  }

  const startTimes = new Map<string, number>();
  let cursor = 0;
  for (let index = 0; index < timeline.clips.length; index += 1) {
    const clip = timeline.clips[index]!;
    startTimes.set(clip.id, Number(cursor.toFixed(3)));
    const transition = timeline.transitions?.[index];
    cursor += clip.displayDurationSec - (transition?.durationSec ?? 0);
  }
  return startTimes;
}

function reconcileTimelineDuration(timeline: Timeline) {
  const target = timeline.actualDurationSec;
  let actual = calculateTimelineDuration(timeline);
  let delta = Number((target - actual).toFixed(3));

  if (Math.abs(delta) < 0.02) {
    return timeline;
  }

  if (delta > 0) {
    let iterations = 0;
    while (delta > 0.02) {
      iterations += 1;
      if (iterations > 500) {
        break;
      }
      const beforeDelta = delta;
      const expandable = timeline.clips.filter(
        (clip) => clip.displayDurationSec < maxClipDuration(clip) - 0.02
      );
      if (!expandable.length) {
        break;
      }
      const step = Math.min(0.35, delta / expandable.length);
      for (const clip of expandable) {
        const nextDuration = Math.min(maxClipDuration(clip), clip.displayDurationSec + step);
        clip.displayDurationSec = Number(nextDuration.toFixed(3));
        if (clip.mediaType === "image") {
          clip.trimDurationSec = clip.displayDurationSec;
        }
      }
      actual = calculateTimelineDuration(timeline);
      delta = Number((target - actual).toFixed(3));
      if (Math.abs(beforeDelta - delta) < 0.001) {
        break;
      }
    }
  } else {
    let iterations = 0;
    while (delta < -0.02) {
      iterations += 1;
      if (iterations > 500) {
        break;
      }
      const beforeDelta = delta;
      const shrinkable = [...timeline.clips]
        .reverse()
        .filter((clip) => clip.displayDurationSec > minClipDuration(clip) + 0.02);
      if (!shrinkable.length) {
        break;
      }
      const step = Math.min(0.28, Math.abs(delta) / shrinkable.length);
      for (const clip of shrinkable) {
        const nextDuration = Math.max(minClipDuration(clip), clip.displayDurationSec - step);
        clip.displayDurationSec = Number(nextDuration.toFixed(3));
        clip.trimDurationSec = Math.min(clip.trimDurationSec, clip.displayDurationSec);
      }
      actual = calculateTimelineDuration(timeline);
      delta = Number((target - actual).toFixed(3));
      if (Math.abs(beforeDelta - delta) < 0.001) {
        break;
      }
    }
  }

  timeline.actualDurationSec = Number(calculateTimelineDuration(timeline).toFixed(2));
  return timeline;
}

export function buildFallbackTransitions(timeline: Timeline) {
  const prepared = cloneTimeline(timeline);
  prepared.transitions = prepared.clips.slice(1).map((clip, index) => ({
    id: createId("transition", 8),
    fromClipId: prepared.clips[index]!.id,
    toClipId: clip.id,
    type: "crossfade" satisfies TransitionType,
    durationSec: 0.65,
    filterName: "fade",
    isChapterBoundary: prepared.clips[index]!.chapterId !== clip.chapterId
  }));
  prepared.detectedVibe = prepared.detectedVibe ?? "cinematic";
  return reconcileTimelineDuration(prepared);
}

export function assignTimelineTransitions(project: ProjectRecord, timeline: Timeline) {
  const prepared = cloneTimeline(timeline);
  const detected = prepared.detectedVibe ?? detectTimelineVibe(project, prepared).vibe;
  const profile = PROFILES[detected] ?? PROFILES.cinematic;

  let previousTransition: TransitionType | undefined;
  const transitionedClips: TimelineClip[] = [];
  prepared.clips.forEach((clip, index) => {
    transitionedClips.push({
      ...clip,
      motionEffect:
        clip.mediaType === "image"
          ? chooseFromPool(
              profile.imageMotionPool,
              hashSeed(`${clip.id}:${detected}:${index}`),
              transitionedClips[index - 1]?.motionEffect
            )
          : undefined
    });
  });
  prepared.clips = transitionedClips;

  prepared.transitions = prepared.clips.slice(1).map((clip, index) => {
    const previousClip = prepared.clips[index]!;
    const boundary = previousClip.chapterId !== clip.chapterId || clip.storyRole === "chapter-intro";
    const highlight = clip.storyRole === "highlight";
    const bothImages =
      previousClip.mediaType === "image" && clip.mediaType === "image";
    const imageDominant = previousClip.mediaType === "image" || clip.mediaType === "image";
    let pool = boundary
      ? profile.chapterPool
      : highlight
        ? profile.highlightPool
        : profile.transitionPool;
    const storybookMoment =
      detected !== "energetic" &&
      imageDominant &&
      (boundary ||
        bothImages ||
        highlight ||
        previousClip.storyRole === "opening" ||
        clip.storyRole === "closing");
    const preferPageFlip =
      storybookMoment &&
      hashSeed(`${prepared.id}:${previousClip.id}:${clip.id}:page-flip`) %
        (boundary ? 1 : bothImages ? 2 : 3) ===
        0;
    if (storybookMoment) {
      pool = ["page-flip", ...pool.filter((type) => type !== "page-flip")];
    }
    const range = boundary
      ? profile.chapterDurationRange
      : highlight
        ? profile.highlightDurationRange
        : profile.durationRange;
    const type = preferPageFlip
      ? ("page-flip" satisfies TransitionType)
      : chooseFromPool(
          pool,
          hashSeed(`${prepared.id}:${previousClip.id}:${clip.id}:${detected}:${index}`),
          previousTransition
        );
    previousTransition = type;

    return {
      id: createId("transition", 8),
      fromClipId: previousClip.id,
      toClipId: clip.id,
      type,
      durationSec: chooseDuration(
        type === "page-flip" ? [Math.max(1.02, range[0]), Math.max(1.22, range[1])] : range,
        hashSeed(`${type}:${clip.id}:${previousClip.id}`),
        previousClip,
        clip
      ),
      filterName: mapTransitionFilter(type),
      isChapterBoundary: boundary
    } satisfies TimelineTransition;
  });

  if (
    detected !== "energetic" &&
    prepared.transitions.length > 0 &&
    !prepared.transitions.some((transition) => transition.type === "page-flip")
  ) {
    const fallbackIndex = prepared.transitions.findIndex((transition, index) => {
      const previousClip = prepared.clips[index]!;
      const nextClip = prepared.clips[index + 1]!;
      const imageDominant =
        previousClip.mediaType === "image" || nextClip.mediaType === "image";
      const bothImages =
        previousClip.mediaType === "image" && nextClip.mediaType === "image";

      return (
        imageDominant &&
        (transition.isChapterBoundary ||
          bothImages ||
          previousClip.storyRole === "opening" ||
          nextClip.storyRole === "highlight" ||
          nextClip.storyRole === "closing")
      );
    });

    if (fallbackIndex >= 0) {
      const previousClip = prepared.clips[fallbackIndex]!;
      const nextClip = prepared.clips[fallbackIndex + 1]!;
      const existing = prepared.transitions[fallbackIndex]!;
      const range = existing.isChapterBoundary
        ? profile.chapterDurationRange
        : profile.highlightDurationRange;

      prepared.transitions[fallbackIndex] = {
        ...existing,
        type: "page-flip",
        filterName: mapTransitionFilter("page-flip"),
        durationSec: chooseDuration(
          [Math.max(1.02, range[0]), Math.max(1.22, range[1])],
          hashSeed(`fallback-page-flip:${prepared.id}:${previousClip.id}:${nextClip.id}`),
          previousClip,
          nextClip
        )
      };
    }
  }

  prepared.detectedVibe = detected;
  return reconcileTimelineDuration(prepared);
}
