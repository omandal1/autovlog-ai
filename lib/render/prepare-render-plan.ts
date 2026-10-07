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
import { createEditDecisionList } from "@/lib/editorial/editorial-planner";

function buildWallFrameSoundtrackPlan(timeline: Timeline): WallFrameSoundtrackPlan {
  const uploadedTracks = timeline.settings.musicSelection?.uploadedSoundtracks ?? [];
  if (timeline.soundtrackPlan?.sourcePolicy === "user-uploaded-audio" && uploadedTracks.length) {
    const preferredOrder = timeline.settings.musicSelection?.preferredTrackOrder ?? [];
    const order = new Map(preferredOrder.map((id, index) => [id, index]));
    const tracks = uploadedTracks
      .filter((track) => track.status === "ready" && track.path && (track.analysis?.durationSec ?? 0) > 0)
      .sort((left, right) => {
        const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });
    let cursor = 0;
    return {
      sourcePolicy: "user-uploaded-audio",
      segments: tracks.map((track, index) => {
        const crossfadeSec = index === 0 ? 0 : 0.65;
        const startSec = Math.max(0, cursor - crossfadeSec);
        const durationSec = Number(track.analysis?.durationSec);
        cursor = startSec + durationSec;
        return {
          id: `uploaded_${track.id}_${index}`,
          soundtrackId: track.id,
          sourcePath: track.path,
          startSec,
          sourceOffsetSec: 0,
          durationSec,
          crossfadeSec,
          volumeDb: -8
        };
      }),
      usesInternalFallback: false
    };
  }
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
      width: clip.sourceWidth,
      height: clip.sourceHeight,
      capturedAt: clip.capturedAt,
      uploadOrder,
      score: clip.score,
      editorialScore: clip.editorialScoreBreakdown
        ? Math.max(
            0,
            Math.min(
              1,
              (clip.editorialScoreBreakdown.story ?? 0) * 0.35 +
                (clip.editorialScoreBreakdown.emotion ?? 0) * 0.2 +
                (clip.editorialScoreBreakdown.visual ?? 0) * 0.25 +
                (clip.editorialScoreBreakdown.technical ?? 0) * 0.2
            )
          )
        : clip.score,
      importanceScore: clip.editorialScoreBreakdown?.story ?? clip.score,
      clusterId: clip.chapterId,
      selectionReason: clip.reasonSelected?.join(" "),
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

  if (prepared.soundtrackPlan?.sourcePolicy === "user-uploaded-audio") {
    // Beat alignment can change book duration; reschedule complete songs to
    // the final duration before applying the mix.
    prepared = await attachAudioPlan(project, prepared);
  }
  prepared = planLayeredMusicMix(prepared);

  if (prepared.settings.generation?.generationMode === "wall-frame") {
    const wallFrame = buildWallFrameRenderPlan({
      projectId: prepared.projectId,
      title: prepared.title,
      assets: buildWallFrameAssets(prepared),
      outputRole: prepared.kind === "master" ? "master" : "cluster",
      clusterId: prepared.kind === "chapter" ? prepared.chapterOrder[0] : undefined,
      clusterVideoCount: prepared.kind === "master" ? prepared.chapterOrder.length : 1,
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
    if (prepared.soundtrackPlan?.sourcePolicy === "user-uploaded-audio") {
      prepared = planLayeredMusicMix(await attachAudioPlan(project, prepared));
      wallFrame.soundtrackPlan = {
        sourcePolicy: "user-uploaded-audio",
        usesInternalFallback: false,
        segments: prepared.audioTracks!.map((track) => ({
          id: track.id,
          soundtrackId: track.trackId,
          sourcePath: track.sourcePath,
          startSec: track.startSec,
          sourceOffsetSec: track.sourceOffsetSec,
          durationSec: track.durationSec,
          crossfadeSec: track.crossfadeSec,
          volumeDb: track.volumeDb
        }))
      };
    }
  }

  return {
    ...prepared,
    editDecisionList: createEditDecisionList(prepared)
  };
}
