import type {
  BatchAnalyzeRequest,
  BatchAnalyzeResponse,
  Chapter,
  LabelChapterRequest,
  LabelChapterResponse,
  MediaAsset,
  TranscribeBatchRequest,
  TranscribeBatchResponse
} from "@/lib/types";
import { average } from "@/lib/utils";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8001";

async function postJson<TResponse>(pathname: string, body: unknown) {
  const response = await fetch(`${PYTHON_SERVICE_URL}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Python service responded with ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

export async function requestPythonSuggestions(assets: MediaAsset[]) {
  const request: BatchAnalyzeRequest = {
    projectId: assets[0]?.projectId ?? "unknown",
    assets: assets.map((asset) => ({
      id: asset.id,
      mediaType: asset.mediaType,
      thumbnailPath: asset.storage.thumbnailPath,
      proxyPath: asset.storage.proxyPath,
      brightness: asset.score?.brightness ?? 0,
      contrast: asset.score?.contrast ?? 0,
      sharpness: asset.score?.visualClarity ?? 0,
      motion: asset.score?.motion ?? 0,
      uniqueness: asset.score?.uniqueness ?? 0,
      durationSec: asset.metadata.durationSec ?? 3
    }))
  };

  try {
    const response = await postJson<BatchAnalyzeResponse>("/analyze/batch", request);
    return response.suggestions;
  } catch {
    return [];
  }
}

export async function requestChapterLabels(chapters: Chapter[], assets: MediaAsset[]) {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const request: LabelChapterRequest = {
    projectId: chapters[0]?.projectId ?? "unknown",
    chapters: chapters.map((chapter) => {
      const chapterAssets = chapter.assetIds
        .map((assetId) => assetMap.get(assetId))
        .filter((asset): asset is MediaAsset => Boolean(asset));
      return {
        chapterId: chapter.id,
        avgMotion: average(chapterAssets.map((asset) => asset.score?.motion ?? 0)),
        imageRatio:
          chapterAssets.length === 0
            ? 0
            : chapterAssets.filter((asset) => asset.mediaType === "image").length /
              chapterAssets.length,
        videoRatio:
          chapterAssets.length === 0
            ? 0
            : chapterAssets.filter((asset) => asset.mediaType === "video").length /
              chapterAssets.length,
        avgBrightness: average(chapterAssets.map((asset) => asset.score?.brightness ?? 0)),
        spanHours: chapter.stats.spanHours,
        size: chapter.assetIds.length
      };
    })
  };

  try {
    const response = await postJson<LabelChapterResponse>("/label/chapters", request);
    return response.labels;
  } catch {
    return [];
  }
}

export async function requestTranscriptions(assets: MediaAsset[]) {
  const transcribable = assets.filter(
    (asset) => asset.mediaType === "video" && Boolean(asset.storage.originalPath)
  );
  if (!transcribable.length) {
    return [];
  }

  const request: TranscribeBatchRequest = {
    projectId: assets[0]?.projectId ?? "unknown",
    assets: transcribable.map((asset) => ({
      assetId: asset.id,
      mediaType: asset.mediaType,
      originalPath: asset.storage.originalPath,
      durationSec: asset.metadata.durationSec ?? 0
    }))
  };

  try {
    const response = await postJson<TranscribeBatchResponse>("/transcribe/batch", request);
    return response.transcriptions;
  } catch {
    return [];
  }
}
