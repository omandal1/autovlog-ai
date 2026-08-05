import type {
  WallFrameCameraMotion,
  WallFrameStyle,
  WallFrameStyleSettings,
  WallStyle
} from "@/lib/wall-frame/types";

export interface FrameStyleDefinition {
  id: Exclude<WallFrameStyle, "mixed-scrapbook">;
  label: string;
  outerColor: string;
  innerMatColor: string;
  edgeColor: string;
  captionColor: string;
  captionTextColor: string;
  borderRatio: number;
  shadowOpacity: number;
  shadowOffsetRatio: number;
}

export interface WallStyleDefinition {
  id: WallStyle;
  label: string;
  baseColor: string;
  accentColor: string;
  texture: "paint" | "plaster" | "gallery" | "cork";
  textureOpacity: number;
}

export interface CameraMotionDefinition {
  id: WallFrameCameraMotion;
  sectionDurationSec: number;
  minSectionDurationSec: number;
  maxSectionDurationSec: number;
  transitionDurationSec: number;
  zoomRange: readonly [number, number];
  travel: number;
}

export const DEFAULT_WALL_FRAME_SETTINGS: WallFrameStyleSettings = Object.freeze({
  frameStyle: "mixed-scrapbook",
  wallStyle: "warm-bedroom-wall",
  cameraMotion: "balanced",
  captionStyle: "memory-captions",
  aspectRatio: "landscape-16x9"
});

const FRAME_STYLES: Readonly<Record<FrameStyleDefinition["id"], FrameStyleDefinition>> =
  Object.freeze({
    "classic-wood": Object.freeze({
      id: "classic-wood",
      label: "Classic wood",
      outerColor: "0x6B432B",
      innerMatColor: "0xF0E4CF",
      edgeColor: "0x3D2418",
      captionColor: "0xE9D5B8",
      captionTextColor: "0x33231A",
      borderRatio: 0.065,
      shadowOpacity: 0.3,
      shadowOffsetRatio: 0.035
    }),
    "modern-black": Object.freeze({
      id: "modern-black",
      label: "Modern black",
      outerColor: "0x17191D",
      innerMatColor: "0xE9E9E6",
      edgeColor: "0x050506",
      captionColor: "0x25272B",
      captionTextColor: "0xF3F3F0",
      borderRatio: 0.046,
      shadowOpacity: 0.38,
      shadowOffsetRatio: 0.03
    }),
    "white-gallery": Object.freeze({
      id: "white-gallery",
      label: "White gallery",
      outerColor: "0xF7F5EF",
      innerMatColor: "0xFEFDF9",
      edgeColor: "0xC7C4BC",
      captionColor: "0xF7F5EF",
      captionTextColor: "0x252525",
      borderRatio: 0.058,
      shadowOpacity: 0.22,
      shadowOffsetRatio: 0.028
    })
  });

const WALL_STYLES: Readonly<Record<WallStyle, WallStyleDefinition>> = Object.freeze({
  "warm-bedroom-wall": Object.freeze({
    id: "warm-bedroom-wall",
    label: "Warm bedroom wall",
    baseColor: "0xC99F78",
    accentColor: "0xE0C4A7",
    texture: "plaster",
    textureOpacity: 0.11
  }),
  "dorm-room-wall": Object.freeze({
    id: "dorm-room-wall",
    label: "Dorm room wall",
    baseColor: "0xADB1A7",
    accentColor: "0xD9D6C9",
    texture: "paint",
    textureOpacity: 0.08
  }),
  "clean-gallery-wall": Object.freeze({
    id: "clean-gallery-wall",
    label: "Clean gallery wall",
    baseColor: "0xE9E7E1",
    accentColor: "0xC9C7C1",
    texture: "gallery",
    textureOpacity: 0.055
  }),
  "corkboard-scrapbook-wall": Object.freeze({
    id: "corkboard-scrapbook-wall",
    label: "Corkboard scrapbook wall",
    baseColor: "0xB98252",
    accentColor: "0xD9AD76",
    texture: "cork",
    textureOpacity: 0.16
  })
});

const CAMERA_MOTIONS: Readonly<
  Record<WallFrameCameraMotion, CameraMotionDefinition>
> = Object.freeze({
  "slow-cinematic": Object.freeze({
    id: "slow-cinematic",
    sectionDurationSec: 6.4,
    minSectionDurationSec: 5.2,
    maxSectionDurationSec: 8.2,
    transitionDurationSec: 0.9,
    zoomRange: [1, 1.055] as const,
    travel: 0.24
  }),
  balanced: Object.freeze({
    id: "balanced",
    sectionDurationSec: 5.1,
    minSectionDurationSec: 4.2,
    maxSectionDurationSec: 6.5,
    transitionDurationSec: 0.7,
    zoomRange: [1.015, 1.075] as const,
    travel: 0.38
  }),
  energetic: Object.freeze({
    id: "energetic",
    sectionDurationSec: 3.9,
    minSectionDurationSec: 3.2,
    maxSectionDurationSec: 5,
    transitionDurationSec: 0.48,
    zoomRange: [1.025, 1.1] as const,
    travel: 0.54
  })
});

export function getFrameStyleDefinition(style: FrameStyleDefinition["id"]) {
  return FRAME_STYLES[style];
}

export function getWallStyleDefinition(style: WallStyle) {
  return WALL_STYLES[style];
}

export function getCameraMotionDefinition(motion: WallFrameCameraMotion) {
  return CAMERA_MOTIONS[motion];
}

export function listFrameStyleDefinitions() {
  return Object.values(FRAME_STYLES);
}

export function listWallStyleDefinitions() {
  return Object.values(WALL_STYLES);
}

export function normalizeWallFrameSettings(
  settings: Partial<WallFrameStyleSettings> | undefined
): WallFrameStyleSettings {
  const frameStyle = settings?.frameStyle;
  const wallStyle = settings?.wallStyle;
  const cameraMotion = settings?.cameraMotion;
  const captionStyle = settings?.captionStyle;
  const durationTargetSec = Number(settings?.durationTargetSec);

  return {
    frameStyle:
      frameStyle && (frameStyle === "mixed-scrapbook" || frameStyle in FRAME_STYLES)
        ? frameStyle
        : DEFAULT_WALL_FRAME_SETTINGS.frameStyle,
    wallStyle:
      wallStyle && wallStyle in WALL_STYLES
        ? wallStyle
        : DEFAULT_WALL_FRAME_SETTINGS.wallStyle,
    cameraMotion:
      cameraMotion && cameraMotion in CAMERA_MOTIONS
        ? cameraMotion
        : DEFAULT_WALL_FRAME_SETTINGS.cameraMotion,
    captionStyle:
      captionStyle &&
      ["none", "simple-dates", "memory-captions", "diary-style-notes"].includes(
        captionStyle
      )
        ? captionStyle
        : DEFAULT_WALL_FRAME_SETTINGS.captionStyle,
    aspectRatio: "landscape-16x9",
    durationTargetSec:
      Number.isFinite(durationTargetSec) && durationTargetSec >= 3
        ? Math.min(900, durationTargetSec)
        : undefined
  };
}

/** Deterministically resolves the mixed preset without using ambient randomness. */
export function resolveFrameStyleForSeed(
  requested: WallFrameStyle,
  seed: number
): FrameStyleDefinition["id"] {
  if (requested !== "mixed-scrapbook") {
    return requested;
  }
  const styles = ["classic-wood", "white-gallery", "modern-black"] as const;
  return styles[Math.abs(Math.trunc(seed)) % styles.length]!;
}
