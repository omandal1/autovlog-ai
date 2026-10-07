import assert from "node:assert/strict";

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/constants";
import {
  enrichAssetsWithEditorialAnalysis,
  planEditorialSequence
} from "@/lib/editorial/editorial-planner";
import { createStoryPlan } from "@/lib/story/story-planner";
import type { Chapter, MediaAsset, ProjectRecord } from "@/lib/types";
import { buildProjectTimelines } from "@/timeline/generator";

function asset(index: number, count: number): MediaAsset {
  const isHook = index === Math.floor(count * 0.72);
  const isDuplicate = index > 0 && index % 17 === 0;
  const mediaType = index % 3 === 0 ? "video" as const : "image" as const;
  return {
    id: `asset-${String(index).padStart(3, "0")}`,
    projectId: "editorial-test",
    filename: `${index}-${isHook ? "friends-laughing-concert" : index % 5 === 0 ? "campus-walk" : "memory"}.${mediaType === "video" ? "mp4" : "jpg"}`,
    mediaType,
    uploadOrder: index,
    storage: {
      originalPath: `D:/editorial-fixtures/${index}.${mediaType === "video" ? "mp4" : "jpg"}`,
      thumbnailPath: `D:/editorial-fixtures/${index}.jpg`,
      proxyPath: mediaType === "video" ? `D:/editorial-fixtures/${index}-proxy.mp4` : undefined,
      normalizedPath: mediaType === "image" ? `D:/editorial-fixtures/${index}-normalized.jpg` : undefined
    },
    metadata: {
      capturedAt: new Date(Date.UTC(2026, 2, 1, 10, index)).toISOString(),
      capturedAtSource: "exif",
      durationSec: mediaType === "video" ? 18 + (index % 8) : undefined,
      width: index % 4 === 0 ? 720 : 1280,
      height: index % 4 === 0 ? 1280 : 720,
      extension: mediaType === "video" ? ".mp4" : ".jpg",
      mimeType: mediaType === "video" ? "video/mp4" : "image/jpeg",
      byteSize: 50_000
    },
    score: {
      visualClarity: isHook ? 0.94 : 0.55 + (index % 4) * 0.07,
      brightness: index % 6 === 0 ? 0.78 : 0.42,
      contrast: isHook ? 0.88 : 0.48,
      motion: isHook ? 0.96 : mediaType === "video" ? 0.42 : 0.08,
      uniqueness: isDuplicate ? 0.05 : isHook ? 0.98 : 0.62,
      faceHint: isHook ? 0.9 : index % 4 === 0 ? 0.55 : 0.1,
      durationWeight: 0.7,
      aiBoost: 0,
      total: isHook ? 0.95 : 0.61
    },
    analysis: {
      qualityTier: isHook ? "hero" : "strong",
      semanticHint: isHook ? "friends laughing at a concert" : index % 5 === 0 ? "campus walk" : undefined,
      transcriptResult: mediaType === "video" ? {
        text: isHook ? "We finally made it!" : index % 9 === 0 ? "Here is where we are going." : undefined,
        snippet: isHook ? "We finally made it" : undefined,
        confidence: isHook ? 0.92 : index % 9 === 0 ? 0.68 : 0,
        dialogueScore: isHook ? 0.9 : index % 9 === 0 ? 0.6 : 0,
        source: isHook || index % 9 === 0 ? "sidecar" : "none",
        events: isHook ? ["laughter", "cheering"] : []
      } : undefined,
      duplicateAnalysis: {
        kind: isDuplicate ? "near-duplicate" : "none",
        similarityScore: isDuplicate ? 0.94 : 0,
        isDuplicate,
        keeperAssetId: isDuplicate ? `asset-${String(index - 1).padStart(3, "0")}` : undefined
      },
      faceCluster: {
        clusterId: index % 4 === 0 ? "friends" : undefined,
        faceLike: isHook || index % 4 === 0,
        faceScore: isHook ? 0.92 : index % 4 === 0 ? 0.58 : 0,
        recurrenceCount: index % 4 === 0 ? 5 : 0,
        role: isHook ? "lead" : index % 4 === 0 ? "recurring" : "none"
      },
      selectionReasons: [],
      skipReasons: isDuplicate ? [{ kind: "duplicate", label: "Near duplicate" }] : []
    }
  };
}

function projectWithAssets(assets: MediaAsset[]): ProjectRecord {
  const chapter: Chapter = {
    id: "chapter-1",
    projectId: "editorial-test",
    index: 0,
    title: "The Day",
    labelConfidence: 0.7,
    assetIds: assets.map((item) => item.id),
    stats: {
      totalAssets: assets.length,
      imageCount: assets.filter((item) => item.mediaType === "image").length,
      videoCount: assets.filter((item) => item.mediaType === "video").length,
      avgScore: 0.65,
      avgMotion: 0.35,
      spanHours: 8
    }
  };
  return {
    id: "editorial-test",
    name: "Editorial Test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "processing",
    stage: "timeline",
    settings: {
      tone: "balanced",
      clipDensity: "fast-cuts",
      musicStyle: "cinematic",
      generation: { ...DEFAULT_GENERATION_SETTINGS, ordering: "mostly-chronological" }
    },
    assetCount: assets.length,
    assets,
    chapters: [chapter],
    outputs: [],
    timelinePaths: { chapters: [] }
  };
}

function runScenario(count: number) {
  const started = performance.now();
  const analyzed = enrichAssetsWithEditorialAnalysis(
    Array.from({ length: count }, (_, index) => asset(index, count))
  );
  const sequence = planEditorialSequence(analyzed);
  const expectedHook = `asset-${String(Math.floor(count * 0.72)).padStart(3, "0")}`;
  assert.equal(sequence[0]?.id, expectedHook, "the opening hook must be selected from later footage");
  assert.ok(sequence.every((item) => !item.analysis?.duplicateAnalysis?.isDuplicate));
  assert.ok(analyzed.some((item) => (item.analysis?.editorial?.candidateSegments[0]?.startTime ?? 0) > 0));

  let project = projectWithAssets(analyzed);
  project = { ...project, storyPlan: createStoryPlan(project) };
  const built = buildProjectTimelines(project);
  assert.equal(built.masterTimeline.clips[0]?.assetId, expectedHook);
  assert.ok(built.masterTimeline.editDecisionList?.hookSegment);
  assert.ok((built.masterTimeline.editDecisionList?.scenes[0]?.clips.length ?? 0) > 0);
  assert.ok(
    new Set(built.masterTimeline.clips.map((clip) => clip.shotType)).size >= 3,
    "timeline should contain shot-scale variety"
  );
  assert.ok(
    built.masterTimeline.clips.every(
      (clip) =>
        clip.mediaType === "image" ||
        clip.trimStartSec + clip.trimDurationSec <= (clip.sourceDurationSec ?? Number.POSITIVE_INFINITY) + 0.001
    ),
    "video decisions must never extend beyond source duration"
  );
  return performance.now() - started;
}

const smallMs = runScenario(36);
const hundredMs = runScenario(100);
const threeHundredMs = runScenario(300);
assert.ok(threeHundredMs < 2_000, `300-item editorial planning took too long: ${threeHundredMs.toFixed(1)}ms`);

console.log(
  `Editorial planner validation passed: 36=${smallMs.toFixed(1)}ms, 100=${hundredMs.toFixed(1)}ms, 300=${threeHundredMs.toFixed(1)}ms.`
);
