import {
  getCameraMotionDefinition,
  resolveFrameStyleForSeed
} from "@/lib/wall-frame/style-registry";
import { allocateWallSectionDurations } from "@/lib/wall-frame/timing";
import type {
  MemoryFrame,
  NormalizedBounds,
  WallFrameCameraPath,
  WallFrameSourceAsset,
  WallFrameStyleSettings,
  WallSection
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
    { bounds: { x: 0.07, y: 0.15, width: 0.45, height: 0.61 }, role: "hero" as const },
    { bounds: { x: 0.58, y: 0.25, width: 0.34, height: 0.48 }, role: "support" as const }
  ]),
  3: Object.freeze([
    { bounds: { x: 0.055, y: 0.17, width: 0.5, height: 0.62 }, role: "hero" as const },
    { bounds: { x: 0.615, y: 0.095, width: 0.32, height: 0.32 }, role: "support" as const },
    { bounds: { x: 0.615, y: 0.54, width: 0.32, height: 0.32 }, role: "support" as const }
  ]),
  4: Object.freeze([
    { bounds: { x: 0.055, y: 0.08, width: 0.405, height: 0.36 }, role: "hero" as const },
    { bounds: { x: 0.54, y: 0.08, width: 0.405, height: 0.36 }, role: "support" as const },
    { bounds: { x: 0.055, y: 0.54, width: 0.405, height: 0.36 }, role: "support" as const },
    { bounds: { x: 0.54, y: 0.54, width: 0.405, height: 0.36 }, role: "support" as const }
  ]),
  5: Object.freeze([
    { bounds: { x: 0.31, y: 0.21, width: 0.38, height: 0.56 }, role: "hero" as const },
    { bounds: { x: 0.025, y: 0.075, width: 0.235, height: 0.31 }, role: "support" as const },
    { bounds: { x: 0.025, y: 0.59, width: 0.235, height: 0.31 }, role: "support" as const },
    { bounds: { x: 0.74, y: 0.075, width: 0.235, height: 0.31 }, role: "support" as const },
    { bounds: { x: 0.74, y: 0.59, width: 0.235, height: 0.31 }, role: "support" as const }
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

function chooseHero(assets: readonly WallFrameSourceAsset[]) {
  return assets.reduce((best, asset) => {
    const score = Number.isFinite(asset.score) ? asset.score! : 0.5;
    const bestScore = Number.isFinite(best.score) ? best.score! : 0.5;
    return score > bestScore ? asset : best;
  }, assets[0]!);
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
  assets: WallFrameSourceAsset[];
  durationSec: number;
  settings: WallFrameStyleSettings;
}) {
  const template = LAYOUT_TEMPLATES[Math.min(5, Math.max(1, options.assets.length))]!;
  const hero = chooseHero(options.assets);
  const orderedForSlots = [hero, ...options.assets.filter((asset) => asset.id !== hero.id)];
  const sourceAudioAsset =
    orderedForSlots.find((asset) => asset.mediaType === "video" && asset.hasAudio) ?? undefined;

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
      bounds: { ...slot.bounds },
      zDepth: Number((slot.role === "hero" ? 0.84 : 0.42 + (seed % 20) / 100).toFixed(3)),
      frameStyle: resolveFrameStyleForSeed(options.settings.frameStyle, seed),
      caption: buildCaption(asset, options.settings, seed),
      startTimeSec: 0,
      durationSec: options.durationSec,
      trimStartSec,
      cropMode: chooseCropMode(asset, slot.bounds),
      role: slot.role,
      useSourceAudio: sourceAudioAsset?.id === asset.id
    } satisfies MemoryFrame;
  });
}

export function planWallFrameSections(options: {
  projectId: string;
  assets: WallFrameSourceAsset[];
  settings: WallFrameStyleSettings;
}) {
  const sortedAssets = sortWallFrameAssets(options.assets);
  const clusters = partitionBalanced(sortedAssets, 5);
  const durations = allocateWallSectionDurations({
    frameCounts: clusters.map((cluster) => cluster.length),
    videoCounts: clusters.map(
      (cluster) => cluster.filter((asset) => asset.mediaType === "video").length
    ),
    cameraMotion: options.settings.cameraMotion,
    durationTargetSec: options.settings.durationTargetSec
  });
  const motion = getCameraMotionDefinition(options.settings.cameraMotion);
  const projectSeed = hashWallFrameSeed(options.projectId);

  return clusters.map((cluster, sectionIndex) => {
    const durationSec = durations[sectionIndex] ?? motion.sectionDurationSec;
    const sectionSeed = hashWallFrameSeed(
      `${options.projectId}:${sectionIndex}:${cluster.map((asset) => asset.id).join(":")}`
    );
    const direction = (sectionIndex + projectSeed) % 2 === 0 ? "glide-left" : "glide-right";
    return {
      id: `wall_${sectionSeed.toString(36)}`,
      frames: createFrames({
        projectId: options.projectId,
        sectionIndex,
        assets: cluster,
        durationSec,
        settings: options.settings
      }),
      backgroundStyle: options.settings.wallStyle,
      durationSec,
      cameraPath: buildCameraPath(sectionIndex, options.settings, sectionSeed),
      transitionToNext:
        sectionIndex < clusters.length - 1
          ? {
              type: options.settings.cameraMotion === "slow-cinematic" ? "fade" : direction,
              durationSec: motion.transitionDurationSec
            }
          : undefined
    } satisfies WallSection;
  });
}

export function getSafeLayoutTemplate(frameCount: number) {
  return (LAYOUT_TEMPLATES[Math.min(5, Math.max(1, frameCount))] ?? LAYOUT_TEMPLATES[1]).map(
    (slot) => ({ bounds: { ...slot.bounds }, role: slot.role })
  );
}
