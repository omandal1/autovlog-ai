import type { ProjectRecord, Timeline } from "@/lib/types";

import { analyzeTimelineBeats } from "@/lib/audio/beat-analysis";
import { planLayeredMusicMix } from "@/lib/audio/music-mixer";
import { alignTimelineToMusicBeats } from "@/lib/audio/music-sync";
import { attachAudioPlan, attachFallbackAudioPlan } from "@/lib/audio/music-selector";
import { analyzeTimelineSourceAudio } from "@/lib/audio/source-audio-analysis";
import { buildBookRenderPlan } from "@/lib/render/book-render-plan-builder";
import { validateAndRepairRenderPlan } from "@/lib/render/render-plan-validator";
import {
  assignAdvancedTimelineTransitions,
  buildFallbackAdvancedTransitions
} from "@/lib/transitions/advanced-transition-engine";
import { buildWallFrameRenderPlan } from "@/lib/wall-frame/render-plan-builder";
import type {
  WallFrameSoundtrackPlan,
  WallFrameSourceAsset
} from "@/lib/wall-frame/types";

function buildWallFrameSoundtrackPlan(timeline: Timeline): WallFrameSoundtrackPlan {
  return {
    sourcePolicy: timeline.soundtrackPlan?.sourcePolicy ?? "internal-licensed",
    segments: (timeline.audioTracks ?? []).map((track) => ({
      id: track.id,
      soundtrackId: track.trackId,
      sourcePath: track.sourcePath,
      startSec: track.startSec,
      sourceOffsetSec: track.sourceOffsetSec,
      durationSec: track.durationSec,
      crossfadeSec: track.crossfadeSec,
      volumeDb: track.volumeDb
    })),
    usesInternalFallback: timeline.soundtrackPlan?.usesInternalFallback ?? true
  };
}

function buildWallFrameAssets(timeline: Timeline): WallFrameSourceAsset[] {
  const seen = new Set<string>();
  return timeline.clips.flatMap((clip, uploadOrder) => {
    if (seen.has(clip.assetId)) {
      return [];
    }
    seen.add(clip.assetId);
    return [{
      id: clip.assetId,
      clipId: clip.id,
      mediaType: clip.mediaType,
      sourcePath: clip.normalizedPath ?? clip.sourcePath,
      audioSourcePath: clip.audioSourcePath,
      durationSec:
        clip.mediaType === "video"
          ? Math.max(clip.trimStartSec + clip.trimDurationSec, clip.displayDurationSec)
          : clip.displayDurationSec,
      trimStartSec: clip.trimStartSec,
      capturedAt: clip.capturedAt,
      uploadOrder,
      score: clip.score,
      caption: clip.transcriptText ?? clip.titleOverlay,
      hasAudio: clip.sourceAudio?.hasAudio
    } satisfies WallFrameSourceAsset];
  });
}

export async function prepareTimelineForRender(project: ProjectRecord, timeline: Timeline) {
  let prepared = timeline;

  try {
    prepared = assignAdvancedTimelineTransitions(project, prepared);
  } catch {
    prepared = buildFallbackAdvancedTransitions(prepared);
  }

  try {
    prepared = await analyzeTimelineSourceAudio(prepared);
  } catch {
    prepared = {
      ...prepared,
      clips: prepared.clips.map((clip) => ({
        ...clip,
        sourceAudio: clip.sourceAudio ?? {
          hasAudio: false,
          gainDb: 0,
          musicDuckDb: 0
        }
      }))
    };
  }

  if (prepared.settings.generation?.generationMode !== "wall-frame") {
    try {
      prepared = buildBookRenderPlan(project, prepared);
    } catch {
      prepared = validateAndRepairRenderPlan(project, prepared);
    }

    prepared = validateAndRepairRenderPlan(project, prepared);
  }

  try {
    prepared = await attachAudioPlan(project, prepared);
  } catch {
    prepared = await attachFallbackAudioPlan(project, prepared);
  }

  try {
    prepared = {
      ...prepared,
      beatAnalysis: await analyzeTimelineBeats(prepared)
    };
    prepared = alignTimelineToMusicBeats(prepared);
  } catch {
    prepared = {
      ...prepared,
      beatAnalysis: prepared.beatAnalysis ?? {
        bpm: undefined,
        beatGridSec: [],
        phraseMarkersSec: [],
        confidence: 0.18,
        source: "fallback"
      }
    };
  }

  prepared = planLayeredMusicMix(prepared);

  if (prepared.settings.generation?.generationMode === "wall-frame") {
    const wallFrame = buildWallFrameRenderPlan({
      projectId: prepared.projectId,
      title: prepared.title,
      assets: buildWallFrameAssets(prepared),
      settings: prepared.settings.generation.wallFrameStyleSettings,
      soundtrackPlan: buildWallFrameSoundtrackPlan(prepared),
      renderSize: {
        width: prepared.renderProfile.width,
        height: prepared.renderProfile.height,
        fps: 30
      }
    });
    prepared = {
      ...prepared,
      actualDurationSec: wallFrame.durationSec,
      book: undefined,
      wallFrame,
      renderProfile: {
        ...prepared.renderProfile,
        fps: wallFrame.renderSize.fps
      }
    };
  }

  return prepared;
}
