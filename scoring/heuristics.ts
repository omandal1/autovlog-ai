import { readdir, stat } from "fs/promises";

import sharp from "sharp";

import type { MediaAsset, ScoreBreakdown } from "@/lib/types";
import { average, clamp } from "@/lib/utils";

interface ImageAnalysis {
  brightness: number;
  contrast: number;
  sharpness: number;
  hash: string;
}

interface AssetMetrics {
  assetId: string;
  brightness: number;
  contrast: number;
  sharpness: number;
  motion: number;
  durationWeight: number;
  representativeHash: string;
}

async function analyzeImageFile(filePath: string): Promise<ImageAnalysis> {
  const { data } = await sharp(filePath)
    .greyscale()
    .resize(64, 64, {
      fit: "cover"
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Array.from(data);
  const mean = average(pixels) / 255;
  const variance = average(pixels.map((value) => Math.pow(value / 255 - mean, 2)));
  let edgeTotal = 0;
  let comparisons = 0;

  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const index = y * 64 + x;
      if (x < 63) {
        edgeTotal += Math.abs(pixels[index] - pixels[index + 1]);
        comparisons += 1;
      }
      if (y < 63) {
        edgeTotal += Math.abs(pixels[index] - pixels[index + 64]);
        comparisons += 1;
      }
    }
  }

  const { data: hashData } = await sharp(filePath)
    .greyscale()
    .resize(8, 8, {
      fit: "cover"
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const hashPixels = Array.from(hashData);
  const hashMean = average(hashPixels);
  const hash = hashPixels.map((pixel) => (pixel > hashMean ? "1" : "0")).join("");

  return {
    brightness: clamp(mean),
    contrast: clamp(Math.sqrt(variance) * 2),
    sharpness: clamp((edgeTotal / Math.max(comparisons, 1)) / 45),
    hash
  };
}

async function pathExists(filePath?: string) {
  if (!filePath) {
    return false;
  }
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function firstExistingPath(paths: Array<string | undefined>) {
  for (const filePath of paths) {
    if (await pathExists(filePath)) {
      return filePath;
    }
  }
  return undefined;
}

function fallbackHash(assetId: string) {
  let hash = 0;
  for (let index = 0; index < assetId.length; index += 1) {
    hash = (hash * 31 + assetId.charCodeAt(index)) >>> 0;
  }
  return Array.from({ length: 64 }, (_, index) => ((hash >> (index % 24)) & 1 ? "1" : "0")).join("");
}

function fallbackMetrics(asset: MediaAsset, motion = 0.12): AssetMetrics {
  return {
    assetId: asset.id,
    brightness: 0.5,
    contrast: 0.28,
    sharpness: 0.34,
    motion,
    durationWeight: 0.62,
    representativeHash: fallbackHash(asset.id)
  };
}

function hasUnsupportedImageFallback(asset: MediaAsset) {
  return asset.analysis?.skipReasons?.some(
    (reason) => reason.label === "Unsupported image format"
  );
}

function hammingDistance(left: string, right: string) {
  const max = Math.max(left.length, right.length);
  let distance = 0;
  for (let index = 0; index < max; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }
  return distance;
}

async function deriveMetrics(asset: MediaAsset): Promise<AssetMetrics> {
  if (asset.mediaType === "image") {
    if (hasUnsupportedImageFallback(asset)) {
      return {
        ...fallbackMetrics(asset, 0.02),
        brightness: 0.42,
        contrast: 0.12,
        sharpness: 0.08,
        durationWeight: 0.2
      };
    }

    const imagePath = await firstExistingPath([
      asset.storage.normalizedPath,
      asset.storage.originalPath,
      asset.storage.thumbnailPath
    ]);
    if (!imagePath) {
      return fallbackMetrics(asset, 0.08);
    }
    const analysis = await analyzeImageFile(imagePath);

    return {
      assetId: asset.id,
      brightness: analysis.brightness,
      contrast: analysis.contrast,
      sharpness: analysis.sharpness,
      motion: 0.08,
      durationWeight: 0.84,
      representativeHash: analysis.hash
    };
  }

  const keyframeDir = asset.storage.keyframeDir;
  const keyframes = keyframeDir
    ? await readdir(keyframeDir)
        .then((files) => files.map((fileName) => `${keyframeDir}/${fileName}`).sort())
        .catch(() => [])
    : [];
  const existingKeyframes: string[] = [];
  for (const keyframe of keyframes.slice(0, 8)) {
    if (await pathExists(keyframe)) {
      existingKeyframes.push(keyframe);
    }
  }
  const fallbackFrame = await firstExistingPath([asset.storage.thumbnailPath]);
  const sampledFrames = existingKeyframes.slice(0, 6);
  const analysisInputs = sampledFrames.length
    ? sampledFrames
    : fallbackFrame
      ? [fallbackFrame]
      : [];
  if (!analysisInputs.length) {
    return fallbackMetrics(asset, asset.metadata.durationSec ? 0.16 : 0.1);
  }
  const analyses = await Promise.all(
    analysisInputs.map((item) =>
      analyzeImageFile(item).catch(() => ({
        brightness: 0.5,
        contrast: 0.28,
        sharpness: 0.34,
        hash: fallbackHash(`${asset.id}:${item}`)
      }))
    )
  );

  const motion =
    analyses.length > 1
      ? clamp(
          average(
            analyses.slice(1).map((analysis, index) => {
              const previous = analyses[index];
              return hammingDistance(previous.hash, analysis.hash) / 64;
            })
          ) * 1.7
        )
      : 0.16;

  const duration = asset.metadata.durationSec ?? 4;
  const ideal = 7;
  const durationWeight = clamp(1 - Math.abs(duration - ideal) / 12);

  return {
    assetId: asset.id,
    brightness: average(analyses.map((analysis) => analysis.brightness)),
    contrast: average(analyses.map((analysis) => analysis.contrast)),
    sharpness: average(analyses.map((analysis) => analysis.sharpness)),
    motion,
    durationWeight,
    representativeHash: analyses[Math.floor(analyses.length / 2)]?.hash ?? analyses[0].hash
  };
}

function mergeBreakdown(metrics: AssetMetrics, uniqueness: number, aiBoost = 0, faceHint = 0) {
  const breakdown: ScoreBreakdown = {
    visualClarity: metrics.sharpness,
    brightness: metrics.brightness,
    contrast: metrics.contrast,
    motion: metrics.motion,
    uniqueness,
    faceHint,
    durationWeight: metrics.durationWeight,
    aiBoost,
    total: 0
  };

  breakdown.total = clamp(
    breakdown.visualClarity * 0.24 +
      breakdown.brightness * 0.12 +
      breakdown.contrast * 0.1 +
      breakdown.motion * 0.16 +
      breakdown.uniqueness * 0.18 +
      breakdown.durationWeight * 0.12 +
      breakdown.faceHint * 0.04 +
      breakdown.aiBoost * 0.04
  );

  return breakdown;
}

export async function scoreAssetsWithHeuristics(assets: MediaAsset[]) {
  const metrics = await Promise.all(assets.map((asset) => deriveMetrics(asset)));

  return assets.map((asset, index) => {
    const metric = metrics[index];
    const distances = metrics
      .filter((candidate) => candidate.assetId !== asset.id)
      .map((candidate) =>
        hammingDistance(metric.representativeHash, candidate.representativeHash) / 64
      );

    const uniqueness = hasUnsupportedImageFallback(asset)
      ? 0.05
      : clamp((Math.min(...distances, 0.4) || 0.4) / 0.4);
    return {
      ...asset,
      fingerprints: {
        averageHash: metric.representativeHash
      },
      score: mergeBreakdown(metric, uniqueness)
    };
  });
}

export function mergePythonSuggestions(
  assets: MediaAsset[],
  suggestions: Array<{
    assetId: string;
    qualityBoost: number;
    semanticHint?: string;
    faceHint?: number;
  }>
) {
  const suggestionMap = new Map(suggestions.map((item) => [item.assetId, item]));
  return assets.map((asset) => {
    const suggestion = suggestionMap.get(asset.id);
    if (!suggestion || !asset.score) {
      return asset;
    }

    const aiBoost = clamp(suggestion.qualityBoost);
    const faceHint = clamp(suggestion.faceHint ?? asset.score.faceHint);
    const score = {
      ...asset.score,
      aiBoost,
      faceHint
    };

    score.total = clamp(
      score.visualClarity * 0.24 +
        score.brightness * 0.12 +
        score.contrast * 0.1 +
        score.motion * 0.16 +
        score.uniqueness * 0.18 +
        score.durationWeight * 0.12 +
        score.faceHint * 0.04 +
        score.aiBoost * 0.04
    );

    return {
      ...asset,
      score,
      analysis: {
        ...asset.analysis,
        semanticHint: suggestion.semanticHint
      }
    };
  });
}
