import type { Timeline, UploadedSoundtrack, VlogVibe } from "@/lib/types";

function targetEnergy(vibe?: VlogVibe) {
  switch (vibe) {
    case "energetic":
      return 0.82;
    case "emotional":
      return 0.34;
    case "chill":
      return 0.46;
    default:
      return 0.62;
  }
}

function orderedTracks(timeline: Timeline) {
  const tracks = timeline.settings.musicSelection?.uploadedSoundtracks ?? [];
  const order = timeline.settings.musicSelection?.preferredTrackOrder ?? [];
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  return [...tracks]
    .filter((track) => track.status === "ready" && track.path)
    .sort((left, right) => {
      const leftOrder = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.filename.localeCompare(right.filename);
    });
}

function chooseBalancedTrack(options: {
  timeline: Timeline;
  tracks: UploadedSoundtrack[];
  usage: Map<string, number>;
  maxPerTrack: number;
}) {
  const desiredEnergy = targetEnergy(options.timeline.detectedVibe);
  const candidates = options.tracks
    .map((track, index) => {
      const useCount = options.usage.get(track.id) ?? 0;
      const energy = track.analysis?.energyScore ?? 0.55;
      const vibePenalty = Math.abs(energy - desiredEnergy);
      const balancePenalty = useCount >= options.maxPerTrack ? 3 + useCount : useCount * 0.42;
      return {
        track,
        score: vibePenalty + balancePenalty + index * 0.01
      };
    })
    .sort((left, right) => left.score - right.score);
  return candidates[0]?.track ?? options.tracks[0]!;
}

export function balanceChapterSoundtracks(timelines: Timeline[]) {
  const master = timelines.find((timeline) => timeline.kind === "master");
  const sourceTracks = master ? orderedTracks(master) : orderedTracks(timelines[0]!);
  const chapters = timelines.filter((timeline) => timeline.kind === "chapter");
  if (sourceTracks.length <= 1 || chapters.length <= 1) {
    return timelines;
  }

  const usage = new Map<string, number>();
  const maxPerTrack = Math.ceil(chapters.length / sourceTracks.length);
  const assignedChapters = new Map<string, UploadedSoundtrack>();

  for (const chapter of chapters) {
    const track = chooseBalancedTrack({
      timeline: chapter,
      tracks: sourceTracks,
      usage,
      maxPerTrack
    });
    usage.set(track.id, (usage.get(track.id) ?? 0) + 1);
    assignedChapters.set(chapter.id, track);
  }

  return timelines.map((timeline) => {
    if (timeline.kind !== "chapter") {
      return timeline;
    }
    const assigned = assignedChapters.get(timeline.id);
    if (!assigned) {
      return timeline;
    }
    return {
      ...timeline,
      settings: {
        ...timeline.settings,
        musicSelection: {
          ...timeline.settings.musicSelection,
          sourcePolicy: "user-uploaded-audio" as const,
          exportPolicy: "direct-user-audio" as const,
          note: `Mini-vlog soundtrack balanced to ${assigned.filename}.`,
          uploadedSoundtracks: [assigned],
          preferredTrackOrder: [assigned.id],
          soundtrackStrategy:
            timeline.settings.musicSelection?.soundtrackStrategy ?? "auto-select-best-segments"
        }
      }
    };
  });
}
