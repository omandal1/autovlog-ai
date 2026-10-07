import {
  ASPECT_RATIO_LABELS,
  DECORATION_LEVEL_LABELS,
  DEFAULT_GENERATION_SETTINGS,
  DENSITY_LABELS,
  MUSIC_LABELS,
  ORDERING_LABELS,
  STORY_STYLE_LABELS,
  SUBJECT_EMPHASIS_LABELS,
  THEME_PRESET_LABELS,
  TITLE_STYLE_LABELS
} from "@/lib/constants";
import type {
  AspectRatioOption,
  AudioEmphasis,
  DecorationLevel,
  GenerationSettings,
  MusicSelectionSettings,
  OrderingPreference,
  PacingMode,
  ProjectSettings,
  StoryStyle,
  SubjectEmphasis,
  ThemePreset,
  TitleStyle
} from "@/lib/types";
import { normalizeWallFrameSettings } from "@/lib/wall-frame/style-registry";

export const pacingOptions: Array<{ value: PacingMode; label: string }> = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "slow-sentimental", label: "Slow sentimental" }
];

export function normalizeGenerationSettings(settings?: Partial<GenerationSettings>) {
  const generationMode = settings?.generationMode === "wall-frame" ? "wall-frame" : "memory-book";
  return {
    ...DEFAULT_GENERATION_SETTINGS,
    ...settings,
    generationMode,
    aspectRatio: "landscape-16x9",
    wallFrameStyleSettings: normalizeWallFrameSettings(settings?.wallFrameStyleSettings)
  } satisfies GenerationSettings;
}

function stableLegacySoundtrackId(value: string) {
  return `snd_${value
    .split("")
    .reduce((sum, char, index) => (sum + char.charCodeAt(0) * (index + 1)) % 1000000007, 0)
    .toString(36)}`;
}

export function normalizeMusicSelectionSettings(
  selection?: Partial<MusicSelectionSettings> & {
    legacyReferenceTracks?: unknown[];
  }
): MusicSelectionSettings | undefined {
  if (!selection) {
    return undefined;
  }

  const legacyUploaded = selection.uploadedAudio;
  const uploadedSoundtracks =
    selection.uploadedSoundtracks?.length
      ? selection.uploadedSoundtracks
      : legacyUploaded
        ? [
            {
              id: stableLegacySoundtrackId(legacyUploaded.path || legacyUploaded.filename),
              filename: legacyUploaded.filename,
              title: legacyUploaded.filename,
              artist: "Uploaded MP3",
              path: legacyUploaded.path,
              mimeType: legacyUploaded.mimeType,
              byteSize: 0,
              status: "ready" as const,
              analysis: legacyUploaded.durationSec
                ? {
                    durationSec: legacyUploaded.durationSec,
                    energyScore: 0.55,
                    stableStartSec: 0,
                    stableEndSec: legacyUploaded.durationSec,
                    confidence: 0.3,
                    source: "fallback" as const
                  }
                : undefined
            }
          ]
        : [];

  if (!uploadedSoundtracks.length && selection.sourcePolicy !== "user-uploaded-audio") {
    return {
      sourcePolicy: "internal-licensed",
      exportPolicy: "internal-licensed",
      note: selection.note,
      uploadedSoundtracks: [],
      preferredTrackOrder: [],
      soundtrackStrategy: "auto-select-best-segments"
    };
  }

  return {
    sourcePolicy: uploadedSoundtracks.length ? "user-uploaded-audio" : "internal-licensed",
    exportPolicy: uploadedSoundtracks.length ? "direct-user-audio" : "internal-licensed",
    note:
      selection.note ??
      (uploadedSoundtracks.length
        ? "Using uploaded MP3 soundtrack material for the final AutoVlog render."
        : undefined),
    uploadedSoundtracks,
    preferredTrackOrder:
      selection.preferredTrackOrder?.length
        ? selection.preferredTrackOrder
        : uploadedSoundtracks.map((track) => track.id),
    soundtrackStrategy: selection.soundtrackStrategy ?? "auto-select-best-segments",
    uploadedAudio: legacyUploaded
  };
}

function inferGenerationSettingsFromLegacy(settings: ProjectSettings): Partial<GenerationSettings> {
  return {
    storyStyle:
      settings.tone === "energetic"
        ? "energetic"
        : settings.tone === "emotional"
          ? "emotional"
          : "balanced",
    audioEmphasis:
      settings.musicStyle === "none"
        ? "original-audio-forward"
        : settings.musicStyle === "lofi"
          ? "balanced"
          : "music-forward",
    pacing:
      settings.clipDensity === "slow-cuts" ? "slow-sentimental" : "fast"
  };
}

export function normalizeProjectSettings(settings: ProjectSettings): ProjectSettings {
  const generation = normalizeGenerationSettings(
    settings.generation ?? inferGenerationSettingsFromLegacy(settings)
  );
  const legacy = deriveLegacySettingsFromGeneration(generation);
  return {
    ...settings,
    tone: settings.generation ? legacy.tone : settings.tone ?? legacy.tone,
    clipDensity: settings.generation
      ? legacy.clipDensity
      : settings.clipDensity ?? legacy.clipDensity,
    musicStyle: settings.generation ? legacy.musicStyle : settings.musicStyle ?? legacy.musicStyle,
    generation,
    musicSelection: normalizeMusicSelectionSettings(settings.musicSelection)
  };
}

export function deriveLegacySettingsFromGeneration(generation: GenerationSettings) {
  const musicStyle =
    generation.storyStyle === "authentic"
        ? "lofi"
        : "cinematic";
  return {
    tone:
      generation.storyStyle === "energetic"
        ? "energetic"
        : generation.storyStyle === "emotional"
          ? "emotional"
          : "balanced",
    clipDensity:
      generation.pacing === "fast"
        ? "fast-cuts"
        : generation.pacing === "slow-sentimental"
          ? "slow-cuts"
          : "fast-cuts",
    musicStyle
  } as const;
}

export function mergeProjectSettings(
  current: ProjectSettings,
  patch: Partial<ProjectSettings> & { generation?: Partial<GenerationSettings> }
) {
  const currentNormalized = normalizeProjectSettings(current);
  const generation = normalizeGenerationSettings({
    ...currentNormalized.generation,
    ...patch.generation
  });
  const legacyFromGeneration = deriveLegacySettingsFromGeneration(generation);

  return normalizeProjectSettings({
    ...currentNormalized,
    ...patch,
    tone: patch.tone ?? legacyFromGeneration.tone,
    clipDensity: patch.clipDensity ?? legacyFromGeneration.clipDensity,
    musicStyle: patch.musicStyle ?? legacyFromGeneration.musicStyle,
    musicSelection: normalizeMusicSelectionSettings(
      patch.musicSelection
        ? {
            ...currentNormalized.musicSelection,
            ...patch.musicSelection
          }
        : currentNormalized.musicSelection
    ),
    generation
  });
}

export const steeringOptionLabels = {
  storyStyle: STORY_STYLE_LABELS,
  subjectEmphasis: SUBJECT_EMPHASIS_LABELS,
  audioEmphasis: {
    "original-audio-forward": "Original audio forward",
    "music-forward": "Music forward",
    balanced: "Balanced"
  } satisfies Record<AudioEmphasis, string>,
  ordering: ORDERING_LABELS,
  pacing: {
    fast: "Fast",
    balanced: "Balanced",
    "slow-sentimental": "Slow sentimental"
  } satisfies Record<PacingMode, string>,
  themePreset: THEME_PRESET_LABELS,
  titleStyle: TITLE_STYLE_LABELS,
  decorationLevel: DECORATION_LEVEL_LABELS,
  aspectRatio: ASPECT_RATIO_LABELS
};

export const steeringOptionDescriptions = {
  storyStyle: {
    cinematic: "Shape the recap with stronger highlights and polished structure.",
    authentic: "Favor real-life continuity and less stylized sequencing.",
    emotional: "Lean into sentimental beats and softer closings.",
    energetic: "Bias toward motion, social peaks, and punchier openings.",
    balanced: "Keep a versatile memory-book mix."
  } satisfies Record<StoryStyle, string>,
  subjectEmphasis: {
    friends: "Prioritize recurring people and social moments.",
    "campus-scenery": "Give more room to scenic and atmosphere-driven media.",
    "activities-events": "Favor movement, outings, and event coverage.",
    "dialogue-moments": "Prefer clips with meaningful or lively audio moments.",
    balanced: "Keep representation broad."
  } satisfies Record<SubjectEmphasis, string>,
  audioEmphasis: {
    "original-audio-forward": "Preserve live clip audio whenever it adds authenticity.",
    "music-forward": "Let the soundtrack drive more of the pacing and feel.",
    balanced: "Blend both evenly."
  } satisfies Record<AudioEmphasis, string>,
  ordering: {
    "strict-chronological": "Keep events in strict time order.",
    "mostly-chronological": "Stay chronological with light story shaping.",
    "best-story-order": "Allow stronger reordering for a more deliberate arc."
  } satisfies Record<OrderingPreference, string>,
  themePreset: {
    scrapbook: "Layered, warm, and collage-like.",
    yearbook: "Structured, nostalgic, and editorial.",
    "photo-album": "Soft paper spreads with classic frames.",
    "cinematic-journal": "More moody and travel-diary inspired.",
    "minimal-clean": "Reduced ornament with clean composition."
  } satisfies Record<ThemePreset, string>,
  titleStyle: {
    simple: "Straightforward recap titles.",
    nostalgic: "Memory-driven, softer language.",
    yearbook: "Semester- and chapter-style phrasing.",
    scrapbook: "Playful handwritten-feeling titles.",
    cinematic: "A more polished recap voice."
  } satisfies Record<TitleStyle, string>,
  decorationLevel: {
    minimal: "Keep pages clean with only a few premium accents.",
    balanced: "Use a tasteful mix of stickers, labels, and tactile detail.",
    rich: "Lean into scrapbook flavor with fuller page dressing."
  } satisfies Record<DecorationLevel, string>,
  aspectRatio: {
    "landscape-16x9": "Best for the physical book-style canvas."
  } satisfies Record<AspectRatioOption, string>,
  tone: DENSITY_LABELS,
  musicStyle: MUSIC_LABELS
};
