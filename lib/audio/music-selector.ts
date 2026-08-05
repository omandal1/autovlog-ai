import { createId } from "@/lib/ids";
import type {
  ProjectRecord,
  SoundtrackPlan,
  Timeline,
  TimelineAudioTrack,
  TimelineClip,
  UploadedSoundtrack,
  VlogVibe
} from "@/lib/types";

import {
  getDefaultMusicTrack,
  getMusicTracksForCategory,
  type MusicLibraryTrack
} from "@/lib/audio/music-library";
import { detectTimelineVibe } from "@/lib/audio/vibe-detector";
import { calculateClipTimings } from "@/lib/transitions/engine";

function hashSeed(value: string) {
  return value.split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function groupClipsByChapter(timeline: Timeline) {
  const timings = calculateClipTimings(timeline);
  const sections: Array<{
    chapterId: string;
    startSec: number;
    endSec: number;
    clips: TimelineClip[];
  }> = [];

  let current:
    | {
        chapterId: string;
        startSec: number;
        clips: TimelineClip[];
      }
    | undefined;

  timeline.clips.forEach((clip) => {
    const clipStartSec = timings.get(clip.id) ?? 0;
    if (!current || current.chapterId !== clip.chapterId) {
      if (current) {
        sections.push({
          ...current,
          endSec: clipStartSec
        });
      }
      current = {
        chapterId: clip.chapterId,
        startSec: clipStartSec,
        clips: [clip]
      };
      return;
    }

    current.clips.push(clip);
  });

  if (current) {
    sections.push({
      ...current,
      endSec: timeline.actualDurationSec
    });
  }

  return sections.filter((section) => section.endSec - section.startSec > 0.2);
}

function resolveVolumeDb(vibe: VlogVibe) {
  switch (vibe) {
    case "energetic":
      return -7;
    case "emotional":
      return -8.5;
    case "chill":
      return -9;
    default:
      return -8;
  }
}

function chooseTrackPool(
  tracks: MusicLibraryTrack[],
  seed: string,
  sectionDurationSec: number
) {
  if (tracks.length <= 1) {
    return tracks;
  }

  const startIndex = hashSeed(seed) % tracks.length;
  const ordered = tracks.map((_, index) => tracks[(startIndex + index) % tracks.length]!);
  return sectionDurationSec > ordered[0]!.durationSec * 0.75 ? ordered.slice(0, 2) : ordered.slice(0, 1);
}

function buildScheduleForSection(options: {
  timeline: Timeline;
  vibe: VlogVibe;
  chapterId: string;
  tracks: MusicLibraryTrack[];
  startSec: number;
  durationSec: number;
}) {
  const schedule: TimelineAudioTrack[] = [];
  const crossfadeSec = clamp(
    Math.min(1.2, Math.max(0.55, options.durationSec / 14)),
    0.5,
    1.2
  );
  const volumeDb = resolveVolumeDb(options.vibe);
  let coverageSec = 0;
  let playheadSec = options.startSec;
  let segmentIndex = 0;

  while (coverageSec < options.durationSec - 0.02) {
    if (!options.tracks.length || segmentIndex > Math.ceil(options.durationSec / 0.25) + options.tracks.length * 4) {
      break;
    }
    const track = options.tracks[segmentIndex % options.tracks.length]!;
    const sourceRoomSec = Math.max(8, Math.floor(track.durationSec - 2));
    const sourceOffsetSec = Math.min(
      Math.max(0, hashSeed(`${options.timeline.id}:${options.chapterId}:${track.id}:${segmentIndex}`) % sourceRoomSec),
      Math.max(0, track.durationSec - 6)
    );
    const leadOverlapSec = segmentIndex === 0 ? 0 : crossfadeSec;
    const remainingCoverageSec = options.durationSec - coverageSec;
    const rawSegmentDurationSec = clamp(
      Math.min(track.durationSec - sourceOffsetSec, remainingCoverageSec + leadOverlapSec),
      Math.min(track.durationSec - sourceOffsetSec, 6),
      track.durationSec - sourceOffsetSec
    );
    if (rawSegmentDurationSec <= 0.02) {
      break;
    }

    schedule.push({
      id: createId("music", 8),
      trackId: track.id,
      title: track.title,
      category: options.vibe,
      sourcePath: track.sourcePath,
      startSec: Number(playheadSec.toFixed(3)),
      sourceOffsetSec: Number(sourceOffsetSec.toFixed(3)),
      durationSec: Number(rawSegmentDurationSec.toFixed(3)),
      crossfadeSec: Number(leadOverlapSec.toFixed(3)),
      volumeDb
    });

    const effectiveAdvanceSec = Math.max(0.02, rawSegmentDurationSec - leadOverlapSec);
    playheadSec += effectiveAdvanceSec;
    coverageSec += Math.min(remainingCoverageSec, effectiveAdvanceSec);
    segmentIndex += 1;
  }

  return schedule;
}

function orderedUploadedSoundtracks(timeline: Timeline) {
  const tracks = timeline.settings.musicSelection?.uploadedSoundtracks ?? [];
  const order = timeline.settings.musicSelection?.preferredTrackOrder ?? [];
  if (!tracks.length) {
    return [];
  }

  const orderIndex = new Map(order.map((id, index) => [id, index]));
  return [...tracks]
    .filter((track) => track.status === "ready" && track.path)
    .sort((left, right) => {
      const leftOrder = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return (right.analysis?.energyScore ?? 0.5) - (left.analysis?.energyScore ?? 0.5);
    });
}

function vibeFromUploadedTracks(timeline: Timeline, tracks: UploadedSoundtrack[]) {
  if (!tracks.length) {
    return timeline.detectedVibe ?? "cinematic";
  }
  const averageEnergy =
    tracks.reduce((sum, track) => sum + (track.analysis?.energyScore ?? 0.52), 0) / tracks.length;
  const averageBpm =
    tracks.reduce((sum, track) => sum + (track.analysis?.estimatedBpm ?? 0), 0) /
    Math.max(1, tracks.filter((track) => track.analysis?.estimatedBpm).length || tracks.length);
  if (averageEnergy >= 0.72 || averageBpm >= 118) {
    return "energetic";
  }
  if (averageEnergy <= 0.4 || averageBpm <= 92) {
    return "emotional";
  }
  return timeline.detectedVibe ?? "cinematic";
}

function buildUploadedTrackSchedule(timeline: Timeline, tracks: UploadedSoundtrack[], vibe: VlogVibe) {
  const audioTracks: TimelineAudioTrack[] = [];
  const soundtrackSegments: SoundtrackPlan["segments"] = [];
  const crossfadeSec = 1.15;
  const baseVolumeDb = -8.8;
  const totalDurationSec = Math.max(0, timeline.actualDurationSec);
  const maxAdvancePerSegmentSec =
    tracks.length > 1
      ? clamp(totalDurationSec / tracks.length, 4.5, 72)
      : totalDurationSec;
  let playheadSec = 0;
  let segmentIndex = 0;

  while (playheadSec < totalDurationSec - 0.02) {
    if (segmentIndex > Math.ceil(totalDurationSec / 0.25) + tracks.length * 4) {
      break;
    }
    const track = tracks[segmentIndex % tracks.length]!;
    const durationSec = track.analysis?.durationSec ?? 0;
    const stableStartSec = track.analysis?.stableStartSec ?? 0;
    const stableEndSec = track.analysis?.stableEndSec ?? Math.max(durationSec, 8);
    const usableDurationSec = Math.max(3, stableEndSec - stableStartSec);
    const leadOverlapSec = segmentIndex === 0 ? 0 : crossfadeSec;
    const segmentStartSec = Math.max(0, playheadSec - leadOverlapSec);
    const remainingSec = totalDurationSec - playheadSec;
    const desiredAdvanceSec =
      tracks.length > 1
        ? Math.min(maxAdvancePerSegmentSec, remainingSec)
        : remainingSec;
    const targetRawDurationSec = Math.min(usableDurationSec, desiredAdvanceSec + leadOverlapSec);
    const sourceRoomSec = Math.max(0, usableDurationSec - targetRawDurationSec);
    const sourceOffsetSec =
      stableStartSec +
      (sourceRoomSec > 1
        ? (hashSeed(`${timeline.id}:${track.id}:${segmentIndex}`) % Math.floor(sourceRoomSec))
        : 0);
    const sourceAvailableSec = Math.max(0.25, usableDurationSec - (sourceOffsetSec - stableStartSec));
    const rawDurationSec = Math.max(
      0.25,
      Math.min(sourceAvailableSec, targetRawDurationSec)
    );
    const segmentId = createId("music", 8);
    const audioTrack: TimelineAudioTrack = {
      id: segmentId,
      trackId: track.id,
      title: track.title || track.filename,
      category: vibe,
      sourcePath: track.path,
      startSec: Number(segmentStartSec.toFixed(3)),
      sourceOffsetSec: Number(sourceOffsetSec.toFixed(3)),
      durationSec: Number(rawDurationSec.toFixed(3)),
      crossfadeSec: Number(leadOverlapSec.toFixed(3)),
      volumeDb: Number((baseVolumeDb + (track.analysis?.energyScore ?? 0.5) * 1.6).toFixed(2))
    };
    audioTracks.push(audioTrack);
    soundtrackSegments.push({
      ...audioTrack,
      id: createId("sndseg", 8),
      soundtrackId: track.id,
      role:
        segmentStartSec < 8
          ? "intro"
          : segmentStartSec + rawDurationSec >= totalDurationSec - 8
            ? "outro"
            : "body"
    });

    const advanceSec = Math.max(0.02, rawDurationSec - leadOverlapSec);
    playheadSec = Number((playheadSec + Math.min(remainingSec, advanceSec)).toFixed(3));
    segmentIndex += 1;
  }

  return {
    audioTracks,
    soundtrackPlan: {
      sourcePolicy: "user-uploaded-audio",
      strategy: timeline.settings.musicSelection?.soundtrackStrategy ?? "auto-select-best-segments",
      uploadedTrackIds: tracks.map((track) => track.id),
      segments: soundtrackSegments,
      usesInternalFallback: false,
      analysisNotes: tracks.map((track) =>
        `${track.filename}: ${Math.round((track.analysis?.energyScore ?? 0.5) * 100)} energy`
      )
    } satisfies SoundtrackPlan
  };
}

export async function attachAudioPlan(project: ProjectRecord, timeline: Timeline) {
  const selectedMusic = timeline.settings.musicSelection;
  const uploadedTracks = orderedUploadedSoundtracks(timeline);

  if (uploadedTracks.length) {
    const vibe = vibeFromUploadedTracks(timeline, uploadedTracks);
    const schedule = buildUploadedTrackSchedule(timeline, uploadedTracks, vibe);
    return {
      ...timeline,
      detectedVibe: vibe,
      audioTracks: schedule.audioTracks,
      soundtrackPlan: schedule.soundtrackPlan
    };
  }

  if (timeline.settings.musicStyle === "none") {
    const vibe = timeline.detectedVibe ?? detectTimelineVibe(project, timeline).vibe;
    return {
      ...timeline,
      detectedVibe: vibe,
      audioTracks: []
    };
  }

  const sections = groupClipsByChapter(timeline);
  const overallVibe =
    timeline.detectedVibe ?? detectTimelineVibe(project, timeline).vibe;
  const audioTracks: TimelineAudioTrack[] = [];

  for (const section of sections) {
    const detected = detectTimelineVibe(project, timeline, section.clips).vibe;
    const vibe = section.clips.length >= 3 ? detected : overallVibe;
    const categoryTracks = await getMusicTracksForCategory(vibe);
    const selectedTracks = chooseTrackPool(
      categoryTracks,
      `${timeline.id}:${section.chapterId}:${vibe}`,
      section.endSec - section.startSec
    );

    audioTracks.push(
      ...buildScheduleForSection({
        timeline,
        vibe,
        chapterId: section.chapterId,
        tracks: selectedTracks,
        startSec: section.startSec,
        durationSec: Number((section.endSec - section.startSec).toFixed(3))
      })
    );
  }

  if (!audioTracks.length) {
    return attachFallbackAudioPlan(project, timeline);
  }

  return {
    ...timeline,
    detectedVibe: overallVibe,
    audioTracks,
    soundtrackPlan: {
      sourcePolicy: "internal-licensed",
      strategy: "auto-select-best-segments",
      uploadedTrackIds: [],
      segments: audioTracks.map((track) => ({
        ...track,
        id: createId("sndseg", 8),
        soundtrackId: track.trackId,
        role: "body"
      })),
      usesInternalFallback: true,
      analysisNotes: ["Using built-in royalty-free music because no uploaded MP3 files were provided."]
    } satisfies SoundtrackPlan
  };
}

export async function attachFallbackAudioPlan(project: ProjectRecord, timeline: Timeline) {
  const uploadedTracks = orderedUploadedSoundtracks(timeline);
  if (uploadedTracks.length) {
    const vibe = vibeFromUploadedTracks(timeline, uploadedTracks);
    const schedule = buildUploadedTrackSchedule(timeline, uploadedTracks, vibe);
    return {
      ...timeline,
      detectedVibe: vibe,
      audioTracks: schedule.audioTracks,
      soundtrackPlan: schedule.soundtrackPlan
    };
  }
  const fallbackTrack = await getDefaultMusicTrack();
  const vibe = timeline.detectedVibe ?? "cinematic";
  const audioTracks = buildScheduleForSection({
    timeline,
    vibe: "cinematic",
    chapterId: timeline.chapterOrder[0] ?? "fallback",
    tracks: [fallbackTrack],
    startSec: 0,
    durationSec: timeline.actualDurationSec
  });

  return {
    ...timeline,
    detectedVibe: vibe,
    audioTracks,
    soundtrackPlan: {
      sourcePolicy: "internal-licensed",
      strategy: "auto-select-best-segments",
      uploadedTrackIds: [],
      segments: audioTracks.map((track) => ({
        ...track,
        id: createId("sndseg", 8),
        soundtrackId: track.trackId,
        role: "body"
      })),
      usesInternalFallback: true,
      analysisNotes: ["Fallback internal music selected after uploaded soundtrack planning failed."]
    } satisfies SoundtrackPlan
  };
}
