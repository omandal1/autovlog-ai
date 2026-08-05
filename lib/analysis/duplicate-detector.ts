import { DUPLICATE_POLICY } from "@/lib/constants";
import type { DuplicateAnalysis, MediaAsset, SkipReason } from "@/lib/types";

function hammingDistance(left?: string, right?: string) {
  if (!left || !right) {
    return 64;
  }
  const max = Math.max(left.length, right.length);
  let distance = 0;
  for (let index = 0; index < max; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }
  return distance;
}

function gapMinutes(left?: string, right?: string) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(new Date(right).getTime() - new Date(left).getTime()) / (1000 * 60);
}

function buildDuplicateAnalysis(
  asset: MediaAsset,
  keeper: MediaAsset | undefined,
  kind: DuplicateAnalysis["kind"],
  similarityScore: number
): DuplicateAnalysis {
  return {
    clusterId: keeper ? `${keeper.id}:${kind}` : undefined,
    kind,
    similarityScore,
    keeperAssetId: keeper?.id,
    isDuplicate: Boolean(keeper && keeper.id !== asset.id)
  };
}

export function analyzeDuplicateMedia(assets: MediaAsset[]) {
  const ordered = [...assets].sort((left, right) =>
    (left.metadata.capturedAt ?? "").localeCompare(right.metadata.capturedAt ?? "")
  );
  const analyses = new Map<string, DuplicateAnalysis>();
  const skipReasons = new Map<string, SkipReason[]>();

  for (let index = 0; index < ordered.length; index += 1) {
    const asset = ordered[index]!;
    const assetHash = asset.fingerprints?.averageHash;
    let bestKeeper: MediaAsset | undefined;
    let bestKind: DuplicateAnalysis["kind"] = "none";
    let bestSimilarity = 0;

    for (let compareIndex = 0; compareIndex < index; compareIndex += 1) {
      const candidate = ordered[compareIndex]!;
      const distance = hammingDistance(assetHash, candidate.fingerprints?.averageHash);
      const similarity = Math.max(0, 1 - distance / 64);
      const minuteGap = gapMinutes(asset.metadata.capturedAt, candidate.metadata.capturedAt);
      const sameBurst = minuteGap <= DUPLICATE_POLICY.burstMinutes;

      if (distance <= DUPLICATE_POLICY.exactHashDistance) {
        bestKeeper = (candidate.score?.total ?? 0) >= (asset.score?.total ?? 0) ? candidate : asset;
        bestKind = sameBurst ? "burst" : "exact";
        bestSimilarity = similarity;
        break;
      }

      if (distance <= DUPLICATE_POLICY.nearHashDistance && similarity > bestSimilarity) {
        bestKeeper = (candidate.score?.total ?? 0) >= (asset.score?.total ?? 0) ? candidate : asset;
        bestKind = sameBurst ? "burst" : "near-duplicate";
        bestSimilarity = similarity;
      }
    }

    analyses.set(asset.id, buildDuplicateAnalysis(asset, bestKeeper, bestKind, bestSimilarity));
    if (bestKeeper && bestKeeper.id !== asset.id) {
      skipReasons.set(asset.id, [
        {
          kind: "duplicate",
          label: bestKind === "burst" ? "Burst duplicate" : "Duplicate of a stronger similar shot",
          detail: `Closest keeper: ${bestKeeper.filename}`
        }
      ]);
    }
  }

  return assets.map((asset) => ({
    ...asset,
    analysis: {
      ...asset.analysis,
      duplicateAnalysis: analyses.get(asset.id)
    }
  }));
}
