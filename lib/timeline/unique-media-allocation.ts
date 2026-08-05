import type { BookPage, MediaAsset, TimelineClip } from "@/lib/types";

export function dedupeTimelineClips(clips: TimelineClip[]) {
  const seen = new Set<string>();
  const removedAssetIds: string[] = [];
  const unique = clips.filter((clip) => {
    if (seen.has(clip.assetId)) {
      removedAssetIds.push(clip.assetId);
      return false;
    }
    seen.add(clip.assetId);
    return true;
  });

  return {
    clips: unique,
    removedAssetIds
  };
}

export function collectBookPageAssetIds(pages: BookPage[]) {
  return [
    ...new Set(
      pages
        .filter((page) => page.kind !== "cover")
        .flatMap((page) => page.slots.map((slot) => slot.assetId))
    )
  ];
}

export function dedupeBookPages(pages: BookPage[]) {
  const seen = new Set<string>();
  const removedAssetIds: string[] = [];

  return {
    pages: pages
      .map((page) => {
        if (!page.slots.length) {
          return page;
        }
        if (page.kind === "cover") {
          return page;
        }

        const slots = page.slots.filter((slot) => {
          if (seen.has(slot.assetId)) {
            removedAssetIds.push(slot.assetId);
            return false;
          }
          seen.add(slot.assetId);
          return true;
        });

        return {
          ...page,
          slots
        };
      })
      .filter((page) => page.kind !== "content" || page.slots.length > 0),
    removedAssetIds
  };
}

export function buildUnusedAssetPool(
  assets: MediaAsset[],
  selectedAssetIds: Iterable<string>
) {
  const used = new Set(selectedAssetIds);
  return assets.filter((asset) => !used.has(asset.id));
}

export function extendSelectionWithUniqueCandidates(options: {
  selectedAssets: MediaAsset[];
  candidateAssets: MediaAsset[];
  targetDurationSec: number;
  estimateDuration: (asset: MediaAsset) => number;
}) {
  const selected = [...options.selectedAssets];
  const selectedIds = new Set(selected.map((asset) => asset.id));
  let durationSec = selected.reduce(
    (sum, asset) => sum + options.estimateDuration(asset),
    0
  );

  for (const asset of options.candidateAssets) {
    if (selectedIds.has(asset.id)) {
      continue;
    }
    if (durationSec >= options.targetDurationSec - 0.1) {
      break;
    }
    selected.push(asset);
    selectedIds.add(asset.id);
    durationSec += options.estimateDuration(asset);
  }

  return selected;
}

export function hasDuplicateAssetUsage(assetIds: Iterable<string>) {
  const seen = new Set<string>();
  for (const assetId of assetIds) {
    if (seen.has(assetId)) {
      return true;
    }
    seen.add(assetId);
  }
  return false;
}
