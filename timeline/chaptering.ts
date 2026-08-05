import { CHAPTER_POLICY } from "@/lib/constants";
import { ensureUniqueChapterTitles } from "@/lib/chapter-title-utils";
import { createId } from "@/lib/ids";
import type { Chapter, MediaAsset, PythonChapterLabel } from "@/lib/types";
import { average } from "@/lib/utils";
import { sortAssetsChronologically } from "@/media-processing/metadata";

interface BoundaryCandidate {
  afterIndex: number;
  gapHours: number;
  dayBoundary: boolean;
  score: number;
}

interface BoundarySelection {
  score: number;
  indexes: number[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function gapHours(left?: string, right?: string) {
  if (!left || !right) {
    return 0;
  }
  return Math.abs(new Date(right).getTime() - new Date(left).getTime()) / (1000 * 60 * 60);
}

function captureDay(value?: string) {
  return value?.slice(0, 10);
}

function estimatedStoryRuntimeSec(asset: MediaAsset) {
  if (asset.mediaType === "image") {
    return 3.6;
  }

  return clamp((asset.metadata.durationSec ?? 5) * 0.72, 2.4, 6.8);
}

function buildBoundaryCandidates(assets: MediaAsset[]) {
  const candidates: BoundaryCandidate[] = [];

  for (let index = 0; index < assets.length - 1; index += 1) {
    const left = assets[index]!;
    const right = assets[index + 1]!;
    const hours = gapHours(left.metadata.capturedAt, right.metadata.capturedAt);
    const dayBoundary = captureDay(left.metadata.capturedAt) !== captureDay(right.metadata.capturedAt);
    const semanticShift =
      Boolean(left.analysis?.semanticHint) &&
      Boolean(right.analysis?.semanticHint) &&
      left.analysis?.semanticHint !== right.analysis?.semanticHint;
    const motionDelta = Math.abs((left.score?.motion ?? 0) - (right.score?.motion ?? 0));
    const brightnessDelta = Math.abs(
      (left.score?.brightness ?? 0) - (right.score?.brightness ?? 0)
    );
    const gapScore =
      hours >= CHAPTER_POLICY.gapHours.veryStrong
        ? 1.42
        : hours >= CHAPTER_POLICY.gapHours.strong
          ? 1.04
          : hours >= CHAPTER_POLICY.gapHours.medium
            ? 0.68
            : hours >= 0.75
              ? 0.28
              : 0;

    const score =
      gapScore +
      (dayBoundary ? 0.36 : 0) +
      (semanticShift ? 0.18 : 0) +
      motionDelta * 0.22 +
      brightnessDelta * 0.14 +
      (left.mediaType !== right.mediaType ? 0.08 : 0);

    candidates.push({
      afterIndex: index,
      gapHours: hours,
      dayBoundary,
      score: Number(score.toFixed(3))
    });
  }

  return candidates;
}

function estimateDesiredChapterCount(assets: MediaAsset[], boundaries: BoundaryCandidate[]) {
  const assetCount = assets.length;
  if (assetCount <= 1) {
    return assetCount;
  }

  const maxFeasible = Math.min(CHAPTER_POLICY.maxChapters, assetCount);
  const minFeasible = Math.min(CHAPTER_POLICY.minChapters, maxFeasible);
  const estimatedRuntimeSec = assets.reduce(
    (sum, asset) => sum + estimatedStoryRuntimeSec(asset),
    0
  );
  const totalSpanHours = gapHours(
    assets[0]?.metadata.capturedAt,
    assets[assetCount - 1]?.metadata.capturedAt
  );
  const uniqueDays = new Set(
    assets.map((asset) => captureDay(asset.metadata.capturedAt) ?? "undated")
  ).size;
  const strongBoundaryCount = boundaries.filter(
    (boundary) =>
      boundary.gapHours >= CHAPTER_POLICY.gapHours.strong || boundary.score >= 1.04
  ).length;
  const mediumBoundaryCount = boundaries.filter(
    (boundary) =>
      boundary.gapHours >= CHAPTER_POLICY.gapHours.medium || boundary.score >= 0.68
  ).length;
  const semanticVariety = new Set(
    assets
      .map((asset) => asset.analysis?.semanticHint)
      .filter((hint): hint is string => Boolean(hint))
  ).size;

  const assetDriven = clamp(Math.round(assetCount / CHAPTER_POLICY.targetAssetsPerChapter), 1, maxFeasible);
  const runtimeDriven = clamp(
    Math.round(estimatedRuntimeSec / CHAPTER_POLICY.targetRuntimeWindowSec),
    1,
    maxFeasible
  );
  const timeDriven = clamp(
    Math.round(uniqueDays * 0.75 + (totalSpanHours >= 72 ? 1 : totalSpanHours >= 24 ? 0.5 : 0)),
    1,
    maxFeasible
  );
  const gapDriven = clamp(
    strongBoundaryCount + Math.round(mediumBoundaryCount * 0.4) + 1,
    1,
    maxFeasible
  );
  const diversityDriven = clamp(Math.max(semanticVariety, 1), 1, Math.min(5, maxFeasible));

  let desired = Math.round(
    assetDriven * 0.28 +
      runtimeDriven * 0.22 +
      timeDriven * 0.2 +
      gapDriven * 0.22 +
      diversityDriven * 0.08
  );

  desired = Math.max(desired, Math.min(maxFeasible, strongBoundaryCount + 1));
  if (mediumBoundaryCount >= minFeasible - 1) {
    desired = Math.max(desired, minFeasible);
  }

  const coherenceAssetCap = Math.max(
    minFeasible,
    Math.min(maxFeasible, Math.floor(assetCount / CHAPTER_POLICY.minimumCoherentAssetsPerChapter))
  );
  const coherenceRuntimeCap = Math.max(
    minFeasible,
    Math.min(maxFeasible, Math.floor(estimatedRuntimeSec / CHAPTER_POLICY.minimumCoherentRuntimeSec))
  );
  const coherenceCap = Math.min(coherenceAssetCap, coherenceRuntimeCap);

  return clamp(Math.min(desired, coherenceCap), minFeasible, maxFeasible);
}

function resolveMinimumChapterSize(assetCount: number, desiredChapterCount: number) {
  if (desiredChapterCount <= 1) {
    return assetCount;
  }

  const feasibleMaximum = Math.max(1, Math.floor(assetCount / desiredChapterCount));
  const preferred = Math.max(1, Math.min(8, Math.floor(assetCount / (desiredChapterCount * 2))));
  return Math.min(feasibleMaximum, preferred);
}

function fallbackBoundaryIndexes(assetCount: number, desiredBoundaryCount: number) {
  if (!desiredBoundaryCount) {
    return [];
  }

  const indexes: number[] = [];
  let previousIndex = -1;
  for (let step = 1; step <= desiredBoundaryCount; step += 1) {
    const minimumIndex = previousIndex + 1;
    const remainingBoundaries = desiredBoundaryCount - step;
    const maximumIndex = assetCount - remainingBoundaries - 2;
    const rawIndex = Math.round((assetCount * step) / (desiredBoundaryCount + 1)) - 1;
    const boundaryIndex = clamp(rawIndex, minimumIndex, maximumIndex);
    indexes.push(boundaryIndex);
    previousIndex = boundaryIndex;
  }
  return indexes;
}

function selectBoundaryIndexes(
  candidates: BoundaryCandidate[],
  assetCount: number,
  desiredChapterCount: number
) {
  const desiredBoundaryCount = Math.max(0, desiredChapterCount - 1);
  if (!desiredBoundaryCount) {
    return [];
  }

  const ordered = [...candidates].sort((left, right) => left.afterIndex - right.afterIndex);
  const minimumChapterSize = resolveMinimumChapterSize(assetCount, desiredChapterCount);
  const memo = new Map<string, BoundarySelection | null>();

  function search(
    startIndex: number,
    remainingBoundaries: number,
    previousBoundaryIndex: number
  ): BoundarySelection | null {
    const key = `${startIndex}:${remainingBoundaries}:${previousBoundaryIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }

    if (remainingBoundaries === 0) {
      const tailSize = assetCount - previousBoundaryIndex - 1;
      const result =
        tailSize >= minimumChapterSize
          ? {
              score: 0,
              indexes: []
            }
          : null;
      memo.set(key, result);
      return result;
    }

    let best: BoundarySelection | null = null;
    for (let index = startIndex; index < ordered.length; index += 1) {
      const candidate = ordered[index]!;
      const currentChapterSize = candidate.afterIndex - previousBoundaryIndex;
      if (currentChapterSize < minimumChapterSize) {
        continue;
      }

      const remainingAssets = assetCount - candidate.afterIndex - 1;
      const assetsNeededForTail = remainingBoundaries * minimumChapterSize;
      if (remainingAssets < assetsNeededForTail) {
        break;
      }

      const next = search(index + 1, remainingBoundaries - 1, candidate.afterIndex);
      if (!next) {
        continue;
      }

      const totalScore = candidate.score + next.score;
      if (!best || totalScore > best.score) {
        best = {
          score: totalScore,
          indexes: [candidate.afterIndex, ...next.indexes]
        };
      }
    }

    memo.set(key, best);
    return best;
  }

  return search(0, desiredBoundaryCount, -1)?.indexes ?? fallbackBoundaryIndexes(assetCount, desiredBoundaryCount);
}

function bucketizeAssets(assets: MediaAsset[], boundaryIndexes: number[]) {
  const buckets: MediaAsset[][] = [];
  let startIndex = 0;

  for (const boundaryIndex of boundaryIndexes) {
    buckets.push(assets.slice(startIndex, boundaryIndex + 1));
    startIndex = boundaryIndex + 1;
  }

  if (startIndex < assets.length) {
    buckets.push(assets.slice(startIndex));
  }

  return buckets.filter((bucket) => bucket.length > 0);
}

function fallbackChapterTitle(index: number, chapterAssets: MediaAsset[]) {
  const avgMotion = average(chapterAssets.map((asset) => asset.score?.motion ?? 0));
  const imageRatio =
    chapterAssets.filter((asset) => asset.mediaType === "image").length /
    Math.max(chapterAssets.length, 1);
  const avgBrightness = average(chapterAssets.map((asset) => asset.score?.brightness ?? 0));

  if (avgMotion > 0.52 && imageRatio < 0.4) {
    return "Social Life";
  }
  if (avgBrightness < 0.4 && imageRatio > 0.55) {
    return "Late Night Study";
  }
  if (avgMotion < 0.22 && imageRatio > 0.6) {
    return "Campus Moments";
  }
  if (chapterAssets.length >= 24) {
    return "Big Day Recap";
  }
  return `Chapter ${index + 1}`;
}

export function buildChapters(projectId: string, assets: MediaAsset[]) {
  const ordered = sortAssetsChronologically(assets);
  if (!ordered.length) {
    return [];
  }

  const boundaryCandidates = buildBoundaryCandidates(ordered);
  const desiredChapterCount = estimateDesiredChapterCount(ordered, boundaryCandidates);
  const boundaryIndexes = selectBoundaryIndexes(
    boundaryCandidates,
    ordered.length,
    desiredChapterCount
  );
  const buckets = bucketizeAssets(ordered, boundaryIndexes);

  return ensureUniqueChapterTitles(
    buckets.map((bucket, index) => {
    const startAt = bucket[0]?.metadata.capturedAt;
    const endAt = bucket[bucket.length - 1]?.metadata.capturedAt;
    return {
      id: createId("chapter", 8),
      projectId,
      index,
      title: fallbackChapterTitle(index, bucket),
      labelConfidence: 0.42,
      assetIds: bucket.map((asset) => asset.id),
      startAt,
      endAt,
      stats: {
        totalAssets: bucket.length,
        imageCount: bucket.filter((asset) => asset.mediaType === "image").length,
        videoCount: bucket.filter((asset) => asset.mediaType === "video").length,
        avgScore: average(bucket.map((asset) => asset.score?.total ?? 0)),
        avgMotion: average(bucket.map((asset) => asset.score?.motion ?? 0)),
        spanHours: gapHours(startAt, endAt)
      }
    } satisfies Chapter;
    }),
    "Chapter"
  );
}

export function applyChapterLabels(chapters: Chapter[], labels: PythonChapterLabel[]) {
  const labelMap = new Map(labels.map((label) => [label.chapterId, label]));
  return ensureUniqueChapterTitles(
    chapters.map((chapter) => {
      const label = labelMap.get(chapter.id);
      if (!label) {
        return chapter;
      }
      return {
        ...chapter,
        title: label.title || chapter.title,
        labelConfidence: label.confidence
      };
    }),
    "Chapter"
  );
}
