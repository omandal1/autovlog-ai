import type { ThemePreset, ThemePresetConfig } from "@/lib/types";

export const THEME_REGISTRY: Record<ThemePreset, ThemePresetConfig> = {
  scrapbook: {
    id: "scrapbook",
    label: "Scrapbook",
    coverStyle: "cover-burgundy",
    pageStyle: "paper-rose",
    dividerStyle: "divider-slate",
    accentColor: "#f5b37a",
    frameTreatment: "polaroid",
    ornamentDensity: "high",
    captionTone: "warm",
    coverTexture: "leather",
    deskSurface: "oak-desk",
    paperTone: "warm-ivory",
    introCamera: "angled-top",
    pageTurnStyle: "dramatic-lift",
    stickerSet: ["tape", "stamp", "label", "doodle", "corner", "spark", "emoji", "note"],
    titleTreatment: "handwritten"
  },
  yearbook: {
    id: "yearbook",
    label: "Yearbook",
    coverStyle: "cover-navy",
    pageStyle: "paper-cream",
    dividerStyle: "cover-navy",
    accentColor: "#d8c37d",
    frameTreatment: "matte",
    ornamentDensity: "medium",
    captionTone: "editorial",
    coverTexture: "linen",
    deskSurface: "walnut-desk",
    paperTone: "cool-cream",
    introCamera: "top-down",
    pageTurnStyle: "classic-turn",
    stickerSet: ["label", "stamp", "corner", "emoji", "note"],
    titleTreatment: "yearbook"
  },
  "photo-album": {
    id: "photo-album",
    label: "Photo Album",
    coverStyle: "cover-burgundy",
    pageStyle: "paper-cream",
    dividerStyle: "paper-rose",
    accentColor: "#e7b9a7",
    frameTreatment: "polaroid",
    ornamentDensity: "medium",
    captionTone: "warm",
    coverTexture: "paper-wrap",
    deskSurface: "linen-cloth",
    paperTone: "rose-ivory",
    introCamera: "top-down",
    pageTurnStyle: "soft-arch",
    stickerSet: ["tape", "label", "corner", "spark", "emoji", "note"],
    titleTreatment: "editorial"
  },
  "cinematic-journal": {
    id: "cinematic-journal",
    label: "Cinematic Journal",
    coverStyle: "cover-navy",
    pageStyle: "paper-cream",
    dividerStyle: "cover-navy",
    accentColor: "#7bb4cb",
    frameTreatment: "journal",
    ornamentDensity: "low",
    captionTone: "editorial",
    coverTexture: "matte-board",
    deskSurface: "midnight-table",
    paperTone: "inkwashed",
    introCamera: "angled-top",
    pageTurnStyle: "soft-arch",
    stickerSet: ["label", "doodle", "spark", "note"],
    titleTreatment: "cinematic"
  },
  "minimal-clean": {
    id: "minimal-clean",
    label: "Minimal Clean",
    coverStyle: "cover-navy",
    pageStyle: "paper-cream",
    dividerStyle: "paper-cream",
    accentColor: "#b7b7b7",
    frameTreatment: "clean",
    ornamentDensity: "low",
    captionTone: "crisp",
    coverTexture: "matte-board",
    deskSurface: "linen-cloth",
    paperTone: "cool-cream",
    introCamera: "top-down",
    pageTurnStyle: "quick-flick",
    stickerSet: ["label", "corner", "note"],
    titleTreatment: "minimal"
  }
};

export function getThemePresetConfig(themePreset: ThemePreset) {
  return THEME_REGISTRY[themePreset] ?? THEME_REGISTRY.scrapbook;
}
