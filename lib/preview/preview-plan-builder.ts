import { detectTimelineVibe } from "@/lib/audio/vibe-detector";
import { PREVIEW_PLAN_LIMIT } from "@/lib/constants";
import { createId } from "@/lib/ids";
import { createStoryPlan } from "@/lib/story/story-planner";
import type {
  GenerationSettings,
  PreviewPlan,
  PreviewRegenerationMode,
  ProjectRecord,
  ThemePreset,
  TitleStyle
} from "@/lib/types";
import { normalizeProjectSettings } from "@/lib/user-controls/generation-settings";
import { buildProjectTimelines } from "@/timeline/generator";

interface PreviewVariantDefinition {
  name: string;
  variantLabel: string;
  isPrimary: boolean;
  previewMode: PreviewPlan["previewMode"];
  generationPatch?: Partial<GenerationSettings>;
}

function cloneProjectForPreview(
  project: ProjectRecord,
  titleStyle: TitleStyle,
  themePreset: ThemePreset,
  decorationLevel?: GenerationSettings["decorationLevel"]
) {
  const normalizedSettings = normalizeProjectSettings(project.settings);
  const storyPlan = createStoryPlan(project);
  const chapterPlansById = new Map(storyPlan.chapterPlans.map((plan) => [plan.chapterId, plan]));
  const selectedAssets = project.assets.filter(
    (asset) => storyPlan.selectedAssetIds.includes(asset.id) && !asset.userState?.excluded
  );
  const chapterOrder = storyPlan.chapterPlans.map((plan) => plan.chapterId);
  const chapters = chapterOrder
    .map((chapterId) => project.chapters.find((chapter) => chapter.id === chapterId))
    .filter((chapter): chapter is ProjectRecord["chapters"][number] => Boolean(chapter))
    .map((chapter) => {
      const chapterPlan = chapterPlansById.get(chapter.id)!;
      return {
        ...chapter,
        title: chapterPlan.title,
        assetIds: chapterPlan.orderedAssetIds
      };
    });

  return {
    ...project,
    assets: selectedAssets,
    chapters,
    storyPlan,
    settings: normalizeProjectSettings({
      ...project.settings,
      generation: {
        ...normalizedSettings.generation!,
        titleStyle,
        themePreset,
        decorationLevel: decorationLevel ?? normalizedSettings.generation!.decorationLevel
      }
    })
  };
}

export function buildPreviewPlan(options: {
  project: ProjectRecord;
  name: string;
  variantLabel: string;
  isPrimary: boolean;
  previewMode: PreviewPlan["previewMode"];
  titleStyle?: TitleStyle;
  themePreset?: ThemePreset;
  decorationLevel?: GenerationSettings["decorationLevel"];
}) {
  const settings = normalizeProjectSettings(options.project.settings);
  const generation = settings.generation!;
  const titleStyle = options.titleStyle ?? generation.titleStyle;
  const themePreset = options.themePreset ?? generation.themePreset;
  const decorationLevel = options.decorationLevel ?? generation.decorationLevel;
  const planProject = cloneProjectForPreview(
    options.project,
    titleStyle,
    themePreset,
    decorationLevel
  );
  const timelines = buildProjectTimelines(planProject);
  const masterVibe = detectTimelineVibe(planProject, timelines.masterTimeline).vibe;
  const masterTimeline = {
    ...timelines.masterTimeline,
    title: planProject.storyPlan?.recapTitle ?? timelines.masterTimeline.title,
    subtitle: planProject.storyPlan?.recapSubtitle,
    settings: planProject.settings,
    detectedVibe: masterVibe
  };
  const chapterTimelines = timelines.chapterTimelines.map((timeline) => {
    const chapterPlan = planProject.storyPlan?.chapterPlans.find(
      (plan) => plan.chapterId === timeline.chapterOrder[0]
    );
    return {
      ...timeline,
      title: chapterPlan?.title ?? timeline.title,
      subtitle: chapterPlan?.subtitle,
      settings: planProject.settings,
      detectedVibe: detectTimelineVibe(planProject, timeline).vibe
    };
  });
  return {
    id: createId("plan", 8),
    projectId: options.project.id,
    name: options.name,
    variantLabel: options.variantLabel,
    previewMode: options.previewMode,
    isPrimary: options.isPrimary,
    recapTitle: planProject.storyPlan?.recapTitle ?? masterTimeline.title,
    recapSubtitle: planProject.storyPlan?.recapSubtitle,
    chapterTitles: planProject.storyPlan?.chapterPlans.map((plan) => plan.title) ?? [],
    chapterCount: chapterTimelines.length,
    themePreset,
    titleStyle,
    decorationLevel,
    generationMode: "memory-book",
    aspectRatio: "landscape-16x9",
    musicVibe: masterVibe,
    estimatedDurationSec: masterTimeline.actualDurationSec,
    representativeAssetIds:
      planProject.storyPlan?.chapterPlans.flatMap((plan) => plan.representativeAssetIds).slice(0, 12) ?? [],
    openingAssetIds: [planProject.storyPlan?.anchors.openingAssetId ?? ""].filter(Boolean),
    endingAssetIds: [planProject.storyPlan?.anchors.endingAssetId ?? ""].filter(Boolean),
    storyPlan: planProject.storyPlan!,
    masterTimeline,
    chapterTimelines
  } satisfies PreviewPlan;
}

function applyGenerationPatch(project: ProjectRecord, generationPatch?: Partial<GenerationSettings>) {
  if (!generationPatch) {
    return project;
  }

  const normalized = normalizeProjectSettings(project.settings);
  return {
    ...project,
    settings: normalizeProjectSettings({
      ...project.settings,
      generation: {
        ...normalized.generation!,
        ...generationPatch
      }
    })
  };
}

function variantDefinitions(
  project: ProjectRecord,
  mode: PreviewRegenerationMode
): PreviewVariantDefinition[] {
  const settings = normalizeProjectSettings(project.settings).generation!;
  const base: PreviewVariantDefinition = {
    name: "Primary cut",
    variantLabel: "Primary",
    isPrimary: true,
    previewMode: mode
  };

  switch (mode) {
    case "titles-only":
      return [
        base,
        {
          name: "Nostalgic titles",
          variantLabel: "Alt A",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            titleStyle: settings.titleStyle === "nostalgic" ? "yearbook" : "nostalgic"
          }
        },
        {
          name: "Yearbook titles",
          variantLabel: "Alt B",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            titleStyle: settings.titleStyle === "yearbook" ? "cinematic" : "yearbook"
          }
        }
      ];
    case "chapter-grouping":
      return [
        base,
        {
          name: "Story-forward chapters",
          variantLabel: "Alt A",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            ordering:
              settings.ordering === "best-story-order"
                ? "mostly-chronological"
                : "best-story-order"
          }
        },
        {
          name: "Strict chronology",
          variantLabel: "Alt B",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            ordering: "strict-chronological"
          }
        }
      ];
    case "styling":
      return [
        base,
        {
          name: "Yearbook look",
          variantLabel: "Alt A",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            themePreset: settings.themePreset === "yearbook" ? "photo-album" : "yearbook",
            titleStyle: "yearbook",
            decorationLevel: "balanced"
          }
        },
        {
          name: "Cinematic journal",
          variantLabel: "Alt B",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            themePreset:
              settings.themePreset === "cinematic-journal"
                ? "minimal-clean"
                : "cinematic-journal",
            titleStyle: "cinematic",
            decorationLevel:
              settings.themePreset === "minimal-clean" ? "minimal" : "rich"
          }
        }
      ];
    case "opening-ending":
      return [
        base,
        {
          name: "Authentic open and close",
          variantLabel: "Alt A",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            storyStyle: "authentic",
            ordering: "mostly-chronological"
          }
        },
        {
          name: "Premium cinematic open and close",
          variantLabel: "Alt B",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            storyStyle: "cinematic",
            titleStyle: "cinematic",
            decorationLevel: "rich"
          }
        }
      ];
    case "music-mood":
      return [
        base,
        {
          name: "Music-forward mood",
          variantLabel: "Alt A",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            audioEmphasis: "music-forward",
            storyStyle: settings.storyStyle === "emotional" ? "cinematic" : "emotional"
          }
        },
        {
          name: "Original-audio-forward mood",
          variantLabel: "Alt B",
          isPrimary: false,
          previewMode: mode,
          generationPatch: {
            audioEmphasis: "original-audio-forward",
            storyStyle: "authentic"
          }
        }
      ];
    default:
      return [
        base,
        {
          name: "Alternate look",
          variantLabel: "Alt A",
          isPrimary: false,
          previewMode: "styling",
          generationPatch: {
            themePreset: settings.themePreset === "scrapbook" ? "yearbook" : "scrapbook",
            titleStyle: settings.titleStyle === "nostalgic" ? "yearbook" : "nostalgic",
            decorationLevel:
              settings.themePreset === "scrapbook" ? "balanced" : "rich"
          }
        },
        {
          name: "Alternate story order",
          variantLabel: "Alt B",
          isPrimary: false,
          previewMode: "chapter-grouping",
          generationPatch: {
            ordering:
              settings.ordering === "mostly-chronological"
                ? "best-story-order"
                : "mostly-chronological"
          }
        }
      ];
  }
}

export function buildPreviewPlanVariants(
  project: ProjectRecord,
  mode: PreviewRegenerationMode = "full-plan"
) {
  return variantDefinitions(project, mode)
    .slice(0, PREVIEW_PLAN_LIMIT)
    .map((variant) =>
      buildPreviewPlan({
        project: applyGenerationPatch(project, variant.generationPatch),
        name: variant.name,
        variantLabel: variant.variantLabel,
        isPrimary: variant.isPrimary,
        previewMode: variant.previewMode
      })
    );
}
