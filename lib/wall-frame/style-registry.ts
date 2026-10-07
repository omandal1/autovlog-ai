import type {
  WallFrameCameraMotion,
  WallFrameMaterial,
  WallFrameStyle,
  WallFrameStyleSettings,
  WallStyle
} from "@/lib/wall-frame/types";

export interface FrameStyleDefinition {
  id: WallFrameMaterial;
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
  transitionEnergy: "balanced",
  captionStyle: "memory-captions",
  frameVariety: "medium",
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
    "light-oak": Object.freeze({
      id: "light-oak",
      label: "Light oak",
      outerColor: "0xB88757",
      innerMatColor: "0xF3E8D5",
      edgeColor: "0x765033",
      captionColor: "0xEAD4B5",
      captionTextColor: "0x3B291C",
      borderRatio: 0.062,
      shadowOpacity: 0.28,
      shadowOffsetRatio: 0.034
    }),
    walnut: Object.freeze({
      id: "walnut",
      label: "Walnut",
      outerColor: "0x4D3025",
      innerMatColor: "0xE9DDC9",
      edgeColor: "0x241711",
      captionColor: "0xD7BE9D",
      captionTextColor: "0x2A1A13",
      borderRatio: 0.068,
      shadowOpacity: 0.36,
      shadowOffsetRatio: 0.038
    }),
    "dark-mahogany": Object.freeze({
      id: "dark-mahogany",
      label: "Dark mahogany",
      outerColor: "0x54251F",
      innerMatColor: "0xEDE0CF",
      edgeColor: "0x260E0B",
      captionColor: "0xD8BFA7",
      captionTextColor: "0x30120F",
      borderRatio: 0.072,
      shadowOpacity: 0.4,
      shadowOffsetRatio: 0.04
    }),
    "rustic-wood": Object.freeze({
      id: "rustic-wood",
      label: "Rustic wood",
      outerColor: "0x75583F",
      innerMatColor: "0xE8D9BE",
      edgeColor: "0x39291E",
      captionColor: "0xCFB997",
      captionTextColor: "0x35271E",
      borderRatio: 0.075,
      shadowOpacity: 0.34,
      shadowOffsetRatio: 0.042
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
    "brushed-silver": Object.freeze({
      id: "brushed-silver",
      label: "Brushed silver",
      outerColor: "0xA8ADB3",
      innerMatColor: "0xECEDEB",
      edgeColor: "0x5B6066",
      captionColor: "0xD4D7DA",
      captionTextColor: "0x25282C",
      borderRatio: 0.043,
      shadowOpacity: 0.3,
      shadowOffsetRatio: 0.029
    }),
    "subtle-gold": Object.freeze({
      id: "subtle-gold",
      label: "Subtle gold",
      outerColor: "0x9B7A3C",
      innerMatColor: "0xF1E7D2",
      edgeColor: "0x5D4721",
      captionColor: "0xDAC99F",
      captionTextColor: "0x3E321E",
      borderRatio: 0.05,
      shadowOpacity: 0.32,
      shadowOffsetRatio: 0.031
    }),
    bronze: Object.freeze({
      id: "bronze",
      label: "Bronze",
      outerColor: "0x73543A",
      innerMatColor: "0xE8DFD0",
      edgeColor: "0x3C2A1E",
      captionColor: "0xC7AD8A",
      captionTextColor: "0x33251C",
      borderRatio: 0.052,
      shadowOpacity: 0.36,
      shadowOffsetRatio: 0.034
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
    }),
    "painted-pastel": Object.freeze({
      id: "painted-pastel",
      label: "Painted pastel",
      outerColor: "0xAAB9B6",
      innerMatColor: "0xF5EEE4",
      edgeColor: "0x687A76",
      captionColor: "0xDDE6E2",
      captionTextColor: "0x30403D",
      borderRatio: 0.06,
      shadowOpacity: 0.25,
      shadowOffsetRatio: 0.032
    }),
    polaroid: Object.freeze({
      id: "polaroid",
      label: "Polaroid inspired",
      outerColor: "0xF4F0E7",
      innerMatColor: "0xFCFAF5",
      edgeColor: "0xCBC5B9",
      captionColor: "0xF4F0E7",
      captionTextColor: "0x34302B",
      borderRatio: 0.072,
      shadowOpacity: 0.22,
      shadowOffsetRatio: 0.036
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
  const transitionEnergy = settings?.transitionEnergy;
  const captionStyle = settings?.captionStyle;
  const frameVariety = settings?.frameVariety;
  const durationTargetSec = Number(settings?.durationTargetSec);

  return {
    frameStyle:
      frameStyle && ["classic-wood", "modern-black", "white-gallery", "mixed-scrapbook"].includes(frameStyle)
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
    transitionEnergy:
      transitionEnergy && ["gentle", "balanced", "high"].includes(transitionEnergy)
        ? transitionEnergy
        : DEFAULT_WALL_FRAME_SETTINGS.transitionEnergy,
    captionStyle:
      captionStyle &&
      ["none", "simple-dates", "memory-captions", "diary-style-notes"].includes(
        captionStyle
      )
        ? captionStyle
        : DEFAULT_WALL_FRAME_SETTINGS.captionStyle,
    frameVariety:
      frameVariety && ["low", "medium", "high"].includes(frameVariety)
        ? frameVariety
        : DEFAULT_WALL_FRAME_SETTINGS.frameVariety,
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
  seed: number,
  variety: WallFrameStyleSettings["frameVariety"] = "medium"
): FrameStyleDefinition["id"] {
  const families: Record<WallFrameStyle, readonly WallFrameMaterial[]> = {
    "classic-wood": ["classic-wood", "light-oak", "walnut", "dark-mahogany", "rustic-wood"],
    "modern-black": ["modern-black", "brushed-silver", "bronze"],
    "white-gallery": ["white-gallery", "brushed-silver", "modern-black"],
    "mixed-scrapbook": [
      "light-oak",
      "walnut",
      "modern-black",
      "brushed-silver",
      "subtle-gold",
      "white-gallery",
      "painted-pastel",
      "polaroid"
    ]
  };
  const family = families[requested];
  const count = variety === "low" ? 2 : variety === "high" ? Math.min(6, family.length) : Math.min(5, family.length);
  const styles = family.slice(0, count);
  return styles[Math.abs(Math.trunc(seed)) % styles.length]!;
}
