import type { ProjectRecord, Timeline } from "@/lib/types";

import { buildBookCover } from "@/lib/book/book-cover-generator";
import { buildOpeningAnimationConfig } from "@/lib/book/opening-animation-engine";
import { resolveBookMaterial } from "@/lib/book/page-material-system";
import { resolveBookTextTreatment } from "@/lib/book/text-treatment-system";
import { sequenceTimelineIntoBookPages } from "@/lib/book/page-sequencer";
import { dedupeTimelineClips } from "@/lib/timeline/unique-media-allocation";
import {
  buildPageTurnTransitions,
  calculateBookDuration
} from "@/lib/transitions/page-turn-engine";
import { getThemePresetConfig } from "@/lib/themes/theme-registry";

export function buildBookRenderPlan(project: ProjectRecord, timeline: Timeline) {
  const dedupedClips = dedupeTimelineClips(timeline.clips);
  const generation = timeline.settings.generation!;
  const theme = getThemePresetConfig(generation.themePreset);
  const cover = buildBookCover(project, timeline);
  const pages = sequenceTimelineIntoBookPages({
    project,
    timeline: {
      ...timeline,
      clips: dedupedClips.clips
    },
    cover
  });
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
  const transitions = buildPageTurnTransitions(pages, timeline.detectedVibe, {
    theme,
    generation
  });

  return {
    ...timeline,
    clips: dedupedClips.clips,
    actualDurationSec: calculateBookDuration({
      style: "memory-book" as const,
      generatedTitle: cover.title,
      cover,
      pages,
      transitions,
      openingAnimation,
      material,
      textTreatment,
      reusePolicy: "unique-only" as const,
      uniqueAssetIds: dedupedClips.clips.map((clip) => clip.assetId),
      validationNotes:
        dedupedClips.removedAssetIds.length > 0
          ? [`Removed duplicate clips: ${dedupedClips.removedAssetIds.join(", ")}`]
          : []
    }),
    book: {
      style: "memory-book" as const,
      generatedTitle: cover.title,
      cover,
      pages,
      transitions,
      openingAnimation,
      material,
      textTreatment,
      reusePolicy: "unique-only" as const,
      uniqueAssetIds: dedupedClips.clips.map((clip) => clip.assetId),
      validationNotes:
        dedupedClips.removedAssetIds.length > 0
          ? [`Removed duplicate clips: ${dedupedClips.removedAssetIds.join(", ")}`]
          : []
    }
  };
}
