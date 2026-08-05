import { readFile } from "fs/promises";
import path from "path";

import { normalizeContentText } from "@/lib/analysis/content-text";
import type { MediaAsset, TranscriptResult } from "@/lib/types";

import { requestTranscriptions } from "@/scoring/python-service";

function scoreDialogue(result: TranscriptResult) {
  if (result.source === "none" || result.source === "heuristic") {
    return 0;
  }
  const eventBonus = result.events.some((event) =>
    ["laughter", "cheering", "crowd", "applause"].includes(event)
  )
    ? 0.2
    : 0;
  const textBonus = result.text ? Math.min(0.35, result.text.length / 180) : 0;
  return Math.max(result.dialogueScore, Math.min(1, textBonus + eventBonus + result.confidence * 0.4));
}

async function readSidecarTranscript(asset: MediaAsset) {
  const basePath = asset.storage.originalPath.slice(
    0,
    asset.storage.originalPath.length - path.extname(asset.storage.originalPath).length
  );
  for (const extension of [".txt", ".srt", ".vtt"]) {
    try {
      const text = (await readFile(`${basePath}${extension}`, "utf8")).trim();
      if (text) {
        return {
          text,
          snippet: text.split(/\s+/).slice(0, 12).join(" "),
          confidence: 0.72,
          dialogueScore: 0.62,
          source: "sidecar" as const,
          events: []
        };
      }
    } catch {
      // Ignore missing sidecars.
    }
  }
  return undefined;
}

export async function enrichAssetsWithTranscription(assets: MediaAsset[]) {
  const pythonTranscriptions = await requestTranscriptions(assets);
  const transcriptionMap = new Map(pythonTranscriptions.map((item) => [item.assetId, item]));
  const nextAssets: MediaAsset[] = [];

  for (const asset of assets) {
    const pythonResult = transcriptionMap.get(asset.id);
    const sidecar = asset.mediaType === "video" ? await readSidecarTranscript(asset) : undefined;
    const transcriptResult: TranscriptResult =
      sidecar ??
      (pythonResult && pythonResult.source !== "heuristic"
        ? {
            text: normalizeContentText(pythonResult.text),
            snippet: normalizeContentText(pythonResult.snippet),
            confidence: pythonResult.confidence,
            dialogueScore: pythonResult.confidence,
            source: pythonResult.source,
            events: pythonResult.events
          }
        : {
            text: undefined,
            snippet: undefined,
            confidence: 0,
            dialogueScore: 0,
            source: "none",
            events: []
          });

    transcriptResult.dialogueScore = scoreDialogue(transcriptResult);

    nextAssets.push({
      ...asset,
      analysis: {
        ...asset.analysis,
        transcript: transcriptResult.text ?? asset.analysis?.transcript,
        transcriptResult,
        dialogueEvents: transcriptResult.events
      }
    });
  }

  return nextAssets;
}
