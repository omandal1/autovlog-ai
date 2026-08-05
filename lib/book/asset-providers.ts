import type {
  DecorationAsset,
  DecorationAssetProvider,
  DecorationLevel,
  PageEventType,
  PageVibeClassification,
  ThemePreset
} from "@/lib/types";

const BASE_ASSETS: DecorationAsset[] = [
  { id: "campus-label", label: "Campus label", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 160, height: 48, tags: ["campus", "study", "yearbook"], renderKind: "label-tag", text: "Campus days", color: "0xC99A62", priority: 7 },
  { id: "concert-pass", label: "Concert pass", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 168, height: 64, tags: ["concert", "music", "nightlife"], renderKind: "stamp", text: "Live set", color: "0xE68AAE", priority: 8 },
  { id: "game-day", label: "Game day chip", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 152, height: 44, tags: ["sports", "football", "celebration"], renderKind: "date-chip", text: "Game day", color: "0xD98D57", priority: 8 },
  { id: "study-note", label: "Study note", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 192, height: 56, tags: ["study", "campus"], renderKind: "note-strip", text: "library + lecture notes", color: "0xEFDAB8", priority: 6 },
  { id: "friends-caption", label: "Friends caption", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 184, height: 50, tags: ["friends", "social", "celebration"], renderKind: "caption-plaque", text: "best people, best memories", color: "0xB76F6A", priority: 8 },
  { id: "travel-postcard", label: "Travel postcard", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 208, height: 68, tags: ["travel", "postcard"], renderKind: "note-strip", text: "wish you were here", color: "0xE3D0B0", priority: 8 },
  { id: "music-emoji", label: "Music emoji", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 64, height: 64, tags: ["concert", "music", "nightlife"], renderKind: "emoji-sticker", text: "🎵", color: "#f5b37a", priority: 7 },
  { id: "cap-emoji", label: "Cap emoji", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 64, height: 64, tags: ["campus", "study", "friends"], renderKind: "emoji-sticker", text: "🎓", color: "#f5b37a", priority: 7 },
  { id: "camera-emoji", label: "Camera emoji", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 64, height: 64, tags: ["travel", "friends", "photo-dump"], renderKind: "emoji-sticker", text: "📸", color: "#f5b37a", priority: 6 },
  { id: "spark-emoji", label: "Spark emoji", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 64, height: 64, tags: ["general", "celebration", "friends"], renderKind: "emoji-sticker", text: "✨", color: "#f5b37a", priority: 5 },
  { id: "heart-emoji", label: "Heart emoji", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 64, height: 64, tags: ["friends", "emotional"], renderKind: "emoji-sticker", text: "❤️", color: "#f57d8f", priority: 7 },
  { id: "ticket-stub", label: "Ticket stub", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 176, height: 56, tags: ["concert", "travel", "events"], renderKind: "stamp", text: "Admit one", color: "0xD7B487", priority: 7 },
  { id: "map-note", label: "Map note", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 170, height: 58, tags: ["travel", "campus"], renderKind: "label-tag", text: "route saved", color: "0xA1B9C7", priority: 6 },
  { id: "study-doodle", label: "Study doodle", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 120, height: 14, tags: ["study", "campus"], renderKind: "doodle-line", color: "#b3824c", priority: 4 },
  { id: "social-star", label: "Social star", source: "local", licenseType: "built-in", allowedUse: "export-safe", width: 56, height: 56, tags: ["friends", "social", "nightlife"], renderKind: "sticker-star", text: "✦", color: "#f5b37a", priority: 4 }
];

function expandedTags(vibe: PageVibeClassification, themePreset: ThemePreset) {
  return new Set<string>([
    vibe.primary,
    vibe.secondary ?? "",
    ...vibe.tags,
    vibe.vibe,
    themePreset,
    "general"
  ]);
}

function densityCap(level: DecorationLevel) {
  return level === "minimal" ? 4 : level === "rich" ? 9 : 6;
}

export class LocalAssetProvider implements DecorationAssetProvider {
  name = "local-safe-assets";

  async listAssets(input: {
    pageVibe: PageVibeClassification;
    themePreset: ThemePreset;
    density: DecorationLevel;
  }) {
    const tagSet = expandedTags(input.pageVibe, input.themePreset);
    const ranked = BASE_ASSETS.filter((asset) =>
      asset.tags.some((tag) => tagSet.has(tag))
    ).sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));

    return ranked.slice(0, densityCap(input.density));
  }
}

export class LicensedOnlineAssetProvider implements DecorationAssetProvider {
  name = "licensed-online-assets";

  async listAssets() {
    return [];
  }
}

export class UserUploadedAssetProvider implements DecorationAssetProvider {
  name = "user-uploaded-assets";

  async listAssets() {
    return [];
  }
}

export function listLocalDecorationAssetsSync(input: {
  pageVibe: PageVibeClassification;
  themePreset: ThemePreset;
  density: DecorationLevel;
}) {
  const tagSet = expandedTags(input.pageVibe, input.themePreset);
  return BASE_ASSETS.filter((asset) => asset.tags.some((tag) => tagSet.has(tag)))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
    .slice(0, densityCap(input.density));
}

export function eventTagsForPrimary(primary: PageEventType) {
  switch (primary) {
    case "concert":
      return ["concert", "music", "nightlife"];
    case "sports":
      return ["sports", "football", "celebration"];
    case "study":
      return ["study", "campus"];
    case "campus":
      return ["campus", "study"];
    case "friends":
      return ["friends", "social"];
    case "travel":
      return ["travel", "postcard"];
    case "nightlife":
      return ["nightlife", "concert", "social"];
    case "celebration":
      return ["celebration", "friends"];
    case "dialogue":
      return ["friends", "social"];
    case "photo-dump":
      return ["photo-dump", "friends"];
    default:
      return ["general"];
  }
}
