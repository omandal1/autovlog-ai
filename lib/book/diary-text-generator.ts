import {
  isMeaningfulContentText,
  normalizeContentText,
  transcriptContentText
} from "@/lib/analysis/content-text";
import type { MediaAsset, MediaType, PageVibeClassification, TimelineClip } from "@/lib/types";

export interface MediaTextSummary {
  mediaId: string;
  mediaType: MediaType;
  visualObservations: string[];
  transcriptObservations: string[];
  ocrObservations: string[];
  audioEvents: string[];
  date?: string;
  peopleHint?: string;
  confidence: number;
  fallbackMetadata: {
    filename?: string;
  };
}

export interface PageTextContext {
  pageMediaIds: string[];
  mediaSummaries: MediaTextSummary[];
  visualObservations: string[];
  transcriptObservations: string[];
  ocrObservations: string[];
  audioEvents: string[];
  vibe?: PageVibeClassification;
  chapterContext: {
    title?: string;
  };
  fallbackMetadata: Array<{
    mediaId: string;
    filename?: string;
  }>;
  confidence: number;
}

const OBJECT_LABELS: Record<string, string> = {
  animal: "an animal",
  applause: "applause",
  beach: "the beach",
  building: "buildings",
  campus: "campus life",
  car: "a car",
  cat: "a cat",
  celebration: "a celebration",
  class: "class",
  classroom: "a classroom",
  concert: "music in the room",
  crowd: "a crowd",
  dog: "a dog",
  dogs: "dogs",
  food: "food on the table",
  friend: "friends",
  friends: "friends",
  group: "a group together",
  laughing: "laughter",
  nightlife: "late-night lights",
  party: "a party",
  people: "people together",
  person: "a person",
  pet: "a pet",
  pets: "pets",
  restaurant: "a meal out",
  sign: "a sign",
  singing: "singing",
  sports: "game-day energy",
  stage: "a stage",
  study: "study time",
  sunset: "a sunset",
  travel: "being somewhere different"
};

const SEMANTIC_LABELS: Record<string, string> = {
  "high-energy": "high-energy movement",
  highlight: "a standout frame",
  "moody-still": "a quieter low-light still",
  "story-beat": "a fuller story beat",
  steady: "a steady everyday scene"
};

const EVENT_LABELS: Record<string, string> = {
  applause: "applause",
  cheering: "cheering",
  "crowd-energy": "crowd energy",
  crowd: "crowd energy",
  laughter: "laughter",
  singalong: "music in the background",
  singing: "singing"
};

function compactSentence(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const trimmed = normalized.slice(0, maxLength - 3);
  const lastSpace = trimmed.lastIndexOf(" ");
  return `${trimmed.slice(0, Math.max(28, lastSpace)).trim()}...`;
}

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function formatDate(value?: string) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function openerForPage(pageIndex: number) {
  return pageIndex % 3 === 0
    ? "Dear diary:"
    : pageIndex % 3 === 1
      ? "Note to self:"
      : "Memory check:";
}

function readableList(values: string[]) {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function observationFromTag(tag?: string) {
  const rawKey = tag?.trim().toLowerCase();
  const normalized = normalizeContentText(tag)?.toLowerCase();
  if (!normalized || !isMeaningfulContentText(normalized)) {
    return undefined;
  }

  const semantic = (rawKey && SEMANTIC_LABELS[rawKey]) ?? SEMANTIC_LABELS[normalized.replace(/\s+/g, "-")];
  if (semantic) {
    return semantic;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const objectToken = tokens.find((token) => OBJECT_LABELS[token]);
  if (objectToken) {
    return OBJECT_LABELS[objectToken];
  }

  return normalized.length <= 28 ? normalized : undefined;
}

function observationsFromAsset(asset?: MediaAsset, clip?: TimelineClip) {
  const observations: string[] = [];
  const tags = unique([
    asset?.analysis?.semanticHint,
    ...(clip?.sceneTags ?? [])
  ]);

  for (const tag of tags) {
    const observation = observationFromTag(tag);
    if (observation) {
      observations.push(observation);
    }
  }

  const face = asset?.analysis?.faceCluster;
  if (face?.faceLike && face.faceScore >= 0.48) {
    observations.push(face.recurrenceCount >= 2 ? "familiar people" : "people in the frame");
  } else if ((asset?.score?.faceHint ?? 0) >= 0.58) {
    observations.push("people in the frame");
  }

  const motion = asset?.score?.motion ?? 0;
  if (clip?.mediaType === "video" && motion >= 0.45) {
    observations.push("movement in the moment");
  }

  const brightness = asset?.score?.brightness;
  const contrast = asset?.score?.contrast;
  if (typeof brightness === "number" && brightness < 0.36) {
    observations.push("low-light atmosphere");
  } else if (typeof brightness === "number" && brightness > 0.64 && (contrast ?? 0) > 0.42) {
    observations.push("bright details");
  }

  return unique(observations).slice(0, 5);
}

function audioEventsFromAsset(asset?: MediaAsset) {
  return unique(
    asset?.analysis?.dialogueEvents?.map((event) => EVENT_LABELS[event] ?? observationFromTag(event)) ?? []
  );
}

function transcriptFromAsset(asset?: MediaAsset, clip?: TimelineClip) {
  const transcript =
    transcriptContentText(asset?.analysis?.transcriptResult) ??
    (isMeaningfulContentText(clip?.transcriptText) ? normalizeContentText(clip?.transcriptText) : undefined);
  return transcript ? [compactSentence(transcript, 78)] : [];
}

function summarizeMedia(clip: TimelineClip, asset?: MediaAsset): MediaTextSummary {
  const visualObservations = observationsFromAsset(asset, clip);
  const transcriptObservations = transcriptFromAsset(asset, clip);
  const audioEvents = audioEventsFromAsset(asset);
  const peopleHint = visualObservations.find((item) => /people|friend|group/.test(item));
  const confidence = Math.min(
    1,
    (visualObservations.length ? 0.22 : 0) +
      (transcriptObservations.length ? 0.38 : 0) +
      (audioEvents.length ? 0.18 : 0) +
      (peopleHint ? 0.14 : 0) +
      ((asset?.analysis?.semanticHint && asset.analysis.semanticHint !== "steady") ? 0.12 : 0) +
      ((asset?.score?.total ?? 0) >= 0.58 ? 0.08 : 0)
  );

  return {
    mediaId: clip.assetId,
    mediaType: clip.mediaType,
    visualObservations,
    transcriptObservations,
    ocrObservations: [],
    audioEvents,
    date: formatDate(asset?.metadata.capturedAt ?? clip.capturedAt),
    peopleHint,
    confidence,
    fallbackMetadata: {
      filename: asset?.filename ?? clip.filename
    }
  };
}

export function buildPageTextContext(options: {
  clips: TimelineClip[];
  assets?: MediaAsset[];
  chapterTitle?: string;
  vibe?: PageVibeClassification;
}): PageTextContext {
  const assetMap = new Map(options.assets?.map((asset) => [asset.id, asset]) ?? []);
  const mediaSummaries = options.clips.map((clip) => summarizeMedia(clip, assetMap.get(clip.assetId)));
  const confidence = mediaSummaries.length
    ? mediaSummaries.reduce((sum, summary) => sum + summary.confidence, 0) / mediaSummaries.length
    : 0;

  return {
    pageMediaIds: options.clips.map((clip) => clip.assetId),
    mediaSummaries,
    visualObservations: unique(mediaSummaries.flatMap((summary) => summary.visualObservations)),
    transcriptObservations: unique(mediaSummaries.flatMap((summary) => summary.transcriptObservations)),
    ocrObservations: unique(mediaSummaries.flatMap((summary) => summary.ocrObservations)),
    audioEvents: unique(mediaSummaries.flatMap((summary) => summary.audioEvents)),
    vibe: options.vibe,
    chapterContext: {
      title: isMeaningfulContentText(options.chapterTitle) ? normalizeContentText(options.chapterTitle) : undefined
    },
    fallbackMetadata: mediaSummaries.map((summary) => ({
      mediaId: summary.mediaId,
      filename: summary.fallbackMetadata.filename
    })),
    confidence
  };
}

function vibeClause(vibe?: PageVibeClassification) {
  switch (vibe?.primary) {
    case "concert":
      return "loud in the best way";
    case "sports":
      return "full of game-day electricity";
    case "study":
      return "quiet and very real";
    case "campus":
      return "like ordinary campus life turning into a keepsake";
    case "friends":
      return "held together by the people in it";
    case "travel":
      return "like proof that we made it somewhere different";
    case "nightlife":
      return "late, blurry, and worth keeping";
    case "celebration":
      return "like something everyone wanted to remember";
    case "dialogue":
      return "like I can still hear the room";
    case "photo-dump":
      return "like a handful of little pieces from the same day";
    default:
      return "small, real, and worth saving";
  }
}

function pickSubject(context: PageTextContext) {
  const subjects = context.visualObservations.filter(
    (item) =>
      ![
        "a steady everyday scene",
        "a fuller story beat",
        "a standout frame",
        "bright details",
        "movement in the moment"
      ].includes(item)
  );
  return readableList(subjects.slice(0, 2));
}

function dateLead(context: PageTextContext) {
  const date = context.mediaSummaries.map((summary) => summary.date).find(Boolean);
  return date ? `${date} felt like this: ` : "";
}

function mediaMix(context: PageTextContext) {
  const videos = context.mediaSummaries.filter((summary) => summary.mediaType === "video").length;
  const photos = context.mediaSummaries.length - videos;
  if (videos && photos) {
    return "a mix of motion and still photos";
  }
  if (videos > 1) {
    return "these little video moments";
  }
  if (videos === 1) {
    return "this video moment";
  }
  if (photos > 1) {
    return "these photos";
  }
  return "this photo";
}

export function generateDiaryPageText(options: {
  clips: TimelineClip[];
  assets?: MediaAsset[];
  chapterTitle: string;
  vibe?: PageVibeClassification;
  pageIndex: number;
}) {
  const context = buildPageTextContext(options);
  const opener = openerForPage(options.pageIndex);
  const subject = pickSubject(context);
  const quote = context.transcriptObservations[0];
  const events = readableList(context.audioEvents.slice(0, 2));
  const visual = readableList(context.visualObservations.slice(0, 2));
  const date = dateLead(context);

  if (quote && context.confidence >= 0.38) {
    const scene = subject || visual || mediaMix(context);
    return compactSentence(`${opener} ${date}I can still hear "${quote}" around ${scene}.`, 150);
  }

  if (events && subject) {
    return compactSentence(`${opener} ${date}${events} wrapped around ${subject}, and the page still feels ${vibeClause(context.vibe)}.`, 150);
  }

  if (subject) {
    return compactSentence(`${opener} ${date}This page seems to center on ${subject}, the kind of moment that feels ${vibeClause(context.vibe)}.`, 150);
  }

  if (context.visualObservations.includes("high-energy movement")) {
    return compactSentence(`${opener} ${date}This page caught the lively part of the day, all motion and small flashes worth saving.`, 150);
  }

  if (context.visualObservations.includes("a quieter low-light still") || context.visualObservations.includes("low-light atmosphere")) {
    return compactSentence(`${opener} ${date}A softer low-light memory, quiet enough that the little details get to be the whole story.`, 150);
  }

  if (context.mediaSummaries.length > 1 && visual) {
    return compactSentence(`${opener} ${date}${mediaMix(context)} came together into a page that still feels ${vibeClause(context.vibe)}.`, 150);
  }

  return compactSentence(`${opener} ${date}This felt like one of those small, real moments worth saving.`, 150);
}
