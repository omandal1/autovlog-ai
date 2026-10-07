import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { attachAudioPlan } from "@/lib/audio/music-selector";
import { planLayeredMusicMix } from "@/lib/audio/music-mixer";
import { buildMusicBedGraph } from "@/lib/render/ffmpeg-command-builder";
import { buildWallFrameRenderPlan } from "@/lib/wall-frame/render-plan-builder";
import { renderWallFramePlan } from "@/lib/render/wall-frame-render-strategy";
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/constants";
import type { ProjectRecord, Timeline } from "@/lib/types";
import { runFfmpeg } from "@/scripts/ffmpeg";

async function main() {
  const root = path.resolve("storage/.recovery-tests/continuous-music");
  await mkdir(root, { recursive: true });
  const song = path.join(root, "song.mp3");
  // Each third of this test song has a distinct tone. Sampling the encoded
  // results detects skipped passages, mid-song restarts, silence and bad loops.
  await runFfmpeg([
    "-y", "-f", "lavfi", "-i",
    "aevalsrc='0.15*sin(2*PI*if(lt(t,4),330,if(lt(t,8),550,880))*t)':s=48000:d=12",
    "-c:a", "libmp3lame", song
  ]);
  const timeline: Timeline = {
    id: "continuous-music-test", projectId: "music-test", kind: "chapter", title: "Music continuity",
    targetDurationSec: 30, actualDurationSec: 30, clips: [], chapterOrder: ["chapter"],
    renderProfile: { width: 640, height: 360, fps: 24, transitionSec: 0.3 },
    settings: {
      tone: "balanced", clipDensity: "fast-cuts", musicStyle: "cinematic",
      generation: DEFAULT_GENERATION_SETTINGS,
      musicSelection: {
        sourcePolicy: "user-uploaded-audio", exportPolicy: "direct-user-audio",
        soundtrackStrategy: "auto-select-best-segments", preferredTrackOrder: ["song"],
        uploadedSoundtracks: [{
          id: "song", path: song, filename: "song.mp3", title: "Test song", mimeType: "audio/mpeg",
          byteSize: 1000, status: "ready", analysis: { durationSec: 12, stableStartSec: 3, stableEndSec: 9,
            energyScore: 0.5, confidence: 1, source: "ffprobe" }
        }]
      }
    }
  };
  const prepared = await attachAudioPlan({} as ProjectRecord, timeline);
  const mixed = planLayeredMusicMix(prepared);
  const playlist = await attachAudioPlan({} as ProjectRecord, {
    ...timeline,
    settings: { ...timeline.settings, musicSelection: {
      ...timeline.settings.musicSelection!, preferredTrackOrder: ["second", "song"],
      uploadedSoundtracks: [timeline.settings.musicSelection!.uploadedSoundtracks[0]!, {
        ...timeline.settings.musicSelection!.uploadedSoundtracks[0]!, id: "second", filename: "second.mp3",
        analysis: { ...timeline.settings.musicSelection!.uploadedSoundtracks[0]!.analysis!, durationSec: 9 }
      }]
    } }
  });
  assert.deepEqual(playlist.audioTracks?.map((track) => track.trackId), ["second", "song", "second", "song"]);
  assert.ok(playlist.audioTracks?.every((track) => track.sourceOffsetSec === 0));
  assert.equal(mixed.audioTracks?.length, 3);
  assert.deepEqual(mixed.audioTracks?.map((track) => track.sourceOffsetSec), [0, 0, 0]);
  assert.equal(mixed.audioTracks![0]!.durationSec, 12);
  assert.equal(mixed.audioTracks![1]!.durationSec, 12);
  assert.equal(mixed.audioTracks![2]!.startSec + mixed.audioTracks![2]!.durationSec, 30);
  const graph = buildMusicBedGraph(mixed)!;
  const bed = path.join(root, "diary-music.m4a");
  const inputs = mixed.audioTracks!.flatMap((track) => [
    "-ss", String(track.sourceOffsetSec), "-t", String(track.durationSec), "-i", track.sourcePath
  ]);
  await runFfmpeg(["-y", ...inputs, "-filter_complex", graph.filterComplex, "-map", graph.outputLabel,
    "-ar", "48000", "-c:a", "aac", bed]);

  const plan = buildWallFrameRenderPlan({
    projectId: "continuous-music-test", title: "Continuous music", outputRole: "cluster",
    assets: Array.from({ length: 4 }, (_, index) => ({
      id: `image-${index}`, clipId: `clip-${index}`, mediaType: "image" as const,
      sourcePath: path.resolve("storage/test-media/source-audio-pageflip/20260307_polaroid.png"),
      uploadOrder: index, width: 1280, height: 720
    })),
    renderSize: { width: 640, height: 360, fps: 24 },
    soundtrackPlan: { sourcePolicy: "user-uploaded-audio", usesInternalFallback: false,
      segments: mixed.audioTracks!.map((track) => ({ ...track, soundtrackId: track.trackId })) }
  });
  const video = path.join(root, "wall-continuous-music.mp4");
  await renderWallFramePlan({ plan, outputPath: video, tempRoot: path.join(root, "render"), preserveSourceAudio: false });
  for (const [name, source] of [["diary", bed], ["wall", video]]) {
    const pcm = path.join(root, `${name}.pcm`);
    await runFfmpeg(["-y", "-i", source!, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", pcm]);
    const data = await readFile(pcm);
    for (const [time, expected] of [[2, 330], [6, 550], [10, 880], [14, 330], [18, 550], [22, 880], [26, 330]]) {
      let crossings = 0;
      let peak = 0;
      const start = Math.round(time! * 8000);
      for (let sample = start + 1; sample < start + 4000; sample++) {
        const value = data.readInt16LE(sample * 2);
        peak = Math.max(peak, Math.abs(value));
        if (value >= 0 && data.readInt16LE((sample - 1) * 2) < 0) crossings++;
      }
      assert.ok(peak > 30, `${name} music unexpectedly silent at ${time}s`);
      assert.ok(Math.abs(crossings * 2 - expected!) < 8,
        `${name}: expected ${expected}Hz at ${time}s, got ${crossings * 2}Hz`);
    }
  }
  console.log("Continuous music passed: complete song order and looping verified in encoded Diary audio and Wall Frame MP4.");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
