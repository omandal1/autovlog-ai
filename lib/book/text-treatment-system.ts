import type {
  BookPageKind,
  BookTextTreatment,
  ThemePresetConfig,
  TitleStyle
} from "@/lib/types";

export function applyBookTitleCase(text: string | undefined, mode: BookTextTreatment["titleCase"]) {
  if (!text) {
    return text;
  }

  if (mode === "upper") {
    return text.toUpperCase();
  }

  if (mode === "title") {
    return text
      .split(/\s+/)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  }

  return text;
}

function resolveStyle(theme: ThemePresetConfig, titleStyle: TitleStyle) {
  switch (titleStyle) {
    case "scrapbook":
      return "handwritten" as const;
    case "yearbook":
      return "yearbook" as const;
    case "cinematic":
      return "cinematic" as const;
    case "simple":
      return theme.titleTreatment === "minimal" ? "minimal" : "editorial";
    case "nostalgic":
    default:
      return theme.titleTreatment;
  }
}

export function resolveBookTextTreatment(options: {
  theme: ThemePresetConfig;
  titleStyle: TitleStyle;
  kind: BookPageKind;
  accentLabel?: string;
}): BookTextTreatment {
  const style = resolveStyle(options.theme, options.titleStyle);
  const onDark = options.kind === "cover";

  return {
    style,
    titleColor:
      onDark
        ? "white"
        : style === "cinematic"
          ? "0x283446"
          : style === "yearbook"
            ? "0x37455A"
            : "0x4E4135",
    subtitleColor: onDark ? "white@0.88" : style === "minimal" ? "0x6E685E" : "0x6C5844",
    labelColor: onDark ? "white@0.84" : options.theme.accentColor,
    titleBoxColor:
      onDark
        ? `${options.theme.accentColor}@0.22`
        : style === "minimal"
          ? "white@0.10"
          : `${options.theme.accentColor}@0.13`,
    captionBoxColor:
      style === "yearbook"
        ? "white@0.12"
        : style === "cinematic"
          ? "black@0.16"
          : `${options.theme.accentColor}@0.10`,
    titleCase:
      style === "yearbook" ? "upper" : style === "minimal" || options.titleStyle === "simple" ? "title" : "mixed",
    accentLabel: options.accentLabel
  };
}
