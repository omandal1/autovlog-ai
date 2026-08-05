import type {
  BookBackgroundStyle,
  BookMaterialConfig,
  ThemePresetConfig
} from "@/lib/types";

function resolveSurfacePalette(surface: ThemePresetConfig["deskSurface"]) {
  switch (surface) {
    case "oak-desk":
      return {
        surfaceColor: "0x6E543F",
        surfaceAccentColor: "0x8A6D51"
      };
    case "walnut-desk":
      return {
        surfaceColor: "0x4C362A",
        surfaceAccentColor: "0x6A4D3A"
      };
    case "midnight-table":
      return {
        surfaceColor: "0x1A2230",
        surfaceAccentColor: "0x24324B"
      };
    case "linen-cloth":
    default:
      return {
        surfaceColor: "0xC6B8A8",
        surfaceAccentColor: "0xDED3C4"
      };
  }
}

function resolvePaperPalette(paperTone: ThemePresetConfig["paperTone"]) {
  switch (paperTone) {
    case "rose-ivory":
      return {
        paperColor: "0xF4E8DF",
        pageEdgeColor: "0xD9C2B2",
        paperShadowColor: "0xB89683"
      };
    case "cool-cream":
      return {
        paperColor: "0xF5F0E2",
        pageEdgeColor: "0xD9D0BA",
        paperShadowColor: "0xB9AC8F"
      };
    case "inkwashed":
      return {
        paperColor: "0xE5E0D4",
        pageEdgeColor: "0xB7B2A8",
        paperShadowColor: "0x8D887D"
      };
    case "warm-ivory":
    default:
      return {
        paperColor: "0xF6E9D4",
        pageEdgeColor: "0xDECAA6",
        paperShadowColor: "0xB99671"
      };
  }
}

function resolveCoverColor(style: BookBackgroundStyle, theme: ThemePresetConfig) {
  if (style === "cover-burgundy") {
    return {
      coverColor: "0xA33328",
      coverEdgeColor: "0x671B18",
      coverHighlightColor: "0xD04B38"
    };
  }

  if (style === "cover-navy") {
    return {
      coverColor: "0x26364D",
      coverEdgeColor: "0x152030",
      coverHighlightColor: "0x3D577A"
    };
  }

  if (theme.coverTexture === "paper-wrap") {
    return {
      coverColor: "0xB23A2E",
      coverEdgeColor: "0x702019",
      coverHighlightColor: "0xD85A44"
    };
  }

  return {
    coverColor: "0x33435D",
    coverEdgeColor: "0x202B3D",
    coverHighlightColor: "0x536D90"
  };
}

export function resolveBookMaterial(
  theme: ThemePresetConfig,
  backgroundStyle: BookBackgroundStyle = theme.pageStyle
): BookMaterialConfig {
  const surface = resolveSurfacePalette(theme.deskSurface);
  const paper = resolvePaperPalette(theme.paperTone);
  const cover = resolveCoverColor(backgroundStyle, theme);

  return {
    surfaceStyle: theme.deskSurface,
    surfaceColor: surface.surfaceColor,
    surfaceAccentColor: surface.surfaceAccentColor,
    paperColor: paper.paperColor,
    paperShadowColor: paper.paperShadowColor,
    pageEdgeColor: paper.pageEdgeColor,
    grainOpacity:
      theme.ornamentDensity === "high" ? 0.205 : theme.ornamentDensity === "medium" ? 0.155 : 0.12,
    shadowOpacity:
      theme.frameTreatment === "journal" ? 0.46 : theme.frameTreatment === "clean" ? 0.32 : 0.42,
    coverTexture: theme.coverTexture,
    coverColor: cover.coverColor,
    coverEdgeColor: cover.coverEdgeColor,
    coverHighlightColor: cover.coverHighlightColor,
    depthShadowOpacity:
      theme.frameTreatment === "journal" ? 0.4 : theme.frameTreatment === "clean" ? 0.26 : 0.34,
    pageStackLines:
      theme.ornamentDensity === "high" ? 24 : theme.ornamentDensity === "medium" ? 18 : 14,
    gutterShadowOpacity:
      theme.frameTreatment === "clean" ? 0.24 : theme.frameTreatment === "journal" ? 0.48 : 0.36,
    paperFiberOpacity:
      theme.paperTone === "inkwashed" ? 0.18 : theme.ornamentDensity === "high" ? 0.16 : 0.12,
    pageCurlShadowOpacity:
      theme.pageTurnStyle === "dramatic-lift" ? 0.5 : theme.pageTurnStyle === "quick-flick" ? 0.34 : 0.42
  };
}
