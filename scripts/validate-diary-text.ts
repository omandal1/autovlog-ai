import assert from "assert";

import { generateDiaryPageText } from "@/lib/book/diary-text-generator";

function makeClip(overrides: Record<string, unknown> = {}) {
  return {
    id: "clip_test",
    assetId: "asset_test",
    chapterId: "chapter_test",
    mediaType: "video",
    sourcePath: "random_video123.mp4",
    trimStartSec: 0,
    trimDurationSec: 4,
    displayDurationSec: 4,
    score: 0.72,
    filename: "random_video123.mp4",
    sceneTags: ["dog", "person"],
    ...overrides
  } as any;
}

function makeAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset_test",
    projectId: "project_test",
    filename: "random_video123.mp4",
    mediaType: "video",
    uploadOrder: 0,
    storage: {
      originalPath: "random_video123.mp4",
      thumbnailPath: "thumb.jpg"
    },
    metadata: {
      durationSec: 4,
      width: 1280,
      height: 720,
      capturedAt: "2026-05-02T20:00:00.000Z"
    },
    score: {
      total: 0.78,
      motion: 0.5,
      brightness: 0.55,
      contrast: 0.5,
      faceHint: 0.72
    },
    analysis: {
      semanticHint: "dog",
      faceCluster: {
        faceLike: true,
        faceScore: 0.7,
        recurrenceCount: 1,
        role: "support"
      },
      transcriptResult: {
        text: "Random Video",
        snippet: "Random Video",
        confidence: 0.12,
        dialogueScore: 0,
        source: "heuristic",
        events: []
      },
      dialogueEvents: []
    },
    ...overrides
  } as any;
}

const filenameCase = generateDiaryPageText({
  clips: [makeClip()],
  assets: [makeAsset()],
  chapterTitle: "Chapter 2",
  pageIndex: 0,
  vibe: {
    primary: "friends",
    vibe: "chill",
    confidence: 0.6,
    tags: ["friends"],
    signals: []
  }
});

assert.match(filenameCase.toLowerCase(), /dog|person|people/);
assert.doesNotMatch(filenameCase, /random_video123|random video123|img_|clip_001/i);

const fallbackCase = generateDiaryPageText({
  clips: [makeClip({ sceneTags: [], transcriptText: "IMG 4821", filename: "IMG_4821.MOV" })],
  assets: [makeAsset({ filename: "IMG_4821.MOV", analysis: { transcriptResult: { source: "none", confidence: 0, dialogueScore: 0, events: [] } } })],
  chapterTitle: "Chapter 2",
  pageIndex: 1
});

assert.doesNotMatch(fallbackCase, /IMG|4821|random|video123/i);
assert.match(fallbackCase, /worth saving|real moments|felt/i);

const transcriptCase = generateDiaryPageText({
  clips: [makeClip({ sceneTags: ["friends", "food"] })],
  assets: [
    makeAsset({
      analysis: {
        semanticHint: "friends",
        transcriptResult: {
          text: "Everyone was laughing about the late pizza.",
          snippet: "Everyone was laughing about the late pizza.",
          confidence: 0.82,
          dialogueScore: 0.74,
          source: "sidecar",
          events: ["laughter"]
        },
        dialogueEvents: ["laughter"]
      }
    })
  ],
  chapterTitle: "Social Life",
  pageIndex: 2
});

assert.match(transcriptCase, /laughing|pizza/i);
assert.doesNotMatch(transcriptCase, /random_video123|IMG_4821/i);

console.log("Diary text validation passed.");

