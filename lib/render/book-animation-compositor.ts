import { mkdir, readFile } from "fs/promises";
import path from "path";

import sharp from "sharp";

import { runWithConcurrency } from "@/lib/utils";
import type { BookPage, BookPageTransition } from "@/lib/types";
import { runFfmpeg } from "@/scripts/ffmpeg";

const PAGE_TURN_FRAME_CONCURRENCY = resolvePositiveInteger(
  process.env.PAGE_TURN_FRAME_CONCURRENCY,
  4,
  1,
  8
);
const PAGE_TURN_CROP_CONCURRENCY = resolvePositiveInteger(
  process.env.PAGE_TURN_CROP_CONCURRENCY,
  4,
  1,
  8
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

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function encodeImageDataUri(buffer: Buffer) {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function toSvgColor(color: string) {
  if (color.startsWith("0x")) {
    return `#${color.slice(2)}`;
  }
  return color;
}

function hashTextSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

async function extractVideoFrame(options: {
  inputPath: string;
  timeSec: number;
  outputPath: string;
}) {
  await runFfmpeg([
    "-y",
    "-ss",
    options.timeSec.toFixed(3),
    "-i",
    options.inputPath,
    "-frames:v",
    "1",
    "-update",
    "1",
    options.outputPath
  ]);
}

async function prepareSnapshot(options: {
  inputPath: string;
  timeSec: number;
  width: number;
  height: number;
  outputPath: string;
}) {
  await extractVideoFrame({
    inputPath: options.inputPath,
    timeSec: options.timeSec,
    outputPath: options.outputPath
  });

  return sharp(options.outputPath)
    .resize(options.width, options.height, {
      fit: "fill"
    })
    .jpeg({
      quality: 92
    })
    .toBuffer();
}

async function extractFrameSequence(options: {
  inputPath: string;
  startSec: number;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  outputPattern: string;
}) {
  await runFfmpeg([
    "-y",
    "-ss",
    options.startSec.toFixed(3),
    "-t",
    (options.durationSec + 1 / options.fps).toFixed(3),
    "-i",
    options.inputPath,
    "-vf",
    `fps=${options.fps},scale=${options.width}:${options.height}:flags=lanczos,setsar=1`,
    "-frames:v",
    `${options.frameCount}`,
    "-start_number",
    "0",
    options.outputPattern
  ]);
}

async function loadFrameSequence(options: {
  directory: string;
  prefix: string;
  frameCount: number;
  width: number;
  height: number;
  fallbackInputPath: string;
  fallbackStartSec: number;
  fps: number;
}) {
  const buffers: Buffer[] = [];
  let lastBuffer: Buffer | undefined;

  for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
    const framePath = path.join(options.directory, `${options.prefix}-${String(frameIndex).padStart(4, "0")}.png`);
    try {
      const buffer = await readFile(framePath);
      lastBuffer = await sharp(buffer)
        .resize(options.width, options.height, {
          fit: "fill"
        })
        .jpeg({
          quality: 92
        })
        .toBuffer();
      buffers.push(lastBuffer);
    } catch {
      if (!lastBuffer) {
        lastBuffer = await prepareSnapshot({
          inputPath: options.fallbackInputPath,
          timeSec: options.fallbackStartSec + frameIndex / options.fps,
          width: options.width,
          height: options.height,
          outputPath: path.join(options.directory, `${options.prefix}-fallback-${String(frameIndex).padStart(4, "0")}.jpg`)
        });
      }
      buffers.push(lastBuffer);
    }
  }

  return buffers;
}

function buildPaperLineSet(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
}) {
  const lines: string[] = [];
  for (let index = 0; index < 11; index += 1) {
    const y = options.y + options.height * (0.065 + index * 0.082);
    lines.push(
      `<rect x="${options.x + 8}" y="${y.toFixed(2)}" width="${Math.max(12, options.width - 16)}" height="1.15" fill="${options.color}" opacity="${(options.opacity * (0.48 + (index % 4) * 0.16)).toFixed(3)}" />`
    );
  }
  return lines.join("");
}

function buildPaperFiberSet(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  seed: number;
  color: string;
}) {
  const shapes: string[] = [];
  for (let index = 0; index < 18; index += 1) {
    const offsetX = ((options.seed + index * 37) % 100) / 100;
    const offsetY = ((options.seed + index * 53) % 100) / 100;
    const cx = options.x + 8 + offsetX * Math.max(12, options.width - 16);
    const cy = options.y + 10 + offsetY * Math.max(12, options.height - 20);
    const radius = 0.9 + ((options.seed + index * 11) % 4) * 0.35;
    const opacity = 0.03 + ((options.seed + index * 19) % 5) * 0.012;
    shapes.push(
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" fill="${options.color}" opacity="${opacity.toFixed(3)}" />`
    );
  }
  return shapes.join("");
}

function buildFrameSvg(options: {
  width: number;
  height: number;
  imageUri: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}">
    <image href="${options.imageUri}" x="0" y="0" width="${options.width}" height="${options.height}" />
  </svg>`;
}

function buildPageTurnLeafPath(options: {
  seamX: number;
  top: number;
  bottom: number;
  freeX: number;
  curve: number;
  sway: number;
}) {
  const middleY = (options.top + options.bottom) / 2;
  const pull = Math.abs(options.freeX - options.seamX) * 0.2;
  const curveSign = options.freeX >= options.seamX ? 1 : -1;
  const controlX = options.freeX - curveSign * pull;
  return [
    `M ${options.seamX.toFixed(2)} ${options.top.toFixed(2)}`,
    `C ${(options.seamX + curveSign * options.curve * 0.24).toFixed(2)} ${(options.top + options.curve * 0.08).toFixed(2)} ${controlX.toFixed(2)} ${(options.top + options.sway).toFixed(2)} ${options.freeX.toFixed(2)} ${(options.top + options.curve * 0.42).toFixed(2)}`,
    `L ${options.freeX.toFixed(2)} ${(options.bottom - options.curve * 0.42).toFixed(2)}`,
    `C ${controlX.toFixed(2)} ${(options.bottom - options.sway).toFixed(2)} ${(options.seamX + curveSign * options.curve * 0.24).toFixed(2)} ${(options.bottom - options.curve * 0.08).toFixed(2)} ${options.seamX.toFixed(2)} ${options.bottom.toFixed(2)}`,
    `Q ${(options.seamX + curveSign * options.curve * 0.06).toFixed(2)} ${middleY.toFixed(2)} ${options.seamX.toFixed(2)} ${options.top.toFixed(2)}`,
    "Z"
  ].join(" ");
}

function buildShadowPath(options: {
  seamX: number;
  top: number;
  bottom: number;
  freeX: number;
  curve: number;
  sway: number;
  offsetX: number;
  offsetY: number;
}) {
  return buildPageTurnLeafPath({
    seamX: options.seamX + options.offsetX,
    top: options.top + options.offsetY,
    bottom: options.bottom + options.offsetY,
    freeX: options.freeX + options.offsetX,
    curve: options.curve,
    sway: options.sway
  });
}

function buildRevealRect(progress: number, bookX: number, bookWidth: number, seamX: number, freeX: number) {
  const rightEdge = bookX + bookWidth;
  if (progress < 0.54) {
    const x = clamp(Math.min(freeX - 5, rightEdge - 4), seamX + 6, rightEdge - 4);
    return {
      x,
      width: Math.max(0, rightEdge - x + 10)
    };
  }

  const x = clamp(Math.min(freeX - 12, seamX - 8), bookX + 16, seamX - 6);
  return {
    x,
    width: Math.max(0, rightEdge - x + 10)
  };
}

function buildPageTurnSvg(options: {
  width: number;
  height: number;
  fromImageUri: string;
  toImageUri: string;
  fromRightImageUri: string;
  transition: BookPageTransition;
  toPage: BookPage;
  progress: number;
  seed: number;
}) {
  const width = options.width;
  const height = options.height;
  const eased = easeInOutCubic(options.progress);

  if (eased <= 0.012) {
    return buildFrameSvg({
      width,
      height,
      imageUri: options.fromImageUri
    });
  }

  if (eased >= 0.988) {
    return buildFrameSvg({
      width,
      height,
      imageUri: options.toImageUri
    });
  }

  const bookX = width * 0.1;
  const bookY = height * 0.085;
  const bookWidth = width * 0.8;
  const bookHeight = height * 0.8;
  const seamX = bookX + bookWidth / 2;
  const top = bookY;
  const bottom = bookY + bookHeight;
  const maxPageWidth = bookWidth / 2 - 8;
  const theta = eased * Math.PI;
  const frontVisible = eased <= 0.5;
  const projectedWidth = Math.max(10, Math.abs(Math.cos(theta)) * maxPageWidth);
  const curve = Math.sin(theta) * maxPageWidth * (0.13 + (options.transition.curveStrength ?? 0.78) * 0.2);
  const sway = Math.sin(theta) * clamp(options.transition.liftPx ?? 46, 28, 72) * 0.22;
  const freeX = frontVisible ? seamX + projectedWidth : seamX - projectedWidth;
  const leafPath = buildPageTurnLeafPath({
    seamX,
    top,
    bottom,
    freeX,
    curve,
    sway
  });
  const shadowPath = buildShadowPath({
    seamX,
    top,
    bottom,
    freeX,
    curve,
    sway,
    offsetX: 10,
    offsetY: 8
  });
  const revealRect = buildRevealRect(eased, bookX, bookWidth, seamX, freeX);
  const globalRevealOpacity = clamp((eased - 0.03) / 0.7, 0.24, 1);
  const fromOpacity = clamp(1 - Math.max(0, eased - 0.18) * 1.25, 0.14, 1);
  const edgeDirection = frontVisible ? 1 : -1;
  const leafX = Math.min(seamX, freeX);
  const leafWidth = Math.max(18, Math.abs(freeX - seamX) + Math.abs(curve) * 0.24);
  const paperColor = toSvgColor(options.toPage.material.paperColor);
  const edgeColor = toSvgColor(options.toPage.material.pageEdgeColor);
  const shadowOpacity = clamp(
    (options.transition.shadowStrength ?? options.toPage.material.pageCurlShadowOpacity) +
      Math.sin(theta) * 0.14,
    0.24,
    0.64
  );
  const quickSheets = options.transition.isChapterBoundary
    ? [0.16, 0.32, 0.48]
        .map((lag, index) => {
          const sheetProgress = clamp((eased - lag) / 0.62, 0, 1);
          if (sheetProgress <= 0.02 || sheetProgress >= 0.98) {
            return "";
          }
          const sheetTheta = sheetProgress * Math.PI;
          const sheetWidth = Math.max(8, Math.abs(Math.cos(sheetTheta)) * maxPageWidth);
          const sheetFreeX = seamX + sheetWidth;
          const sheetCurve = Math.sin(sheetTheta) * maxPageWidth * (0.08 + index * 0.025);
          const sheetPath = buildPageTurnLeafPath({
            seamX,
            top: top + 4 + index * 5,
            bottom: bottom - 4 - index * 5,
            freeX: sheetFreeX,
            curve: sheetCurve,
            sway: Math.sin(sheetTheta) * 8
          });
          return `<path d="${sheetPath}" fill="${paperColor}" opacity="${(0.2 - index * 0.04).toFixed(3)}" stroke="${edgeColor}" stroke-opacity="${(0.38 - index * 0.06).toFixed(3)}" stroke-width="1.5" />`;
        })
        .join("")
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <filter id="pageShadow" x="-20%" y="-20%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="18" />
      </filter>
      <filter id="softBlur" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="0.65" />
      </filter>
      <linearGradient id="leafShade" x1="${frontVisible ? "0%" : "100%"}" y1="0%" x2="${frontVisible ? "100%" : "0%"}" y2="0%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.08)" />
        <stop offset="38%" stop-color="rgba(0,0,0,0.07)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.24)" />
      </linearGradient>
      <linearGradient id="leafEdge" x1="${frontVisible ? "0%" : "100%"}" y1="0%" x2="${frontVisible ? "100%" : "0%"}" y2="0%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.8)" />
        <stop offset="100%" stop-color="${edgeColor}" stop-opacity="0.9" />
      </linearGradient>
      <linearGradient id="leafBackLight" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="white" stop-opacity="0.08" />
        <stop offset="100%" stop-color="${paperColor}" stop-opacity="0.03" />
      </linearGradient>
      <clipPath id="revealClip">
        <rect x="${revealRect.x.toFixed(2)}" y="${(bookY - 10).toFixed(2)}" width="${revealRect.width.toFixed(2)}" height="${(bookHeight + 20).toFixed(2)}" rx="2" />
      </clipPath>
      <clipPath id="leafClip">
        <path d="${leafPath}" />
      </clipPath>
    </defs>
    <image href="${options.fromImageUri}" x="0" y="0" width="${width}" height="${height}" opacity="${fromOpacity.toFixed(3)}" />
    <image href="${options.toImageUri}" x="0" y="0" width="${width}" height="${height}" opacity="${globalRevealOpacity.toFixed(3)}" filter="url(#softBlur)" clip-path="url(#revealClip)" />
    <image href="${options.toImageUri}" x="0" y="0" width="${width}" height="${height}" clip-path="url(#revealClip)" />
    ${quickSheets}
    <path d="${shadowPath}" fill="black" opacity="${shadowOpacity.toFixed(3)}" filter="url(#pageShadow)" />
    ${
      frontVisible
        ? `<g clip-path="url(#leafClip)">
            <image href="${options.fromRightImageUri}" x="${leafX.toFixed(2)}" y="${top.toFixed(2)}" width="${leafWidth.toFixed(2)}" height="${bookHeight.toFixed(2)}" preserveAspectRatio="none" />
            <rect x="${leafX.toFixed(2)}" y="${top.toFixed(2)}" width="${leafWidth.toFixed(2)}" height="${bookHeight.toFixed(2)}" fill="url(#leafShade)" />
          </g>`
        : `<g clip-path="url(#leafClip)">
            <rect x="${leafX.toFixed(2)}" y="${top.toFixed(2)}" width="${leafWidth.toFixed(2)}" height="${bookHeight.toFixed(2)}" fill="${paperColor}" />
            <rect x="${leafX.toFixed(2)}" y="${top.toFixed(2)}" width="${leafWidth.toFixed(2)}" height="${bookHeight.toFixed(2)}" fill="url(#leafBackLight)" />
            ${buildPaperLineSet({
              x: leafX,
              y: top,
              width: leafWidth,
              height: bookHeight,
              color: edgeColor,
              opacity: 0.12
            })}
            ${buildPaperFiberSet({
              x: leafX,
              y: top,
              width: leafWidth,
              height: bookHeight,
              seed: options.seed + 23,
              color: edgeColor
            })}
            <rect x="${leafX.toFixed(2)}" y="${top.toFixed(2)}" width="${leafWidth.toFixed(2)}" height="${bookHeight.toFixed(2)}" fill="url(#leafShade)" opacity="0.72" />
          </g>`
    }
    <path d="${leafPath}" fill="none" stroke="url(#leafEdge)" stroke-width="${frontVisible ? 2.6 : 2.9}" />
    <path d="M ${(freeX + edgeDirection * 1.3).toFixed(2)} ${(top + curve * 0.22).toFixed(2)} L ${(freeX + edgeDirection * 1.3).toFixed(2)} ${(bottom - curve * 0.22).toFixed(2)}" stroke="${edgeColor}" stroke-opacity="0.82" stroke-width="3.2" />
    <rect x="${(seamX - 4).toFixed(2)}" y="${(top + 6).toFixed(2)}" width="8" height="${(bookHeight - 12).toFixed(2)}" fill="black" opacity="${options.toPage.material.gutterShadowOpacity.toFixed(3)}" />
  </svg>`;
}

function buildBookOpenSvg(options: {
  width: number;
  height: number;
  fromImageUri: string;
  fromCoverImageUri: string;
  toImageUri: string;
  progress: number;
  transition: BookPageTransition;
  toPage: BookPage;
  seed: number;
}) {
  const width = options.width;
  const height = options.height;
  const eased = easeInOutCubic(options.progress);

  if (eased <= 0.01) {
    return buildFrameSvg({
      width,
      height,
      imageUri: options.fromImageUri
    });
  }

  if (eased >= 0.99) {
    return buildFrameSvg({
      width,
      height,
      imageUri: options.toImageUri
    });
  }

  const bookX = width * 0.22;
  const bookY = height * 0.12;
  const bookWidth = width * 0.56;
  const bookHeight = height * 0.76;
  const hingeX = bookX + 10;
  const theta = eased * (Math.PI / 1.82);
  const visibleWidth = Math.max(10, Math.cos(theta) * bookWidth);
  const freeX = hingeX + visibleWidth;
  const curve = Math.sin(theta) * bookWidth * 0.16;
  const sway = Math.sin(theta) * clamp(options.transition.liftPx ?? 54, 34, 78) * 0.2;
  const flapPath = buildPageTurnLeafPath({
    seamX: hingeX,
    top: bookY,
    bottom: bookY + bookHeight,
    freeX,
    curve,
    sway
  });
  const shadowPath = buildShadowPath({
    seamX: hingeX,
    top: bookY,
    bottom: bookY + bookHeight,
    freeX,
    curve,
    sway,
    offsetX: 12,
    offsetY: 10
  });
  const revealWidth = clamp(bookWidth * (0.18 + eased * 0.9), 18, bookWidth);
  const revealOpacity = clamp((eased - 0.02) / 0.7, 0.22, 1);
  const paperColor = toSvgColor(options.toPage.material.paperColor);
  const edgeColor = toSvgColor(options.toPage.material.pageEdgeColor);

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <filter id="coverShadow" x="-20%" y="-20%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="22" />
      </filter>
      <linearGradient id="coverShade" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.14)" />
        <stop offset="50%" stop-color="rgba(0,0,0,0.05)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.24)" />
      </linearGradient>
      <linearGradient id="paperReveal" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${paperColor}" stop-opacity="0.92" />
        <stop offset="100%" stop-color="${edgeColor}" stop-opacity="0.2" />
      </linearGradient>
      <clipPath id="coverClip">
        <path d="${flapPath}" />
      </clipPath>
      <clipPath id="bookRevealClip">
        <rect x="${hingeX.toFixed(2)}" y="${bookY.toFixed(2)}" width="${revealWidth.toFixed(2)}" height="${bookHeight.toFixed(2)}" rx="2" />
      </clipPath>
    </defs>
    <image href="${options.fromImageUri}" x="0" y="0" width="${width}" height="${height}" opacity="${clamp(1 - eased * 0.95, 0.18, 1).toFixed(3)}" />
    <rect x="${hingeX.toFixed(2)}" y="${bookY.toFixed(2)}" width="${bookWidth.toFixed(2)}" height="${bookHeight.toFixed(2)}" fill="${paperColor}" opacity="${revealOpacity.toFixed(3)}" />
    ${buildPaperLineSet({
      x: hingeX,
      y: bookY,
      width: bookWidth,
      height: bookHeight,
      color: edgeColor,
      opacity: 0.08
    })}
    ${buildPaperFiberSet({
      x: hingeX,
      y: bookY,
      width: bookWidth,
      height: bookHeight,
      seed: options.seed + 11,
      color: edgeColor
    })}
    <image href="${options.toImageUri}" x="0" y="0" width="${width}" height="${height}" opacity="${revealOpacity.toFixed(3)}" clip-path="url(#bookRevealClip)" />
    <image href="${options.toImageUri}" x="0" y="0" width="${width}" height="${height}" clip-path="url(#bookRevealClip)" />
    <path d="${shadowPath}" fill="black" opacity="${clamp((options.transition.shadowStrength ?? options.toPage.material.pageCurlShadowOpacity) + Math.sin(theta) * 0.14, 0.24, 0.64).toFixed(3)}" filter="url(#coverShadow)" />
    <g clip-path="url(#coverClip)">
      <image href="${options.fromCoverImageUri}" x="${bookX.toFixed(2)}" y="${bookY.toFixed(2)}" width="${Math.max(26, visibleWidth + 20).toFixed(2)}" height="${bookHeight.toFixed(2)}" preserveAspectRatio="none" />
      <rect x="${bookX.toFixed(2)}" y="${bookY.toFixed(2)}" width="${Math.max(26, visibleWidth + 20).toFixed(2)}" height="${bookHeight.toFixed(2)}" fill="url(#coverShade)" />
    </g>
    <path d="${flapPath}" fill="none" stroke="${toSvgColor(options.toPage.material.coverEdgeColor)}" stroke-opacity="0.86" stroke-width="3" />
    <rect x="${(bookX + visibleWidth * 0.92).toFixed(2)}" y="${(bookY + 18).toFixed(2)}" width="${Math.max(4, 14 - eased * 10).toFixed(2)}" height="${(bookHeight - 36).toFixed(2)}" fill="url(#paperReveal)" opacity="${clamp(eased * 1.1, 0.22, 0.92).toFixed(3)}" />
  </svg>`;
}

export async function renderPhysicalBookTransition(options: {
  fromPath: string;
  toPath: string;
  fromPage: BookPage;
  toPage: BookPage;
  transition: BookPageTransition;
  outputPath: string;
  tempDir: string;
  width: number;
  height: number;
  fps: number;
  fromTimeSec: number;
  durationSec: number;
}) {
  const framesDir = path.join(options.tempDir, `${options.transition.id}-frames`);
  await mkdir(framesDir, {
    recursive: true
  });

  const frameCount = Math.max(
    18,
    Math.min(
      Math.round(options.durationSec * options.fps),
      options.transition.frameBudget ?? (options.transition.isChapterBoundary ? 42 : 34)
    )
  );

  await Promise.all([
    extractFrameSequence({
      inputPath: options.fromPath,
      startSec: options.fromTimeSec,
      durationSec: options.durationSec,
      fps: options.fps,
      width: options.width,
      height: options.height,
      frameCount,
      outputPattern: path.join(framesDir, "from-%04d.png")
    }),
    extractFrameSequence({
      inputPath: options.toPath,
      startSec: 0,
      durationSec: options.durationSec,
      fps: options.fps,
      width: options.width,
      height: options.height,
      frameCount,
      outputPattern: path.join(framesDir, "to-%04d.png")
    })
  ]);

  const [fromFrames, toFrames] = await Promise.all([
    loadFrameSequence({
      directory: framesDir,
      prefix: "from",
      frameCount,
      width: options.width,
      height: options.height,
      fallbackInputPath: options.fromPath,
      fallbackStartSec: options.fromTimeSec,
      fps: options.fps
    }),
    loadFrameSequence({
      directory: framesDir,
      prefix: "to",
      frameCount,
      width: options.width,
      height: options.height,
      fallbackInputPath: options.toPath,
      fallbackStartSec: 0,
      fps: options.fps
    })
  ]);

  const coverCrop = {
    left: Math.round(options.width * 0.22),
    top: Math.round(options.height * 0.12),
    width: Math.max(1, Math.round(options.width * 0.56)),
    height: Math.max(1, Math.round(options.height * 0.76))
  };
  const rightPageCrop = {
    left: Math.round(options.width * 0.48),
    top: Math.round(options.height * 0.08),
    width: Math.max(1, Math.round(options.width * 0.42)),
    height: Math.max(1, Math.round(options.height * 0.84))
  };

  const [fromCoverFrames, fromRightFrames] = await Promise.all([
    runWithConcurrency(
      fromFrames,
      PAGE_TURN_CROP_CONCURRENCY,
      async (buffer) =>
        sharp(buffer)
          .extract(coverCrop)
          .jpeg({
            quality: 92
          })
          .toBuffer()
    ),
    runWithConcurrency(
      fromFrames,
      PAGE_TURN_CROP_CONCURRENCY,
      async (buffer) =>
        sharp(buffer)
          .extract(rightPageCrop)
          .jpeg({
            quality: 92
          })
          .toBuffer()
    )
  ]);
  const seed = hashTextSeed(options.transition.id);

  await runWithConcurrency(
    Array.from({ length: frameCount }, (_, frameIndex) => frameIndex),
    PAGE_TURN_FRAME_CONCURRENCY,
    async (frameIndex) => {
    const progress = frameCount === 1 ? 1 : frameIndex / (frameCount - 1);
    const fromImageUri = encodeImageDataUri(fromFrames[frameIndex] ?? fromFrames[fromFrames.length - 1]!);
    const toImageUri = encodeImageDataUri(toFrames[frameIndex] ?? toFrames[toFrames.length - 1]!);
    const fromCoverImageUri = encodeImageDataUri(
      fromCoverFrames[frameIndex] ?? fromCoverFrames[fromCoverFrames.length - 1]!
    );
    const fromRightImageUri = encodeImageDataUri(
      fromRightFrames[frameIndex] ?? fromRightFrames[fromRightFrames.length - 1]!
    );

    const svg =
      options.transition.type === "book-open"
        ? buildBookOpenSvg({
            width: options.width,
            height: options.height,
            fromImageUri,
            fromCoverImageUri,
            toImageUri,
            progress,
            transition: options.transition,
            toPage: options.toPage,
            seed
          })
        : buildPageTurnSvg({
            width: options.width,
            height: options.height,
            fromImageUri,
            toImageUri,
            fromRightImageUri,
            transition: options.transition,
            toPage: options.toPage,
            progress,
            seed
          });

    await sharp(Buffer.from(svg))
      .jpeg({
        quality: 90,
        chromaSubsampling: "4:4:4"
      })
      .toFile(path.join(framesDir, `frame-${String(frameIndex).padStart(4, "0")}.jpg`));
    }
  );

  await runFfmpeg([
    "-y",
    "-framerate",
    `${Number((frameCount / Math.max(options.durationSec, 0.1)).toFixed(3))}`,
    "-i",
    path.join(framesDir, "frame-%04d.jpg"),
    "-vf",
    `scale=${options.width}:${options.height}:flags=lanczos,setsar=1,format=yuv420p`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    `${options.fps}`,
    "-movflags",
    "+faststart",
    options.outputPath
  ]);
}
