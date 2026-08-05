import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

import type {
  BookBackgroundStyle,
  BookDecoration,
  BookPage,
  BookPageTransition,
  ProjectRecord,
  RenderedOutput,
  ThemePreset,
  Timeline,
  TimelineClip,
  TimelineTransition
} from "@/lib/types";
import { balanceChapterSoundtracks } from "@/lib/audio/chapter-soundtrack-balancer";
import {
  buildFinalAudioMixGraph,
  buildMusicBedGraph,
  buildSourceAudioBedGraph,
  buildTransitionSegmentGraph
} from "@/lib/render/ffmpeg-command-builder";
import { renderPhysicalBookTransition } from "@/lib/render/book-animation-compositor";
import { prepareTimelineForRender } from "@/lib/render/prepare-render-plan";
import { renderWallFramePlan } from "@/lib/render/wall-frame-render-strategy";
import {
  assertValidVideoFile,
  formatVideoDiagnostics,
  validateVideoFile,
  writeAtomicVideo,
  type VideoProbeSummary
} from "@/lib/render/video-integrity";
import { getThemePresetConfig } from "@/lib/themes/theme-registry";
import { calculateClipTimings } from "@/lib/transitions/advanced-transition-engine";
import { applyBookTitleCase } from "@/lib/book/text-treatment-system";
import { runWithConcurrency } from "@/lib/utils";
import {
  buildScalePadFilter,
  escapeForDrawtext,
  normalizeFfmpegPath,
  resolveEmojiFontPath,
  resolveFontPath,
  runFfmpeg
} from "@/scripts/ffmpeg";
import { getProjectPaths, writeJson } from "@/storage/local-storage";

interface TimelinePiece {
  path: string;
  durationSec: number;
  kind: "body" | "transition";
}

export interface RenderTimelineDestination {
  outputPath?: string;
  timelinePath?: string;
  renderPlanPath?: string;
  tempRoot?: string;
  downloadRoute?: string;
  onProgress?: (update: {
    stage: string;
    progress: number;
    detail: string;
  }) => void | Promise<void>;
}

const RENDER_CACHE_VERSION = "diary-notebook-v2";
const TIMELINE_RENDER_CONCURRENCY = resolvePositiveInteger(
  process.env.TIMELINE_RENDER_CONCURRENCY,
  2,
  1,
  4
);
const PAGE_RENDER_TIMEOUT_MS = resolvePositiveInteger(
  process.env.PAGE_RENDER_TIMEOUT_MS,
  90_000,
  20_000,
  300_000
);

function resolvePositiveInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function summarizeRenderError(error: unknown) {
  if (typeof error === "object" && error) {
    const stderr = "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
    return `${stderr}\n${message}`.replace(/\s+/g, " ").trim().slice(0, 2200);
  }
  return String(error).replace(/\s+/g, " ").trim().slice(0, 2200);
}

function buildRunScopedTempDir(baseTempDir: string, timelineId: string) {
  return path.join(
    baseTempDir,
    `${timelineId}-${RENDER_CACHE_VERSION}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  );
}

function buildVideoValidationOptions(options: {
  label: string;
  width: number;
  height: number;
  fps: number;
  minDurationSec?: number;
}) {
  return {
    label: options.label,
    minDurationSec: options.minDurationSec,
    width: options.width,
    height: options.height,
    fps: options.fps,
    requireH264: true,
    requireYuv420p: true,
    decode: true
  };
}

function planSafeTransitionDuration(options: {
  requestedSec: number;
  fromDurationSec: number;
  toDurationSec: number;
  fps: number;
}) {
  const framePadSec = Math.max(2 / Math.max(options.fps, 1), 0.08);
  const availableSec = Math.min(options.fromDurationSec, options.toDurationSec);
  const maxSafeSec = Math.max(0, Math.min(availableSec - framePadSec, 1.35));
  if (maxSafeSec <= 0.12) {
    return 0;
  }
  const plannedSec = Number(Math.min(Math.max(0, options.requestedSec), maxSafeSec).toFixed(3));

  if (!Number.isFinite(plannedSec) || plannedSec <= 0.08) {
    return 0;
  }
  return plannedSec;
}

function planXfadeInputWindow(options: {
  transitionDurationSec: number;
  fromDurationSec: number;
  toDurationSec: number;
  fps: number;
}) {
  const minimumLeadSec = Math.max(2 / Math.max(options.fps, 1), 0.08);
  const maxLeadSec = Math.max(
    0.04,
    Math.min(
      0.28,
      options.fromDurationSec - options.transitionDurationSec - 0.02,
      options.toDurationSec - options.transitionDurationSec - 0.02
    )
  );
  const leadSec = Number(
    Math.min(Math.max(minimumLeadSec, options.transitionDurationSec * 0.18), maxLeadSec).toFixed(3)
  );
  const inputDurationSec = Number((options.transitionDurationSec + leadSec).toFixed(3));
  return {
    leadSec,
    inputDurationSec
  };
}

function resolveBackgroundColor(style: BookBackgroundStyle) {
  switch (style) {
    case "cover-burgundy":
      return "0x5A2E38";
    case "paper-cream":
      return "0xEFE5D4";
    case "paper-rose":
      return "0xE6D7D2";
    case "divider-slate":
      return "0x2E3848";
    default:
      return "0x24324B";
  }
}

function withAlpha(color: string, alpha: number) {
  if (color.includes("@")) {
    return color;
  }
  return `${color}@${alpha.toFixed(2)}`;
}

function hashTextSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function drawtextExpression(options: {
  text?: string;
  x: string;
  y: string;
  fontSize: number;
  fontColor: string;
  borderColor?: string;
  boxColor?: string;
  fontFile?: string;
  boxBorderW?: number;
  borderWidth?: number;
  lineSpacing?: number;
}) {
  if (!options.text) {
    return undefined;
  }

  const fontFile = options.fontFile ?? resolveFontPath();
  const fontPart = fontFile ? `fontfile='${escapeForDrawtext(fontFile)}':` : "";
  return `drawtext=${fontPart}text='${escapeForDrawtext(options.text)}':x=${options.x}:y=${options.y}:fontsize=${options.fontSize}:fontcolor=${options.fontColor}:borderw=${options.borderWidth ?? 2}:bordercolor=${options.borderColor ?? "black@0.28"}:box=1:boxcolor=${options.boxColor ?? "black@0.18"}:boxborderw=${options.boxBorderW ?? 18}${options.lineSpacing !== undefined ? `:line_spacing=${options.lineSpacing}` : ""}`;
}

function wrapTextLines(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) {
        break;
      }
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

function buildSurfaceTextureFilters(
  page: BookPage,
  width: number,
  height: number,
  closedBook: boolean
) {
  const seed = hashTextSeed(page.id);
  const grain = Math.round(page.material.grainOpacity * 68);
  const paperLift = 0.035 + (seed % 5) * 0.004;
  const paperShade = 0.028 + (seed % 7) * 0.003;
  const filters = [
    "format=rgba",
    `drawbox=x=0:y=0:w=iw:h=ih:color=${page.material.surfaceColor}:t=fill`,
    `noise=alls=${grain}:allf=t+u`,
    "vignette=angle=PI/5"
  ];

  if (page.material.surfaceStyle === "oak-desk" || page.material.surfaceStyle === "walnut-desk") {
    for (let index = 0; index < 7; index += 1) {
      const x = Math.round((width / 7) * index);
      const bandWidth = Math.max(18, Math.round(width * 0.018));
      filters.push(
        `drawbox=x=${x}:y=0:w=${bandWidth}:h=${height}:color=${withAlpha(page.material.surfaceAccentColor, 0.08 + index * 0.01)}:t=fill`
      );
    }
  } else if (page.material.surfaceStyle === "linen-cloth") {
    for (let index = 0; index < 6; index += 1) {
      const y = Math.round((height / 6) * index);
      filters.push(
        `drawbox=x=0:y=${y}:w=${width}:h=2:color=${withAlpha(page.material.surfaceAccentColor, 0.12)}:t=fill`
      );
    }
    for (let index = 0; index < 8; index += 1) {
      const x = Math.round((width / 8) * index);
      filters.push(
        `drawbox=x=${x}:y=0:w=1:h=${height}:color=${withAlpha(page.material.surfaceAccentColor, 0.1)}:t=fill`
      );
    }
  } else {
    filters.push(
      `drawbox=x=0:y=${Math.round(height * 0.18)}:w=${width}:h=${Math.round(height * 0.44)}:color=${withAlpha(page.material.surfaceAccentColor, 0.08)}:t=fill`
    );
  }

  if (closedBook) {
    const coverX = Math.round(width * 0.22);
    const coverY = Math.round(height * 0.12);
    const coverW = Math.round(width * 0.56);
    const coverH = Math.round(height * 0.76);
    filters.push(
      `drawbox=x=${coverX + 28}:y=${coverY + 34}:w=${coverW}:h=${coverH}:color=${withAlpha("black", page.material.depthShadowOpacity)}:t=fill`,
      `drawbox=x=${coverX + 16}:y=${coverY + 22}:w=${coverW + 10}:h=${coverH + 8}:color=${withAlpha("black", page.material.shadowOpacity * 0.72)}:t=fill`,
      `drawbox=x=${coverX}:y=${coverY}:w=${coverW}:h=${coverH}:color=${page.material.coverColor}:t=fill`,
      `noise=alls=${Math.max(9, Math.round(page.material.grainOpacity * 92))}:allf=t+u`,
      `drawbox=x=${coverX}:y=${coverY}:w=${coverW}:h=${coverH}:color=${withAlpha(page.material.coverEdgeColor, 0.88)}:t=8`,
      `drawbox=x=${coverX + 16}:y=${coverY + 16}:w=${coverW - 32}:h=${coverH - 32}:color=${withAlpha(page.material.coverEdgeColor, 0.34)}:t=2`,
      `drawbox=x=${coverX + 48}:y=${coverY}:w=10:h=${coverH}:color=${withAlpha(page.material.coverEdgeColor, 0.42)}:t=fill`,
      `drawbox=x=${coverX + 68}:y=${coverY}:w=2:h=${coverH}:color=${withAlpha("black", 0.18)}:t=fill`,
      `drawbox=x=${coverX + 24}:y=${coverY + 22}:w=${Math.round(coverW * 0.08)}:h=${coverH - 44}:color=${withAlpha(page.material.coverHighlightColor, 0.24)}:t=fill`,
      `drawbox=x=${coverX + 28}:y=${coverY + 22}:w=${coverW - 56}:h=${Math.round(coverH * 0.18)}:color=${withAlpha("white", 0.045)}:t=fill`,
      `drawbox=x=${coverX + 18}:y=${coverY + Math.round(coverH * 0.68)}:w=${coverW - 36}:h=${Math.round(coverH * 0.22)}:color=${withAlpha(page.material.coverEdgeColor, 0.08)}:t=fill`
    );
    for (let index = 0; index < Math.max(8, page.material.pageStackLines); index += 1) {
      filters.push(
        `drawbox=x=${coverX + coverW - 10 + index * 2}:y=${coverY + 16 + index}:w=2:h=${coverH - 32 - index * 2}:color=${withAlpha(page.material.pageEdgeColor, 0.5 - Math.min(index, 12) * 0.018)}:t=fill`
      );
    }
    for (let index = 0; index < 10; index += 1) {
      const x = coverX + 24 + index * Math.round(coverW / 11);
      filters.push(
        `drawbox=x=${x}:y=${coverY + 16}:w=1:h=${coverH - 32}:color=${withAlpha(page.material.coverHighlightColor, 0.035 + (index % 3) * 0.008)}:t=fill`
      );
    }
    return filters;
  }

  const bookX = Math.round(width * 0.1);
  const bookY = Math.round(height * 0.085);
  const bookW = Math.round(width * 0.8);
  const bookH = Math.round(height * 0.8);
  const halfW = Math.round(bookW / 2);
  const pageInset = 8;
  const leftPageW = halfW - 4;
  const rightPageX = bookX + halfW + 4;
  filters.push(
    `drawbox=x=${bookX + 30}:y=${bookY + 32}:w=${bookW}:h=${bookH}:color=${withAlpha("black", page.material.depthShadowOpacity)}:t=fill`,
    `drawbox=x=${bookX + 16}:y=${bookY + 20}:w=${bookW + 8}:h=${bookH + 8}:color=${withAlpha("black", page.material.shadowOpacity * 0.72)}:t=fill`,
    `drawbox=x=${bookX}:y=${bookY}:w=${leftPageW}:h=${bookH}:color=${page.material.paperColor}:t=fill`,
    `drawbox=x=${rightPageX}:y=${bookY}:w=${leftPageW}:h=${bookH}:color=${page.material.paperColor}:t=fill`,
    `drawbox=x=${bookX}:y=${bookY}:w=${leftPageW}:h=${bookH}:color=${withAlpha(page.material.pageEdgeColor, 0.84)}:t=3`,
    `drawbox=x=${rightPageX}:y=${bookY}:w=${leftPageW}:h=${bookH}:color=${withAlpha(page.material.pageEdgeColor, 0.84)}:t=3`,
    `drawbox=x=${bookX + halfW - 10}:y=${bookY - pageInset}:w=20:h=${bookH + pageInset * 2}:color=${withAlpha(page.material.paperShadowColor, page.material.gutterShadowOpacity)}:t=fill`,
    `drawbox=x=${bookX + halfW - 2}:y=${bookY - pageInset}:w=4:h=${bookH + pageInset * 2}:color=${withAlpha("black", 0.16)}:t=fill`,
    `drawbox=x=${bookX + 20}:y=${bookY + 18}:w=${bookW - 40}:h=10:color=${withAlpha("white", 0.08)}:t=fill`,
    `drawbox=x=${bookX + 18}:y=${bookY + 20}:w=${bookW - 36}:h=${Math.round(bookH * 0.18)}:color=${withAlpha("white", paperLift)}:t=fill`,
    `drawbox=x=${bookX + 18}:y=${bookY + Math.round(bookH * 0.66)}:w=${bookW - 36}:h=${Math.round(bookH * 0.2)}:color=${withAlpha(page.material.paperShadowColor, paperShade)}:t=fill`,
    `drawbox=x=${bookX + 16}:y=${bookY + 16}:w=${leftPageW - 22}:h=${bookH - 32}:color=${withAlpha("white", 0.022 + (seed % 3) * 0.006)}:t=fill`,
    `drawbox=x=${rightPageX + 6}:y=${bookY + 18}:w=${leftPageW - 22}:h=${bookH - 36}:color=${withAlpha("white", 0.018 + (seed % 4) * 0.004)}:t=fill`
  );
  for (let index = 0; index < Math.max(16, page.material.pageStackLines); index += 1) {
    const y = Math.round(bookY + 24 + index * (bookH / 17));
    filters.push(
      `drawbox=x=${bookX + 18}:y=${y}:w=${halfW - 34}:h=1:color=${withAlpha(page.material.pageEdgeColor, 0.028 + (index % 4) * 0.009)}:t=fill`,
      `drawbox=x=${bookX + halfW + 16}:y=${y + (index % 2 === 0 ? 1 : -1)}:w=${halfW - 34}:h=1:color=${withAlpha(page.material.pageEdgeColor, 0.028 + ((index + 1) % 4) * 0.008)}:t=fill`
    );
  }
  for (let index = 0; index < page.material.pageStackLines; index += 1) {
    const offset = index * 2;
    filters.push(
      `drawbox=x=${bookX + bookW + offset}:y=${bookY + 12 + index}:w=2:h=${bookH - 24 - index * 2}:color=${withAlpha(page.material.pageEdgeColor, 0.32 - Math.min(index, 12) * 0.014)}:t=fill`,
      `drawbox=x=${bookX - 4 - offset}:y=${bookY + 12 + index}:w=2:h=${bookH - 24 - index * 2}:color=${withAlpha(page.material.pageEdgeColor, 0.22 - Math.min(index, 10) * 0.01)}:t=fill`
    );
  }
  for (let index = 0; index < 10; index += 1) {
    const x = bookX + 20 + index * Math.round((halfW - 44) / 9);
    filters.push(
      `drawbox=x=${x}:y=${bookY + 18}:w=1:h=${bookH - 34}:color=${withAlpha("white", 0.01 + (index % 3) * 0.004)}:t=fill`,
      `drawbox=x=${rightPageX + 18 + index * Math.round((halfW - 50) / 9)}:y=${bookY + 22}:w=1:h=${bookH - 40}:color=${withAlpha(page.material.pageEdgeColor, 0.012 + (index % 2) * 0.004)}:t=fill`
    );
  }
  filters.push(
    `drawbox=x=${bookX + 12}:y=${bookY + 12}:w=${halfW - 16}:h=${bookH - 24}:color=${withAlpha("white", 0.04)}:t=fill`,
    `drawbox=x=${bookX + halfW + 8}:y=${bookY + 12}:w=${halfW - 16}:h=${bookH - 24}:color=${withAlpha("white", 0.025)}:t=fill`,
    `drawbox=x=${bookX + 8}:y=${bookY + bookH - 16}:w=${leftPageW - 10}:h=8:color=${withAlpha(page.material.paperShadowColor, 0.045)}:t=fill`,
    `drawbox=x=${rightPageX + 2}:y=${bookY + bookH - 14}:w=${leftPageW - 10}:h=6:color=${withAlpha(page.material.paperShadowColor, 0.035)}:t=fill`
  );
  for (let index = 0; index < 18; index += 1) {
    const y = Math.round(bookY + 54 + index * ((bookH - 112) / 17));
    const opacity = 0.12 + (index % 3) * 0.018;
    filters.push(
      `drawbox=x=${bookX + 28}:y=${y}:w=${halfW - 58}:h=1:color=${withAlpha("0x8AA4C2", opacity)}:t=fill`,
      `drawbox=x=${rightPageX + 24}:y=${y + (index % 2)}:w=${halfW - 58}:h=1:color=${withAlpha("0x8AA4C2", opacity * 0.92)}:t=fill`
    );
  }
  filters.push(
    `drawbox=x=${bookX + 66}:y=${bookY + 32}:w=2:h=${bookH - 64}:color=${withAlpha("0xD96060", 0.18)}:t=fill`,
    `drawbox=x=${rightPageX + 58}:y=${bookY + 32}:w=2:h=${bookH - 64}:color=${withAlpha("0xD96060", 0.14)}:t=fill`
  );
  return filters;
}

function buildDecorationFilters(
  page: BookPage,
  width: number,
  height: number,
  layers: Array<BookDecoration["layer"]>
) {
  const filters: string[] = [];
  const emojiFont = resolveEmojiFontPath();
  for (const decoration of page.decorations.filter((item) => layers.includes(item.layer))) {
    const x = Math.round(decoration.x * width);
    const y = Math.round(decoration.y * height);
    const w = Math.max(8, Math.round(decoration.width * width));
    const h = Math.max(4, Math.round(decoration.height * height));
    const baseColor = decoration.color ?? page.textTreatment.labelColor;
    const color = withAlpha(baseColor, decoration.opacity ?? 0.8);

    switch (decoration.kind) {
      case "tape-strip":
      case "corner-tab":
      case "doodle-line":
        filters.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`);
        break;
      case "stamp":
        filters.push(
          `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${withAlpha(baseColor, 0.18)}:t=fill`,
          `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=2`
        );
        if (decoration.text) {
          const label = drawtextExpression({
            text: decoration.text,
            x: `${x + 10}`,
            y: `${y + Math.max(6, Math.round(h * 0.18))}`,
            fontSize: Math.max(13, Math.round(h * 0.34)),
            fontColor: page.textTreatment.titleColor,
            boxColor: "black@0",
            boxBorderW: 0
          });
          if (label) {
            filters.push(label);
          }
        }
        break;
      case "label-tag":
      case "date-chip":
      case "caption-plaque":
      case "note-strip":
      case "diary-text":
        {
          const label = drawtextExpression({
            text: decoration.text,
            x: `${x + 10}`,
            y: `${y + Math.max(6, Math.round(h * 0.15))}`,
            fontSize:
              decoration.kind === "diary-text"
                ? Math.max(15, Math.min(24, Math.round(h * 0.17)))
                : Math.max(13, Math.round(h * 0.36)),
            fontColor: decoration.kind === "diary-text" ? "0x202020" : page.textTreatment.titleColor,
            boxColor:
              decoration.kind === "diary-text"
                ? "white@0.05"
                : decoration.kind === "note-strip"
                  ? withAlpha(baseColor, 0.22)
                  : color,
            boxBorderW: decoration.kind === "diary-text" ? 8 : decoration.kind === "note-strip" ? 12 : 18,
            borderWidth: decoration.kind === "diary-text" ? 0 : 2,
            lineSpacing: decoration.kind === "diary-text" ? 5 : undefined
          });
          if (label) {
            filters.push(label);
          }
        }
        break;
      case "notebook-rule":
        filters.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${Math.max(1, h)}:color=${color}:t=fill`);
        break;
      case "torn-paper":
        filters.push(
          `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${withAlpha("white", decoration.opacity ?? 0.38)}:t=fill`,
          `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${withAlpha(baseColor, 0.34)}:t=2`
        );
        break;
      case "sticker-star":
        {
          const sparkle = drawtextExpression({
            text: decoration.text ?? "*",
            x: `${x}`,
            y: `${y}`,
            fontSize: Math.max(18, Math.round(w * 0.9)),
            fontColor: color,
            boxColor: "black@0",
            boxBorderW: 0,
            fontFile: emojiFont
          });
          if (sparkle) {
            filters.push(sparkle);
          }
        }
        break;
      case "emoji-sticker":
        filters.push(
          `drawbox=x=${x - 2}:y=${y - 2}:w=${w + 8}:h=${h + 8}:color=${withAlpha("white", 0.15)}:t=fill`
        );
        {
          const emoji = drawtextExpression({
            text: decoration.text ?? "✨",
            x: `${x}`,
            y: `${y}`,
            fontSize: Math.max(22, Math.round(w * 0.86)),
            fontColor: color,
            boxColor: "black@0",
            boxBorderW: 0,
            borderWidth: 1,
            fontFile: emojiFont
          });
          if (emoji) {
            filters.push(emoji);
          }
        }
        break;
      default:
        break;
    }
  }

  return filters;
}

function buildTextLayout(page: BookPage, width: number, height: number) {
  const bookX = Math.round(width * 0.1);
  const bookY = Math.round(height * 0.085);
  const bookW = Math.round(width * 0.8);
  const bookH = Math.round(height * 0.8);
  const coverX = Math.round(width * 0.22);
  const coverY = Math.round(height * 0.12);
  const coverW = Math.round(width * 0.56);
  const coverH = Math.round(height * 0.76);

  if (page.kind === "cover") {
    return {
      label: {
        x: `${coverX + 28}`,
        y: `${coverY + 32}`
      },
      title: {
        x: `${coverX + coverW / 2}-text_w/2`,
        y: `${coverY + Math.round(coverH * 0.24)}`
      },
      subtitle: {
        x: `${coverX + coverW / 2}-text_w/2`,
        y: `${coverY + Math.round(coverH * 0.4)}`
      },
      footer: {
        x: `${coverX + coverW - 96}-text_w`,
        y: `${coverY + coverH - 60}`
      }
    };
  }

  if (page.kind === "chapter-divider" || page.kind === "outro") {
    return {
      label: {
        x: `${bookX + 28}`,
        y: `${bookY + 24}`
      },
      title: {
        x: `${bookX + bookW / 2}-text_w/2`,
        y: `${bookY + Math.round(bookH * 0.33)}`
      },
      subtitle: {
        x: `${bookX + bookW / 2}-text_w/2`,
        y: `${bookY + Math.round(bookH * 0.48)}`
      },
      footer: {
        x: `${bookX + bookW - 72}-text_w`,
        y: `${bookY + bookH - 54}`
      }
    };
  }

  return {
    label: {
      x: `${bookX + 28}`,
      y: `${bookY + 18}`
    },
    title: {
      x: `${bookX + 28}`,
      y: `${bookY + 48}`
    },
    subtitle: {
      x: `${bookX + 28}`,
      y: `${bookY + 82}`
    },
    footer: {
      x: `${bookX + bookW - 74}-text_w`,
      y: `${bookY + bookH - 60}`
    }
  };
}

function buildPageDecorationFilters(
  page: BookPage,
  pageIndex: number,
  width: number,
  height: number,
  themePreset?: ThemePreset
) {
  const filters = buildSurfaceTextureFilters(page, width, height, page.kind === "cover");
  const headingColor = page.textTreatment.titleColor;
  const subtitleColor = page.textTreatment.subtitleColor;
  const textLayout = buildTextLayout(page, width, height);
  const pageLabel =
    page.kind === "cover"
      ? "Memory Book"
      : page.kind === "chapter-divider"
        ? "Turning the page"
        : `Page ${String(pageIndex).padStart(2, "0")}`;

  const label = drawtextExpression({
    text: pageLabel,
    x: textLayout.label.x,
    y: textLayout.label.y,
    fontSize: page.kind === "cover" ? 24 : 18,
    fontColor: page.textTreatment.labelColor,
    boxColor: page.kind === "cover" ? page.textTreatment.titleBoxColor : page.textTreatment.captionBoxColor,
    boxBorderW: page.kind === "cover" ? 16 : 14
  });
  if (label) {
    filters.push(label);
  }

  if (page.title) {
    const title = drawtextExpression({
      text: applyBookTitleCase(page.title, page.textTreatment.titleCase),
      x: textLayout.title.x,
      y: textLayout.title.y,
      fontSize:
        page.kind === "cover"
          ? page.textTreatment.style === "cinematic"
            ? 58
            : 52
          : page.kind === "chapter-divider"
            ? 40
          : 26,
      fontColor: headingColor,
      boxColor:
        page.kind === "content" ? page.textTreatment.captionBoxColor : page.textTreatment.titleBoxColor,
      boxBorderW: page.kind === "content" ? 14 : 18
    });
    if (title) {
      filters.push(title);
    }
  }

  if (page.subtitle) {
    const subtitle = drawtextExpression({
      text: applyBookTitleCase(page.subtitle, page.textTreatment.style === "yearbook" ? "upper" : "mixed"),
      x: textLayout.subtitle.x,
      y: textLayout.subtitle.y,
      fontSize: page.kind === "cover" ? 26 : 22,
      fontColor: subtitleColor,
      boxColor: page.kind === "content" ? page.textTreatment.captionBoxColor : page.textTreatment.titleBoxColor,
      boxBorderW: page.kind === "content" ? 12 : 16
    });
    if (subtitle) {
      filters.push(subtitle);
    }
  }

  filters.push(...buildDecorationFilters(page, width, height, ["paper", "under-media"]));

  if (page.kind === "content" && page.diaryText) {
    const diaryX = Math.round(width * (page.layoutType === "hero" ? 0.66 : 0.12));
    const diaryY = Math.round(height * (page.layoutType === "hero" ? 0.27 : 0.765));
    const diaryW = Math.round(width * (page.layoutType === "hero" ? 0.2 : 0.7));
    const diaryH = Math.round(height * (page.layoutType === "hero" ? 0.34 : 0.095));
    filters.push(
      `drawbox=x=${diaryX - 8}:y=${diaryY - 8}:w=${diaryW + 16}:h=${diaryH + 16}:color=white@0.12:t=fill`,
      `drawbox=x=${diaryX - 8}:y=${diaryY - 8}:w=${diaryW + 16}:h=${diaryH + 16}:color=0x2B2B2B@0.18:t=1`
    );
    for (let index = 0; index < 5; index += 1) {
      filters.push(
        `drawbox=x=${diaryX}:y=${diaryY + 25 + index * 28}:w=${diaryW}:h=1:color=0x87A2BE@0.22:t=fill`
      );
    }
    const lines = wrapTextLines(
      page.diaryText,
      page.layoutType === "hero" ? 23 : 66,
      page.layoutType === "hero" ? 5 : 3
    );
    lines.forEach((line, index) => {
      const diaryNote = drawtextExpression({
        text: line,
        x: `${diaryX}`,
        y: `${diaryY + index * (page.layoutType === "hero" ? 30 : 31)}`,
        fontSize: page.layoutType === "hero" ? 18 : 20,
        fontColor: "0x202020",
        boxColor: "white@0",
        boxBorderW: 0,
        borderWidth: 0
      });
      if (diaryNote) {
        filters.push(diaryNote);
      }
    });
    if (!lines.length) {
      const diaryNote = drawtextExpression({
        text: "Dear diary: saved this one.",
        x: `${diaryX}`,
        y: `${diaryY}`,
        fontSize: 18,
        fontColor: "0x202020",
        boxColor: "white@0",
        boxBorderW: 0,
        borderWidth: 0
      });
      if (diaryNote) {
        filters.push(diaryNote);
      }
    }
  }

  return filters.join(",");
}

function buildStillMotionFilter(
  clip: TimelineClip,
  width: number,
  height: number,
  fps: number
) {
  const frames = Math.max(1, Math.round(clip.displayDurationSec * fps));
  const frameDivider = Math.max(frames - 1, 1);
  const centerX = "iw/2-(iw/zoom/2)";
  const centerY = "ih/2-(ih/zoom/2)";

  switch (clip.motionEffect) {
    case "zoom-out":
      return `scale=${Math.ceil(width * 1.28)}:${Math.ceil(
        height * 1.28
      )}:force_original_aspect_ratio=increase,zoompan=z='if(eq(on,0),1.095,max(zoom-0.00032,1.01))':x='${centerX}':y='${centerY}':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`;
    case "pan-left":
      return `scale=${Math.ceil(width * 1.22)}:${Math.ceil(
        height * 1.28
      )}:force_original_aspect_ratio=increase,zoompan=z='1.055':x='max((iw-iw/zoom)*(1-on/${frameDivider})*0.42,0)':y='${centerY}':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`;
    case "pan-right":
      return `scale=${Math.ceil(width * 1.22)}:${Math.ceil(
        height * 1.28
      )}:force_original_aspect_ratio=increase,zoompan=z='1.055':x='min((iw-iw/zoom)*(on/${frameDivider})*0.42,max(iw-iw/zoom,0))':y='${centerY}':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`;
    case "zoom-in":
    default:
      return `scale=${Math.ceil(width * 1.28)}:${Math.ceil(
        height * 1.28
      )}:force_original_aspect_ratio=increase,zoompan=z='min(zoom+0.00034,1.095)':x='${centerX}':y='${centerY}':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`;
  }
}

function renderCoverOrDividerPage(
  page: BookPage,
  outputPath: string,
  width: number,
  height: number,
  fps: number,
  pageIndex: number,
  themePreset?: ThemePreset
) {
  const filter = buildPageDecorationFilters(page, pageIndex, width, height, themePreset);
  const pushZoom =
    page.kind === "cover"
      ? `scale=${Math.ceil(width * 1.06)}:${Math.ceil(height * 1.06)}:force_original_aspect_ratio=increase,zoompan=z='min(1.0+0.00045*on,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`
      : `scale=${Math.ceil(width * 1.03)}:${Math.ceil(height * 1.03)}:force_original_aspect_ratio=increase,zoompan=z='min(1.0+0.00025*on,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`;
  return runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${resolveBackgroundColor(page.backgroundStyle)}:s=${width}x${height}:r=${fps}:d=${page.durationSec.toFixed(3)}`,
    "-vf",
    `${filter},${pushZoom},setsar=1,format=yuv420p`,
    "-t",
    page.durationSec.toFixed(3),
    "-r",
    `${fps}`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-s",
    `${width}x${height}`,
    "-movflags",
    "+faststart",
    outputPath
  ], undefined, { timeoutMs: PAGE_RENDER_TIMEOUT_MS });
}

function buildImageSlotFilter(
  clip: TimelineClip,
  innerWidth: number,
  innerHeight: number,
  outerWidth: number,
  outerHeight: number,
  fps: number,
  pageDurationSec: number,
  frameColor: string,
  rotationDeg = 0
) {
  return `${buildStillMotionFilter(
    {
      ...clip,
      displayDurationSec: Math.max(clip.displayDurationSec, pageDurationSec)
    },
    innerWidth,
    innerHeight,
    fps
  )},pad=${outerWidth}:${outerHeight}:(ow-iw)/2:(oh-ih)/2:color=${frameColor},format=rgba${
    Math.abs(rotationDeg) > 0.01
      ? `,rotate=${(rotationDeg * Math.PI / 180).toFixed(6)}:ow=iw:oh=ih:c=none`
      : ""
  },setsar=1`;
}

function buildVideoSlotFilter(
  clip: TimelineClip,
  innerWidth: number,
  innerHeight: number,
  outerWidth: number,
  outerHeight: number,
  fps: number,
  pageDurationSec: number,
  frameColor: string,
  rotationDeg = 0
) {
  const padSec = Math.max(0, pageDurationSec - clip.trimDurationSec);
  return `${buildScalePadFilter(innerWidth, innerHeight)},fps=${fps}${
    padSec > 0.02 ? `,tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)}` : ""
  },pad=${outerWidth}:${outerHeight}:(ow-iw)/2:(oh-ih)/2:color=${frameColor},format=rgba${
    Math.abs(rotationDeg) > 0.01
      ? `,rotate=${(rotationDeg * Math.PI / 180).toFixed(6)}:ow=iw:oh=ih:c=none`
      : ""
  },setsar=1`;
}

async function renderContentPage(
  page: BookPage,
  clipMap: Map<string, TimelineClip>,
  outputPath: string,
  width: number,
  height: number,
  fps: number,
  pageIndex: number,
  themePreset?: ThemePreset
) {
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${resolveBackgroundColor(page.backgroundStyle)}:s=${width}x${height}:r=${fps}:d=${page.durationSec.toFixed(3)}`
  ];

  for (const slot of page.slots) {
    if (slot.mediaType === "image") {
      args.push("-loop", "1", "-i", slot.sourcePath);
      continue;
    }

    args.push(
      "-ss",
      slot.trimStartSec.toFixed(3),
      "-t",
      Math.max(0.1, slot.trimDurationSec).toFixed(3),
      "-i",
      slot.sourcePath
    );
  }

  const filterChains: string[] = [
    `[0:v]${buildPageDecorationFilters(page, pageIndex, width, height, themePreset)}[canvas0]`
  ];
  let currentLabel = "[canvas0]";

  page.slots.forEach((slot, index) => {
    const clip = clipMap.get(slot.clipId);
    const frameWidth = Math.round(slot.frame.width * width);
    const frameHeight = Math.round(slot.frame.height * height);
    const innerWidth = Math.max(24, frameWidth - 28);
    const innerHeight = Math.max(24, frameHeight - 28);
    const x = Math.round(slot.frame.x * width);
    const y = Math.round(slot.frame.y * height);
    const shadowX = x + 10;
    const shadowY = y + 12;
    const frameColor =
      page.textTreatment.style === "yearbook"
        ? "0xF4EFE4"
        : page.textTreatment.style === "cinematic"
          ? "0xEEE4D2"
          : page.textTreatment.style === "minimal"
            ? "0xFEFEFC"
            : "0xFFF8ED";
    const inputLabel = `[${index + 1}:v]`;
    const slotLabel = `[slot${index}]`;
    const foregroundLabel = `[slotfg${index}]`;
    const shadowSeedLabel = `[slotshadowseed${index}]`;
    const shadowLabel = `[slotshadow${index}]`;
    const afterShadowLabel = `[canvasshadow${index}]`;
    const nextCanvasLabel = `[canvas${index + 1}]`;
    const fallbackClip =
      clip ??
      ({
        id: slot.clipId,
        assetId: slot.assetId,
        chapterId: slot.chapterId,
        mediaType: slot.mediaType,
        sourcePath: slot.sourcePath,
        audioSourcePath: slot.audioSourcePath,
        trimStartSec: slot.trimStartSec,
        trimDurationSec: slot.trimDurationSec,
        displayDurationSec: slot.displayDurationSec,
        score: 0
      } satisfies TimelineClip);
    const slotClip: TimelineClip = {
      ...fallbackClip,
      displayDurationSec: slot.displayDurationSec,
      trimDurationSec: slot.trimDurationSec,
      motionEffect: slot.motionEffect ?? fallbackClip.motionEffect
    };

    filterChains.push(
      `${inputLabel}${
        slot.mediaType === "image"
          ? buildImageSlotFilter(
              slotClip,
              innerWidth,
              innerHeight,
              frameWidth,
              frameHeight,
              fps,
              page.durationSec,
              frameColor,
              slot.frame.rotationDeg ?? 0
            )
          : buildVideoSlotFilter(
              slotClip,
              innerWidth,
              innerHeight,
              frameWidth,
              frameHeight,
              fps,
              page.durationSec,
              frameColor,
              slot.frame.rotationDeg ?? 0
          )
      }${slotLabel}`
    );
    filterChains.push(`${slotLabel}split${foregroundLabel}${shadowSeedLabel}`);
    filterChains.push(
      `${shadowSeedLabel}colorchannelmixer=rr=0:gg=0:bb=0:aa=0.24,boxblur=18:2${shadowLabel}`
    );
    filterChains.push(
      `${currentLabel}${shadowLabel}overlay=x=${shadowX}:y=${shadowY}${afterShadowLabel}`
    );
    filterChains.push(
      `${afterShadowLabel}${foregroundLabel}overlay=x=${x}:y=${y}${nextCanvasLabel}`
    );
    currentLabel = nextCanvasLabel;
  });

  const textLayout = buildTextLayout(page, width, height);
  const footerText = drawtextExpression({
    text:
      page.kind === "content"
        ? `${getThemePresetConfig(themePreset ?? "scrapbook").label.toLowerCase()} page`
        : undefined,
    x: textLayout.footer.x,
    y: textLayout.footer.y,
    fontSize: 16,
    fontColor: page.textTreatment.subtitleColor,
    boxColor: page.textTreatment.captionBoxColor,
    boxBorderW: 12
  });
  const finalLabel = "[vout]";
  const overMediaFilters = buildDecorationFilters(page, width, height, ["over-media"]).join(",");
  filterChains.push(
    `${currentLabel}${overMediaFilters ? `${overMediaFilters},` : ""}${footerText ? `${footerText},` : ""}fps=${fps},setsar=1,format=yuv420p${finalLabel}`
  );

  await runFfmpeg([
    ...args,
    "-filter_complex",
    filterChains.join(";"),
    "-map",
    finalLabel,
    "-t",
    page.durationSec.toFixed(3),
    "-r",
    `${fps}`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-s",
    `${width}x${height}`,
    "-movflags",
    "+faststart",
    outputPath
  ], undefined, { timeoutMs: PAGE_RENDER_TIMEOUT_MS });
}

async function renderBookPage(
  page: BookPage,
  clipMap: Map<string, TimelineClip>,
  outputPath: string,
  width: number,
  height: number,
  fps: number,
  pageIndex: number,
  themePreset?: ThemePreset
) {
  if ((page.kind === "cover" && !page.slots.length) || page.kind === "chapter-divider" || page.kind === "outro") {
    return renderCoverOrDividerPage(page, outputPath, width, height, fps, pageIndex, themePreset);
  }
  return renderContentPage(page, clipMap, outputPath, width, height, fps, pageIndex, themePreset);
}

async function renderHardFallbackPage(
  page: BookPage,
  outputPath: string,
  width: number,
  height: number,
  fps: number
) {
  const bookX = Math.round(width * 0.1);
  const bookY = Math.round(height * 0.085);
  const bookW = Math.round(width * 0.8);
  const bookH = Math.round(height * 0.8);
  const halfW = Math.round(bookW / 2);
  const surfaceColor = resolveBackgroundColor(page.backgroundStyle);
  const paperColor = page.material?.paperColor ?? "0xFFF8ED";
  const edgeColor = page.material?.pageEdgeColor ?? "0xD7C8B2";
  const filter = [
    `drawbox=x=0:y=0:w=${width}:h=${height}:color=${surfaceColor}:t=fill`,
    `drawbox=x=${bookX + 24}:y=${bookY + 26}:w=${bookW}:h=${bookH}:color=black@0.18:t=fill`,
    `drawbox=x=${bookX}:y=${bookY}:w=${halfW - 4}:h=${bookH}:color=${paperColor}:t=fill`,
    `drawbox=x=${bookX + halfW + 4}:y=${bookY}:w=${halfW - 4}:h=${bookH}:color=${paperColor}:t=fill`,
    `drawbox=x=${bookX}:y=${bookY}:w=${halfW - 4}:h=${bookH}:color=${edgeColor}:t=3`,
    `drawbox=x=${bookX + halfW + 4}:y=${bookY}:w=${halfW - 4}:h=${bookH}:color=${edgeColor}:t=3`,
    `drawbox=x=${bookX + halfW - 4}:y=${bookY - 8}:w=8:h=${bookH + 16}:color=black@0.18:t=fill`,
    `fps=${fps}`,
    "setsar=1",
    "format=yuv420p"
  ].join(",");

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${surfaceColor}:s=${width}x${height}:r=${fps}:d=${page.durationSec.toFixed(3)}`,
    "-vf",
    filter,
    "-t",
    page.durationSec.toFixed(3),
    "-r",
    `${fps}`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-s",
    `${width}x${height}`,
    "-movflags",
    "+faststart",
    outputPath
  ], undefined, { timeoutMs: PAGE_RENDER_TIMEOUT_MS });
}

async function renderValidatedBookPage(options: {
  page: BookPage;
  clipMap: Map<string, TimelineClip>;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  pageIndex: number;
  themePreset?: ThemePreset;
}) {
  const label = `page-${String(options.pageIndex).padStart(3, "0")} (${options.page.id})`;
  const validation = buildVideoValidationOptions({
    label,
    width: options.width,
    height: options.height,
    fps: options.fps,
    minDurationSec: Math.max(0.1, options.page.durationSec - 0.18)
  });

  try {
    return await writeAtomicVideo({
      outputPath: options.outputPath,
      label,
      validation,
      render: (temporaryOutputPath) =>
        renderBookPage(
          options.page,
          options.clipMap,
          temporaryOutputPath,
          options.width,
          options.height,
          options.fps,
          options.pageIndex,
          options.themePreset
        )
    });
  } catch (error) {
    console.warn(`[render] ${label} failed validation/render; retrying without media slots. ${summarizeRenderError(error)}`);
  }

  const noMediaPage: BookPage = {
    ...options.page,
    slots: []
  };

  try {
    return await writeAtomicVideo({
      outputPath: options.outputPath,
      label: `${label} media-free fallback`,
      validation,
      render: (temporaryOutputPath) =>
        renderBookPage(
          noMediaPage,
          options.clipMap,
          temporaryOutputPath,
          options.width,
          options.height,
          options.fps,
          options.pageIndex,
          options.themePreset
        )
    });
  } catch (error) {
    console.warn(`[render] ${label} media-free fallback failed; writing hard fallback page. ${summarizeRenderError(error)}`);
  }

  return writeAtomicVideo({
    outputPath: options.outputPath,
    label: `${label} hard fallback`,
    validation,
    render: (temporaryOutputPath) =>
      renderHardFallbackPage(
        options.page,
        temporaryOutputPath,
        options.width,
        options.height,
        options.fps
      )
  });
}

function buildPageBodyWindow(
  timeline: Timeline,
  pageIndex: number,
  transitionDurations: number[]
) {
  const page = timeline.book!.pages[pageIndex]!;
  const incomingSec = pageIndex > 0 ? transitionDurations[pageIndex - 1] ?? 0 : 0;
  const outgoingSec =
    pageIndex < timeline.book!.pages.length - 1
      ? transitionDurations[pageIndex] ?? 0
      : 0;
  const startSec = Number(incomingSec.toFixed(3));
  const durationSec = Number(Math.max(0, page.durationSec - incomingSec - outgoingSec).toFixed(3));

  return {
    startSec,
    durationSec
  };
}

async function renderBodyPiece(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number,
  width: number,
  height: number,
  fps: number
) {
  await writeAtomicVideo({
    outputPath,
    label: `body piece ${path.basename(outputPath)}`,
    validation: buildVideoValidationOptions({
      label: `body piece ${path.basename(outputPath)}`,
      width,
      height,
      fps,
      minDurationSec: Math.max(0.05, durationSec - 0.08)
    }),
    render: (temporaryOutputPath) =>
      runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-ss",
        startSec.toFixed(3),
        "-t",
        durationSec.toFixed(3),
        "-vf",
        `fps=${fps},scale=${width}:${height}:flags=lanczos,setsar=1,format=yuv420p`,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-r",
        `${fps}`,
        "-s",
        `${width}x${height}`,
        "-movflags",
        "+faststart",
        temporaryOutputPath
      ])
  });
}

function buildFallbackTransition(transition: BookPageTransition): BookPageTransition {
  return {
    ...transition,
    type: transition.type === "book-open" ? "page-flip" : transition.type,
    filterName: transition.type === "book-open" ? "pageflip-physical" : transition.filterName
  };
}

async function renderPageTransitionPiece(options: {
  fromPath: string;
  toPath: string;
  fromPage: BookPage;
  toPage: BookPage;
  transition: BookPageTransition;
  durationSec: number;
  fromMetadata: VideoProbeSummary;
  toMetadata: VideoProbeSummary;
  outputPath: string;
  tempDir: string;
  width: number;
  height: number;
  fps: number;
}) {
  const durationSec = options.durationSec;
  const label = `transition ${options.transition.id} ${path.basename(options.fromPath)} -> ${path.basename(options.toPath)}`;
  const fromDurationSec = options.fromMetadata.durationSec || options.fromPage.durationSec;
  const toDurationSec = options.toMetadata.durationSec || options.toPage.durationSec;
  const minimumPageDurationSec = durationSec + Math.max(2 / Math.max(options.fps, 1), 0.08);
  const transitionValidation = buildVideoValidationOptions({
    label,
    width: options.width,
    height: options.height,
    fps: options.fps,
    minDurationSec: Math.max(0.05, durationSec - 0.08)
  });
  const fromValidation = await validateVideoFile(options.fromPath, {
    ...buildVideoValidationOptions({
      label: `${label} from page`,
      width: options.width,
      height: options.height,
      fps: options.fps,
      minDurationSec: minimumPageDurationSec
    }),
    decode: true
  });
  const toValidation = await validateVideoFile(options.toPath, {
    ...buildVideoValidationOptions({
      label: `${label} to page`,
      width: options.width,
      height: options.height,
      fps: options.fps,
      minDurationSec: minimumPageDurationSec
    }),
    decode: true
  });

  if (!fromValidation.valid || !toValidation.valid) {
    const diagnostics = [fromValidation, toValidation]
      .filter((result) => !result.valid)
      .map(formatVideoDiagnostics)
      .join(" | ");
    throw new Error(`Cannot render ${label}; invalid transition input: ${diagnostics}`);
  }

  const tailStartSec = Number(Math.max(0, fromDurationSec - durationSec).toFixed(3));

  if (
    options.transition.type === "page-flip" ||
    options.transition.type === "book-open"
  ) {
    try {
      await writeAtomicVideo({
        outputPath: options.outputPath,
        label: `${label} physical page turn`,
        validation: transitionValidation,
        render: (temporaryOutputPath) =>
          renderPhysicalBookTransition({
            fromPath: options.fromPath,
            toPath: options.toPath,
            fromPage: options.fromPage,
            toPage: options.toPage,
            transition: {
              ...options.transition,
              durationSec
            },
            outputPath: temporaryOutputPath,
            tempDir: options.tempDir,
            width: options.width,
            height: options.height,
            fps: options.fps,
            fromTimeSec: tailStartSec,
            durationSec
          })
      });
      return;
    } catch (error) {
      console.warn(`[render] ${label} physical page turn failed; trying FFmpeg transition graph. ${summarizeRenderError(error)}`);
    }
  }

  const runTransition = async (transition: BookPageTransition) => {
    const usesStandardXfade = transition.type !== "book-open" && transition.type !== "page-flip";
    const inputWindow = usesStandardXfade
      ? planXfadeInputWindow({
          transitionDurationSec: durationSec,
          fromDurationSec,
          toDurationSec,
          fps: options.fps
        })
      : {
          leadSec: 0,
          inputDurationSec: durationSec
        };
    const fromStartSec = Number(Math.max(0, fromDurationSec - inputWindow.inputDurationSec).toFixed(3));
    const graph = buildTransitionSegmentGraph({
      id: transition.id,
      fromClipId: transition.fromPageId,
      toClipId: transition.toPageId,
      type: transition.type,
      durationSec,
      filterName: transition.filterName,
      isChapterBoundary: transition.isChapterBoundary,
      shadowStrength: transition.shadowStrength,
      curveStrength: transition.curveStrength,
      liftPx: transition.liftPx
    } satisfies TimelineTransition, usesStandardXfade
      ? {
          xfadeOffsetSec: inputWindow.leadSec,
          outputDurationSec: durationSec
        }
      : {});

    await writeAtomicVideo({
      outputPath: options.outputPath,
      label: `${label} ${transition.type}`,
      validation: transitionValidation,
      render: (temporaryOutputPath) =>
        runFfmpeg([
          "-y",
          "-ss",
          fromStartSec.toFixed(3),
          "-t",
          inputWindow.inputDurationSec.toFixed(3),
          "-i",
          options.fromPath,
          "-t",
          inputWindow.inputDurationSec.toFixed(3),
          "-i",
          options.toPath,
          "-filter_complex",
          graph.filterComplex,
          "-map",
          graph.outputLabel,
          "-t",
          durationSec.toFixed(3),
          "-r",
          `${options.fps}`,
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "-s",
          `${options.width}x${options.height}`,
          "-movflags",
          "+faststart",
          temporaryOutputPath
        ])
    });
  };

  const runCutFallback = async () => {
    const firstDurationSec = Number(Math.max(1 / Math.max(options.fps, 1), durationSec / 2).toFixed(3));
    const secondDurationSec = Number(Math.max(1 / Math.max(options.fps, 1), durationSec - firstDurationSec).toFixed(3));
    const fromStartSec = Number(Math.max(0, fromDurationSec - firstDurationSec).toFixed(3));

    await writeAtomicVideo({
      outputPath: options.outputPath,
      label: `${label} cut fallback`,
      validation: transitionValidation,
      render: (temporaryOutputPath) =>
        runFfmpeg([
          "-y",
          "-ss",
          fromStartSec.toFixed(3),
          "-t",
          firstDurationSec.toFixed(3),
          "-i",
          options.fromPath,
          "-t",
          secondDurationSec.toFixed(3),
          "-i",
          options.toPath,
          "-filter_complex",
          `[0:v]fps=${options.fps},scale=${options.width}:${options.height}:flags=lanczos,setsar=1,format=yuv420p[v0];` +
            `[1:v]fps=${options.fps},scale=${options.width}:${options.height}:flags=lanczos,setsar=1,format=yuv420p[v1];` +
            `[v0][v1]concat=n=2:v=1:a=0,trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[vout]`,
          "-map",
          "[vout]",
          "-t",
          durationSec.toFixed(3),
          "-r",
          `${options.fps}`,
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "-s",
          `${options.width}x${options.height}`,
          "-movflags",
          "+faststart",
          temporaryOutputPath
        ])
    });
  };

  try {
    await runTransition(options.transition);
  } catch (primaryError) {
    console.warn(`[render] ${label} primary transition failed; trying page-flip fallback. ${summarizeRenderError(primaryError)}`);
    try {
      await runTransition(buildFallbackTransition(options.transition));
    } catch (fallbackError) {
      console.warn(`[render] ${label} page-flip fallback failed; trying safe crossfade. ${summarizeRenderError(fallbackError)}`);
      try {
        await runTransition({
          ...options.transition,
          type: "crossfade",
          filterName: "fade"
        });
      } catch (crossfadeError) {
        console.warn(`[render] ${label} crossfade failed; using cut fallback. ${summarizeRenderError(crossfadeError)}`);
        await runCutFallback();
      }
    }
  }
}

async function assembleVideoPieces(
  pieces: TimelinePiece[],
  concatListPath: string,
  outputPath: string,
  width: number,
  height: number,
  fps: number
) {
  for (const piece of pieces) {
    await assertValidVideoFile(piece.path, {
      ...buildVideoValidationOptions({
        label: `${piece.kind} piece ${path.basename(piece.path)}`,
        width,
        height,
        fps,
        minDurationSec: Math.max(0.05, piece.durationSec - 0.1)
      }),
      decode: true
    });
  }

  const listFile = `${pieces
    .map((piece) => `file '${normalizeFfmpegPath(piece.path).replace(/'/g, "'\\''")}'`)
    .join("\n")}\n`;
  await writeFile(concatListPath, listFile, "utf8");

  await writeAtomicVideo({
    outputPath,
    label: `stitched video ${path.basename(outputPath)}`,
    validation: buildVideoValidationOptions({
      label: `stitched video ${path.basename(outputPath)}`,
      width,
      height,
      fps,
      minDurationSec: Math.max(0.1, pieces.reduce((sum, piece) => sum + piece.durationSec, 0) - 0.25)
    }),
    render: (temporaryOutputPath) =>
      runFfmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-vf",
        `fps=${fps},scale=${width}:${height}:flags=lanczos,setsar=1,format=yuv420p`,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-r",
        `${fps}`,
        "-s",
        `${width}x${height}`,
        "-movflags",
        "+faststart",
        temporaryOutputPath
      ])
  });
}

async function composeMusicBed(timeline: Timeline, outputPath: string) {
  const graph = buildMusicBedGraph(timeline);
  if (!graph || !timeline.audioTracks?.length) {
    return undefined;
  }

  const fadeOutStart = Math.max(0, timeline.actualDurationSec - 1.8).toFixed(3);
  const args = ["-y"];
  for (const track of timeline.audioTracks) {
    args.push(
      "-ss",
      track.sourceOffsetSec.toFixed(3),
      "-t",
      track.durationSec.toFixed(3),
      "-i",
      track.sourcePath
    );
  }

  await runFfmpeg([
    ...args,
    "-filter_complex",
    `${graph.filterComplex};${graph.outputLabel}afade=t=in:st=0:d=1.3,afade=t=out:st=${fadeOutStart}:d=1.8[musicout]`,
    "-map",
    "[musicout]",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputPath
  ]);

  return outputPath;
}

async function composeSourceAudioBed(
  timeline: Timeline,
  clipStartTimes: Map<string, number>,
  outputPath: string
) {
  const sourceClipIds = timeline.book?.pages?.length
    ? new Set(
        timeline.book.pages.flatMap((page) =>
          page.slots.filter((slot) => slot.useSourceAudio).map((slot) => slot.clipId)
        )
      )
    : undefined;
  const audioClips = timeline.clips.filter(
    (clip) =>
      clip.mediaType === "video" &&
      clip.audioSourcePath &&
      clip.sourceAudio?.hasAudio &&
      Math.min(clip.trimDurationSec, clip.displayDurationSec) > 0.08 &&
      (!sourceClipIds || sourceClipIds.has(clip.id))
  );
  const graph = buildSourceAudioBedGraph({
    timeline,
    clips: audioClips,
    clipStartTimes
  });
  if (!graph || !audioClips.length) {
    return undefined;
  }

  const args = ["-y"];
  for (const clip of audioClips) {
    const audioDurationSec = Math.max(
      0.1,
      Math.min(clip.trimDurationSec, clip.displayDurationSec)
    );
    args.push(
      "-ss",
      clip.trimStartSec.toFixed(3),
      "-t",
      audioDurationSec.toFixed(3),
      "-i",
      clip.audioSourcePath!
    );
  }

  try {
    await runFfmpeg([
      ...args,
      "-filter_complex",
      graph.filterComplex,
      "-map",
      graph.outputLabel,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputPath
    ]);
    return outputPath;
  } catch {
    return undefined;
  }
}

async function mixFinalAudio(options: {
  timeline: Timeline;
  musicPath?: string;
  sourceAudioPath?: string;
  outputPath: string;
}) {
  if (options.sourceAudioPath && options.musicPath) {
    const graph = buildFinalAudioMixGraph(
      "source+music",
      options.timeline.settings.generation?.audioEmphasis
    );
    await runFfmpeg([
      "-y",
      "-i",
      options.musicPath,
      "-i",
      options.sourceAudioPath,
      "-filter_complex",
      graph.filterComplex,
      "-map",
      graph.outputLabel,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      options.outputPath
    ]);
    return options.outputPath;
  }

  if (options.sourceAudioPath) {
    const graph = buildFinalAudioMixGraph(
      "source-only",
      options.timeline.settings.generation?.audioEmphasis
    );
    await runFfmpeg([
      "-y",
      "-i",
      options.sourceAudioPath,
      "-filter_complex",
      graph.filterComplex,
      "-map",
      graph.outputLabel,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      options.outputPath
    ]);
    return options.outputPath;
  }

  if (options.musicPath) {
    const graph = buildFinalAudioMixGraph(
      "music-only",
      options.timeline.settings.generation?.audioEmphasis
    );
    await runFfmpeg([
      "-y",
      "-i",
      options.musicPath,
      "-filter_complex",
      graph.filterComplex,
      "-map",
      graph.outputLabel,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      options.outputPath
    ]);
    return options.outputPath;
  }

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-t",
    options.timeline.actualDurationSec.toFixed(3),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    options.outputPath
  ]);
  return options.outputPath;
}

async function muxVideoWithAudio(options: {
  stitchedVideoPath: string;
  mixedAudioPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
}) {
  const stitchedMetadata = await assertValidVideoFile(options.stitchedVideoPath, {
    ...buildVideoValidationOptions({
      label: `stitched input ${path.basename(options.stitchedVideoPath)}`,
      width: options.width,
      height: options.height,
      fps: options.fps,
      minDurationSec: 0.1
    }),
    decode: true
  });

  await writeAtomicVideo({
    outputPath: options.outputPath,
    label: `final mux ${path.basename(options.outputPath)}`,
    validation: buildVideoValidationOptions({
      label: `final mux ${path.basename(options.outputPath)}`,
      width: options.width,
      height: options.height,
      fps: options.fps,
      minDurationSec: Math.max(0.1, stitchedMetadata.durationSec - 0.25)
    }),
    render: (temporaryOutputPath) =>
      runFfmpeg([
        "-y",
        "-i",
        options.stitchedVideoPath,
        "-i",
        options.mixedAudioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-b:a",
        "192k",
        "-t",
        stitchedMetadata.durationSec.toFixed(3),
        "-movflags",
        "+faststart",
        temporaryOutputPath
      ])
  });
}

async function buildBookVideoAssembly(
  timeline: Timeline,
  pagePaths: string[],
  pageMetadata: VideoProbeSummary[],
  tempDir: string
) {
  const pieces: TimelinePiece[] = [];
  const transitionDurations = timeline.book!.transitions.map((transition, index) => {
    if (!transition) {
      return 0;
    }
    const plannedDurationSec = planSafeTransitionDuration({
      requestedSec: transition.durationSec,
      fromDurationSec: pageMetadata[index]?.durationSec ?? timeline.book!.pages[index]?.durationSec ?? 0,
      toDurationSec: pageMetadata[index + 1]?.durationSec ?? timeline.book!.pages[index + 1]?.durationSec ?? 0,
      fps: timeline.renderProfile.fps
    });
    if (plannedDurationSec > 0 && Math.abs(plannedDurationSec - transition.durationSec) > 0.01) {
      console.warn(
        `[render] Adjusted ${transition.id} duration from ${transition.durationSec.toFixed(
          3
        )}s to ${plannedDurationSec.toFixed(3)}s for safe page transition timing.`
      );
    }
    if (plannedDurationSec <= 0) {
      console.warn(`[render] Skipping ${transition.id}; adjacent page clips are too short for a safe transition.`);
    }
    return plannedDurationSec;
  });

  for (let index = 0; index < timeline.book!.pages.length; index += 1) {
    const page = timeline.book!.pages[index]!;
    const bodyWindow = buildPageBodyWindow(timeline, index, transitionDurations);
    if (bodyWindow.durationSec > 0.06) {
      const bodyPath = path.join(tempDir, `body-${String(index).padStart(3, "0")}.mp4`);
      await renderBodyPiece(
        pagePaths[index]!,
        bodyPath,
        bodyWindow.startSec,
        bodyWindow.durationSec,
        timeline.renderProfile.width,
        timeline.renderProfile.height,
        timeline.renderProfile.fps
      );
      pieces.push({
        path: bodyPath,
        durationSec: bodyWindow.durationSec,
        kind: "body"
      });
    }

    if (index < timeline.book!.pages.length - 1) {
      const transition = timeline.book!.transitions[index];
      const transitionDurationSec = transitionDurations[index] ?? 0;
      if (transition && transitionDurationSec > 0.05) {
        const transitionPath = path.join(
          tempDir,
          `transition-${String(index).padStart(3, "0")}.mp4`
        );
        await renderPageTransitionPiece({
          fromPath: pagePaths[index]!,
          toPath: pagePaths[index + 1]!,
          fromPage: page,
          toPage: timeline.book!.pages[index + 1]!,
          transition,
          durationSec: transitionDurationSec,
          fromMetadata: pageMetadata[index]!,
          toMetadata: pageMetadata[index + 1]!,
          outputPath: transitionPath,
          tempDir,
          width: timeline.renderProfile.width,
          height: timeline.renderProfile.height,
          fps: timeline.renderProfile.fps
        });
        pieces.push({
          path: transitionPath,
          durationSec: transitionDurationSec,
          kind: "transition"
        });
      }
    }
  }

  if (!pieces.length) {
    throw new Error(`Timeline ${timeline.id} did not produce any assembled book video pieces.`);
  }

  const stitchedVideoPath = path.join(tempDir, "stitched.mp4");
  const concatListPath = path.join(tempDir, "concat.txt");
  await assembleVideoPieces(
    pieces,
    concatListPath,
    stitchedVideoPath,
    timeline.renderProfile.width,
    timeline.renderProfile.height,
    timeline.renderProfile.fps
  );
  return stitchedVideoPath;
}

export async function renderTimeline(
  project: ProjectRecord,
  baseTimeline: Timeline,
  destination: RenderTimelineDestination = {}
) {
  const timeline = await prepareTimelineForRender(project, baseTimeline);

  const paths = getProjectPaths(project.id);
  const tempRoot = destination.tempRoot ?? paths.tempDir;
  const tempDir = buildRunScopedTempDir(tempRoot, timeline.id);
  const outputPath = destination.outputPath ?? path.join(paths.outputsDir, `${timeline.id}.mp4`);
  const timelinePath =
    destination.timelinePath ?? path.join(paths.timelinesDir, `${timeline.id}.json`);

  await Promise.all([
    mkdir(tempDir, { recursive: true }),
    mkdir(path.dirname(outputPath), { recursive: true })
  ]);
  await writeJson(timelinePath, timeline);

  if (timeline.settings.generation?.generationMode === "wall-frame") {
    if (!timeline.wallFrame?.wallSections.length) {
      throw new Error(`Timeline ${timeline.id} did not produce a Wall Frame render plan.`);
    }
    const result = await renderWallFramePlan({
      plan: timeline.wallFrame,
      outputPath,
      tempRoot,
      renderPlanPath:
        destination.renderPlanPath ??
        path.join(path.dirname(timelinePath), `${timeline.id}.wall-frame-plan.json`),
      onProgress: destination.onProgress
        ? async (update) => destination.onProgress?.(update)
        : undefined
    });

    return {
      id: timeline.id,
      projectId: project.id,
      kind: "wall-frame",
      title: timeline.title,
      durationSec: result.durationSec,
      timelinePath,
      outputPath,
      downloadRoute:
        destination.downloadRoute ?? `/api/projects/${project.id}/downloads/${timeline.id}`
    } satisfies RenderedOutput;
  }

  const clipMap = new Map(timeline.clips.map((clip) => [clip.id, clip]));
  if (!timeline.book?.pages?.length) {
    throw new Error(`Timeline ${timeline.id} did not produce a memory-book render plan.`);
  }
  const pagePaths: string[] = [];
  const pageMetadata: VideoProbeSummary[] = [];
  for (let index = 0; index < timeline.book.pages.length; index += 1) {
    const page = timeline.book.pages[index]!;
    const pagePath = path.join(tempDir, `page-${String(index).padStart(3, "0")}.mp4`);
    pagePaths.push(pagePath);
    await renderValidatedBookPage({
        page,
        clipMap,
        outputPath: pagePath,
        width: timeline.renderProfile.width,
        height: timeline.renderProfile.height,
        fps: timeline.renderProfile.fps,
        pageIndex: index + 1,
        themePreset: timeline.settings.generation?.themePreset
      });
    pageMetadata.push(
      await assertValidVideoFile(pagePath, {
        ...buildVideoValidationOptions({
          label: `validated page ${String(index).padStart(3, "0")}`,
          width: timeline.renderProfile.width,
          height: timeline.renderProfile.height,
          fps: timeline.renderProfile.fps,
          minDurationSec: Math.max(0.1, page.durationSec - 0.18)
        }),
        decode: true
      })
    );
  }

  const stitchedVideoPath = await buildBookVideoAssembly(timeline, pagePaths, pageMetadata, tempDir);
  const musicBedPath = path.join(tempDir, "music-bed.m4a");
  const sourceBedPath = path.join(tempDir, "source-bed.m4a");
  const mixedAudioPath = path.join(tempDir, "mixed-audio.m4a");

  const clipStartTimes = calculateClipTimings(timeline);
  const requiresUploadedMusic = timeline.soundtrackPlan?.sourcePolicy === "user-uploaded-audio";
  const [musicPath, sourceAudioPath] = await Promise.all([
    composeMusicBed(timeline, musicBedPath).catch((error) => {
      if (requiresUploadedMusic) {
        throw new Error(
          `The uploaded MP3 soundtrack could not be rendered: ${summarizeRenderError(error)}`
        );
      }
      return undefined;
    }),
    composeSourceAudioBed(timeline, clipStartTimes, sourceBedPath).catch(() => undefined)
  ]);

  await mixFinalAudio({
    timeline,
    musicPath,
    sourceAudioPath,
    outputPath: mixedAudioPath
  });
  await muxVideoWithAudio({
    stitchedVideoPath,
    mixedAudioPath,
    outputPath,
    width: timeline.renderProfile.width,
    height: timeline.renderProfile.height,
    fps: timeline.renderProfile.fps
  });

  return {
    id: timeline.id,
    projectId: project.id,
    kind: timeline.kind,
    chapterId: timeline.kind === "chapter" ? timeline.chapterOrder[0] : undefined,
    title: timeline.title,
    durationSec: timeline.actualDurationSec,
    timelinePath,
    outputPath,
    downloadRoute:
      destination.downloadRoute ?? `/api/projects/${project.id}/downloads/${timeline.id}`
  } satisfies RenderedOutput;
}

export async function renderProjectTimelines(project: ProjectRecord, timelines: Timeline[]) {
  const balancedTimelines = balanceChapterSoundtracks(timelines);
  return runWithConcurrency(
    balancedTimelines,
    TIMELINE_RENDER_CONCURRENCY,
    (timeline) => renderTimeline(project, timeline)
  );
}
