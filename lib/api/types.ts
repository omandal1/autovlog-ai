/**
 * Browser-safe API contracts.
 *
 * These DTOs intentionally omit local filesystem paths and server-only render
 * plan details. The backend is the only authority that can resolve stored
 * media into a downloadable or previewable response.
 */

export type GenerationModeDto = "memory-book" | "wall-frame";

export type ProjectStatusDto =
  | "created"
  | "draft"
  | "uploaded"
  | "ready"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type RenderJobStatusDto = "queued" | "processing" | "completed" | "failed";
export type RenderOutputTypeDto = "master" | "chapter" | "wall-frame";
export type MediaAssetTypeDto = "image" | "video";

export type DiaryThemeDto =
  | "scrapbook"
  | "yearbook"
  | "photo-album"
  | "cinematic-journal"
  | "minimal-clean";
export type PacingDto = "fast" | "balanced" | "slow-sentimental";
export type WallFrameStyleDto = "classic-wood" | "modern-black" | "white-gallery" | "mixed-scrapbook";
export type WallStyleDto = "warm-bedroom-wall" | "dorm-room-wall" | "clean-gallery-wall" | "corkboard-scrapbook-wall";
export type CameraMotionDto = "slow-cinematic" | "balanced" | "energetic";
export type CaptionStyleDto = "none" | "simple-dates" | "memory-captions" | "diary-style-notes";

export interface DiaryStyleSettingsDto {
  themePreset: DiaryThemeDto;
  pacing: PacingDto;
}

export interface WallFrameStyleSettingsDto {
  frameStyle: WallFrameStyleDto;
  wallStyle: WallStyleDto;
  cameraMotion: CameraMotionDto;
  captionStyle: CaptionStyleDto;
}

export interface GenerationSettingsDto {
  generationMode?: GenerationModeDto;
  theme?: DiaryThemeDto;
  pacing?: PacingDto;
  diaryStyleSettings?: DiaryStyleSettingsDto;
  wallFrameStyleSettings?: WallFrameStyleSettingsDto;
  uploadedSoundtrackIds?: string[];
  soundtrackStrategy?: "auto-select-best-segments" | "track-order";
}

export interface CurrentUserDto {
  id: string;
  firebaseUid?: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDto {
  id: string;
  title: string;
  status: ProjectStatusDto;
  generationMode: GenerationModeDto;
  settings?: GenerationSettingsDto;
  thumbnailUrl?: string | null;
  masterOutputId?: string | null;
  chapterOutputIds?: string[];
  wallFrameOutputIds?: string[];
  assetCount?: number;
  soundtrackCount?: number;
  outputCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAssetDto {
  id: string;
  projectId: string;
  type: MediaAssetTypeDto;
  originalFilename: string;
  mimeType: string;
  size: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string | null;
  contentUrl?: string | null;
  metadata?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  createdAt: string;
}

export interface SoundtrackAssetDto {
  id: string;
  projectId: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  duration?: number | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  status?: "ready" | "analysis-failed" | "processing";
  analysis?: Record<string, unknown>;
  createdAt: string;
}

export interface RenderJobDto {
  id: string;
  projectId: string;
  generationMode: GenerationModeDto;
  status: RenderJobStatusDto;
  progress: number;
  currentStage?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RenderOutputDto {
  id: string;
  projectId: string;
  renderJobId: string;
  type: RenderOutputTypeDto;
  title: string;
  duration?: number | null;
  size?: number | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  downloadUrl?: string | null;
  createdAt: string;
}

export interface OutputAccessTicketDto {
  url: string;
  disposition: "inline" | "attachment";
  expiresAt: string;
}

export interface ProjectDetailDto extends ProjectDto {
  media?: MediaAssetDto[];
  soundtracks?: SoundtrackAssetDto[];
  renderJobs?: RenderJobDto[];
  latestRenderJob?: RenderJobDto | null;
  outputs?: RenderOutputDto[];
}

export interface CreateProjectInput {
  title: string;
  generationMode: GenerationModeDto;
  settings?: GenerationSettingsDto;
}

export interface UpdateProjectInput {
  title?: string;
  generationMode?: GenerationModeDto;
  settings?: GenerationSettingsDto;
}

export interface CreateRenderInput {
  settings?: GenerationSettingsDto;
}

export interface ApiErrorPayload {
  error?: string | { message?: string };
  message?: string;
  code?: string;
}
