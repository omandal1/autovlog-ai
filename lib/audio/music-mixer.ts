import { createId } from "@/lib/ids";
import type { Timeline, TimelineAudioTrack } from "@/lib/types";

import { calculateClipTimings } from "@/lib/transitions/advanced-transition-engine";
import { calculateBookPageTimings } from "@/lib/transitions/page-turn-engine";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function planLayeredMusicMix(timeline: Timeline) {
  if (!timeline.audioTracks?.length) {
    return timeline;
  }

  const audioEmphasis = timeline.settings.generation?.audioEmphasis ?? "balanced";
  const emphasisOffsetDb =
    audioEmphasis === "music-forward"
      ? 2.5
      : audioEmphasis === "original-audio-forward"
        ? -3.5
        : 0;
  const clipStartTimes = calculateClipTimings(timeline);
  const pageStartTimes = timeline.book ? calculateBookPageTimings(timeline.book) : undefined;
  const clipWindows = timeline.book?.pages?.length
    ? timeline.book.pages
        .flatMap((page) => {
          const sourceSlots = page.slots.filter((slot) => slot.role === "primary");
          if (!sourceSlots.length) {
            return [
              {
                clip: undefined,
                startSec: pageStartTimes?.get(page.id) ?? 0,
                durationSec: page.durationSec,
                musicGainDb: page.audioStrategy.musicGainDb
              }
            ];
          }

          return sourceSlots.map((slot) => {
            const clip = timeline.clips.find((item) => item.id === slot.clipId);
            return {
              clip,
              startSec: clipStartTimes.get(slot.clipId) ?? 0,
              durationSec: Number(Math.max(0.25, slot.displayDurationSec).toFixed(3)),
              musicGainDb: page.audioStrategy.musicGainDb
            };
          });
        })
        .sort((left, right) => left.startSec - right.startSec)
    : timeline.clips.map((clip, index) => {
        const startSec = clipStartTimes.get(clip.id) ?? 0;
        const endSec =
          index < timeline.clips.length - 1
            ? clipStartTimes.get(timeline.clips[index + 1]!.id) ?? timeline.actualDurationSec
            : timeline.actualDurationSec;
        return {
          clip,
          startSec,
          durationSec: Number(Math.max(0.25, endSec - startSec).toFixed(3)),
          musicGainDb: clip.sourceAudio?.hasAudio ? clip.sourceAudio.musicDuckDb * 0.45 : 1.5
        };
      });

  const expandedTracks: TimelineAudioTrack[] = [];
  let trackIndex = 0;
  let consumedSec = 0;
  const maxSegments = Math.max(64, clipWindows.length * Math.max(1, timeline.audioTracks.length) * 4);

  for (const window of clipWindows) {
    let remainingSec = window.durationSec;
    let windowSegmentCount = 0;
    while (remainingSec > 0.02 && timeline.audioTracks[trackIndex]) {
      if (expandedTracks.length > maxSegments || windowSegmentCount > timeline.audioTracks.length * 3 + 8) {
        break;
      }
      const sourceTrack = timeline.audioTracks[trackIndex]!;
      const sourceRemainingSec = sourceTrack.durationSec - consumedSec;
      if (sourceRemainingSec <= 0.02) {
        trackIndex += 1;
        consumedSec = 0;
        continue;
      }
      const segmentDurationSec = Number(Math.min(remainingSec, sourceRemainingSec).toFixed(3));
      if (segmentDurationSec <= 0.02) {
        break;
      }
      const sourceAudio = window.clip?.sourceAudio;
      const gainAdjustmentDb =
        typeof window.musicGainDb === "number"
          ? window.musicGainDb
          : sourceAudio?.hasAudio
            ? clamp(sourceAudio.musicDuckDb * 0.45, -10, -3.5)
            : 1.5;

      expandedTracks.push({
        ...sourceTrack,
        id: createId("music", 8),
        startSec: Number((window.startSec + (window.durationSec - remainingSec)).toFixed(3)),
        sourceOffsetSec: Number((sourceTrack.sourceOffsetSec + consumedSec).toFixed(3)),
        durationSec: segmentDurationSec,
        crossfadeSec: expandedTracks.length === 0 ? 0 : Number(Math.min(0.32, segmentDurationSec / 4).toFixed(3)),
        volumeDb: Number((sourceTrack.volumeDb + gainAdjustmentDb + emphasisOffsetDb).toFixed(2))
      });

      consumedSec = Number((consumedSec + segmentDurationSec).toFixed(3));
      remainingSec = Number((remainingSec - segmentDurationSec).toFixed(3));
      if (consumedSec >= sourceTrack.durationSec - 0.01) {
        trackIndex += 1;
        consumedSec = 0;
      }
      windowSegmentCount += 1;
    }
  }

  return {
    ...timeline,
    audioTracks: expandedTracks.length ? expandedTracks : timeline.audioTracks
  };
}
