export type MediaType = "image" | "video";
export type Tone = "energetic" | "balanced" | "emotional";
export type ClipDensity = "fast-cuts" | "slow-cuts";
export type MusicStyle = "cinematic" | "lofi" | "none";
export type StoryStyle =
  | "cinematic"
  | "authentic"
  | "emotional"
  | "energetic"
  | "balanced";
export type GenerationMode = "memory-book";
export type SubjectEmphasis =
  | "friends"
  | "campus-scenery"
  | "activities-events"
  | "dialogue-moments"
  | "balanced";
export type AudioEmphasis =
  | "original-audio-forward"
  | "music-forward"
  | "balanced";
export type PacingMode = "fast" | "balanced" | "slow-sentimental";
export type OrderingPreference =
  | "strict-chronological"
  | "mostly-chronological"
  | "best-story-order";
export type ThemePreset =
  | "scrapbook"
  | "yearbook"
  | "photo-album"
  | "cinematic-journal"
  | "minimal-clean";
export type TitleStyle =
  | "simple"
  | "nostalgic"
  | "yearbook"
  | "scrapbook"
  | "cinematic";
export type DecorationLevel = "minimal" | "balanced" | "rich";
export type AspectRatioOption = "landscape-16x9";
export type VlogVibe = "energetic" | "emotional" | "chill" | "cinematic";
export type MediaImportanceTier = "hero" | "strong" | "usable" | "weak" | "excluded";
export type PreviewRegenerationMode =
  | "full-plan"
  | "titles-only"
  | "chapter-grouping"
  | "styling"
  | "opening-ending"
  | "music-mood";
export type TransitionType =
  | "book-open"
  | "fade"
  | "crossfade"
  | "zoom-blend"
  | "soft-wipe-left"
  | "soft-wipe-right"
  | "slide-left"
  | "slide-right"
  | "blur-fade"
  | "page-flip";
export type MotionEffect = "zoom-in" | "zoom-out" | "pan-left" | "pan-right";
export type ProjectStatus =
  | "uploaded"
  | "processing"
  | "preview"
  | "ready"
  | "failed";
export type PipelineStage =
  | "queued"
  | "ingest"
  | "preprocess"
  | "analysis"
  | "score"
  | "group"
  | "story"
  | "timeline"
  | "preview"
  | "render"
  | "complete"
  | "failed";
export type OutputKind = "master" | "chapter";
export type AssetVariant = "original" | "thumbnail" | "normalized" | "proxy";
export type ExportAudioPolicy =
  | "internal-licensed"
  | "licensed-substitute"
  | "direct-user-audio";
export type MusicSourcePolicy =
  | "internal-licensed"
  | "user-uploaded-audio";
export type SoundtrackUploadStatus = "ready" | "analysis-failed";
export type SoundtrackStrategy = "auto-select-best-segments" | "track-order";
export type PageEventType =
  | "general"
  | "concert"
  | "sports"
  | "study"
  | "campus"
  | "friends"
  | "travel"
  | "nightlife"
  | "celebration"
  | "dialogue"
  | "photo-dump";
export type PageDesignDensity = "airy" | "balanced" | "filled";

export interface GenerationSettings {
  generationMode: GenerationMode;
  storyStyle: StoryStyle;
  subjectEmphasis: SubjectEmphasis;
  audioEmphasis: AudioEmphasis;
  pacing: PacingMode;
  ordering: OrderingPreference;
  themePreset: ThemePreset;
  titleStyle: TitleStyle;
  decorationLevel: DecorationLevel;
  aspectRatio: AspectRatioOption;
}

export interface SoundtrackAnalysis {
  durationSec?: number;
  bitrateKbps?: number;
  sampleRateHz?: number;
  channels?: number;
  loudnessMeanDb?: number;
  loudnessPeakDb?: number;
  silenceStartSec?: number;
  silenceEndSec?: number;
  estimatedBpm?: number;
  energyScore: number;
  stableStartSec: number;
  stableEndSec: number;
  confidence: number;
  source: "ffprobe" | "heuristic" | "fallback";
}

export interface UploadedSoundtrack {
  id: string;
  filename: string;
  title: string;
  artist?: string;
  path: string;
  mimeType: string;
  byteSize: number;
  status: SoundtrackUploadStatus;
  analysis?: SoundtrackAnalysis;
  error?: string;
}

export interface UploadedAudioTrack {
  filename: string;
  path: string;
  mimeType: string;
  durationSec?: number;
}

export interface SoundtrackSegment {
  id: string;
  soundtrackId: string;
  sourcePath: string;
  title: string;
  startSec: number;
  sourceOffsetSec: number;
  durationSec: number;
  crossfadeSec: number;
  volumeDb: number;
  role: "intro" | "body" | "outro";
}

export interface SoundtrackPlan {
  sourcePolicy: MusicSourcePolicy;
  strategy: SoundtrackStrategy;
  uploadedTrackIds: string[];
  segments: SoundtrackSegment[];
  usesInternalFallback: boolean;
  analysisNotes: string[];
}

export interface MusicSelectionSettings {
  sourcePolicy: MusicSourcePolicy;
  exportPolicy: ExportAudioPolicy;
  note?: string;
  uploadedSoundtracks: UploadedSoundtrack[];
  preferredTrackOrder: string[];
  soundtrackStrategy: SoundtrackStrategy;
  uploadedAudio?: UploadedAudioTrack;
}

export interface ProjectSettings {
  tone: Tone;
  clipDensity: ClipDensity;
  musicStyle: MusicStyle;
  generation?: GenerationSettings;
  musicSelection?: MusicSelectionSettings;
}

export interface UserPreferences {
  defaultGenerationSettings?: GenerationSettings;
  preferredThemePreset?: ThemePreset;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
  preferences: UserPreferences;
  connectedMusicAccounts?: unknown[];
}

export interface UserSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface UserProject {
  projectId: string;
  userId: string;
  createdAt: string;
}

export interface MediaMetadata {
  capturedAt?: string;
  capturedAtSource: "exif" | "video_tag" | "filesystem" | "upload_order";
  durationSec?: number;
  width?: number;
  height?: number;
  extension: string;
  mimeType: string;
  byteSize: number;
}

export interface ScoreBreakdown {
  visualClarity: number;
  brightness: number;
  contrast: number;
  motion: number;
  uniqueness: number;
  faceHint: number;
  durationWeight: number;
  aiBoost: number;
  total: number;
}

export interface SelectionReason {
  kind:
    | "user-pinned"
    | "strong-visual-quality"
    | "recurring-friend-group"
    | "memorable-dialogue"
    | "chapter-anchor"
    | "opening-candidate"
    | "ending-candidate"
    | "unique-scene"
    | "beat-fit"
    | "chronological-significance"
    | "theme-fit"
    | "balanced-coverage";
  label: string;
  detail?: string;
  weight?: number;
}

export interface SkipReason {
  kind:
    | "duplicate"
    | "weak-quality"
    | "excluded-by-user"
    | "redundant"
    | "low-story-relevance"
    | "weaker-than-similar"
    | "not-selected-for-variant";
  label: string;
  detail?: string;
}

export interface DuplicateAnalysis {
  clusterId?: string;
  kind: "none" | "exact" | "near-duplicate" | "burst";
  similarityScore: number;
  keeperAssetId?: string;
  isDuplicate: boolean;
}

export interface TranscriptResult {
  text?: string;
  snippet?: string;
  confidence: number;
  dialogueScore: number;
  source: "whisper" | "sidecar" | "heuristic" | "none";
  events: string[];
}

export interface FaceClusterResult {
  clusterId?: string;
  faceLike: boolean;
  faceScore: number;
  recurrenceCount: number;
  role: "lead" | "recurring" | "support" | "none";
}

export interface BeatAnalysis {
  bpm?: number;
  beatGridSec: number[];
  phraseMarkersSec: number[];
  confidence: number;
  source: "recipe" | "heuristic" | "fallback";
}

export interface PageVibeClassification {
  primary: PageEventType;
  secondary?: PageEventType;
  vibe: VlogVibe;
  confidence: number;
  tags: string[];
  signals: string[];
}

export interface DecorationAsset {
  id: string;
  label: string;
  source: "local" | "licensed-online" | "user-uploaded";
  licenseType: "built-in" | "cc0" | "cc-by" | "user-provided" | "official-api";
  attribution?: string;
  allowedUse: "export-safe" | "preview-only";
  width: number;
  height: number;
  tags: string[];
  renderKind:
    | "emoji-sticker"
    | "stamp"
    | "label-tag"
    | "note-strip"
    | "caption-plaque"
    | "date-chip"
    | "sticker-star"
    | "tape-strip"
    | "corner-tab"
    | "doodle-line";
  text?: string;
  color?: string;
  priority?: number;
}

export interface DecorationPlacement {
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  layer: "under-media" | "over-media" | "paper";
}

export interface DecorationAssetProvider {
  name: string;
  listAssets(input: {
    pageVibe: PageVibeClassification;
    themePreset: ThemePreset;
    density: DecorationLevel;
  }): Promise<DecorationAsset[]>;
}

export interface SafeLayoutZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  purpose: "media" | "text" | "decor" | "gutter" | "edge-buffer";
}

export interface OverlapViolation {
  a: string;
  b: string;
  area: number;
}

export interface OutOfBoundsViolation {
  id: string;
  direction: "left" | "right" | "top" | "bottom";
  overflow: number;
}

export interface AutoRepairAction {
  type: "move" | "resize" | "remove-decoration" | "reflow";
  targetId: string;
  detail: string;
}

export interface LayoutCollisionReport {
  overlaps: OverlapViolation[];
  outOfBounds: OutOfBoundsViolation[];
}

export interface RenderLayoutValidationReport {
  valid: boolean;
  overlaps: OverlapViolation[];
  outOfBounds: OutOfBoundsViolation[];
  unreadableTextIds: string[];
  aspectRatioWarnings: string[];
  repairs: AutoRepairAction[];
}

export interface ThemePresetConfig {
  id: ThemePreset;
  label: string;
  coverStyle: BookBackgroundStyle;
  pageStyle: BookBackgroundStyle;
  dividerStyle: BookBackgroundStyle;
  accentColor: string;
  frameTreatment: "polaroid" | "matte" | "clean" | "journal";
  ornamentDensity: "low" | "medium" | "high";
  captionTone: "warm" | "crisp" | "editorial";
  coverTexture: "linen" | "leather" | "paper-wrap" | "matte-board";
  deskSurface: "oak-desk" | "walnut-desk" | "linen-cloth" | "midnight-table";
  paperTone: "warm-ivory" | "rose-ivory" | "cool-cream" | "inkwashed";
  introCamera: "top-down" | "angled-top";
  pageTurnStyle: "soft-arch" | "dramatic-lift" | "quick-flick" | "classic-turn";
  stickerSet: Array<
    "tape" | "stamp" | "label" | "doodle" | "corner" | "spark" | "emoji" | "note"
  >;
  titleTreatment: "handwritten" | "yearbook" | "editorial" | "cinematic" | "minimal";
}

export interface HighlightMoment {
  assetId: string;
  chapterId: string;
  score: number;
  kind: "opening" | "peak" | "dialogue" | "social" | "scenic" | "ending";
  reasons: SelectionReason[];
}

export interface AnchorAssignment {
  openingAssetId?: string;
  endingAssetId?: string;
  chapterStartAssetIds: string[];
  chapterEndingAssetIds: string[];
}

export interface PacingProfile {
  pageHoldBias: number;
  transitionBias: number;
  beatSnapStrength: number;
  storyEnergyCurve: number[];
}

export interface ChapterPlan {
  chapterId: string;
  title: string;
  subtitle?: string;
  orderedAssetIds: string[];
  representativeAssetIds: string[];
  openingAssetId?: string;
  endingAssetId?: string;
  highlightAssetIds: string[];
  estimatedDurationSec: number;
  reasons: SelectionReason[];
}

export interface StoryPlan {
  id: string;
  projectId: string;
  generatedAt: string;
  orderingStrategy: OrderingPreference;
  pacingProfile: PacingProfile;
  highlights: HighlightMoment[];
  anchors: AnchorAssignment;
  recapTitle: string;
  recapSubtitle?: string;
  chapterPlans: ChapterPlan[];
  selectedAssetIds: string[];
  skippedAssetIds: string[];
  reasonsByAssetId: Record<string, SelectionReason[]>;
  skipReasonsByAssetId: Record<string, SkipReason[]>;
}

export interface PreviewPlan {
  id: string;
  projectId: string;
  name: string;
  variantLabel: string;
  previewMode: PreviewRegenerationMode;
  isPrimary: boolean;
  recapTitle: string;
  recapSubtitle?: string;
  chapterTitles: string[];
  chapterCount: number;
  themePreset: ThemePreset;
  titleStyle: TitleStyle;
  decorationLevel: DecorationLevel;
  generationMode: GenerationMode;
  aspectRatio: AspectRatioOption;
  musicVibe: VlogVibe;
  estimatedDurationSec: number;
  representativeAssetIds: string[];
  openingAssetIds: string[];
  endingAssetIds: string[];
  storyPlan: StoryPlan;
  masterTimeline: Timeline;
  chapterTimelines: Timeline[];
}

export interface UserMediaState {
  pinned: boolean;
  excluded: boolean;
}

export interface MediaAnalysis {
  keyframeCount?: number;
  transcript?: string;
  transcriptResult?: TranscriptResult;
  semanticHint?: string;
  qualityTier?: MediaImportanceTier;
  duplicateAnalysis?: DuplicateAnalysis;
  faceCluster?: FaceClusterResult;
  selectionReasons?: SelectionReason[];
  skipReasons?: SkipReason[];
  dialogueEvents?: string[];
}

export interface MediaAsset {
  id: string;
  projectId: string;
  filename: string;
  mediaType: MediaType;
  uploadOrder: number;
  storage: {
    originalPath: string;
    thumbnailPath: string;
    normalizedPath?: string;
    proxyPath?: string;
    keyframeDir?: string;
  };
  metadata: MediaMetadata;
  score?: ScoreBreakdown;
  fingerprints?: {
    averageHash?: string;
  };
  userState?: UserMediaState;
  analysis?: MediaAnalysis;
}

export interface Chapter {
  id: string;
  projectId: string;
  index: number;
  title: string;
  labelConfidence: number;
  assetIds: string[];
  startAt?: string;
  endAt?: string;
  stats: {
    totalAssets: number;
    imageCount: number;
    videoCount: number;
    avgScore: number;
    avgMotion: number;
    spanHours: number;
  };
}

export interface TimelineClip {
  id: string;
  assetId: string;
  chapterId: string;
  mediaType: MediaType;
  sourcePath: string;
  audioSourcePath?: string;
  normalizedPath?: string;
  trimStartSec: number;
  trimDurationSec: number;
  displayDurationSec: number;
  score: number;
  hasSpeech?: boolean;
  sourceAudio?: {
    hasAudio: boolean;
    meanVolumeDb?: number;
    maxVolumeDb?: number;
    gainDb: number;
    musicDuckDb: number;
  };
  titleOverlay?: string;
  filename?: string;
  capturedAt?: string;
  transcriptText?: string;
  sceneTags?: string[];
  storyRole?: "opening" | "chapter-intro" | "highlight" | "bridge" | "closing";
  transitionName?: string;
  motionEffect?: MotionEffect;
}

export interface TimelineTransition {
  id: string;
  fromClipId: string;
  toClipId: string;
  type: TransitionType;
  durationSec: number;
  filterName: string;
  isChapterBoundary?: boolean;
  shadowStrength?: number;
  curveStrength?: number;
  liftPx?: number;
}

export interface TimelineAudioTrack {
  id: string;
  trackId: string;
  title: string;
  category: VlogVibe;
  sourcePath: string;
  startSec: number;
  sourceOffsetSec: number;
  durationSec: number;
  crossfadeSec: number;
  volumeDb: number;
}

export type BookPageKind = "cover" | "chapter-divider" | "content" | "outro";
export type BookPageLayoutType =
  | "cover"
  | "chapter-divider"
  | "hero"
  | "side-by-side"
  | "three-up"
  | "video-memory-board"
  | "yearbook-spread"
  | "concert-board"
  | "quote-page";
export type BookBackgroundStyle =
  | "cover-navy"
  | "cover-burgundy"
  | "paper-cream"
  | "paper-rose"
  | "divider-slate";
export type PageAudioMode = "music-only" | "source-primary" | "mixed";
export type MemoryBookStyle = "memory-book";
export type BookDecorationKind =
  | "tape-strip"
  | "stamp"
  | "label-tag"
  | "doodle-line"
  | "sticker-star"
  | "corner-tab"
  | "date-chip"
  | "caption-plaque"
  | "emoji-sticker"
  | "note-strip"
  | "diary-text"
  | "notebook-rule"
  | "torn-paper";
export type BookTextTreatmentStyle =
  | "handwritten"
  | "yearbook"
  | "editorial"
  | "cinematic"
  | "minimal";

export interface BookPageSlotFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
}

export interface BookPageSlot {
  id: string;
  clipId: string;
  assetId: string;
  chapterId: string;
  mediaType: MediaType;
  sourcePath: string;
  audioSourcePath?: string;
  trimStartSec: number;
  trimDurationSec: number;
  displayDurationSec: number;
  motionEffect?: MotionEffect;
  role: "primary" | "support";
  frame: BookPageSlotFrame;
  startSecWithinPage: number;
  useSourceAudio: boolean;
}

export interface BookPageAudioStrategy {
  mode: PageAudioMode;
  sourceClipIds: string[];
  musicGainDb: number;
  sourceGainDb: number;
}

export interface BookMaterialConfig {
  surfaceStyle: ThemePresetConfig["deskSurface"];
  surfaceColor: string;
  surfaceAccentColor: string;
  paperColor: string;
  paperShadowColor: string;
  pageEdgeColor: string;
  grainOpacity: number;
  shadowOpacity: number;
  coverTexture: ThemePresetConfig["coverTexture"];
  coverColor: string;
  coverEdgeColor: string;
  coverHighlightColor: string;
  depthShadowOpacity: number;
  pageStackLines: number;
  gutterShadowOpacity: number;
  paperFiberOpacity: number;
  pageCurlShadowOpacity: number;
}

export interface BookTextTreatment {
  style: BookTextTreatmentStyle;
  titleColor: string;
  subtitleColor: string;
  labelColor: string;
  titleBoxColor: string;
  captionBoxColor: string;
  titleCase: "upper" | "title" | "mixed";
  accentLabel?: string;
}

export interface BookDecoration {
  id: string;
  kind: BookDecorationKind;
  layer: "under-media" | "over-media" | "paper";
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  opacity?: number;
  color?: string;
  text?: string;
  assetId?: string;
  licenseType?: DecorationAsset["licenseType"];
  source?: DecorationAsset["source"];
  tags?: string[];
  priority?: number;
}

export interface BookOpeningAnimationConfig {
  type: "closed-book-open";
  durationSec: number;
  cameraAngle: ThemePresetConfig["introCamera"];
  openDirection: "left-to-right" | "right-to-left";
  shadowStrength: number;
  coverLift: number;
  perspectiveStrength: number;
}

export interface BookPageTransition {
  id: string;
  fromPageId: string;
  toPageId: string;
  type: TransitionType;
  durationSec: number;
  filterName: string;
  isChapterBoundary?: boolean;
  shadowStrength?: number;
  curveStrength?: number;
  liftPx?: number;
  frameBudget?: number;
}

export interface BookPage {
  id: string;
  kind: BookPageKind;
  chapterId?: string;
  title: string;
  subtitle?: string;
  layoutType: BookPageLayoutType;
  backgroundStyle: BookBackgroundStyle;
  durationSec: number;
  slots: BookPageSlot[];
  chapterBoundary?: boolean;
  audioStrategy: BookPageAudioStrategy;
  decorations: BookDecoration[];
  material: BookMaterialConfig;
  textTreatment: BookTextTreatment;
  diaryText?: string;
  vibe?: PageVibeClassification;
  designDensity?: PageDesignDensity;
  safeZones?: SafeLayoutZone[];
  layoutValidation?: RenderLayoutValidationReport;
}

export interface BookCoverMetadata {
  title: string;
  subtitle?: string;
  accentLabel?: string;
  coverStyle: BookBackgroundStyle;
  durationSec: number;
  material: BookMaterialConfig;
  textTreatment: BookTextTreatment;
}

export interface BookRenderPlan {
  style: MemoryBookStyle;
  generatedTitle: string;
  cover: BookCoverMetadata;
  pages: BookPage[];
  transitions: BookPageTransition[];
  openingAnimation: BookOpeningAnimationConfig;
  material: BookMaterialConfig;
  textTreatment: BookTextTreatment;
  reusePolicy: "unique-only" | "controlled-fallback";
  uniqueAssetIds: string[];
  validationNotes?: string[];
  renderCacheKey?: string;
}

export interface Timeline {
  id: string;
  projectId: string;
  kind: OutputKind;
  title: string;
  subtitle?: string;
  targetDurationSec: number;
  actualDurationSec: number;
  settings: ProjectSettings;
  clips: TimelineClip[];
  detectedVibe?: VlogVibe;
  transitions?: TimelineTransition[];
  audioTracks?: TimelineAudioTrack[];
  beatAnalysis?: BeatAnalysis;
  soundtrackPlan?: SoundtrackPlan;
  book?: BookRenderPlan;
  chapterOrder: string[];
  renderProfile: {
    width: number;
    height: number;
    fps: number;
    transitionSec: number;
  };
}

export interface RenderedOutput {
  id: string;
  projectId: string;
  kind: OutputKind;
  planId?: string;
  chapterId?: string;
  title: string;
  durationSec: number;
  timelinePath: string;
  outputPath: string;
  downloadRoute: string;
}

export interface ProjectSummary {
  id: string;
  ownerUserId?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  stage: PipelineStage;
  settings: ProjectSettings;
  error?: string;
  assetCount: number;
  outputs: RenderedOutput[];
}

export interface ProjectRecord extends ProjectSummary {
  chapters: Chapter[];
  assets: MediaAsset[];
  storyPlan?: StoryPlan;
  previewPlans?: PreviewPlan[];
  selectedPlanId?: string;
  timelinePaths: {
    master?: string;
    chapters: string[];
  };
}

export interface PythonScoreSuggestion {
  assetId: string;
  qualityBoost: number;
  semanticHint?: string;
  faceHint?: number;
}

export interface PythonChapterLabel {
  chapterId: string;
  title: string;
  confidence: number;
}

export interface BatchAnalyzeRequest {
  projectId: string;
  assets: Array<{
    id: string;
    mediaType: MediaType;
    thumbnailPath: string;
    proxyPath?: string;
    brightness: number;
    contrast: number;
    sharpness: number;
    motion: number;
    uniqueness: number;
    durationSec: number;
  }>;
}

export interface BatchAnalyzeResponse {
  suggestions: PythonScoreSuggestion[];
}

export interface PythonTranscription {
  assetId: string;
  text?: string;
  snippet?: string;
  confidence: number;
  source: TranscriptResult["source"];
  events: string[];
}

export interface TranscribeBatchRequest {
  projectId: string;
  assets: Array<{
    assetId: string;
    mediaType: MediaType;
    originalPath: string;
    durationSec: number;
  }>;
}

export interface TranscribeBatchResponse {
  transcriptions: PythonTranscription[];
}

export interface LabelChapterRequest {
  projectId: string;
  chapters: Array<{
    chapterId: string;
    avgMotion: number;
    imageRatio: number;
    videoRatio: number;
    avgBrightness: number;
    spanHours: number;
    size: number;
  }>;
}

export interface LabelChapterResponse {
  labels: PythonChapterLabel[];
}
