import assert from "assert";
import { unlink } from "fs/promises";
import os from "os";
import path from "path";

import {
  buildWallFrameRenderPlan,
  buildSimpleWallFrameFallback,
  calculateWallFrameDuration,
  calculateWallSectionTimings,
  listFrameStyleDefinitions,
  listWallStyleDefinitions,
  validateAndRepairWallFramePlan,
  validateWallFrameRenderPlan,
  type WallFrameRenderPlan,
  type WallFrameSourceAsset
} from "@/lib/wall-frame";
import { renderWallFramePlan } from "@/lib/render/wall-frame-render-strategy";

const assets: WallFrameSourceAsset[] = Array.from({ length: 12 }, (_, index) => ({
  id: `asset_${String(index + 1).padStart(2, "0")}`,
  clipId: `clip_${String(index + 1).padStart(2, "0")}`,
  mediaType: index % 3 === 0 ? "video" : "image",
  sourcePath: `C:/fixtures/memory-${String(index + 1).padStart(2, "0")}.${
    index % 3 === 0 ? "mp4" : "jpg"
  }`,
  audioSourcePath: index % 3 === 0 ? `C:/fixtures/memory-${index + 1}.mp4` : undefined,
  durationSec: index % 3 === 0 ? 7 + index / 4 : undefined,
  width: index % 4 === 0 ? 1080 : 1920,
  height: index % 4 === 0 ? 1920 : 1080,
  capturedAt: new Date(Date.UTC(2025, 7, index + 1, 18)).toISOString(),
  uploadOrder: index,
  score: 0.48 + ((index * 13) % 40) / 100,
  caption: `College memory ${index + 1}`,
  hasAudio: index % 3 === 0
}));

const input = {
  projectId: "project_wall_frame_validation",
  title: "A Year on Our Wall",
  assets,
  settings: {
    frameStyle: "mixed-scrapbook" as const,
    wallStyle: "dorm-room-wall" as const,
    cameraMotion: "balanced" as const,
    captionStyle: "memory-captions" as const,
    durationTargetSec: 18
  },
  renderSize: { width: 1280, height: 720, fps: 30 },
  soundtrackPlan: {
    sourcePolicy: "user-uploaded-audio" as const,
    usesInternalFallback: false,
    segments: [
      {
        id: "soundtrack_segment_1",
        soundtrackId: "soundtrack_1",
        sourcePath: "C:/fixtures/song.mp3",
        startSec: 0,
        sourceOffsetSec: 4,
        durationSec: 30,
        crossfadeSec: 0.7,
        volumeDb: -5
      }
    ]
  }
};

const first = buildWallFrameRenderPlan(input);
const second = buildWallFrameRenderPlan(input);
assert.deepStrictEqual(first, second, "Wall Frame planning must be deterministic.");
assert.equal(first.outputType, "wall-frame");
assert.equal(first.validationReport.valid, true);
assert.ok(first.wallSections.length >= 2);
assert.ok(first.wallSections.every((section) => section.frames.length >= 1));
assert.ok(first.wallSections.every((section) => section.frames.length <= 5));

const frameCounts = first.wallSections.map((section) => section.frames.length);
assert.ok(
  Math.max(...frameCounts) - Math.min(...frameCounts) <= 1,
  "Wall clusters should be balanced."
);
const plannedFrames = first.wallSections.flatMap((section) => section.frames);
assert.equal(plannedFrames.length, assets.length);
assert.equal(new Set(plannedFrames.map((frame) => frame.mediaAssetId)).size, assets.length);
assert.ok(
  plannedFrames.every(
    (frame) => assets.find((asset) => asset.id === frame.mediaAssetId)?.clipId === frame.clipId
  ),
  "Every frame must preserve its exact timeline clip identity."
);
assert.ok(plannedFrames.every((frame) => frame.sourcePath.length > 0));
assert.ok(
  plannedFrames.every(
    (frame) =>
      frame.bounds.x >= 0 &&
      frame.bounds.y >= 0 &&
      frame.bounds.x + frame.bounds.width <= 1 &&
      frame.bounds.y + frame.bounds.height <= 1
  )
);

const timings = calculateWallSectionTimings(first.wallSections);
assert.equal(timings[0]?.startSec, 0);
assert.equal(timings.at(-1)?.endSec, first.durationSec);
assert.equal(calculateWallFrameDuration(first.wallSections), first.durationSec);
assert.deepStrictEqual(first.cameraMoves, first.wallSections.map((section) => section.cameraPath));
assert.equal(first.soundtrackPlan.segments[0]?.durationSec, first.durationSec);

assert.deepStrictEqual(
  listFrameStyleDefinitions().map((style) => style.id),
  ["classic-wood", "modern-black", "white-gallery"]
);
assert.equal(listWallStyleDefinitions().length, 4);

const damaged = structuredClone(first) as WallFrameRenderPlan;
damaged.durationSec = 999;
damaged.wallSections[0]!.frames[0]!.bounds = {
  x: -0.4,
  y: 0.9,
  width: 1.4,
  height: 0.6
};
damaged.wallSections[0]!.frames[1]!.bounds = {
  ...damaged.wallSections[0]!.frames[0]!.bounds
};
damaged.wallSections[0]!.cameraPath.start.x = -5;
assert.equal(validateWallFrameRenderPlan(damaged).valid, false);

const repaired = validateAndRepairWallFramePlan(damaged).plan;
assert.equal(repaired.fallbackLevel, "repaired");
assert.equal(repaired.validationReport.valid, true);
assert.ok(repaired.validationReport.repairs.length > 0);
assert.equal(repaired.durationSec, calculateWallFrameDuration(repaired.wallSections));

const simple = buildSimpleWallFrameFallback(repaired);
assert.equal(simple.fallbackLevel, "simple");
assert.equal(simple.validationReport.valid, true);
assert.ok(simple.wallSections.every((section) => section.frames.length === 1));
assert.equal(simple.outputType, "wall-frame", "The fallback must never switch to Diary mode.");

console.log(
  `Wall Frame validation passed: ${first.wallSections.length} balanced sections, ${plannedFrames.length} unique memories, ${first.durationSec.toFixed(
    2
  )}s master.`
);

async function runOptionalRenderSmokeTest() {
  const videoPath = path.resolve(
    "storage/test-media/source-audio-pageflip/20260301_movein.mp4"
  );
  const imagePath = path.resolve(
    "storage/test-media/source-audio-pageflip/20260307_polaroid.png"
  );
  const notesPath = path.resolve(
    "storage/test-media/source-audio-pageflip/20260303_notes.png"
  );
  const dormPath = path.resolve(
    "storage/test-media/source-audio-pageflip/20260301_dorm.png"
  );
  const classwalkPath = path.resolve(
    "storage/test-media/source-audio-pageflip/20260303_classwalk.mp4"
  );
  const nightoutPath = path.resolve(
    "storage/test-media/source-audio-pageflip/20260307_nightout.mp4"
  );
  const musicPath = path.resolve("assets/music/chill/chill-night-drive.wav");
  const outputPath = path.join(os.tmpdir(), `autovlog-wall-frame-smoke-${process.pid}.mp4`);
  const smokePlan = buildWallFrameRenderPlan({
    projectId: "wall_frame_smoke",
    title: "Wall Frame smoke test",
    assets: [
      {
        id: "smoke_video",
        clipId: "smoke_video_clip",
        mediaType: "video",
        sourcePath: videoPath,
        audioSourcePath: videoPath,
        durationSec: 4,
        width: 1280,
        height: 720,
        uploadOrder: 0,
        score: 0.9,
        caption: "Moving in",
        hasAudio: true
      },
      {
        id: "smoke_image",
        clipId: "smoke_image_clip",
        mediaType: "image",
        sourcePath: imagePath,
        width: 1280,
        height: 720,
        uploadOrder: 1,
        score: 0.6,
        caption: "Made it",
        hasAudio: false
      },
      {
        id: "smoke_notes",
        clipId: "smoke_notes_clip",
        mediaType: "image",
        sourcePath: notesPath,
        width: 1280,
        height: 720,
        uploadOrder: 2,
        score: 0.55,
        caption: "Study break",
        hasAudio: false
      },
      {
        id: "smoke_classwalk",
        clipId: "smoke_classwalk_clip",
        mediaType: "video",
        sourcePath: classwalkPath,
        audioSourcePath: classwalkPath,
        durationSec: 4,
        width: 1280,
        height: 720,
        uploadOrder: 3,
        score: 0.8,
        caption: "Across campus",
        hasAudio: true
      },
      {
        id: "smoke_nightout",
        clipId: "smoke_nightout_clip",
        mediaType: "video",
        sourcePath: nightoutPath,
        audioSourcePath: nightoutPath,
        durationSec: 4,
        width: 1280,
        height: 720,
        uploadOrder: 4,
        score: 0.7,
        caption: "After dark",
        hasAudio: true
      },
      {
        id: "smoke_dorm",
        clipId: "smoke_dorm_clip",
        mediaType: "image",
        sourcePath: dormPath,
        width: 1280,
        height: 720,
        uploadOrder: 5,
        score: 0.5,
        caption: "Home base",
        hasAudio: false
      }
    ],
    settings: {
      cameraMotion: "energetic",
      wallStyle: "dorm-room-wall",
      frameStyle: "mixed-scrapbook",
      captionStyle: "memory-captions",
      durationTargetSec: 6.2
    },
    renderSize: { width: 640, height: 360, fps: 24 },
    soundtrackPlan: {
      sourcePolicy: "user-uploaded-audio",
      usesInternalFallback: false,
      segments: [
        {
          id: "smoke_music_segment",
          soundtrackId: "smoke_music",
          sourcePath: musicPath,
          startSec: 0,
          sourceOffsetSec: 0,
          durationSec: 6.2,
          crossfadeSec: 0.25,
          volumeDb: -6
        }
      ]
    }
  });
  const result = await renderWallFramePlan({
    plan: smokePlan,
    outputPath,
    tempRoot: path.join(os.tmpdir(), "autovlog-wall-frame-smoke-temp"),
    timeoutMs: 120_000
  });
  assert.equal(result.outputMetadata.width, 640);
  assert.equal(result.outputMetadata.height, 360);
  assert.ok(result.durationSec >= 5.8);
  await unlink(outputPath).catch(() => undefined);
  console.log(
    `Wall Frame FFmpeg smoke test passed (${result.durationSec.toFixed(2)}s, audio=${result.audioFallback}).`
  );
}

if (process.env.WALL_FRAME_RENDER_SMOKE === "1") {
  void runOptionalRenderSmokeTest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
