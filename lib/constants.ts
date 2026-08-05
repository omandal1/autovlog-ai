import type {
  AspectRatioOption,
  AudioEmphasis,
  ClipDensity,
  DecorationLevel,
  GenerationSettings,
  GenerationMode,
  MusicStyle,
  OrderingPreference,
  PacingMode,
  StoryStyle,
  SubjectEmphasis,
  ThemePreset,
  TitleStyle,
  Tone
} from "@/lib/types";

export const APP_NAME = "AutoVlog AI";
export const DEFAULT_STORAGE_ROOT = "storage/projects";
export const DEFAULT_ACCOUNT_STORAGE_ROOT = "storage/accounts";
export const MASTER_TARGET_DURATION_SEC = 300;
export const CHAPTER_TARGET_DURATION_SEC = 60;
export const MIN_PROJECT_CHAPTERS = 3;
export const MAX_PROJECT_CHAPTERS = 10;
export const CHAPTER_POLICY = {
  minChapters: MIN_PROJECT_CHAPTERS,
  maxChapters: MAX_PROJECT_CHAPTERS,
  targetAssetsPerChapter: 36,
  targetRuntimeWindowSec: CHAPTER_TARGET_DURATION_SEC * 1.4,
  minimumCoherentAssetsPerChapter: 3,
  minimumCoherentRuntimeSec: 12,
  gapHours: {
    medium: 2,
    strong: 6,
    veryStrong: 18
  }
} as const;
export const PREVIEW_PLAN_LIMIT = 3;
export const DUPLICATE_POLICY = {
  exactHashDistance: 2,
  nearHashDistance: 8,
  burstMinutes: 5,
  weakScoreThreshold: 0.24,
  heroScoreThreshold: 0.74,
  strongScoreThreshold: 0.58
} as const;
export const BEAT_ALIGNMENT_POLICY = {
  beatSnapToleranceSec: 0.18,
  phraseSnapToleranceSec: 0.36,
  dividerBiasSec: 0.22
} as const;
export const VIDEO_RESOLUTION = {
  width: 1280,
  height: 720,
  fps: 30
};
export const SOUNDTRACK_UPLOAD_POLICY = {
  maxTracks: 12,
  maxTrackBytes: 35 * 1024 * 1024,
  supportedExtensions: [".mp3"],
  supportedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/x-mpeg", "application/octet-stream"],
  minimumUsableDurationSec: 4,
  defaultCrossfadeSec: 1.15,
  preferredMusicGainDb: -8.5
} as const;

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic"
]);

export const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".avi",
  ".webm"
]);

export const TONE_LABELS: Record<Tone, string> = {
  energetic: "Energetic",
  balanced: "Balanced",
  emotional: "Emotional"
};

export const DENSITY_LABELS: Record<ClipDensity, string> = {
  "fast-cuts": "Fast cuts",
  "slow-cuts": "Slow cuts"
};

export const MUSIC_LABELS: Record<MusicStyle, string> = {
  cinematic: "Cinematic",
  lofi: "Lo-fi",
  none: "No music"
};

export const STORY_STYLE_LABELS: Record<StoryStyle, string> = {
  cinematic: "Cinematic",
  authentic: "Authentic",
  emotional: "Emotional",
  energetic: "Energetic",
  balanced: "Balanced"
};

export const SUBJECT_EMPHASIS_LABELS: Record<SubjectEmphasis, string> = {
  friends: "Friends",
  "campus-scenery": "Campus scenery",
  "activities-events": "Activities and events",
  "dialogue-moments": "Dialogue moments",
  balanced: "Balanced"
};

export const AUDIO_EMPHASIS_LABELS: Record<AudioEmphasis, string> = {
  "original-audio-forward": "Original audio forward",
  "music-forward": "Music forward",
  balanced: "Balanced"
};

export const PACING_MODE_LABELS: Record<PacingMode, string> = {
  fast: "Fast",
  balanced: "Balanced",
  "slow-sentimental": "Slow sentimental"
};

export const ORDERING_LABELS: Record<OrderingPreference, string> = {
  "strict-chronological": "Strict chronological",
  "mostly-chronological": "Mostly chronological",
  "best-story-order": "Best story order"
};

export const THEME_PRESET_LABELS: Record<ThemePreset, string> = {
  scrapbook: "Scrapbook",
  yearbook: "Yearbook",
  "photo-album": "Photo Album",
  "cinematic-journal": "Cinematic Journal",
  "minimal-clean": "Minimal Clean"
};

export const TITLE_STYLE_LABELS: Record<TitleStyle, string> = {
  simple: "Simple",
  nostalgic: "Nostalgic",
  yearbook: "Yearbook",
  scrapbook: "Scrapbook",
  cinematic: "Cinematic"
};

export const DECORATION_LEVEL_LABELS: Record<DecorationLevel, string> = {
  minimal: "Minimal",
  balanced: "Balanced",
  rich: "Rich"
};

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  generationMode: "memory-book",
  storyStyle: "balanced",
  subjectEmphasis: "balanced",
  audioEmphasis: "balanced",
  pacing: "balanced",
  ordering: "mostly-chronological",
  themePreset: "scrapbook",
  titleStyle: "nostalgic",
  decorationLevel: "balanced",
  aspectRatio: "landscape-16x9"
};

export const GENERATION_MODE_LABELS: Record<GenerationMode, string> = {
  "memory-book": "Memory Book"
};

export const ASPECT_RATIO_LABELS: Record<AspectRatioOption, string> = {
  "landscape-16x9": "Landscape 16:9"
};
