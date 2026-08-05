import { createId } from "@/lib/ids";
import { validateAndRepairPageLayout } from "@/lib/book/layout-validator";
import { buildPageDecorations } from "@/lib/book/page-decoration-engine";
import { generateDiaryPageText } from "@/lib/book/diary-text-generator";
import { resolveBookMaterial } from "@/lib/book/page-material-system";
import { resolveBookTextTreatment } from "@/lib/book/text-treatment-system";
import type {
  BookBackgroundStyle,
  BookPage,
  BookPageSlotFrame,
  BookPageLayoutType,
  GenerationSettings,
  MediaAsset,
  PageVibeClassification,
  ThemePresetConfig,
  TimelineClip
} from "@/lib/types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function notebookFrame(frame: BookPageSlotFrame): BookPageSlotFrame {
  const margin = 0.125;
  const top = 0.17;
  const bottom = 0.785;
  const maxRight = 0.875;
  const width = Number(clamp(frame.width, 0.16, Math.min(0.54, maxRight - margin)).toFixed(4));
  const height = Number(clamp(frame.height, 0.15, Math.min(0.52, bottom - top)).toFixed(4));
  const x = Number(clamp(frame.x, margin, maxRight - width).toFixed(4));
  const y = Number(clamp(frame.y, top, bottom - height).toFixed(4));
  const rotationDeg = Number(clamp(frame.rotationDeg ?? 0, -0.8, 0.8).toFixed(3));
  return {
    x,
    y,
    width,
    height,
    rotationDeg
  };
}

function resolveImageLingerSec(clip: TimelineClip) {
  if (clip.mediaType !== "image") {
    return clip.displayDurationSec;
  }

  const roleBoost =
    clip.storyRole === "opening" || clip.storyRole === "closing"
      ? 1
      : clip.storyRole === "highlight"
        ? 0.65
        : 0.35;
  return clamp(clip.displayDurationSec + roleBoost, 3.8, 7.4);
}

function resolvePageDuration(
  layoutType: BookPageLayoutType,
  clips: TimelineClip[],
  generation: GenerationSettings
) {
  const base = Math.max(...clips.map((clip) => resolveImageLingerSec(clip)));
  const pacingBias =
    generation.pacing === "fast" ? -0.45 : generation.pacing === "slow-sentimental" ? 0.72 : 0;
  const storyBias =
    generation.storyStyle === "cinematic"
      ? 0.26
      : generation.storyStyle === "authentic"
        ? -0.08
        : generation.storyStyle === "emotional"
          ? 0.38
          : generation.storyStyle === "energetic"
            ? -0.14
            : 0;
  switch (layoutType) {
    case "chapter-divider":
      return 2.7;
    case "quote-page":
      return clamp(base + 1 + storyBias, 4.8, 8.2);
    case "yearbook-spread":
      return clamp(base + 0.65 + pacingBias * 0.75, 4.6, 8.1);
    case "concert-board":
      return clamp(base + 0.35 + storyBias * 0.35, 4, 7.5);
    case "three-up":
      return clamp(base + 0.7 + pacingBias, 4.4, 7.8);
    case "side-by-side":
      return clamp(base + 0.45 + pacingBias * 0.8, 4, 7.6);
    case "video-memory-board":
      return clamp(base + 0.2 + storyBias * 0.7, 4.2, 8.8);
    case "hero":
    default:
      return clamp(base + (clips[0]?.mediaType === "image" ? 0.5 : 0.15) + storyBias + pacingBias, 3.8, 9.8);
  }
}

function heroFrames() {
  return [
    notebookFrame({
      x: 0.16,
      y: 0.22,
      width: 0.48,
      height: 0.48,
      rotationDeg: -0.5
    })
  ];
}

function sideBySideFrames(pageIndex: number) {
  const tilt = pageIndex % 2 === 0 ? 1.4 : -1.2;
  return [
    notebookFrame({
      x: 0.13,
      y: 0.24,
      width: 0.31,
      height: 0.42,
      rotationDeg: tilt * 0.45
    }),
    notebookFrame({
      x: 0.56,
      y: 0.25,
      width: 0.25,
      height: 0.33,
      rotationDeg: -tilt * 0.35
    })
  ];
}

function threeUpFrames(pageIndex: number) {
  const leftTilt = pageIndex % 2 === 0 ? -1.5 : 1.5;
  return [
    notebookFrame({
      x: 0.1,
      y: 0.23,
      width: 0.26,
      height: 0.28,
      rotationDeg: leftTilt * 0.38
    }),
    notebookFrame({
      x: 0.38,
      y: 0.21,
      width: 0.27,
      height: 0.34,
      rotationDeg: -0.4
    }),
    notebookFrame({
      x: 0.67,
      y: 0.31,
      width: 0.17,
      height: 0.24,
      rotationDeg: 0.6
    })
  ];
}

function videoMemoryBoardFrames(pageIndex: number) {
  const tilt = pageIndex % 2 === 0 ? -0.8 : 0.8;
  return [
    notebookFrame({
      x: 0.13,
      y: 0.24,
      width: 0.38,
      height: 0.42,
      rotationDeg: tilt * 0.45
    }),
    notebookFrame({
      x: 0.62,
      y: 0.22,
      width: 0.18,
      height: 0.24,
      rotationDeg: 0.7
    }),
    notebookFrame({
      x: 0.63,
      y: 0.51,
      width: 0.21,
      height: 0.25,
      rotationDeg: -0.6
    })
  ];
}

function yearbookSpreadFrames(pageIndex: number) {
  const tilt = pageIndex % 2 === 0 ? -1.2 : 1.2;
  return [
    notebookFrame({
      x: 0.13,
      y: 0.23,
      width: 0.28,
      height: 0.39,
      rotationDeg: tilt * 0.4
    }),
    notebookFrame({
      x: 0.42,
      y: 0.25,
      width: 0.2,
      height: 0.26,
      rotationDeg: -0.4
    }),
    notebookFrame({
      x: 0.63,
      y: 0.49,
      width: 0.2,
      height: 0.25,
      rotationDeg: 0.55
    })
  ];
}

function concertBoardFrames(pageIndex: number) {
  const swing = pageIndex % 2 === 0 ? 1.8 : -1.8;
  return [
    notebookFrame({
      x: 0.13,
      y: 0.22,
      width: 0.42,
      height: 0.43,
      rotationDeg: swing * 0.36
    }),
    notebookFrame({
      x: 0.62,
      y: 0.22,
      width: 0.16,
      height: 0.22,
      rotationDeg: 0.65
    }),
    notebookFrame({
      x: 0.6,
      y: 0.51,
      width: 0.22,
      height: 0.18,
      rotationDeg: -0.55
    })
  ];
}

function quotePageFrames() {
  return [
    notebookFrame({
      x: 0.16,
      y: 0.24,
      width: 0.58,
      height: 0.46,
      rotationDeg: -0.45
    })
  ];
}

function chooseLayoutType(clips: TimelineClip[], vibe?: PageVibeClassification, generation?: GenerationSettings) {
  if (vibe?.primary === "concert" || vibe?.primary === "nightlife") {
    return clips.length > 1 ? "concert-board" : "hero";
  }
  if ((vibe?.primary === "friends" || vibe?.primary === "campus" || vibe?.primary === "study") && clips.length >= 2) {
    return "yearbook-spread";
  }
  if ((vibe?.primary === "dialogue" || generation?.subjectEmphasis === "dialogue-moments") && clips.length === 1) {
    return "quote-page";
  }
  if (clips[0]?.mediaType === "video") {
    return clips.length > 1 ? "video-memory-board" : "hero";
  }
  if (clips.length >= 3) {
    return "three-up";
  }
  if (clips.length === 2) {
    return "side-by-side";
  }
  return "hero";
}

function framesForLayout(layoutType: BookPageLayoutType, pageIndex: number) {
  switch (layoutType) {
    case "yearbook-spread":
      return yearbookSpreadFrames(pageIndex);
    case "concert-board":
      return concertBoardFrames(pageIndex);
    case "quote-page":
      return quotePageFrames();
    case "side-by-side":
      return sideBySideFrames(pageIndex);
    case "three-up":
      return threeUpFrames(pageIndex);
    case "video-memory-board":
      return videoMemoryBoardFrames(pageIndex);
    default:
      return heroFrames();
  }
}

export function buildContentPage(options: {
  pageIndex: number;
  title: string;
  subtitle?: string;
  chapterId: string;
  clips: TimelineClip[];
  assets?: MediaAsset[];
  backgroundStyle?: BookBackgroundStyle;
  theme: ThemePresetConfig;
  generation: GenerationSettings;
  vibe: PageVibeClassification;
}) {
  const layoutType =
    options.generation.themePreset === "cinematic-journal" && options.clips[0]?.mediaType === "video"
      ? "hero"
      : options.generation.themePreset === "yearbook" && options.clips.length >= 2
        ? options.clips.length >= 3
          ? "yearbook-spread"
          : "side-by-side"
        : chooseLayoutType(options.clips, options.vibe, options.generation);
  const frames = framesForLayout(layoutType, options.pageIndex);
  const durationSec = resolvePageDuration(layoutType, options.clips, options.generation);
  const primaryClipId = options.clips.find((clip) => clip.mediaType === "video")?.id ?? options.clips[0]?.id;
  const material = resolveBookMaterial(
    options.theme,
    options.backgroundStyle ??
      (options.theme.pageStyle === "paper-cream" && options.pageIndex % 4 === 2
        ? "paper-rose"
        : options.theme.pageStyle)
  );
  const textTreatment = resolveBookTextTreatment({
    theme: options.theme,
    titleStyle: options.generation.titleStyle,
    kind: "content"
  });

  const page: BookPage = {
    id: createId("page", 8),
    kind: "content",
    chapterId: options.chapterId,
    title: options.title,
    subtitle: options.subtitle,
    layoutType,
    backgroundStyle:
      options.backgroundStyle ??
      (options.theme.pageStyle === "paper-cream" && options.pageIndex % 4 === 2
        ? "paper-rose"
        : options.theme.pageStyle),
    durationSec,
    chapterBoundary: false,
    slots: options.clips.map((clip, index) => ({
      id: createId("slot", 8),
      clipId: clip.id,
      assetId: clip.assetId,
      chapterId: clip.chapterId,
      mediaType: clip.mediaType,
      sourcePath: clip.sourcePath,
      audioSourcePath: clip.audioSourcePath,
      trimStartSec: clip.trimStartSec,
      trimDurationSec: Math.min(clip.trimDurationSec, durationSec),
      displayDurationSec: durationSec,
      motionEffect: clip.motionEffect,
      role: clip.id === primaryClipId ? "primary" : "support",
      frame: frames[index] ?? frames[frames.length - 1] ?? heroFrames()[0]!,
      startSecWithinPage: 0,
      useSourceAudio:
        clip.id === primaryClipId &&
        clip.mediaType === "video" &&
        Boolean(clip.sourceAudio?.hasAudio)
    })),
    audioStrategy: {
      mode: options.clips.some((clip) => clip.mediaType === "video" && clip.sourceAudio?.hasAudio)
        ? "mixed"
        : "music-only",
      sourceClipIds: primaryClipId ? [primaryClipId] : [],
      musicGainDb: options.clips.some((clip) => clip.mediaType === "video") ? -9.5 : -6.5,
      sourceGainDb: 0
    },
    decorations: [],
    material,
    textTreatment,
    diaryText: generateDiaryPageText({
      clips: options.clips,
      assets: options.assets,
      chapterTitle: options.title,
      vibe: options.vibe,
      pageIndex: options.pageIndex
    }),
    vibe: options.vibe,
    designDensity:
      options.generation.decorationLevel === "rich"
        ? "filled"
        : options.clips.length >= 3
          ? "balanced"
          : "airy"
  };

  page.decorations = buildPageDecorations({
    page,
    pageIndex: options.pageIndex,
    theme: options.theme,
    decorationLevel: options.generation.decorationLevel
  });

  return validateAndRepairPageLayout(page).page;
}

export function selectPageClipGroup(
  clips: TimelineClip[],
  startIndex: number,
  pageIndex: number,
  generation?: GenerationSettings
) {
  const current = clips[startIndex];
  const next = clips[startIndex + 1];
  const third = clips[startIndex + 2];
  if (!current) {
    return [];
  }

  if (current.mediaType === "video") {
    const supports = [next, third].filter(
      (clip): clip is TimelineClip => Boolean(clip && clip.mediaType === "image")
    );
    return (generation?.themePreset === "scrapbook" ||
      generation?.themePreset === "photo-album" ||
      generation?.decorationLevel === "rich" ||
      pageIndex % 2 === 0) &&
      supports.length > 0
      ? [current, ...supports.slice(0, 2)]
      : [current];
  }

  if (current.mediaType === "image" && next?.mediaType === "image" && third?.mediaType === "image") {
    return generation?.themePreset === "scrapbook" ||
      generation?.themePreset === "yearbook" ||
      generation?.decorationLevel === "rich" ||
      pageIndex % 3 === 2
      ? [current, next, third]
      : [current, next];
  }

  if (current.mediaType === "image" && next?.mediaType === "image") {
    return [current, next];
  }

  return [current];
}
