import { listLocalDecorationAssetsSync } from "@/lib/book/asset-providers";
import { createId } from "@/lib/ids";
import type {
  BookDecoration,
  BookPage,
  BookPageSlot,
  DecorationLevel,
  ThemePresetConfig
} from "@/lib/types";

interface DecorationAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function densityMultiplier(level: DecorationLevel, theme: ThemePresetConfig, page: Pick<BookPage, "kind" | "layoutType">) {
  const base = level === "minimal" ? 0.56 : level === "rich" ? 1.7 : 1;
  const themeBias =
    theme.ornamentDensity === "high" ? 1.25 : theme.ornamentDensity === "medium" ? 1 : 0.78;
  const pageBias =
    page.kind === "cover"
      ? 0.92
      : page.kind === "chapter-divider"
        ? 0.88
        : page.layoutType === "hero"
          ? 0.96
          : 1.08;
  return base * themeBias * pageBias;
}

function inflateFrame(frame: BookPageSlot["frame"], margin: number) {
  return {
    x: frame.x - margin,
    y: frame.y - margin,
    width: frame.width + margin * 2,
    height: frame.height + margin * 2
  };
}

function intersects(a: DecorationAnchor, b: { x: number; y: number; width: number; height: number }) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function isAnchorFree(anchor: DecorationAnchor, slots: BookPageSlot[]) {
  return !slots.some((slot) => intersects(anchor, inflateFrame(slot.frame, 0.035)));
}

function buildContentAnchors(page: Pick<BookPage, "slots" | "layoutType">) {
  const base: DecorationAnchor[] = [
    { x: 0.72, y: 0.13, width: 0.16, height: 0.07, rotationDeg: 6 },
    { x: 0.09, y: 0.22, width: 0.16, height: 0.07, rotationDeg: -4 },
    { x: 0.77, y: 0.74, width: 0.15, height: 0.08, rotationDeg: -5 },
    { x: 0.08, y: 0.74, width: 0.16, height: 0.08, rotationDeg: 4 },
    { x: 0.42, y: 0.77, width: 0.16, height: 0.07, rotationDeg: -2 },
    { x: 0.73, y: 0.38, width: 0.15, height: 0.08, rotationDeg: 5 }
  ];

  if (page.layoutType === "yearbook-spread" || page.layoutType === "three-up") {
    base.push(
      { x: 0.33, y: 0.14, width: 0.14, height: 0.06, rotationDeg: 3 },
      { x: 0.57, y: 0.66, width: 0.14, height: 0.07, rotationDeg: -3 }
    );
  }

  if (page.layoutType === "concert-board") {
    base.push(
      { x: 0.63, y: 0.11, width: 0.18, height: 0.08, rotationDeg: 7 },
      { x: 0.58, y: 0.66, width: 0.18, height: 0.08, rotationDeg: -6 }
    );
  }

  return base.filter((anchor) => isAnchorFree(anchor, page.slots));
}

function themedCaption(page: Pick<BookPage, "title" | "subtitle" | "vibe" | "slots">) {
  if (page.subtitle) {
    return page.subtitle;
  }
  switch (page.vibe?.primary) {
    case "concert":
      return "lights, noise, and the best chorus";
    case "sports":
      return "game-day energy";
    case "study":
      return "late nights and lecture notes";
    case "campus":
      return "the places between classes";
    case "friends":
      return "the people that made it";
    case "travel":
      return "somewhere worth saving";
    case "nightlife":
      return "out late, still memorable";
    case "celebration":
      return "worth celebrating";
    case "dialogue":
      return "the lines we kept quoting";
    case "photo-dump":
      return "photo dump favorites";
    default:
      return page.slots.length > 2 ? "little scenes from the semester" : "one to remember";
  }
}

function noteText(page: Pick<BookPage, "kind" | "vibe" | "subtitle">, pageIndex: number) {
  if (page.subtitle) {
    return page.subtitle;
  }
  if (page.kind === "cover") {
    return "kept for later";
  }
  if (page.kind === "chapter-divider") {
    return pageIndex % 2 === 0 ? "turn the page" : "next chapter";
  }
  switch (page.vibe?.primary) {
    case "concert":
      return "louder than the camera caught";
    case "sports":
      return "all heart";
    case "study":
      return "annotated in the margins";
    case "friends":
      return "core memories";
    case "travel":
      return "wish you were here";
    default:
      return "saved in the margins";
  }
}

function pushDecoration(
  decorations: BookDecoration[],
  decoration: Omit<BookDecoration, "id">
) {
  decorations.push({
    id: createId("decor", 8),
    ...decoration
  });
}

function addTapeDecorations(
  decorations: BookDecoration[],
  slot: BookPageSlot,
  density: number,
  pageIndex: number
) {
  if (density < 0.7) {
    return;
  }

  const topTilt = pageIndex % 2 === 0 ? -3 : 4;
  const bottomTilt = -topTilt * 0.7;
  pushDecoration(decorations, {
    kind: "tape-strip",
    layer: "over-media",
    x: clamp(slot.frame.x + slot.frame.width * 0.08, 0.05, 0.9),
    y: clamp(slot.frame.y - 0.024, 0.05, 0.9),
    width: 0.085,
    height: 0.028,
    opacity: 0.78,
    rotationDeg: topTilt,
    color: pageIndex % 3 === 0 ? "0xEBD7AE" : "0xE6D2B2",
    priority: 8
  });
  pushDecoration(decorations, {
    kind: "tape-strip",
    layer: "over-media",
    x: clamp(slot.frame.x + slot.frame.width * 0.7, 0.05, 0.9),
    y: clamp(slot.frame.y + slot.frame.height - 0.012, 0.05, 0.9),
    width: 0.074,
    height: 0.022,
    opacity: 0.68,
    rotationDeg: bottomTilt,
    color: "0xE3C99B",
    priority: 7
  });
}

function addCornerDecorations(
  decorations: BookDecoration[],
  slot: BookPageSlot,
  theme: ThemePresetConfig,
  density: number
) {
  if (density < 0.6) {
    return;
  }

  pushDecoration(decorations, {
    kind: "corner-tab",
    layer: "over-media",
    x: clamp(slot.frame.x - 0.006, 0.04, 0.95),
    y: clamp(slot.frame.y - 0.006, 0.04, 0.95),
    width: 0.03,
    height: 0.03,
    opacity: 0.72,
    color: theme.accentColor,
    priority: 6
  });
  pushDecoration(decorations, {
    kind: "corner-tab",
    layer: "over-media",
    x: clamp(slot.frame.x + slot.frame.width - 0.022, 0.04, 0.95),
    y: clamp(slot.frame.y + slot.frame.height - 0.022, 0.04, 0.95),
    width: 0.03,
    height: 0.03,
    opacity: 0.54,
    color: theme.accentColor,
    priority: 5
  });
}

function addCoverDecorations(
  page: Pick<BookPage, "kind" | "title" | "subtitle" | "slots" | "vibe">,
  theme: ThemePresetConfig,
  density: number
) {
  const decorations: BookDecoration[] = [];
  const coverSlot = page.slots[0];
  if (coverSlot) {
    pushDecoration(decorations, {
      kind: "torn-paper",
      layer: "under-media",
      x: clamp(coverSlot.frame.x - 0.022, 0.22, 0.75),
      y: clamp(coverSlot.frame.y - 0.028, 0.44, 0.8),
      width: clamp(coverSlot.frame.width + 0.045, 0.16, 0.34),
      height: clamp(coverSlot.frame.height + 0.055, 0.14, 0.3),
      opacity: 0.72,
      rotationDeg: -1.5,
      color: "0xF4E5C8",
      priority: 9
    });
    addTapeDecorations(decorations, coverSlot, 1.2, 0);
  }
  pushDecoration(decorations, {
    kind: "label-tag",
    layer: "paper",
    x: 0.245,
    y: 0.145,
    width: 0.2,
    height: 0.05,
    color: theme.accentColor,
    text: "private notebook",
    priority: 8
  });
  pushDecoration(decorations, {
    kind: "stamp",
    layer: "paper",
    x: 0.63,
    y: 0.72,
    width: 0.18,
    height: 0.085,
    color: theme.accentColor,
    text: page.subtitle ?? "memory book",
    priority: 7
  });

  if (density > 0.8) {
    pushDecoration(decorations, {
      kind: "note-strip",
      layer: "paper",
      x: 0.26,
      y: 0.69,
      width: 0.24,
      height: 0.05,
      opacity: 0.95,
      rotationDeg: -2.5,
      color: "0xF3DFC1",
      text: "opened for the memories",
      priority: 6
    });
  }

  if (density > 1.0) {
    pushDecoration(decorations, {
      kind: "emoji-sticker",
      layer: "paper",
      x: 0.68,
      y: 0.22,
      width: 0.06,
      height: 0.06,
      opacity: 0.95,
      rotationDeg: 8,
      color: theme.accentColor,
      text: "\u2728",
      priority: 5
    });
  }

  return decorations;
}

function addDividerDecorations(
  page: Pick<BookPage, "kind" | "title" | "subtitle" | "slots" | "vibe">,
  theme: ThemePresetConfig,
  density: number,
  pageIndex: number
) {
  const decorations: BookDecoration[] = [];
  pushDecoration(decorations, {
    kind: "caption-plaque",
    layer: "paper",
    x: 0.37,
    y: 0.6,
    width: 0.26,
    height: 0.06,
    color: theme.accentColor,
    text: page.subtitle ?? "turn the page",
    priority: 8
  });
  pushDecoration(decorations, {
    kind: "stamp",
    layer: "paper",
    x: 0.16,
    y: 0.2,
    width: 0.14,
    height: 0.065,
    color: theme.accentColor,
    text: pageIndex % 2 === 0 ? "Archive" : "Next up",
    priority: 7
  });

  if (density > 0.84) {
    pushDecoration(decorations, {
      kind: "note-strip",
      layer: "paper",
      x: 0.22,
      y: 0.74,
      width: 0.2,
      height: 0.048,
      opacity: 0.94,
      rotationDeg: -1.6,
      color: "0xF1DEC0",
      text: noteText(page, pageIndex),
      priority: 6
    });
  }

  if (density > 1.0) {
    pushDecoration(decorations, {
      kind: "emoji-sticker",
      layer: "paper",
      x: 0.69,
      y: 0.25,
      width: 0.06,
      height: 0.06,
      opacity: 0.94,
      rotationDeg: 7,
      color: theme.accentColor,
      text: page.vibe?.primary === "concert" ? "\ud83c\udfb5" : "\u2728",
      priority: 5
    });
  }

  return decorations;
}

function addAssetPlacements(
  decorations: BookDecoration[],
  page: Pick<BookPage, "kind" | "title" | "subtitle" | "slots" | "vibe" | "layoutType">,
  theme: ThemePresetConfig,
  decorationLevel: DecorationLevel,
  density: number,
  pageIndex: number
) {
  const anchors = buildContentAnchors(page);
  const assets = listLocalDecorationAssetsSync({
    pageVibe:
      page.vibe ?? {
        primary: "general",
        vibe: "cinematic",
        confidence: 0.3,
        tags: ["general"],
        signals: []
      },
    themePreset: theme.id,
    density: decorationLevel
  });

  const maxAssets =
    density > 1.35 ? 5 : density > 1.0 ? 4 : density > 0.75 ? 3 : 2;
  assets.slice(0, Math.min(maxAssets, anchors.length)).forEach((asset, index) => {
    const anchor = anchors[index];
    if (!anchor) {
      return;
    }
    pushDecoration(decorations, {
      kind: asset.renderKind,
      layer: "paper",
      x: anchor.x,
      y: anchor.y,
      width: clamp(anchor.width, 0.05, 0.22),
      height:
        asset.renderKind === "emoji-sticker" || asset.renderKind === "sticker-star"
          ? 0.055
          : clamp(anchor.height, 0.02, 0.09),
      opacity: 0.94,
      rotationDeg: anchor.rotationDeg ?? (index % 2 === 0 ? 4 : -4),
      color: asset.color ?? theme.accentColor,
      text: asset.text,
      assetId: asset.id,
      licenseType: asset.licenseType,
      source: asset.source,
      tags: asset.tags,
      priority: asset.priority
    });
  });

  if (density > 1.15) {
    pushDecoration(decorations, {
      kind: "caption-plaque",
      layer: "paper",
      x: 0.11,
      y: 0.81,
      width: page.layoutType === "quote-page" ? 0.28 : 0.22,
      height: 0.052,
      opacity: 0.92,
      color: theme.accentColor,
      text: themedCaption(page),
      priority: 7
    });
  }

  if (density > 0.78 && page.kind === "content") {
    pushDecoration(decorations, {
      kind: "doodle-line",
      layer: "paper",
      x: 0.68,
      y: 0.22,
      width: 0.12,
      height: 0.012,
      opacity: 0.62,
      color: "0x202020",
      rotationDeg: -8,
      priority: 4
    });
    pushDecoration(decorations, {
      kind: "doodle-line",
      layer: "paper",
      x: 0.71,
      y: 0.245,
      width: 0.08,
      height: 0.01,
      opacity: 0.5,
      color: "0x202020",
      rotationDeg: 5,
      priority: 4
    });
  }

  if (density > 1.28 && page.kind === "content") {
    pushDecoration(decorations, {
      kind: "date-chip",
      layer: "paper",
      x: 0.67,
      y: 0.11,
      width: 0.17,
      height: 0.046,
      color: theme.accentColor,
      text:
        page.vibe?.primary === "concert"
          ? "live night"
          : page.vibe?.primary === "travel"
            ? "postcard mode"
            : theme.label,
      priority: 6
    });
  }

  if (density > 1.42 && page.vibe?.primary === "concert") {
    pushDecoration(decorations, {
      kind: "sticker-star",
      layer: "paper",
      x: 0.61,
      y: 0.14,
      width: 0.055,
      height: 0.055,
      color: theme.accentColor,
      text: "\u266b",
      priority: 5
    });
  }

  if (density > 1.42 && page.vibe?.primary === "sports") {
    pushDecoration(decorations, {
      kind: "emoji-sticker",
      layer: "paper",
      x: 0.12,
      y: 0.16,
      width: 0.055,
      height: 0.055,
      color: theme.accentColor,
      text: "\ud83c\udfc8",
      priority: 5
    });
  }
}

function addContentDecorations(
  page: Pick<BookPage, "kind" | "title" | "subtitle" | "slots" | "vibe" | "layoutType">,
  theme: ThemePresetConfig,
  decorationLevel: DecorationLevel,
  density: number,
  pageIndex: number
) {
  const decorations: BookDecoration[] = [];

  for (const slot of page.slots) {
    if (theme.stickerSet.includes("tape")) {
      addTapeDecorations(decorations, slot, density, pageIndex);
    }
    if (theme.stickerSet.includes("corner")) {
      addCornerDecorations(decorations, slot, theme, density);
    }
  }

  addAssetPlacements(decorations, page, theme, decorationLevel, density, pageIndex);
  return decorations;
}

export function buildPageDecorations(options: {
  page: Pick<BookPage, "kind" | "title" | "subtitle" | "slots" | "layoutType" | "vibe">;
  pageIndex: number;
  theme: ThemePresetConfig;
  decorationLevel: DecorationLevel;
}) {
  const density = densityMultiplier(options.decorationLevel, options.theme, options.page);
  if (options.page.kind === "cover") {
    return addCoverDecorations(options.page, options.theme, density);
  }
  if (options.page.kind === "chapter-divider" || options.page.kind === "outro") {
    return addDividerDecorations(options.page, options.theme, density, options.pageIndex);
  }
  return addContentDecorations(
    options.page,
    options.theme,
    options.decorationLevel,
    density,
    options.pageIndex
  );
}
