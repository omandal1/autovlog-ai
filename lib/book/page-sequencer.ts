import { createId } from "@/lib/ids";
import type {
  BookCoverMetadata,
  BookPage,
  Chapter,
  GenerationSettings,
  ProjectRecord,
  Timeline,
  TimelineClip
} from "@/lib/types";

import { buildPageDecorations } from "@/lib/book/page-decoration-engine";
import { classifyPageVibe } from "@/lib/book/page-vibe-classifier";
import { validateAndRepairPageLayout } from "@/lib/book/layout-validator";
import { resolveBookMaterial } from "@/lib/book/page-material-system";
import { resolveBookTextTreatment } from "@/lib/book/text-treatment-system";
import { buildContentPage, selectPageClipGroup } from "@/lib/book/page-layout-engine";
import { getThemePresetConfig } from "@/lib/themes/theme-registry";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function groupClipsByChapter(timeline: Timeline) {
  const byChapter = new Map<string, TimelineClip[]>();
  for (const clip of timeline.clips) {
    const current = byChapter.get(clip.chapterId) ?? [];
    current.push(clip);
    byChapter.set(clip.chapterId, current);
  }
  return byChapter;
}

function findChapter(project: ProjectRecord, chapterId?: string) {
  return project.chapters.find((chapter) => chapter.id === chapterId);
}

function buildCoverPage(cover: BookCoverMetadata, timeline: Timeline): BookPage {
  const coverClip =
    timeline.clips.find((clip) => clip.storyRole === "opening") ??
    timeline.clips.find((clip) => clip.storyRole === "highlight") ??
    timeline.clips[0];
  const page: BookPage = {
    id: createId("page", 8),
    kind: "cover",
    title: cover.title,
    subtitle: cover.subtitle,
    layoutType: "cover",
    backgroundStyle: cover.coverStyle,
    durationSec: cover.durationSec,
    slots: coverClip
      ? [
          {
            id: createId("slot", 8),
            clipId: coverClip.id,
            assetId: coverClip.assetId,
            chapterId: coverClip.chapterId,
            mediaType: coverClip.mediaType,
            sourcePath: coverClip.sourcePath,
            audioSourcePath: coverClip.audioSourcePath,
            trimStartSec: coverClip.trimStartSec,
            trimDurationSec: Math.min(coverClip.trimDurationSec, cover.durationSec),
            displayDurationSec: cover.durationSec,
            motionEffect: coverClip.motionEffect,
            role: "primary",
            frame: {
              x: 0.39,
              y: 0.52,
              width: 0.22,
              height: 0.2,
              rotationDeg: -0.5
            },
            startSecWithinPage: 0,
            useSourceAudio: false
          }
        ]
      : [],
    chapterBoundary: true,
    audioStrategy: {
      mode: "music-only",
      sourceClipIds: [],
      musicGainDb: -4.5,
      sourceGainDb: 0
    },
    decorations: [],
    material: cover.material,
    textTreatment: cover.textTreatment
  };
  page.decorations = buildPageDecorations({
    page,
    pageIndex: 0,
    theme: getThemePresetConfig(timeline.settings.generation?.themePreset ?? "scrapbook"),
    decorationLevel: timeline.settings.generation?.decorationLevel ?? "balanced"
  });
  return validateAndRepairPageLayout(page).page;
}

function buildChapterDividerPage(
  chapter: Chapter,
  chapterIndex: number,
  totalChapters: number,
  dividerStyle: BookPage["backgroundStyle"],
  generation: GenerationSettings
): BookPage {
  const theme = getThemePresetConfig(generation.themePreset);
  const page: BookPage = {
    id: createId("page", 8),
    kind: "chapter-divider",
    chapterId: chapter.id,
    title: chapter.title,
    subtitle: `Chapter ${chapterIndex + 1} of ${totalChapters}`,
    layoutType: "chapter-divider",
    backgroundStyle: dividerStyle,
    durationSec: chapterIndex === 0 ? 2.5 : 2.8,
    slots: [],
    chapterBoundary: true,
    audioStrategy: {
      mode: "music-only",
      sourceClipIds: [],
      musicGainDb: -5.5,
      sourceGainDb: 0
    },
    decorations: [],
    material: resolveBookMaterial(theme, dividerStyle),
    textTreatment: resolveBookTextTreatment({
      theme,
      titleStyle: generation.titleStyle,
      kind: "chapter-divider",
      accentLabel: `Chapter ${chapterIndex + 1}`
    })
  };
  page.decorations = buildPageDecorations({
    page,
    pageIndex: chapterIndex + 1,
    theme,
    decorationLevel: generation.decorationLevel
  });
  return page;
}

function buildClosingPage(timeline: Timeline, generation: GenerationSettings): BookPage {
  const theme = getThemePresetConfig(timeline.settings.generation?.themePreset ?? "scrapbook");
  const page: BookPage = {
    id: createId("page", 8),
    kind: "outro",
    chapterId: timeline.chapterOrder[timeline.chapterOrder.length - 1],
    title: timeline.kind === "master" ? "The End of the Semester" : "End of Chapter",
    subtitle: timeline.kind === "master" ? "Memories worth keeping" : "A page to revisit later",
    layoutType: "chapter-divider",
    backgroundStyle: theme.pageStyle === "paper-cream" ? "paper-rose" : theme.pageStyle,
    durationSec: timeline.kind === "master" ? 2.7 : 2.2,
    slots: [],
    chapterBoundary: true,
    audioStrategy: {
      mode: "music-only",
      sourceClipIds: [],
      musicGainDb: -5,
      sourceGainDb: 0
    },
    decorations: [],
    material: resolveBookMaterial(
      theme,
      theme.pageStyle === "paper-cream" ? "paper-rose" : theme.pageStyle
    ),
    textTreatment: resolveBookTextTreatment({
      theme,
      titleStyle: generation.titleStyle,
      kind: "outro",
      accentLabel: "Closing Spread"
    })
  };
  page.decorations = buildPageDecorations({
    page,
    pageIndex: timeline.chapterOrder.length + 2,
    theme,
    decorationLevel: generation.decorationLevel
  });
  return page;
}

function rebalancePageDurations(pages: BookPage[], targetDurationSec: number) {
  const transitionCount = Math.max(0, pages.length - 1);
  const targetPageDuration = targetDurationSec + transitionCount * 0.92;
  let currentDuration = pages.reduce((sum, page) => sum + page.durationSec, 0);

  if (currentDuration < targetPageDuration) {
    let delta = targetPageDuration - currentDuration;
    const expandable = pages.filter((page) => page.kind !== "cover");
    while (delta > 0.05 && expandable.length) {
      let progressed = false;
      for (const page of expandable) {
        const maxDuration =
          page.kind === "content"
            ? page.layoutType === "hero"
              ? 10.5
              : 8.8
            : page.kind === "outro"
              ? 3.6
              : 3.2;
        const room = maxDuration - page.durationSec;
        if (room <= 0.01) {
          continue;
        }
        const step = Math.min(room, delta / expandable.length, 0.5);
        page.durationSec = Number((page.durationSec + step).toFixed(3));
        delta -= step;
        progressed = progressed || step > 0.001;
        if (delta <= 0.05) {
          break;
        }
      }
      if (!progressed) {
        break;
      }
      currentDuration = pages.reduce((sum, page) => sum + page.durationSec, 0);
      if (currentDuration >= targetPageDuration - 0.05) {
        break;
      }
    }
  } else if (currentDuration > targetPageDuration) {
    let delta = currentDuration - targetPageDuration;
    const shrinkable = [...pages]
      .reverse()
      .filter((page) => page.kind !== "cover");
    while (delta > 0.05 && shrinkable.length) {
      let progressed = false;
      for (const page of shrinkable) {
        const minDuration =
          page.kind === "content"
            ? page.layoutType === "hero"
              ? 3.6
              : 3.2
            : 1.8;
        const room = page.durationSec - minDuration;
        if (room <= 0.01) {
          continue;
        }
        const step = Math.min(room, delta / shrinkable.length, 0.35);
        page.durationSec = Number((page.durationSec - step).toFixed(3));
        delta -= step;
        progressed = progressed || step > 0.001;
        if (delta <= 0.05) {
          break;
        }
      }
      if (!progressed) {
        break;
      }
      currentDuration = pages.reduce((sum, page) => sum + page.durationSec, 0);
      if (currentDuration <= targetPageDuration + 0.05) {
        break;
      }
    }
  }

  return pages.map((page) => ({
    ...page,
    durationSec: Number(clamp(page.durationSec, 1.8, 10.5).toFixed(3)),
    slots: page.slots.map((slot) => ({
      ...slot,
      displayDurationSec: Number(clamp(page.durationSec, 1.8, 10.5).toFixed(3)),
      trimDurationSec: Number(
        Math.min(slot.trimDurationSec, clamp(page.durationSec, 1.8, 10.5)).toFixed(3)
      )
    }))
  }));
}

export function sequenceTimelineIntoBookPages(options: {
  project: ProjectRecord;
  timeline: Timeline;
  cover: BookCoverMetadata;
}) {
  const theme = getThemePresetConfig(options.timeline.settings.generation?.themePreset ?? "scrapbook");
  const generation = options.timeline.settings.generation!;
  const pages: BookPage[] = [buildCoverPage(options.cover, options.timeline)];
  const assetMap = new Map(options.project.assets.map((asset) => [asset.id, asset]));
  const clipsByChapter = groupClipsByChapter(options.timeline);
  const chapters = options.timeline.chapterOrder
    .map((chapterId) => findChapter(options.project, chapterId))
    .filter((chapter): chapter is Chapter => Boolean(chapter));

  let pageIndex = 0;
  for (const chapter of chapters) {
    const chapterClips = clipsByChapter.get(chapter.id) ?? [];
    if (!chapterClips.length) {
      continue;
    }
    pages.push(
      buildChapterDividerPage(
        chapter,
        chapter.index,
        chapters.length,
        theme.pageStyle,
        generation
      )
    );

    for (let clipIndex = 0; clipIndex < chapterClips.length; ) {
      const pageClips = selectPageClipGroup(chapterClips, clipIndex, pageIndex, generation);
      if (!pageClips.length) {
        break;
      }

      pages.push(
        buildContentPage({
          pageIndex,
          title:
            pageIndex === 0 && options.timeline.kind === "master"
              ? options.cover.title
              : chapter.title,
          subtitle:
            pageClips.length > 1
              ? `${theme.label} spread`
              : pageClips[0]?.storyRole === "highlight"
                ? "Highlighted memory"
                : undefined,
          chapterId: chapter.id,
          clips: pageClips,
          assets: pageClips
            .map((clip) => assetMap.get(clip.assetId))
            .filter((asset): asset is ProjectRecord["assets"][number] => Boolean(asset)),
          backgroundStyle:
            theme.pageStyle === "paper-cream" && pageIndex % 4 === 2
              ? "paper-rose"
              : theme.pageStyle,
          theme,
          generation,
          vibe: classifyPageVibe({
            project: options.project,
            clips: pageClips
          })
        })
      );

      clipIndex += pageClips.length;
      pageIndex += 1;
    }
  }

  if (!pages.some((page) => page.kind === "content") && options.timeline.clips.length) {
    for (let clipIndex = 0; clipIndex < options.timeline.clips.length; ) {
      const pageClips = selectPageClipGroup(options.timeline.clips, clipIndex, pageIndex, generation);
      if (!pageClips.length) {
        break;
      }
      pages.push(
        buildContentPage({
          pageIndex,
          title: options.timeline.title,
          subtitle: "Diary fallback page",
          chapterId: pageClips[0]!.chapterId,
          clips: pageClips,
          assets: pageClips
            .map((clip) => assetMap.get(clip.assetId))
            .filter((asset): asset is ProjectRecord["assets"][number] => Boolean(asset)),
          backgroundStyle: theme.pageStyle,
          theme,
          generation,
          vibe: classifyPageVibe({
            project: options.project,
            clips: pageClips
          })
        })
      );
      clipIndex += pageClips.length;
      pageIndex += 1;
    }
  }

  pages.push(buildClosingPage(options.timeline, generation));
  return rebalancePageDurations(pages, options.timeline.targetDurationSec);
}
