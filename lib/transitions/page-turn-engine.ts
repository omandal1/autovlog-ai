import { createId } from "@/lib/ids";
import type {
  BookPage,
  BookPageTransition,
  BookRenderPlan,
  GenerationSettings,
  ThemePresetConfig,
  TransitionType,
  VlogVibe
} from "@/lib/types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolvePageTurnDuration(
  vibe: VlogVibe | undefined,
  boundary: boolean,
  fromPage: BookPage,
  toPage: BookPage,
  options?: {
    generation?: GenerationSettings;
    theme?: ThemePresetConfig;
  }
) {
  const base =
    vibe === "energetic"
      ? 0.76
      : vibe === "emotional"
        ? 1.14
        : vibe === "chill"
          ? 1.02
          : 0.94;
  const pacingBias =
    options?.generation?.pacing === "fast"
      ? -0.08
      : options?.generation?.pacing === "slow-sentimental"
        ? 0.14
        : 0;
  const styleBias =
    options?.theme?.pageTurnStyle === "dramatic-lift"
      ? 0.12
      : options?.theme?.pageTurnStyle === "quick-flick"
        ? -0.1
        : 0;
  const boundaryBoost = boundary ? 0.34 : 0;
  const coverBoost = fromPage.kind === "cover" ? 0.18 : 0;
  return Number(
    clamp(
      base + boundaryBoost + coverBoost + pacingBias + styleBias,
      boundary ? 0.88 : 0.68,
      Math.min(1.5, fromPage.durationSec / 2.3, toPage.durationSec / 2.3)
    ).toFixed(3)
  );
}

export function buildPageTurnTransitions(
  pages: BookPage[],
  vibe?: VlogVibe,
  options?: {
    generation?: GenerationSettings;
    theme?: ThemePresetConfig;
  }
): BookPageTransition[] {
  return pages.slice(1).map((page, index) => {
    const previous = pages[index]!;
    const boundary =
      previous.chapterId !== page.chapterId ||
      previous.kind === "cover" ||
      page.kind === "chapter-divider";
    const type: TransitionType =
      previous.kind === "cover"
        ? "book-open"
        : "page-flip";
    const curveStrength =
      options?.theme?.pageTurnStyle === "dramatic-lift"
        ? 0.92
        : options?.theme?.pageTurnStyle === "soft-arch"
          ? 0.72
          : 0.62;
    const liftPx =
      options?.theme?.pageTurnStyle === "quick-flick"
        ? 32
        : boundary
          ? 54
          : 42;

    return {
      id: createId("pageturn", 8),
      fromPageId: previous.id,
      toPageId: page.id,
      type,
      durationSec: resolvePageTurnDuration(vibe, boundary, previous, page, options),
      filterName:
        type === "book-open"
          ? "book-open-physical"
          : "pageflip-physical",
      isChapterBoundary: boundary,
      shadowStrength: boundary ? 0.38 : 0.3,
      curveStrength,
      liftPx,
      frameBudget: type === "book-open" ? 32 : boundary ? 30 : 24
    };
  });
}

export function calculateBookDuration(book: BookRenderPlan) {
  const pageSum = book.pages.reduce((sum, page) => sum + page.durationSec, 0);
  const overlap = book.transitions.reduce((sum, transition) => sum + transition.durationSec, 0);
  return Number(Math.max(0, pageSum - overlap).toFixed(2));
}

export function calculateBookPageTimings(book: BookRenderPlan) {
  const startTimes = new Map<string, number>();
  let cursor = 0;

  for (let index = 0; index < book.pages.length; index += 1) {
    const page = book.pages[index]!;
    startTimes.set(page.id, Number(cursor.toFixed(3)));
    const transition = book.transitions[index];
    cursor += page.durationSec - (transition?.durationSec ?? 0);
  }

  return startTimes;
}

export function calculateBookClipTimings(book: BookRenderPlan) {
  const pageTimings = calculateBookPageTimings(book);
  const clipTimings = new Map<string, number>();

  for (const page of book.pages) {
    const pageStart = pageTimings.get(page.id) ?? 0;
    for (const slot of page.slots) {
      clipTimings.set(slot.clipId, Number((pageStart + slot.startSecWithinPage).toFixed(3)));
    }
  }

  return clipTimings;
}
