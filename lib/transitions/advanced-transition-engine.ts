import type { ProjectRecord, Timeline } from "@/lib/types";

import {
  assignTimelineTransitions,
  buildFallbackTransitions,
  calculateClipTimings,
  calculateTimelineDuration
} from "@/lib/transitions/engine";

export function assignAdvancedTimelineTransitions(project: ProjectRecord, timeline: Timeline) {
  return assignTimelineTransitions(project, timeline);
}

export function buildFallbackAdvancedTransitions(timeline: Timeline) {
  return buildFallbackTransitions(timeline);
}

export { calculateClipTimings, calculateTimelineDuration };
