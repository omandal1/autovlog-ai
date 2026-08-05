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

  try {
    prepared = buildBookRenderPlan(project, prepared);
  } catch {
    prepared = validateAndRepairRenderPlan(project, prepared);
  }

  prepared = validateAndRepairRenderPlan(project, prepared);

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

  return planLayeredMusicMix(prepared);
}
