import { transcriptContentText } from "@/lib/analysis/content-text";
import type {
  BookPage,
  MediaAsset,
  PageEventType,
  PageVibeClassification,
  ProjectRecord,
  TimelineClip,
  VlogVibe
} from "@/lib/types";

const KEYWORD_EVENTS: Array<{ event: PageEventType; tokens: string[] }> = [
  { event: "concert", tokens: ["concert", "tour", "setlist", "stage", "arena", "bruno", "music", "band"] },
  { event: "sports", tokens: ["football", "game", "stadium", "tailgate", "touchdown", "soccer", "basketball"] },
  { event: "study", tokens: ["study", "library", "class", "lecture", "exam", "midterm", "homework", "notes"] },
  { event: "campus", tokens: ["campus", "dorm", "quad", "college", "university", "move-in"] },
  { event: "travel", tokens: ["trip", "travel", "flight", "beach", "road", "postcard", "vacation"] },
  { event: "nightlife", tokens: ["night", "club", "party", "lights", "bar", "downtown"] },
  { event: "friends", tokens: ["friends", "group", "roommate", "bestie", "hangout"] }
];

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreEvent(text: string, event: PageEventType) {
  const entry = KEYWORD_EVENTS.find((item) => item.event === event);
  if (!entry) {
    return 0;
  }
  return entry.tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

function gatherTextSignals(assets: MediaAsset[]) {
  return assets
    .flatMap((asset) => [
      asset.analysis?.semanticHint,
      transcriptContentText(asset.analysis?.transcriptResult),
      asset.analysis?.dialogueEvents?.join(" ")
    ])
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function moodFromAssets(assets: MediaAsset[]): VlogVibe {
  const motion = average(assets.map((asset) => asset.score?.motion ?? 0));
  const brightness = average(assets.map((asset) => asset.score?.brightness ?? 0.5));
  const dialogue = average(
    assets.map((asset) => asset.analysis?.transcriptResult?.dialogueScore ?? 0)
  );
  if (motion > 0.42) {
    return "energetic";
  }
  if (dialogue > 0.48 || brightness < 0.42) {
    return "emotional";
  }
  if (brightness > 0.62) {
    return "cinematic";
  }
  return "chill";
}

export function classifyPageVibeFromAssets(assets: MediaAsset[]): PageVibeClassification {
  const text = gatherTextSignals(assets);
  const imageRatio =
    assets.filter((asset) => asset.mediaType === "image").length / Math.max(assets.length, 1);
  const faceRecurrence = average(assets.map((asset) => asset.analysis?.faceCluster?.recurrenceCount ?? 0));
  const eventScores = KEYWORD_EVENTS.map((entry) => ({
    event: entry.event,
    score: scoreEvent(text, entry.event)
  })).sort((left, right) => right.score - left.score);

  let primary = eventScores[0]?.event ?? "general";
  if (primary === "general" && faceRecurrence >= 2.2) {
    primary = "friends";
  }
  if (primary === "general" && imageRatio > 0.8) {
    primary = "photo-dump";
  }
  if (primary === "general" && text.includes("laugh")) {
    primary = "celebration";
  }

  return {
    primary,
    secondary: eventScores[1]?.score ? eventScores[1]?.event : undefined,
    vibe: moodFromAssets(assets),
    confidence: eventScores[0]?.score ? Math.min(0.92, 0.42 + eventScores[0].score * 0.14) : 0.34,
    tags: [
      primary,
      ...(eventScores.slice(0, 3).filter((item) => item.score > 0).map((item) => item.event))
    ],
    signals: text
      .split(/\s+/)
      .filter((token) => token.length > 3)
      .slice(0, 10)
  };
}

export function classifyPageVibe(options: {
  project: ProjectRecord;
  clips: Array<TimelineClip | BookPage["slots"][number]>;
}) {
  const assetMap = new Map(options.project.assets.map((asset) => [asset.id, asset]));
  const assets = options.clips
    .map((clip) => assetMap.get(clip.assetId))
    .filter((asset): asset is MediaAsset => Boolean(asset));
  return classifyPageVibeFromAssets(assets);
}
