import type { BeatAnalysis, Timeline } from "@/lib/types";

import { ensureMusicLibrary } from "@/lib/audio/music-library";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function analyzeTimelineBeats(timeline: Timeline): Promise<BeatAnalysis> {
  const tracks = timeline.audioTracks ?? [];
  if (!tracks.length) {
    return {
      bpm: undefined,
      beatGridSec: [],
      phraseMarkersSec: [],
      confidence: 0.18,
      source: "fallback"
    };
  }

  const library = await ensureMusicLibrary();
  const libraryMap = new Map(library.map((track) => [track.id, track]));
  const uploadedMap = new Map(
    (timeline.settings.musicSelection?.uploadedSoundtracks ?? []).map((track) => [track.id, track])
  );
  const beatGridSec: number[] = [];
  const phraseMarkersSec: number[] = [];
  const bpms: number[] = [];

  for (const track of tracks) {
    const definition = libraryMap.get(track.trackId);
    const uploaded = uploadedMap.get(track.trackId);
    const bpm = definition?.bpm ?? uploaded?.analysis?.estimatedBpm;
    if (!bpm) {
      continue;
    }

    bpms.push(bpm);
    const beatLengthSec = 60 / bpm;
    const phraseLengthSec = beatLengthSec * 8;

    for (let cursor = track.startSec; cursor <= track.startSec + track.durationSec + 0.001; cursor += beatLengthSec) {
      beatGridSec.push(Number(cursor.toFixed(3)));
    }

    for (let cursor = track.startSec; cursor <= track.startSec + track.durationSec + 0.001; cursor += phraseLengthSec) {
      phraseMarkersSec.push(Number(cursor.toFixed(3)));
    }
  }

  if (!bpms.length) {
    return {
      bpm: undefined,
      beatGridSec: [],
      phraseMarkersSec: [],
      confidence: 0.26,
      source: "fallback"
    };
  }

  const averageBpm = bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length;
  return {
    bpm: Number(averageBpm.toFixed(1)),
    beatGridSec: [...new Set(beatGridSec)].sort((left, right) => left - right),
    phraseMarkersSec: [...new Set(phraseMarkersSec)].sort((left, right) => left - right),
    confidence: Number(clamp(0.56 + bpms.length * 0.08, 0.56, 0.92).toFixed(2)),
    source: "recipe"
  };
}
