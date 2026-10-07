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

export type WallFrameTransitionEnergy = "gentle" | "balanced" | "high";

export type WallFrameCaptionStyle =
  | "none"
  | "simple-dates"
  | "memory-captions"
  | "diary-style-notes";

export type WallFrameCropMode = "cover" | "contain";

export type WallFrameFrameVariety = "low" | "medium" | "high";

export type WallFrameShape =
  | "portrait-rectangle"
  | "landscape-rectangle"
  | "square"
  | "oval"
  | "circle"
  | "rounded-rectangle"
  | "tall-portrait"
  | "panoramic"
  | "arch-top"
  | "octagonal";

export type WallFrameMaterial =
  | "classic-wood"
  | "light-oak"
  | "walnut"
  | "dark-mahogany"
  | "rustic-wood"
  | "modern-black"
  | "brushed-silver"
  | "subtle-gold"
  | "bronze"
  | "white-gallery"
  | "painted-pastel"
  | "polaroid";

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
  transitionEnergy: WallFrameTransitionEnergy;
  captionStyle: WallFrameCaptionStyle;
  frameVariety: WallFrameFrameVariety;
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
  editorialScore?: number;
  importanceScore?: number;
  clusterId?: string;
  selectionReason?: string;
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

export type WallFrameMotionBeatType =
  | "wall-reveal"
  | "camera-glide"
  | "hero-push-in"
  | "hero-focus-hold"
  | "snap-zoom-out"
  | "whip-pan"
  | "frame-flip"
  | "slide-panel"
  | "zoom-through-frame"
  | "multi-frame-pass-by"
  | "cluster-reveal"
  | "final-wall-reveal";

export type WallFrameMotionEasing =
  | "linear"
  | "ease-in-out"
  | "ease-out-quart"
  | "ease-out-expo";

export interface CameraTransform {
  /** Horizontal focus point across the wall, normalized from 0 to 1. */
  x: number;
  /** Vertical focus point across the wall, normalized from 0 to 1. */
  y: number;
  /** Additional camera scale over the output viewport. */
  scale: number;
  /** Small 2.5D roll, in degrees. */
  rotation: number;
  /** Normalized perspective/depth intensity. */
  perspective: number;
  /** Motion-blur approximation intensity, normalized from 0 to 1. */
  blur: number;
  /** Normalized virtual camera depth. */
  depth: number;
}

export interface TransitionParams {
  direction?: "left" | "right" | "up" | "down";
  motionBlurAmount?: number;
  flipAxis?: "x" | "y";
  shadowIntensity?: number;
  zoomAmount?: number;
  revealTarget?: "hero" | "cluster" | "next-section";
}

export interface MotionBeat {
  id: string;
  type: WallFrameMotionBeatType;
  /** Section-relative start time. */
  startTimeSec: number;
  durationSec: number;
  activeFrameIds: string[];
  cameraTransformStart: CameraTransform;
  cameraTransformEnd: CameraTransform;
  easing: WallFrameMotionEasing;
  mediaPlaybackBehavior: "ambient-loop" | "hero-play" | "photo-parallax" | "hold";
  transitionParams?: TransitionParams;
  /** Optional absolute soundtrack beat/onset target. */
  beatSyncTargetSec?: number;
}

/** Named planner primitives retained in the render plan for inspection and validation. */
export type CameraMove = MotionBeat;
export type TransitionBeat = MotionBeat;
export type HeroFrameFocus = MotionBeat;
export type FrameFlipTransition = MotionBeat;
export type ClusterReveal = MotionBeat;

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
  frameStyle: WallFrameMaterial;
  frameShape: WallFrameShape;
  caption?: string;
  startTimeSec: number;
  durationSec: number;
  trimStartSec: number;
  cropMode: WallFrameCropMode;
  role: "hero" | "support";
  /** The section where this supporting frame is intentionally promoted to hero. */
  promotionTargetSceneIndex?: number;
  useSourceAudio: boolean;
}

export interface WallSectionTransition {
  type:
    | "glide-left"
    | "glide-right"
    | "slide-up"
    | "slide-down"
    | "whip-left"
    | "whip-right"
    | "frame-flip-x"
    | "frame-flip-y"
    | "zoom-through";
  durationSec: number;
}

export interface WallSection {
  id: string;
  frames: MemoryFrame[];
  backgroundStyle: WallStyle;
  durationSec: number;
  cameraPath: WallFrameCameraPath;
  motionBeats: MotionBeat[];
  transitionToNext?: WallSectionTransition;
}

export interface WallFrameMediaCoverage {
  mediaAssetId: string;
  selectedForMaster: boolean;
  heroAppearanceCount: number;
  supportingAppearanceCount: number;
  firstHeroSceneIndex?: number;
  lastHeroSceneIndex?: number;
  lastSupportingSceneIndex?: number;
  hasBeenHero: boolean;
  coveragePriority: number;
  importanceScore: number;
  editorialScore: number;
  clusterId?: string;
}

export interface WallFrameExcludedMedia {
  mediaAssetId: string;
  reason: "duration-capacity" | "duplicate" | "invalid" | "editorial-rejection";
  detail: string;
}

export interface WallFrameCoverageMetrics {
  selectedMediaCount: number;
  heroCoveredMediaCount: number;
  heroCoverageRatio: number;
  averageHeroAppearances: number;
  maxHeroAppearancesForSingleAsset: number;
  uniqueFrameStylesUsed: number;
  uniqueFrameShapesUsed: number;
  wallSectionCount: number;
  clusterVideoCount: number;
  duplicateUsageCount: number;
  estimatedHeroCapacity: number;
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
  | "invalid-motion-beat"
  | "missing-motion-pattern"
  | "motion-gap"
  | "incomplete-hero-coverage"
  | "hero-domination"
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
    | "repair-motion-beats"
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
    heroCoveredMediaCount: number;
    heroCoverageRatio: number;
    averageHeroAppearances: number;
    maxHeroAppearancesForSingleAsset: number;
    uniqueFrameStylesUsed: number;
    uniqueFrameShapesUsed: number;
    duplicateUsageCount: number;
  };
}

export interface WallFrameRenderPlan {
  id: string;
  projectId: string;
  outputType: "wall-frame";
  outputRole: "master" | "cluster";
  clusterId?: string;
  title: string;
  wallSections: WallSection[];
  cameraMoves: WallFrameCameraPath[];
  motionBeats: MotionBeat[];
  soundtrackPlan: WallFrameSoundtrackPlan;
  durationSec: number;
  renderSize: {
    width: number;
    height: number;
    fps: number;
  };
  settings: WallFrameStyleSettings;
  selectedMasterMedia: string[];
  excludedMedia: WallFrameExcludedMedia[];
  mediaCoverage: WallFrameMediaCoverage[];
  coverageMetrics: WallFrameCoverageMetrics;
  validationReport: WallFrameValidationReport;
  fallbackLevel: "none" | "repaired" | "simple";
}

export interface BuildWallFrameRenderPlanInput {
  projectId: string;
  title: string;
  assets: WallFrameSourceAsset[];
  outputRole?: "master" | "cluster";
  clusterId?: string;
  clusterVideoCount?: number;
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
