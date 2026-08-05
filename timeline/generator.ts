import {
  CHAPTER_TARGET_DURATION_SEC,
  MASTER_TARGET_DURATION_SEC,
  VIDEO_RESOLUTION
} from "@/lib/constants";
import {
  isMeaningfulContentText,
  normalizeContentText,
  transcriptContentText
} from "@/lib/analysis/content-text";
import { createId } from "@/lib/ids";
import {
  dedupeTimelineClips,
  extendSelectionWithUniqueCandidates
} from "@/lib/timeline/unique-media-allocation";
import type {
  Chapter,
  MediaAsset,
  ProjectRecord,
  ProjectSettings,
  Timeline,
  TimelineClip
} from "@/lib/types";
import { sortAssetsChronologically } from "@/media-processing/metadata";

interface StyleProfile {
  imageDurationSec: number;
  minVideoTrimSec: number;
  maxVideoTrimSec: number;
  transitionSec: number;
  imageBias: number;
  motionBias: number;
  openingTransitions: readonly string[];
  chapterTransitions: readonly string[];
  highlightTransitions: readonly string[];
  bridgeTransitions: readonly string[];
  closingTransitions: readonly string[];
}

function resolveStyleProfile(settings: ProjectSettings): StyleProfile {
  const generation = settings.generation;
  const toneMap = {
    energetic: {
      imageDurationSec: 2.4,
      minVideoTrimSec: 1.8,
      maxVideoTrimSec: 4.8,
      transitionSec: 0.24,
      imageBias: -0.04,
      motionBias: 0.14,
      openingTransitions: ["fadeblack", "wipeleft"],
      chapterTransitions: ["wipeleft", "circleopen", "smoothleft"],
      highlightTransitions: ["slideleft", "slideright", "pixelize", "circleopen"],
      bridgeTransitions: ["fade", "smoothleft", "smoothright"],
      closingTransitions: ["fadeblack", "circleclose", "fade"]
    },
    balanced: {
      imageDurationSec: 3.4,
      minVideoTrimSec: 2.8,
      maxVideoTrimSec: 6.2,
      transitionSec: 0.38,
      imageBias: 0,
      motionBias: 0.06,
      openingTransitions: ["fade", "fadeblack"],
      chapterTransitions: ["smoothleft", "circleopen", "fade"],
      highlightTransitions: ["circleopen", "smoothup", "wipeleft", "pixelize"],
      bridgeTransitions: ["fade", "smoothleft", "smoothup", "smoothright"],
      closingTransitions: ["fadeblack", "circleclose", "fade"]
    },
    emotional: {
      imageDurationSec: 4.6,
      minVideoTrimSec: 3.4,
      maxVideoTrimSec: 7.8,
      transitionSec: 0.58,
      imageBias: 0.1,
      motionBias: -0.02,
      openingTransitions: ["fadeblack", "fade"],
      chapterTransitions: ["smoothup", "fadeblack", "circleopen"],
      highlightTransitions: ["fade", "circleopen", "smoothleft"],
      bridgeTransitions: ["fade", "smoothup", "smoothdown"],
      closingTransitions: ["fadeblack", "fade", "circleclose"]
    }
  } as const;

  const densityMultiplier =
    generation?.pacing === "fast"
      ? 0.82
      : generation?.pacing === "slow-sentimental"
        ? 1.2
        : settings.clipDensity === "fast-cuts"
          ? 0.82
          : 1.18;
  const resolvedTone =
    generation?.storyStyle === "energetic"
      ? "energetic"
      : generation?.storyStyle === "emotional"
        ? "emotional"
        : settings.tone;
  const profile = toneMap[resolvedTone];
  return {
    imageDurationSec: profile.imageDurationSec * densityMultiplier,
    minVideoTrimSec: profile.minVideoTrimSec * densityMultiplier,
    maxVideoTrimSec: profile.maxVideoTrimSec * densityMultiplier,
    transitionSec: densityMultiplier <= 0.9 ? profile.transitionSec * 0.85 : profile.transitionSec * 1.15,
    imageBias:
      profile.imageBias +
      ((generation?.subjectEmphasis === "campus-scenery"
        ? 0.1
        : generation?.pacing === "slow-sentimental" || settings.clipDensity === "slow-cuts"
          ? 0.04
          : -0.02)),
    motionBias: profile.motionBias,
    openingTransitions: profile.openingTransitions,
    chapterTransitions: profile.chapterTransitions,
    highlightTransitions: profile.highlightTransitions,
    bridgeTransitions: profile.bridgeTransitions,
    closingTransitions: profile.closingTransitions
  };
}

function selectionWeight(asset: MediaAsset, profile: StyleProfile) {
  const score = asset.score?.total ?? 0.25;
  const motion = asset.score?.motion ?? 0;
  const imageAdjustment = asset.mediaType === "image" ? profile.imageBias : 0;
  const semanticAdjustment = asset.analysis?.semanticHint ? 0.03 : 0;
  const qualityTierAdjustment =
    asset.analysis?.qualityTier === "hero"
      ? 0.28
      : asset.analysis?.qualityTier === "strong"
        ? 0.16
        : asset.analysis?.qualityTier === "weak"
          ? -0.18
          : 0;
  const pinnedAdjustment = asset.userState?.pinned ? 0.65 : 0;
  const duplicatePenalty = asset.analysis?.duplicateAnalysis?.isDuplicate ? -0.42 : 0;
  const dialogueBoost = asset.analysis?.transcriptResult?.dialogueScore
    ? asset.analysis.transcriptResult.dialogueScore * 0.18
    : 0;
  const recurringFaceBoost = (asset.analysis?.faceCluster?.recurrenceCount ?? 0) * 0.04;
  return (
    score +
    motion * profile.motionBias +
    imageAdjustment +
    semanticAdjustment +
    qualityTierAdjustment +
    pinnedAdjustment +
    duplicatePenalty +
    dialogueBoost +
    recurringFaceBoost
  );
}

function toTimelineClip(
  asset: MediaAsset,
  chapterId: string,
  profile: StyleProfile,
  options?: {
    titleOverlay?: string;
    storyRole?: TimelineClip["storyRole"];
    transitionName?: string;
  }
): TimelineClip {
  const contentTranscript =
    transcriptContentText(asset.analysis?.transcriptResult) ??
    (isMeaningfulContentText(asset.analysis?.transcript)
      ? normalizeContentText(asset.analysis?.transcript)
      : undefined);

  if (asset.mediaType === "image") {
    return {
      id: createId("clip", 8),
      assetId: asset.id,
      chapterId,
      mediaType: asset.mediaType,
      sourcePath: asset.storage.normalizedPath ?? asset.storage.originalPath,
      audioSourcePath: undefined,
      normalizedPath: asset.storage.normalizedPath,
      trimStartSec: 0,
      trimDurationSec: profile.imageDurationSec,
      displayDurationSec: profile.imageDurationSec,
      score: asset.score?.total ?? 0,
      hasSpeech: false,
      sourceAudio: {
        hasAudio: false,
        gainDb: 0,
        musicDuckDb: 0
      },
      titleOverlay: options?.titleOverlay,
      filename: asset.filename,
      capturedAt: asset.metadata.capturedAt,
      transcriptText: contentTranscript,
      sceneTags: asset.analysis?.semanticHint ? [asset.analysis.semanticHint] : undefined,
      storyRole: options?.storyRole,
      transitionName: options?.transitionName
    };
  }

  const sourceDuration = asset.metadata.durationSec ?? profile.maxVideoTrimSec;
  const trimDurationSec = Math.min(
    profile.maxVideoTrimSec,
    Math.max(profile.minVideoTrimSec, sourceDuration * 0.75)
  );
  const trimStartSec = Math.max(0, (sourceDuration - trimDurationSec) / 2);

  return {
    id: createId("clip", 8),
    assetId: asset.id,
    chapterId,
    mediaType: asset.mediaType,
    sourcePath: asset.storage.proxyPath ?? asset.storage.originalPath,
    audioSourcePath: asset.storage.originalPath,
    trimStartSec,
    trimDurationSec,
    displayDurationSec: trimDurationSec,
    score: asset.score?.total ?? 0,
    hasSpeech: Boolean(contentTranscript?.trim()),
    sourceAudio: {
      hasAudio: false,
      gainDb: 0,
      musicDuckDb: -12
    },
    titleOverlay: options?.titleOverlay,
    filename: asset.filename,
    capturedAt: asset.metadata.capturedAt,
    transcriptText: contentTranscript,
    sceneTags: asset.analysis?.semanticHint ? [asset.analysis.semanticHint] : undefined,
    storyRole: options?.storyRole,
    transitionName: options?.transitionName
  };
}

function fitTimelineDuration(
  clips: TimelineClip[],
  targetDurationSec: number,
  profile: StyleProfile
) {
  const result = [...clips];
  const minImage = 2;
  const minVideo = 1.8;
  const calculateEffectiveDuration = (timelineClips: TimelineClip[]) =>
    Math.max(
      0,
      timelineClips.reduce((sum, clip) => sum + clip.displayDurationSec, 0) -
        Math.max(0, timelineClips.length - 1) * profile.transitionSec
    );
  const maxDisplayDuration = (clip: TimelineClip) => {
    if (clip.mediaType === "image") {
      return clip.storyRole === "opening" || clip.storyRole === "closing" ? 12 : 9.4;
    }
    return Math.min(11.5, Math.max(clip.trimDurationSec + 2.1, 5.2));
  };
  let total = calculateEffectiveDuration(result);

  if (total > targetDurationSec) {
    for (let index = result.length - 1; index >= 0 && total > targetDurationSec; index -= 1) {
      const clip = result[index];
      const minAllowed = clip.mediaType === "image" ? minImage : minVideo;
      const delta = Math.min(total - targetDurationSec, clip.displayDurationSec - minAllowed);
      if (delta > 0) {
        clip.displayDurationSec -= delta;
        clip.trimDurationSec = Math.min(clip.trimDurationSec, clip.displayDurationSec);
        total = calculateEffectiveDuration(result);
      }
    }
  } else if (total < targetDurationSec && result.length) {
    while (total < targetDurationSec) {
      const expandable = result.filter(
        (clip) => clip.displayDurationSec < maxDisplayDuration(clip) - 0.01
      );
      if (!expandable.length) {
        break;
      }
      const extraPerClip = Math.min(1.2, (targetDurationSec - total) / expandable.length);
      for (const clip of expandable) {
        const nextDuration = Math.min(
          maxDisplayDuration(clip),
          clip.displayDurationSec + extraPerClip
        );
        clip.displayDurationSec = nextDuration;
        if (clip.mediaType === "image") {
          clip.trimDurationSec = nextDuration;
        } else {
          clip.trimDurationSec = Math.min(nextDuration, maxDisplayDuration(clip));
        }
      }
      total = calculateEffectiveDuration(result);
    }

    if (total > targetDurationSec) {
      for (let index = result.length - 1; index >= 0 && total > targetDurationSec; index -= 1) {
        const clip = result[index];
        const minAllowed = clip.mediaType === "image" ? minImage : minVideo;
        const delta = Math.min(total - targetDurationSec, clip.displayDurationSec - minAllowed);
        if (delta > 0) {
          clip.displayDurationSec -= delta;
          clip.trimDurationSec = clip.displayDurationSec;
          total = calculateEffectiveDuration(result);
        }
      }
    }
  }

  return {
    clips: result,
    actualDurationSec: Number(total.toFixed(2))
  };
}

function estimateClipDuration(asset: MediaAsset, profile: StyleProfile) {
  if (asset.mediaType === "image") {
    return profile.imageDurationSec;
  }

  return Math.min(
    profile.maxVideoTrimSec,
    Math.max(profile.minVideoTrimSec, (asset.metadata.durationSec ?? 4) * 0.75)
  );
}

function pickChapterAssets(
  chapterAssets: MediaAsset[],
  chapterQuota: number,
  profile: StyleProfile
) {
  const chronologicalAssets = sortAssetsChronologically(chapterAssets);
  if (!chronologicalAssets.length) {
    return [];
  }

  if (chronologicalAssets.length <= 12) {
    return chronologicalAssets;
  }

  const targetCount = Math.max(
    3,
    Math.min(
      chronologicalAssets.length,
      Math.round(
        chapterQuota /
          Math.max(
            2.6,
            chronologicalAssets.reduce(
              (sum, asset) => sum + estimateClipDuration(asset, profile),
              0
            ) / chronologicalAssets.length
          )
      )
    )
  );

  const selected = new Map<string, MediaAsset>();
  const anchorIndexes = Array.from(
    new Set(
      [0, Math.floor((chronologicalAssets.length - 1) * 0.35), Math.floor((chronologicalAssets.length - 1) * 0.72), chronologicalAssets.length - 1]
        .filter((index) => index >= 0 && index < chronologicalAssets.length)
    )
  );

  for (const index of anchorIndexes) {
    selected.set(chronologicalAssets[index].id, chronologicalAssets[index]);
  }

  const ranked = [...chronologicalAssets].sort((left, right) => {
    const leftIndex = chronologicalAssets.findIndex((asset) => asset.id === left.id);
    const rightIndex = chronologicalAssets.findIndex((asset) => asset.id === right.id);
    const leftBeat = Math.min(
      ...[0.16, 0.38, 0.58, 0.82].map((beat) => Math.abs(leftIndex / Math.max(1, chronologicalAssets.length - 1) - beat))
    );
    const rightBeat = Math.min(
      ...[0.16, 0.38, 0.58, 0.82].map((beat) => Math.abs(rightIndex / Math.max(1, chronologicalAssets.length - 1) - beat))
    );
    return (
      selectionWeight(right, profile) -
      selectionWeight(left, profile) +
      (leftBeat - rightBeat) * 0.12
    );
  });

  for (const candidate of ranked) {
    if (selected.has(candidate.id)) {
      continue;
    }
    const current = sortAssetsChronologically(Array.from(selected.values()));
    const candidateIndex = chronologicalAssets.findIndex((asset) => asset.id === candidate.id);
    const tooClose = current.some((asset) => {
      const assetIndex = chronologicalAssets.findIndex((item) => item.id === asset.id);
      return Math.abs(assetIndex - candidateIndex) <= 1 && asset.mediaType === candidate.mediaType;
    });

    if (tooClose && current.length < targetCount + 1) {
      continue;
    }

    selected.set(candidate.id, candidate);
    if (selected.size >= targetCount) {
      break;
    }
  }

  return sortAssetsChronologically(Array.from(selected.values()));
}

function pickFromCycle(cycle: readonly string[], index: number) {
  return cycle[index % cycle.length] ?? "fade";
}

function buildHighlightSet(assets: MediaAsset[], profile: StyleProfile) {
  const ranked = [...assets]
    .sort((left, right) => selectionWeight(right, profile) - selectionWeight(left, profile))
    .slice(0, Math.max(1, Math.min(3, Math.ceil(assets.length / 4))));

  return new Set(ranked.map((asset) => asset.id));
}

function estimateAssetSequenceDuration(assets: MediaAsset[], profile: StyleProfile) {
  if (!assets.length) {
    return 0;
  }

  return Math.max(
    0,
    assets.reduce((sum, asset) => sum + estimateClipDuration(asset, profile), 0) -
      Math.max(0, assets.length - 1) * profile.transitionSec
  );
}

function expandChapterSelections(options: {
  chapterSelections: Array<{
    chapter: Chapter;
    chapterAssets: MediaAsset[];
    selectedAssets: MediaAsset[];
  }>;
  targetDurationSec: number;
  profile: StyleProfile;
}) {
  let estimatedDuration = options.chapterSelections.reduce(
    (sum, entry) => sum + estimateAssetSequenceDuration(entry.selectedAssets, options.profile),
    0
  );

  if (estimatedDuration >= options.targetDurationSec * 0.9) {
    return options.chapterSelections;
  }

  let remainingChapters = options.chapterSelections.length;
  return options.chapterSelections.map((entry) => {
    const selectedDuration = estimateAssetSequenceDuration(entry.selectedAssets, options.profile);
    const remainingDuration = Math.max(0, options.targetDurationSec - estimatedDuration);
    const chapterTarget =
      selectedDuration +
      remainingDuration / Math.max(1, remainingChapters);
    const candidateAssets = sortAssetsChronologically(
      entry.chapterAssets.filter(
        (asset) => !entry.selectedAssets.some((selected) => selected.id === asset.id)
      )
    );

    const expanded = extendSelectionWithUniqueCandidates({
      selectedAssets: entry.selectedAssets,
      candidateAssets,
      targetDurationSec: chapterTarget,
      estimateDuration: (asset) => estimateClipDuration(asset, options.profile)
    });

    estimatedDuration +=
      estimateAssetSequenceDuration(expanded, options.profile) - selectedDuration;
    remainingChapters -= 1;

    return {
      ...entry,
      selectedAssets: sortAssetsChronologically(expanded)
    };
  });
}

function buildSingleTimeline(options: {
  project: ProjectRecord;
  kind: "master" | "chapter";
  title: string;
  targetDurationSec: number;
  assets: MediaAsset[];
  chapters: Chapter[];
  usedAssetIds?: Set<string>;
}) {
  const profile = resolveStyleProfile(options.project.settings);
  const stillRatio =
    options.assets.length === 0
      ? 0
      : options.assets.filter((asset) => asset.mediaType === "image").length / options.assets.length;
  const fps = stillRatio >= 0.85 ? 12 : stillRatio >= 0.6 ? 18 : VIDEO_RESOLUTION.fps;
  const selectedClips: TimelineClip[] = [];
  const disallowed = options.usedAssetIds ?? new Set<string>();
  const chapterSelections = expandChapterSelections({
    chapterSelections: options.chapters.map((chapter) => {
      const chapterAssets = sortAssetsChronologically(
        options.assets.filter(
          (asset) => chapter.assetIds.includes(asset.id) && !disallowed.has(asset.id)
        )
      );
      const chapterQuota =
        options.kind === "master"
          ? Math.max(32, options.targetDurationSec / Math.max(options.chapters.length, 1) - 4)
          : options.targetDurationSec;

      return {
        chapter,
        chapterAssets,
        selectedAssets: pickChapterAssets(chapterAssets, chapterQuota, profile)
      };
    }),
    targetDurationSec: options.targetDurationSec,
    profile
  });

  chapterSelections.forEach(({ chapter, selectedAssets }, chapterIndex) => {
    const highlightAssetIds = buildHighlightSet(selectedAssets, profile);
    selectedAssets.forEach((asset, index) => {
      const isFirstClip = selectedClips.length === 0;
      const isChapterStart = index === 0;
      const isChapterEnd = index === selectedAssets.length - 1;
      const titleOverlay = isFirstClip && options.kind === "master"
        ? options.title
        : isChapterStart
          ? chapter.title
          : undefined;
      const storyRole: TimelineClip["storyRole"] = isFirstClip && options.kind === "master"
        ? "opening"
        : isChapterStart
          ? "chapter-intro"
          : isChapterEnd
            ? "closing"
            : highlightAssetIds.has(asset.id)
              ? "highlight"
              : "bridge";
      const transitionName =
        storyRole === "opening"
          ? pickFromCycle(profile.openingTransitions, selectedClips.length)
          : storyRole === "chapter-intro"
            ? pickFromCycle(profile.chapterTransitions, index + chapterIndex)
            : storyRole === "highlight"
              ? pickFromCycle(profile.highlightTransitions, index + chapterIndex)
              : storyRole === "closing"
                ? pickFromCycle(
                    profile.closingTransitions,
                    index + chapterIndex + selectedClips.length
                  )
                : pickFromCycle(profile.bridgeTransitions, index + selectedClips.length);

      selectedClips.push(
        toTimelineClip(asset, chapter.id, profile, {
          titleOverlay,
          storyRole,
          transitionName
        })
      );
      disallowed.add(asset.id);
    });
  });

  const dedupedSelection = dedupeTimelineClips(selectedClips);
  const fitted = fitTimelineDuration(
    dedupedSelection.clips,
    options.targetDurationSec,
    profile
  );

  const timeline: Timeline = {
    id: createId(options.kind, 8),
    projectId: options.project.id,
    kind: options.kind,
    title: options.title,
    targetDurationSec: options.targetDurationSec,
    actualDurationSec: fitted.actualDurationSec,
    settings: options.project.settings,
    clips: fitted.clips,
    chapterOrder: options.chapters.map((chapter) => chapter.id),
    renderProfile: {
      ...VIDEO_RESOLUTION,
      fps,
      transitionSec: profile.transitionSec
    }
  };

  return {
    timeline,
    usedAssetIds: disallowed
  };
}

export function buildProjectTimelines(project: ProjectRecord) {
  const assetMap = new Map(project.assets.map((asset) => [asset.id, asset]));
  const storyPlan = project.storyPlan;
  const storyChapterOrder =
    storyPlan?.chapterPlans
      .map((plan) => project.chapters.find((chapter) => chapter.id === plan.chapterId))
      .filter((chapter): chapter is Chapter => Boolean(chapter)) ?? project.chapters;
  const chapterTimelines: Timeline[] = [];
  const reservedAssets = new Set<string>();
  const wallFrameOnly = project.settings.generation?.generationMode === "wall-frame";

  for (const chapter of wallFrameOnly ? [] : storyChapterOrder) {
    const chapterAssets = chapter.assetIds
      .map((assetId) => assetMap.get(assetId))
      .filter((asset): asset is MediaAsset => Boolean(asset));
    const chapterPlan = storyPlan?.chapterPlans.find((plan) => plan.chapterId === chapter.id);
    const { timeline } = buildSingleTimeline({
      project,
      kind: "chapter",
      title: chapterPlan?.title ?? chapter.title,
      targetDurationSec: CHAPTER_TARGET_DURATION_SEC,
      assets: chapterAssets,
      chapters: [chapter]
    });
    timeline.clips.forEach((clip) => reservedAssets.add(clip.assetId));
    timeline.subtitle = chapterPlan?.subtitle;
    chapterTimelines.push(timeline);
  }

  const { timeline: masterTimeline } = buildSingleTimeline({
    project,
    kind: "master",
    title: storyPlan?.recapTitle ?? "College Vlog Recap",
    targetDurationSec: MASTER_TARGET_DURATION_SEC,
    assets: project.assets,
    chapters: storyChapterOrder,
    usedAssetIds:
      !wallFrameOnly &&
      project.assets.length >= 24 && reservedAssets.size <= project.assets.length - 8
        ? new Set(reservedAssets)
        : undefined
  });
  masterTimeline.subtitle = storyPlan?.recapSubtitle;

  if (masterTimeline.clips.length === 0) {
    const fallbackAssets = sortAssetsChronologically(project.assets);
    const fallbackChapter =
      project.chapters[0] ??
      ({
        id: "fallback",
        projectId: project.id,
        index: 0,
        title: "Chapter 1",
        labelConfidence: 0.2,
        assetIds: fallbackAssets.map((asset) => asset.id),
        stats: {
          totalAssets: fallbackAssets.length,
          imageCount: fallbackAssets.filter((asset) => asset.mediaType === "image").length,
          videoCount: fallbackAssets.filter((asset) => asset.mediaType === "video").length,
          avgScore: 0.5,
          avgMotion: 0.2,
          spanHours: 0
        }
      } satisfies Chapter);

    const fallback = buildSingleTimeline({
      project: {
        ...project,
        chapters: [fallbackChapter]
      },
      kind: "master",
      title: storyPlan?.recapTitle ?? "College Vlog Recap",
      targetDurationSec: MASTER_TARGET_DURATION_SEC,
      assets: fallbackAssets,
      chapters: [fallbackChapter]
    });
    fallback.timeline.subtitle = storyPlan?.recapSubtitle;

    return {
      masterTimeline: fallback.timeline,
      chapterTimelines
    };
  }

  return {
    masterTimeline,
    chapterTimelines
  };
}
