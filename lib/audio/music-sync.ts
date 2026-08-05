import { BEAT_ALIGNMENT_POLICY } from "@/lib/constants";
import type { Timeline } from "@/lib/types";

import { calculateBookDuration, calculateBookPageTimings } from "@/lib/transitions/page-turn-engine";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nearestValue(values: number[], target: number) {
  let best = values[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

export function alignTimelineToMusicBeats(timeline: Timeline) {
  if (!timeline.book?.pages?.length || !timeline.beatAnalysis?.beatGridSec.length) {
    return timeline;
  }
  const beatAnalysis = timeline.beatAnalysis;

  const adjusted = {
    ...timeline,
    book: {
      ...timeline.book,
      pages: timeline.book.pages.map((page) => ({
        ...page,
        slots: page.slots.map((slot) => ({ ...slot })),
        audioStrategy: { ...page.audioStrategy }
      })),
      transitions: timeline.book.transitions.map((transition) => ({ ...transition }))
    }
  };

  for (let index = 0; index < adjusted.book.transitions.length; index += 1) {
    const timings = calculateBookPageTimings(adjusted.book);
    const nextPage = adjusted.book.pages[index + 1];
    const currentPage = adjusted.book.pages[index];
    if (!nextPage || !currentPage) {
      continue;
    }

    const nextStartSec = timings.get(nextPage.id) ?? 0;
    const snapped = nearestValue(beatAnalysis.beatGridSec, nextStartSec);
    const delta = Number((snapped - nextStartSec).toFixed(3));
    if (Math.abs(delta) > BEAT_ALIGNMENT_POLICY.beatSnapToleranceSec) {
      continue;
    }

    const nextDuration = clamp(currentPage.durationSec + delta, 1.9, 10.8);
    currentPage.durationSec = Number(nextDuration.toFixed(3));
    currentPage.slots = currentPage.slots.map((slot) => ({
      ...slot,
      displayDurationSec: currentPage.durationSec,
      trimDurationSec: Number(Math.min(slot.trimDurationSec, currentPage.durationSec).toFixed(3))
    }));
  }

  adjusted.actualDurationSec = calculateBookDuration(adjusted.book);
  return adjusted;
}
