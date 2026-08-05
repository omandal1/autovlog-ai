import { createId } from "@/lib/ids";
import { transcriptContentText } from "@/lib/analysis/content-text";
import { ensureUniqueChapterTitles } from "@/lib/chapter-title-utils";
import type {
  Chapter,
  ChapterPlan,
  HighlightMoment,
  MediaAsset,
  OrderingPreference,
  PacingProfile,
  ProjectRecord,
  SelectionReason,
  SkipReason,
  StoryPlan,
  TitleStyle
} from "@/lib/types";
import { average } from "@/lib/utils";
import { normalizeProjectSettings } from "@/lib/user-controls/generation-settings";

function scoreAssetImportance(asset: MediaAsset, project: ProjectRecord, chapter?: Chapter) {
  const settings = normalizeProjectSettings(project.settings);
  const generation = settings.generation!;
  const duplicatePenalty = asset.analysis?.duplicateAnalysis?.isDuplicate ? -0.28 : 0;
  const weakPenalty = asset.analysis?.qualityTier === "weak" ? -0.22 : 0;
  const faceBoost =
    generation.subjectEmphasis === "friends"
      ? (asset.analysis?.faceCluster?.recurrenceCount ?? 0) * 0.06
      : 0;
  const dialogueBoost =
    generation.subjectEmphasis === "dialogue-moments"
      ? (asset.analysis?.transcriptResult?.dialogueScore ?? 0) * 0.34
      : 0;
  const scenicBoost =
    generation.subjectEmphasis === "campus-scenery" && asset.mediaType === "image"
      ? (asset.score?.brightness ?? 0) * 0.12 + (asset.score?.contrast ?? 0) * 0.08
      : 0;
  const activityBoost =
    generation.subjectEmphasis === "activities-events"
      ? (asset.score?.motion ?? 0) * 0.22
      : 0;
  const pinnedBoost = asset.userState?.pinned ? 1.15 : 0;
  const chapterBoundaryBoost = chapter && chapter.index === 0 ? 0.04 : 0;
  return (
    (asset.score?.total ?? 0.2) +
    pinnedBoost +
    duplicatePenalty +
    weakPenalty +
    faceBoost +
    dialogueBoost +
    scenicBoost +
    activityBoost +
    chapterBoundaryBoost
  );
}

function titleFromSignals(options: {
  chapter?: Chapter;
  assets: MediaAsset[];
  titleStyle: TitleStyle;
  fallback: string;
}) {
  const transcriptSnippet = options.assets
    .map((asset) => transcriptContentText(asset.analysis?.transcriptResult))
    .find((snippet): snippet is string => Boolean(snippet));
  const recurringFriends = options.assets.some(
    (asset) => (asset.analysis?.faceCluster?.recurrenceCount ?? 0) >= 3
  );
  const scenicRatio =
    options.assets.filter((asset) => asset.mediaType === "image").length /
    Math.max(options.assets.length, 1);
  const energetic = average(options.assets.map((asset) => asset.score?.motion ?? 0)) >= 0.42;

  if (options.titleStyle === "cinematic" && transcriptSnippet) {
    return transcriptSnippet
      .split(/\s+/)
      .slice(0, 4)
      .join(" ")
      .replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
  }
  if (options.titleStyle === "yearbook" && options.chapter) {
    return `Chapter ${options.chapter.index + 1}: ${options.fallback}`;
  }
  if (options.titleStyle === "scrapbook" && recurringFriends) {
    return options.chapter ? `Us, ${options.fallback}` : `Our ${options.fallback}`;
  }
  if (options.titleStyle === "nostalgic" && scenicRatio > 0.6) {
    return options.chapter ? `Quiet ${options.fallback}` : `College Memories`;
  }
  if (energetic) {
    return options.chapter ? `Big ${options.fallback}` : "College Highlights";
  }
  return options.fallback;
}

function orderAssetsForChapter(
  assets: MediaAsset[],
  project: ProjectRecord,
  chapter: Chapter,
  ordering: OrderingPreference
) {
  const chronological = [...assets].sort((left, right) =>
    (left.metadata.capturedAt ?? "").localeCompare(right.metadata.capturedAt ?? "")
  );
  if (ordering === "strict-chronological") {
    return chronological;
  }

  const weighted = [...chronological].sort((left, right) => {
    const rightScore = scoreAssetImportance(right, project, chapter);
    const leftScore = scoreAssetImportance(left, project, chapter);
    const timeBias =
      ordering === "mostly-chronological"
        ? chronological.indexOf(left) - chronological.indexOf(right)
        : 0;
    return rightScore - leftScore + timeBias * 0.03;
  });

  if (ordering === "best-story-order") {
    const opening = weighted[0];
    const ending = [...weighted]
      .reverse()
      .find((asset) => asset.id !== opening?.id);
    const middle = chronological.filter(
      (asset) => asset.id !== opening?.id && asset.id !== ending?.id
    );
    return [opening, ...middle, ending].filter((asset): asset is MediaAsset => Boolean(asset));
  }

  return chronological.map((asset, index) => weighted[index] ?? asset);
}

function buildPacingProfile(project: ProjectRecord): PacingProfile {
  const settings = normalizeProjectSettings(project.settings).generation!;
  return {
    pageHoldBias:
      settings.pacing === "slow-sentimental"
        ? 1.25
        : settings.pacing === "fast"
          ? 0.82
          : 1,
    transitionBias:
      settings.storyStyle === "energetic"
        ? 0.88
        : settings.storyStyle === "emotional"
          ? 1.14
          : 1,
    beatSnapStrength:
      settings.audioEmphasis === "music-forward"
        ? 0.84
        : settings.audioEmphasis === "original-audio-forward"
          ? 0.36
          : 0.58,
    storyEnergyCurve:
      settings.storyStyle === "energetic"
        ? [0.72, 0.88, 1, 0.78]
        : settings.storyStyle === "emotional"
          ? [0.48, 0.62, 0.82, 0.56]
          : [0.58, 0.74, 0.9, 0.64]
  };
}

export function createStoryPlan(project: ProjectRecord) {
  const settings = normalizeProjectSettings(project.settings).generation!;
  const includedAssets = project.assets.filter((asset) => !asset.userState?.excluded);
  const reasonsByAssetId: StoryPlan["reasonsByAssetId"] = {};
  const skipReasonsByAssetId: StoryPlan["skipReasonsByAssetId"] = {};
  const orderedChapters =
    settings.ordering === "best-story-order"
      ? [...project.chapters].sort((left, right) => {
          const leftAssets = left.assetIds
            .map((assetId) => includedAssets.find((asset) => asset.id === assetId))
            .filter((asset): asset is MediaAsset => Boolean(asset));
          const rightAssets = right.assetIds
            .map((assetId) => includedAssets.find((asset) => asset.id === assetId))
            .filter((asset): asset is MediaAsset => Boolean(asset));
          return (
            average(rightAssets.map((asset) => scoreAssetImportance(asset, project, right))) -
            average(leftAssets.map((asset) => scoreAssetImportance(asset, project, left)))
          );
        })
      : project.chapters;

  const chapterPlans: ChapterPlan[] = ensureUniqueChapterTitles(orderedChapters.map((chapter) => {
    const chapterAssets = chapter.assetIds
      .map((assetId) => includedAssets.find((asset) => asset.id === assetId))
      .filter((asset): asset is MediaAsset => Boolean(asset));
    const orderedAssets = orderAssetsForChapter(
      chapterAssets,
      project,
      chapter,
      settings.ordering
    );
    const strongAssets = orderedAssets.filter(
      (asset) =>
        asset.analysis?.qualityTier !== "weak" &&
        !asset.analysis?.duplicateAnalysis?.isDuplicate
    );
    const openingAsset = orderedAssets[0];
    const endingAsset = orderedAssets[orderedAssets.length - 1];
    const representativeAssets = (strongAssets.length ? strongAssets : orderedAssets).slice(0, 4);
    const reasons: SelectionReason[] = [];
    if (openingAsset?.userState?.pinned) {
      reasons.push({
        kind: "chapter-anchor",
        label: "Pinned anchor",
        detail: "This chapter opens with a pinned memory.",
        weight: 0.9
      });
    }
    if (representativeAssets.some((asset) => (asset.analysis?.faceCluster?.recurrenceCount ?? 0) >= 3)) {
      reasons.push({
        kind: "recurring-friend-group",
        label: "Recurring cast",
        detail: "Recurring people help hold the chapter together.",
        weight: 0.6
      });
    }

    const title = titleFromSignals({
      chapter,
      assets: representativeAssets,
      titleStyle: settings.titleStyle,
      fallback: chapter.title
    });

    const subtitle =
      settings.storyStyle === "cinematic"
        ? transcriptContentText(representativeAssets[0]?.analysis?.transcriptResult)
        : undefined;

    return {
      chapterId: chapter.id,
      title,
      subtitle,
      orderedAssetIds: orderedAssets.map((asset) => asset.id),
      representativeAssetIds: representativeAssets.map((asset) => asset.id),
      openingAssetId: openingAsset?.id,
      endingAssetId: endingAsset?.id,
      highlightAssetIds: representativeAssets.slice(0, 2).map((asset) => asset.id),
      estimatedDurationSec: Math.max(18, orderedAssets.length * 4.2),
      reasons
    };
  }), "Chapter");

  const selectedAssetIds = new Set(chapterPlans.flatMap((plan) => plan.orderedAssetIds));
  for (const asset of includedAssets) {
    const reasons = asset.analysis?.selectionReasons ?? [];
    reasonsByAssetId[asset.id] = reasons;
  }

  for (const asset of project.assets) {
    if (!selectedAssetIds.has(asset.id)) {
      skipReasonsByAssetId[asset.id] = asset.analysis?.skipReasons ?? [
        {
          kind: "not-selected-for-variant",
          label: "Held out of this preview variant",
          detail: "Stronger moments covered the same story beat."
        }
      ];
    }
  }

  const openingAssetId =
    chapterPlans[0]?.openingAssetId ??
    project.assets.find((asset) => asset.userState?.pinned)?.id;
  const endingAssetId =
    chapterPlans[chapterPlans.length - 1]?.endingAssetId ??
    [...includedAssets].reverse().find((asset) => !asset.analysis?.duplicateAnalysis?.isDuplicate)?.id;

  const highlights: HighlightMoment[] = chapterPlans.flatMap((plan) =>
    plan.highlightAssetIds.map((assetId, index) => ({
      assetId,
      chapterId: plan.chapterId,
      score: 1 - index * 0.12,
      kind:
        assetId === plan.openingAssetId
          ? "opening"
          : assetId === plan.endingAssetId
            ? "ending"
            : "peak",
      reasons: reasonsByAssetId[assetId] ?? []
    }))
  );

  const recapTitle = titleFromSignals({
    assets: includedAssets,
    titleStyle: settings.titleStyle,
    fallback:
      settings.titleStyle === "yearbook" ? "Year Two" : settings.titleStyle === "scrapbook" ? "College Memories" : "College Recap"
  });
  const recapSubtitle =
    settings.storyStyle === "authentic"
      ? "A lived-in look back"
      : settings.storyStyle === "cinematic"
        ? "A premium memory book cut"
        : settings.storyStyle === "emotional"
          ? "The moments that stayed with us"
          : undefined;

  return {
    id: createId("story", 8),
    projectId: project.id,
    generatedAt: new Date().toISOString(),
    orderingStrategy: settings.ordering,
    pacingProfile: buildPacingProfile(project),
    highlights,
    anchors: {
      openingAssetId,
      endingAssetId,
      chapterStartAssetIds: chapterPlans
        .map((plan) => plan.openingAssetId)
        .filter((assetId): assetId is string => Boolean(assetId)),
      chapterEndingAssetIds: chapterPlans
        .map((plan) => plan.endingAssetId)
        .filter((assetId): assetId is string => Boolean(assetId))
    },
    recapTitle,
    recapSubtitle,
    chapterPlans,
    selectedAssetIds: Array.from(selectedAssetIds),
    skippedAssetIds: project.assets
      .map((asset) => asset.id)
      .filter((assetId) => !selectedAssetIds.has(assetId)),
    reasonsByAssetId,
    skipReasonsByAssetId
  } satisfies StoryPlan;
}
