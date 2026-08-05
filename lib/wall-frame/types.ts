export type WallFrameMediaType = "image" | "video";

export type WallFrameStyle =
  | "classic-wood"
  | "modern-black"
  | "white-gallery"
  | "mixed-scrapbook";

export type WallStyle =
  | "warm-bedroom-wall"
  | "dorm-room-wall"
  | "clean-gallery-wall"
  | "corkboard-scrapbook-wall";

export type WallFrameCameraMotion =
  | "slow-cinematic"
  | "balanced"
  | "energetic";

export type WallFrameCaptionStyle =
  | "none"
  | "simple-dates"
  | "memory-captions"
  | "diary-style-notes";

export type WallFrameCropMode = "cover" | "contain";

export interface NormalizedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WallFrameStyleSettings {
  frameStyle: WallFrameStyle;
  wallStyle: WallStyle;
  cameraMotion: WallFrameCameraMotion;
  captionStyle: WallFrameCaptionStyle;
  aspectRatio?: "landscape-16x9";
  durationTargetSec?: number;
}

export interface WallFrameSourceAsset {
  id: string;
  /** Timeline clip identity; kept separate from the persistent media asset identity. */
  clipId: string;
  mediaType: WallFrameMediaType;
  sourcePath: string;
  audioSourcePath?: string;
  durationSec?: number;
  trimStartSec?: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  uploadOrder?: number;
  score?: number;
  caption?: string;
  hasAudio?: boolean;
}

export interface CameraKeyframe {
  /** Horizontal focus point across the wall, normalized from 0 to 1. */
  x: number;
  /** Vertical focus point across the wall, normalized from 0 to 1. */
  y: number;
  /** Additional zoom over the output-sized viewport. A value of 1 shows one viewport. */
  zoom: number;
}

export interface WallFrameCameraPath {
  start: CameraKeyframe;
  end: CameraKeyframe;
  easing: "linear" | "ease-in-out";
}

export interface MemoryFrame {
  id: string;
  mediaAssetId: string;
  /** Exact timeline clip used for trim/audio timing integration. */
  clipId: string;
  mediaType: WallFrameMediaType;
  sourcePath: string;
  audioSourcePath?: string;
  sourceDurationSec?: number;
  bounds: NormalizedBounds;
  zDepth: number;
  frameStyle: Exclude<WallFrameStyle, "mixed-scrapbook">;
  caption?: string;
  startTimeSec: number;
  durationSec: number;
  trimStartSec: number;
  cropMode: WallFrameCropMode;
  role: "hero" | "support";
  useSourceAudio: boolean;
}

export interface WallSectionTransition {
  type: "fade" | "glide-left" | "glide-right";
  durationSec: number;
}

export interface WallSection {
  id: string;
  frames: MemoryFrame[];
  backgroundStyle: WallStyle;
  durationSec: number;
  cameraPath: WallFrameCameraPath;
  transitionToNext?: WallSectionTransition;
}

export interface WallFrameSoundtrackSegment {
  id: string;
  soundtrackId: string;
  sourcePath: string;
  startSec: number;
  sourceOffsetSec: number;
  durationSec: number;
  crossfadeSec: number;
  volumeDb: number;
}

export interface WallFrameSoundtrackPlan {
  sourcePolicy: "internal-licensed" | "user-uploaded-audio";
  segments: WallFrameSoundtrackSegment[];
  usesInternalFallback: boolean;
}

export type WallFrameValidationIssueCode =
  | "no-sections"
  | "empty-section"
  | "invalid-media"
  | "duplicate-media"
  | "out-of-bounds"
  | "frame-overlap"
  | "invalid-duration"
  | "invalid-camera-path"
  | "invalid-soundtrack";

export interface WallFrameValidationIssue {
  code: WallFrameValidationIssueCode;
  message: string;
  sectionId?: string;
  frameId?: string;
}

export interface WallFrameRepairAction {
  type:
    | "clamp-frame"
    | "reflow-section"
    | "remove-frame"
    | "repair-duration"
    | "repair-camera"
    | "trim-soundtrack"
    | "transition-fallback"
    | "simple-fallback";
  targetId: string;
  detail: string;
}

export interface WallFrameValidationReport {
  valid: boolean;
  errors: WallFrameValidationIssue[];
  warnings: WallFrameValidationIssue[];
  repairs: WallFrameRepairAction[];
  metrics: {
    sectionCount: number;
    frameCount: number;
    uniqueMediaCount: number;
    durationSec: number;
  };
}

export interface WallFrameRenderPlan {
  id: string;
  projectId: string;
  outputType: "wall-frame";
  title: string;
  wallSections: WallSection[];
  cameraMoves: WallFrameCameraPath[];
  soundtrackPlan: WallFrameSoundtrackPlan;
  durationSec: number;
  renderSize: {
    width: number;
    height: number;
    fps: number;
  };
  settings: WallFrameStyleSettings;
  validationReport: WallFrameValidationReport;
  fallbackLevel: "none" | "repaired" | "simple";
}

export interface BuildWallFrameRenderPlanInput {
  projectId: string;
  title: string;
  assets: WallFrameSourceAsset[];
  settings?: Partial<WallFrameStyleSettings>;
  soundtrackPlan?: WallFrameSoundtrackPlan;
  renderSize?: Partial<WallFrameRenderPlan["renderSize"]>;
}

export interface WallFrameSectionTiming {
  sectionId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  transitionOverlapSec: number;
}
