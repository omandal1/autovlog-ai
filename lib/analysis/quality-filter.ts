import { DUPLICATE_POLICY } from "@/lib/constants";
import { transcriptContentText } from "@/lib/analysis/content-text";
import type { MediaAsset, MediaImportanceTier, SelectionReason, SkipReason } from "@/lib/types";

function resolveTier(asset: MediaAsset): MediaImportanceTier {
  if (asset.userState?.excluded) {
    return "excluded";
  }
  if (asset.userState?.pinned) {
    return "hero";
  }

  const score = asset.score?.total ?? 0;
  if (score >= DUPLICATE_POLICY.heroScoreThreshold) {
    return "hero";
  }
  if (score >= DUPLICATE_POLICY.strongScoreThreshold) {
    return "strong";
  }
  if (score >= DUPLICATE_POLICY.weakScoreThreshold) {
    return "usable";
  }
  return "weak";
}

function buildReasons(asset: MediaAsset, tier: MediaImportanceTier) {
  const selectionReasons: SelectionReason[] = [];
  const skipReasons: SkipReason[] = [];

  if (asset.userState?.pinned) {
    selectionReasons.push({
      kind: "user-pinned",
      label: "Pinned by user",
      detail: "This clip is preserved aggressively across variants.",
      weight: 1
    });
  }

  if (asset.analysis?.duplicateAnalysis?.isDuplicate && !asset.userState?.pinned) {
    skipReasons.push({
      kind: "duplicate",
      label: "Marked as duplicate",
      detail: "A stronger similar moment exists in this sequence."
    });
  }

  if (tier === "weak") {
    skipReasons.push({
      kind: "weak-quality",
      label: "Weak visual quality",
      detail: "Lower score for clarity, contrast, or uniqueness."
    });
  }

  if (tier === "hero" || tier === "strong") {
    selectionReasons.push({
      kind: "strong-visual-quality",
      label: tier === "hero" ? "Hero-quality memory" : "Strong visual moment",
      detail: `Composite quality score ${Math.round((asset.score?.total ?? 0) * 100)}%.`,
      weight: tier === "hero" ? 0.92 : 0.7
    });
  }

  if (asset.analysis?.faceCluster?.recurrenceCount && asset.analysis.faceCluster.recurrenceCount >= 3) {
    selectionReasons.push({
      kind: "recurring-friend-group",
      label: "Recurring friend group",
      detail: `Appears across ${asset.analysis.faceCluster.recurrenceCount} moments.`,
      weight: 0.66
    });
  }

  const transcriptSnippet = transcriptContentText(asset.analysis?.transcriptResult);
  if (transcriptSnippet && (asset.analysis?.transcriptResult?.dialogueScore ?? 0) >= 0.45) {
    selectionReasons.push({
      kind: "memorable-dialogue",
      label: "Memorable dialogue",
      detail: transcriptSnippet,
      weight: asset.analysis?.transcriptResult?.dialogueScore
    });
  }

  return {
    selectionReasons,
    skipReasons
  };
}

export function applyQualityTiers(assets: MediaAsset[]) {
  return assets.map((asset) => {
    const tier = resolveTier(asset);
    const reasons = buildReasons(asset, tier);
    return {
      ...asset,
      analysis: {
        ...asset.analysis,
        qualityTier: tier,
        selectionReasons: [
          ...(asset.analysis?.selectionReasons ?? []),
          ...reasons.selectionReasons
        ],
        skipReasons: [
          ...(asset.analysis?.skipReasons ?? []),
          ...reasons.skipReasons,
          ...(asset.userState?.excluded
            ? [
                {
                  kind: "excluded-by-user",
                  label: "Excluded by user",
                  detail: "This media will never appear in a generated output."
                } satisfies SkipReason
              ]
            : [])
        ]
      }
    };
  });
}
