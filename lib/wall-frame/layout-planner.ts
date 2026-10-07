import {
  getCameraMotionDefinition,
  resolveFrameStyleForSeed
} from "@/lib/wall-frame/style-registry";
import { allocateWallSectionDurations } from "@/lib/wall-frame/timing";
import type {
  CameraTransform,
  MemoryFrame,
  MotionBeat,
  NormalizedBounds,
  WallFrameCoverageMetrics,
  WallFrameExcludedMedia,
  WallFrameMediaCoverage,
  WallFrameCameraPath,
  WallFrameSourceAsset,
  WallFrameStyleSettings,
  WallSection,
  WallSectionTransition
} from "@/lib/wall-frame/types";

interface LayoutSlot {
  bounds: NormalizedBounds;
  role: "hero" | "support";
}

const LAYOUT_TEMPLATES: Readonly<Record<number, readonly LayoutSlot[]>> = Object.freeze({
  1: Object.freeze([
    { bounds: { x: 0.2, y: 0.13, width: 0.6, height: 0.71 }, role: "hero" as const }
  ]),
  2: Object.freeze([
    { bounds: { x: 0.055, y: 0.15, width: 0.42, height: 0.61 }, role: "hero" as const },
    { bounds: { x: 0.525, y: 0.2, width: 0.42, height: 0.56 }, role: "hero" as const }
  ]),
  3: Object.freeze([
    { bounds: { x: 0.055, y: 0.17, width: 0.41, height: 0.58 }, role: "hero" as const },
    { bounds: { x: 0.535, y: 0.19, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.415, y: 0.795, width: 0.17, height: 0.15 }, role: "support" as const }
  ]),
  4: Object.freeze([
    { bounds: { x: 0.055, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.535, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.13, y: 0.78, width: 0.18, height: 0.16 }, role: "support" as const },
    { bounds: { x: 0.69, y: 0.78, width: 0.18, height: 0.16 }, role: "support" as const }
  ]),
  5: Object.freeze([
    { bounds: { x: 0.055, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.535, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.08, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const },
    { bounds: { x: 0.42, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const },
    { bounds: { x: 0.76, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const }
  ]),
  6: Object.freeze([
    { bounds: { x: 0.055, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.535, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.055, y: 0.025, width: 0.17, height: 0.105 }, role: "support" as const },
    { bounds: { x: 0.285, y: 0.025, width: 0.17, height: 0.105 }, role: "support" as const },
    { bounds: { x: 0.575, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const },
    { bounds: { x: 0.79, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const }
  ]),
  7: Object.freeze([
    { bounds: { x: 0.055, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.535, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.055, y: 0.025, width: 0.17, height: 0.105 }, role: "support" as const },
    { bounds: { x: 0.285, y: 0.025, width: 0.17, height: 0.105 }, role: "support" as const },
    { bounds: { x: 0.575, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const },
    { bounds: { x: 0.79, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const },
    { bounds: { x: 0.36, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const }
  ]),
  8: Object.freeze([
    { bounds: { x: 0.055, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.535, y: 0.17, width: 0.41, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.055, y: 0.025, width: 0.17, height: 0.105 }, role: "support" as const },
    { bounds: { x: 0.285, y: 0.025, width: 0.17, height: 0.105 }, role: "support" as const },
    { bounds: { x: 0.575, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const },
    { bounds: { x: 0.79, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const },
    { bounds: { x: 0.36, y: 0.79, width: 0.16, height: 0.14 }, role: "support" as const },
    { bounds: { x: 0.52, y: 0.025, width: 0.17, height: 0.105 }, role: "support" as const }
  ])
});

export function hashWallFrameSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableAssetOrder(asset: WallFrameSourceAsset, index: number) {
  const timestamp = asset.capturedAt ? Date.parse(asset.capturedAt) : Number.NaN;
  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
    uploadOrder: Number.isFinite(asset.uploadOrder) ? asset.uploadOrder! : index,
    id: asset.id
  };
}

export function sortWallFrameAssets(assets: readonly WallFrameSourceAsset[]) {
  return assets
    .map((asset, index) => ({ asset, order: stableAssetOrder(asset, index) }))
    .sort(
      (a, b) =>
        a.order.timestamp - b.order.timestamp ||
        a.order.uploadOrder - b.order.uploadOrder ||
        a.order.id.localeCompare(b.order.id)
    )
    .map(({ asset }) => asset);
}

function partitionBalanced<T>(items: readonly T[], maximumSize = 5) {
  const sectionCount = Math.max(1, Math.ceil(items.length / Math.max(1, maximumSize)));
  const minimumSize = Math.floor(items.length / sectionCount);
  let remainder = items.length % sectionCount;
  const result: T[][] = [];
  let cursor = 0;

  for (let index = 0; index < sectionCount; index += 1) {
    const size = minimumSize + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    result.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return result;
}

function round(value: number, places = 4) {
  return Number(value.toFixed(places));
}

function cameraTransform(options: Partial<CameraTransform> = {}): CameraTransform {
  return {
    x: round(options.x ?? 0.5),
    y: round(options.y ?? 0.5),
    scale: round(options.scale ?? 1.02),
    rotation: round(options.rotation ?? 0),
    perspective: round(options.perspective ?? 0.08),
    blur: round(options.blur ?? 0),
    depth: round(options.depth ?? 0.25)
  };
}

function heroCameraTransform(frame: MemoryFrame, scaleBoost = 1) {
  const focusX = frame.bounds.x + frame.bounds.width / 2;
  const focusY = frame.bounds.y + frame.bounds.height / 2;
  const fitScale = Math.min(3.25, Math.max(1.35, 0.92 / Math.max(frame.bounds.width, frame.bounds.height, 0.28)));
  return cameraTransform({
    x: focusX,
    y: focusY,
    scale: fitScale * scaleBoost,
    perspective: 0.22,
    depth: 0.86
  });
}

function transitionBeatType(transition?: WallSectionTransition): MotionBeat["type"] {
  if (!transition) return "cluster-reveal";
  if (transition.type.startsWith("frame-flip")) return "frame-flip";
  if (transition.type.startsWith("whip")) return "whip-pan";
  if (transition.type === "zoom-through") return "zoom-through-frame";
  return "slide-panel";
}

export function buildSectionMotionBeats(options: {
  sectionId: string;
  frames: MemoryFrame[];
  durationSec: number;
  cameraPath: WallFrameCameraPath;
  transitionToNext?: WallSectionTransition;
  sectionIndex: number;
  sectionCount: number;
  settings: WallFrameStyleSettings;
}): MotionBeat[] {
  const heroes = options.frames.filter((frame) => frame.role === "hero");
  const hero = heroes[0] ?? options.frames[0];
  if (!hero) return [];
  const allFrameIds = options.frames.map((frame) => frame.id);
  const duration = Math.max(0.6, options.durationSec);
  const highEnergy = options.settings.transitionEnergy === "high";
  const first = options.sectionIndex === 0;
  const last = options.sectionIndex === options.sectionCount - 1;
  const wideStart = cameraTransform({
    x: options.cameraPath.start.x,
    y: options.cameraPath.start.y,
    scale: first ? 0.99 : options.cameraPath.start.zoom,
    perspective: 0.08,
    depth: 0.18
  });
  const glideEnd = cameraTransform({
    x: options.cameraPath.end.x,
    y: options.cameraPath.end.y,
    scale: highEnergy ? 1.14 : 1.09,
    perspective: 0.14,
    depth: 0.38
  });
  const heroFocus = heroCameraTransform(hero);
  const heroHold = heroCameraTransform(hero, hero.mediaType === "image" ? 1.045 : 1.018);
  const secondHero = heroes[1];
  const secondHeroFocus = secondHero ? heroCameraTransform(secondHero) : undefined;
  const secondHeroHold = secondHero
    ? heroCameraTransform(secondHero, secondHero.mediaType === "image" ? 1.045 : 1.018)
    : undefined;
  const promotionFrame = options.frames.find(
    (frame) => frame.role === "support" && frame.promotionTargetSceneIndex === options.sectionIndex + 1
  );
  const exitType = last
    ? "final-wall-reveal"
    : promotionFrame &&
        !options.transitionToNext?.type.startsWith("frame-flip") &&
        options.sectionIndex % 3 === 0
      ? "zoom-through-frame"
      : transitionBeatType(options.transitionToNext);
  const exitDirection = options.transitionToNext?.type.includes("right") ? "right" : "left";
  const exitStart = secondHeroHold ?? heroHold;
  const exitEnd = last
    ? cameraTransform({ x: 0.5, y: 0.5, scale: 0.99, perspective: 0.06, depth: 0.12 })
    : exitType === "zoom-through-frame"
      ? cameraTransform({
          ...(promotionFrame ? heroCameraTransform(promotionFrame, 1.18) : exitStart),
          scale: Math.min(
            3.7,
            (promotionFrame ? heroCameraTransform(promotionFrame, 1.18).scale : exitStart.scale) * 1.12
          ),
          blur: 0.55
        })
      : cameraTransform({
          x: exitDirection === "right" ? 0.88 : 0.12,
          y: 0.5,
          scale: exitType === "frame-flip" ? 1.22 : 1.06,
          rotation: exitType === "frame-flip" ? (exitDirection === "right" ? 2.2 : -2.2) : 0,
          perspective: exitType === "frame-flip" ? 0.82 : 0.28,
          blur: exitType === "whip-pan" ? 0.72 : 0.22,
          depth: 0.52
        });
  const specs: Array<{
    type: MotionBeat["type"];
    start: CameraTransform;
    end: CameraTransform;
    ids: string[];
    easing: MotionBeat["easing"];
    playback: MotionBeat["mediaPlaybackBehavior"];
  }> = [
    {
      type: first ? "wall-reveal" : "camera-glide",
      start: wideStart,
      end: glideEnd,
      ids: allFrameIds,
      easing: "ease-in-out",
      playback: "ambient-loop"
    },
    {
      type: "multi-frame-pass-by",
      start: glideEnd,
      end: cameraTransform({
        ...glideEnd,
        x: exitDirection === "right" ? 0.74 : 0.26,
        y: heroFocus.y,
        scale: 1.16
      }),
      ids: allFrameIds,
      easing: highEnergy ? "ease-out-expo" : "ease-out-quart",
      playback: "ambient-loop"
    },
    {
      type: "whip-pan",
      start: cameraTransform({
        ...glideEnd,
        x: exitDirection === "right" ? 0.74 : 0.26,
        y: heroFocus.y,
        scale: 1.16
      }),
      end: cameraTransform({ ...glideEnd, x: heroFocus.x, y: heroFocus.y, scale: 1.22 }),
      ids: allFrameIds,
      easing: "ease-out-expo",
      playback: "ambient-loop"
    },
    {
      type: "hero-push-in",
      start: cameraTransform({ ...glideEnd, x: heroFocus.x, y: heroFocus.y, scale: 1.22 }),
      end: heroFocus,
      ids: [hero.id],
      easing: "ease-out-quart",
      playback: hero.mediaType === "video" ? "hero-play" : "photo-parallax"
    },
    {
      type: "hero-focus-hold",
      start: heroFocus,
      end: heroHold,
      ids: [hero.id],
      easing: "ease-in-out",
      playback: hero.mediaType === "video" ? "hero-play" : "photo-parallax"
    },
    {
      type: exitType,
      start: exitStart,
      end: exitEnd,
      ids: last ? allFrameIds : [promotionFrame?.id ?? secondHero?.id ?? hero.id],
      easing: last ? "ease-in-out" : "ease-out-expo",
      playback: last ? "hold" : "ambient-loop"
    }
  ];
  if (secondHero && secondHeroFocus && secondHeroHold) {
    // A supporting memory from a previous section can now occupy the second
    // hero slot. Pull back just enough to preserve spatial context, glide to
    // its fixed wall position, then give it its own full hero hold.
    specs.splice(specs.length - 1, 0,
      {
        type: "snap-zoom-out",
        start: heroHold,
        end: cameraTransform({ x: 0.5, y: 0.5, scale: 1.24, perspective: 0.18, depth: 0.42 }),
        ids: allFrameIds,
        easing: "ease-out-quart",
        playback: "ambient-loop"
      },
      {
        type: "camera-glide",
        start: cameraTransform({ x: 0.5, y: 0.5, scale: 1.24, perspective: 0.18, depth: 0.42 }),
        end: cameraTransform({ ...secondHeroFocus, scale: 1.3 }),
        ids: allFrameIds,
        easing: "ease-in-out",
        playback: "ambient-loop"
      },
      {
        type: "hero-push-in",
        start: cameraTransform({ ...secondHeroFocus, scale: 1.3 }),
        end: secondHeroFocus,
        ids: [secondHero.id],
        easing: "ease-out-quart",
        playback: secondHero.mediaType === "video" ? "hero-play" : "photo-parallax"
      },
      {
        type: "hero-focus-hold",
        start: secondHeroFocus,
        end: secondHeroHold,
        ids: [secondHero.id],
        easing: "ease-in-out",
        playback: secondHero.mediaType === "video" ? "hero-play" : "photo-parallax"
      }
    );
  }
  if (last) {
    const pullBack = cameraTransform({
      x: 0.5,
      y: 0.5,
      scale: 1.12,
      perspective: 0.14,
      blur: options.sectionCount === 1 ? 0.48 : 0.32,
      depth: 0.24
    });
    specs[specs.length - 1] = {
      type: options.sectionCount === 1 ? "frame-flip" : "snap-zoom-out",
      start: exitStart,
      end: pullBack,
      ids: [secondHero?.id ?? hero.id],
      easing: "ease-out-expo",
      playback: "ambient-loop"
    };
    specs.push({
      type: "final-wall-reveal",
      start: pullBack,
      end: exitEnd,
      ids: allFrameIds,
      easing: "ease-in-out",
      playback: "hold"
    });
  }
  const weights = specs.map((spec) =>
    spec.type === "hero-focus-hold"
      ? 1.45
      : spec.type === "hero-push-in"
        ? 1.05
        : spec.type === "wall-reveal" || spec.type === "final-wall-reveal"
          ? 1.1
          : spec.type === "whip-pan"
            ? 0.55
            : 0.78
  );
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const marks = [0];
  for (let index = 0; index < weights.length; index += 1) {
    marks.push(round(marks[index]! + (weights[index]! / weightTotal) * duration, 3));
  }
  return specs.map((spec, index) => ({
    id: `${options.sectionId}_beat_${String(index + 1).padStart(2, "0")}`,
    type: spec.type,
    startTimeSec: marks[index]!,
    durationSec: round(Math.max(1 / 30, marks[index + 1]! - marks[index]!), 3),
    activeFrameIds: spec.ids,
    cameraTransformStart: spec.start,
    cameraTransformEnd: spec.end,
    easing: spec.easing,
    mediaPlaybackBehavior: spec.playback,
    transitionParams:
      index === specs.length - 1
        ? {
            direction: exitDirection,
            motionBlurAmount: exitEnd.blur,
            flipAxis: options.transitionToNext?.type.endsWith("x") ? "x" : "y",
            shadowIntensity: exitType === "frame-flip" ? 0.78 : 0.32,
            zoomAmount: exitEnd.scale,
            revealTarget: last ? "cluster" : "next-section"
          }
        : undefined
  }));
}

function chooseTransition(options: {
  sectionIndex: number;
  settings: WallFrameStyleSettings;
  durationSec: number;
}): WallSectionTransition {
  const gentle = ["frame-flip-y", "glide-left", "slide-up", "glide-right"] as const;
  const balanced = [
    "frame-flip-y",
    "whip-left",
    "slide-up",
    "zoom-through",
    "whip-right",
    "frame-flip-x"
  ] as const;
  const high = [
    "frame-flip-y",
    "whip-left",
    "zoom-through",
    "slide-down",
    "frame-flip-x",
    "whip-right"
  ] as const;
  const sequence =
    options.settings.transitionEnergy === "gentle"
      ? gentle
      : options.settings.transitionEnergy === "high"
        ? high
        : balanced;
  return {
    type: sequence[options.sectionIndex % sequence.length]!,
    durationSec: round(options.durationSec, 3)
  };
}

function formatSimpleDate(value?: string) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return undefined;
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function cleanCaption(value?: string) {
  return value?.replace(/\s+/g, " ").trim().slice(0, 76) || undefined;
}

function buildCaption(
  asset: WallFrameSourceAsset,
  settings: WallFrameStyleSettings,
  seed: number
) {
  if (settings.captionStyle === "none") {
    return undefined;
  }
  if (settings.captionStyle === "simple-dates") {
    return formatSimpleDate(asset.capturedAt);
  }
  const supplied = cleanCaption(asset.caption);
  if (settings.captionStyle === "memory-captions") {
    return supplied ?? formatSimpleDate(asset.capturedAt) ?? "A moment worth keeping";
  }
  if (supplied) {
    return supplied;
  }
  const notes = [
    "one for the memory wall",
    "the little moments mattered",
    "some days stay with you",
    "proof we were here"
  ];
  return notes[seed % notes.length];
}

function chooseCropMode(asset: WallFrameSourceAsset, bounds: NormalizedBounds) {
  if (!asset.width || !asset.height) {
    return "cover" as const;
  }
  const mediaRatio = asset.width / asset.height;
  const slotRatio = bounds.width / bounds.height;
  const mismatch = Math.max(mediaRatio / slotRatio, slotRatio / mediaRatio);
  return mismatch > 2.05 ? ("contain" as const) : ("cover" as const);
}

function chooseFrameShape(
  asset: WallFrameSourceAsset,
  role: MemoryFrame["role"],
  settings: WallFrameStyleSettings,
  seed: number
): MemoryFrame["frameShape"] {
  const mediaRatio = asset.width && asset.height ? asset.width / asset.height : 1.5;
  if (settings.frameVariety === "low") {
    return mediaRatio < 0.88 ? "portrait-rectangle" : "landscape-rectangle";
  }
  if (role === "hero") {
    if (mediaRatio < 0.82) {
      return seed % 3 === 0 ? "oval" : "tall-portrait";
    }
    if (mediaRatio > 2.05) {
      return "panoramic";
    }
    return seed % 4 === 0 ? "rounded-rectangle" : "landscape-rectangle";
  }
  const mediumShapes: MemoryFrame["frameShape"][] = [
    "square",
    "rounded-rectangle",
    "portrait-rectangle",
    "landscape-rectangle",
    "oval"
  ];
  const highShapes: MemoryFrame["frameShape"][] = [
    ...mediumShapes,
    "circle",
    "arch-top",
    "octagonal",
    "panoramic"
  ];
  const choices = settings.frameVariety === "high" ? highShapes : mediumShapes;
  return choices[Math.abs(seed) % choices.length]!;
}

export function buildCameraPath(
  sectionIndex: number,
  settings: WallFrameStyleSettings,
  seed: number
): WallFrameCameraPath {
  const motion = getCameraMotionDefinition(settings.cameraMotion);
  const direction = (sectionIndex + seed) % 2 === 0 ? 1 : -1;
  const verticalDirection = (Math.floor(seed / 7) + sectionIndex) % 2 === 0 ? 1 : -1;
  const startX = 0.5 - (direction * motion.travel) / 2;
  const endX = 0.5 + (direction * motion.travel) / 2;
  const verticalTravel = motion.travel * 0.22;
  const startZoom = motion.zoomRange[(sectionIndex + seed) % 2] ?? motion.zoomRange[0];
  const endZoom = motion.zoomRange[(sectionIndex + seed + 1) % 2] ?? motion.zoomRange[1];
  return {
    start: {
      x: Number(startX.toFixed(4)),
      y: Number((0.5 - (verticalDirection * verticalTravel) / 2).toFixed(4)),
      zoom: startZoom
    },
    end: {
      x: Number(endX.toFixed(4)),
      y: Number((0.5 + (verticalDirection * verticalTravel) / 2).toFixed(4)),
      zoom: endZoom
    },
    easing: settings.cameraMotion === "energetic" ? "linear" : "ease-in-out"
  };
}

function createFrames(options: {
  projectId: string;
  sectionIndex: number;
  heroAssets: WallFrameSourceAsset[];
  promotionAssetIds?: Set<string>;
  assets: WallFrameSourceAsset[];
  durationSec: number;
  settings: WallFrameStyleSettings;
}) {
  const template = LAYOUT_TEMPLATES[Math.min(8, Math.max(1, options.assets.length))]!;
  const heroIds = new Set(options.heroAssets.map((asset) => asset.id));
  const orderedForSlots = [
    ...options.heroAssets,
    ...options.assets.filter((asset) => !heroIds.has(asset.id))
  ];

  return template.slice(0, orderedForSlots.length).map((slot, frameIndex) => {
    const asset = orderedForSlots[frameIndex]!;
    const seed = hashWallFrameSeed(
      `${options.projectId}:${options.sectionIndex}:${frameIndex}:${asset.id}`
    );
    const sourceDurationSec =
      asset.mediaType === "video" && Number.isFinite(asset.durationSec)
        ? Math.max(0.1, asset.durationSec!)
        : undefined;
    const requestedTrimStart = Math.max(0, asset.trimStartSec ?? 0);
    const trimStartSec = sourceDurationSec
      ? Math.min(requestedTrimStart, Math.max(0, sourceDurationSec - 0.1))
      : requestedTrimStart;

    return {
      id: `wf_${seed.toString(36)}`,
      mediaAssetId: asset.id,
      clipId: asset.clipId,
      mediaType: asset.mediaType,
      sourcePath: asset.sourcePath,
      audioSourcePath: asset.audioSourcePath ?? asset.sourcePath,
      sourceDurationSec,
      bounds: {
        ...slot.bounds,
        x: options.sectionIndex % 2 === 1
          ? round(1 - slot.bounds.x - slot.bounds.width)
          : slot.bounds.x,
        y: options.sectionIndex % 4 >= 2
          ? round(1 - slot.bounds.y - slot.bounds.height)
          : slot.bounds.y
      },
      zDepth: Number((slot.role === "hero" ? 0.84 : 0.42 + (seed % 20) / 100).toFixed(3)),
      frameStyle: resolveFrameStyleForSeed(
        options.settings.frameStyle,
        hashWallFrameSeed(`${options.projectId}:${options.sectionIndex}:materials`) + frameIndex,
        options.settings.frameVariety
      ),
      frameShape: chooseFrameShape(asset, slot.role, options.settings, seed),
      caption: buildCaption(asset, options.settings, seed),
      startTimeSec: 0,
      durationSec: options.durationSec,
      trimStartSec,
      cropMode: chooseCropMode(asset, slot.bounds),
      role: slot.role,
      promotionTargetSceneIndex:
        slot.role === "support" && options.promotionAssetIds?.has(asset.id)
          ? options.sectionIndex + 1
          : undefined,
      useSourceAudio: slot.role === "hero" && asset.mediaType === "video" && Boolean(asset.hasAudio)
    } satisfies MemoryFrame;
  });
}

function editorialValue(asset: WallFrameSourceAsset) {
  return Math.max(
    0,
    Math.min(
      1,
      asset.editorialScore ?? asset.importanceScore ?? asset.score ?? 0.5
    )
  );
}

export function calculateWallFrameHeroPriority(options: {
  asset: WallFrameSourceAsset;
  heroAppearanceCount: number;
  sceneRelevance?: number;
  transitionCompatibility?: number;
}) {
  const neverShownAsHero =
    options.heroAppearanceCount === 0 ? 1 : options.heroAppearanceCount === 1 ? 0.15 : 0;
  const importance = Math.max(0, Math.min(1, options.asset.importanceScore ?? editorialValue(options.asset)));
  const editorial = Math.max(0, Math.min(1, options.asset.editorialScore ?? editorialValue(options.asset)));
  const quality = Math.max(0, Math.min(1, options.asset.score ?? editorial));
  const sceneRelevance = Math.max(0, Math.min(1, options.sceneRelevance ?? editorial));
  const transitionCompatibility = Math.max(
    0,
    Math.min(1, options.transitionCompatibility ?? 0.65)
  );
  return round(
    0.4 * neverShownAsHero +
      0.25 * Math.max(importance, editorial) +
      0.15 * sceneRelevance +
      0.1 * quality +
      0.1 * transitionCompatibility,
    4
  );
}

function targetDurationForGallery(
  assetCount: number,
  outputRole: "master" | "cluster",
  requested?: number
) {
  if (Number.isFinite(requested) && requested! > 0) {
    return outputRole === "master"
      ? Math.max(120, Math.min(300, requested!))
      : Math.max(30, Math.min(90, requested!));
  }
  return outputRole === "master"
    ? Math.max(120, Math.min(300, 24 + assetCount * 4.5))
    : Math.max(30, Math.min(90, 10 + assetCount * 4.2));
}

function selectForHeroCapacity(
  assets: WallFrameSourceAsset[],
  targetDurationSec: number,
  outputRole: "master" | "cluster"
) {
  const secondsPerHero = outputRole === "master" ? 3.35 : 3.15;
  const estimatedHeroCapacity = Math.max(
    outputRole === "master" ? 12 : 6,
    Math.floor((targetDurationSec - (outputRole === "master" ? 8 : 5)) / secondsPerHero)
  );
  if (assets.length <= estimatedHeroCapacity) {
    return { selected: assets, excluded: [] as WallFrameExcludedMedia[], estimatedHeroCapacity };
  }
  const order = new Map(assets.map((asset, index) => [asset.id, index]));
  const selectedIds = new Set(
    [...assets]
      .sort((a, b) => {
        const aPriority = calculateWallFrameHeroPriority({
          asset: a,
          heroAppearanceCount: 0,
          transitionCompatibility: a.mediaType === "video" ? 0.8 : 0.65
        });
        const bPriority = calculateWallFrameHeroPriority({
          asset: b,
          heroAppearanceCount: 0,
          transitionCompatibility: b.mediaType === "video" ? 0.8 : 0.65
        });
        return bPriority - aPriority || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
      })
      .slice(0, estimatedHeroCapacity)
      .map((asset) => asset.id)
  );
  return {
    selected: assets.filter((asset) => selectedIds.has(asset.id)),
    excluded: assets
      .filter((asset) => !selectedIds.has(asset.id))
      .map((asset) => ({
        mediaAssetId: asset.id,
        reason: "duration-capacity" as const,
        detail: `Excluded before Wall Frame selection because the ${targetDurationSec.toFixed(0)} second ${outputRole} has capacity for approximately ${estimatedHeroCapacity} hero memories.`
      })),
    estimatedHeroCapacity
  };
}

function chooseSupportingAssets(
  selected: WallFrameSourceAsset[],
  heroStart: number,
  heroAssets: WallFrameSourceAsset[],
  maximum: number
) {
  const heroIds = new Set(heroAssets.map((asset) => asset.id));
  const upcoming = selected.slice(heroStart + heroAssets.length);
  const completed = selected.slice(0, heroStart).reverse();
  const sameCluster = selected.filter(
    (asset) =>
      !heroIds.has(asset.id) &&
      heroAssets.some((hero) => hero.clusterId && hero.clusterId === asset.clusterId)
  );
  const candidates = [...upcoming, ...sameCluster, ...completed];
  const seen = new Set<string>();
  return candidates.filter((asset) => {
    if (heroIds.has(asset.id) || seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  }).slice(0, maximum);
}

export interface PlannedWallFrameGallery {
  wallSections: WallSection[];
  selectedAssets: WallFrameSourceAsset[];
  excludedMedia: WallFrameExcludedMedia[];
  mediaCoverage: WallFrameMediaCoverage[];
  coverageMetrics: WallFrameCoverageMetrics;
  targetDurationSec: number;
}

export function planWallFrameGallery(options: {
  projectId: string;
  assets: WallFrameSourceAsset[];
  settings: WallFrameStyleSettings;
  outputRole?: "master" | "cluster";
  clusterVideoCount?: number;
}): PlannedWallFrameGallery {
  const outputRole = options.outputRole ?? "master";
  // The timeline already contains the professional editorial order (hook,
  // contextual setup, progression, payoff). Preserve it instead of sorting
  // back to upload order here.
  const editorialOrder = [...options.assets];
  const targetDurationSec = targetDurationForGallery(
    editorialOrder.length,
    outputRole,
    options.settings.durationTargetSec
  );
  const capacity = selectForHeroCapacity(editorialOrder, targetDurationSec, outputRole);
  const selected = capacity.selected;
  const heroGroups = partitionBalanced(selected, 2);
  const durations = allocateWallSectionDurations({
    frameCounts: heroGroups.map((heroes) => Math.min(8, heroes.length + 6)),
    heroCounts: heroGroups.map((heroes) => heroes.length),
    videoCounts: heroGroups.map(
      (heroes) => heroes.filter((asset) => asset.mediaType === "video").length
    ),
    cameraMotion: options.settings.cameraMotion,
    durationTargetSec: targetDurationSec
  });
  const motion = getCameraMotionDefinition(options.settings.cameraMotion);
  if (durations.length) {
    const overlapTotal = Math.max(0, durations.length - 1) * motion.transitionDurationSec;
    const plannedDuration = durations.reduce((sum, value) => sum + value, 0) - overlapTotal;
    durations[durations.length - 1] = round(
      Math.max(
        motion.minSectionDurationSec,
        durations[durations.length - 1]! + (targetDurationSec - plannedDuration)
      ),
      3
    );
  }
  const coverage = new Map<string, WallFrameMediaCoverage>(
    selected.map((asset) => [
      asset.id,
      {
        mediaAssetId: asset.id,
        selectedForMaster: outputRole === "master",
        heroAppearanceCount: 0,
        supportingAppearanceCount: 0,
        hasBeenHero: false,
        coveragePriority: calculateWallFrameHeroPriority({
          asset,
          heroAppearanceCount: 0
        }),
        importanceScore: asset.importanceScore ?? asset.score ?? 0.5,
        editorialScore: asset.editorialScore ?? asset.score ?? 0.5,
        clusterId: asset.clusterId
      }
    ])
  );
  let heroCursor = 0;
  const wallSections = heroGroups.map((heroes, sectionIndex) => {
    const supports = chooseSupportingAssets(selected, heroCursor, heroes, 8 - heroes.length);
    const sectionAssets = [...heroes, ...supports];
    const durationSec = durations[sectionIndex] ?? motion.sectionDurationSec;
    const sectionSeed = hashWallFrameSeed(
      `${options.projectId}:${outputRole}:${sectionIndex}:${sectionAssets.map((asset) => asset.id).join(":")}`
    );
    const transitionToNext =
      sectionIndex < heroGroups.length - 1
        ? chooseTransition({
            sectionIndex,
            settings: options.settings,
            durationSec: motion.transitionDurationSec
          })
        : undefined;
    const cameraPath = buildCameraPath(sectionIndex, options.settings, sectionSeed);
    const frames = createFrames({
      projectId: options.projectId,
      sectionIndex,
      heroAssets: heroes,
      promotionAssetIds: new Set((heroGroups[sectionIndex + 1] ?? []).map((asset) => asset.id)),
      assets: sectionAssets,
      durationSec,
      settings: options.settings
    });
    const sectionId = `wall_${sectionSeed.toString(36)}`;
    heroes.forEach((asset) => {
      const entry = coverage.get(asset.id)!;
      entry.heroAppearanceCount += 1;
      entry.hasBeenHero = true;
      entry.firstHeroSceneIndex ??= sectionIndex;
      entry.lastHeroSceneIndex = sectionIndex;
      entry.coveragePriority = calculateWallFrameHeroPriority({
        asset,
        heroAppearanceCount: entry.heroAppearanceCount
      });
    });
    supports.forEach((asset) => {
      const entry = coverage.get(asset.id)!;
      entry.supportingAppearanceCount += 1;
      entry.lastSupportingSceneIndex = sectionIndex;
    });
    heroCursor += heroes.length;
    return {
      id: sectionId,
      frames,
      backgroundStyle: options.settings.wallStyle,
      durationSec,
      cameraPath,
      motionBeats: buildSectionMotionBeats({
        sectionId,
        frames,
        durationSec,
        cameraPath,
        transitionToNext,
        sectionIndex,
        sectionCount: heroGroups.length,
        settings: options.settings
      }),
      transitionToNext
    } satisfies WallSection;
  });
  const mediaCoverage = [...coverage.values()];
  const heroCoveredMediaCount = mediaCoverage.filter((item) => item.hasBeenHero).length;
  const heroCounts = mediaCoverage.map((item) => item.heroAppearanceCount);
  const allFrames = wallSections.flatMap((section) => section.frames);
  const appearanceCounts = new Map<string, number>();
  allFrames.forEach((frame) => appearanceCounts.set(frame.mediaAssetId, (appearanceCounts.get(frame.mediaAssetId) ?? 0) + 1));
  const coverageMetrics: WallFrameCoverageMetrics = {
    selectedMediaCount: selected.length,
    heroCoveredMediaCount,
    heroCoverageRatio: selected.length ? heroCoveredMediaCount / selected.length : 0,
    averageHeroAppearances: selected.length
      ? heroCounts.reduce((sum, count) => sum + count, 0) / selected.length
      : 0,
    maxHeroAppearancesForSingleAsset: Math.max(0, ...heroCounts),
    uniqueFrameStylesUsed: new Set(allFrames.map((frame) => frame.frameStyle)).size,
    uniqueFrameShapesUsed: new Set(allFrames.map((frame) => frame.frameShape)).size,
    wallSectionCount: wallSections.length,
    clusterVideoCount:
      outputRole === "cluster" ? 1 : Math.max(0, options.clusterVideoCount ?? 0),
    duplicateUsageCount: [...appearanceCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    estimatedHeroCapacity: capacity.estimatedHeroCapacity
  };
  return {
    wallSections,
    selectedAssets: selected,
    excludedMedia: capacity.excluded,
    mediaCoverage,
    coverageMetrics,
    targetDurationSec
  };
}

export function planWallFrameSections(options: {
  projectId: string;
  assets: WallFrameSourceAsset[];
  settings: WallFrameStyleSettings;
  outputRole?: "master" | "cluster";
  clusterVideoCount?: number;
}) {
  return planWallFrameGallery(options).wallSections;
}

export function getSafeLayoutTemplate(frameCount: number) {
  return (LAYOUT_TEMPLATES[Math.min(8, Math.max(1, frameCount))] ?? LAYOUT_TEMPLATES[1]).map(
    (slot) => ({ bounds: { ...slot.bounds }, role: slot.role })
  );
}
