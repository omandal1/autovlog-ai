import type {
  BookOpeningAnimationConfig,
  GenerationSettings,
  ThemePresetConfig
} from "@/lib/types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function buildOpeningAnimationConfig(options: {
  theme: ThemePresetConfig;
  generation: GenerationSettings;
}): BookOpeningAnimationConfig {
  const baseDuration =
    options.generation.pacing === "fast"
      ? 1.5
      : options.generation.pacing === "slow-sentimental"
        ? 2.35
        : 1.95;
  const storyBoost =
    options.generation.storyStyle === "cinematic"
      ? 0.28
      : options.generation.storyStyle === "emotional"
        ? 0.18
        : options.generation.storyStyle === "energetic"
          ? -0.12
          : 0;

  return {
    type: "closed-book-open",
    durationSec: Number(clamp(baseDuration + storyBoost, 1.35, 2.8).toFixed(3)),
    cameraAngle: options.theme.introCamera,
    openDirection:
      options.theme.pageTurnStyle === "quick-flick" ? "right-to-left" : "left-to-right",
    shadowStrength:
      options.generation.themePreset === "cinematic-journal" ? 0.42 : 0.32,
    coverLift:
      options.generation.storyStyle === "energetic" ? 34 : options.generation.storyStyle === "cinematic" ? 48 : 42,
    perspectiveStrength:
      options.theme.introCamera === "angled-top" ? 0.22 : 0.14
  };
}
