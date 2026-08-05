import { createId } from "@/lib/ids";
import type { FaceClusterResult, MediaAsset } from "@/lib/types";

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

function faceLikeScore(asset: MediaAsset) {
  return Math.max(
    asset.score?.faceHint ?? 0,
    asset.analysis?.transcriptResult?.dialogueScore ? 0.15 : 0
  );
}

export function clusterRecurringFaces(assets: MediaAsset[]) {
  const candidates = assets.filter(
    (asset) =>
      !asset.userState?.excluded &&
      faceLikeScore(asset) >= 0.24 &&
      Boolean(asset.fingerprints?.averageHash)
  );

  const clusterAssignments = new Map<string, FaceClusterResult>();
  const clusters: Array<{ id: string; assetIds: string[]; leader: MediaAsset }> = [];

  for (const asset of candidates) {
    const match = clusters.find((cluster) => {
      const distance = hammingDistance(
        asset.fingerprints?.averageHash,
        cluster.leader.fingerprints?.averageHash
      );
      return distance <= 10;
    });

    if (match) {
      match.assetIds.push(asset.id);
      continue;
    }

    clusters.push({
      id: createId("face", 8),
      assetIds: [asset.id],
      leader: asset
    });
  }

  for (const cluster of clusters) {
    const recurrenceCount = cluster.assetIds.length;
    for (const assetId of cluster.assetIds) {
      clusterAssignments.set(assetId, {
        clusterId: cluster.id,
        faceLike: true,
        faceScore: recurrenceCount >= 3 ? 0.72 : 0.4,
        recurrenceCount,
        role:
          recurrenceCount >= 5 ? "lead" : recurrenceCount >= 3 ? "recurring" : "support"
      });
    }
  }

  return assets.map((asset) => ({
    ...asset,
    analysis: {
      ...asset.analysis,
      faceCluster:
        clusterAssignments.get(asset.id) ??
        ({
          faceLike: false,
          faceScore: faceLikeScore(asset),
          recurrenceCount: 0,
          role: "none"
        } satisfies FaceClusterResult)
    }
  }));
}
