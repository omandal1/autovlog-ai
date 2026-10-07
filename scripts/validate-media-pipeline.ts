import assert from "node:assert/strict";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateVideoFile } from "@/lib/render/video-integrity";
import type { MediaAsset } from "@/lib/types";
import { preprocessAsset } from "@/media-processing/preprocess";
import {
  validateMediaSource,
  validateSoundtrackSource
} from "@/media-processing/validation";
import { runFfmpeg } from "@/scripts/ffmpeg";

async function main() {
  const projectRoot = path.resolve(process.cwd());
  const tempRoot = path.join(projectRoot, "storage", ".recovery-tests", "media-pipeline");
  const relative = path.relative(projectRoot, tempRoot);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });

  try {
    const sourceVideo = path.join(
      projectRoot,
      "storage",
      "test-media",
      "source-audio-pageflip",
      "20260301_movein.mp4"
    );
    const sourceImage = path.join(
      projectRoot,
      "storage",
      "test-media",
      "source-audio-pageflip",
      "20260301_dorm.png"
    );
    const invalidPath = path.join(tempRoot, "corrupt.mp4");
    await writeFile(invalidPath, Buffer.from("not a media file", "utf8"));

    const [videoValidation, imageValidation, invalidValidation] = await Promise.all([
      validateMediaSource(sourceVideo, "video"),
      validateMediaSource(sourceImage, "image"),
      validateMediaSource(invalidPath, "video")
    ]);
    assert.equal(videoValidation.valid, true);
    assert.equal(imageValidation.valid, true);
    assert.equal(invalidValidation.valid, false);

    const mp3Path = path.join(tempRoot, "soundtrack.mp3");
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:sample_rate=48000:duration=2",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      mp3Path
    ]);
    assert.equal((await validateSoundtrackSource(mp3Path)).valid, true);

    const proxyPath = path.join(tempRoot, "proxy.mp4");
    const asset: MediaAsset = {
      id: "cache-test-video",
      projectId: "cache-test-project",
      filename: "movein.mp4",
      mediaType: "video",
      uploadOrder: 0,
      storage: {
        originalPath: sourceVideo,
        thumbnailPath: path.join(tempRoot, "thumbnail.jpg"),
        proxyPath,
        keyframeDir: path.join(tempRoot, "keyframes")
      },
      metadata: {
        capturedAtSource: "filesystem",
        durationSec: videoValidation.durationSec,
        width: videoValidation.width,
        height: videoValidation.height,
        extension: ".mp4",
        mimeType: "video/mp4",
        byteSize: (await stat(sourceVideo)).size
      },
      analysis: { selectionReasons: [], skipReasons: [] }
    };

    await preprocessAsset(asset);
    const firstProxy = await stat(proxyPath);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await preprocessAsset(asset);
    const secondProxy = await stat(proxyPath);
    assert.equal(secondProxy.mtimeMs, firstProxy.mtimeMs, "unchanged media should reuse its proxy");
    const proxyValidation = await validateVideoFile(proxyPath, {
      requireH264: true,
      requireYuv420p: true,
      requireAudio: true,
      fps: 30,
      decode: true
    });
    assert.equal(proxyValidation.valid, true, proxyValidation.reason);
    console.log("Media validation and normalized-proxy cache validation passed.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
