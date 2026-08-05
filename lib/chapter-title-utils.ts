import type { Chapter, ChapterPlan, PreviewPlan, ProjectRecord, StoryPlan, Timeline } from "@/lib/types";

const ROMAN_SUFFIXES = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function normalizeTitleValue(title: string | undefined, index: number, fallbackPrefix: string) {
  const cleaned = title?.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length ? cleaned : `${fallbackPrefix} ${index + 1}`;
}

function duplicateSuffix(occurrence: number) {
  const roman = ROMAN_SUFFIXES[occurrence - 2];
  return roman ? ` ${roman}` : ` (${occurrence})`;
}

export function ensureUniqueTitleList(titles: string[], fallbackPrefix = "Chapter") {
  const seen = new Map<string, number>();

  return titles.map((title, index) => {
    const baseTitle = normalizeTitleValue(title, index, fallbackPrefix);
    const key = baseTitle.toLocaleLowerCase();
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return occurrence === 1 ? baseTitle : `${baseTitle}${duplicateSuffix(occurrence)}`;
  });
}

export function ensureUniqueChapterTitles<T extends { title: string }>(
  items: T[],
  fallbackPrefix = "Chapter"
) {
  const titles = ensureUniqueTitleList(
    items.map((item) => item.title),
    fallbackPrefix
  );

  return items.map((item, index) => ({
    ...item,
    title: titles[index]!
  }));
}

function normalizeStoryPlan(storyPlan?: StoryPlan): StoryPlan | undefined {
  if (!storyPlan) {
    return undefined;
  }

  const chapterPlans = ensureUniqueChapterTitles(storyPlan.chapterPlans, "Chapter");
  return {
    ...storyPlan,
    chapterPlans
  };
}

function normalizeChapterTimelineTitles(timelines: Timeline[], storyPlan?: StoryPlan) {
  if (!storyPlan) {
    return timelines;
  }

  const titlesByChapterId = new Map(
    storyPlan.chapterPlans.map((plan) => [plan.chapterId, plan.title])
  );

  return timelines.map((timeline) => {
    if (timeline.kind !== "chapter") {
      return timeline;
    }

    const chapterId = timeline.chapterOrder[0];
    const title = chapterId ? titlesByChapterId.get(chapterId) : undefined;
    return title
      ? {
          ...timeline,
          title
        }
      : timeline;
  });
}

function normalizePreviewPlan(previewPlan: PreviewPlan): PreviewPlan {
  const storyPlan = normalizeStoryPlan(previewPlan.storyPlan)!;
  return {
    ...previewPlan,
    chapterTitles: storyPlan.chapterPlans.map((plan) => plan.title),
    storyPlan,
    chapterTimelines: normalizeChapterTimelineTitles(previewPlan.chapterTimelines, storyPlan)
  };
}

export function normalizeProjectChapterTitles(project: ProjectRecord): ProjectRecord {
  const chapters = ensureUniqueChapterTitles(project.chapters, "Chapter");
  const storyPlan = normalizeStoryPlan(project.storyPlan);
  const previewPlans = (project.previewPlans ?? []).map(normalizePreviewPlan);

  return {
    ...project,
    chapters,
    storyPlan,
    previewPlans
  };
}
