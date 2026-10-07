import assert from "assert";
import { mkdir, rm } from "fs/promises";
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
    transitionEnergy: "high" as const,
    captionStyle: "memory-captions" as const,
    frameVariety: "high" as const,
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
const defaultEnergy = buildWallFrameRenderPlan({
  ...input,
  settings: { ...input.settings, transitionEnergy: undefined }
});
const gentleEnergy = buildWallFrameRenderPlan({
  ...input,
  settings: { ...input.settings, transitionEnergy: "gentle" as const }
});
if (!defaultEnergy.validationReport.valid) {
  console.error(JSON.stringify(defaultEnergy.validationReport.errors, null, 2));
}
assert.deepStrictEqual(first, second, "Wall Frame planning must be deterministic.");
assert.equal(defaultEnergy.validationReport.valid, true);
assert.equal(defaultEnergy.settings.transitionEnergy, "balanced");
assert.equal(gentleEnergy.settings.transitionEnergy, "gentle");
assert.ok(
  gentleEnergy.motionBeats[0]!.cameraTransformEnd.scale <
    first.motionBeats[0]!.cameraTransformEnd.scale,
  "Transition energy must affect the real camera transforms."
);
assert.equal(first.outputType, "wall-frame");
assert.equal(first.validationReport.valid, true);
assert.ok(first.wallSections.length >= 2);
assert.ok(first.wallSections.every((section) => section.frames.length >= 1));
assert.ok(first.wallSections.every((section) => section.frames.length <= 8));

const plannedFrames = first.wallSections.flatMap((section) => section.frames);
assert.equal(new Set(plannedFrames.map((frame) => frame.mediaAssetId)).size, assets.length);
const heroFrames = plannedFrames.filter((frame) => frame.role === "hero");
assert.equal(new Set(heroFrames.map((frame) => frame.mediaAssetId)).size, assets.length);
assert.equal(first.selectedMasterMedia.length, assets.length);
assert.equal(first.coverageMetrics.heroCoverageRatio, 1);
assert.equal(first.coverageMetrics.heroCoveredMediaCount, assets.length);
assert.equal(first.coverageMetrics.maxHeroAppearancesForSingleAsset, 1);
assert.ok(first.coverageMetrics.uniqueFrameStylesUsed >= 3);
assert.ok(first.coverageMetrics.uniqueFrameShapesUsed >= 4);
assert.ok(
  first.mediaCoverage.some(
    (coverage) =>
      coverage.firstHeroSceneIndex !== undefined &&
      coverage.lastSupportingSceneIndex !== undefined &&
      coverage.lastSupportingSceneIndex < coverage.firstHeroSceneIndex
  ),
  "At least one supporting memory must be foreshadowed before being promoted to hero."
);
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
assert.deepStrictEqual(
  first.motionBeats,
  first.wallSections.flatMap((section) => section.motionBeats)
);
const motionTypes = new Set(first.motionBeats.map((beat) => beat.type));
for (const required of [
  "wall-reveal",
  "hero-push-in",
  "hero-focus-hold",
  "frame-flip",
  "whip-pan",
  "multi-frame-pass-by",
  "final-wall-reveal"
]) {
  assert.ok(motionTypes.has(required as never), `Missing required Wall Frame motion: ${required}`);
}
assert.ok(
  first.wallSections.every((section) =>
    section.motionBeats.every(
      (beat, index, beats) => index === 0 || beat.startTimeSec - beats[index - 1]!.startTimeSec <= 6
    )
  ),
  "Meaningful motion must occur at least every six seconds."
);
assert.ok(
  first.wallSections.slice(0, -1).every((section) => section.transitionToNext?.type !== undefined),
  "Every wall-section transition must be motion based."
);
assert.ok((first.soundtrackPlan.segments[0]?.durationSec ?? 0) <= first.durationSec);
assert.ok(first.soundtrackPlan.segments.length > 1, "A short uploaded song must loop to fill the master.");
assert.ok(
  first.soundtrackPlan.segments.every((segment) => segment.sourceOffsetSec === 0),
  "Uploaded songs must always begin at their natural start instead of arbitrary offsets."
);
assert.ok(
  Math.max(...first.soundtrackPlan.segments.map((segment) => segment.startSec + segment.durationSec)) >=
    first.durationSec - 0.05,
  "Uploaded music must continuously cover the complete Wall Frame duration."
);

assert.deepStrictEqual(
  listFrameStyleDefinitions().map((style) => style.id),
  [
    "classic-wood",
    "light-oak",
    "walnut",
    "dark-mahogany",
    "rustic-wood",
    "modern-black",
    "brushed-silver",
    "subtle-gold",
    "bronze",
    "white-gallery",
    "painted-pastel",
    "polaroid"
  ]
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
  `Wall Frame validation passed: ${first.wallSections.length} coverage-planned sections, ${first.coverageMetrics.heroCoveredMediaCount}/${first.coverageMetrics.selectedMediaCount} hero memories, ${first.durationSec.toFixed(
    2
  )}s master.`
);

function makeCoverageAssets(count: number): WallFrameSourceAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `coverage_${count}_${index}`,
    clipId: `coverage_clip_${count}_${index}`,
    mediaType: index % 4 === 0 ? "video" : "image",
    sourcePath: `D:/fixtures/coverage-${index}.${index % 4 === 0 ? "mp4" : "jpg"}`,
    durationSec: index % 4 === 0 ? 9 : undefined,
    width: index % 3 === 0 ? 1080 : 1920,
    height: index % 3 === 0 ? 1920 : 1080,
    capturedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    uploadOrder: index,
    score: 0.35 + ((index * 17) % 60) / 100,
    editorialScore: 0.4 + ((index * 13) % 55) / 100,
    importanceScore: 0.38 + ((index * 11) % 57) / 100,
    clusterId: `cluster_${Math.floor(index / 12)}`,
    hasAudio: index % 8 === 0
  }));
}

for (const count of [10, 30, 75]) {
  const coveragePlan = buildWallFrameRenderPlan({
    projectId: `coverage_project_${count}`,
    title: `${count} memory coverage`,
    assets: makeCoverageAssets(count),
    settings: {
      frameStyle: "mixed-scrapbook",
      frameVariety: "high",
      cameraMotion: "balanced",
      transitionEnergy: "balanced"
    }
  });
  assert.equal(coveragePlan.validationReport.valid, true);
  assert.equal(coveragePlan.coverageMetrics.heroCoverageRatio, 1);
  assert.equal(coveragePlan.coverageMetrics.heroCoveredMediaCount, count);
  assert.ok(coveragePlan.durationSec >= 120 && coveragePlan.durationSec <= 300);
}

const stressPlan = buildWallFrameRenderPlan({
  projectId: "coverage_project_300",
  title: "300 upload stress coverage",
  assets: makeCoverageAssets(300),
  settings: {
    frameStyle: "mixed-scrapbook",
    frameVariety: "high",
    cameraMotion: "energetic",
    transitionEnergy: "balanced"
  }
});
assert.equal(stressPlan.validationReport.valid, true);
assert.ok(stressPlan.selectedMasterMedia.length < 300);
assert.equal(stressPlan.coverageMetrics.heroCoverageRatio, 1);
assert.equal(
  stressPlan.excludedMedia.length,
  300 - stressPlan.selectedMasterMedia.length,
  "Capacity exclusions must be explicit rather than silently left in background frames."
);

async function runOptionalRenderSmokeTest() {
  const smokeRoot = path.resolve(".tmp-codex/wall-frame-smoke");
  await rm(smokeRoot, { recursive: true, force: true });
  await mkdir(smokeRoot, { recursive: true });
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
  const outputPath = path.join(smokeRoot, `autovlog-wall-frame-smoke-${process.pid}.mp4`);
  const smokePlan = buildWallFrameRenderPlan({
    projectId: "wall_frame_smoke",
    title: "Wall Frame smoke test",
    outputRole: "cluster",
    clusterId: "smoke-cluster",
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
      },
      {
        id: "smoke_polaroid_two",
        clipId: "smoke_polaroid_two_clip",
        mediaType: "image",
        sourcePath: imagePath,
        width: 1280,
        height: 720,
        uploadOrder: 6,
        score: 0.58,
        caption: "Another angle",
        hasAudio: false
      },
      {
        id: "smoke_notes_two",
        clipId: "smoke_notes_two_clip",
        mediaType: "image",
        sourcePath: notesPath,
        width: 1280,
        height: 720,
        uploadOrder: 7,
        score: 0.54,
        caption: "The details",
        hasAudio: false
      },
      {
        id: "smoke_dorm_two",
        clipId: "smoke_dorm_two_clip",
        mediaType: "image",
        sourcePath: dormPath,
        width: 1280,
        height: 720,
        uploadOrder: 8,
        score: 0.52,
        caption: "Back at the wall",
        hasAudio: false
      }
    ],
    settings: {
      cameraMotion: "energetic",
      transitionEnergy: "high",
      wallStyle: "dorm-room-wall",
      frameStyle: "mixed-scrapbook",
      frameVariety: "high",
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
    tempRoot: path.join(smokeRoot, "render-temp"),
    timeoutMs: 120_000
  });
  assert.equal(result.outputMetadata.width, 640);
  assert.equal(result.outputMetadata.height, 360);
  assert.ok(result.durationSec >= 5.8);
  assert.ok(
    result.plan.wallSections.some((section) => section.transitionToNext?.type.startsWith("frame-flip")),
    "The real smoke render must exercise a frame-flip transition."
  );
  if (process.env.WALL_FRAME_KEEP_SMOKE !== "1") {
    await rm(smokeRoot, { recursive: true, force: true });
  }
  console.log(
    `Wall Frame FFmpeg smoke test passed (${result.durationSec.toFixed(2)}s, audio=${result.audioFallback})${
      process.env.WALL_FRAME_KEEP_SMOKE === "1" ? ` at ${outputPath}` : ""
    }.`
  );
}

if (process.env.WALL_FRAME_RENDER_SMOKE === "1") {
  void runOptionalRenderSmokeTest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
