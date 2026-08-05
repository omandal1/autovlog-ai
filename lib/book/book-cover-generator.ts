import type { BookCoverMetadata, ProjectRecord, Timeline } from "@/lib/types";

import { resolveBookMaterial } from "@/lib/book/page-material-system";
import { resolveBookTextTreatment } from "@/lib/book/text-treatment-system";
import { getThemePresetConfig } from "@/lib/themes/theme-registry";

function resolveYearLabel(project: ProjectRecord) {
  const dates = project.assets
    .map((asset) => asset.metadata.capturedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  if (!dates.length) {
    return undefined;
  }

  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  return first.getUTCFullYear() === last.getUTCFullYear()
    ? `${first.getUTCFullYear()}`
    : `${first.getUTCFullYear()}-${last.getUTCFullYear()}`;
}

function prettifyProjectName(name: string) {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveMasterTitle(project: ProjectRecord) {
  const cleanedName = prettifyProjectName(project.name);
  const yearLabel = resolveYearLabel(project);
  if (cleanedName && !/^college upload/i.test(cleanedName)) {
    return cleanedName.length > 34 ? "College Memories" : cleanedName;
  }
  if (yearLabel) {
    return `College Memories ${yearLabel}`;
  }
  return "College Memories";
}

function resolveChapterTitle(timeline: Timeline) {
  if (timeline.title && !/^chapter\s+\d+$/i.test(timeline.title)) {
    return timeline.title;
  }
  return timeline.kind === "chapter" ? "Chapter Memories" : "College Memories";
}

export function buildBookCover(project: ProjectRecord, timeline: Timeline): BookCoverMetadata {
  const theme = getThemePresetConfig(project.settings.generation?.themePreset ?? "scrapbook");
  const generation = project.settings.generation!;
  const title = timeline.title || (timeline.kind === "master" ? resolveMasterTitle(project) : resolveChapterTitle(timeline));
  const subtitle =
    timeline.subtitle ??
    (timeline.kind === "master"
      ? `${project.chapters.length} chapter ${theme.label.toLowerCase()} memory book`
      : `${theme.label} chapter edition`);
  const accentLabel =
    timeline.kind === "master"
      ? generation.titleStyle === "yearbook"
        ? "Yearbook Recap"
        : generation.titleStyle === "cinematic"
          ? "Cinematic Journal"
          : generation.themePreset === "scrapbook"
            ? "Scrapbook Edition"
            : "Memory Book"
      : generation.titleStyle === "scrapbook"
        ? "Pinned Chapter"
        : "Chapter Story";
  const material = resolveBookMaterial(theme, "cover-burgundy");
  const textTreatment = resolveBookTextTreatment({
    theme,
    titleStyle: generation.titleStyle,
    kind: "cover",
    accentLabel
  });

  return {
    title,
    subtitle,
    accentLabel,
    coverStyle: "cover-burgundy",
    durationSec:
      generation.pacing === "slow-sentimental"
        ? timeline.kind === "master"
          ? 4.8
          : 3.8
        : timeline.kind === "master"
          ? 4.2
          : 3.4,
    material,
    textTreatment
  };
}
