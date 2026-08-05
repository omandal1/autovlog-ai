import type { ProjectRecord, Timeline } from "@/lib/types";

import { buildBookCover } from "@/lib/book/book-cover-generator";
import { validateAndRepairPageLayout } from "@/lib/book/layout-validator";
import { buildOpeningAnimationConfig } from "@/lib/book/opening-animation-engine";
import { resolveBookMaterial } from "@/lib/book/page-material-system";
import { resolveBookTextTreatment } from "@/lib/book/text-treatment-system";
import { sequenceTimelineIntoBookPages } from "@/lib/book/page-sequencer";
import {
  collectBookPageAssetIds,
  dedupeBookPages,
  dedupeTimelineClips
} from "@/lib/timeline/unique-media-allocation";
import {
  buildPageTurnTransitions,
  calculateBookDuration
} from "@/lib/transitions/page-turn-engine";
import { getThemePresetConfig } from "@/lib/themes/theme-registry";

export function validateAndRepairRenderPlan(project: ProjectRecord, timeline: Timeline) {
  const repairedTimeline = {
    ...timeline,
    clips: timeline.clips.map((clip) => ({ ...clip }))
  };
  const dedupedClips = dedupeTimelineClips(repairedTimeline.clips);
  repairedTimeline.clips = dedupedClips.clips;

  const validationNotes = [
    ...(timeline.book?.validationNotes ?? [])
  ];
  if (dedupedClips.removedAssetIds.length > 0) {
    validationNotes.push(
      `Deduplicated repeated clips: ${dedupedClips.removedAssetIds.join(", ")}`
    );
  }

  const cover = repairedTimeline.book?.cover ?? buildBookCover(project, repairedTimeline);
  const existingPages =
    repairedTimeline.book?.pages?.length
      ? repairedTimeline.book.pages.map((page) => ({
          ...page,
          slots: page.slots.map((slot) => ({ ...slot }))
        }))
      : sequenceTimelineIntoBookPages({
          project,
          timeline: repairedTimeline,
          cover
        });

  const dedupedPages = dedupeBookPages(existingPages);
  if (dedupedPages.removedAssetIds.length > 0) {
    validationNotes.push(
      `Removed repeated page media: ${dedupedPages.removedAssetIds.join(", ")}`
    );
  }

  let pages = dedupedPages.pages.filter(
    (page) =>
      page.kind === "cover" ||
      page.kind === "chapter-divider" ||
      page.kind === "outro" ||
      page.slots.length > 0
  );

  if (!pages.length || pages[0]?.kind !== "cover") {
    const rebuiltPages = sequenceTimelineIntoBookPages({
      project,
      timeline: repairedTimeline,
      cover
    });
    pages = rebuiltPages;
    validationNotes.push("Rebuilt book pages to restore the cover sequence.");
  }

  pages = pages.map((page) =>
    page.kind === "content" || (page.kind === "cover" && page.slots.length)
      ? validateAndRepairPageLayout(page).page
      : page
  );

  const generation = repairedTimeline.settings.generation!;
  const theme = getThemePresetConfig(generation.themePreset);
  const transitions = buildPageTurnTransitions(pages, repairedTimeline.detectedVibe, {
    generation,
    theme
  });
  const uniqueAssetIds = collectBookPageAssetIds(pages);
  const material = resolveBookMaterial(theme, theme.pageStyle);
  const textTreatment = resolveBookTextTreatment({
    theme,
    titleStyle: generation.titleStyle,
    kind: "cover",
    accentLabel: cover.accentLabel
  });
  const openingAnimation = buildOpeningAnimationConfig({
    theme,
    generation
  });

  repairedTimeline.book = {
    style: "memory-book" as const,
    generatedTitle: cover.title,
    cover,
    pages,
    transitions,
    openingAnimation,
    material,
    textTreatment,
    reusePolicy: "unique-only" as const,
    uniqueAssetIds,
    validationNotes
  };
  repairedTimeline.actualDurationSec = calculateBookDuration(repairedTimeline.book);

  return repairedTimeline;
}
